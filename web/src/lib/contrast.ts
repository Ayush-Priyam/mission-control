/** WCAG 2.x contrast helpers for #rrggbb colours. */

export function parseHex(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`not a hex colour: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

export const toHex = (rgb: [number, number, number]) =>
  "#" + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Mix `a` toward `b` by t (0: a, 1: b). */
export function mix(a: string, b: string, t: number): string {
  const p = parseHex(a)
  const q = parseHex(b)
  return toHex([0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * t) as [number, number, number])
}

/**
 * `fg` moved toward black or white (whichever gives more contrast with every `bgs`) just far enough
 * to reach `min` against all of them. `adjusted` says whether it had to move.
 */
export function ensureContrast(fg: string, bgs: string[], min: number): { color: string; adjusted: boolean } {
  const ok = (c: string) => bgs.every((b) => contrast(c, b) >= min)
  if (ok(fg)) return { color: fg.toLowerCase(), adjusted: false }
  const darkBg = bgs.reduce((s, b) => s + luminance(b), 0) / bgs.length < 0.18
  const target = darkBg ? "#ffffff" : "#000000"
  for (let t = 0.02; t <= 1.0001; t += 0.02) {
    const c = mix(fg, target, t)
    if (ok(c)) return { color: c, adjusted: true }
  }
  return { color: target, adjusted: true }
}
