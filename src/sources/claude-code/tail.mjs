import { closeSync, openSync, readSync } from "node:fs"

const CHUNK = 4 * 1024 * 1024 // read size: a transcript is never held as one string, so any size parses
const FP = 64 // bytes just before the read offset, compared to tell an append from a rewrite
const NL = 0x0a

/**
 * Incremental JSONL reader for one file feeding an accumulator ({ feed(entry), result() }) made by
 * `make()`. update(path, st) reads only the bytes appended since the last call when the file grew and
 * its prefix is unchanged (same inode, size and mtime not going back, the bytes before the old end
 * identical); anything else (shrunk, rewritten, replaced) starts a fresh accumulator and reads it all.
 * A half-written last line is held back until its newline arrives. `onRead(path, { bytes, full })`
 * reports every read, for tests. result() is cached until new lines arrive.
 */
export function createTail(make, onRead) {
  let s = null // { ino, size, mtimeMs, offset, partial: Buffer, fp: Buffer, acc, fedPartial }
  let snap = null

  function feedLine(buf) {
    if (!buf.length) return false
    let e
    try { e = JSON.parse(buf.toString("utf8")) } catch { return false }
    if (!e || typeof e !== "object" || Array.isArray(e)) return false
    s.acc.feed(e)
    return true
  }

  function read(fd, path, from, to) {
    let pos = from
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, to - from)))
    while (pos < to) {
      const n = readSync(fd, buf, 0, Math.min(buf.length, to - pos), pos)
      if (n <= 0) break
      pos += n
      const chunk = buf.subarray(0, n)
      let start = 0
      for (let i = chunk.indexOf(NL); i !== -1; i = chunk.indexOf(NL, start)) {
        const line = s.partial.length ? Buffer.concat([s.partial, chunk.subarray(start, i)]) : chunk.subarray(start, i)
        s.partial = Buffer.alloc(0)
        if (!s.fedPartial) feedLine(line)
        s.fedPartial = false
        start = i + 1
      }
      if (start < chunk.length) s.partial = Buffer.concat([s.partial, chunk.subarray(start)])
    }
    s.offset = pos
    // A complete object without a trailing newline counts now (as a full parse always did); its newline,
    // when it arrives, ends an already-fed line.
    if (s.partial.length && !s.fedPartial && feedLine(s.partial)) { s.fedPartial = true; s.partial = Buffer.alloc(0) }
    const k = Math.min(FP, pos)
    s.fp = Buffer.alloc(k)
    if (k) readSync(fd, s.fp, 0, k, pos - k)
    snap = null
    onRead?.(path, { bytes: pos - from, full: from === 0 })
  }

  function sameText(fd) {
    const k = s.fp.length
    if (!k) return true
    const b = Buffer.alloc(k)
    return readSync(fd, b, 0, k, s.offset - k) === k && b.equals(s.fp)
  }

  return {
    /** Bring the accumulator up to date with the file at `path` (stat `st`); returns this. Throws on I/O errors. */
    update(path, st) {
      if (s && s.ino === st.ino && s.size === st.size && s.mtimeMs === st.mtimeMs) return this
      const fd = openSync(path, "r")
      try {
        const grows = s && s.ino === st.ino && st.size > s.size && st.mtimeMs >= s.mtimeMs && sameText(fd)
        if (!grows) s = { offset: 0, partial: Buffer.alloc(0), fp: Buffer.alloc(0), acc: make(), fedPartial: false }
        read(fd, path, s.offset, st.size)
        Object.assign(s, { ino: st.ino, size: s.offset, mtimeMs: st.mtimeMs }) // a short read retries next time
      } catch (e) {
        s = null // never keep a half-applied state
        throw e
      } finally { closeSync(fd) }
      return this
    },
    result() { return (snap ??= s ? s.acc.result() : null) },
  }
}

/** Parse a whole file through a fresh accumulator in chunks (no single string, so no size limit). */
export function parseFileWith(make, path, st) {
  return createTail(make).update(path, st).result()
}
