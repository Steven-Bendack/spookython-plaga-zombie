// How the plague reaches Manta: a ship docks at the port and a car drives the
// infected passenger through the real streets (OpenStreetMap) to patient zero.
// This file only knows geometry and pixels; app.js runs the scene on the map.

// Port of Manta: the ship comes in from the open sea to the dock.
export const SEA = [-0.895, -80.745];
export const DOCK = [-0.9372, -80.7208];
// Eloy Alfaro airport: the plane lands from the east along the runway.
export const AIR_FROM = [-0.985, -80.56];
export const AIRPORT = [-0.9469, -80.6795];
// The road from Portoviejo (E30) enters Manta from the southeast.
export const PORTOVIEJO = [-1.054, -80.454];
export const ROAD_IN = [-0.990, -80.680];

// ---------- street routing: shortest path on the street graph ----------

const key = (lat, lon) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

// Nodes are street vertices (shared vertices join streets at crossings).
export function streetGraph(lines) {
  const index = new Map();
  const nodes = [];
  const edges = [];
  const node = ([lat, lon]) => {
    const k = key(lat, lon);
    if (!index.has(k)) { index.set(k, nodes.length); nodes.push([lat, lon]); edges.push([]); }
    return index.get(k);
  };
  for (const line of lines) {
    let prev = node(line.p[0]);
    for (let i = 1; i < line.p.length; i += 1) {
      const cur = node(line.p[i]);
      const [a, b] = [nodes[prev], nodes[cur]];
      const d = Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos(a[0] * Math.PI / 180));
      edges[prev].push([cur, d]);
      edges[cur].push([prev, d]);
      prev = cur;
    }
  }
  return { nodes, edges };
}

function nearest(graph, [lat, lon]) {
  let best = 0;
  let bestD = Infinity;
  graph.nodes.forEach(([a, b], i) => {
    const d = (a - lat) ** 2 + (b - lon) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Dijkstra with a binary heap; returns [lat, lon] points from `from` to `to`.
export function route(graph, from, to) {
  const start = nearest(graph, from);
  const goal = nearest(graph, to);
  const dist = new Float64Array(graph.nodes.length).fill(Infinity);
  const prev = new Int32Array(graph.nodes.length).fill(-1);
  const heap = [[0, start]];
  dist[start] = 0;
  const push = (item) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, u] = pop();
    if (u === goal) break;
    if (d > dist[u]) continue;
    for (const [v, w] of graph.edges[u]) {
      if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; push([d + w, v]); }
    }
  }
  if (!Number.isFinite(dist[goal])) return [from, to];  // disconnected: drive straight
  const path = [];
  for (let u = goal; u !== -1; u = prev[u]) path.push(graph.nodes[u]);
  return [from, ...path.reverse(), to];
}

// Position at fraction t (0..1) of the way along a polyline, plus its heading.
export function along(points, t) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let left = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i += 1) {
    if (left <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, left / seg[i]) : 1;
      const [a, b] = [points[i], points[i + 1]];
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: Math.atan2(-(b[0] - a[0]), b[1] - a[1]) };
    }
    left -= seg[i];
  }
  return { at: points[points.length - 1], heading: 0 };
}

// ---------- pixel sprites (drawn facing right) ----------

const SHIP = [
  "..........ss........",
  ".........ss.........",
  "........cc..........",
  "......wwwwww........",
  "......wbwbww........",
  "...rrrrrrrrrrrrrr...",
  "..RRRRRRRRRRRRRRRRR.",
  "...RRRRRRRRRRRRRRR..",
  "....kkkkkkkkkkkkk...",
];
const CAR = [
  "...wwwww....",
  "..wbbwbbw...",
  ".yyyyyyyyyy.",
  "yyyyyyyyyyyl",
  "yyyyyyyyyyyy",
  ".kk.....kk..",
];
const PLANE = [
  "..t.................",
  "..tt........ww......",
  "..ttt.......www.....",
  "wwwwwwwwwwwwwwwwwwn.",
  "wbwbwbwbwbwbwbwwwwnn",
  "wwwwwwwwwwwwwwwwwwn.",
  "............www.....",
  "............ww......",
];
const PALETTE = {
  t: "#b8432f", n: "#2b2f45",
  s: "#9aa6b2", c: "#2b2f45", w: "#e8e4dc", b: "#3fa8d8", r: "#f2f2f2", R: "#b8432f", k: "#151018",
  y: "#f2c230", l: "#fff6b0",
};

function image(grid) {
  const svg = grid.flatMap((row, y) => [...row].map((c, x) => (PALETTE[c]
    ? `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${PALETTE[c]}"/>` : ""))).join("");
  const img = new Image();
  img.src = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${grid[0].length} ${grid.length}" width="${grid[0].length * 4}" height="${grid.length * 4}" shape-rendering="crispEdges">${svg}</svg>`)}`;
  return { img, w: grid[0].length, h: grid.length };
}

export const SPRITES = { ship: image(SHIP), car: image(CAR), plane: image(PLANE) };
