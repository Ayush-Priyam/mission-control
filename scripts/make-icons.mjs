// Draws the PWA icons (web/public/icons) with no dependencies: a dark square, a green ring and dot,
// the dashboard's "working" green. Rerun after changing the design: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const BG = [0x09, 0x09, 0x0b], FG = [0x22, 0xc5, 0x5e]
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
const crc = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}

// `scale`: how much of the icon the mark may use (maskable icons keep it inside the 80% safe zone).
export function icon(size, scale = 1) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  const c = size / 2, R = size * 0.30 * scale, W = size * 0.07 * scale, D = size * 0.09 * scale
  const S = 4 // supersamples per axis
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    for (let x = 0; x < size; x++) {
      let hit = 0
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const r = Math.hypot(x + (sx + 0.5) / S - c, y + (sy + 0.5) / S - c)
        if (Math.abs(r - R) <= W / 2 || r <= D) hit++
      }
      const a = hit / (S * S), o = y * (size * 3 + 1) + 1 + x * 3
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] + (FG[k] - BG[k]) * a)
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(fileURLToPath(new URL("..", import.meta.url)), "web", "public", "icons")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "icon-192.png"), icon(192))
  writeFileSync(join(dir, "icon-512.png"), icon(512))
  writeFileSync(join(dir, "maskable-512.png"), icon(512, 0.75))
  console.log(dir)
}
