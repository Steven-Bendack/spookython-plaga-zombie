// Pixel-art sprites for the loading scene: a zombie chasing a neighbour of
// Manta, who gets bitten and turns. Drawn from character grids like the ghost.
const ZOMBIE = [
  "....hhhh.......",
  "...hhhhhh......",
  "...zzzzzz......",
  "...zrzzrz......",
  "...zzzzzz......",
  "...zzmmzz......",
  "....zzzz.......",
  "..tttttttzzzzz.",
  "..ttTtttt......",
  "..tttttTtzzzzz.",
  "...tTttt.......",
  "...pppppp......",
  "...pp..pp......",
  "...pp..pp......",
  "..kkk..kkk.....",
];

// The neighbour: running, arms pumping. The same grid turns into a zombie by
// swapping the palette (green skin, red eyes, torn shirt).
const HUMAN = [
  "....hhhh....",
  "...hhhhhh...",
  "...hssssh...",
  "...sseses...",
  "...ssssss...",
  "....ssss....",
  "..bbbbbbbb..",
  ".sbbbbbbbbs.",
  ".s.bbbbbb.s.",
  "...bbbbbb...",
  "...pppppp...",
  "...pp..pp...",
  "...pp..pp...",
  "..kkk..kkk..",
];

const ZOMBIE_COLORS = {
  h: "#2a1d14", z: "#7fbf5a", r: "#ff3b3b", m: "#5a0f12", t: "#6b5a7a", T: "#3d3048", p: "#2b2f45", k: "#151018",
};
const HUMAN_COLORS = { h: "#3a2416", s: "#e0a878", e: "#1a0f0a", b: "#2f7fd8", p: "#2b2f45", k: "#151018" };
const TURNED_COLORS = { ...HUMAN_COLORS, s: "#7fbf5a", e: "#ff3b3b", b: "#5d6b7a" };

function sprite(grid, colors) {
  const rects = [];
  grid.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (colors[c]) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${colors[c]}"/>`);
    });
  });
  return `<svg viewBox="0 0 ${grid[0].length} ${grid.length}" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
}

export const zombieSVG = () => sprite(ZOMBIE, ZOMBIE_COLORS);
export const humanSVG = () => sprite(HUMAN, HUMAN_COLORS);
export const turnedSVG = () => sprite(HUMAN, TURNED_COLORS);
