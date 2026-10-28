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
  let embers = [];
  let smoke = [];
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
    // Capped at 1.5: on phones (ratio ~2.6) the full resolution cost a third of the frame rate
    // for detail nobody sees on a moving, glowing globe.
    const ratio = Math.min(1.5, window.devicePixelRatio || 1);
    w = innerWidth;
    h = innerHeight;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (mode === "idle") { scale = restScale(); shift = restShift(); }
    // Ash and embers rising in the background, and smoke drifting over the planet.
    embers = Array.from({ length: Math.round((w * h) / 9000) }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: 0.6 + Math.random() * 1.8,
      v: 6 + Math.random() * 18, sway: Math.random() * Math.PI * 2, hot: Math.random() < 0.55,
    }));
    smoke = Array.from({ length: w < 700 ? 12 : 34 }, () => ({  // fewer clouds on phones: each is a costly gradient
      lon: Math.random() * 360 - 180, lat: Math.random() * 120 - 60,
      size: 0.08 + Math.random() * 0.16, drift: 2 + Math.random() * 5, a: 0.18 + Math.random() * 0.22,
    }));
    stars = Array.from({ length: Math.round((w * h) / 2200) }, () => ({
      x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, a: Math.random() * 0.6 + 0.15, tw: Math.random() * 6,
    }));
  }

  // Land points that catch the plague, earlier the closer they are to Manta. "Is this land?" is read
  // from a small raster of the continents drawn once (a few ms) instead of testing each point against
  // the polygons with d3.geoContains, which froze the intro for 1.5 s on a laptop and ~10 s on a phone.
  function seedInfection(landFeature) {
    const W = 2048, H = 1024;  // 0.18° per pixel
    const mask = document.createElement("canvas");
    mask.width = W; mask.height = H;
    const mctx = mask.getContext("2d", { willReadFrequently: true });
    const flat = d3.geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]);
    mctx.fillStyle = "#fff";
    mctx.beginPath(); d3.geoPath(flat, mctx)(landFeature); mctx.fill();
    const pixels = mctx.getImageData(0, 0, W, H).data;
    const solid = (x, y) => x >= 0 && x < W && y >= 0 && y < H && pixels[(y * W + x) * 4] > 250;
    // Land with a margin: the pixel and its neighbors all solid, so no dot sits on the coastline.
    const isLand = (lon, lat, margin = 1) => {
      const x = Math.floor(((lon + 180) / 360) * W);
      const y = Math.floor(((90 - lat) / 180) * H);
      for (let dy = -margin; dy <= margin; dy += 1) {
        for (let dx = -margin; dx <= margin; dx += 1) if (!solid(x + dx, y + dy)) return false;
      }
      return true;
    };
    const pts = [];
    let tries = 0;
    while (pts.length < 900 && tries < 20000) {
      tries += 1;
      const lon = Math.random() * 360 - 180;
      const lat = (Math.asin(Math.random() * 2 - 1) * 180) / Math.PI;
      if (lat < -58 || !isLand(lon, lat)) continue;  // no Antarctica, no sea
      const dist = d3.geoDistance(MANTA, [lon, lat]) / Math.PI; // 0..1
      pts.push({ p: [lon, lat], at: (dist ** 0.8) * SPREAD_SECONDS + Math.random() * 2.5 });
    }
    // A dense cluster around Manta: the city itself, on land only (Manta sits on the coast).
    for (let i = 0, made = 0; made < 70 && i < 2000; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() ** 0.6 * 1.8;
      const p = [MANTA[0] + Math.cos(a) * r, MANTA[1] + Math.sin(a) * r];
      if (!isLand(p[0], p[1], 2)) continue;  // a wider margin on Manta's coast
      pts.push({ p, at: Math.random() * 2.5 });
      made += 1;
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
    for (const e of embers) {
      const y = (e.y - t * e.v) % h;
      const ey = y < 0 ? y + h : y;
      const ex = e.x + Math.sin(t * 0.8 + e.sway) * 12;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 3 + e.sway);
      ctx.fillStyle = e.hot ? "#ff8a3d" : "#5a4a46";
      ctx.fillRect(ex, ey, e.r, e.r);
    }
    ctx.globalAlpha = 1;

    // Atmosphere: the planet burns — an orange-red halo.
    const halo = ctx.createRadialGradient(cx, cy, scale * 0.92, cx, cy, scale * 1.28);
    halo.addColorStop(0, "rgba(255, 110, 40, 0.5)");
    halo.addColorStop(0.35, "rgba(190, 40, 30, 0.2)");
    halo.addColorStop(1, "rgba(80, 0, 20, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, scale * 1.28, 0, Math.PI * 2); ctx.fill();

    // Ocean.
    const ocean = ctx.createRadialGradient(cx - scale * 0.35, cy - scale * 0.35, scale * 0.1, cx, cy, scale);
    ocean.addColorStop(0, "#2a2226");
    ocean.addColorStop(0.6, "#160d10");
    ocean.addColorStop(1, "#060304");
    ctx.beginPath(); path(sphere); ctx.fillStyle = ocean; ctx.fill();

    ctx.beginPath(); path(graticule);
    ctx.strokeStyle = "rgba(255, 120, 80, 0.05)"; ctx.lineWidth = 0.7; ctx.stroke();

    if (land) {
      ctx.beginPath(); path(land);
      ctx.fillStyle = "#4a3326"; ctx.fill();  // scorched land
      ctx.strokeStyle = `rgba(255, 120, 50, ${0.45 + 0.15 * Math.sin(t * 1.7)})`; ctx.lineWidth = 1; ctx.stroke();  // coasts glowing like embers
    }
    if (borders) {
      ctx.beginPath(); path(borders);
      ctx.strokeStyle = "rgba(255, 150, 90, 0.16)"; ctx.lineWidth = 0.6; ctx.stroke();
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
        ctx.strokeStyle = `rgba(255, 140, 60, ${0.8 * (1 - age)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(pt[0], pt[1], dotR * (1 + age * 5), 0, Math.PI * 2); ctx.stroke();
      }
      // A burning city: a flickering glow with a hot core.
      const flicker = 0.75 + 0.25 * Math.sin(t * 9 + d.at * 13);
      ctx.fillStyle = `rgba(255, 90, 20, ${0.22 * flicker})`;
      ctx.beginPath(); ctx.arc(pt[0], pt[1], dotR * 4 * flicker, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = flicker > 0.9 ? "#ffd36b" : "#ff6a1f";
      ctx.beginPath(); ctx.arc(pt[0], pt[1], dotR * 1.35, 0, Math.PI * 2); ctx.fill();
    }

    // Smoke drifting over the planet (only the clouds on the visible side).
    for (const c of smoke) {
      const p = [c.lon + t * c.drift, c.lat];
      if (d3.geoDistance(p, center) > 1.4) continue;
      const pt = projection(p);
      if (!pt) continue;
      const rad = scale * c.size;
      const g = ctx.createRadialGradient(pt[0], pt[1], 0, pt[0], pt[1], rad);
      g.addColorStop(0, `rgba(30, 24, 26, ${c.a})`);
      g.addColorStop(1, "rgba(30, 24, 26, 0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pt[0], pt[1], rad, 0, Math.PI * 2); ctx.fill();
    }

    // Terminator: a soft night side on the lower right.
    const shade = ctx.createRadialGradient(cx - scale * 0.5, cy - scale * 0.5, scale * 0.4, cx, cy, scale * 1.05);
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.42)");
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
