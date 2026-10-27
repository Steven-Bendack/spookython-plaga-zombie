// The SpookyThon ghost as pixel art: a hooded ghost with a black visor and
// orange eyes, drawn from a character grid so it stays crisp at any size.
const PIXELS = [
  "......oooooooo......",
  "....ooPPPPPPPPoo....",
  "...oPPPpppppPPPPo...",
  "..oPPppPPPPPPpPPPo..",
  "..oPPPPPPPPPPPPPPo..",
  ".oPPPPWWWWWWWWPPPPo.",
  ".oPPPWWWWWWWWWWPPPo.",
  ".oPPWWKKKKKKKKWWPPo.",
  ".oPPWKKKKKKKKKKWPPo.",
  ".oPPWKKEEKKEEKKWPPo.",
  ".oPPWKKEEKKEEKKWPPo.",
  ".oPPWKKKKKKKKKKWPPo.",
  ".oPPWWKKKKKKKKWWPPo.",
  "oPPPWWWWWWWWWWWWPPPo",
  "oPPWWWWWWWWWWWWWWPPo",
  "oPPWWWWWWWWWWWWWWPPo",
  "oPWWWWWWWWWWWWWWWWPo",
  "oPWWWWWWWWWWWWWWWWPo",
  "owWWWWWWWWWWWWWWWWwo",
  "owWWWWWWWWWWWWWWWWwo",
  ".oWWWwWWWWwWWWWwWWo.",
  "..oWo.oWWo.oWWo.oo..",
  "...o...oo...oo......",
];
const COLORS = {
  o: "#1a0f2e", P: "#5b2a86", p: "#8a4fc4", W: "#f4f1ff", w: "#c9c3dd", K: "#0b0712", E: "#ff9a1f",
};

export function ghostSVG() {
  const rects = [];
  PIXELS.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (COLORS[c]) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${COLORS[c]}"${c === "E" ? ' class="ghost__eye"' : ""}/>`);
    });
  });
  return `<svg viewBox="0 0 ${PIXELS[0].length} ${PIXELS.length}" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
}
