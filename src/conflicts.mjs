// Same-file warning: two agents (different sessions or runs of one project, often in different worktrees)
// that changed the same repo-relative path close together. Pure functions over calls; no file is read.
import { isAbsolute, relative, sep } from "node:path"

export const WINDOW_MS = 30 * 60 * 1000
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "write_file", "edit_file"])

/** Paths a call changed, as written in its input: Claude Edit/Write file_path, Codex apply_patch file headers. */
export function editedPaths(call) {
  const i = call?.input && typeof call.input === "object" ? call.input : {}
  if (EDIT_TOOLS.has(call.name)) {
    const p = i.file_path ?? i.notebook_path ?? i.path
    return typeof p === "string" && p ? [p] : []
  }
  if (call.name === "apply_patch") {
    const text = [i.input, i.patch, i.arguments].find((v) => typeof v === "string") ?? ""
    const found = [...text.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim())
    // the patch text in a call is capped: fall back to the summary's first file
    if (!found.length && typeof call.summary === "string" && call.summary) found.push(call.summary.replace(/ \(\+\d+ more\)$/, ""))
    return found
  }
  return []
}

/** A path relative to the worktree (or cwd) it was edited in; null when it points outside it. */
export function repoRelative(path, base) {
  if (!isAbsolute(path)) return path.replace(/^\.\//, "")
  if (!base) return null
  const r = relative(base, path)
  return !r || r.startsWith("..") || isAbsolute(r) ? null : r.split(sep).join("/")
}

/**
 * items: [{ source, id, title, branch, worktree, cwd, calls }] of one project. Each item's edits within
 * `window` before `now` are reduced to the newest edit per path; two different items that edited one path
 * with edits at most `window` apart give a warning (not when both edits have the identical timestamp: that is
 * replayed history of a resumed or forked session). Newest first:
 * [{ path, gapMs, a: { source, id, title, branch, worktree, ts }, b: {...} }] (a is the newer edit).
 */
export function sameFileWarnings(items, { now = Date.now(), window = WINDOW_MS } = {}) {
  const byPath = new Map() // path -> [{ item, ts }]
  for (const it of items) {
    const last = new Map()
    for (const c of it.calls ?? []) {
      if (c.ok === false) continue // a failed edit changed nothing
      const ts = Date.parse(c.ts)
      if (!Number.isFinite(ts) || now - ts > window || ts > now + 60_000) continue
      for (const p of editedPaths(c)) {
        const rel = repoRelative(p, it.worktree || it.cwd)
        if (rel && (last.get(rel) ?? 0) < ts) last.set(rel, ts)
      }
    }
    for (const [rel, ts] of last) (byPath.get(rel) ?? byPath.set(rel, []).get(rel)).push({ it, ts })
  }
  const who = ({ it, ts }) => ({ source: it.source, id: it.id, title: it.title ?? it.id, branch: it.branch ?? null, worktree: it.worktree ?? it.cwd ?? null, ts: new Date(ts).toISOString() })
  const out = []
  for (const [path, edits] of byPath) {
    edits.sort((x, y) => y.ts - x.ts)
    for (let i = 0; i < edits.length; i++) for (let j = i + 1; j < edits.length; j++) {
      const [a, b] = [edits[i], edits[j]]
      if (a.it.source === b.it.source && a.it.id === b.it.id) continue
      if (a.ts - b.ts > window) continue
      // The same edit at the same instant in two items is one edit seen twice: a resumed or forked session
      // replays its parent's history into a new log. Not two agents.
      if (a.ts === b.ts) continue
      out.push({ path, gapMs: a.ts - b.ts, a: who(a), b: who(b) })
    }
  }
  return out.sort((x, y) => y.a.ts.localeCompare(x.a.ts) || x.path.localeCompare(y.path))
}

/** "shop in feat/search and main both edited src/api.ts 4m apart" */
export function warningText(w, project) {
  const place = (x) => x.branch || (x.worktree ? x.worktree.split(/[\\/]/).pop() : x.id)
  const [pa, pb] = [place(w.a), place(w.b)]
  const where = pa === pb ? `${pa} (two sessions)` : `${pa} and ${pb}`
  const m = Math.round(w.gapMs / 60000)
  return `${project ? `${project} in ` : ""}${where} both edited ${w.path} ${m < 1 ? "under a minute" : `${m}m`} apart`
}
