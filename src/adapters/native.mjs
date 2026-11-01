import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, sep } from "node:path"
import { readJsonl, isRunId, isSessionName, capText } from "../format.mjs"
import { transcriptTokens } from "./speckit/index.mjs"

const LIVE_WINDOW_MS = 10 * 60 * 1000
const time = (ts) => (typeof ts === "number" ? ts : Date.parse(ts))

// Native adapter: reads <runsDir>/<id>/{state.json,runs.jsonl,sessions/}. Never writes.
export default function create({ runsDir, now = Date.now, home = homedir() }) {
  const dirOf = (id) => {
    if (!isRunId(id)) return null
    const d = join(runsDir, id)
    return existsSync(join(d, "state.json")) ? d : null
  }
  const readState = (d) => {
    try { return JSON.parse(readFileSync(join(d, "state.json"), "utf8")) } catch { return {} }
  }
  const lockLive = (d) => {
    try {
      const pid = Number(String(readFileSync(join(d, "run.lock"), "utf8")).match(/\d+/)?.[0])
      if (!pid) return false
      process.kill(pid, 0)
      return true
    } catch { return false }
  }
  const isLive = (d, events) => {
    if (lockLive(d)) return true
    let lastStart = -1, lastEnd = -1, newest = -Infinity
    events.forEach((e, i) => {
      if (e.type === "run.start" || e.type === "run.resume") lastStart = i
      else if (e.type === "run.end") lastEnd = i
      const t = time(e.ts)
      if (Number.isFinite(t) && t > newest) newest = t
    })
    return lastStart > lastEnd && now() - newest <= LIVE_WINDOW_MS
  }

  return {
    name: "native",
    async listRuns() {
      let ids
      try { ids = readdirSync(runsDir) } catch { return [] }
      return ids.filter((id) => dirOf(id)).sort().reverse().map((id) => {
        const d = join(runsDir, id)
        const s = readState(d)
        return {
          id,
          idea: String(s.idea ?? "").slice(0, 160),
          repo: s.repo ?? s.worktree,
          live: isLive(d, readJsonl(join(d, "runs.jsonl"))),
          stages: s.stages ?? {},
        }
      })
    },
    async getRun(id) {
      const d = dirOf(id)
      if (!d) return null
      const events = readJsonl(join(d, "runs.jsonl"))
      return { state: readState(d), events, live: isLive(d, events) }
    },
    async getSession(id, name) {
      const d = dirOf(id)
      if (!d || !isSessionName(name)) return null
      try {
        const root = realpathSync(join(d, "sessions"))
        const file = realpathSync(join(root, name))
        if (!file.startsWith(root + sep)) return null
        return capText(readFileSync(file))
      } catch { return null }
    },
    extras: {
      // Only for runs with a repo and no session events of their own (spec 7.7).
      async tokens(id) {
        const d = dirOf(id)
        const repo = d && readState(d).repo
        if (!repo || readJsonl(join(d, "runs.jsonl")).some((e) => e.type === "session")) {
          return { status: 404, body: { error: "no transcript tokens for this run" } }
        }
        return { body: transcriptTokens(repo, home) }
      },
    },
  }
}
