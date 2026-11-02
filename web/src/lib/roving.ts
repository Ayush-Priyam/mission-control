/**
 * Roving focus for a chart of `n` values laid out in columns of `rows` (1: a single row of bars).
 * Returns the index a key moves `i` to, or null for keys the chart does not handle.
 */
export function rovingKey(key: string, i: number, n: number, rows = 1): number | null {
  if (!n) return null
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v))
  switch (key) {
    case "ArrowRight":
      return clamp(i + rows)
    case "ArrowLeft":
      return clamp(i - rows)
    case "ArrowDown":
      return rows > 1 ? clamp(i + 1) : null
    case "ArrowUp":
      return rows > 1 ? clamp(i - 1) : null
    case "Home":
      return 0
    case "End":
      return n - 1
    default:
      return null
  }
}
