// Synthetic demo data for Mission Control: a Claude Code projects root, hook logs and native runs.
//   node scripts/make-demo.mjs [--out examples] [--now <iso|ms>] [--live]
// Deterministic for a given --now (default 2026-11-02T12:00:00Z). --live keeps appending to the live
// session and the busy run every few seconds. Everything here is invented: no real paths or people.
import { mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync, readdirSync } from "node:fs"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const live = argv.includes("--live")
const out = resolve(flag("--out") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "examples"))
const nowArg = flag("--now")
const now = nowArg === undefined ? Date.parse("2026-11-02T12:00:00.000Z") : /^\d+$/.test(nowArg) ? Number(nowArg) : Date.parse(nowArg)
if (!Number.isFinite(now)) { console.error("make-demo: --now needs an ISO date or epoch ms"); process.exit(2) }

const MIN = 60000, HOUR = 3600000, DAY = 86400000
const iso = (ms) => new Date(ms).toISOString()
const ago = (ms) => iso(now - ms)

let seed = 20261102
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const between = (a, b) => Math.round(a + rnd() * (b - a))

const claudeRoot = join(out, "claude")
const hooksDir = join(out, "hooks")
const runsDir = join(out, "runs")
const jsonl = (lines) => lines.map((l) => JSON.stringify(l)).join("\n") + "\n"
const touch = (file, ms) => utimesSync(file, ms / 1000, ms / 1000)
const slug = (cwd) => cwd.replace(/\//g, "-")

// ---------------------------------------------------------------- Claude Code sessions

const OPUS = "claude-opus-4-1", SONNET = "claude-sonnet-4-5", HAIKU = "claude-haiku-4-5"
let mid = 0, tid = 0

/** One transcript writer: lines in Claude Code's format (one line per content block, usage repeated). */
function transcript({ sessionId, cwd, branch, sidechain = false, start }) {
  const lines = []
  let t = start, ctx = between(4000, 9000), extraWrite = 0
  const base = (type, extra) => ({ type, timestamp: iso(t), cwd, gitBranch: branch, sessionId, version: "2.1.0", ...(sidechain ? { isSidechain: true } : {}), ...extra })
  const w = {
    lines,
    get t() { return t },
    gap(ms) { t += ms; return w },
    /** The next turn writes `n` new tokens of context (a big file read, a pasted log). */
    grow(n) { extraWrite += n; return w },
    /** The context is compacted to about `n` tokens before the next turn. */
    compact(n) { ctx = n; return w },
    user(text) { lines.push(base("user", { message: { role: "user", content: text } })); return w },
    /** blocks: [{ text } | { tool, input, result?, error?, ms? }]; each tool block gets its result after it ran. */
    turn(model, blocks, { think = 4000 } = {}) {
      t += think
      const id = `msg_${String(++mid).padStart(4, "0")}`
      ctx += between(800, 3200)
      const usage = { input_tokens: between(300, 1800), output_tokens: between(120, 1400), cache_read_input_tokens: ctx, cache_creation_input_tokens: between(200, 2500) + extraWrite }
      ctx += extraWrite
      extraWrite = 0
      const results = []
      for (const b of blocks) {
        if (b.text) { lines.push(base("assistant", { message: { id, model, usage, content: [{ type: "text", text: b.text }] } })); continue }
        const useId = b.id ?? `toolu_${String(++tid).padStart(4, "0")}`
        lines.push(base("assistant", { message: { id, model, usage, content: [{ type: "tool_use", id: useId, name: b.tool, input: b.input }] } }))
        results.push({ useId, b })
      }
      for (const { useId, b } of results) {
        t += b.ms ?? between(400, 4000)
        const content = b.error ?? b.result ?? "ok"
        lines.push(base("user", { message: { role: "user", content: [{ type: "tool_result", tool_use_id: useId, content, ...(b.error ? { is_error: true } : {}) }] } }))
      }
      return w
    },
  }
  return w
}

const writeSession = (cwd, sessionId, tx, { summary, subagents = [], endMs } = {}) => {
  const dir = join(claudeRoot, slug(cwd))
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${sessionId}.jsonl`)
  const head = summary ? [{ type: "summary", summary, leafUuid: `leaf-${sessionId}` }] : []
  writeFileSync(file, jsonl([...head, ...tx.lines]))
  touch(file, endMs ?? tx.t)
  if (subagents.length) {
    const sdir = join(dir, sessionId, "subagents")
    mkdirSync(sdir, { recursive: true })
    for (const s of subagents) {
      const f = join(sdir, `agent-${s.id}.jsonl`)
      writeFileSync(f, jsonl(s.tx.lines))
      writeFileSync(join(sdir, `agent-${s.id}.meta.json`), JSON.stringify({ agentType: s.type ?? "general-purpose", description: s.description, toolUseId: s.toolUseId, model: s.model, finished: s.finished !== false }))
      touch(f, s.tx.t)
    }
  }
  return file
}

const read = (p) => ({ tool: "Read", input: { file_path: p }, result: "file contents" })
const edit = (p, what) => ({ tool: "Edit", input: { file_path: p, old_string: what[0], new_string: what[1] }, result: "The file has been updated" })
const bash = (command, result = "ok", error) => ({ tool: "Bash", input: { command, description: command.slice(0, 40) }, result, error })
const grep = (pattern) => ({ tool: "Grep", input: { pattern }, result: "3 matches" })
const skill = (name) => ({ tool: "Skill", input: { skill: name }, result: "Launching skill" })
const mcp = (server, tool, input, result = "ok", error) => ({ tool: `mcp__${server}__${tool}`, input, result, error })

/** A subagent run: spawned by an Agent call in the parent; returns { sub, call } to splice in. */
function subagent({ parent, id, type, description, model, steps, finished = true }) {
  const toolUseId = `toolu_agent_${id}`
  const tx = transcript({ sessionId: parent.sessionId, cwd: parent.cwd, branch: parent.branch, sidechain: true, start: parent.t + 2000 })
  tx.user(description)
  for (const group of steps) tx.turn(model.startsWith("claude") ? model : SONNET, group, { think: 3000 })
  return {
    sub: { id, type, description, toolUseId, model, tx, finished },
    call: { id: toolUseId, tool: "Agent", input: { description, subagent_type: type, prompt: description }, result: "subagent finished", ms: tx.t - parent.t },
  }
}

function build() {
  rmSync(join(out, "claude"), { recursive: true, force: true })
  rmSync(hooksDir, { recursive: true, force: true })
  const sessions = {}

  // --- /work/shop (main): a long feature session with a review subagent, errors and an MCP docs lookup
  {
    const cwd = "/work/shop", id = "sess-shop-cart", start = now - 5 * DAY - 3 * HOUR
    const tx = transcript({ sessionId: id, cwd, branch: "main", start })
    tx.user("add a cart page with quantity controls and a running total")
    tx.turn(OPUS, [skill("brainstorming"), mcp("docs", "query-docs", { libraryId: "/org/router", query: "nested routes" }, "routing docs")])
    tx.turn(OPUS, [read("/work/shop/src/routes.ts"), read("/work/shop/src/cart/store.ts"), grep("useCart")])
    tx.turn(SONNET, [edit("/work/shop/src/cart/CartPage.tsx", ["", "export function CartPage() {}"]), edit("/work/shop/src/routes.ts", ["/cart-old", "/cart"])])
    tx.grow(48000).turn(SONNET, [bash("npm test -- cart", "", "FAIL cart.test.ts: expected total 42, got 40")])
    tx.turn(SONNET, [read("/work/shop/src/cart/cart.test.ts")])
    tx.compact(9000).turn(SONNET, [edit("/work/shop/src/cart/store.ts", ["sum + price", "sum + price * qty"]), bash("npm test -- cart", "12 passed")])
    const rev = subagent({ parent: tx, id: "a1", type: "code-reviewer", description: "Review the cart changes against the plan", model: "sonnet", steps: [[read("/work/shop/src/cart/CartPage.tsx"), read("/work/shop/src/cart/store.ts")], [grep("TODO"), { text: "Two small notes, no blockers." }]] })
    tx.turn(OPUS, [rev.call])
    tx.turn(SONNET, [bash("npm run lint", "", "src/cart/CartPage.tsx: unused import"), edit("/work/shop/src/cart/CartPage.tsx", ["import x", ""]), bash("npm run lint", "clean")])
    tx.turn(SONNET, [{ text: "Cart page is in, tests and lint are green." }])
    sessions[id] = writeSession(cwd, id, tx, { summary: "Add a cart page with quantity controls", subagents: [rev.sub] })
  }

  // --- /work/shop-search (worktree on feat/search): two sessions, one with parallel subagents
  {
    const cwd = "/work/shop-search"
    let id = "sess-search-api", tx = transcript({ sessionId: id, cwd, branch: "feat/search", start: now - 3 * DAY - 6 * HOUR })
    tx.user("add a /search endpoint that returns ranked products")
    tx.turn(OPUS, [skill("test-driven-development"), read("/work/shop/api/products.ts")])
    tx.turn(SONNET, [edit("/work/shop-search/api/search.ts", ["", "export const search = () => []"]), bash("npm test -- search", "", "Error: ECONNREFUSED 127.0.0.1:5432")])
    tx.turn(SONNET, [bash("docker compose up -d db", "started"), bash("npm test -- search", "8 passed")])
    tx.turn(SONNET, [mcp("pg", "query", { sql: "explain select * from products where name ilike $1" }, "Seq Scan on products")])
    tx.turn(SONNET, [edit("/work/shop-search/api/search.ts", ["ilike", "tsquery"]), { text: "Switched to full text search." }])
    sessions[id] = writeSession(cwd, id, tx, { summary: "Search endpoint with ranking" })

    id = "sess-search-ui"
    tx = transcript({ sessionId: id, cwd, branch: "feat/search", start: now - 2 * DAY - 2 * HOUR })
    tx.user("build the search bar with debounced suggestions and keyboard navigation")
    tx.turn(OPUS, [skill("frontend-design"), mcp("docs", "query-docs", { libraryId: "/org/react", query: "useDeferredValue" }, "react docs")])
    const a = subagent({ parent: tx, id: "b1", type: "general-purpose", description: "Write the SearchBar component and its tests", model: "sonnet", steps: [[read("/work/shop-search/ui/Search.tsx")], [edit("/work/shop-search/ui/Search.tsx", ["", "// debounce"]), bash("npm test -- Search", "5 passed")]] })
    const b = subagent({ parent: tx, id: "b2", type: "general-purpose", description: "Add keyboard navigation to the suggestion list", model: "haiku", steps: [[read("/work/shop-search/ui/Suggestions.tsx")], [edit("/work/shop-search/ui/Suggestions.tsx", ["onClick", "onKeyDown"])]] })
    tx.turn(OPUS, [a.call, b.call])
    tx.turn(SONNET, [bash("npm run build", "", "TS2322: Type 'string | undefined' is not assignable"), edit("/work/shop-search/ui/Search.tsx", ["query?", "query"]), bash("npm run build", "built in 2.1s")])
    tx.turn(SONNET, [{ text: "Search bar is wired up." }])
    sessions[id] = writeSession(cwd, id, tx, { summary: "Search bar with suggestions", subagents: [a.sub, b.sub] })
  }

  // --- /work/app: a flaky-test hunt and a recent short session
  {
    const cwd = "/work/app"
    let id = "sess-app-flaky", tx = transcript({ sessionId: id, cwd, branch: "main", start: now - 9 * DAY })
    tx.user("the onboarding test fails one run in five, find out why")
    tx.turn(OPUS, [skill("systematic-debugging"), grep("onboarding"), read("/work/app/test/onboarding.test.ts")])
    for (let i = 0; i < 3; i++) tx.turn(SONNET, [bash("npm test -- onboarding --repeat 10", i < 2 ? "" : "10 passed", i < 2 ? `FAIL ${i + 2} of 10: timed out waiting for dots` : undefined)])
    tx.turn(SONNET, [edit("/work/app/src/onboarding/Dots.tsx", ["setTimeout(go, 0)", "await tick()"]), { text: "A race between the animation and the test clock; fixed." }])
    sessions[id] = writeSession(cwd, id, tx, { summary: "Fix flaky onboarding test" })

    id = "sess-app-theme"
    tx = transcript({ sessionId: id, cwd, branch: "main", start: now - 1 * DAY - 5 * HOUR })
    tx.user("switch the app to the new colour tokens")
    tx.turn(SONNET, [read("/work/app/src/theme/tokens.ts"), grep("#[0-9a-f]{6}")])
    tx.turn(SONNET, [edit("/work/app/src/theme/tokens.ts", ["#3366ff", "var(--accent)"]), bash("npm run typecheck", "ok")])
    tx.turn(SONNET, [{ text: "Tokens migrated, 14 files touched." }])
    sessions[id] = writeSession(cwd, id, tx, { summary: "Migrate to colour tokens" })
  }

  // --- /work/api: a migration session, and the WAITING one (permission prompt via hooks)
  {
    const cwd = "/work/api"
    let id = "sess-api-migrate", tx = transcript({ sessionId: id, cwd, branch: "main", start: now - 12 * DAY })
    tx.user("add an index on orders(customer_id, created_at) and backfill nothing")
    tx.turn(OPUS, [skill("brainstorming"), mcp("pg", "query", { sql: "select count(*) from orders" }, "2100000")])
    tx.turn(SONNET, [edit("/work/api/db/migrations/0042_orders_index.sql", ["", "create index concurrently"]), bash("npm run migrate:dry", "", "ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block")])
    tx.turn(SONNET, [edit("/work/api/db/migrations/0042_orders_index.sql", ["begin;", "-- no-transaction"]), bash("npm run migrate:dry", "dry run ok")])
    tx.turn(SONNET, [{ text: "Migration ready; runs outside a transaction." }])
    sessions[id] = writeSession(cwd, id, tx, { summary: "Orders index migration" })

    id = "sess-api-waiting"
    const startW = now - 40 * MIN
    tx = transcript({ sessionId: id, cwd, branch: "main", start: startW })
    tx.user("rotate the staging API keys and update the deploy config")
    tx.turn(OPUS, [skill("brainstorming"), read("/work/api/deploy/staging.yaml")])
    tx.turn(SONNET, [edit("/work/api/deploy/staging.yaml", ["key: old", "key: ${NEW_KEY}"])])
    tx.turn(SONNET, [{ text: "Ready to run the rotation script." }, { tool: "Bash", input: { command: "./scripts/rotate-keys.sh staging" }, id: "toolu_wait", result: "pending" }], { think: 2000 })
    // The last tool call has no result yet: the session is blocked on a permission prompt.
    tx.lines.pop()
    const since = tx.t
    sessions[id] = writeSession(cwd, id, tx, { summary: "Rotate staging keys", endMs: since })
    mkdirSync(hooksDir, { recursive: true })
    const hf = join(hooksDir, `${id}.jsonl`)
    writeFileSync(hf, jsonl([
      { event: "UserPromptSubmit", sessionId: id, ts: iso(startW) },
      { event: "PreToolUse", sessionId: id, ts: iso(since - 20000), tool: "Edit", target: "/work/api/deploy/staging.yaml" },
      { event: "PostToolUse", sessionId: id, ts: iso(since - 19000), tool: "Edit" },
      { event: "PreToolUse", sessionId: id, ts: iso(since), tool: "Bash", target: "./scripts/rotate-keys.sh staging" },
      { event: "PermissionRequest", sessionId: id, ts: iso(since + 400), tool: "Bash", target: "./scripts/rotate-keys.sh staging", message: "Claude needs your permission to use Bash" },
    ]))

    // READY: finished a turn, Claude's idle reminder came a minute later.
    id = "sess-api-docs"
    tx = transcript({ sessionId: id, cwd, branch: "main", start: now - 20 * MIN })
    tx.user("document the new orders index in the runbook")
    tx.turn(SONNET, [read("/work/api/docs/runbook.md"), edit("/work/api/docs/runbook.md", ["## Indexes", "## Indexes\n- orders(customer_id, created_at)"])])
    tx.turn(SONNET, [{ text: "Runbook updated. Anything else?" }])
    const doneAt = tx.t
    sessions[id] = writeSession(cwd, id, tx, { summary: "Runbook: orders index", endMs: doneAt })
    writeFileSync(join(hooksDir, `${id}.jsonl`), jsonl([
      { event: "UserPromptSubmit", sessionId: id, ts: iso(now - 20 * MIN) },
      { event: "Stop", sessionId: id, ts: iso(doneAt) },
      { event: "Notification", sessionId: id, ts: iso(doneAt + 60000), kind: "idle_prompt", message: "Claude is waiting for your input" },
    ]))
  }

  // --- LOOPING: live, retrying the same failing test with small edits for ~14 minutes
  {
    const cwd = "/work/shop", id = "sess-shop-loop"
    const tx = transcript({ sessionId: id, cwd, branch: "fix/checkout-total", start: now - 16 * MIN })
    tx.user("make the checkout total test pass")
    tx.turn(SONNET, [read("/work/shop/src/checkout/total.ts"), read("/work/shop/src/checkout/total.test.ts")])
    for (let i = 0; i < 9; i++) {
      tx.turn(SONNET, [edit("/work/shop/src/checkout/total.ts", [`round(${i})`, `round(${i + 1})`]), bash("npm test -- checkout", "", "FAIL total.test.ts: expected 19.99, received 20")], { think: 60000 })
    }
    const shift = now - 15000 - tx.t
    for (const l of tx.lines) l.timestamp = iso(Date.parse(l.timestamp) + shift)
    tx.gap(shift)
    sessions[id] = writeSession(cwd, id, tx, { summary: "Fix checkout total rounding", endMs: now - 15000 })
  }

  // --- a recent session on main that edited the same file as the live one (same-file warning)
  {
    const cwd = "/work/api", id = "sess-api-hotfix"
    const tx = transcript({ sessionId: id, cwd, branch: "main", start: now - 28 * MIN })
    tx.user("hotfix: the limiter header is missing on 429 responses")
    tx.turn(SONNET, [read("/work/api/src/middleware/rateLimit.ts")])
    tx.turn(SONNET, [edit("/work/api/src/middleware/rateLimit.ts", ["res.status(429)", "res.set('Retry-After', s).status(429)"]), bash("npm test -- rateLimit", "4 passed")])
    tx.turn(SONNET, [{ text: "Header added; tests pass." }])
    const shift = now - 9 * MIN - tx.t
    for (const l of tx.lines) l.timestamp = iso(Date.parse(l.timestamp) + shift)
    tx.gap(shift)
    sessions[id] = writeSession(cwd, id, tx, { summary: "Retry-After header on 429", endMs: now - 9 * MIN })
  }

  // --- the LIVE session: last turn 20 s ago, one subagent still running
  {
    const cwd = "/work/api", id = "sess-api-live"
    const tx = transcript({ sessionId: id, cwd, branch: "feat/rate-limit", start: now - 25 * MIN })
    tx.user("add per-key rate limiting to the public endpoints")
    tx.turn(OPUS, [skill("test-driven-development"), read("/work/api/src/middleware/index.ts")])
    tx.turn(SONNET, [edit("/work/api/src/middleware/rateLimit.ts", ["", "export const limit = () => {}"]), bash("npm test -- rateLimit", "", "FAIL: window resets too early")])
    const sub = subagent({ parent: tx, id: "c1", type: "general-purpose", description: "Check the token bucket maths against the spec", model: "sonnet", steps: [[read("/work/api/docs/limits.md")], [grep("refill")]], finished: false })
    tx.turn(OPUS, [sub.call])
    // Pin the end at "20 s ago" so the file is live at `now`.
    const shift = now - 20000 - tx.t
    for (const l of [...tx.lines, ...sub.sub.tx.lines]) l.timestamp = iso(Date.parse(l.timestamp) + shift)
    tx.gap(shift)
    sub.sub.tx.gap(shift)
    sessions[id] = writeSession(cwd, id, tx, { summary: "Per-key rate limiting", subagents: [sub.sub], endMs: now - 20000 })
    liveTarget = { file: sessions[id], cwd, id }
  }
  return sessions
}
let liveTarget = null

/** A synthetic home for the config readers and a config.json with budgets and a usage window. */
function buildHome() {
  const home = join(out, "demo-home")
  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, ".claude"), { recursive: true })
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { docs: { command: "docs-mcp" }, browser: { command: "browser-mcp" }, tracker: { command: "tracker-mcp" } } }, null, 2))
  for (const sk of ["brainstorming", "test-driven-development", "deploy-checklist", "release-notes"]) {
    mkdirSync(join(home, ".claude", "skills", sk), { recursive: true })
    writeFileSync(join(home, ".claude", "skills", sk, "SKILL.md"), `---\nname: ${sk}\n---\n`)
  }
  mkdirSync(join(home, ".mission-control"), { recursive: true })
  writeFileSync(join(home, ".mission-control", "config.json"), JSON.stringify({
    budgets: [{ scope: "project", match: "api", daily: 0.75 }, { scope: "branch", match: "feat/*", weekly: 20 }, { scope: "worktree", match: "shop", monthly: 40 }],
    usageWindow: { hours: 5, limitTokens: 120000 },
  }, null, 2))
  writeFileSync(join(out, "demo-prs.json"), JSON.stringify([
    { headRefName: "feat/rate-limit", number: 57, title: "Per-key rate limiting", state: "OPEN" },
    { headRefName: "feat/search", number: 42, title: "Search endpoint and search bar", state: "OPEN" },
  ]))
}

// ---------------------------------------------------------------- native runs (Ronin-style)

const at = (minAgo) => iso(now - minAgo * MIN)
const tok = (i, o) => ({ input_tokens: i, cache_creation_input_tokens: Math.round(i / 3), cache_read_input_tokens: i * 4, output_tokens: o })

const GRAPH = {
  nodes: {
    prep: { label: "prep", x: 90, y: 280, stages: ["setup", "map"] },
    product: { label: "product", x: 230, y: 280 },
    spec: { label: "spec", x: 370, y: 280 },
    architect: { label: "architect", x: 510, y: 280 },
    design: { label: "design", x: 650, y: 190 },
    frontend: { label: "frontend", x: 790, y: 190 },
    backend: { label: "backend", x: 720, y: 380 },
    qa: { label: "qa", x: 910, y: 280 },
    review: { label: "review", x: 910, y: 420 },
  },
  flow: [["prep", "product"], ["product", "spec"], ["spec", "architect"], ["architect", "design"], ["design", "frontend"], ["architect", "backend"], ["frontend", "qa"], ["backend", "qa"], ["qa", "review"]],
  consult: [["frontend", "architect"], ["backend", "architect"]],
}

function run(id, { idea, repo, stages, events, sessions = {}, graph = GRAPH }) {
  const d = join(runsDir, id)
  rmSync(d, { recursive: true, force: true })
  mkdirSync(join(d, "sessions"), { recursive: true })
  writeFileSync(join(d, "state.json"), JSON.stringify({ runId: id, idea, repo, harness: "demo-harness", graph, stages }, null, 2))
  writeFileSync(join(d, "runs.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n")
  for (const [name, text] of Object.entries(sessions)) writeFileSync(join(d, "sessions", name), text)
  return d
}

function stage(name, start, mins, { ok = true, tools = ["Read", "Edit", "Bash"], model = SONNET, cost = 0.08, file, reason } = {}) {
  const ev = [{ type: "stage.start", stage: name, ts: at(start) }]
  const step = mins / (tools.length + 2)
  tools.forEach((t, i) => ev.push({ type: "progress", stage: name, tool: t, detail: file ?? `${name}/notes.md`, ts: at(start - step * (i + 1)) }))
  ev.push({ type: "session", stage: name, model, cost, tokens: tok(9000 + mins * 400, 1200 + mins * 90), transcript: `${name}-1.md`, ts: at(start - mins + step) })
  ev.push({ type: "stage.end", stage: name, ok, ...(reason ? { reason } : {}), durationMs: mins * MIN, ts: at(start - mins) })
  return ev
}
const md = (role, body) => `# ${role}\n\n**Task:** ${body}\n\n## What I did\n- Read the spec and contract\n- Made the change and ran the tests\n\n## Result\nAll checks green.\n`

function buildRuns() {
  const busy = run("20261102-1000-tip-calculator", {
    idea: "Tip calculator: POST /tip API plus a one-page UI that shows the result or a named error",
    repo: "/work/tipcalc",
    stages: { setup: { status: "done" }, product: { status: "done" }, spec: { status: "done" }, architect: { status: "running", rounds: 1 }, design: { status: "skipped" }, backend: { status: "running", rounds: 3 }, frontend: { status: "running", rounds: 2 }, qa: { status: "stopped", rounds: 2 }, review: { status: "pending" } },
    events: [
      { type: "run.start", idea: "Tip calculator", ts: at(42) },
      ...stage("setup", 42, 2, { tools: ["Bash"] }),
      ...stage("product", 40, 4, { tools: ["Read", "Write"], file: "product-note.md" }),
      ...stage("spec", 36, 5, { tools: ["Read", "Write"], file: "spec/tasks.md" }),
      { type: "stage.skipped", stage: "design", reason: "no design lane in this run", ts: at(31) },
      ...stage("backend", 31, 8, { file: "src/tip.mjs", cost: 0.21 }),
      ...stage("frontend", 23, 6, { file: "public/app.js", cost: 0.14 }),
      ...stage("qa", 17, 5, { tools: ["Bash", "Bash", "Read"], file: "qa.md", cost: 0.09 }),
      { type: "issue", stage: "qa", summary: "X3 negative bill returns 500, contract says 400", decision: { owner: "backend", blocks: true }, ts: at(12) },
      { type: "issue", stage: "qa", summary: "X5 error text not shown in the UI", decision: { owner: "frontend", blocks: true }, ts: at(12) },
      { type: "stage.start", stage: "backend", attempt: 1, ts: at(11) },
      { type: "progress", stage: "backend", tool: "Edit", detail: "src/tip.mjs", ts: at(10) },
      { type: "stage.start", stage: "frontend", attempt: 1, ts: at(10) },
      { type: "progress", stage: "frontend", tool: "Edit", detail: "public/app.js", ts: at(9) },
      { type: "consult.asked", id: "Q4", from: "backend", to: "architect", task: "T3", question: "400 or 422 for a negative bill?", ts: at(8) },
      { type: "stage.start", stage: "architect", attempt: 1, ts: at(8) },
      { type: "progress", stage: "architect", tool: "Read", detail: "spec/contract.md", ts: at(7) },
      { type: "stop", stage: "qa", rule: "human", detail: "approve the architect's answer to Q4: 400 with code NEGATIVE_BILL", ts: at(6) },
      { type: "progress", stage: "backend", tool: "Bash", detail: "npm test", ts: at(1) },
    ],
    sessions: {
      "backend-1.md": md("backend", "POST /tip with bill and percent; reject bad input with a named error"),
      "frontend-1.md": md("frontend", "One page that calls /tip and shows the result or the error"),
      "qa-1.md": "# qa\n\n| check | result |\n|---|---|\n| X1 happy path | pass |\n| X3 negative bill | **fail**, 500 |\n| X5 error shown | **fail** |\n",
      "spec-1.md": md("spec", "Turn the product note into tasks"),
      "product-1.md": md("product", "Write the product note"),
      "setup-1.md": md("setup", "Prepare the worktree"),
      "architect-1.md": jsonl([
        { type: "user", message: { content: [{ type: "text", text: "Backend asks: 400 or 422 for a negative bill?" }] } },
        { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "spec/contract.md" } }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "ANSWER: 400 with error code NEGATIVE_BILL, as C4 says." }] } },
      ]),
    },
  })

  run("20261102-0900-farewell-page", {
    idea: "Add a farewell page with a goodbye message and a link home",
    repo: "/work/greeter",
    stages: { setup: { status: "done" }, product: { status: "done" }, spec: { status: "done" }, architect: { status: "done" }, frontend: { status: "done", rounds: 2 }, backend: { status: "done" }, qa: { status: "done", rounds: 2 }, review: { status: "done" } },
    events: [
      { type: "run.start", ts: at(140) },
      ...stage("setup", 140, 2), ...stage("product", 138, 4), ...stage("spec", 134, 5), ...stage("architect", 129, 6),
      ...stage("backend", 123, 7, { file: "server/routes.mjs" }), ...stage("frontend", 116, 8, { file: "web/farewell.html" }),
      ...stage("qa", 108, 4, { tools: ["Bash", "Read"] }),
      { type: "issue", stage: "qa", summary: "link home points to /index", decision: { owner: "frontend", blocks: true }, ts: at(104) },
      ...stage("frontend", 103, 3, { file: "web/farewell.html" }), ...stage("qa", 100, 3, { tools: ["Bash"] }), ...stage("review", 97, 4, { model: OPUS, cost: 0.3 }),
      { type: "run.end", status: "done", ts: at(93) },
    ],
    sessions: { "frontend-1.md": md("frontend", "Farewell page"), "backend-1.md": md("backend", "Route for /farewell"), "qa-1.md": md("qa", "Run the checks"), "review-1.md": md("review", "Review the diff") },
  })

  run("20261102-0800-search-bar", {
    idea: "Search bar with debounced suggestions",
    repo: "/work/shop",
    stages: { setup: { status: "done" }, product: { status: "done" }, spec: { status: "done" }, architect: { status: "done" }, frontend: { status: "stopped", rounds: 3 }, backend: { status: "done" }, qa: { status: "pending" }, review: { status: "pending" } },
    events: [
      { type: "run.start", ts: at(220) }, ...stage("setup", 220, 2), ...stage("product", 218, 5), ...stage("spec", 213, 6), ...stage("architect", 207, 6),
      ...stage("backend", 201, 9, { file: "api/search.mjs" }), ...stage("frontend", 192, 9, { file: "ui/Search.tsx", cost: 1.2 }), ...stage("frontend", 183, 9, { ok: false, reason: "tests failed", file: "ui/Search.tsx", cost: 1.1 }), ...stage("frontend", 174, 8, { ok: false, reason: "tests failed", cost: 1.0 }),
      { type: "stop", stage: "frontend", rule: "budget", detail: "3 rounds (limit 3)", ts: at(166) }, { type: "run.end", status: "stopped", ts: at(166) },
    ],
    sessions: { "frontend-1.md": md("frontend", "Debounced search") },
  })

  run("20261102-0700-onboarding", {
    idea: "Three-screen onboarding with skip and progress dots",
    repo: "/work/app",
    stages: { setup: { status: "done" }, product: { status: "stopped", rounds: 1 }, spec: { status: "pending" }, architect: { status: "pending" }, frontend: { status: "pending" }, qa: { status: "pending" } },
    events: [
      { type: "run.start", ts: at(300) }, ...stage("setup", 300, 2), ...stage("product", 298, 6, { file: "product-note.md" }),
      { type: "stop", stage: "product", rule: "human", detail: "Should 'skip' be allowed on the first screen?", ts: at(291) },
    ],
    sessions: { "product-1.md": md("product", "Onboarding note with open questions") },
  })

  run("20261102-0600-csv-export", {
    idea: "Export orders as CSV",
    repo: "/work/shop",
    graph: undefined,
    stages: { plan: { status: "done" }, code: { status: "done" }, test: { status: "done" } },
    events: [{ type: "run.start", ts: at(400) }, ...stage("plan", 400, 3), ...stage("code", 397, 9, { file: "export.mjs" }), ...stage("test", 388, 4, { tools: ["Bash"] }), { type: "run.end", status: "done", ts: at(384) }],
    sessions: { "plan-1.md": md("plan", "CSV export plan"), "code-1.md": md("code", "Write export.mjs"), "test-1.md": md("test", "Run tests") },
  })
  return busy
}

