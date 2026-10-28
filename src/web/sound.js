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

// ---------- effects for the map (all synthesized, no recordings) ----------

let lastInfect = 0;

// A wet bite: a short low thump and a burst of filtered noise. Called when new people are
// bitten on the map; rate-limited so a busy day sounds like a crowd, not a machine gun.
export function infect(amount = 0.3) {
  if (!isOn()) return;
  const now = ctx.currentTime;
  if (now - lastInfect < 0.16) return;
  lastInfect = now;
  const level = 0.06 + 0.09 * Math.min(1, amount);  // peaks ≈ −18 dB, under the drone (measured offline)
  const thumpOsc = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thumpOsc.frequency.setValueAtTime(140 + Math.random() * 40, now);
  thumpOsc.frequency.exponentialRampToValueAtTime(55, now + 0.12);
  thumpGain.gain.setValueAtTime(level, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
  thumpOsc.connect(thumpGain).connect(master);
  thumpOsc.start(now); thumpOsc.stop(now + 0.15);
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.12);
  const band = ctx.createBiquadFilter();
  band.type = "bandpass"; band.frequency.value = 1400 + Math.random() * 900; band.Q.value = 2.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(level * 0.9, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
  src.connect(band).connect(g).connect(master);
  src.start(now);
}

// A zombie groan: a buzzing low voice through a moving "vowel" filter, sliding down.
export function groan() {
  if (!isOn()) return;
  const now = ctx.currentTime;
  const voice = ctx.createOscillator();
  voice.type = "sawtooth";
  voice.frequency.setValueAtTime(95 + Math.random() * 25, now);
  voice.frequency.exponentialRampToValueAtTime(62, now + 1.3);
  const wobble = ctx.createOscillator();
  const wobbleGain = ctx.createGain();
  wobble.frequency.value = 5.5; wobbleGain.gain.value = 4;
  wobble.connect(wobbleGain).connect(voice.frequency);
  const vowel = ctx.createBiquadFilter();
  vowel.type = "bandpass"; vowel.Q.value = 5;
  vowel.frequency.setValueAtTime(700, now);
  vowel.frequency.linearRampToValueAtTime(380, now + 1.2);  // "aaa" closing to "ooo"
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.4, now + 0.25);  // the vowel filter eats most energy
  g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
  voice.connect(vowel).connect(g).connect(master);
  voice.start(now); wobble.start(now);
  voice.stop(now + 1.45); wobble.stop(now + 1.45);
}

// Distant children laughing, "ji ji ji", with an echo. creepy = slower, lower and detuned:
// the same laugh after the plague has taken the city.
export function laugh(creepy = false) {
  if (!isOn()) return;
  const now = ctx.currentTime + 0.05;
  const echo = ctx.createDelay(1);
  echo.delayTime.value = creepy ? 0.33 : 0.22;
  const feedback = ctx.createGain();
  feedback.gain.value = creepy ? 0.5 : 0.35;
  echo.connect(feedback).connect(echo);
  const out = ctx.createGain();
  out.gain.value = creepy ? 0.28 : 0.4;  // peaks ≈ −16 dB: heard over the drone, never louder
  echo.connect(out);
  out.connect(master);
  const kids = creepy ? 2 : 3;
  for (let k = 0; k < kids; k += 1) {
    const start = now + k * (0.18 + Math.random() * 0.15);
    const base = (creepy ? 300 : 520) + Math.random() * 140;
    const syllables = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < syllables; i += 1) {
      const t = start + i * (creepy ? 0.19 : 0.12);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(base * (1 - i * 0.035), t);
      osc.frequency.exponentialRampToValueAtTime(base * (creepy ? 0.7 : 0.85), t + 0.08);
      if (creepy) osc.detune.value = -60 + Math.random() * 40;
      const formant = ctx.createBiquadFilter();
      formant.type = "bandpass"; formant.frequency.value = creepy ? 900 : 1300; formant.Q.value = 1.2;  // the "i" of "ji"
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (creepy ? 0.15 : 0.09));
      osc.connect(formant).connect(g);
      g.connect(out); g.connect(echo);
      osc.start(t); osc.stop(t + 0.2);
    }
  }
}

function noiseBuffer(seconds) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  return buffer;
}
