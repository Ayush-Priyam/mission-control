import { readFileSync, readdirSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"

const read = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }

/** Claude Code project-dir slug: absolute path with separators and dots replaced by '-'. */
export function projectSlug(repo) {
  return resolve(repo).replaceAll(sep, "-").replaceAll(".", "-")
}

const zero = () => ({ input: 0, output: 0, cache_creation: 0, cache_read: 0, billable: 0 })
function addUsage(acc, u) {
  const inp = u.input_tokens || 0, out = u.output_tokens || 0
  const cc = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0
  acc.input += inp; acc.output += out; acc.cache_creation += cc; acc.cache_read += cr
  acc.billable += inp + out + cc // cache reads are excluded from billable
}

/** Read every transcript under ~/.claude/projects/<slug>/*.jsonl (read-only). */
export function scanTranscripts(repo, home) {
  const dir = join(home, ".claude", "projects", projectSlug(repo))
  if (!isDir(dir)) return { dir, files: [] }
  const files = []
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
    const f = { name, tokens: zero(), first: "", last: "", model: undefined, sids: new Map() }
    for (const line of read(join(dir, name)).split("\n")) {
      let o
      try { o = JSON.parse(line) } catch { continue }
      if (!o || typeof o !== "object") continue
      const u = o.message?.usage ?? o.usage
      if (!u || typeof u !== "object" || Array.isArray(u)) continue
      const ts = typeof o.timestamp === "string" ? o.timestamp : ""
      const sid = o.sessionId ?? "unknown"
      const s = f.sids.get(sid) ?? { session: sid, first: ts, last: ts, tokens: zero() }
      f.sids.set(sid, s)
      if (ts && (!s.first || ts < s.first)) s.first = ts
      if (ts && ts > s.last) s.last = ts
      addUsage(s.tokens, u)
      addUsage(f.tokens, u)
      if (ts && (!f.first || ts < f.first)) f.first = ts
      if (ts && ts > f.last) f.last = ts
      f.model ??= o.message?.model
    }
    files.push(f)
  }
  return { dir, files }
}

/** Token totals for a repo's transcripts, as dashboard.py shows them (scan_tokens). */
export function transcriptTokens(repo, home = homedir()) {
  const { dir, files } = scanTranscripts(repo, home)
  if (!isDir(dir)) return { available: false, total: zero(), sessions: [] }
  const total = zero(), sessions = new Map()
  for (const f of files) {
    for (const s of f.sids.values()) {
      const acc = sessions.get(s.session) ?? { session: s.session, first: s.first, last: s.last, tokens: zero() }
      sessions.set(s.session, acc)
      if (s.first && (!acc.first || s.first < acc.first)) acc.first = s.first
      if (s.last > acc.last) acc.last = s.last
      for (const k of Object.keys(acc.tokens)) { acc.tokens[k] += s.tokens[k]; total[k] += s.tokens[k] }
    }
  }
  return { available: true, total, sessions: [...sessions.values()].sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0)) }
}

