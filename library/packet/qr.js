// qr.js — a minimal, self-contained QR encoder. No dependency, no network.
//
// WHY HAND-ROLLED. The prayer cards need a QR per group linking back to that
// group's live page, and the standing constraint is as much data as possible
// without compromising speed and without adding a lot of dependencies on the
// internet. A QR symbol is pure computation — Reed-Solomon over GF(256) and a bit
// layout — so it costs one small file instead of a package, and it runs identically
// in Node (build-time decks) and the browser (print-on-click).
//
// SCOPE, deliberately narrow: byte mode, error-correction level M, the smallest
// version that fits, mask 0. That is all a short https URL needs
// (https://pray.doxa.life/<slug> is ~40 chars -> version 3). It is NOT a general
// QR library: no kanji mode, no ECI, no structured append. Encoding anything much
// longer than a URL will throw rather than silently produce a symbol that will not
// scan.
//
// ⚠ A QR that does not scan looks exactly like one that does. Do not "improve" this
// by eye — verify by decoding the output.

// ── GF(256) arithmetic, the field QR's Reed-Solomon works over ───────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;          // the QR generator polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// Reed-Solomon error-correction codewords for one block.
function rsEncode(data, ecLen) {
  // Build the generator polynomial for ecLen codewords.
  let gen = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= mul(gen[j], EXP[i]);
    }
    gen = next;
  }
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) res[j] ^= mul(gen[j + 1], factor);
  }
  return res;
}

// ── Version table (level M only) — [version, totalCodewords, ecPerBlock, blocks]
// Versions 1..6 cover every URL this app produces; beyond that we throw rather
// than guess, because a wrong table silently yields an unscannable symbol.
const VERSIONS = [
  [1, 26, 10, 1], [2, 44, 16, 1], [3, 70, 26, 1],
  [4, 100, 18, 2], [5, 134, 24, 2], [6, 172, 16, 4],
];

const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

/**
 * Encode `text` as a QR matrix.
 * @returns {{size:number, modules:Uint8Array}} row-major, 1 = dark.
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);

  // Pick the smallest version whose data capacity fits.
  let spec = null;
  for (const v of VERSIONS) {
    const [, total, ecPer, blocks] = v;
    const dataCw = total - ecPer * blocks;
    if (bytes.length + 2 + 1 <= dataCw) { spec = v; break; }  // +mode nibble, +length
  }
  if (!spec) {
    throw new Error(`qr: ${bytes.length} bytes exceeds this encoder's range (max ~${
      VERSIONS.at(-1)[1] - VERSIONS.at(-1)[2] * VERSIONS.at(-1)[3] - 3} bytes). `
      + 'It is scoped to short URLs on purpose.');
  }
  const [version, totalCw, ecPerBlock, blocks] = spec;
  const dataCw = totalCw - ecPerBlock * blocks;

  // ── Bit stream: mode(0100) + length(8 bits) + payload + terminator ──────────
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  for (let i = 0; i < 4 && bits.length < dataCw * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  }
  // Pad alternately with the two spec-mandated bytes.
  const PAD = [0xec, 0x11];
  for (let i = 0; data.length < dataCw; i++) data.push(PAD[i % 2]);

  // ── Split into blocks, compute EC, interleave ───────────────────────────────
  const perBlock = Math.floor(dataCw / blocks);
  const dBlocks = [];
  const eBlocks = [];
  for (let i = 0; i < blocks; i++) {
    const chunk = data.slice(i * perBlock, (i + 1) * perBlock);
    dBlocks.push(chunk);
    eBlocks.push(rsEncode(chunk, ecPerBlock));
  }
  const final = [];
  for (let i = 0; i < perBlock; i++) for (const b of dBlocks) final.push(b[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of eBlocks) final.push(b[i]);

  // ── Lay out the matrix ──────────────────────────────────────────────────────
  const size = version * 4 + 17;
  const m = new Int8Array(size * size).fill(-1);       // -1 = free
  const at = (r, c) => r * size + c;
  const set = (r, c, v) => { if (r >= 0 && c >= 0 && r < size && c < size) m[at(r, c)] = v; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inRing = (r === 0 || r === 6 || c === 0 || c === 6);
      const inCore = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      set(r0 + r, c0 + c, (r >= 0 && r <= 6 && c >= 0 && c <= 6 && (inRing || inCore)) ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) {                 // timing patterns
    const v = i % 2 === 0 ? 1 : 0;
    if (m[at(6, i)] === -1) set(6, i, v);
    if (m[at(i, 6)] === -1) set(i, 6, v);
  }
  for (const r of ALIGN[version] || []) {              // alignment patterns
    for (const c of ALIGN[version] || []) {
      if (m[at(r, c)] !== -1) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        set(r + dr, c + dc, (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) ? 1 : 0);
      }
    }
  }
  set(size - 8, 8, 1);                                 // the always-dark module

  // Reserve format-information cells so data skips them.
  const fmtCells = [];
  for (let i = 0; i <= 8; i++) { if (i !== 6) fmtCells.push([8, i], [i, 8]); }
  for (let i = 0; i < 8; i++) fmtCells.push([8, size - 1 - i], [size - 1 - i, 8]);
  for (const [r, c] of fmtCells) if (m[at(r, c)] === -1) m[at(r, c)] = -2;   // -2 = reserved

  // ── Place data, zig-zag upward in 2-column strips, with mask 0 applied ───────
  let bi = 0;
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;                              // skip the vertical timing line
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (m[at(row, c)] !== -1) continue;
        const bit = bi < final.length * 8
          ? (final[bi >> 3] >> (7 - (bi & 7))) & 1
          : 0;
        bi++;
        // Mask 0: invert where (row + col) is even. Applied HERE rather than in a
        // second pass so reserved/function modules are never touched.
        m[at(row, c)] = bit ^ ((row + c) % 2 === 0 ? 1 : 0);
      }
    }
    up = !up;
  }

  // ── Format information: level M (00) + mask 0 (000), BCH(15,5) + XOR mask ────
  let fmt = 0b00000;                                   // ecc M = 00, mask 0 = 000
  let rem = fmt;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) * 0x537);
  const fmtBits = ((fmt << 10) | rem) ^ 0b101010000010010;
  const fmtBit = (i) => (fmtBits >> i) & 1;
  for (let i = 0; i <= 5; i++) { set(8, i, fmtBit(i)); set(size - 1 - i, 8, fmtBit(i)); }
  set(8, 7, fmtBit(6)); set(8, 8, fmtBit(7)); set(7, 8, fmtBit(8));
  for (let i = 9; i <= 14; i++) { set(8, size - 15 + i, fmtBit(i)); set(14 - i, 8, fmtBit(i)); }
  set(size - 8, 8, 1);

  const modules = new Uint8Array(size * size);
  for (let i = 0; i < m.length; i++) modules[i] = m[i] === 1 ? 1 : 0;
  return { size, modules };
}

/**
 * Render `text` as an inline SVG QR code.
 * Drawn as ONE path of rectangles rather than per-module <rect>s: a version-3
 * symbol is 29x29 = 841 modules, and 841 elements per card times 95 cards is a
 * document a print dialog struggles with.
 */
export function qrSvg(text, { size = 120, margin = 2, dark = '#14110d' } = {}) {
  const { size: n, modules } = qrMatrix(text);
  const total = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules[r * n + c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
    + `width="${size}" height="${size}" shape-rendering="crispEdges" role="img" `
    + `aria-label="QR code">`
    + `<rect width="${total}" height="${total}" fill="#fff"/>`
    + `<path d="${d}" fill="${dark}"/></svg>`;
}
