// The SpookyThon mascot as pixel art: a friendly ghost in a purple witch hat
// and cape, with pumpkins on the hat band and the clasp and glowing eyes.
// Drawn from a character grid so it stays crisp at any size.
const PIXELS = [
  ".....................ooo........",
  "....................oHHHo.......",
  "..................ooHHHo........",
  ".................oHHHHo.........",
  "................oHHHHHo.........",
  "...............oHHHHHHo.........",
  "..............oHHHHHHHo.........",
  "............ooHHHHHHHHo.........",
  "...........ohHHHHHHGHHHo........",
  "..........oBBBBBBBPPPBBo........",
  "....ooooooBBBBBBBBPkPBBooooo....",
  "...odddddhhhhHHHHHHHHHHdddddo...",
  "..oddddddddddddddddddddddddddo..",
  "...oooddddddddddddddddddddooo...",
  "......oWWWWWWWWWWWWWWWWWWo......",
  "......oWWWKKKWWWWWWKKKWWWo......",
  ".....oWWWKKKKKWWWWKKKKKWWwo.....",
  ".....oWWWKeeEKWWWWKeeEKWWwo.....",
  ".....oWWWKEEEKWWWWKEEEKWWwo.....",
  ".....oWWWKEEEKWWWWKEEEKWWwo.....",
  ".....oWWWWKKKWWWWWWKKKWWWwo.....",
  ".....oWWWWWWWWMWWMWWWWWWWwo.....",
  ".....oWWWWWWWWWMMWWWWWWWWwo.....",
  ".....oWWWWWWWWWWWWWWWWWWWwo.....",
  ".....oCCCCCCCCpPPpCCCCCccco.....",
  ".....oCCCCCCCCpPPpCCCCCccco.....",
  ".....oCCCCCCCCCppCCCCCCccco.....",
  ".....oCCCCCWWWWWWWWWWCCccco.....",
  ".....oCCCCCWWWWWWWWWWCCccco.....",
  ".....oCCCCCwwwwwwwwwwCCccco.....",
  ".....occcccwwwwwwwwwwccccco.....",
  "......occcoowwwoowwwooccco......",
  ".......ooo..ooo..ooo..ooo.......",
];
const COLORS = {
  o: "#241a33", H: "#6a3fa0", h: "#8b5cc6", d: "#4a2a75", B: "#e8701a", P: "#ffb03a", p: "#d8651a", k: "#3a1f10",
  G: "#5fae3a", W: "#f6efe2", w: "#d9cfc0", C: "#6b3fa6", c: "#4a2a78", K: "#2a1b14", E: "#ffb347", e: "#fff1c2", M: "#3a2a22",
};

export function ghostSVG() {
  const rects = [];
  PIXELS.forEach((row, y) => {
    [...row].forEach((c, x) => {
      if (COLORS[c]) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${COLORS[c]}"${"Ee".includes(c) ? ' class="ghost__eye"' : ""}/>`);
    });
  });
  return `<svg viewBox="0 0 ${PIXELS[0].length} ${PIXELS.length}" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
}
