// Plaga Zombie · Manta — UI. Plain ES module, no build step.
import * as sound from "./sound.js";
import { createGlobe, HANDOFF_ZOOM } from "./globe.js";
import { ghostSVG } from "./ghost.js";
import { humanSVG, turnedSVG, zombieSVG } from "./sprites.js";
import { AIRPORT, AIR_FROM, DOCK, PORTOVIEJO, ROAD_IN, SEA, SPRITES, along, route, streetGraph } from "./arrival.js";
const API = window.PLAGA_API || "/api";

const COLORS = {
  none: "#93a4b3", random: "#c9a0ff", strategy: "#9be15d", zombie: "#ff2f3d", tie: "#34485a",
  bitten: "#ffc23d", gone: "#5f7184", vax: "#3fd0ff", pumpkin: "#ff6a1f", ink: "#e3edf3", grid: "#1c2f3f",
};
const STRATEGY_COLORS = { ring_hubs: "#9be15d", ring: "#3fd0ff", degree: "#ffae5e", acquaintance: "#c9a0ff" };
const FIELDS = ["r0", "doses_per_day", "vaccine_efficacy", "seed_location", "vaccine_start_day",
  "detection_prob", "detection_delay", "initial_cases", "runs", "strategy", "seed",
  "latent_mean", "infectious_mean", "days",
  "close_market", "close_schools", "closure_trigger", "budget", "market_cost", "school_cost"];
const CHECKBOXES = new Set(["close_market", "close_schools"]);
const MANTA = [-0.9677, -80.7089];
const CITY = [-0.975, -80.735];   // where the camera lands
const SHEETS = ["curves", "table", "real", "jury", "challenge"];

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
  Chart.defaults.font.family = "Barlow";
}

// ---------- bootstrapping ----------

let resolveReady;
const ready = new Promise((resolve) => { resolveReady = resolve; });

async function init() {
  initSettings();
  initVerdictSheet();
  initMap();
  initPanels();
  initIntro();
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
  initChallenge(meta);

  const fromUrl = Object.fromEntries(new URLSearchParams(location.search));
  setForm({ ...meta.defaults, ...fromUrl });
  updateOutputs();
  renderJury(jury);
  renderDecisionMap(dmap);
  renderReal(real);
  renderScenarios(scenarios);

  form.addEventListener("input", () => { updateOutputs(); clearPresetSelection(); markStale(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); runSimulation(); });
  $("#mayorBtn").addEventListener("click", askMayor);
  initAsk();
  $("#dice").addEventListener("click", () => { form.seed.value = Math.floor(Math.random() * 1e6); updateOutputs(); });
  $("#copyLink").addEventListener("click", copyLink);
  $("#runJury").addEventListener("click", runJury);
  segmented("#juryView", "view", (v) => { state.juryView = v; renderJury(state.jury); });
  resolveReady();
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

// ---------- intro: the planet, the dive onto Manta, then the city waits for Recomendar ----------

// The OS setting only picks the default; the "Animaciones" switch in Ajustes always wins.
const motionOff = () => document.body.classList.contains("calm");

function initIntro() {
  const intro = $("#intro");
  const reduce = motionOff();
  let globe = null;
  $("#ghost").innerHTML = ghostSVG();
  $("#spriteZombie").innerHTML = zombieSVG();
  $("#spriteHuman").innerHTML = humanSVG();
  $("#spriteTurned").innerHTML = turnedSVG();
  try {
    globe = createGlobe($("#globe"), { reduce, worldUrl: "data/world-110m.json" });
  } catch { /* no d3: go straight to the map */ }

  // ?demo=1 (live pitch): straight to the city, no music, no globe, no flight.
  const demo = new URLSearchParams(location.search).has("demo");

  const enter = async () => {
    $("#enterSound").disabled = true;
    if (!demo) {
      try { await sound.start(); } catch { /* audio blocked: continue in silence */ }
    }
    $("#introContent").classList.add("is-gone");
    $("#introTarget").hidden = false;
    if (globe && !demo) await globe.descend();

    // Hand over: the map is already at the globe's last view, so the fade is seamless.
    mapState.leaflet?.setView(MANTA, HANDOFF_ZOOM, { animate: false });
    intro.classList.add("is-leaving");
    setTimeout(() => { intro.hidden = true; globe?.stop(); }, reduce || demo ? 0 : 900);
    // The city stays in view while the camera lands: no card over the map.
    await flyToCity(reduce || demo);
    if (!demo) sound.laugh();  // children playing far away: the city does not know yet
    $("#game").classList.add("is-live");
    $("#ticker").textContent = "Manta duerme tranquila… por ahora. Ajusta las condiciones y pulsa RECOMENDAR para simular el brote.";
    $("#runStatus").textContent = "Pulsa para simular el brote";
    // A shared "repeat" link (with its seed) replays right away; otherwise the committee decides when.
    await ready;
    if (new URLSearchParams(location.search).has("seed")) runSimulation();
  };
  $("#enterSound").addEventListener("click", enter);
  $("#enterSound").focus();
  if (demo) enter();
}

// Warm the browser cache with the satellite tiles of the current view (this zoom and the next),
// so switching to Satélite shows the city at once instead of grey squares. At most ~80 small images.
function prefetchSatellite(map) {
  const url = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const z0 = Math.round(map.getZoom());
  let budget = 80;
  for (const z of [z0, z0 + 1]) {
    const b = map.getPixelBounds();
    const k = 2 ** (z - map.getZoom());
    const [x0, y0] = [Math.floor((b.min.x * k) / 256), Math.floor((b.min.y * k) / 256)];
    const [x1, y1] = [Math.floor((b.max.x * k) / 256), Math.floor((b.max.y * k) / 256)];
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        if (budget-- <= 0) return;
        const img = new Image();
        img.decoding = "async";
        img.src = url(z, x, y);
      }
    }
  }
}

// Once landed, the map stays on Manta and its surroundings (the sea, the airport, the road
// to Portoviejo): zooming out further only showed half-loaded tiles of the whole continent.
const MANTA_BOUNDS = [[-1.30, -81.10], [-0.65, -80.30]];
function lockToManta(map) {
  map.setMinZoom(map.getSize().x < 600 ? 9 : 10);
  map.setMaxBounds(MANTA_BOUNDS);
  map.options.maxBoundsViscosity = 0.8;
}

function flyToCity(reduce) {
  const map = mapState.leaflet;
  mapState.flown = true;
  if (!map) return Promise.resolve();
  const zoom = map.getSize().x < 600 ? 12 : 13;
  return new Promise((resolve) => {
    const done = () => {
      map.removeLayer(mapState.pin);
      mapState.tiles.dark.addLayer(mapState.darkLabels);
      lockToManta(map);
      setTimeout(() => prefetchSatellite(map), 2500);  // after landing, so it never competes with the intro
      resolve();
    };
    if (reduce) { map.setView(CITY, zoom, { animate: false }); return done(); }
    map.once("moveend", done);
    map.flyTo(CITY, zoom, { duration: 2.6, easeLinearity: 0.2 });
  });
}

function showLoading(title, text) {
  $("#loading").hidden = false;
  $("#loading .loading__title").textContent = title;
  $("#loadingText").textContent = text;
}

function hideLoading() { $("#loading").hidden = true; }

// ---------- panels over the map ----------

const isNarrow = () => matchMedia("(max-width: 900px)").matches;

function initPanels() {
  $("#dock").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-panel]");
    if (btn) togglePanel(btn.dataset.panel);
  });
  document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", () => {
    closePanel(btn.closest(".drawer, .sheet").id.replace("panel-", ""));
  }));
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || document.querySelector("dialog[open]")) return;
    const open = [...document.querySelectorAll(".drawer.is-open, .sheet.is-open")].at(-1);
    if (open) closePanel(open.id.replace("panel-", ""));
  });
  document.querySelectorAll(".drawer, .sheet").forEach((el) => { el.inert = true; });
  // Panels and map controls fit between the top bar and the dock, whatever height they take.
  const game = $("#game");
  const dock = $("#dock");
  const top = $(".topbar");
  new ResizeObserver(() => {
    game.style.setProperty("--dock-h", `${dock.offsetHeight}px`);
    game.style.setProperty("--top-h", `${top.offsetHeight}px`);
  }).observe(dock);
  new ResizeObserver(() => game.style.setProperty("--top-h", `${top.offsetHeight}px`)).observe(top);
}

function openPanel(name) {
  const el = $(`#panel-${name}`);
  if (!el) return;
  // Sheets cover the middle of the screen: only one thing open at a time.
  // Drawers can sit left and right together on a wide screen.
  const isSheet = SHEETS.includes(name);
  document.querySelectorAll(".drawer.is-open, .sheet.is-open").forEach((other) => {
    const key = other.id.replace("panel-", "");
    if (key !== name && (isSheet || SHEETS.includes(key) || isNarrow())) closePanel(key);
  });
  el.classList.add("is-open");
  el.inert = false;
  const btn = document.querySelector(`#dock [data-panel="${name}"]`);
  btn?.setAttribute("aria-pressed", "true");
  btn?.classList.remove("has-news");
}

function closePanel(name) {
  const el = $(`#panel-${name}`);
  if (!el) return;
  el.classList.remove("is-open");
  el.inert = true;
  document.querySelector(`#dock [data-panel="${name}"]`)?.setAttribute("aria-pressed", "false");
}

function togglePanel(name) {
  if ($(`#panel-${name}`)?.classList.contains("is-open")) closePanel(name); else openPanel(name);
}

