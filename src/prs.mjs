// Branch -> pull request, read-only through the GitHub CLI when it is installed and logged in. Never
// required: no gh, no auth, no network or a non-GitHub repo all give an empty map. Cached per repo.
import { execFile } from "node:child_process"

const TTL_MS = 10 * 60 * 1000
const TIMEOUT_MS = 4000

function ghExec(args, cwd) {
  return new Promise((done) => {
    execFile("gh", args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1", GIT_OPTIONAL_LOCKS: "0" } }, (err, stdout) => done(err ? null : String(stdout)))
  })
}

/**
 * createPrReader({ exec, now, ttl }).prsOf(repoDir) -> Promise<Map<headRefName, { number, title, state? }>>.
 * `exec(args, cwd)` resolves to stdout or null (injectable for tests). A failure is cached like a result,
 * so a machine without gh asks once per ttl, not on every request. `available()` is false once gh failed.
 */
export function createPrReader({ exec = ghExec, now = () => Date.now(), ttl = TTL_MS } = {}) {
  const cache = new Map() // repo -> { at, promise }
  let ok = null
  return {
    available: () => ok,
    prsOf(repo) {
      if (typeof repo !== "string" || !repo) return Promise.resolve(new Map())
      const hit = cache.get(repo)
      if (hit && now() - hit.at < ttl) return hit.promise
      const promise = exec(["pr", "list", "--state", "all", "--limit", "200", "--json", "headRefName,number,title,state"], repo).then((out) => {
        const map = new Map()
        let list = null
        try { list = JSON.parse(out ?? "null") } catch { list = null }
        if (!Array.isArray(list)) { ok = ok ?? false; return map }
        ok = true
        for (const p of list) {
          if (!p || typeof p.headRefName !== "string" || !Number.isInteger(p.number)) continue
          if (map.has(p.headRefName)) continue // newest first: the latest PR of a branch wins
          map.set(p.headRefName, { number: p.number, title: typeof p.title === "string" ? p.title.slice(0, 200) : "", ...(typeof p.state === "string" ? { state: p.state.toLowerCase() } : {}) })
        }
        return map
      }, () => new Map())
      cache.set(repo, { at: now(), promise })
      return promise
    },
  }
}

/**
 * Usage rows (with `projectPath`) folded per (project, branch), joined to PRs. Rows on a branch with no
 * PR are left out. -> [{ key, project, projectName, branch, pr: { number, title, state? }, in, out, cacheRead, cacheWrite, cost, sessions }]
 */
export async function prUsage(rows, reader) {
  const groups = new Map()
  for (const r of rows) {
    if (!r.branch || !r.projectPath) continue
    const k = `${r.project}|${r.branch}`
    const g = groups.get(k) ?? groups.set(k, { project: r.project, projectName: r.projectName, path: r.projectPath, branch: r.branch, in: 0, out: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessions: new Set() }).get(k)
    g.in += r.in; g.out += r.out; g.cacheRead += r.cacheRead; g.cacheWrite += r.cacheWrite; g.cost += r.cost
    g.sessions.add(`${r.source}|${r.session ?? k}`)
  }
  // One gh call per project, all at once (each is cached and times out on its own).
  const paths = [...new Set([...groups.values()].map((g) => g.path))]
  const maps = new Map(await Promise.all(paths.map(async (p) => [p, await reader.prsOf(p)])))
  const out = []
  for (const g of groups.values()) {
    const pr = maps.get(g.path).get(g.branch)
    if (!pr) continue
    const { path, sessions, ...rest } = g
    out.push({ key: `${g.project}#${pr.number}`, ...rest, pr, sessions: sessions.size })
  }
  return out.sort((a, b) => b.cost - a.cost)
}
