// Intro globe: the planet turning in the dark while the plague spreads out of
// Manta, then a dive onto the city that hands over to the Leaflet map.
// Needs d3 (geo) and topojson-client as globals; the caller falls back to the
// map alone if they did not load.

const MANTA = [-80.7089, -0.9677]; // lon, lat
const SPIN = 4;                     // degrees per second while idle
const SPREAD_SECONDS = 26;          // time for the plague to cross the planet
// Orthographic scale (px per radian) that matches Leaflet's zoom 5 at the equator.
export const HANDOFF_ZOOM = 5;
const HANDOFF_SCALE = (256 * 2 ** HANDOFF_ZOOM) / (2 * Math.PI);

export function createGlobe(canvas, { reduce = false, worldUrl }) {
  const { d3, topojson } = window;
  if (!d3?.geoOrthographic || !topojson?.feature) throw new Error("d3/topojson not loaded");
  const ctx = canvas.getContext("2d");
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
  const path = d3.geoPath(projection, ctx);
  const graticule = d3.geoGraticule10();
  const sphere = { type: "Sphere" };

  let w = 0;
  let h = 0;
  let stars = [];
  let land = null;
  let borders = null;
  let ecuador = null;
  let infected = [];
  let rotate = [25, 8, 0];          // start over the Atlantic, Manta comes into view
  let scale = 0;
  let mode = "idle";
  let shift = [0, 0];               // the resting globe sits beside the title
  let raf = 0;
  let last = performance.now();
  const born = performance.now();

  const restScale = () => (w > 900 ? Math.min(w * 0.3, h * 0.4) : Math.min(w * 0.46, h * 0.3));
  const restShift = () => (w > 900 ? [w * 0.2, 0] : [0, h * 0.2]);

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    w = innerWidth;
    h = innerHeight;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (mode === "idle") { scale = restScale(); shift = restShift(); }
    stars = Array.from({ length: Math.round((w * h) / 2200) }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.6 + 0.15, tw: Math.random() * 6,
    }));
  }

  // Land points that catch the plague, earlier the closer they are to Manta.
  function seedInfection(landFeature) {
    const pts = [];
    let tries = 0;
    while (pts.length < 900 && tries < 20000) {
      tries += 1;
      const lon = Math.random() * 360 - 180;
      const lat = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI;
      if (lat < -58) continue; // no Antarctica
      if (!d3.geoContains(landFeature, [lon, lat])) continue;
      const dist = d3.geoDistance(MANTA, [lon, lat]) / Math.PI; // 0..1
      pts.push({ p: [lon, lat], at: (dist ** 0.8) * SPREAD_SECONDS + Math.random() * 2.5 });
    }
    // A dense cluster around Manta: the city itself.
    for (let i = 0; i < 70; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() ** 0.6 * 2.2;
      pts.push({ p: [MANTA[0] + 0.6 + Math.cos(a) * r, MANTA[1] + Math.sin(a) * r], at: Math.random() * 2.5 });
    }
    return pts;
  }

  fetch(worldUrl).then((r) => r.json()).then((world) => {
    land = topojson.feature(world, world.objects.land);
    borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
    ecuador = topojson.feature(world, world.objects.countries).features.find((f) => f.properties?.name === "Ecuador") || null;
    infected = seedInfection(land);
  }).catch(() => { /* the globe still turns, just without countries */ });

  function draw(now) {
    const t = (now - born) / 1000;
    const cx = w / 2 + shift[0];
    const cy = h / 2 + shift[1];
    projection.translate([cx, cy]).scale(scale).rotate(rotate);
    ctx.clearRect(0, 0, w, h);

    // Stars (fade out as we dive).
    const starFade = Math.max(0, 1 - (scale - restScale()) / (restScale() * 2));
    if (starFade > 0) {
      for (const s of stars) {
        ctx.globalAlpha = starFade * s.a * (0.7 + 0.3 * Math.sin(t * 1.3 + s.tw));
        ctx.fillStyle = "#cfe3ff";
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }

    // Atmosphere: a red-tinged halo, the planet is sick.
    const halo = ctx.createRadialGradient(cx, cy, scale * 0.92, cx, cy, scale * 1.28);
    halo.addColorStop(0, "rgba(255, 70, 50, 0.38)");
    halo.addColorStop(0.35, "rgba(160, 30, 40, 0.14)");
    halo.addColorStop(1, "rgba(80, 0, 20, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, scale * 1.28, 0, Math.PI * 2); ctx.fill();

    // Ocean.
    const ocean = ctx.createRadialGradient(cx - scale * 0.35, cy - scale * 0.35, scale * 0.1, cx, cy, scale);
    ocean.addColorStop(0, "#123247");
    ocean.addColorStop(1, "#050d16");
    ctx.beginPath(); path(sphere); ctx.fillStyle = ocean; ctx.fill();

    ctx.beginPath(); path(graticule);
    ctx.strokeStyle = "rgba(120, 170, 210, 0.08)"; ctx.lineWidth = 0.7; ctx.stroke();

    if (land) {
      ctx.beginPath(); path(land);
      ctx.fillStyle = "#2a4556"; ctx.fill();
      ctx.strokeStyle = "rgba(170, 215, 240, 0.5)"; ctx.lineWidth = 0.8; ctx.stroke();
    }
    if (borders) {
      ctx.beginPath(); path(borders);
      ctx.strokeStyle = "rgba(170, 215, 240, 0.22)"; ctx.lineWidth = 0.6; ctx.stroke();
    }
    if (ecuador) {
      ctx.beginPath(); path(ecuador);
      ctx.fillStyle = `rgba(255, 59, 59, ${0.22 + 0.1 * Math.sin(t * 2.4)})`; ctx.fill();
      ctx.strokeStyle = "rgba(255, 120, 100, 0.8)"; ctx.lineWidth = 1; ctx.stroke();
    }

    // The plague: red dots lighting up across the land, looping.
    const center = [-rotate[0], -rotate[1]];
    const cycle = t % (SPREAD_SECONDS + 6);
    const dotR = Math.max(1.2, Math.min(3.2, scale / 220));
    for (const d of infected) {
      if (cycle < d.at || d3.geoDistance(d.p, center) > 1.52) continue;
      const pt = projection(d.p);
      if (!pt) continue;
      const age = cycle - d.at;
      if (age < 1) {
        ctx.strokeStyle = `rgba(255, 90, 70, ${0.8 * (1 - age)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(pt[0], pt[1], dotR * (1 + age * 5), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = "rgba(255, 50, 50, 0.85)";
      ctx.beginPath(); ctx.arc(pt[0], pt[1], dotR, 0, Math.PI * 2); ctx.fill();
    }

    // Terminator: a soft night side on the lower right.
    const shade = ctx.createRadialGradient(cx - scale * 0.5, cy - scale * 0.5, scale * 0.4, cx, cy, scale * 1.05);
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.beginPath(); path(sphere); ctx.fillStyle = shade; ctx.fill();

    // Manta beacon.
    if (d3.geoDistance(MANTA, center) < 1.45) {
      const pt = projection(MANTA);
      const pulse = (t * 0.8) % 1;
      ctx.strokeStyle = `rgba(255, 59, 59, ${1 - pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pt[0], pt[1], 6 + pulse * 26, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#ff3b3b";
      ctx.shadowColor = "#ff3b3b"; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(pt[0], pt[1], 5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (mode === "idle") {
        ctx.font = "700 14px 'Barlow Condensed', sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffd9d0";
        ctx.fillText("MANTA · PACIENTE CERO", pt[0] + 14, pt[1]);
      }
    }
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (mode === "idle") rotate = [rotate[0] + SPIN * dt, rotate[1], 0];
    draw(now);
    raf = requestAnimationFrame(frame);
  }

  resize();
  addEventListener("resize", resize);
  if (reduce) {
    rotate = [-MANTA[0], -MANTA[1], 0];
    draw(performance.now());
  } else {
    raf = requestAnimationFrame(frame);
  }

  // Turn to Manta and dive until the globe matches Leaflet at HANDOFF_ZOOM.
  function descend(duration = 2200) {
    mode = "descend";
    const from = [...rotate];
    const target = [-MANTA[0], -MANTA[1], 0];
    let dLon = ((target[0] - from[0]) % 360 + 540) % 360 - 180;
    const s0 = scale;
    const shift0 = [...shift];
    const s1 = HANDOFF_SCALE;
    if (reduce) {
      rotate = target; scale = s1; shift = [0, 0]; draw(performance.now());
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - start) / duration);
        const turn = d3.easeCubicInOut(Math.min(1, k / 0.65));
        rotate = [from[0] + dLon * turn, from[1] + (target[1] - from[1]) * turn, 0];
        shift = [shift0[0] * (1 - turn), shift0[1] * (1 - turn)];
        // Zoom in log space, slow at first, fast at the end: a dive.
        const zoom = d3.easeCubicIn(Math.max(0, (k - 0.2) / 0.8));
        scale = s0 * (s1 / s0) ** zoom;
        if (k >= 1) { rotate = target; scale = s1; shift = [0, 0]; return resolve(); }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  function stop() {
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
  }

  return { descend, stop };
}
