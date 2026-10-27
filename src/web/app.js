// Plaga Zombie · Manta — UI. Plain ES module, no build step.
const API = window.PLAGA_API || "/api";

const COLORS = { none: "#8a9499", random: "#b9852f", strategy: "#0f7c7a", zombie: "#c8372d", tie: "#c3cdc9" };
const STRATEGY_COLORS = { ring_hubs: "#0f7c7a", ring: "#2f9e8f", degree: "#3c6fb0", acquaintance: "#6b4fa0" };
const FIELDS = ["r0", "doses_per_day", "vaccine_efficacy", "seed_location", "vaccine_start_day",
  "detection_prob", "detection_delay", "initial_cases", "runs", "strategy", "seed"];

const $ = (sel) => document.querySelector(sel);
const form = $("#form");
const state = { meta: null, defaults: null, map: null, jury: null, last: null, charts: {} };

// Thousands with a thin space (12 345): avoids "3.922" being read as a decimal.
const fmt = (x) => Math.round(x).toLocaleString("en-US").replace(/,/g, " ");
const pct = (x) => `${Math.round(x * 100)} %`;

// ---------- bootstrapping ----------

async function init() {
  const [meta, map, jury] = await Promise.all([
    getJSON(`${API}/meta`),
    getJSON("data/decision_map.json").catch(() => null),
    getJSON("data/jury.json").catch(() => null),
  ]);
  state.meta = meta;
  state.defaults = meta.defaults;
  state.map = map;
  state.jury = jury;

  fillSelect($("#seedLocation"), meta.seed_locations);
  fillSelect($("#strategy"), [{ value: "auto", label: "Automática (torneo)" }, ...meta.strategies]);
  renderPresets(meta.presets);

  const fromUrl = Object.fromEntries(new URLSearchParams(location.search));
  setForm({ ...meta.defaults, ...fromUrl });
  updateOutputs();
  renderJury(jury);
  renderDecisionMap(map);

  form.addEventListener("input", () => { updateOutputs(); clearPresetSelection(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); runSimulation(); });
  $("#dice").addEventListener("click", () => {
    form.seed.value = Math.floor(Math.random() * 1e6);
    updateOutputs();
  });
  $("#copyLink").addEventListener("click", copyLink);
  $("#runJury").addEventListener("click", runJury);

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

// ---------- form ----------

function readForm() {
  const data = Object.fromEntries(new FormData(form));
  const out = {};
  for (const key of FIELDS) {
    const raw = data[key];
    if (raw === undefined || raw === "") continue;
    out[key] = ["seed_location", "strategy"].includes(key) ? raw : Number(raw);
  }
  return out;
}

function setForm(values) {
  for (const key of FIELDS) {
    if (values[key] !== undefined && form.elements[key]) form.elements[key].value = values[key];
  }
}

function updateOutputs() {
  const v = readForm();
  const scale = state.meta?.manta_scale ?? 1;
  $("#r0Out").textContent = v.r0.toFixed(1);
  $("#dosesOut").textContent = v.doses_per_day;
  $("#dosesHelp").textContent = `≈ ${fmt(v.doses_per_day * scale)} dosis diarias en Manta (${(100 * v.doses_per_day / (state.defaults?.population || 1)).toFixed(1)} % de la población).`;
  $("#effOut").textContent = pct(v.vaccine_efficacy);
  $("#startOut").textContent = v.vaccine_start_day;
  $("#detOut").textContent = pct(v.detection_prob);
  $("#delayOut").textContent = v.detection_delay;
  showInstantAnswer(v);
}

function renderPresets(presets) {
  const box = $("#presets");
  const d = state.defaults;
  const apply = {
    base: () => setForm(d),
    double_r0: () => setForm({ r0: +(d.r0 * 2).toFixed(1) }),
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
  const label = labelOf(cell.best);
  box.hidden = false;
  box.innerHTML = `Respuesta inmediata (mapa precalculado): <strong>${label}</strong>, gana a Azar en ${pct(cell.win_rate_vs_random)} de las corridas parecidas. Pulsa Recomendar para confirmarlo con tu semilla.`;
}

function labelOf(name) {
  const s = state.meta?.strategies.find((x) => x.value === name);
  return s ? s.label : name;
}

// ---------- simulation ----------

async function runSimulation() {
  const btn = $("#run");
  btn.disabled = true;
  btn.textContent = "Simulando…";
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
  $("#scale").textContent = scale.toFixed(1);
  $("#wasted").textContent = `Dosis perdidas en Mordidos invisibles: ${pct(data.wasted_doses.share)}`;
  renderStrip(data.saved_vs_random.per_run, data.config.runs);
  renderCurves(data);
  renderTable(data);
  renderCertificate(data, seconds);
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
    datasets.push({ label: pol.label, data: pol.curves.I, borderColor: color, borderWidth: key === "strategy" ? 3 : 2, pointRadius: 0, fill: false, tension: 0.25 });
  }
  drawChart("curveChart", {
    type: "line",
    data: { labels: days, datasets },
    options: chartOptions({
      x: { title: { display: true, text: "Día" }, ticks: { maxTicksLimit: 10 } },
      y: { title: { display: true, text: "Zombies (agentes)" }, beginAtZero: true },
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
  $("#certTime").textContent = `${seconds.toFixed(1)} s`;
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

// ---------- Jury Mode ----------

function renderJury(jury) {
  if (!jury) {
    $("#frontier").textContent = "Todavía no hay un ataque guardado. Pulsa el botón para lanzar uno.";
    return;
  }
  $("#frontier").textContent = jury.frontier_text;
  const bar = (label, share) => `<div class="share"><span>${label}</span><span class="share__bar">
      <span style="width:${share.win * 100}%;background:${COLORS.strategy}" title="Gana ${pct(share.win)}"></span>
      <span style="width:${share.tie * 100}%;background:${COLORS.tie}" title="Empata ${pct(share.tie)}"></span>
      <span style="width:${share.loss * 100}%;background:${COLORS.zombie}" title="Pierde ${pct(share.loss)}"></span>
    </span></div>`;
  $("#shares").innerHTML =
    bar(`${jury.strategy_label} fija: gana ${pct(jury.fixed_share.win)}`, jury.fixed_share) +
    bar(`Torneo automático: gana ${pct(jury.auto_share.win)}`, jury.auto_share);

  const groups = { win: [], tie: [], loss: [] };
  for (const p of jury.points) {
    groups[p.fixed.outcome].push({ x: p.condition.r0, y: p.condition.dose_factor, p });
  }
  const ds = (key, label, color) => ({ label, data: groups[key], backgroundColor: color, pointRadius: 6, pointHoverRadius: 8 });
  drawChart("juryChart", {
    type: "scatter",
    data: { datasets: [ds("win", "Gana", COLORS.strategy), ds("tie", "Empata", COLORS.tie), ds("loss", "Pierde", COLORS.zombie)] },
    options: chartOptions({
      x: { title: { display: true, text: "R0 (contagio)" }, min: 1, max: 5.2 },
      y: { type: "logarithmic", title: { display: true, text: "Dosis (× base)" }, min: 0.2, max: 2.2,
        ticks: { callback: (v) => [0.25, 0.5, 1, 2].includes(+v.toFixed(2)) ? `${v}×` : "" } },
    }, {}, {
      label: (ctx) => {
        const p = ctx.raw.p;
        const c = p.condition;
        return `R0 ${c.r0.toFixed(1)} · dosis ${c.dose_factor.toFixed(2)}× · eficacia ${pct(c.vaccine_efficacy)} · inicio ${c.seed_location} · detección ${c.detection_delay} d → ${p.fixed.saved_mean > 0 ? "+" : ""}${fmt(p.fixed.saved_mean)} vs Azar (torneo: ${labelOf(p.auto.pick)})`;
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
    return `<div class="dmap__row"><div class="dmap__axis">R0 ${r0}</div>${tds}</div>`;
  }).join("");
  const head = `<div class="dmap__row"><div></div>${factors.map((f) => `<div class="dmap__axis">${f}× dosis</div>`).join("")}</div>`;
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

function chartOptions(scales, legendLabels = {}, tooltipCallbacks = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 400 },
    interaction: { mode: "nearest", intersect: false },
    plugins: {
      legend: { labels: { usePointStyle: true, boxWidth: 8, font: { family: "IBM Plex Sans" }, ...legendLabels } },
      tooltip: { callbacks: tooltipCallbacks, filter: (item) => !item.dataset._band },
    },
    scales: Object.fromEntries(Object.entries(scales).map(([k, v]) => [k, {
      grid: { color: "#e3e9e6" }, ticks: { font: { family: "IBM Plex Mono", size: 11 } }, ...v,
    }])),
  };
}

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