// Phones: tapping the verdict's header (not its close button) expands or folds the bottom sheet.
function initVerdictSheet() {
  $("#panel-verdict .drawer__head").addEventListener("click", (e) => {
    if (!isNarrow() || e.target.closest("[data-close]")) return;
    $("#panel-verdict").classList.toggle("is-expanded");
  });
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
  const defaults = { volume: 0.8, motion: !matchMedia("(prefers-reduced-motion: reduce)").matches };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem("plaga-prefs") || "{}") }; } catch { return defaults; }
}

function savePrefs(change) {
  try { localStorage.setItem("plaga-prefs", JSON.stringify({ ...loadPrefs(), ...change })); } catch { /* private mode */ }
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

// ---------- the Surprise Outbreak in plain words (DeepSeek, with a rule-based fallback) ----------

function initAsk() {
  const text = $("#askText");
  $("#askGo").addEventListener("click", askCommittee);
  text.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); askCommittee(); } });
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return;
  const mic = $("#askMic");
  mic.hidden = false;
  mic.addEventListener("click", () => {
    const rec = new Speech();
    rec.lang = "es-EC";
    rec.interimResults = false;
    mic.classList.add("is-listening");
    rec.onresult = (e) => { text.value = e.results[0][0].transcript; askCommittee(); };
    rec.onend = () => mic.classList.remove("is-listening");
    rec.start();
  });
}

async function askCommittee() {
  const text = $("#askText").value.trim();
  const out = $("#askOut");
  if (!text) { $("#askText").focus(); return; }
  const btn = $("#askGo");
  btn.disabled = true;
  btn.textContent = "Entendiendo…";
  out.hidden = false;
  out.className = "ask__out";
  out.textContent = "El comité está leyendo tu pedido…";
  try {
    const res = await getJSON(`${API}/parse`, { text, current: readForm() });
    if (!Object.keys(res.changes).length) {
      out.classList.add("is-miss");
      out.textContent = "No reconocí ningún cambio. Prueba: «el doble de contagiosa» o «empieza en Tarqui».";
      return;
    }
    setForm(res.changes);
    updateOutputs();
    clearPresetSelection();
    out.textContent = "";
    const who = document.createElement("strong");
    who.textContent = res.source === "ai" ? "🤖 La IA entendió: " : "Entendí: ";
    out.append(who, res.summary, ". Simulando…");
    if (isNarrow()) closePanel("controls");
    await runSimulation();
  } catch (err) {
    out.classList.add("is-miss");
    out.textContent = `No pude entenderlo: ${err.message}.`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Entender y recomendar";
  }
}

function setForm(values) {
  for (const key of FIELDS) {
    if (values[key] === undefined || !form.elements[key]) continue;
    if (CHECKBOXES.has(key)) form.elements[key].checked = values[key] === true || values[key] === "true";
    else form.elements[key].value = values[key];
  }
}

// Range fill for WebKit (Firefox uses ::-moz-range-progress).
function paintRange(el) {
  const span = (+el.max || 100) - (+el.min || 0);
  el.style.setProperty("--fill", `${(100 * (+el.value - (+el.min || 0))) / (span || 1)}%`);
}
document.addEventListener("input", (e) => { if (e.target.type === "range") paintRange(e.target); });

function updateOutputs() {
  document.querySelectorAll('input[type="range"]').forEach(paintRange);
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
  $("#chDoses").textContent = `${v.doses_per_day} vacunas por día desde el día ${v.vaccine_start_day}`;
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
  const delta = {
    base: `R0 ${dec(d.r0)} · ${d.doses_per_day}/día`,
    double_r0: `R0 ${dec(d.r0)} → ${dec(d.r0 * 2)}`,
    half_doses: `${d.doses_per_day} → ${Math.max(1, Math.round(d.doses_per_day / 2))} vacunas`,
    market: "inicio → mercado",
    weak_vaccine: `eficacia ${pct(d.vaccine_efficacy)} → 50 %`,
  };
  box.innerHTML = Object.entries(presets).map(([key, p]) =>
    `<button type="button" class="chip" data-preset="${key}" aria-pressed="false"><span class="chip__name">${p.label}</span><span class="chip__delta">${delta[key] || ""}</span></button>`).join("");
  box.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    apply[btn.dataset.preset]?.();
    updateOutputs();
    clearPresetSelection();
    btn.setAttribute("aria-pressed", "true");
    markStale(`Brote sorpresa: «${btn.querySelector(".chip__name").textContent}». Pulsa Recomendar para ver qué hacer ahora.`);
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

// The verdict on screen no longer matches the form: say so instead of showing an old answer as current.
function markStale(text = "Cambiaste las condiciones. Pulsa Recomendar para actualizar la respuesta.") {
  $("#runHint").textContent = text;
  if (!state.last) return;
  if (!$("#run").disabled) $("#run").textContent = "Recomendar con el cambio";
  $("#verdict").classList.add("is-stale");
  $("#staleNote").hidden = false;
  $("#staleNote").textContent = text;
}

async function runSimulation() {
  const buttons = [$("#run")];
  const started = performance.now();
  // The server may cap the runs (Vercel, small containers): show the number that really runs.
  const runs = Math.min(+readForm().runs, state.meta?.max_runs || Infinity);
  const quick = lookupCell(readForm());
  const hint = quick ? `Mientras tanto, el mapa precalculado apunta a «${labelOf(quick.best)}» (gana a Azar en ${pct(quick.win_rate_vs_random)}). ` : "";
  const label = () => `Simulando… ${Math.round((performance.now() - started) / 1000)} s`;
  const tick = () => {
    buttons.forEach((b) => { b.textContent = label(); });
    $("#loadingText").textContent = `${hint}Confirmando con ${runs} corridas por estrategia, todas con la misma suerte · ${Math.round((performance.now() - started) / 1000)} s`;
  };
  buttons.forEach((b) => { b.disabled = true; });
  showLoading("Simulando la plaga", "");
  tick();
  const timer = setInterval(tick, 1000);
  $("#runError").hidden = true;
  $("#runHint").textContent = "Corriendo todas las estrategias con la misma semilla. Suele tardar menos de un minuto.";
  try {
    const data = await getJSON(`${API}/simulate`, readForm());
    const previous = state.last;
    state.last = data;
    renderResult(data, (performance.now() - started) / 1000);
    renderChange(previous, data);
    history.replaceState(null, "", `?${new URLSearchParams(readForm())}`);
    $("#verdict").classList.remove("is-stale");
    $("#staleNote").hidden = true;
    $("#runHint").textContent = "Corre todas las estrategias con la misma semilla y recomienda la que más salva.";
    // On a phone the verdict would cover the city: flag it in the dock instead.
    if (isNarrow()) $('.dock__btn[data-panel="verdict"]').classList.add("has-news");
    else openPanel("verdict");
    $("#bestName").focus({ preventScroll: true });
  } catch (err) {
    const msg = `No se pudo simular: ${err.message}. Revisa los valores e inténtalo de nuevo.`;
    $("#runHint").textContent = msg;
    $("#runError").textContent = msg;
    $("#runError").hidden = false;
    openPanel("verdict");
  } finally {
    clearInterval(timer);
    buttons.forEach((b) => { b.disabled = false; b.textContent = "Recomendar"; });
    hideLoading();
  }
}

// The committee recalculates live: after a change, say what changed and whether the advice moved.
const CHANGE_FIELDS = {
  r0: ["R0", (v) => dec(v)], doses_per_day: ["vacunas/día", (v) => fmt(v)],
  vaccine_efficacy: ["eficacia", (v) => pct(v)], seed_location: ["inicio", (v) => placeName(v)],
  seed: ["semilla", (v) => v], detection_prob: ["detección", (v) => pct(v)],
  close_market: ["cierre del mercado", (v) => (v ? "sí" : "no")], close_schools: ["cierre de colegios", (v) => (v ? "sí" : "no")],
};
function placeName(v) {
  return state.meta?.seed_locations.find((x) => x.value === v)?.label || v;
}
function renderChange(prev, data) {
  const box = $("#recChange");
  if (!prev) { box.hidden = true; return; }
  const changed = Object.entries(CHANGE_FIELDS)
    .filter(([k]) => String(prev.config[k]) !== String(data.config[k]))
    .map(([k, [label, show]]) => `${label} ${show(prev.config[k])} → ${show(data.config[k])}`);
  if (!changed.length) { box.hidden = true; return; }
  const before = prev.candidates[0].label;
  const now = data.candidates[0].label;
  box.hidden = false;
  box.classList.toggle("is-moved", before !== now);
  box.innerHTML = before !== now
    ? `🔁 <strong>El comité recalculó y cambió de estrategia</strong>: con ${changed.join(", ")} pasó de «${before}» a «${now}».`
    : `🔁 <strong>El comité recalculó</strong> con ${changed.join(", ")} y «${now}» sigue siendo la mejor.`;
}

function renderResult(data, seconds) {
  const best = data.candidates[0];
  const scale = data.manta_scale;
  $("#empty").hidden = true;
  $("#verdictBody").hidden = false;
  $("#bestName").textContent = best.label;
  // The decision in one line for the mayor: what to do, how many it saves, how often it beats Azar.
  const wins = Math.round(data.win_rate_vs_random * data.config.runs);
  $("#recDecision").innerHTML = `${best.description}. <strong>Salva ≈ ${fmt(data.saved_vs_none.mean * scale)} mantenses</strong> `
    + `y le gana al azar en <strong>${wins} de ${data.config.runs}</strong> semillas.`;
  // A traffic light on how sure the advice is: the share of seeds where it beats Azar.
  const rate = data.win_rate_vs_random;
  const level = rate >= 0.9 ? "high" : rate >= 0.7 ? "mid" : "low";
  const conf = $("#recConfidence");
  conf.className = `verdict__confidence is-${level}`;
  conf.textContent = { high: "✔ Confianza alta", mid: "⚠ Confianza media", low: "✖ Confianza baja" }[level]
    + ` · le gana al azar en ${pct(rate)} de las semillas`;
  $("#recText").textContent = data.recommendation_text;
  // Vaccines alone fall short: the committee's closure advice goes right into the verdict.
  const cp = data.closure_plans;
  const closeAdvice = cp?.auto && cp.best !== cp.plans[0].label;
  $("#recClosures").hidden = !closeAdvice;
  if (closeAdvice) $("#recClosures").textContent = cp.text;
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
  resetMayor();
}

// ---------- «¿Le ganas al comité?»: the player's plan against the committee's algorithm ----------

const challenge = { plan: [], max: 3 };

function initChallenge(meta) {
  challenge.max = meta.player_max_groups;
  // Two short rows instead of 14 loose buttons: who people are, and where they live.
  const chip = (g, label) => `<button type="button" class="chip chip--group" data-group="${g.value}" aria-pressed="false"><span class="chip__name">${label}</span><span class="chip__rank"></span></button>`;
  const people = meta.player_groups.filter((g) => !g.value.startsWith("barrio:"));
  const barrios = meta.player_groups.filter((g) => g.value.startsWith("barrio:"));
  $("#chGroups").innerHTML = `<p class="chgroups__title">Personas</p><div class="chgroups__row">${people.map((g) => chip(g, g.label)).join("")}</div>`
    + `<p class="chgroups__title">Barrios</p><div class="chgroups__row chgroups__row--barrios">${barrios.map((g) => chip(g, g.label.replace(/^Barrio /, ""))).join("")}</div>`;
  $("#chGroups").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group]");
    if (btn) togglePlanGroup(btn.dataset.group);
  });
  $("#chPlay").addEventListener("click", playChallenge);
  $("#chReseed").addEventListener("click", () => {
    form.seed.value = Math.floor(Math.random() * 1e6);
    updateOutputs();
    markStale();
    playChallenge();
  });
}

