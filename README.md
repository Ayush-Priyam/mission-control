# mission-control

One local dashboard for all your AI coding work. It organises everything as **projects → worktrees → sessions and runs → lanes**: a project is a repository, a worktree is a checkout of it (a branch), a session or run is one piece of agent work, and a lane is one agent inside it (the main agent, a subagent, a harness stage, a crew member). A "Needs you" queue collects everything that is blocked on a human.

![Home: needs-you queue, live lanes and recent work](docs/screenshots/home.png)

Zero runtime dependencies. Runtime: Node 20 or newer. Building the page and running the tests need Node 20.19 or newer. Strictly local and read-only.

## Start

From a clone (the package is not on npm yet):

```bash
git clone https://github.com/aldefy/mission-control
cd mission-control
npm ci
npm run build
node bin/mission-control.mjs          # reads ~/.claude/projects, prints the URL
```

Once it is published, `npx @aldefy/mission-control` will do the same. The command is `mission-control` either way. It prints `mission control on http://localhost:<port>`. Without a build the server still serves the API and prints a hint to run `npm run build`.

Flags: `--port <n>` (default 4319; or set `MISSION_CONTROL_PORT`), `--no-open` (do not open a browser), `--claude-dir <dir>` (a Claude Code projects directory instead of `~/.claude/projects`), `--no-claude` (skip Claude Code), `--runs <dir>`, `--speckit <repo>`, `--adapter <file>` with `--adapter-opt k=v`.

### Try it with demo data

```bash
npm run demo                      # synthetic projects, sessions and runs on http://localhost:4320
npm run demo -- --port 4400       # another port
npm run demo -- --live            # keep appending to the live session and the busy run
```

The demo generates invented data into `examples/claude`, `examples/hooks` and `examples/runs` and serves it; the generated files are git-ignored (one sample run, `examples/runs/20261101-0900-greeter`, is tracked). It defaults to port 4320 so it never clashes with a real dashboard on 4319. It never reads your own `~/.claude`.

## Levels: how much you set up

| level | what you do | what you get |
|---|---|---|
| 0 | nothing | Claude Code sessions under `~/.claude/projects` appear on their own: projects, worktrees, subagent lanes, calls, tokens, estimated cost, usage history |
| 1 | install the hooks | the **Needs you** queue and live status: a session that is asking for permission or input shows up as waiting |
| 2 | write runs in the [run format](FORMAT.md) | any harness shows up as a run with stages as lanes, a timeline and a crew map |
| 3 | write an adapter | your own source: extra tabs, action buttons, anything the run format cannot say |

### Level 1: hooks for "Needs you"

```bash
node bin/mission-control.mjs hooks install
```

