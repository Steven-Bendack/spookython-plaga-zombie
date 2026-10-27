// Original soundtrack generated live with the Web Audio API (no audio files):
// a low detuned drone that slowly opens and closes, a heartbeat, and a soft
// "bite" blip that the map can trigger. Browsers only allow audio after a
// click, which is why it starts from the intro screen.

let ctx = null;
let master = null;
let heartTimer = 0;
let playing = false;
let heartRate = 1.1; // seconds between beats; the map speeds it up with the outbreak
let volume = 0.8;    // set from Settings

export function isOn() {
  return playing;
}

export async function start() {
  if (!ctx) build();
  await ctx.resume();
  playing = true;
  fade(0.6 * volume, 2.5);
  scheduleHeart();
}

export function stop() {
  if (!ctx) return;
  playing = false;
  fade(0, 0.8);
  clearTimeout(heartTimer);
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (ctx && playing) fade(0.6 * volume, 0.3);
}

// 0 = calm city, 1 = city overrun: faster heart, brighter drone.
export function setTension(level) {
  if (!ctx) return;
  const t = Math.max(0, Math.min(1, level));
  heartRate = 1.1 - 0.55 * t;
  ctx.filter.frequency.setTargetAtTime(220 + 900 * t, ctx.currentTime, 1.5);
}

export function bite() {
  if (!isOn()) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(520 + Math.random() * 200, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.18);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
  osc.connect(gain).connect(master);
  osc.start(now);
  osc.stop(now + 0.25);
}

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // Drone: three detuned saws through a low-pass filter that breathes.
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 260;
  filter.Q.value = 6;
  filter.connect(master);
  ctx.filter = filter;
  for (const [freq, detune] of [[55, -7], [55, 6], [82.4, 3]]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = 0.09;
    osc.connect(g).connect(filter);
    osc.start();
  }
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoGain.gain.value = 140;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  // Wind: filtered noise, very low.
  const noise = ctx.createBufferSource();
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  noise.buffer = buffer;
  noise.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 500;
  band.Q.value = 0.7;
  const wind = ctx.createGain();
  wind.gain.value = 0.025;
  noise.connect(band).connect(wind).connect(master);
  noise.start();
}

function fade(to, seconds) {
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(to, now + seconds);
}

function thump(at, strength) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(70, at);
  osc.frequency.exponentialRampToValueAtTime(38, at + 0.16);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(strength, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + 0.3);
}

function scheduleHeart() {
  clearTimeout(heartTimer);
  if (!playing) return;
  const now = ctx.currentTime + 0.05;
  thump(now, 0.5);
  thump(now + 0.22, 0.3);
  heartTimer = setTimeout(scheduleHeart, heartRate * 1000);
}