function togglePlanGroup(group) {
  const plan = challenge.plan;
  const at = plan.indexOf(group);
  if (at >= 0) plan.splice(at, 1);
  else if (plan.length < challenge.max) plan.push(group);
  else plan[plan.length - 1] = group;  // full: the new pick replaces the last one
  document.querySelectorAll("#chGroups [data-group]").forEach((btn) => {
    const rank = plan.indexOf(btn.dataset.group);
    btn.setAttribute("aria-pressed", String(rank >= 0));
    btn.querySelector(".chip__rank").textContent = rank >= 0 ? rank + 1 : "";
  });
  const names = plan.map((g, i) => `${i + 1}. ${$(`#chGroups [data-group="${CSS.escape(g)}"] .chip__name`).textContent}`);
  $("#chPlan").textContent = plan.length
    ? `Tu plan: ${names.join(" → ")}. Si sobran dosis, al azar.`
    : "Toca un grupo para empezar tu plan.";
  $("#chPlay").disabled = plan.length === 0;
}

async function playChallenge() {
  if (!challenge.plan.length) return;
  const play = $("#chPlay");
  const started = performance.now();
  const tick = () => { play.textContent = `El comité está jugando… ${Math.round((performance.now() - started) / 1000)} s`; };
  play.disabled = true;
  $("#chReseed").disabled = true;
  $("#chError").hidden = true;
  showLoading("Tu plan contra el comité", `${readForm().runs} corridas por plan, con la misma suerte para los dos`);
  tick();
  const timer = setInterval(tick, 1000);
  try {
    renderChallenge(await getJSON(`${API}/challenge`, { ...readForm(), plan: challenge.plan }));
  } catch (err) {
    $("#chError").textContent = `No se pudo jugar: ${err.message}. Revisa las condiciones e inténtalo de nuevo.`;
    $("#chError").hidden = false;
  } finally {
    clearInterval(timer);
    hideLoading();
    play.disabled = false;
    play.textContent = "¡Juega contra el comité!";
    $("#chReseed").disabled = false;
  }
}

function renderChallenge(d) {
  const runs = d.config.runs;
  $("#chResult").hidden = false;
  $("#chYou").textContent = fmt(d.player.vs_none.mean);
  $("#chThem").textContent = fmt(d.committee.vs_none.mean);
  $("#chYouPlan").textContent = d.player.label;
  $("#chThemPlan").textContent = d.committee.label;
  $(".score").classList.toggle("is-you", d.player_wins);
  $(".score").classList.toggle("is-committee", !d.player_wins);
  $("#chVerdict").textContent = d.verdict_text;
  // The panel grew with the result: bring the scoreboard into view.
  requestAnimationFrame(() => $("#chResult").scrollIntoView({ block: "start", behavior: motionOff() ? "auto" : "smooth" }));
  // Why: what the committee did differently, in one line.
  $("#chWhy").textContent = `Por qué: el comité no elige un grupo fijo. Con estas condiciones usó «${d.committee.label}»: ${d.committee.description.charAt(0).toLowerCase()}${d.committee.description.slice(1)}. Tu plan vacuna a tus grupos aunque la plaga esté en otro lado.`;
  // committee_vs_player > 0: the committee saved more in that run.
  const perRun = d.committee_vs_player.per_run;
  const wins = perRun.filter((x) => x < 0).length;
  $("#chStripTitle").textContent = `Semilla por semilla: ganas en ${wins} de ${runs}`;
  $("#chStrip").setAttribute("aria-label", `Ganas en ${wins} de ${runs} corridas`);
  $("#chStrip").innerHTML = perRun.map((x, i) => {
    const cls = x < 0 ? "win" : x > 0 ? "loss" : "tie";
    return `<span class="tick tick--${cls}" style="animation-delay:${Math.min(i * 6, 600)}ms" title="Corrida ${i + 1}: el comité ${x >= 0 ? "+" : ""}${x}"></span>`;
  }).join("");
  $("#chSeed").textContent = `Semilla ${d.config.seed} · ${runs} corridas por plan · misma suerte para todos`;
  const days = d.curves.none.map((_, i) => i);
  const line = (label, data, color, width = 2) => ({ label, data, borderColor: color, borderWidth: width, pointRadius: 0, tension: 0.3, fill: false });
  drawChart("chChart", {
    type: "line",
    data: {
      labels: days,
      datasets: [
        line("Nada", d.curves.none, COLORS.none),
        line("Azar", d.curves.random, COLORS.random),
        line(`Comité: ${d.committee.label}`, d.committee.summary.curves.I, COLORS.strategy, 3),
        line("Tu plan", d.player.summary.curves.I, COLORS.pumpkin, 3),
      ],
    },
    options: chartOptions({
      x: { title: { display: true, text: "Día" }, ticks: { maxTicksLimit: 10 } },
      y: { title: { display: true, text: "Zombies" }, beginAtZero: true },
    }),
  });
  if (d.player_wins) sound.bite();
  // Watch the duel on the map; the scoreboard comes back when the replay ends.
  enterSplit(d);
}

// ---------- mayor's report (DeepSeek writes it; the server falls back to a template) ----------

function resetMayor() {
  $("#mayorReport").hidden = true;
  $("#mayorReport").textContent = "";
  $("#mayorBtn").disabled = false;
  $("#mayorBtn").textContent = "Explícaselo al alcalde (IA)";
}

async function askMayor() {
  const d = state.last;
  if (!d) return;
  const best = d.candidates[0];
  const btn = $("#mayorBtn");
  const box = $("#mayorReport");
  btn.disabled = true;
  btn.textContent = "Redactando el informe…";
  try {
    const report = await getJSON(`${API}/report`, {
      strategy: best.name, r0: d.config.r0, doses_per_day: d.config.doses_per_day,
      vaccine_efficacy: d.config.vaccine_efficacy, seed_location: d.config.seed_location,
      runs: d.config.runs, manta_scale: d.manta_scale,
      saved_none: d.saved_vs_none.mean, saved_none_p5: d.saved_vs_none.p5, saved_none_p95: d.saved_vs_none.p95,
      saved_random: d.saved_vs_random.mean, win_rate: d.saved_vs_random.win_rate,
      wasted_share: d.wasted_doses.share,
    });
    box.textContent = "";
    report.text.split(/\n\s*\n/).forEach((para) => {
      const p = document.createElement("p");
      p.textContent = para.replace(/\*\*/g, "");
      box.append(p);
    });
    const note = document.createElement("p");
    note.className = "mayor__source";
    note.textContent = report.source === "ai"
      ? "Redactado por IA (DeepSeek) solo con los números de esta simulación."
      : "La IA no respondió: este es el informe automático con los mismos números.";
    box.append(note);
    box.hidden = false;
    btn.textContent = "Informe listo";
  } catch (err) {
    box.textContent = `No se pudo redactar el informe: ${err.message}. Inténtalo de nuevo.`;
    box.hidden = false;
    btn.disabled = false;
    btn.textContent = "Reintentar el informe";
  }
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
  // Starts where the intro globe will hand over, so those tiles are loaded by then.
  const map = L.map("map", { zoomControl: false, attributionControl: true, scrollWheelZoom: true, maxZoom: 18 })
    .setView(MANTA, HANDOFF_ZOOM);
  L.control.zoom({ position: "bottomright" }).addTo(map);
  const esri = (path) => `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`;
  // Keep a wider ring of tiles loaded so panning and zooming out rarely shows gaps.
  const tile = (path, options) => L.tileLayer(esri(path), { keepBuffer: 6, ...options });
  const attribution = "Mapa &copy; Esri, HERE, Garmin, &copy; colaboradores de OpenStreetMap";
  // Place names stay off during the descent: scaled-up label tiles look blurry while flying.
  mapState.darkLabels = tile("Canvas/World_Dark_Gray_Reference", { maxNativeZoom: 16, maxZoom: 18 });
  mapState.tiles.dark = L.layerGroup([
    tile("Canvas/World_Dark_Gray_Base", { maxNativeZoom: 16, maxZoom: 18, attribution }),
  ]).addTo(map);
  mapState.tiles.sat = L.layerGroup([
    // Sharp up to Esri's native zoom; a darker, punchier grade keeps the colored dots readable on the photo.
    tile("World_Imagery", { maxNativeZoom: 19, maxZoom: 19, className: "sat-tiles", attribution: "Imágenes &copy; Esri, Maxar, Earthstar Geographics" }),
    tile("Reference/World_Boundaries_and_Places", { maxNativeZoom: 19, maxZoom: 19 }),
  ]);
  mapState.pin = L.marker(MANTA, { icon: L.divIcon({ className: "", html: '<div class="manta-pin"></div>', iconSize: [18, 18] }) })
    .addTo(map).bindTooltip("Manta", { permanent: true, direction: "right", className: "barrio-label" });

  // Two canvases over the map: Manta's streets (redrawn when the map moves)
  // and the people (redrawn every animation frame).
  const layer = (z) => {
    const c = document.createElement("canvas");
    Object.assign(c.style, { position: "absolute", left: "0", top: "0", zIndex: z, pointerEvents: "none", transformOrigin: "0 0" });
    map.getContainer().appendChild(c);
    return c;
  };
  mapState.streetCanvas = layer(440);
  mapState.streetCtx = mapState.streetCanvas.getContext("2d");
  mapState.canvas = layer(450);
  mapState.ctx = mapState.canvas.getContext("2d");
  mapState.leaflet = map;
  const redraw = () => { drawStreets(); drawPeople(); };
  // While Leaflet animates a zoom (wheel, buttons, double click) the tiles scale with CSS;
  // the canvases scale the same way instead of sitting still until the zoom ends.
  const canvases = [mapState.streetCanvas, mapState.canvas];
  map.on("zoomanim", (e) => {
    const scale = map.getZoomScale(e.zoom);
    const half = map.getSize().divideBy(2);
    const shift = map.project(e.center, e.zoom).subtract(map.project(map.getCenter(), e.zoom));
    const offset = half.multiplyBy(1 - scale).subtract(shift);
    canvases.forEach((c) => {
      c.style.transition = "transform .25s cubic-bezier(0, 0, .25, 1)"; // Leaflet's own zoom easing
      L.DomUtil.setTransform(c, offset, scale);
    });
  });
  map.on("zoom", () => canvases.forEach((c) => {
    c.style.transition = "";
    L.DomUtil.setTransform(c, L.point(0, 0), 1);
  }));
  map.on("move zoom resize", redraw);
  new ResizeObserver(() => { map.invalidateSize(); redraw(); }).observe(map.getContainer());
  getJSON("data/manta_streets.json").then((d) => {
    mapState.streets = projectStreets(d.lines);
    mapState.graph = streetGraph(d.lines);  // for the car that brings patient zero
    drawStreets();
  }).catch(() => {});

  segmented("#mapPolicy", "policy", (p) => { mapState.policy = p; exitSplit(); prepareRun(); drawPeople(); });
  segmented("#mapTiles", "tiles", (t) => {
    Object.values(mapState.tiles).forEach((l) => map.removeLayer(l));
    mapState.tiles[t].addTo(map);
  });
  $("#play").addEventListener("click", () => (mapState.playing ? pause() : play()));
  mapState.camera = loadPrefs().camera !== false;
  $("#camera").setAttribute("aria-pressed", String(mapState.camera));
  $("#camera").addEventListener("click", () => {
    mapState.camera = !mapState.camera;
    $("#camera").setAttribute("aria-pressed", String(mapState.camera));
    savePrefs({ camera: mapState.camera });
  });
  mapState.speed = 5;
  $("#speed").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-speed]");
    if (!btn) return;
    mapState.speed = +btn.dataset.speed;
    $("#speed").querySelectorAll("[data-speed]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    if (!mapState.playing) play();
  });
  map.on("click", (e) => showBarrioCard(e.latlng));
  initSplit();
  $("#daySlider").addEventListener("input", (e) => {
    const target = +e.target.value;  // read first: pause() redraws and resets the slider to the current day
    pause();
    endScene();  // dragging the timeline skips the arrival scene
    mapState.day = target;
    drawPeople();
  });
}

