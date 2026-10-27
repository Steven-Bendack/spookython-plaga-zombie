// Plaga Zombie · Manta — UI. Plain ES module, no build step.
import * as sound from "./sound.js";
import { initGame } from "./game.js";
const API = window.PLAGA_API || "/api";

const COLORS = {
  none: "#8f8580", random: "#c9a0ff", strategy: "#a8d672", zombie: "#ff3b3b", tie: "#4a3f48",
  bitten: "#ffc94d", gone: "#6f6480", vax: "#38e8ff", pumpkin: "#ff7518", ink: "#efe6d6", grid: "#2a2229",
};
const STRATEGY_COLORS = { ring_hubs: "#a8d672", ring: "#38e8ff", degree: "#ffb347", acquaintance: "#c9a0ff" };
const FIELDS = ["r0", "doses_per_day", "vaccine_efficacy", "seed_location", "vaccine_start_day",
  "detection_prob", "detection_delay", "initial_cases", "runs", "strategy", "seed",
  "latent_mean", "infectious_mean", "days",
  "close_market", "close_schools", "closure_trigger", "budget", "market_cost", "school_cost"];
const CHECKBOXES = new Set(["close_market", "close_schools"]);
const MANTA = [-0.9677, -80.7089];
const ECUADOR = [-1.6, -78.4];

const $ = (sel) => document.querySelector(sel);
const form = $("#form");
const state = {
  meta: null, defaults: null, map: null, jury: null, real: null, scenarios: null, last: null,
  charts: {}, juryView: "auto",
};

// Thousands with a thin space (12 345): avoids "3.922" being read as a decimal.
const fmt = (x) => Math.round(x).toLocaleString("en-US").replace(/,/g, " ");
const pct = (x) => `${Math.round(x * 100)} %`;
const dec = (x, d = 1) => x.toFixed(d).replace(".", ",");

if (window.Chart) {
  Chart.defaults.color = "#a89c95";
  Chart.defaults.borderColor = COLORS.grid;
  Chart.defaults.font.family = "IBM Plex Sans";
}

// ---------- bootstrapping ----------

async function init() {
  initIntro();
  initGame();
  initMap();
  const [meta, dmap, jury, real, scenarios] = await Promise.all([
    getJSON(`${API}/meta`),
    getJSON("data/decision_map.json").catch(() => null),
    getJSON("data/jury.json").catch(() => null),
    getJSON("data/real_covid.json").catch(() => null),
    getJSON("data/scenarios.json").catch(() => null),
  ]);
  Object.assign(state, { meta, defaults: meta.defaults, map: dmap, jury, real, scenarios });

  fillSelect($("#seedLocation"), meta.seed_locations);
  fillSelect($("#strategy"), [{ value: "auto", label: "Automática (torneo)" }, ...meta.strategies]);
  renderPresets(meta.presets);

  const fromUrl = Object.fromEntries(new URLSearchParams(location.search));
  setForm({ ...meta.defaults, ...fromUrl });
  updateOutputs();
  renderJury(jury);
  renderDecisionMap(dmap);
  renderReal(real);
  renderScenarios(scenarios);

  form.addEventListener("input", () => { updateOutputs(); clearPresetSelection(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); runSimulation(); });
  $("#dice").addEventListener("click", () => { form.seed.value = Math.floor(Math.random() * 1e6); updateOutputs(); });
  $("#copyLink").addEventListener("click", copyLink);
  $("#runJury").addEventListener("click", runJury);
  segmented("#juryView", "view", (v) => { state.juryView = v; renderJury(state.jury); });

  if (fromUrl.seed) runSimulation();
}

