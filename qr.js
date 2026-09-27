// Minimal QR encoder — byte mode, EC level M, versions 1–6, mask 0.
// Returns a 2D array of 0/1 modules. No dependencies, works offline.

const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

function genPoly(n) {
  let p = [1];
  for (let i = 0; i < n; i++) {
    const q = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) { q[j] ^= mul(p[j], 1); q[j + 1] ^= mul(p[j], EXP[i]); }
    p = q;
  }
  return p;
}

function ecBytes(data, n) {
  const g = genPoly(n), res = new Array(n).fill(0);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.shift(); res.push(0);
    for (let i = 0; i < n; i++) res[i] ^= mul(g[i + 1], factor);
  }
  return res;
}

// [ecPerBlock, [ [blocks, dataCodewords], ... ] ] for EC level M
const SPEC = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]]
};
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };
const FORMAT_M_MASK0 = 0b101010000010010;

function pickVersion(len) {
  for (let v = 1; v <= 6; v++) {
    const [ec, groups] = SPEC[v];
    const cap = groups.reduce((s, [b, d]) => s + b * d, 0);
    if (len + 2 <= cap) return v;      // +2 for mode nibble and length byte
  }
  throw new Error('QR: text too long');
}

export function qrModules(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const v = pickVersion(bytes.length);
  const [ecLen, groups] = SPEC[v];
  const totalData = groups.reduce((s, [b, d]) => s + b * d, 0);

  const bits = [];
  const push = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  push(0b0100, 4); push(bytes.length, 8);
  bytes.forEach(b => push(b, 8));
  for (let i = 0; i < 4 && bits.length < totalData * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const dataBytes = [];
  for (let i = 0; i < bits.length; i += 8) dataBytes.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  const PAD = [0xec, 0x11];
  for (let i = 0; dataBytes.length < totalData; i++) dataBytes.push(PAD[i % 2]);

  const dBlocks = [], eBlocks = [];
  let pos = 0;
  groups.forEach(([count, dLen]) => {
    for (let i = 0; i < count; i++) {
      const chunk = dataBytes.slice(pos, pos + dLen); pos += dLen;
      dBlocks.push(chunk); eBlocks.push(ecBytes(chunk, ecLen));
    }
  });
  const out = [];
  const maxD = Math.max(...dBlocks.map(b => b.length));
  for (let i = 0; i < maxD; i++) dBlocks.forEach(b => { if (i < b.length) out.push(b[i]); });
  for (let i = 0; i < ecLen; i++) eBlocks.forEach(b => out.push(b[i]));

  const size = 17 + 4 * v;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, val) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = val; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
      const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
      const ring = inside && (r === 0 || r === 6 || c === 0 || c === 6);
      const core = inside && r >= 2 && r <= 4 && c >= 2 && c <= 4;
      set(r0 + r, c0 + c, ring || core ? 1 : 0);
    }
  };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  for (let i = 8; i < size - 8; i++) { const b = i % 2 === 0 ? 1 : 0; m[6][i] = b; m[i][6] = b; }

  const centers = ALIGN[v];
  centers.forEach(r => centers.forEach(c => {
    if ((r < 8 && c < 8) || (r < 8 && c > size - 9) || (r > size - 9 && c < 8)) return;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      const edge = Math.max(Math.abs(dr), Math.abs(dc));
      set(r + dr, c + dc, edge === 1 ? 0 : 1);
    }
  }));

  const fmt = [];
  for (let i = 14; i >= 0; i--) fmt.push((FORMAT_M_MASK0 >> i) & 1);
  const fbit = i => fmt[14 - i];
  // copy 1, around the top-left finder
  for (let i = 0; i <= 5; i++) m[8][i] = fbit(i);
  m[8][7] = fbit(6); m[8][8] = fbit(7); m[7][8] = fbit(8);
  for (let i = 9; i <= 14; i++) m[14 - i][8] = fbit(i);
  // copy 2: bits 0-6 up the bottom-left column, bits 7-14 along the top-right row
  for (let i = 0; i <= 6; i++) m[size - 1 - i][8] = fbit(i);
  for (let i = 7; i <= 14; i++) m[8][size - 15 + i] = fbit(i);

  m[size - 8][8] = 1;   // dark module, after the format bits so nothing overwrites it

  let bi = 0;
  const dataBits = [];
  out.forEach(b => { for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1); });
  for (let i = 0; i < 7; i++) dataBits.push(0);   // remainder bits (v2–6)

  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let n = 0; n < size; n++) {
      const row = up ? size - 1 - n : n;
      for (let k = 0; k < 2; k++) {
        const c = col - k;
        if (m[row][c] !== null) continue;
        let bit = bi < dataBits.length ? dataBits[bi++] : 0;
        if ((row + c) % 2 === 0) bit ^= 1;          // mask 0
        m[row][c] = bit;
      }
    }
    up = !up;
  }
  return m.map(row => row.map(x => x === null ? 0 : x));
}

export function drawQR(canvas, text, opts = {}) {
  const m = qrModules(text);
  const quiet = opts.quiet ?? 4;
  const n = m.length + quiet * 2;
  const px = Math.max(1, Math.floor((opts.size || canvas.width) / n));
  canvas.width = canvas.height = n * px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = opts.light || '#FFFDF8';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = opts.dark || '#26332A';
  for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++)
    if (m[r][c]) ctx.fillRect((c + quiet) * px, (r + quiet) * px, px, px);
}