function loadMapRun(data) {
  leaveSplit();
  mapState.data = data;
  $("#mapRun").textContent = `corrida típica n.º ${data.map.run}`;
  mapState.day = 0;
  prepareRun();
  const map = mapState.leaflet;
  if (!map) return;
  $("#play").disabled = false;
  $("#daySlider").disabled = false;
  if (!mapState.flown) {
    flyToCity(motionOff()).then(play);
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
  const run = makeRun(data.map[mapState.policy], data, mapState.policy !== "none");
  run.waves = wavesOf(run, data);
  loadNews(run, mapState.policy === "strategy" ? data.candidates[0].name : mapState.policy);
  setRun(run);
}

// ---------- waves: a TV-style banner each week of the replayed run ----------

// One entry per week, from the run's own day-by-day counts [S, E, I, R, V].
function wavesOf(run, data) {
  const counts = run.counts || [];
  if (!counts.length) return [];
  const n = data.config.population;
  const scale = data.manta_scale;
  const weeks = [];
  for (let w = 1; 7 * (w - 1) < run.lastDay; w += 1) {
    const d = Math.min(7 * w, counts.length - 1);
    const [S, , I, , V] = counts[d];
    const barrios = run.events
      .filter((e) => e.day > 7 * (w - 1) && e.day <= 7 * w && e.bubble?.title?.startsWith("Llega a"))
      .map((e) => e.bubble.title.replace(/^Llega a /, ""));
    weeks.push({ week: w, zombies: Math.round(I * scale), bitten: Math.round((n - S - V) * scale),
      vaccinated: Math.round(V * scale), barrios });
  }
  const peak = weeks.reduce((a, b) => (b.zombies > a.zombies ? b : a), weeks[0]).week;
  weeks.forEach((w) => {
    w.phase = w.zombies === 0 && w.week > 1 ? "calm" : w.week === peak ? "peak" : w.week > peak ? "down" : "up";
  });
  return weeks;
}

// Headlines from the AI, once per run; the template answers if it fails (server side).
function loadNews(run, strategy) {
  if (!run.waves.length) return;
  const weeks = run.waves.map(({ week, zombies, bitten, vaccinated, barrios }) => ({ week, zombies, bitten, vaccinated, barrios }));
  getJSON(`${API}/news`, { weeks, strategy })
    .then((res) => { run.news = res.news; run.newsSource = res.source; })
    .catch(() => {});
}

function showWave(run, week) {
  const w = run.waves?.[week - 1];
  const line = run.news?.[week - 1];
  if (!w || !line) return;
  const tag = { up: `⚠ Oleada ${week}`, peak: "☠ Pico de la oleada", down: "↘ La ola retrocede", calm: "✔ Manta resiste" }[w.phase];
  const banner = $("#waveBanner");
  banner.className = `wave is-${w.phase}`;
  $("#waveTag").textContent = tag;
  $("#waveSub").textContent = `Semana ${week} · ${fmt(w.zombies)} zombis en Manta`;
  $("#waveText").textContent = line;
  banner.hidden = false;
  void banner.offsetWidth;
  banner.classList.add("is-on");
  clearTimeout(mapState.waveTimer);
  mapState.waveTimer = setTimeout(() => banner.classList.remove("is-on"), 2600);
  if (w.phase === "peak") sound.groan();
}

// A replayed run ready to draw: points in world coordinates plus its headlines.
function makeRun(payload, data, vaccinates) {
  const cfg = data.config;
  // [lat, lon, day, worldX, worldY]
  const toLL = (p) => [p[0] / 1e4, p[1] / 1e4, p[2], ...toWorld(p[0] / 1e4, p[1] / 1e4)];
  const bitten = payload.bitten.map(toLL);
  const vaccinated = payload.vaccinated.map(toLL);
  const sick = cfg.latent_mean + cfg.infectious_mean;
  const lastBite = bitten.reduce((m, p) => Math.max(m, p[2]), 0);
  return {
    bitten, vaccinated, latent: cfg.latent_mean, sick, label: payload.label, counts: payload.counts, closed: payload.closed,
    source: payload.source || [],
    rt: effectiveR(bitten, payload.counts || [], cfg.infectious_mean),
    events: buildEvents(bitten, data, payload, vaccinates, vaccinated),
    lastDay: Math.min(cfg.days, Math.ceil(lastBite + sick + 2)),
    peak: Math.max(1, ...(payload.counts || []).map((c) => c[2])),
  };
}

// Effective reproduction number Rt, day by day, from the replayed run itself (as Covasim reports it):
// new bites per day over the Zombies active that day divided by how many days each stays contagious,
// over a 7-day window. Rt > 1: the plague grows; Rt < 1: it is being contained.
function effectiveR(bitten, counts, infectiousDays) {
  const days = counts.length;
  const bites = new Float64Array(days);
  for (const p of bitten) if (p[2] > 0 && p[2] < days) bites[p[2]] += 1;
  const rt = new Array(days).fill(null);
  for (let d = 3; d < days - 3; d += 1) {
    let num = 0, den = 0;
    for (let k = d - 3; k <= d + 3; k += 1) { num += bites[k]; den += counts[k][2] / infectiousDays; }
    if (den >= 1) rt[d] = num / den;
  }
  return rt;
}

function setRun(run, lastDay = run.lastDay, peak = run.peak) {
  mapState.run = run;
  mapState.lastDay = lastDay;
  mapState.peakZombies = peak;
  mapState.arrived = false;  // a new run gets its arrival scene once
  $("#daySlider").max = lastDay;
  mapState.day = Math.min(mapState.day, lastDay);
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
// "Día 64 (semana 10)" and people rounded to the hundred: the headline is read, not audited.
const when = (day) => `Día ${day} (semana ${Math.floor(day / 7) + 1})`;
const people = (x) => fmt(Math.round(x / 100) * 100);

function buildEvents(bitten, data, payload, vaccinates, vaccinated = []) {
  const label = payload.label;
  const cfg = data.config;
  const barrios = data.map.barrios;
  const n = cfg.population;
  const scale = data.manta_scale;
  const events = [];
  const byDay = [...bitten].sort((a, b) => a[2] - b[2]);
  const first = byDay.filter((p) => p[2] === 0).map((p) => nearestBarrio(p[0], p[1], barrios));
  const at = (name) => barrios.find((b) => b.name === name);
  events.push({ day: 0, text: `Día 0: aparecen los primeros mordidos en ${[...new Set(first)].join(", ")}. Nadie lo sabe todavía.`,
    bubble: { where: at(first[0]), title: "Paciente cero" } });

  const reached = new Set(first);
  for (const p of byDay) {
    const b = nearestBarrio(p[0], p[1], barrios);
    if (!reached.has(b)) {
      reached.add(b);
      events.push({ day: p[2], text: `${when(p[2])}: la plaga llega a ${b}.`, bubble: { where: at(b), title: `Llega a ${b}` } });
    }
  }
  if (vaccinates && cfg.doses_per_day > 0) {
    // The first dose of the run, on the map where it was given.
    const first = vaccinated.reduce((a, p) => (!a || p[2] < a[2] ? p : a), null);
    events.push({ day: first ? first[2] : cfg.vaccine_start_day,
      text: `${when(cfg.vaccine_start_day)}: llegan las vacunas, ${cfg.doses_per_day} al día. Se aplica «${label}».`,
      bubble: first ? { where: { lat: first[0], lon: first[1] }, title: "Primera vacuna", color: "#3fd0ff" } : undefined });
  }
  const closedSeries = Array.isArray(payload.closed) ? payload.closed : [];
  const places = ["el mercado central", "los colegios"];
  for (let d = 1; d < closedSeries.length; d += 1) {
    for (const k of [0, 1]) {
      if (closedSeries[d][k] && !closedSeries[d - 1][k]) events.push({ day: d, text: `${when(d)}: el comité cierra ${places[k]}.` });
      if (!closedSeries[d][k] && closedSeries[d - 1][k]) events.push({ day: d, text: `${when(d)}: reabren ${places[k]}.` });
    }
  }
  // Milestones in words a mayor reads at a glance, counted in real Manta people.
  const marks = [[0.01, "1 de cada 100 mantenses"], [0.1, "1 de cada 10 mantenses"], [0.25, "1 de cada 4 mantenses"], [0.5, "la mitad de Manta"]];
  let k = 0;
  byDay.forEach((p, i) => {
    while (k < marks.length && i + 1 >= marks[k][0] * n) {
      events.push({ day: p[2], text: `${when(p[2])}: ya mordieron a ${marks[k][1]}, unas ${people((i + 1) * scale)} personas.` });
      k += 1;
    }
  });
  const total = bitten.length;
  const lastBite = byDay.length ? byDay[byDay.length - 1][2] : 0;
  const end = Math.min(cfg.days, Math.ceil(lastBite + cfg.latent_mean + cfg.infectious_mean));
  events.push({ day: end, text: `${when(end)}: cae el último zombi. Con «${label}» mordieron a unas ${people(total * scale)} personas, el ${pct(total / n)} de Manta.` });
  return events.sort((a, b) => a.day - b.day);
}

// ---------- automatic camera: fly to the moments that matter, then back to the city ----------

const cameraOn = () => mapState.camera && !motionOff();
const cityZoom = () => (mapState.leaflet.getSize().x < 600 ? 12 : 13);

// Where the camera stops: patient zero, the first dose and the first barrios the plague reaches.
function cameraShots(run) {
  const shots = [];
  let reached = 0;
  for (const ev of run.events) {
    const where = ev.bubble?.where;
    if (!where) continue;
    const isArrival = ev.bubble.title.startsWith("Llega a");
    if (isArrival && (reached += 1) > 2) continue;
    shots.push({ day: ev.day, lat: where.lat, lon: where.lon, zoom: isArrival ? 14 : 15 });
  }
  return shots.sort((a, b) => a.day - b.day);
}

function flyAndWait(target, zoom, seconds) {
  const map = mapState.leaflet;
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); map.off("moveend", done); resolve(); };
    const timer = setTimeout(done, seconds * 1000 + 400);
    map.once("moveend", done);
    map.flyTo(target, zoom, { duration: seconds });
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- the arrival: a ship docks, a car drives the plague to patient zero ----------

function drawActors(ctx, T, r) {
  const px = Math.max(3, r * 0.9);  // screen pixels per sprite pixel: big enough to follow at any zoom
  ctx.imageSmoothingEnabled = false;
  for (const a of mapState.actors || []) {
    // A fading wake behind the ship, dust behind the car.
    a.trail.forEach(([lat, lon], i) => {
      const [wx, wy] = toWorld(lat, lon);
      ctx.fillStyle = a.kind === "ship" ? `rgba(220, 240, 255, ${0.5 * (i + 1) / a.trail.length})` : `rgba(242, 194, 48, ${0.35 * (i + 1) / a.trail.length})`;
      ctx.fillRect(wx * T.k + T.dx - px / 2, wy * T.k + T.dy - px / 2, px, px);
    });
    const { img, w, h } = SPRITES[a.kind];
    const [wx, wy] = toWorld(a.at[0], a.at[1]);
    const flip = Math.abs(a.heading) > Math.PI / 2;  // keep the sprite upright when heading left
    ctx.save();
    ctx.translate(wx * T.k + T.dx, wy * T.k + T.dy);
    ctx.rotate(flip ? a.heading - Math.PI : a.heading);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, (-w * px) / 2, (-h * px) / 2, w * px, h * px);
    ctx.restore();
  }
}

