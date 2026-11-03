// A small QR code encoder for the pairing link (spec FR-6, NFR "written in-house"): byte mode, error
// correction level M, versions 1–10 (up to 213 bytes). Pure: no `node:` imports, no I/O.
// Follows ISO/IEC 18004: Reed–Solomon over GF(256) (0x11D), block interleaving, the eight masks with
// the four penalty rules, BCH-coded format and version information.

/** [ecCodewordsPerBlock, [[blockCount, dataCodewordsPerBlock], ...]] for level M, versions 1–10. */
const BLOCKS_M = [
  null,
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
]
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const REMAINDER_BITS = [0, 0, 7, 7, 7, 7, 7, 0, 0, 0, 0]
export const MAX_VERSION = 10
const FORMAT_BITS_M = 0 // level M is 00 in the format information

const dataCapacity = (v) => BLOCKS_M[v][1].reduce((n, [c, d]) => n + c * d, 0)
const countBits = (v) => (v <= 9 ? 8 : 16)
/** Bytes that fit in byte mode at level M for version `v`. */
export const byteCapacity = (v) => Math.floor((dataCapacity(v) * 8 - 4 - countBits(v)) / 8)

/** UTF-8 bytes of a string, without TextEncoder assumptions about the host. */
function utf8(text) {
  const out = []
  for (const ch of String(text)) {
    let c = ch.codePointAt(0)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}

// ---- GF(256) and Reed–Solomon ----
const EXP = new Array(512)
const LOG = new Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

/** Generator polynomial of degree n, highest coefficient first (leading 1 dropped). */
function generator(n) {
  let g = [1]
  for (let i = 0; i < n; i++) {
    const next = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j]
      next[j + 1] ^= mul(g[j], EXP[i])
    }
    g = next
  }
  return g.slice(1)
}

/** The n error-correction codewords for `data`. */
function rsRemainder(data, n) {
  const gen = generator(n)
  const rem = new Array(n).fill(0)
  for (const b of data) {
    const f = b ^ rem.shift()
    rem.push(0)
    for (let i = 0; i < n; i++) rem[i] ^= mul(gen[i], f)
  }
  return rem
}

// ---- data stream ----
function codewords(bytes, v) {
  const bits = []
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  put(0b0100, 4) // byte mode
  put(bytes.length, countBits(v))
  for (const b of bytes) put(b, 8)
  const cap = dataCapacity(v) * 8
  put(0, Math.min(4, cap - bits.length)) // terminator
  while (bits.length % 8) bits.push(0)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0))
  for (let pad = 0xec; data.length < dataCapacity(v); pad ^= 0xec ^ 0x11) data.push(pad)

  const [ecLen, groups] = BLOCKS_M[v]
  const blocks = []
  let k = 0
  for (const [count, len] of groups) {
    for (let i = 0; i < count; i++) {
      const d = data.slice(k, k + len)
      k += len
      blocks.push({ d, e: rsRemainder(d, ecLen) })
    }
  }
  const out = []
  const maxData = Math.max(...blocks.map((b) => b.d.length))
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i])
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.e[i])
  return out
}

// ---- matrix ----
function bchFormat(mask) {
  const data = (FORMAT_BITS_M << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | (rem & 0x3ff)) ^ 0x5412
}

function bchVersion(v) {
  let rem = v
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (v << 12) | (rem & 0xfff)
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
]

function base(v) {
  const n = v * 4 + 17
  const m = Array.from({ length: n }, () => new Array(n).fill(false))
  const fn = Array.from({ length: n }, () => new Array(n).fill(false))
  const set = (r, c, on) => { m[r][c] = on; fn[r][c] = true }

  // Finder patterns with their separators.
  for (const [R, C] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
      const r = R + dr, c = C + dc
      if (r < 0 || c < 0 || r >= n || c >= n) continue
      const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3))
      set(r, c, ring !== 2 && ring !== 4)
    }
  }
  // Timing patterns.
  for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  // Alignment patterns (not over the finders).
  const pos = ALIGN[v]
  for (const r of pos) for (const c of pos) {
    if ((r === 6 && c === 6) || (r === 6 && c === pos.at(-1)) || (r === pos.at(-1) && c === 6)) continue
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
  }
  // Reserve the format areas, the dark module and the version areas (v7+). They stay light while the
  // masks are scored and are drawn afterwards (drawFormat), as ISO 18004 §7.8 and the reference do.
  for (let i = 0; i < 9; i++) { fn[8][i] = true; fn[i][8] = true }
  for (let i = 0; i < 8; i++) { fn[8][n - 1 - i] = true; fn[n - 1 - i][8] = true }
  if (v >= 7) for (let i = 0; i < 18; i++) { fn[Math.floor(i / 3)][n - 11 + (i % 3)] = true; fn[n - 11 + (i % 3)][Math.floor(i / 3)] = true }
  return { n, m, fn }
}

function drawVersion(n, m, v) {
  if (v < 7) return
  const bits = bchVersion(v)
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) === 1
    const a = n - 11 + (i % 3), b = Math.floor(i / 3)
    m[b][a] = on
    m[a][b] = on
  }
}