async function getJSON(url, body) {
  const res = await fetch(url, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Error ${res.status}`);
  return data;
}

function fillSelect(select, options) {
  select.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
}

function segmented(groupSel, attr, onChange) {
  const group = $(groupSel);
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(`[data-${attr}]`);
    if (!btn) return;
    group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    onChange(btn.dataset[attr]);
  });
}

// ---------- intro and sound ----------

function initIntro() {
  const intro = $("#intro");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stopAnim = introAnimation($("#introCanvas"), reduce);
  const enter = async (withSound) => {
    if (withSound) {
      try { await sound.start(); } catch { /* audio blocked: continue in silence */ }
    }
    updateSoundButton();
    intro.classList.add("is-leaving");
    setTimeout(() => { intro.hidden = true; stopAnim(); }, reduce ? 0 : 700);
    $("#run").focus({ preventScroll: true });
  };
  // Entering always starts the soundtrack; it can only be turned down in Settings.
  $("#enterSound").addEventListener("click", () => enter(true));
  $("#enterSound").focus();
  initSettings();
}

function initSettings() {
  const dialog = $("#settings");
  const prefs = loadPrefs();
  $("#setVolume").value = prefs.volume;
  $("#volOut").textContent = pct(prefs.volume);
  $("#setMotion").checked = prefs.motion;
  document.body.classList.toggle("calm", !prefs.motion);
  sound.setVolume(prefs.volume);
  $("#settingsBtn").addEventListener("click", () => {
    $("#setSound").checked = sound.isOn();
    dialog.showModal();
  });
  $("#setSound").addEventListener("change", async (e) => {
    if (e.target.checked) await sound.start(); else sound.stop();
  });
  $("#setVolume").addEventListener("input", (e) => {
    const v = +e.target.value;
    $("#volOut").textContent = pct(v);
    sound.setVolume(v);
    savePrefs({ volume: v });
  });
  $("#setMotion").addEventListener("change", (e) => {
    document.body.classList.toggle("calm", !e.target.checked);
    savePrefs({ motion: e.target.checked });
  });
}

function loadPrefs() {
  const defaults = { volume: 0.8, motion: true };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem("plaga-prefs") || "{}") }; } catch { return defaults; }
}

function savePrefs(change) {
  try { localStorage.setItem("plaga-prefs", JSON.stringify({ ...loadPrefs(), ...change })); } catch { /* private mode */ }
}

function updateSoundButton() {}

// Intro background: houses of a dark city; a few catch the plague and it spreads.
function introAnimation(canvas, reduce) {
  const ctx = canvas.getContext("2d");
  let raf = 0;
  let people = [];
  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = Math.round((innerWidth * innerHeight) / 2600);
    people = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight, bitten: -1,
    }));
    for (let i = 0; i < 3; i += 1) people[Math.floor(Math.random() * count)].bitten = 0;
  };
  resize();
  addEventListener("resize", resize);
  let t = 0;
  const frame = () => {
    t += 1;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const sick = people.filter((p) => p.bitten >= 0 && t - p.bitten < 260);
    for (const p of people) {
      if (p.bitten < 0 && Math.random() < 0.02) {
        for (const z of sick) {
          if (Math.abs(z.x - p.x) < 46 && Math.abs(z.y - p.y) < 46) { p.bitten = t; break; }
        }
      }
      const age = p.bitten < 0 ? -1 : t - p.bitten;
      if (age < 0) ctx.fillStyle = "rgba(239, 230, 214, 0.18)";
      else if (age < 40) ctx.fillStyle = "#ffc94d";
      else if (age < 260) ctx.fillStyle = `rgba(255, 59, 59, ${0.9 - 0.4 * Math.sin(t / 9 + p.x)})`;
      else ctx.fillStyle = "rgba(120, 100, 110, 0.35)";
      ctx.fillRect(p.x, p.y, 2.4, 2.4);
    }
    if (sick.length === 0) resize();
    if (!reduce) raf = requestAnimationFrame(frame);
  };
  frame();
  return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); };
}

// ---------- form ----------

function readForm() {
  const data = Object.fromEntries(new FormData(form));
  const out = {};
  for (const key of FIELDS) {
    if (CHECKBOXES.has(key)) { out[key] = form.elements[key].checked; continue; }
    const raw = data[key];
    if (raw === undefined || raw === "") continue;
    out[key] = ["seed_location", "strategy"].includes(key) ? raw : Number(raw);
  }
  return out;
}

function setForm(values) {
  for (const key of FIELDS) {
    if (values[key] === undefined || !form.elements[key]) continue;
    if (CHECKBOXES.has(key)) form.elements[key].checked = values[key] === true || values[key] === "true";
    else form.elements[key].value = values[key];
  }
}

function updateOutputs() {
  const v = readForm();
  const scale = state.meta?.manta_scale ?? 1;
  $("#r0Out").textContent = dec(v.r0, 2);
  $("#dosesOut").textContent = v.doses_per_day;
  $("#dosesHelp").textContent = `≈ ${fmt(v.doses_per_day * scale)} dosis diarias en Manta (${dec(100 * v.doses_per_day / (state.defaults?.population || 1))} % de la población).`;
  $("#effOut").textContent = pct(v.vaccine_efficacy);
  $("#latentOut").textContent = dec(v.latent_mean);
  $("#infOut").textContent = dec(v.infectious_mean);
  $("#startOut").textContent = v.vaccine_start_day;
  $("#detOut").textContent = pct(v.detection_prob);
  $("#delayOut").textContent = v.detection_delay;
  $("#trigOut").textContent = v.closure_trigger;
  $("#mktCost").textContent = fmt(v.market_cost);
  $("#schCost").textContent = fmt(v.school_cost);
  showInstantAnswer(v);
}

function renderPresets(presets) {
  const box = $("#presets");
  const d = state.defaults;
  const apply = {
    base: () => setForm(d),
    double_r0: () => setForm({ r0: +(d.r0 * 2).toFixed(2) }),
    half_doses: () => setForm({ doses_per_day: Math.max(1, Math.round(d.doses_per_day / 2)) }),
    market: () => setForm({ seed_location: "market" }),
    weak_vaccine: () => setForm({ vaccine_efficacy: 0.5 }),
  };
  box.innerHTML = Object.entries(presets).map(([key, p]) =>
    `<button type="button" class="chip" data-preset="${key}" aria-pressed="false">${p.label}</button>`).join("");
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    apply[btn.dataset.preset]?.();
    updateOutputs();
    clearPresetSelection();
    btn.setAttribute("aria-pressed", "true");
  });
}

function clearPresetSelection() {
  document.querySelectorAll(".chip[aria-pressed='true']").forEach((b) => b.setAttribute("aria-pressed", "false"));
}

// ---------- instant answer from the precomputed decision map ----------

function lookupCell(v) {
  if (!state.map) return null;
  const factor = v.doses_per_day / Math.max(state.map.base.doses_per_day, 1);
  let best = null;
  let bestD = Infinity;
  for (const c of state.map.cells) {
    const d = Math.abs(c.r0 - v.r0) + Math.abs(c.dose_factor - factor) / 0.5
      + Math.abs(c.vaccine_efficacy - v.vaccine_efficacy) / 0.2
      + (c.seed_location === v.seed_location ? 0 : 0.5);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function showInstantAnswer(v) {
  const box = $("#instant");
  const cell = lookupCell(v);
  if (!cell) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `Respuesta inmediata (mapa precalculado, ${state.map.runs_per_cell} corridas): <strong>${labelOf(cell.best)}</strong>, gana a Azar en ${pct(cell.win_rate_vs_random)} de ellas. Recomendar lo afina con tu semilla.`;
}

function labelOf(name) {
  const s = state.meta?.strategies.find((x) => x.value === name);
  return s ? s.label : name;
}

// ---------- simulation ----------

async function runSimulation() {
  const btn = $("#run");
  btn.disabled = true;
  btn.textContent = "Corriendo las simulaciones…";
  $("#results").classList.add("is-loading");
  const started = performance.now();
  try {
    const data = await getJSON(`${API}/simulate`, readForm());
    state.last = data;
    renderResult(data, (performance.now() - started) / 1000);
    history.replaceState(null, "", `?${new URLSearchParams(readForm())}`);
  } catch (err) {
    $("#runHint").textContent = `No se pudo simular: ${err.message}. Revisa los valores e inténtalo de nuevo.`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Recomendar";
    $("#results").classList.remove("is-loading");
  }
}

function renderResult(data, seconds) {
  const best = data.candidates[0];
  const scale = data.manta_scale;
  $("#empty").hidden = true;
  $("#verdictBody").hidden = false;
  $("#bestName").textContent = best.label;
  $("#recText").textContent = data.recommendation_text;
  $("#savedNone").textContent = fmt(data.saved_vs_none.mean);
  $("#savedNoneRange").textContent = `90 % de las corridas: ${fmt(data.saved_vs_none.p5)} a ${fmt(data.saved_vs_none.p95)}`;
  $("#savedRandom").textContent = fmt(data.saved_vs_random.mean);
  $("#savedRandomRange").textContent = `IC 95 % del promedio: ${fmt(data.saved_vs_random.ci95_low)} a ${fmt(data.saved_vs_random.ci95_high)}`;
  $("#savedManta").textContent = fmt(data.saved_vs_none.mean * scale);
  $("#scale").textContent = dec(scale);
  $("#wasted").textContent = `Dosis perdidas en Mordidos invisibles: ${pct(data.wasted_doses.share)}`;
  renderStrip(data.saved_vs_random.per_run, data.config.runs);
  renderCurves(data);
  renderTable(data);
  renderCertificate(data, seconds);
  renderPlans(data.closure_plans);
  loadMapRun(data);
}

function renderStrip(perRun, runs) {
  const strip = $("#strip");
  const wins = perRun.filter((x) => x > 0).length;
  const losses = perRun.filter((x) => x < 0).length;
  $("#stripTitle").textContent = `Contra Azar, semilla por semilla: gana en ${wins} de ${runs}`;
  strip.setAttribute("aria-label", `Gana en ${wins}, empata en ${runs - wins - losses} y pierde en ${losses} de ${runs} corridas`);
  strip.innerHTML = perRun.map((x, i) => {
    const cls = x > 0 ? "win" : x < 0 ? "loss" : "tie";
    return `<span class="tick tick--${cls}" style="animation-delay:${Math.min(i * 6, 600)}ms" title="Corrida ${i + 1}: ${x > 0 ? "+" : ""}${x} personas"></span>`;
  }).join("");
}

function renderCurves(data) {
  const p = data.policies;
  const days = p.none.curves.I.map((_, i) => i);
  const series = [["none", p.none], ["random", p.random], ["strategy", p.strategy]];
  const datasets = [];
  for (const [key, pol] of series) {
    const color = COLORS[key];
    datasets.push({ label: `${pol.label} · banda`, data: pol.curves.I_p95, borderWidth: 0, pointRadius: 0, fill: false, _band: true });
    datasets.push({ label: `${pol.label} · banda inferior`, data: pol.curves.I_p5, borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: hexA(color, 0.14), _band: true });
    datasets.push({ label: pol.label, data: pol.curves.I, borderColor: color, borderWidth: key === "strategy" ? 3 : 2,
      pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color, fill: false, tension: 0.3 });
  }
  drawChart("curveChart", {
    type: "line",
    data: { labels: days, datasets },
    options: chartOptions({
      x: { title: { display: true, text: "Día" }, ticks: { maxTicksLimit: 10 } },
      y: { title: { display: true, text: "Zombies (personas simuladas)" }, beginAtZero: true },
    }, { filter: (item) => !item.text.includes("banda") }),
  });
}

function renderTable(data) {
  const rows = [];
  const base = (key, label, s) => `<tr class="is-baseline"><td><span class="dot" style="background:${COLORS[key]}"></span>${label}</td>
    <td class="num">${fmt(s.infected.mean)}<span class="range">${fmt(s.infected.p5)}–${fmt(s.infected.p95)}</span></td>
    <td class="num">${key === "none" ? "—" : fmt(data.random_vs_none.mean)}</td><td class="num">—</td><td class="num">—</td>
    <td class="num">${key === "none" ? "—" : pct(s.wasted_share)}</td></tr>`;
  rows.push(base("none", "Nada", data.policies.none));
  rows.push(base("random", "Azar", data.policies.random));
  data.candidates.forEach((c, i) => {
    rows.push(`<tr class="${i === 0 ? "is-best" : ""}">
      <td><span class="dot" style="background:${STRATEGY_COLORS[c.name] || COLORS.strategy}"></span><strong>${c.label}</strong>${i === 0 ? " · recomendada" : ""}<span class="desc">${c.description}</span></td>
      <td class="num">${fmt(c.summary.infected.mean)}<span class="range">${fmt(c.summary.infected.p5)}–${fmt(c.summary.infected.p95)}</span></td>
      <td class="num">${fmt(c.vs_none.mean)}<span class="range">${fmt(c.vs_none.p5)}–${fmt(c.vs_none.p95)}</span></td>
      <td class="num">${fmt(c.vs_random.mean)}<span class="range">${fmt(c.vs_random.p5)}–${fmt(c.vs_random.p95)}</span></td>
      <td class="num">${pct(c.vs_random.win_rate)}</td>
      <td class="num">${pct(c.summary.wasted_share)}</td></tr>`);
  });
  $("#table tbody").innerHTML = rows.join("");
}

function renderCertificate(data, seconds) {
  const c = data.certificate;
  $("#certificate").hidden = false;
  $("#certHash").textContent = c.config_hash;
  $("#certSeed").textContent = c.seed;
  $("#certCity").textContent = c.city_seed;
  $("#certEngine").textContent = c.engine_version;
  $("#certCommit").textContent = c.commit;
  $("#certTime").textContent = `${dec(seconds)} s`;
}

function renderPlans(cp) {
  const panel = $("#plansPanel");
  if (!cp) { panel.hidden = true; return; }
  panel.hidden = false;
  $("#plansText").textContent = cp.text;
  $("#plansTable tbody").innerHTML = cp.plans.map((p) => `<tr class="${p.label === cp.best ? "is-best" : ""}">
      <td>${p.label}${p.label === cp.best ? " · recomendado" : ""}</td>
      <td class="num">${fmt(p.infected_mean)}</td>
      <td class="num">${fmt(p.saved_vs_none)}</td>
      <td class="num">${p.market ? `mercado ${dec(p.market_days)}` : ""}${p.market && p.schools ? " · " : ""}${p.schools ? `colegios ${dec(p.schools_days)}` : ""}${!p.market && !p.schools ? "—" : ""}</td>
      <td class="num">${fmt(p.spent)}${cp.budget > 0 ? ` / ${fmt(cp.budget)}` : ""}</td></tr>`).join("");
}

async function copyLink() {
  const url = `${location.origin}${location.pathname}?${new URLSearchParams(readForm())}`;
  try {
    await navigator.clipboard.writeText(url);
    $("#copyLink").textContent = "Enlace copiado";
  } catch {
    prompt("Copia este enlace:", url);
  }
  setTimeout(() => { $("#copyLink").textContent = "Copiar enlace para repetir"; }, 2000);
}

// ---------- the map ----------

const mapState = {
  leaflet: null, tiles: {}, canvas: null, ctx: null, pin: null, labels: [],
  streetCanvas: null, streetCtx: null, streets: null,
  data: null, run: null, policy: "none", day: 0, lastDay: 0, playing: false, raf: 0, flown: false,
};

function initMap() {
  if (!window.L) return;
  const map = L.map("map", { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    .setView(ECUADOR, 6);
  const esri = (path) => `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`;
  const attribution = "Mapa &copy; Esri, HERE, Garmin, &copy; colaboradores de OpenStreetMap";
  mapState.tiles.dark = L.layerGroup([
    L.tileLayer(esri("Canvas/World_Dark_Gray_Base"), { maxZoom: 16, attribution }),
    L.tileLayer(esri("Canvas/World_Dark_Gray_Reference"), { maxZoom: 16 }),
  ]).addTo(map);
  mapState.tiles.sat = L.layerGroup([
    L.tileLayer(esri("World_Imagery"), { maxZoom: 18, attribution: "Imágenes &copy; Esri, Maxar, Earthstar Geographics" }),
    L.tileLayer(esri("Reference/World_Boundaries_and_Places"), { maxZoom: 18 }),
  ]);
  mapState.pin = L.marker(MANTA, { icon: L.divIcon({ className: "", html: '<div class="manta-pin"></div>', iconSize: [18, 18] }) })
    .addTo(map).bindTooltip("Manta", { permanent: true, direction: "right", className: "barrio-label" });

  // Two canvases over the map: Manta's streets (redrawn when the map moves)
  // and the people (redrawn every animation frame).
  const layer = (z) => {
    const c = document.createElement("canvas");
    Object.assign(c.style, { position: "absolute", inset: "0", zIndex: z, pointerEvents: "none" });
    map.getContainer().appendChild(c);
    return c;
  };
  mapState.streetCanvas = layer(440);
  mapState.streetCtx = mapState.streetCanvas.getContext("2d");
  mapState.canvas = layer(450);
  mapState.ctx = mapState.canvas.getContext("2d");
  mapState.leaflet = map;
  const redraw = () => { drawStreets(); drawPeople(); };
  map.on("move zoom resize", redraw);
  new ResizeObserver(() => { map.invalidateSize(); redraw(); }).observe(map.getContainer());
  getJSON("data/manta_streets.json").then((d) => { mapState.streets = d.lines; drawStreets(); }).catch(() => {});

  segmented("#mapPolicy", "policy", (p) => { mapState.policy = p; prepareRun(); drawPeople(); });
  segmented("#mapcard .segmented--small", "tiles", (t) => {
    Object.values(mapState.tiles).forEach((l) => map.removeLayer(l));
    mapState.tiles[t].addTo(map);
  });
  $("#play").addEventListener("click", () => (mapState.playing ? pause() : play()));
  $("#daySlider").addEventListener("input", (e) => { pause(); mapState.day = +e.target.value; drawPeople(); });
}

function loadMapRun(data) {
  mapState.data = data;
  $("#mapRun").textContent = `Corrida ${data.map.run}`;
  mapState.day = 0;
  prepareRun();
  const map = mapState.leaflet;
  if (!map) return;
  $("#play").disabled = false;
  $("#daySlider").disabled = false;
  $("#progress").hidden = false;
  if (!mapState.flown) {
    mapState.flown = true;
    map.removeLayer(mapState.pin);
    const zoom = map.getSize().x < 600 ? 12 : 13;
    map.flyTo([-0.975, -80.735], zoom, { duration: 3.2 });
    map.once("moveend", play);
  } else {
    play();
  }
}

function showBarrioLabels(barrios) {
  mapState.labels.forEach((l) => mapState.leaflet.removeLayer(l));
  mapState.labels = barrios.map((b) => L.tooltip({ permanent: true, direction: "center", className: "barrio-label" })
    .setLatLng([b.lat, b.lon]).setContent(b.name).addTo(mapState.leaflet));
}

function prepareRun() {
  const data = mapState.data;
  if (!data) return;
  const cfg = data.config;
  const run = data.map[mapState.policy];
  const toLL = (p) => [p[0] / 1e4, p[1] / 1e4, p[2]];
  const bitten = run.bitten.map(toLL);
  const vaccinated = run.vaccinated.map(toLL);
  const sick = cfg.latent_mean + cfg.infectious_mean;
  const lastBite = bitten.reduce((m, p) => Math.max(m, p[2]), 0);
  mapState.run = {
    bitten, vaccinated, latent: cfg.latent_mean, sick, label: run.label, counts: run.counts, closed: run.closed,
    events: buildEvents(bitten, data, run.label),
  };
  mapState.lastDay = Math.min(cfg.days, Math.ceil(lastBite + sick + 2));
  $("#daySlider").max = mapState.lastDay;
  mapState.day = Math.min(mapState.day, mapState.lastDay);
}

function nearestBarrio(lat, lon, barrios) {
  let best = barrios[0];
  let bestD = Infinity;
  for (const b of barrios) {
    const d = (b.lat - lat) ** 2 + (b.lon - lon) ** 2;
    if (d < bestD) { bestD = d; best = b; }
  }
  return best.name;
}

// Headlines of the run, generated from what actually happened in it.
function buildEvents(bitten, data, label) {
  const cfg = data.config;
  const barrios = data.map.barrios;
  const n = cfg.population;
  const scale = data.manta_scale;
  const events = [];
  const byDay = [...bitten].sort((a, b) => a[2] - b[2]);
  const first = byDay.filter((p) => p[2] === 0).map((p) => nearestBarrio(p[0], p[1], barrios));
  events.push({ day: 0, text: `Día 0: ${first.length} personas mordidas en ${[...new Set(first)].join(", ")}. Nadie lo sabe todavía.` });

  const reached = new Set(first);
  for (const p of byDay) {
    const b = nearestBarrio(p[0], p[1], barrios);
    if (!reached.has(b)) {
      reached.add(b);
      events.push({ day: p[2], text: `Día ${p[2]}: la plaga llega a ${b}.` });
    }
  }
  if (mapState.policy !== "none" && cfg.doses_per_day > 0) {
    events.push({ day: cfg.vaccine_start_day, text: `Día ${cfg.vaccine_start_day}: llegan las vacunas (${cfg.doses_per_day} al día). El comité aplica «${label}».` });
  }
  const closedSeries = Array.isArray(data.map[mapState.policy].closed) ? data.map[mapState.policy].closed : [];
  const places = ["el mercado central", "los colegios"];
  for (let d = 1; d < closedSeries.length; d += 1) {
    for (const k of [0, 1]) {
      if (closedSeries[d][k] && !closedSeries[d - 1][k]) events.push({ day: d, text: `Día ${d}: el comité cierra ${places[k]}.` });
      if (!closedSeries[d][k] && closedSeries[d - 1][k]) events.push({ day: d, text: `Día ${d}: reabren ${places[k]}.` });
    }
  }
  const marks = [0.01, 0.1, 0.25, 0.5];
  let k = 0;
  byDay.forEach((p, i) => {
    while (k < marks.length && i + 1 >= marks[k] * n) {
      events.push({ day: p[2], text: `Día ${p[2]}: ya van ${fmt(i + 1)} mordidos, el ${pct(marks[k])} de la ciudad (≈ ${fmt((i + 1) * scale)} mantenses).` });
      k += 1;
    }
  });
  const total = bitten.length;
  const lastBite = byDay.length ? byDay[byDay.length - 1][2] : 0;
  const end = Math.min(cfg.days, Math.ceil(lastBite + cfg.latent_mean + cfg.infectious_mean));
  events.push({ day: end, text: `Día ${end}: el último zombi fue exorcizado. En total ${fmt(total)} mordidos (≈ ${fmt(total * scale)} en Manta) con «${label}».` });
  return events.sort((a, b) => a.day - b.day);
}

function play() {
  if (!mapState.run) return;
  if (mapState.day >= mapState.lastDay) mapState.day = 0;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("calm")) {
    mapState.day = mapState.lastDay;
    drawPeople();
    return;
  }
  mapState.playing = true;
  clearTimeout(mapState.idle);
  $("#play").textContent = "❚❚ Pausa";
  let last = performance.now();
  const step = (now) => {
    const speed = +$("#speed").value; // days per second
    mapState.day = Math.min(mapState.lastDay, mapState.day + ((now - last) / 1000) * speed);
    last = now;
    drawPeople();
    if (mapState.day >= mapState.lastDay) return pause();
    mapState.raf = requestAnimationFrame(step);
  };
  cancelAnimationFrame(mapState.raf);
  mapState.raf = requestAnimationFrame(step);
}

function pause() {
  mapState.playing = false;
  cancelAnimationFrame(mapState.raf);
  $("#play").textContent = "▶ Reproducir";
  idle();
}

// While paused, zombies keep breathing (a few frames per second is enough).
function idle() {
  clearTimeout(mapState.idle);
  if (mapState.playing || matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.classList.contains("calm")) return;
  drawPeople();
  mapState.idle = setTimeout(idle, 120);
}

function fitCanvas(canvas, ctx) {
  const size = mapState.leaflet.getSize();
  const ratio = window.devicePixelRatio || 1;
  if (canvas.width !== size.x * ratio || canvas.height !== size.y * ratio) {
    canvas.width = size.x * ratio;
    canvas.height = size.y * ratio;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, size.x, size.y);
  return size;
}

// Manta's real streets (OpenStreetMap), only once we are close enough to see them.
function drawStreets() {
  const { streetCanvas: canvas, streetCtx: ctx, leaflet: map, streets } = mapState;
  if (!canvas || !map) return;
  fitCanvas(canvas, ctx);
  if (!streets || map.getZoom() < 11) return;
  const bounds = map.getBounds().pad(0.1);
  for (const kind of ["street", "main"]) {
    ctx.strokeStyle = kind === "main" ? "rgba(232, 210, 170, 0.55)" : "rgba(232, 210, 170, 0.22)";
    ctx.lineWidth = kind === "main" ? 1.6 : 0.8;
    ctx.beginPath();
    for (const line of streets) {
      if (line.k !== kind) continue;
      const first = line.p[0];
      if (!bounds.contains(first) && !bounds.contains(line.p[line.p.length - 1])) continue;
      line.p.forEach((ll, i) => {
        const pt = map.latLngToContainerPoint(ll);
        if (i) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y);
      });
    }
    ctx.stroke();
  }
}

function drawPeople() {
  const { canvas, ctx, leaflet: map, run } = mapState;
  if (!canvas || !map) return;
  fitCanvas(canvas, ctx);
  if (!run) return;

  const day = mapState.day;
  const now = performance.now() / 1000;
  const zoom = map.getZoom();
  const r = Math.max(1.4, Math.min(5, 1.4 + (zoom - 11) * 0.8));
  const outline = "rgba(10, 6, 12, 0.9)";
  let zombies = 0;
  let bittenSoFar = 0;
  let vax = 0;

  const dot = (pt, radius, fill) => {
    ctx.beginPath(); ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = Math.max(0.8, radius * 0.35); ctx.strokeStyle = outline; ctx.stroke();
  };

  // Exorcised first (bottom), then vaccinated, bitten, zombies on top.
  const later = { vax: [], bitten: [], zombie: [], ripple: [] };
  for (let i = 0; i < run.bitten.length; i += 1) {
    const p = run.bitten[i];
    const age = day - p[2];
    if (age < 0) continue;
    bittenSoFar += 1;
    const pt = map.latLngToContainerPoint([p[0], p[1]]);
    if (age < 1.5) later.ripple.push([pt, age]);
    if (age < run.latent) later.bitten.push(pt);
    else if (age < run.sick) { zombies += 1; later.zombie.push([pt, i]); }
    else {
      const fade = Math.min(1, (age - run.sick) / 7);
      ctx.fillStyle = `rgba(${Math.round(160 - 50 * fade)}, ${Math.round(80 + 25 * fade)}, ${Math.round(90 + 35 * fade)}, ${0.75 - 0.35 * fade})`;
      ctx.fillRect(pt.x - r * 0.45, pt.y - r * 0.45, r * 0.9, r * 0.9);
    }
  }
  for (const p of run.vaccinated) {
    if (p[2] > day) continue;
    vax += 1;
    later.vax.push(map.latLngToContainerPoint([p[0], p[1]]));
  }
  // Vaccinated: a small cyan "+".
  const arm = r * 0.95;
  ctx.lineCap = "round";
  ctx.strokeStyle = outline; ctx.lineWidth = r * 0.9;
  ctx.beginPath();
  for (const pt of later.vax) { ctx.moveTo(pt.x - arm, pt.y); ctx.lineTo(pt.x + arm, pt.y); ctx.moveTo(pt.x, pt.y - arm); ctx.lineTo(pt.x, pt.y + arm); }
  ctx.stroke();
  ctx.strokeStyle = "#38e8ff"; ctx.lineWidth = r * 0.45;
  ctx.stroke();
  // Bitten: amber dots.
  for (const pt of later.bitten) dot(pt, r * 0.8, "#ffc94d");
  // Ripples where someone was just bitten.
  ctx.lineWidth = 1.4;
  for (const [pt, age] of later.ripple) {
    ctx.strokeStyle = `rgba(255, 201, 77, ${0.85 * (1 - age / 1.5)})`;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r * (1.3 + age * 5), 0, Math.PI * 2); ctx.stroke();
  }
  // Zombies: red with a breathing halo, always on top.
  for (const [pt, i] of later.zombie) {
    const pulse = 1 + 0.3 * Math.sin(now * 3 + i);
    ctx.fillStyle = "rgba(255, 59, 59, 0.16)";
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 2.3 * pulse, 0, Math.PI * 2); ctx.fill();
    dot(pt, r * 1.05, "#ff3b3b");
  }
  drawBarrioNames(ctx, map);

  const n = mapState.data.config.population;
  $("#hudDay").textContent = Math.floor(day);
  $("#hudZombies").textContent = fmt(zombies);
  $("#hudBitten").textContent = fmt(bittenSoFar);
  $("#hudVax").textContent = fmt(vax);
  $("#hudCity").textContent = pct(bittenSoFar / n);
  $("#daySlider").value = Math.floor(day);
  drawProgress(day);
  const closedToday = (run.closed && run.closed[Math.max(0, Math.min(Math.floor(day) || 0, run.closed.length - 1))]) || [0, 0];
  const badge = $("#hudClosed");
  const names = [closedToday[0] ? "Mercado cerrado" : "", closedToday[1] ? "Colegios cerrados" : ""].filter(Boolean);
  badge.hidden = names.length === 0;
  badge.textContent = names.join(" · ");
  sound.setTension((zombies / n) * 10);
  const ev = run.events.filter((e) => e.day <= day).at(-1);
  const ticker = $("#ticker");
  if (ev && ticker.textContent !== ev.text) {
    ticker.textContent = ev.text;
    ticker.classList.remove("is-new");
    void ticker.offsetWidth;
    ticker.classList.add("is-new");
    if (mapState.playing) sound.bite();
  }
}

// How the city is doing on this day of the replayed run (exact counts).
// Barrio names on top of the people, so the outbreak never hides them.
function drawBarrioNames(ctx, map) {
  const barrios = mapState.data?.map.barrios;
  if (!barrios || map.getZoom() < 12) return;
  ctx.font = "600 11px 'IBM Plex Mono', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const b of barrios) {
    const pt = map.latLngToContainerPoint([b.lat, b.lon]);
    const text = b.name.toUpperCase();
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = "rgba(15, 12, 16, 0.78)";
    ctx.fillRect(pt.x - w / 2, pt.y - 9, w, 18);
    ctx.fillStyle = "#efe6d6";
    ctx.fillText(text, pt.x, pt.y + 0.5);
  }
}

function drawProgress(day) {
  const run = mapState.run;
  if (!run?.counts) return;
  const counts = run.counts;
  const d = Math.max(0, Math.min(Math.floor(day) || 0, counts.length - 1));
  if (!Array.isArray(counts[d])) return;
  const [S, E, I, R, V] = counts[d];
  const n = S + E + I + R + V;
  const parts = [["sano", S], ["vax", V], ["bitten", E], ["zombie", I], ["gone", R]];
  const segs = $("#progressBar").children;
  parts.forEach(([, v], i) => { segs[i].style.width = `${(100 * v) / n}%`; });
  const names = { sano: "Sanos", vax: "Vacunados", bitten: "Mordidos", zombie: "Zombies", gone: "Exorcizados" };
  $("#progressLegend").innerHTML = parts.map(([k, v]) =>
    `<span class="pl pl--${k}"><i></i>${names[k]} <strong>${pct(v / n)}</strong></span>`).join("");
  $("#progressBar").setAttribute("aria-label", parts.map(([k, v]) => `${names[k]} ${pct(v / n)}`).join(", "));

  // Timeline: zombies per day of this run, with the current day marked.
  const canvas = $("#timeline");
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * ratio) { canvas.width = w * ratio; canvas.height = h * ratio; }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const last = mapState.lastDay || counts.length - 1;
  const max = Math.max(1, ...counts.slice(0, last + 1).map((c) => c[2] + c[1]));
  const x = (i) => (i / last) * w;
  const y = (v) => h - 2 - (v / max) * (h - 6);
  ctx.fillStyle = "rgba(255, 59, 59, 0.16)";
  ctx.beginPath(); ctx.moveTo(0, h);
  for (let i = 0; i <= last; i += 1) ctx.lineTo(x(i), y(counts[i][2]));
  ctx.lineTo(x(last), h); ctx.fill();
  ctx.strokeStyle = "#ff3b3b"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i <= last; i += 1) { if (i) ctx.lineTo(x(i), y(counts[i][2])); else ctx.moveTo(x(i), y(counts[i][2])); }
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 59, 59, 0.55)";
  ctx.fillRect(0, 0, x(Math.min(day, last)), 2);
  ctx.strokeStyle = "#ff7518"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x(Math.min(day, last)), 0); ctx.lineTo(x(Math.min(day, last)), h); ctx.stroke();
}

// ---------- real data and fiction ----------

function renderReal(real) {
  if (!real) return;
  const weeks = real.weeks;
  const peak = Math.max(...real.excess);
  const modelPeak = Math.max(...real.model_weekly);
  const model = weeks.map((w) => {
    const i = w - 1 - real.model_week_shift;
    return i >= 0 && i < real.model_weekly.length ? (real.model_weekly[i] / modelPeak) * peak : null;
  });
  drawChart("realChart", {
    type: "bar",
    data: {
      labels: weeks,
      datasets: [
        { type: "bar", label: "Muertes de más en Manta (2020 vs 2017-2019)", data: real.excess.map((x) => Math.max(x, 0)), backgroundColor: hexA(COLORS.zombie, 0.75) },
        { type: "line", label: `Modelo sin intervenir, R0 ${dec(real.model_r0_for_curve)} (escalado al pico)`, data: model, borderColor: COLORS.strategy, borderWidth: 2.5, pointRadius: 0, tension: 0.3 },
      ],
    },
    options: chartOptions({
      x: { title: { display: true, text: "Semana de 2020" }, ticks: { maxTicksLimit: 13 } },
      y: { title: { display: true, text: "Muertes por semana" }, beginAtZero: true },
    }),
  });
  $("#realText").innerHTML = `La primera ola en Manta creció <strong>${dec(real.observed_growth_per_day * 100)} % por día</strong> (se duplicaba cada ${dec(real.doubling_days)} días, semanas ${real.rising_weeks.join("–")}) y dejó ≈ ${fmt(real.excess_total)} muertes de más. Nuestro modelo reproduce ese crecimiento con <strong>R0 = ${dec(real.r0_calibrated, 2)}</strong>; la ola real estuvo ${real.half_max_weeks.real} semanas sobre la mitad del pico y la simulada ${real.half_max_weeks.model}. Fuente: Registro Civil vía <a href="https://github.com/andrab/ecuacovid" target="_blank" rel="noopener">ecuacovid</a>.`;
}

function renderScenarios(scenarios) {
  if (!scenarios) return;
  const box = $("#scenarios");
  box.innerHTML = Object.entries(scenarios).map(([key, s]) => `
    <article class="scenario">
      <div class="scenario__head"><span class="badge badge--${s.kind}">${s.kind === "real" ? "REAL" : "FICCIÓN"}</span><span class="scenario__name">${s.label}</span></div>
      <div class="scenario__facts">R0 ${dec(s.config.r0, 2)} · mordido ${dec(s.config.latent_mean)} d · zombi ${dec(s.config.infectious_mean)} d · sin intervenir cae el ${pct(s.attack_rate_none)}</div>
      <div class="scenario__best">Mejor: <strong>${s.best_label}</strong> · gana a Azar en ${pct(s.win_rate_vs_random)} · salva ${fmt(s.saved_vs_none)} vs Nada</div>
      <canvas class="scenario__spark" width="240" height="108" data-key="${key}" aria-hidden="true"></canvas>
      <p class="scenario__src">${s.source}</p>
      <div class="scenario__actions"><button type="button" class="btn btn--ghost" data-load="${key}">Simular este escenario</button></div>
    </article>`).join("");
  box.querySelectorAll(".scenario__spark").forEach((c) => drawSpark(c, scenarios[c.dataset.key]));
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-load]");
    if (!btn) return;
    const { r0, latent_mean, infectious_mean, days } = scenarios[btn.dataset.load].config;
    setForm({ r0, latent_mean, infectious_mean, days });
    updateOutputs();
    $("#verdict").scrollIntoView({ behavior: "smooth" });
    runSimulation();
  });
}

function drawSpark(canvas, s) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const max = Math.max(...s.curve_none, 1);
  const line = (data, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 4 - (v / max) * (h - 8);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  line(s.curve_none, COLORS.zombie);
  line(s.curve_best, COLORS.strategy);
}

// ---------- Jury Mode ----------

function renderJury(jury) {
  if (!jury) {
    $("#autoText").textContent = "Todavía no hay un ataque guardado. Pulsa el botón para lanzar uno.";
    return;
  }
  $("#autoText").textContent = jury.auto_text || "";
  $("#frontier").textContent = `Contraejemplo: ${jury.frontier_text}`;
  const bar = (label, share) => `<div class="share"><span>${label}</span><span class="share__bar">
      <span style="width:${share.win * 100}%;background:${COLORS.strategy}" title="Gana ${pct(share.win)}"></span>
      <span style="width:${share.tie * 100}%;background:${COLORS.tie}" title="Empata ${pct(share.tie)}"></span>
      <span style="width:${share.loss * 100}%;background:${COLORS.zombie}" title="Pierde ${pct(share.loss)}"></span>
    </span></div>`;
  $("#shares").innerHTML =
    bar(`Torneo automático: pierde ${pct(jury.auto_share.loss)}`, jury.auto_share) +
    bar(`Regla fija (${jury.strategy_label}): pierde ${pct(jury.fixed_share.loss)}`, jury.fixed_share);

  const view = state.juryView;
  const groups = { win: [], tie: [], loss: [] };
  for (const p of jury.points) {
    groups[p[view].outcome].push({ x: p.condition.r0, y: p.condition.dose_factor, p });
  }
  const ds = (key, label, color) => ({ label, data: groups[key], backgroundColor: color, pointRadius: 6, pointHoverRadius: 8 });
  drawChart("juryChart", {
    type: "scatter",
    data: { datasets: [ds("win", "Gana", COLORS.strategy), ds("tie", "Empata", "#7d6f8f"), ds("loss", "Pierde", COLORS.zombie)] },
    options: chartOptions({
      x: { title: { display: true, text: "R0 (contagio)" }, min: 1, max: 5.2 },
      y: { type: "logarithmic", title: { display: true, text: "Dosis (× base)" }, min: 0.2, max: 2.2,
        ticks: { callback: (v) => [0.25, 0.5, 1, 2].includes(+v.toFixed(2)) ? `${v}×` : "" } },
    }, {}, {
      label: (ctx) => {
        const p = ctx.raw.p;
        const c = p.condition;
        const r = p[view];
        const who = view === "auto" ? `torneo eligió ${labelOf(p.auto.pick)}` : jury.strategy_label;
        return `R0 ${dec(c.r0)} · dosis ${dec(c.dose_factor, 2)}× · eficacia ${pct(c.vaccine_efficacy)} · inicio ${c.seed_location} · detección ${c.detection_delay} d → ${who}: ${r.saved_mean > 0 ? "+" : ""}${fmt(r.saved_mean)} vs Azar`;
      },
    }),
  });
}

function renderDecisionMap(map) {
  if (!map) return;
  const factors = map.grid.dose_factor;
  const rows = map.grid.r0.slice().reverse();
  const cells = rows.map((r0) => {
    const tds = factors.map((f) => {
      const c = map.cells.find((x) => x.r0 === r0 && x.dose_factor === f && x.vaccine_efficacy === 0.9 && x.seed_location === "random");
      if (!c) return "<div></div>";
      const color = STRATEGY_COLORS[c.best] || COLORS.strategy;
      return `<div class="dmap__cell" style="background:${color}" title="Gana a Azar en ${pct(c.win_rate_vs_random)}">${labelOf(c.best)}<small>${pct(c.win_rate_vs_random)} vs Azar</small></div>`;
    }).join("");
    return `<div class="dmap__row"><div class="dmap__axis">R0 ${dec(r0)}</div>${tds}</div>`;
  }).join("");
  const head = `<div class="dmap__row"><div></div>${factors.map((f) => `<div class="dmap__axis">${dec(f)}× dosis</div>`).join("")}</div>`;
  $("#dmap").innerHTML = head + cells;
}

async function runJury() {
  const btn = $("#runJury");
  btn.disabled = true;
  $("#juryHint").textContent = "Atacando… prueba unos 30 brotes distintos.";
  try {
    const jury = await getJSON(`${API}/jury`, { ...readForm(), points: 24 });
    state.jury = jury;
    renderJury(jury);
    $("#juryHint").textContent = `Listo: ${jury.points.length} brotes probados con ${jury.runs_per_point} corridas cada uno.`;
  } catch (err) {
    $("#juryHint").textContent = `No se pudo correr el ataque: ${err.message}.`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- charts ----------

const isSmall = () => matchMedia("(max-width: 620px)").matches;

function chartOptions(scales, legendLabels = {}, tooltipCallbacks = {}) {
  const small = isSmall();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: "easeOutQuart" },
    interaction: { mode: "nearest", intersect: false },
    layout: { padding: { top: 4, right: 6 } },
    plugins: {
      legend: {
        position: small ? "bottom" : "top",
        labels: { usePointStyle: true, pointStyle: "rectRounded", boxWidth: 8, boxHeight: 8, padding: small ? 10 : 16,
          font: { size: small ? 11 : 13 }, ...legendLabels },
      },
      tooltip: {
        callbacks: tooltipCallbacks, filter: (item) => !item.dataset._band,
        backgroundColor: "rgba(15, 12, 16, 0.95)", borderColor: COLORS.grid, borderWidth: 1,
        titleFont: { family: "IBM Plex Mono", size: 12 }, bodyFont: { size: 12 }, padding: 10, boxPadding: 4,
      },
    },
    scales: Object.fromEntries(Object.entries(scales).map(([k, v]) => [k, {
      grid: { color: COLORS.grid, drawTicks: false },
      border: { display: false },
      ...v,
      title: v.title ? { ...v.title, display: !small || k === "x", font: { size: small ? 11 : 12 } } : undefined,
      ticks: { font: { family: "IBM Plex Mono", size: small ? 10 : 11 }, padding: 6,
        ...(v.ticks || {}), maxTicksLimit: small ? 6 : (v.ticks?.maxTicksLimit ?? 10) },
    }])),
  };
}

// Charts rebuild with the right legend and ticks when the screen size class changes.
let lastSmall = isSmall();
addEventListener("resize", () => {
  if (isSmall() === lastSmall) return;
  lastSmall = isSmall();
  if (state.last) { renderCurves(state.last); }
  renderReal(state.real);
  renderJury(state.jury);
});

function drawChart(id, config) {
  state.charts[id]?.destroy();
  state.charts[id] = new Chart(document.getElementById(id), config);
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

init().catch((err) => {
  $("#runHint").textContent = `No se pudo cargar la configuración: ${err.message}. ¿Está corriendo el servidor?`;
});