function moveActor(kind, path, ms, token, follow) {
  const map = mapState.leaflet;
  const actor = { kind, at: path[0], heading: 0, trail: [] };
  mapState.actors = [...(mapState.actors || []).filter((a) => a.kind !== kind), actor];
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = (now) => {
      if (token !== mapState.playToken) return resolve(false);
      const t = Math.min(1, (now - start) / ms);
      const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const pos = along(path, ease);
      actor.at = pos.at;
      actor.heading = pos.heading;
      actor.trail = [...actor.trail, pos.at].slice(-14);
      if (follow) map.setView(pos.at, map.getZoom(), { animate: false });
      else drawPeople();
      if (t < 1) requestAnimationFrame(frame); else resolve(true);
    };
    requestAnimationFrame(frame);
  });
}

function endScene() {
  mapState.arrived = true;
  mapState.actors = [];
  mapState.inShot = false;
  mapState.holdTicker = false;
  // Cut mid-scene, the camera may be over the sea or the airport: bring it back to the city,
  // and check again once any animation still running has finished.
  const backToCity = () => {
    const map = mapState.leaflet;
    if (!map || mapState.playing) return;
    if (map.getCenter().distanceTo(L.latLng(CITY)) > 3000) {
      map.stop();
      map.setView(CITY, cityZoom(), { animate: false });
      drawPeople();
    }
  };
  backToCity();
  setTimeout(backToCity, 1600);
}