This prints a `hooks` block for Claude Code's `settings.json` and changes nothing itself: merge it in by hand. The commands in it use absolute paths (your `node` binary and this checkout's `bin/mission-control.mjs`), so re-run `hooks install` and merge again after you move the checkout or upgrade Node. Each event runs `mission-control hook <Event>`, which appends one small line (event, session id, time, a message of at most 500 characters, tool name) to `~/.mission-control/hooks/<session_id>.jsonl`. It never prints and never fails the session. Set `MISSION_CONTROL_HOOKS_DIR` to keep the logs elsewhere (the hook and the dashboard both read it). The file format is in [FORMAT.md](FORMAT.md#hook-event-files).

### Levels 2 and 3: runs and adapters

A harness writes two files per run, `state.json` and `runs.jsonl`, in the documented [run format](FORMAT.md). Point the dashboard at the directory: `node bin/mission-control.mjs --runs path/to/runs`. A spec-kit-compound repo is read directly with `--speckit path/to/repo`.

An adapter is a JS module whose default export is `create(options)`. It returns either a v1 adapter (runs) or a v2 source (items with lanes and calls). A v1 adapter looks like this, and is wrapped into a v2 source automatically (stages become lanes, its events become calls):

```js
{
  name: "example-harness",
  describe?(): { source?: string },             // shown on the empty home page
  listRuns(): Promise<RunSummary[]>,            // newest first
  getRun(id): Promise<{ state, events, live } | null>,
  getSession(id, name): Promise<{ text, truncated? } | null>,
  extras?: { [key]: (id | null, query: URLSearchParams) => Promise<{ status?, type?, body }> },
  actions?: { [key]: (id, body) => Promise<object> },   // throw { status, message } to refuse
}
```

`RunSummary` is `{ id, idea, repo?, live, waiting?, stages: { [stage]: { status, rounds? } }, harness? }`. `waiting` is true when the run's current stop waits on you; compute it with `isWaiting(events)` from `src/status.mjs` (the rule is in [FORMAT.md](FORMAT.md#waiting-on-you)). External adapters are called as `create({ ...opts, runsDir, createNative })`, where `createNative` is the built-in runs-directory adapter factory, so you can wrap it. `extras` feed optional tabs served at `GET /api/x/<key>[/<id>]`; the page shows a tab only when the adapter lists it. `actions` are served at `POST /api/run/<id>/action/<name>`; buttons appear only for actions an adapter declares.

A v2 source (anything with `listItems`) is used as is. Its shape (JSDoc in `src/sources/types.mjs`):

```js
{
  name: "example-harness",
  harness: "example-harness",
  listItems(): Promise<ItemSummary[]>,          // { source, id, kind: "run" | "session", title, cwd, branch, live, status, waiting, startedAt, updatedAt, counts, tokens, cost }
  getItem(id): Promise<{ summary, lanes, events, state? } | null>,   // Lane: { id, label, kind, status, model?, nowDoing?, calls, errors, tokens, cost, parent? }
  getCalls(id, { lane?, kind?, q? }): Promise<Call[]>,               // Call: { id, lane, ts, name, kind: "tool" | "mcp" | "skill" | "agent", summary, ok?, error?, durationMs? }
  getSession(id, name): Promise<{ text, truncated? } | null>,
  getTurns?(id, lane, { before?, limit? }),     // chat pages: { lane, total, start, turns }
  usage?({ from?, to?, tz? }): Promise<UsageRow[]>,
  extras?, actions?, describe?(),               // as for v1; served under /api/item/<source>/<id>/x/<key> and /action/<name>
}
```

Status is one of `working`, `waiting` (needs you), `stopped`, `failed`, `done`, `idle`.

## The pages

**Home** lists what needs you, what is live, and the latest work across every project.

**Run / session page** has tabs. Lanes shows one card per agent with what it is doing now. Map draws the crew and how work flowed between lanes.

![Lanes tab of a run](docs/screenshots/run-lanes.png)

![Map tab: stages, send-backs and questions](docs/screenshots/run-map.png)

**Calls** lists every tool, MCP, skill and subagent call, filterable by lane and kind and searchable, with arguments and results.

![Calls tab](docs/screenshots/calls.png)

**Timeline** is a waterfall of lanes, LLM calls and tool calls over time, with the slowest span marked.

![Timeline tab](docs/screenshots/timeline.png)

**Usage** shows tokens and estimated cost by day, week or month, split by model or harness, with an activity heatmap and breakdowns by project, worktree and branch.

![Usage](docs/screenshots/usage.png)

**Project** shows a project's worktrees with live lanes and its runs and sessions.

![Project page](docs/screenshots/project.png)

All screenshots come from the synthetic demo data.

## Costs are estimates

Costs are API list-price estimates computed from token counts (input, output, cache write, cache read) and the model family and version (for example Opus 4/4.1 at $15/$75 per million tokens, Opus 4.5 and later at $5/$25; the table is dated). They are not your bill: plans, subscriptions and discounts differ, and list prices change. The table is in `src/sources/claude-code/prices.mjs`; edit it when it goes stale. Models it does not know cost nothing and are shown as unpriced.

## Hiding projects

Tool-internal projects (for example an observer's data directory) are hidden by default. To hide more, create `~/.mission-control/config.json`:

```json
{ "hide": ["/path/to/project", "project-name"] }
```

Each entry is a project path or name. The file is re-read when it changes. Hidden projects stay reachable from a filter toggle in the sidebar.

## Security

Local only, no auth. The server binds `127.0.0.1` and `::1` and:

- answers only requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]` on its own port (anything else gets 403), so a web page cannot reach it through DNS rebinding;
- takes a POST only with `content-type: application/json` (else 415) and, when the browser sends an `Origin`, only from `http://localhost:<port>`, `http://127.0.0.1:<port>` or `http://[::1]:<port>` (else 403), so another site cannot submit to the action routes.

The built-in sources are read-only: they never write to a runs directory, a repo or `~/.claude`. The only thing written is the hook log under `~/.mission-control/` (and a usage cache there). Session names are confined to their root, so `..` and symlinks out of it are refused. The page makes no network requests: it uses system fonts and loads nothing from outside the server.

## Develop

```bash
npm ci
npm run build       # builds the React app into dist/
npm test            # node tests + vitest
npm run typecheck
npm run dev         # vite dev server for the page
```

## License

MIT
