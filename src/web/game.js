// Committee Mode: the player decides week by week, seeing only detected Zombies.
// Stateless: every turn sends all decisions and the engine replays the run.
import * as sound from "./sound.js";

const API = window.PLAGA_API || "/api";
const $ = (sel) => document.querySelector(sel);
const fmt = (x) => Math.round(x).toLocaleString("en-US").replace(/,/g, " ");
const MANTA_VIEW = [-0.975, -80.735];

const game = {
  seed: 2026, difficulty: "normal", decisions: [], last: null, busy: false,
  map: null, canvas: null, ctx: null, streets: null, truth: false,
};

export function initGame() {
  document.querySelectorAll("[data-open-game]").forEach((b) => b.addEventListener("click", openGame));
  $("#gameClose").addEventListener("click", closeGame);
  $("#gameStartBtn").addEventListener("click", startGame);
  $("#gameNext").addEventListener("click", () => nextWeek(false));
  $("#gameFinish").addEventListener("click", () => nextWeek(true));
  $("#gameAgain").addEventListener("click", () => { showStep("start"); });
  $("#gameMode").addEventListener("change", syncModeUI);
  $("#gameMarket").addEventListener("change", syncModeUI);
  $("#gameSchools").addEventListener("change", syncModeUI);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#game").hidden) closeGame(); });
}

function openGame() {
  $("#game").hidden = false;
  document.body.classList.add("game-open");
  showStep("start");
  $("#gameSeed").value = Math.floor(Math.random() * 9000) + 1000;
  if (!sound.isOn()) sound.start().catch(() => {});
}

function closeGame() {
  $("#game").hidden = true;
  document.body.classList.remove("game-open");
}

function showStep(step) {
  $("#gameStartView").hidden = step !== "start";
  $("#gameMain").hidden = step === "start";
  $("#gameEnd").hidden = step !== "end";
  $("#gamePanel").hidden = step === "end";
}

async function startGame() {
  game.seed = Number($("#gameSeed").value) || 2026;
  game.difficulty = document.querySelector("input[name=difficulty]:checked")?.value || "normal";
  game.decisions = [];
  game.truth = false;
  showStep("play");
  initMap();
  await call([], "Empieza la partida…");
}

function currentDecision() {
  return {
    mode: $("#gameMode").value,
    barrio: $("#gameBarrio").value,
    market: $("#gameMarket").checked,
    schools: $("#gameSchools").checked,
  };
}

async function nextWeek(toTheEnd) {
  if (game.busy || !game.last || game.last.over) return;
  const d = currentDecision();
  const weeksLeft = Math.ceil((game.last.config.days - game.last.day) / 7);
  const plan = [...game.decisions, ...Array(toTheEnd ? weeksLeft : 1).fill(d)];
  await call(plan, toTheEnd ? "Simulando hasta el final…" : "Pasa una semana…");
}

async function call(plan, label) {
  game.busy = true;
  $("#gameNext").disabled = true;
  $("#gameFinish").disabled = true;
  $("#gameStatus").textContent = label;
  try {
    const res = await fetch(`${API}/game`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: game.seed, difficulty: game.difficulty, decisions: plan }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    game.decisions = plan;
    game.last = data;
    render(data);
    if (data.over) finish(data);
  } catch (err) {
    $("#gameStatus").textContent = `No se pudo avanzar: ${err.message}`;
  } finally {
    game.busy = false;
    $("#gameNext").disabled = false;
    $("#gameFinish").disabled = false;
  }
}

function render(data) {
  const start = data.week === 0;
  const week = data.week + 1;
  $("#gWeek").textContent = data.over ? "—" : week;
  $("#gDay").textContent = data.day;
  $("#gBudget").textContent = fmt(start ? data.weekly_budget : data.budget_left);
  $("#gDetected").textContent = fmt(data.visible.zombies.length);
  $("#gDoses").textContent = fmt(data.visible.doses_total);
  $("#gameStatus").textContent = start
    ? "Semana 1. Nadie sabe todavía cuántos hay: decide cómo usar las primeras vacunas."
    : `Fin de la semana ${data.week}. Ves ${fmt(data.visible.zombies.length)} zombis detectados; los que no ves también muerden.`;
  if (!game.barriosFilled) {
    $("#gameBarrio").innerHTML = data.barrios.map((b) => `<option>${b}</option>`).join("");
    game.barriosFilled = true;
  }
  $("#gCostMarket").textContent = fmt(data.costs.market_week);
  $("#gCostSchools").textContent = fmt(data.costs.schools_week);
  syncModeUI();
  const news = data.news.slice().reverse();
  $("#gameNews").innerHTML = news.length
    ? news.map((n) => `<li>${n.text}</li>`).join("")
    : "<li>Sin noticias todavía. La ciudad duerme.</li>";
  if (news.length && !start) sound.bite();
  sound.setTension(Math.min(1, data.visible.zombies.length / 120));
  drawSpark(data.visible.detected_series);
  game.points = { zombies: data.visible.zombies, vaccinated: data.visible.vaccinated };
  draw();
}

function syncModeUI() {
  $("#gameBarrioWrap").hidden = $("#gameMode").value !== "barrio";
  const d = game.last;
  if (!d) return;
  const cost = d.weekly_budget + ($("#gameMarket").checked ? d.costs.market_week : 0)
    + ($("#gameSchools").checked ? d.costs.schools_week : 0);
  $("#gCostWeek").textContent = `Esta semana llegan ${fmt(d.weekly_budget)} unidades. Cierres elegidos: ${fmt(cost - d.weekly_budget)}.`;
}