async function arrival(token) {
  const run = mapState.run;
  const firsts = run.bitten.filter((p) => p[2] === 0);
  const barrios = (mapState.split ? mapState.split.data : mapState.data).map.barrios;
  if (!firsts.length || !mapState.graph) return play(true);
  mapState.arrived = true;  // pausing and pressing play again continues the run instead of replaying the scene
  const zero = firsts[0];
  const barrio = nearestBarrio(zero[0], zero[1], barrios);
  const ticker = (text) => { $("#ticker").textContent = text; };
  const cancelled = () => token !== mapState.playToken;
  mapState.inShot = true;
  mapState.holdTicker = true;  // the scene tells its own story in the ticker
  mapState.day = -0.01;  // nobody is bitten until the car arrives
  mapState.shots = mapState.shots.filter((s) => s.day > 0);  // this scene replaces the patient-zero shot

  // How it arrives: the market sits by the port (ship), schools fill from the road (car),
  // anywhere else the seed decides, so the same link always shows the same arrival.
  const cfg = (mapState.split ? mapState.split.data : mapState.data).config;
  const way = { market: "ship", school: "road" }[cfg.seed_location] || ["plane", "ship", "road"][Math.abs(cfg.seed) % 3];
  const scenes = {
    ship: { from: SEA, to: DOCK, actor: "ship", ms: 2800, zoom: 14,
      start: "Día 0: un barco de carga entra al puerto de Manta…", landed: "baja un pasajero que no se siente bien" },
    plane: { from: AIR_FROM, to: AIRPORT, actor: "plane", ms: 3200, zoom: 13,
      start: "Día 0: un avión aterriza en el aeropuerto Eloy Alfaro…", landed: "baja un pasajero con fiebre" },
    road: { from: PORTOVIEJO, to: ROAD_IN, actor: "car", ms: 3600, zoom: 12,
      start: "Día 0: un carro llega por la vía desde Portoviejo…", landed: "el conductor no se siente bien" },
  };
  const scene = scenes[way];
  ticker(scene.start);
  await flyAndWait(scene.from, scene.zoom, 1.1);
  if (!cancelled()) await moveActor(scene.actor, [scene.from, scene.to], scene.ms, token, true);  // the camera rides along
  if (!cancelled()) {
    if (scene.actor !== "car") mapState.actors = mapState.actors.filter((x) => x.kind !== scene.actor);
    ticker(`Día 0: ${scene.landed} y sigue en carro hacia ${barrio}…`);
    await flyAndWait(scene.to, 15, 0.8);
  }
  if (!cancelled()) {
    const path = route(mapState.graph, scene.to, [zero[0], zero[1]]);
    await moveActor("car", path, Math.min(5500, Math.max(2500, path.length * 45)), token, true);
  }
  if (!cancelled()) {
    mapState.actors = mapState.actors.filter((x) => x.kind !== "car");  // the passenger gets out
    mapState.actors = mapState.actors.filter((x) => x.kind !== "car");  // the passenger gets out
    mapState.day = 0.4;  // the bite: patient zero and the first cases appear
    ticker(`Día 0: el pasajero muerde a alguien en ${barrio}. Nace el paciente cero. Nadie lo sabe todavía.`);
    sound.bite();
    const until = performance.now() + 1800;
    while (performance.now() < until && !cancelled()) { drawPeople(); await wait(60); }
  }
  mapState.actors = [];
  mapState.holdTicker = false;
  mapState.day = Math.max(0, mapState.day);
  if (!cancelled()) await flyAndWait(CITY, cityZoom(), 1.2);
  mapState.inShot = false;
  if (!cancelled()) play(true);
}

async function cinematic(shot, token) {
  mapState.inShot = true;
  mapState.day = Math.max(mapState.day, shot.day + 0.4);  // the headline bubble pops up
  drawPeople();
  await flyAndWait([shot.lat, shot.lon], shot.zoom, 1.3);
  const until = performance.now() + 1700;
  while (performance.now() < until && token === mapState.playToken) { drawPeople(); await wait(60); }
  if (token === mapState.playToken) await flyAndWait(CITY, cityZoom(), 1.1);
  mapState.inShot = false;
  if (token === mapState.playToken) play(true);
}

function play(resume = false) {
  if (!mapState.run) return;
  if (!resume) {
    if (mapState.day >= mapState.lastDay) mapState.day = 0;
    // Shots still ahead of the playhead will be visited.
    mapState.shots = cameraShots(mapState.run).filter((s) => s.day >= Math.floor(mapState.day));
  }
  if (motionOff()) {
    mapState.day = mapState.lastDay;
    drawPeople();
    return;
  }
  mapState.playing = true;
  const token = (mapState.playToken = (mapState.playToken || 0) + 1);
  clearTimeout(mapState.idle);
  if (!resume && mapState.day === 0 && cameraOn() && !mapState.arrived) {
    $("#play").textContent = "❚❚";
    $("#play").setAttribute("aria-label", "Pausa");
    return arrival(token);
  }
  $("#play").textContent = "❚❚";
  $("#play").setAttribute("aria-label", "Pausa");
  let last = performance.now();
  const step = (now) => {
    const speed = mapState.speed; // days per second
    mapState.day = Math.min(mapState.lastDay, mapState.day + ((now - last) / 1000) * speed);
    last = now;
    const shot = cameraOn() && mapState.shots?.[0]?.day <= mapState.day ? mapState.shots.shift() : null;
    if (shot) return cinematic(shot, token);
    drawPeople();
    if (mapState.day >= mapState.lastDay) {
      pause();
      if (mapState.split) setTimeout(() => { if (mapState.split) openPanel("challenge"); }, 1200);
      return;
    }
    mapState.raf = requestAnimationFrame(step);
  };
  cancelAnimationFrame(mapState.raf);
  mapState.raf = requestAnimationFrame(step);
}

function pause() {
  mapState.playing = false;
  mapState.actors = [];
  mapState.day = Math.max(0, mapState.day);
  mapState.playToken = (mapState.playToken || 0) + 1;  // cancels a camera shot in progress
  cancelAnimationFrame(mapState.raf);
  $("#play").textContent = "▶";
  $("#play").setAttribute("aria-label", "Reproducir");
  idle();
}

// While paused, zombies keep breathing (a few frames per second is enough).
function idle() {
  clearTimeout(mapState.idle);
  if (mapState.playing || motionOff()) return;
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

// Points are projected once to Web Mercator at zoom 0 ("world" coordinates);
// on screen they are just world × 2^zoom + offset, much cheaper than a full
// projection per point on every frame and every pan.
function toWorld(lat, lon) {
  const p = mapState.leaflet.project([lat, lon], 0);
  return [p.x, p.y];
}

function screenTransform() {
  const map = mapState.leaflet;
  const z = map.getZoom();
  const ref = map.latLngToContainerPoint([0, 0]);
  const origin = map.project([0, 0], z);
  return { k: 2 ** z, dx: ref.x - origin.x, dy: ref.y - origin.y };
}

function projectStreets(lines) {
  return lines.map((line) => {
    const xy = new Float64Array(line.p.length * 2);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    line.p.forEach(([lat, lon], i) => {
      const [x, y] = toWorld(lat, lon);
      xy[2 * i] = x; xy[2 * i + 1] = y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    });
    return { k: line.k, xy, box: [minX, minY, maxX, maxY] };
  });
}

// Manta's real streets (OpenStreetMap), only once we are close enough to see them.
function drawStreets() {
  const { streetCanvas: canvas, streetCtx: ctx, leaflet: map, streets } = mapState;
  if (!canvas || !map) return;
  const size = fitCanvas(canvas, ctx);
  if (!streets || map.getZoom() < 11) return;
  const { k, dx, dy } = screenTransform();
  const pad = 40;
  const view = [(-pad - dx) / k, (-pad - dy) / k, (size.x + pad - dx) / k, (size.y + pad - dy) / k];
  for (const kind of ["street", "main"]) {
    ctx.strokeStyle = kind === "main" ? "rgba(232, 210, 170, 0.55)" : "rgba(232, 210, 170, 0.22)";
    ctx.lineWidth = kind === "main" ? 1.6 : 0.8;
    ctx.beginPath();
    for (const { k: lineKind, xy, box } of streets) {
      if (lineKind !== kind || box[2] < view[0] || box[0] > view[2] || box[3] < view[1] || box[1] > view[3]) continue;
      ctx.moveTo(xy[0] * k + dx, xy[1] * k + dy);
      for (let i = 2; i < xy.length; i += 2) ctx.lineTo(xy[i] * k + dx, xy[i + 1] * k + dy);
    }
    ctx.stroke();
  }
}

function drawPeople() {
  const { canvas, ctx, leaflet: map, run } = mapState;
  if (!canvas || !map) return;
  fitCanvas(canvas, ctx);
  if (!run) return;
  const T = screenTransform();

  const day = mapState.day;
  const now = performance.now() / 1000;
  const zoom = map.getZoom();
  const r = Math.max(1.4, Math.min(5, 1.4 + (zoom - 11) * 0.8));
  const split = mapState.split;
  let stats;
  if (split) {
    // The duel: the player's run left of the divider, the committee's on the right.
    const size = map.getSize();
    const cut = Math.round(size.x * split.x);
    const side = (one, x0, x1) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, size.y); ctx.clip();
      const out = drawRun(ctx, one, T, day, r, now);
      drawBubbles(ctx, map, day, one.events);
      ctx.restore();
      return out;
    };
    stats = side(split.left, 0, cut);
    split.leftStats = stats;
    split.rightStats = side(split.right, cut, size.x);
    drawBarrioNames(ctx, map);
    updateSplitBar(day);
  } else {
    stats = drawRun(ctx, run, T, day, r, now);
    drawBarrioNames(ctx, map);
    drawBubbles(ctx, map, day, run.events);
  }
  drawActors(ctx, T, r);
  const { zombies, bitten: bittenSoFar, vax } = stats;

  const n = (split ? split.data : mapState.data).config.population;
  $("#barZombies").style.width = `${Math.min(100, (100 * zombies) / mapState.peakZombies)}%`;
  $("#game").classList.toggle("is-alarm", zombies > 0.5 * mapState.peakZombies);
  $("#barBitten").style.width = `${(100 * bittenSoFar) / n}%`;
  $("#barVax").style.width = `${(100 * vax) / n}%`;
  $("#hudDay").textContent = Math.max(0, Math.floor(day));
  $("#hudZombies").textContent = fmt(zombies);
  $("#hudBitten").textContent = fmt(bittenSoFar);
  $("#hudVax").textContent = fmt(vax);
  $("#hudCity").textContent = pct(bittenSoFar / n);
  const rt = run.rt?.[Math.floor(day)];
  const rtBox = $("#hudRt");
  rtBox.textContent = rt == null ? "—" : dec(rt);
  rtBox.parentElement.classList.toggle("is-grow", rt != null && rt >= 1);
  rtBox.parentElement.classList.toggle("is-fall", rt != null && rt < 1);
  $("#daySlider").value = Math.floor(day);
  paintRange($("#daySlider"));
  drawProgress(day);
  const closedToday = (run.closed && run.closed[Math.max(0, Math.min(Math.floor(day) || 0, run.closed.length - 1))]) || [0, 0];
  const badge = $("#hudClosed");
  const names = [closedToday[0] ? "Mercado cerrado" : "", closedToday[1] ? "Colegios cerrados" : ""].filter(Boolean);
  badge.hidden = names.length === 0;
  badge.textContent = names.join(" · ");
  sound.setTension((zombies / n) * 10);
  // A bite sound for every wave of new cases while the run plays (rate-limited in sound.js).
  if (mapState.playing && bittenSoFar > (mapState.heardBitten ?? Infinity)) sound.infect((bittenSoFar - mapState.heardBitten) / 30);
  mapState.heardBitten = bittenSoFar;
  // A new week while the run plays: its wave banner.
  const week = Math.floor(day / 7) + 1;
  if (mapState.playing && !split && !mapState.holdTicker && day >= 1 && week !== mapState.shownWeek) {
    mapState.shownWeek = week;
    showWave(run, week);
  }
  if (day < 1) mapState.shownWeek = 0;
  const ev = split || mapState.holdTicker ? null : run.events.filter((e) => e.day <= day).at(-1);
  const ticker = $("#ticker");
  if (ev && ticker.textContent !== ev.text) {
    ticker.textContent = ev.text;
    ticker.classList.remove("is-new");
    void ticker.offsetWidth;
    ticker.classList.add("is-new");
    if (mapState.playing) {
      sound.bite();
      if (ev.text.includes("la plaga llega a")) sound.groan();
      if (ev.text.includes("1 de cada 4")) sound.laugh(true);  // the same children, after the plague
    }
  }
}

