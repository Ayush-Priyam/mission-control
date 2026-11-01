// Pure name/text helpers: no node: imports, so Node and the browser bundle load the same file.

export const isRunId = (s) => typeof s === "string" && /^[\w-]+$/.test(s)
export const isSessionName = (s) => typeof s === "string" && /^[\w.-]+\.(md|jsonl)$/.test(s)

/** Session text from a Buffer or Uint8Array, cut at `max` bytes; `truncated: true` only when cut. */
export function capText(buf, max = 200_000) {
  const truncated = buf.length > max
  const text = new TextDecoder().decode(truncated ? buf.subarray(0, max) : buf)
  return truncated ? { text, truncated: true } : { text }
}