// ---------------------------------------------------------------- go

const sessions = build()
buildHome()
const busy = buildRuns()
console.log(`demo data in ${out}: ${Object.keys(sessions).length} sessions, 5 runs, 1 waiting, 1 ready, 1 looping`)

if (live) {
  const busyFile = join(busy, "runs.jsonl")
  const ticks = [["backend", "Edit", "src/tip.mjs"], ["frontend", "Edit", "public/app.js"], ["architect", "Read", "spec/amendments.md"], ["backend", "Bash", "npm test"], ["frontend", "Read", "public/index.html"]]
  const liveSteps = [
    { tool: "Edit", input: { file_path: "/work/api/src/middleware/rateLimit.ts", old_string: "reset()", new_string: "reset(now)" } },
    { tool: "Bash", input: { command: "npm test -- rateLimit" } },
    { tool: "Read", input: { file_path: "/work/api/docs/limits.md" } },
    { tool: "Grep", input: { pattern: "burst" } },
  ]
  let i = 0
  setInterval(() => {
    const ts = new Date().toISOString()
    const [st, tool, detail] = ticks[i % ticks.length]
    appendFileSync(busyFile, JSON.stringify({ type: "progress", stage: st, tool, detail, ts }) + "\n")
    const step = liveSteps[i % liveSteps.length]
    const useId = `toolu_live_${i}`
    const common = { cwd: liveTarget.cwd, gitBranch: "feat/rate-limit", sessionId: liveTarget.id, version: "2.1.0" }
    appendFileSync(liveTarget.file, JSON.stringify({ type: "assistant", timestamp: ts, ...common, message: { id: `msg_live_${i}`, model: SONNET, usage: { input_tokens: 600, output_tokens: 180, cache_read_input_tokens: 24000 + i * 900, cache_creation_input_tokens: 700 }, content: [{ type: "tool_use", id: useId, name: step.tool, input: step.input }] } }) + "\n")
    appendFileSync(liveTarget.file, JSON.stringify({ type: "user", timestamp: new Date(Date.now() + 1500).toISOString(), ...common, message: { role: "user", content: [{ type: "tool_result", tool_use_id: useId, content: "ok" }] } }) + "\n")
    i++
  }, 4000)
  console.log("live: appending to the live session and the tip-calculator run every 4s (Ctrl-C to stop)")
}