// A pixel skull for Zombies when the camera is close to the city (dots read better far away).
const SKULL = (() => {
  const rows = [
    ".KKKKK.",
    "KRRRRRK",
    "KRkRkRK",
    "KRkRkRK",
    "KRRRRRK",
    ".KRkRK.",
    ".KRRRK.",
  ];
  const colors = { K: "#1a0508", R: "#ff3b3b", k: "#1a0508" };
  const c = document.createElement("canvas");
  c.width = rows[0].length; c.height = rows.length;
  const g = c.getContext("2d");
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (colors[ch]) { g.fillStyle = colors[ch]; g.fillRect(x, y, 1, 1); } }));
  return c;
})();

// One run's people on the canvas; returns today's counts.
function drawRun(ctx, run, T, day, r, now) {
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
  const later = { vax: [], bitten: [], zombie: [], ripple: [], trail: [] };
  for (let i = 0; i < run.bitten.length; i += 1) {
    const p = run.bitten[i];
    const age = day - p[2];
    if (age < 0) continue;
    bittenSoFar += 1;
    const pt = { x: p[3] * T.k + T.dx, y: p[4] * T.k + T.dy };
    if (age < 1.5) later.ripple.push([pt, age]);
    if (age < run.latent) later.bitten.push(pt);
    else if (age < run.sick) { zombies += 1; later.zombie.push([pt, i]); }
    else later.trail.push(pt);  // already exorcised: leaves a mark where the plague passed
  }
  // Contagion lines: from the most likely source (a real contact who was a Zombie that day) to each
  // new case, fading over three days, so the chains of the outbreak can be followed on the map.
  if (run.source.length) {
    ctx.lineWidth = Math.max(0.8, r * 0.35);
    ctx.lineCap = "round";
    for (const fade of [0.55, 0.3, 0.12]) {
      const maxAge = fade === 0.55 ? 1 : fade === 0.3 ? 2 : 3;
      ctx.strokeStyle = `rgba(255, 70, 60, ${fade})`;
      ctx.beginPath();
      for (let i = 0; i < run.bitten.length; i += 1) {
        const p = run.bitten[i];
        const age = day - p[2];
        const from = run.source[i];
        if (from < 0 || age < maxAge - 1 || age >= maxAge) continue;
        const q = run.bitten[from];
        ctx.moveTo(q[3] * T.k + T.dx, q[4] * T.k + T.dy);
        ctx.lineTo(p[3] * T.k + T.dx, p[4] * T.k + T.dy);
      }
      ctx.stroke();
    }
  }
  // The trail: a permanent dark-red stain under everything, drawn as one path (cheap with thousands).
  if (later.trail.length) {
    ctx.fillStyle = "rgba(150, 22, 34, 0.32)";
    ctx.beginPath();
    for (const pt of later.trail) { ctx.moveTo(pt.x + r * 1.2, pt.y); ctx.arc(pt.x, pt.y, r * 1.2, 0, Math.PI * 2); }
    ctx.fill();
    ctx.fillStyle = "rgba(90, 10, 20, 0.55)";
    ctx.beginPath();
    for (const pt of later.trail) { ctx.moveTo(pt.x + r * 0.45, pt.y); ctx.arc(pt.x, pt.y, r * 0.45, 0, Math.PI * 2); }
    ctx.fill();
  }
  for (const p of run.vaccinated) {
    if (p[2] > day) continue;
    vax += 1;
    later.vax.push({ x: p[3] * T.k + T.dx, y: p[4] * T.k + T.dy });
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
  const skulls = r >= 3;
  if (skulls) ctx.imageSmoothingEnabled = false;
  for (const [pt, i] of later.zombie) {
    const pulse = 1 + 0.3 * Math.sin(now * 3 + i);
    ctx.fillStyle = "rgba(255, 59, 59, 0.16)";
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 2.3 * pulse, 0, Math.PI * 2); ctx.fill();
    if (skulls) {
      const size = Math.round(r * 2.6);
      ctx.drawImage(SKULL, Math.round(pt.x - size / 2), Math.round(pt.y - size / 2), size, size);
    } else dot(pt, r * 1.05, "#ff3b3b");
  }
  return { zombies, bitten: bittenSoFar, vax };
}

// ---------- the duel: the player's plan and the committee's on one map ----------

function enterSplit(d) {
  const data = { config: d.config, manta_scale: d.manta_scale, map: d.map };
  const left = makeRun(d.map.player, data, true);
  const right = makeRun(d.map.committee, data, true);
  mapState.split = { x: mapState.split?.x ?? 0.5, left, right, data, shownDay: -1 };
  setRun(left, Math.max(left.lastDay, right.lastDay), Math.max(left.peak, right.peak));
  $("#splitYouPlan").textContent = d.player.label;
  $("#splitThemPlan").textContent = d.committee.label;
  $("#mapRun").textContent = `duelo · corrida típica n.º ${d.map.run}`;
  $("#split").hidden = false;
  placeSplitLine();
  $("#play").disabled = false;
  $("#daySlider").disabled = false;
  closePanel("challenge");
  mapState.day = 0;
  play();
}

// Back to the main map: the last simulation if there is one, otherwise an empty city.
function exitSplit() {
  if (!leaveSplit()) return;
  if (mapState.data) {
    prepareRun();
    $("#mapRun").textContent = `corrida típica n.º ${mapState.data.map.run}`;
  } else {
    pause();
    mapState.run = null;
    $("#mapRun").textContent = "sin simular";
    $("#play").disabled = true;
    $("#daySlider").disabled = true;
  }
  drawPeople();
}

function leaveSplit() {
  if (!mapState.split) return false;
  mapState.split = null;
  $("#split").hidden = true;
  return true;
}

function placeSplitLine() {
  $("#splitLine").style.left = `${mapState.split.x * 100}%`;
  $("#splitLine").setAttribute("aria-valuenow", String(Math.round(mapState.split.x * 100)));
}

function updateSplitBar(day) {
  const { leftStats: you, rightStats: them } = mapState.split;
  $("#splitYouZ").textContent = fmt(you.zombies);
  $("#splitYouB").textContent = fmt(you.bitten);
  $("#splitThemZ").textContent = fmt(them.zombies);
  $("#splitThemB").textContent = fmt(them.bitten);
  $("#splitDay").textContent = `Día ${Math.max(0, Math.floor(day))}`;  // the arrival scene runs at day -0.01
  const today = Math.floor(day);
  if (today === mapState.split.shownDay) return;
  mapState.split.shownDay = today;
  const gap = you.bitten - them.bitten;
  $("#ticker").textContent = gap === 0
    ? `Día ${today}: empate, ${fmt(you.bitten)} mordidos en cada lado.`
    : `Día ${today}: ${gap > 0 ? "el comité" : "tu plan"} lleva ${fmt(Math.abs(gap))} mordidos menos (tú ${fmt(you.bitten)} · comité ${fmt(them.bitten)}).`;
}

