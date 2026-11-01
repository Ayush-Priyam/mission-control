import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"
import { spawnSync } from "node:child_process"
import { capText } from "../../names.mjs"
import { projectSlug, scanTranscripts, transcriptTokens } from "../transcripts.mjs"

export { transcriptTokens, projectSlug }
import {
  STAGES, parseFrontmatter, parseTasks, extractGoal, parseIntentguard, parsePlanverify,
  matchSpecDir, computeStates, deriveLane,
} from "./parse.mjs"

const LIVE_WINDOW_MS = 10 * 60 * 1000
const GAPFILL_MARKER = "speckit-compound-gapfill"
const read = (p) => { try { return readFileSync(p, "utf8") } catch { return "" } }
const isFile = (p) => { try { return statSync(p).isFile() } catch { return false } }
const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const mtimeMs = (p) => { try { return statSync(p).mtimeMs } catch { return 0 } }
const iso = (ms) => new Date(ms).toISOString()

// ---- git (read-only) ----
const DIFF_EXCLUDE = [
  ".", ":!.specify", ":!.claude", ":!.git", ":!.impeccable",
  ":!docs/intents", ":!docs/expectations", ":!docs/compound",
  ":!specs", ":!CLAUDE.md", ":!AGENTS.md", ":!.DS_Store",
]
function git(repo, ...args) {
  try {
    const r = spawnSync("git", ["-C", repo, ...args], {
      encoding: "utf8", timeout: 4000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    })
    return r.status === 0 ? r.stdout : ""
  } catch { return "" }
}
const gitBase = (repo) => {
  for (const ref of ["main", "master"]) {
    const b = git(repo, "merge-base", "HEAD", ref).trim()
    if (b) return b
  }
  return ""
}
const numstat = (t) => (/^\d+$/.test(t) ? Number(t) : 0)