function finish(data) {
  const r = data.result;
  showStep("end");
  $("#gameEndTitle").textContent = r.title;
  const rows = [
    ["Tu comité", r.you.infected, "you"],
    [`Comité automático (${r.rivals.auto.label})`, r.rivals.auto.infected, "auto"],
    ["Vacunar al azar", r.rivals.random.infected, "random"],
    ["No hacer nada", r.rivals.none.infected, "none"],
  ];
  const max = Math.max(...rows.map((x) => x[1]));
  $("#gameBars").innerHTML = rows.map(([label, v, k]) => `
    <div class="gbar gbar--${k}"><span class="gbar__label">${label}</span>
      <span class="gbar__track"><span style="width:${(100 * v) / max}%"></span></span>
      <strong>${fmt(v)}</strong></div>`).join("");
  $("#gameEndText").textContent =
    `Promedio de mordidos en las mismas ${r.score_runs} corridas. Tu plan salvó ${fmt(r.you.saved_vs_none)} personas frente a no hacer nada `
    + `(≈ ${fmt(r.you.saved_vs_none * r.manta_scale)} en Manta) y le ganó al comité automático en ${r.wins_vs_auto} de ${r.score_runs} corridas.`;
  // Reveal: everyone who was bitten, including those the committee never saw.
  game.truth = true;
  game.points = { truth: r.map.bitten, vaccinated: r.map.vaccinated, days: r.map.days };
  draw();
}

// ---------- map ----------

function initMap() {
  if (game.map) { setTimeout(() => { game.map.invalidateSize(); draw(); }, 50); return; }
  const map = L.map("gameMap", { zoomControl: true, scrollWheelZoom: true }).setView(MANTA_VIEW, 13);
  const esri = (path) => `https://server.arcgisonline.com/ArcGIS/rest/services/${path}/MapServer/tile/{z}/{y}/{x}`;
  L.tileLayer(esri("Canvas/World_Dark_Gray_Base"), { maxZoom: 16, attribution: "Mapa &copy; Esri, HERE, Garmin, &copy; OpenStreetMap" }).addTo(map);
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, { position: "absolute", inset: "0", zIndex: 450, pointerEvents: "none" });
  map.getContainer().appendChild(canvas);
  Object.assign(game, { map, canvas, ctx: canvas.getContext("2d") });
  map.on("move zoom resize", draw);
  new ResizeObserver(() => { map.invalidateSize(); draw(); }).observe(map.getContainer());
  fetch("data/manta_streets.json").then((r) => r.json()).then((d) => { game.streets = d.lines; draw(); }).catch(() => {});
}

function draw() {
  const { map, canvas, ctx } = game;
  if (!map) return;
  const size = map.getSize();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = size.x * ratio; canvas.height = size.y * ratio;
  canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, size.x, size.y);
  // Fog of war: the city is dark except for what the committee knows.
  if (!game.truth) { ctx.fillStyle = "rgba(8, 5, 10, 0.35)"; ctx.fillRect(0, 0, size.x, size.y); }
  if (game.streets) {
    ctx.strokeStyle = "rgba(232, 210, 170, 0.18)"; ctx.lineWidth = 0.8; ctx.beginPath();
    for (const line of game.streets) {
      line.p.forEach((ll, i) => { const pt = map.latLngToContainerPoint(ll); if (i) ctx.lineTo(pt.x, pt.y); else ctx.moveTo(pt.x, pt.y); });
    }
    ctx.stroke();
  }
  const pts = game.points || {};
  const r = Math.max(1.6, 1.6 + (map.getZoom() - 11) * 0.8);
  const ll = (p) => map.latLngToContainerPoint([p[0] / 1e4, p[1] / 1e4]);
  ctx.strokeStyle = "rgba(10,6,12,.9)";
  for (const p of pts.vaccinated || []) {
    const pt = ll(p);
    ctx.lineWidth = r * 0.9; ctx.strokeStyle = "rgba(10,6,12,.9)";
    ctx.beginPath(); ctx.moveTo(pt.x - r, pt.y); ctx.lineTo(pt.x + r, pt.y); ctx.moveTo(pt.x, pt.y - r); ctx.lineTo(pt.x, pt.y + r); ctx.stroke();
    ctx.lineWidth = r * 0.45; ctx.strokeStyle = "#38e8ff"; ctx.stroke();
  }
  if (game.truth) {
    const days = pts.days || 150;
    for (const p of pts.truth || []) {
      const t = p[2] / days;
      const pt = ll(p);
      ctx.fillStyle = `hsl(${40 - 40 * t}, 95%, ${60 - 15 * t}%)`;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 0.8, 0, Math.PI * 2); ctx.fill();
    }
  }
  for (const p of pts.zombies || []) {
    const pt = ll(p);
    ctx.fillStyle = "rgba(255,59,59,.2)"; ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff3b3b"; ctx.beginPath(); ctx.arc(pt.x, pt.y, r * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = r * 0.35; ctx.strokeStyle = "rgba(10,6,12,.9)"; ctx.stroke();
  }
}

function drawSpark(series) {
  const canvas = $("#gameSpark");
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth; const h = canvas.clientHeight;
  canvas.width = w * ratio; canvas.height = h * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!series || series.length < 2) return;
  const max = Math.max(1, ...series);
  ctx.strokeStyle = "#ff3b3b"; ctx.lineWidth = 1.6; ctx.beginPath();
  series.forEach((v, i) => { const x = (i / 154) * w; const y = h - 2 - (v / max) * (h - 6); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.stroke();
}