function placeData(n, m, fn, words, v) {
  const bits = []
  for (const w of words) for (let i = 7; i >= 0; i--) bits.push((w >>> i) & 1)
  for (let i = 0; i < REMAINDER_BITS[v]; i++) bits.push(0)
  let k = 0
  let up = true
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // skip the vertical timing column
    for (let step = 0; step < n; step++) {
      const r = up ? n - 1 - step : step
      for (const c of [right, right - 1]) {
        if (fn[r][c]) continue
        m[r][c] = k < bits.length ? bits[k] === 1 : false
        k++
      }
    }
    up = !up
  }
}

function drawFormat(n, m, mask) {
  const bits = bchFormat(mask)
  const bit = (i) => ((bits >>> i) & 1) === 1
  // Around the top-left finder.
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i)
  m[7][8] = bit(6)
  m[8][8] = bit(7)
  m[8][7] = bit(8)
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i)
  // Split between the other two finders.
  for (let i = 0; i < 8; i++) m[8][n - 1 - i] = bit(i)
  for (let i = 8; i < 15; i++) m[n - 15 + i][8] = bit(i)
  m[n - 8][8] = true // the dark module
}

/** ISO 18004 penalty score (rules N1=3, N2=3, N3=40, N4=10). */
function penalty(n, m) {
  let score = 0
  const line = (get) => {
    let s = 0
    // N1: runs of 5+ same-coloured modules.
    let run = 1
    for (let i = 1; i < n; i++) {
      if (get(i) === get(i - 1)) { run++; if (i === n - 1 && run >= 5) s += run - 2 }
      else { if (run >= 5) s += run - 2; run = 1 }
    }
    // N3: a 1:1:3:1:1 finder-like pattern with a light area 4 wide before or after it, counted once per
    // occurrence; the area outside the symbol counts as light (the quiet zone).
    const light = (from, to) => { for (let k = Math.max(from, 0); k < Math.min(to, n); k++) if (get(k)) return false; return true }
    for (let i = 0; i + 6 < n;) {
      if (!(get(i) && !get(i + 1) && get(i + 2) && get(i + 3) && get(i + 4) && !get(i + 5) && get(i + 6))) { i++; continue }
      if (light(i - 4, i) || light(i + 7, i + 11)) { s += 40; i += 7 } else i += 4
    }
    return s
  }
  for (let r = 0; r < n; r++) score += line((i) => m[r][i])
  for (let c = 0; c < n; c++) score += line((i) => m[i][c])
  // N2: 2x2 blocks of one colour.
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const x = m[r][c]
    if (x === m[r][c + 1] && x === m[r + 1][c] && x === m[r + 1][c + 1]) score += 3
  }
  // N4: dark proportion away from 50%, in 5% steps.
  let dark = 0
  for (const row of m) for (const x of row) if (x) dark++
  const total = n * n
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10
  return score
}

/**
 * Encode `text` (UTF-8, byte mode, level M) as a QR matrix: rows of booleans (true = dark), without the
 * quiet zone. `version` and `mask` may be forced (tests); by default the smallest version that fits and
 * the mask with the lowest penalty. Throws RangeError when the text needs more than version 10.
 * Returns { version, mask, size, modules }.
 */
export function encode(text, { version, mask } = {}) {
  const bytes = utf8(text)
  let v = version
  if (v === undefined) {
    v = 1
    while (v <= MAX_VERSION && byteCapacity(v) < bytes.length) v++
  }
  if (!Number.isInteger(v) || v < 1 || v > MAX_VERSION || byteCapacity(v) < bytes.length) throw new RangeError(`QR: ${bytes.length} bytes do not fit version ${v ?? MAX_VERSION} at level M`)
  const words = codewords(bytes, v)
  const { n, m, fn } = base(v)
  placeData(n, m, fn, words, v)
  const masked = (k) => {
    const out = m.map((row) => row.slice())
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!fn[r][c] && MASKS[k](r, c)) out[r][c] = !out[r][c]
    return out
  }
  const finish = (k, out) => { drawFormat(n, out, k); drawVersion(n, out, v); return { version: v, mask: k, size: n, modules: out } }
  if (mask !== undefined) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new RangeError("QR: mask must be 0–7")
    return finish(mask, masked(mask))
  }
  let best = null
  for (let k = 0; k < 8; k++) {
    const mod = masked(k)
    const s = penalty(n, mod)
    if (!best || s < best.s) best = { s, k, mod }
  }
  return finish(best.k, best.mod)
}

/**
 * The matrix drawn for a terminal with half-block characters (two module rows per text line) and a
 * quiet zone of `quiet` modules. Dark modules are drawn as spaces on a light block background, so the
 * code reads correctly on dark and light terminals alike.
 */
export function toTerminal(modules, { quiet = 2 } = {}) {
  const n = modules.length
  const at = (r, c) => r >= 0 && c >= 0 && r < n && c < n && modules[r][c]
  const lines = []
  for (let r = -quiet; r < n + quiet; r += 2) {
    let s = ""
    for (let c = -quiet; c < n + quiet; c++) {
      const top = at(r, c), bottom = at(r + 1, c)
      // Light = block, dark = blank: "█" both light, "▀" top light only, "▄" bottom light only, " " both dark.
      s += !top && !bottom ? "█" : !top ? "▀" : !bottom ? "▄" : " "
    }
    lines.push(s)
  }
  return lines.join("\n")
}