export function scanDiff(repo, full = false) {
  const base = gitBase(repo)
  const files = [], seen = new Set(), untracked = []
  if (base) {
    const letter = {}
    for (const line of git(repo, "diff", base, "--name-status", "--", ...DIFF_EXCLUDE).split("\n")) {
      const p = line.split("\t")
      if (p.length >= 2) letter[p[p.length - 1]] = p[0].slice(0, 1)
    }
    for (const line of git(repo, "diff", base, "--numstat", "--", ...DIFF_EXCLUDE).split("\n")) {
      const p = line.split("\t")
      if (p.length === 3) {
        files.push({ path: p[2], add: numstat(p[0]), del: numstat(p[1]), status: letter[p[2]] ?? "M" })
        seen.add(p[2])
      }
    }
  }
  for (const line of git(repo, "status", "--porcelain", "-uall", "--", ...DIFF_EXCLUDE).split("\n")) {
    const st = line.slice(0, 2), path = line.slice(3).trim()
    if (st.includes("?") && path && !seen.has(path)) {
      files.push({ path, add: 0, del: 0, status: "A" })
      seen.add(path)
      untracked.push(path)
    }
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const out = {
    base: base.slice(0, 9),
    count: files.length,
    additions: files.reduce((n, f) => n + f.add, 0),
    deletions: files.reduce((n, f) => n + f.del, 0),
    files,
  }
  if (full) {
    let text = base ? git(repo, "diff", base, "--", ...DIFF_EXCLUDE) : ""
    const extra = []
    for (const path of untracked) {
      const ap = join(repo, path)
      try {
        if (isFile(ap) && statSync(ap).size < 100_000) {
          const c = readFileSync(ap, "utf8")
          if (c && !c.slice(0, 2000).includes("\0")) {
            const body = c.split("\n").slice(0, 200).map((l) => "+" + l).join("\n")
            extra.push(`diff --git a/${path} b/${path}\nnew file\n--- /dev/null\n+++ b/${path}\n${body}`)
          }
        }
      } catch { /* skip */ }
    }
    if (extra.length) text = text ? text + "\n" + extra.join("\n") : extra.join("\n")
    out.text = text.slice(0, 90_000)
  }
  return out
}

const runIdOf = (slug) => slug.replace(/[^\w-]/g, "-")

// Spec-kit adapter: derives runs from docs/intents, docs/expectations, specs/. Never writes.
export default function create({ repo, home = homedir(), now = Date.now }) {
  repo = resolve(repo)

  function scan() {
    const intentsDir = join(repo, "docs", "intents")
    let intentFiles = []
    try { intentFiles = readdirSync(intentsDir).filter((n) => n.endsWith(".intent.md")).sort() } catch { /* none */ }
    let specDirs = []
    try { specDirs = readdirSync(join(repo, "specs")).filter((n) => isDir(join(repo, "specs", n))).sort() } catch { /* none */ }

    let storeMtime = 0, storeNewest = null
    const storeFiles = []
    for (const sub of ["adr", "corrections", "patterns"]) {
      const d = join(repo, "docs", "compound", sub)
      let names = []
      try { names = readdirSync(d).filter((n) => n.endsWith(".md")).sort() } catch { continue }
      for (const n of names) {
        const rel = `docs/compound/${sub}/${n}`, m = mtimeMs(join(d, n))
        storeFiles.push(rel)
        if (m > storeMtime) { storeMtime = m; storeNewest = rel }
      }
    }

    return intentFiles.map((fname) => {
      const intentRel = `docs/intents/${fname}`
      const intentText = read(join(repo, intentRel))
      const fm = parseFrontmatter(intentText)
      const slug = fm.slug || fname.slice(0, -".intent.md".length)
      const specName = matchSpecDir(slug, specDirs)
      const specRel = specName ? `specs/${specName}` : null

      const rel = {
        expectations: `docs/expectations/${slug}.expectations.md`,
        intentguard: `docs/intents/${slug}.intentguard.md`,
        planverify: `docs/intents/${slug}.planverify.md`,
      }
      const has = (p) => isFile(join(repo, p))
      const specFile = (n) => (specRel && has(`${specRel}/${n}`) ? `${specRel}/${n}` : null)
      const tasksRel = specFile("tasks.md")
      const tasksText = tasksRel ? read(join(repo, tasksRel)) : ""
      const tasksMtime = tasksRel ? mtimeMs(join(repo, tasksRel)) : 0
      const counts = parseTasks(tasksText)
      const guard = has(rel.intentguard) ? parseIntentguard(read(join(repo, rel.intentguard))) : { verdict: null, drift: [] }
      const pv = has(rel.planverify) ? parsePlanverify(read(join(repo, rel.planverify))) : { verdict: null, drift: [] }
      const done = (f) => ({ state: f ? "done" : "pending" })

      const stages = {
        intent: done(true),
        expectations: done(has(rel.expectations)),
        specify: done(specFile("spec.md")),
        plan: done(specFile("plan.md")),
        tasks: { ...done(tasksRel), done: counts.done, total: counts.total },
        gapfill: done(tasksText.includes(GAPFILL_MARKER)),
        planverify: { ...done(has(rel.planverify)), verdict: pv.verdict, drift: pv.drift },
        implement: done(counts.total > 0 && counts.done === counts.total),
        intentguard: { ...done(has(rel.intentguard)), verdict: guard.verdict, drift: guard.drift },
        writeback: done(has(rel.intentguard) && storeMtime > tasksMtime),
      }
      computeStates(stages)
      if (guard.verdict === "BLOCKED") stages.intentguard.state = "blocked"
      if (pv.verdict === "BLOCKED_DRIFT") stages.planverify.state = "blocked"

      const stageFiles = { intent: intentRel }
      if (has(rel.expectations)) stageFiles.expectations = rel.expectations
      for (const [st, n] of [["specify", "spec.md"], ["plan", "plan.md"], ["tasks", "tasks.md"]]) {
        const f = specFile(n)
        if (f) stageFiles[st] = f
      }
      if (tasksRel) stageFiles.gapfill = tasksRel
      if (has(rel.planverify)) stageFiles.planverify = rel.planverify
      if (has(rel.intentguard)) stageFiles.intentguard = rel.intentguard
      if (storeNewest) stageFiles.writeback = storeNewest

      // Files this feature owns (the repo-wide compound store is excluded).
      const own = Object.entries(stageFiles).filter(([k]) => k !== "writeback").map(([, v]) => v)
      const walk = (d) => {
        let names = []
        try { names = readdirSync(join(repo, d), { withFileTypes: true }) } catch { return }
        for (const e of names) e.isDirectory() ? walk(`${d}/${e.name}`) : own.push(`${d}/${e.name}`)
      }
      if (specRel) walk(specRel)
      return { slug, id: runIdOf(slug), intentText, fm, specRel, stages, stageFiles, ownFiles: own, tasks: counts, storeFiles }
    })
  }

  const find = (id) => scan().find((f) => f.id === id) ?? null

  function liveOf(f) {
    return f.ownFiles.some((p) => now() - mtimeMs(join(repo, p)) <= LIVE_WINDOW_MS)
  }

  function eventsOf(f) {
    const events = []
    let prevEnd = null
    for (const stage of STAGES) {
      const p = f.stageFiles[stage]
      if (!p) continue
      const end = mtimeMs(join(repo, p))
      const start = prevEnd ?? end
      events.push({ ts: iso(start), type: "stage.start", stage, approx: true })
      events.push({ ts: iso(end), type: "stage.end", stage, approx: true })
      prevEnd = end
    }
    const windows = events.filter((e) => e.type === "stage.start").map((s) => ({
      stage: s.stage, from: Date.parse(s.ts), to: Date.parse(events.find((e) => e.type === "stage.end" && e.stage === s.stage).ts),
    }))
    const tr = scanTranscripts(repo, home)
    for (const t of tr.files) {
      const t0 = t.first ? Date.parse(t.first) : NaN
      const w = Number.isFinite(t0) ? windows.find((x) => t0 >= x.from && t0 <= x.to) : null
      if (!w) continue // unattributed transcripts belong to no run (still counted by the tokens extra)
      events.push({
        ts: iso(t0),
        type: "session",
        stage: w.stage,
        model: t.model,
        tokens: {
          input_tokens: t.tokens.input, output_tokens: t.tokens.output,
          cache_creation_input_tokens: t.tokens.cache_creation, cache_read_input_tokens: t.tokens.cache_read,
        },
        transcript: t.name,
        approx: true,
      })
    }
    return events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  }

  const summaryStages = (f) => Object.fromEntries(STAGES.map((s) => {
    const st = f.stages[s].state
    return [s, { status: st === "current" ? "running" : st }]
  }))

  const body = (b, status) => (status ? { status, body: b } : { body: b })
  const withFeature = async (id, fn) => {
    const f = id == null ? null : find(id)
    return f ? fn(f) : body({ error: "no such run" }, 404)
  }

  return {
    name: "speckit",
    async listRuns() {
      return scan().map((f) => ({
        id: f.id,
        idea: extractGoal(f.intentText).slice(0, 160),
        repo,
        live: liveOf(f),
        harness: "spec-kit-compound",
        stages: summaryStages(f),
        lane: deriveLane(f.stages),
        _t: Math.max(...Object.values(f.stageFiles).map((p) => mtimeMs(join(repo, p)))),
      })).sort((a, b) => b._t - a._t).map(({ _t, ...r }) => r)
    },
    async getRun(id) {
      const f = find(id)
      if (!f) return null
      return {
        state: {
          runId: f.id, idea: extractGoal(f.intentText), repo, harness: "spec-kit-compound",
          slug: f.slug, status: f.fm.status ?? "", created: f.fm.created ?? "", specDir: f.specRel,
          lane: deriveLane(f.stages), stages: summaryStages(f), detail: f.stages, files: f.stageFiles,
        },
        events: eventsOf(f),
        live: liveOf(f),
      }
    },
    async getSession(id, name) {
      if (!find(id) || !/^[\w.-]+\.jsonl$/.test(name)) return null
      try {
        const root = realpathSync(join(home, ".claude", "projects", projectSlug(repo)))
        const file = realpathSync(join(root, name))
        if (!file.startsWith(root + sep)) return null
        return capText(readFileSync(file))
      } catch { return null }
    },
    extras: {
      async doc(_id, q) {
        const p = q.get("path") ?? ""
        const bad = () => body({ error: "not allowed" }, 400)
        if (!p || p.includes("\0") || isAbsolute(p) || !p.endsWith(".md")) return bad()
        const target = resolve(repo, p)
        const rel = relative(repo, target)
        if (rel === ".." || rel.startsWith(".." + sep)) return bad()
        try {
          const realRoot = realpathSync(repo), real = realpathSync(target)
          if (!real.startsWith(realRoot + sep) || !real.endsWith(".md")) return bad()
          return body({ content: readFileSync(real, "utf8") })
        } catch { return body({ error: "not found" }, 404) }
      },
      drift: (id) => withFeature(id, (f) => body({
        intentguard: { verdict: f.stages.intentguard.verdict, drift: f.stages.intentguard.drift },
        planverify: { verdict: f.stages.planverify.verdict, drift: f.stages.planverify.drift },
      })),
      tokens: async () => body(transcriptTokens(repo, home)),
      diff: async (_id, q) => body(scanDiff(repo, q.get("full") === "1" || q.get("full") === "true")),
      tasks: (id) => withFeature(id, (f) => {
        const items = []
        if (f.stageFiles.tasks) {
          for (const line of read(join(repo, f.stageFiles.tasks)).split(/\r\n|\r|\n/)) {
            const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*\S)\s*$/.exec(line)
            if (m) items.push({ done: m[1] !== " ", text: m[2] })
          }
        }
        return body({ ...f.tasks, items })
      }),
    },
  }
}