function initSplit() {
  const line = $("#splitLine");
  const moveTo = (clientX) => {
    const box = $("#map").getBoundingClientRect();
    mapState.split.x = Math.min(0.9, Math.max(0.1, (clientX - box.left) / box.width));
    placeSplitLine();
    if (!mapState.playing) drawPeople();
  };
  line.addEventListener("pointerdown", (e) => {
    line.setPointerCapture(e.pointerId);
    const move = (ev) => moveTo(ev.clientX);
    const up = () => { line.removeEventListener("pointermove", move); line.removeEventListener("pointerup", up); };
    line.addEventListener("pointermove", move);
    line.addEventListener("pointerup", up);
  });
  line.addEventListener("keydown", (e) => {
    const step = { ArrowLeft: -0.05, ArrowRight: 0.05 }[e.key];
    if (!step || !mapState.split) return;
    e.preventDefault();
    const box = $("#map").getBoundingClientRect();
    moveTo(box.left + (mapState.split.x + step) * box.width);
  });
  $("#splitExit").addEventListener("click", exitSplit);
  $("#splitScore").addEventListener("click", () => openPanel("challenge"));
}

// Event bubbles: each headline pops up over its barrio for a few days.
function drawBubbles(ctx, map, day, events) {
  if (map.getZoom() < 10) return;
  const small = map.getSize().x < 600;  // phones: a slightly smaller card, same look
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const placed = [];
  const now = performance.now() / 1000;
  for (const ev of events) {
    const age = day - ev.day;
    if (!ev.bubble?.where || age < 0 || age > 4) continue;
    const accent = ev.bubble.color || "#ff3b3b";
    const isVaccine = accent !== "#ff3b3b";
    // Pops in with a little overshoot during the first quarter day, fades on the last day.
    const t = Math.min(1, age * 4);
    const pop = (1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2) * (small ? 0.86 : 1);
    const pt = map.latLngToContainerPoint([ev.bubble.where.lat, ev.bubble.where.lon]);
    const title = ev.bubble.title.toUpperCase();
    const sub = `DÍA ${ev.day} · SEMANA ${Math.floor(ev.day / 7) + 1}`;
    ctx.font = "700 14px 'Barlow Condensed', sans-serif";
    const tw = ctx.measureText(title).width;
    ctx.font = "600 10px 'Barlow Condensed', sans-serif";
    const w = Math.max(tw, ctx.measureText(sub).width) + 50;
    const h = 36;
    // Kept inside the screen (scaled size on phones), the pointer still lands on the spot.
    const k = small ? 0.86 : 1;
    const half = (w * k) / 2;
    const cx = Math.min(map.getSize().x - 8 - half, Math.max(8 + half, pt.x));
    const x = Math.round(pt.x + (cx - pt.x) / k - w / 2);
    let y = Math.round(pt.y - 50 - h / 2);
    while (placed.some((r) => x < r.x + r.w && r.x < x + w && Math.abs(r.y - y) < h + 6)) y -= h + 8;
    placed.push({ x, y, w });

    ctx.save();
    ctx.globalAlpha = age > 3 ? 4 - age : 1;
    // A pulse on the exact spot.
    const ring = (now * 1.2) % 1;
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.globalAlpha *= 1 - ring;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 6 + ring * 16, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = age > 3 ? 4 - age : 1;
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2); ctx.fill();

    ctx.translate(pt.x, pt.y); ctx.scale(pop, pop); ctx.translate(-pt.x, -pt.y);
    // Pointer from the card to the spot.
    ctx.fillStyle = "rgba(14, 8, 12, 0.94)";
    ctx.beginPath(); ctx.moveTo(pt.x - 7, y + h / 2 - 1); ctx.lineTo(pt.x, pt.y - 7); ctx.lineTo(pt.x + 7, y + h / 2 - 1); ctx.fill();
    // The card: dark, rounded, glowing in its accent color.
    ctx.shadowColor = accent; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.roundRect(x, y - h / 2, w, h, 6); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.roundRect(x, y - h / 2, 5, h, [6, 0, 0, 6]); ctx.fill();
    // Icon: a pixel skull for the plague, a cyan cross for the first dose.
    const ix = x + 13, iy = y - 9;
    if (isVaccine) {
      ctx.fillStyle = accent;
      ctx.fillRect(ix + 6, iy + 1, 6, 16); ctx.fillRect(ix + 1, iy + 6, 16, 6);
    } else {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(SKULL, ix, iy, 18, 18);
    }
    ctx.fillStyle = "#fff4ea";
    ctx.font = "700 14px 'Barlow Condensed', sans-serif";
    ctx.fillText(title, x + 40, y - 5);
    ctx.fillStyle = accent;
    ctx.font = "600 10px 'Barlow Condensed', sans-serif";
    ctx.fillText(sub, x + 40, y + 9);
    ctx.restore();
  }
}

// Barrio card: what happened in one barrio up to the current day of the run.
function showBarrioCard(latlng) {
  const run = mapState.run;
  const barrios = mapState.data?.map.barrios;
  if (!run || !barrios) return;
  const name = nearestBarrio(latlng.lat, latlng.lng, barrios);
  const day = Math.floor(mapState.day);
  const scale = mapState.data.manta_scale;
  let bitten = 0;
  let zombies = 0;
  let firstDay = null;
  for (const p of run.bitten) {
    if (p[2] > day || nearestBarrio(p[0], p[1], barrios) !== name) continue;
    bitten += 1;
    const age = day - p[2];
    if (age >= run.latent && age < run.sick) zombies += 1;
    if (firstDay === null || p[2] < firstDay) firstDay = p[2];
  }
  let vax = 0;
  for (const p of run.vaccinated) if (p[2] <= day && nearestBarrio(p[0], p[1], barrios) === name) vax += 1;
  const note = firstDay === null ? "Todavía sin casos." : `Primer caso el día ${firstDay}. ≈ ${fmt(bitten * scale)} mantenses mordidos.`;
  const card = $("#barrioCard");
  card.innerHTML = `<button type="button" class="bcard__close" aria-label="Cerrar la ficha">×</button>
    <p class="bcard__eyebrow">Barrio · día ${day}</p><h3 class="bcard__name">${name}</h3>
    <dl class="bcard__stats">
      <div class="bcard__z"><dt>Zombies ahora</dt><dd>${fmt(zombies)}</dd></div>
      <div class="bcard__b"><dt>Mordidos</dt><dd>${fmt(bitten)}</dd></div>
      <div class="bcard__v"><dt>Vacunados</dt><dd>${fmt(vax)}</dd></div>
    </dl><p class="bcard__note">${note}</p>`;
  card.hidden = false;
  card.querySelector(".bcard__close").addEventListener("click", () => { card.hidden = true; });
  mapState.cardBarrio = name;
}

// How the city is doing on this day of the replayed run (exact counts).
// Barrio names on top of the people, so the outbreak never hides them.
function drawBarrioNames(ctx, map) {
  const barrios = mapState.data?.map.barrios;
  if (!barrios || map.getZoom() < 12) return;
  ctx.font = "700 12px 'Barlow Condensed', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const b of barrios) {
    const pt = map.latLngToContainerPoint([b.lat, b.lon]);
    const text = b.name.toUpperCase();
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = "rgba(8, 20, 30, 0.82)";
    ctx.fillRect(pt.x - w / 2, pt.y - 9, w, 18);
    ctx.fillStyle = "#e3edf3";
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
    closePanel("real");
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
    $("#autoText").textContent = "Todavía no hay una prueba guardada. Pulsa el botón para buscar dónde falla la estrategia.";
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

// Local server: /api/jury answers at once. AWS: the attack runs as a Step Functions
// Distributed Map job, so start it and poll until the report is ready.
async function attack(body) {
  const res = await fetch(`${API}/jury`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 404) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `Error ${res.status}`);
    return data;
  }
  const { job_id: id } = await getJSON(`${API}/jobs`, { ...body, kind: "jury" });
  const started = performance.now();
  for (;;) {
    await wait(4000);
    const job = await getJSON(`${API}/jobs/${id}`);
    if (job.status === "SUCCEEDED") return job.report;
    if (job.status !== "RUNNING") throw new Error(`el trabajo terminó en ${job.status}`);
    $("#juryHint").textContent = `Buscando dónde falla la estrategia: probando 24 brotes difíciles en paralelo en AWS… ${Math.round((performance.now() - started) / 1000)} s`;
  }
}

async function runJury() {
  const btn = $("#runJury");
  btn.disabled = true;
  $("#juryHint").textContent = "Buscando dónde falla la estrategia: probando 24 brotes difíciles…";
  try {
    const jury = await attack({ ...readForm(), points: 24 });
    state.jury = jury;
    renderJury(jury);
    $("#juryHint").textContent = `Listo: ${jury.points.length} brotes probados con ${jury.runs_per_point} corridas cada uno.`;
  } catch (err) {
    $("#juryHint").textContent = `No se pudo correr la prueba: ${err.message}.`;
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
        titleFont: { family: "Barlow Condensed", size: 12 }, bodyFont: { size: 12 }, padding: 10, boxPadding: 4,
      },
    },
    scales: Object.fromEntries(Object.entries(scales).map(([k, v]) => [k, {
      grid: { color: COLORS.grid, drawTicks: false },
      border: { display: false },
      ...v,
      title: v.title ? { ...v.title, display: !small || k === "x", font: { size: small ? 11 : 12 } } : undefined,
      ticks: { font: { family: "Barlow Condensed", size: small ? 10 : 11 }, padding: 6,
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
  const msg = `No se pudo cargar la configuración: ${err.message}. ¿Está corriendo el servidor?`;
  $("#runHint").textContent = msg;
  $("#ticker").textContent = msg;
  hideLoading();
});
