import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { basename, dirname, isAbsolute, resolve } from "node:path"

const GIT_TIMEOUT_MS = 4000
const STATUS_TTL_MS = 30_000
const CONCURRENCY = 8

function run(args, cwd) {
  return new Promise((done) => {
    execFile("git", args, {
      cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    }, (err, stdout) => done(err ? null : String(stdout)))
  })
}

/**
 * Read-only git with per-path caches: locations never change for a cwd (cached for good, misses too),
 * worktree lists and status/ahead/behind live for `ttl` ms. Every method resolves, never rejects.
 * Interface (a test can stub it): resolve(cwd) -> { commonDir, toplevel } | null,
 * worktrees(commonDir) -> [{ path, branch }], status(path) -> { dirty, ahead?, behind? } | null.
 */
export function createGit({ ttl = STATUS_TTL_MS, now = () => Date.now() } = {}) {
  const located = new Map()
  const timed = new Map()
  const fresh = (key, load) => {
    const hit = timed.get(key)
    if (hit && now() - hit.at < ttl) return hit.value
    const value = load()
    timed.set(key, { at: now(), value })
    return value
  }
  return {
    resolve(cwd) {
      if (!located.has(cwd)) {
        located.set(cwd, (async () => {
          if (!isAbsolute(cwd) || !existsSync(cwd)) return null
          const out = await run(["rev-parse", "--git-common-dir", "--show-toplevel"], cwd)
          const [common, top] = (out ?? "").split("\n")
          if (!common || !top) return null
          try { return { commonDir: realpathSync(resolve(cwd, common)), toplevel: realpathSync(top) } } catch { return null }
        })())
      }
      return located.get(cwd)
    },
    worktrees: (commonDir) => fresh(`wt|${commonDir}`, async () => {
      const out = await run(["worktree", "list", "--porcelain"], commonDir)
      const list = []
      for (const block of (out ?? "").split("\n\n")) {
        const path = /^worktree (.+)$/m.exec(block)?.[1]
        if (!path) continue
        const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null
        let real = path
        try { real = realpathSync(path) } catch { continue } // a pruned worktree whose directory is gone
        list.push({ path: real, branch })
      }
      return list
    }),
    status: (path) => fresh(`st|${path}`, async () => {
      const st = await run(["status", "--porcelain"], path)
      if (st === null) return null
      const r = { dirty: st.split("\n").filter(Boolean).length }
      const ab = await run(["rev-list", "--left-right", "--count", "@{u}...HEAD"], path) // fails without an upstream
      const m = /^(\d+)\s+(\d+)/.exec(ab ?? "")
      if (m) { r.behind = Number(m[1]); r.ahead = Number(m[2]) }
      return r
    }),
  }
}

export const realGit = createGit()

const keyOf = (path) => `${basename(path).replace(/[^\w.-]/g, "_") || "root"}-${createHash("sha1").update(path).digest("hex").slice(0, 8)}`
const NO_PROJECT = "no-project"

async function pool(list, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (i < list.length) await fn(list[i++])
  }))
}

/**
 * Group items by project (the git common dir of their cwd) and worktree. Items whose cwd is missing or
 * not a git repo fall back to a project at the cwd itself. Git failures never throw.
 */
export async function buildTree(items, { git = realGit } = {}) {
  const cwds = [...new Set(items.map((i) => i.cwd).filter((c) => typeof c === "string" && c))]
  const where = new Map()
  await pool(cwds, async (cwd) => {
    try { where.set(cwd, await git.resolve(cwd)) } catch { where.set(cwd, null) }
  })

  const projects = new Map()
  const project = (key, name, path) => {
    if (!projects.has(key)) projects.set(key, { key, name, path, worktrees: new Map(), common: null })
    return projects.get(key)
  }
  const worktree = (p, path, branch) => {
    if (!p.worktrees.has(path)) p.worktrees.set(path, { path, branch: branch ?? null, items: [], live: false, waiting: false })
    const w = p.worktrees.get(path)
    w.branch ??= branch ?? null
    return w
  }

  for (const item of items) {
    const loc = item.cwd ? where.get(item.cwd) : null
    let p, w
    if (loc) {
      const path = basename(loc.commonDir) === ".git" ? dirname(loc.commonDir) : loc.commonDir
      p = project(keyOf(loc.commonDir), basename(path), path)
      p.common = loc.commonDir
      w = worktree(p, loc.toplevel, null)
    } else if (item.cwd) {
      p = project(keyOf(item.cwd), basename(item.cwd) || item.cwd, item.cwd)
      w = worktree(p, item.cwd, item.branch)
    } else {
      p = project(NO_PROJECT, "(no project)", "")
      w = worktree(p, "", item.branch)
    }
    w.items.push(item)
    w.live ||= !!item.live
    w.waiting ||= !!item.waiting || item.status === "waiting"
  }

  // Linked worktrees with no sessions yet, and each worktree's branch.
  const gitProjects = [...projects.values()].filter((p) => p.common)
  await pool(gitProjects, async (p) => {
    try {
      for (const t of await git.worktrees(p.common)) worktree(p, t.path, t.branch)
      for (const w of p.worktrees.values()) if (w.branch == null) w.branch = w.items.find((i) => i.branch)?.branch ?? null
    } catch { /* keep the worktrees the items imply */ }
  })
  const gitWorktrees = gitProjects.flatMap((p) => [...p.worktrees.values()])
  await pool(gitWorktrees, async (w) => {
    try {
      const s = await git.status(w.path)
      if (s) { w.dirty = s.dirty; if (s.ahead !== undefined) { w.ahead = s.ahead; w.behind = s.behind } }
    } catch { /* no status for this worktree */ }
  })

  const newest = (w) => w.items.reduce((m, i) => (String(i.updatedAt ?? "") > m ? String(i.updatedAt) : m), "")
  return [...projects.values()].map((p) => {
    const worktrees = [...p.worktrees.values()]
    for (const w of worktrees) w.items.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    worktrees.sort((a, b) => newest(b).localeCompare(newest(a)) || a.path.localeCompare(b.path))
    return { key: p.key, name: p.name, path: p.path, worktrees }
  }).sort((a, b) => Math.max(...b.worktrees.map((w) => +!!w.live)) - Math.max(...a.worktrees.map((w) => +!!w.live)) ||
    newest(b.worktrees[0]).localeCompare(newest(a.worktrees[0])) || a.name.localeCompare(b.name))
}
