# mission-control

A local dashboard for agent harness runs: a run list, a per-run Trace waterfall (stages, LLM calls, tool calls, cost, tokens), a crew map, transcripts, and a "waiting on you" view. It reads a directory of runs in a small [documented format](FORMAT.md), so any harness (such as Ronin) can show up in it by writing two files per run. It also reads spec-kit-compound repos directly.

![Trace view of the example run](docs/screenshot.png)

Zero runtime dependencies. Runtime: Node 20 or newer. Building the page and running the tests need Node 20.19 or newer.

## Start

From a clone (the package is not on npm yet):

```bash
git clone https://github.com/aldefy/mission-control
cd mission-control
npm ci
npm run build                                   # builds the page into dist/
node bin/mission-control.mjs examples/runs      # the example run in this repo
node bin/mission-control.mjs path/to/runs       # a native runs directory (FORMAT.md)
```

Once it is published, `npx @aldefy/mission-control path/to/runs` will do the same without a clone. The command is `mission-control` either way. Without a build the server still serves the API and prints `mission control: no built page at <dist>/index.html — run npm run build`.

A spec-kit-compound repo (one run per feature, stages from the files that exist):

```bash
node bin/mission-control.mjs --speckit path/to/repo
```

A bare path containing `specs/` and `docs/intents/` is detected as spec-kit; any other bare path is a runs directory.

A custom adapter:

```bash
node bin/mission-control.mjs --adapter ./my-adapter.mjs --runs path/to/runs --adapter-opt key=value
```

Flags: `--port <n>` (default 4319; or set `MISSION_CONTROL_PORT`; `PORT` is not read), `--no-open` (do not open a browser). It prints `mission control on http://localhost:<port>`.

## Adapters

An adapter is a JS module whose default export is `create(options)`, returning:

```js
{
  name: "my-harness",
  describe?(): { source?: string },             // shown on the empty home page
  listRuns(): Promise<RunSummary[]>,           // newest first
  getRun(id): Promise<{ state, events, live } | null>,
  getSession(id, name): Promise<{ text, truncated? } | null>,
  extras?: { [key]: (id | null, query: URLSearchParams) => Promise<{ status?, type?, body }> },
  actions?: { [key]: (id, body) => Promise<object> },   // throw { status, message } to refuse
}
```

`RunSummary` is `{ id, idea, repo?, live, waiting?, stages: { [stage]: { status, rounds? } }, harness? }`. `waiting` is true when the run's current stop waits on you; compute it with `isWaiting(events)` from `src/status.mjs` (the rule is in [FORMAT.md](FORMAT.md#waiting-on-you)). The built-in adapters set it.

External adapters are called as `create({ ...opts, runsDir, createNative })`: `opts` are the `--adapter-opt k=v` pairs, `runsDir` is the resolved `--runs` directory, and `createNative` is the built-in runs-directory adapter factory, so you can wrap it and add to it without importing package paths.

`extras` feed optional tabs, served at `GET /api/x/<key>[/<id>]`. The page knows `tasks`, `qa`, `diff`, `artifacts`, `raw`, `project`, `doc`, `drift`, `tokens`, and shows a tab only when the adapter lists it. `tasks`, `diff` and `artifacts` are fetched again whenever a stage ends or the run stops. A non-JSON extra (`type` set) is served with `x-content-type-options: nosniff`. `actions` (`sign`, `say`) are served at `POST /api/run/<id>/action/<name>`; the page shows the buttons only for actions the adapter declares. `GET /api/capabilities` lists what the current adapter provides.

## Security

Local only, no auth. The server binds `127.0.0.1` and `::1` and:

- answers only requests whose `Host` is `localhost`, `127.0.0.1` or `[::1]` on its own port (anything else gets 403), so a web page cannot reach it through DNS rebinding;
- takes a POST only with `content-type: application/json` (else 415) and, when the browser sends an `Origin`, only from `http://localhost:<port>`, `http://127.0.0.1:<port>` or `http://[::1]:<port>` (else 403), so another site cannot submit to the action routes.

Programs on this machine can still call the action routes an adapter declares. The built-in adapters declare none: they are read-only and never write to a runs directory or a repo, and the footer says "read-only". With actions declared it says "read-only except your actions". The page makes no network requests (fonts are bundled).

## Develop

```bash
npm ci
npm run build   # builds the React app into dist/
npm test
```

## License

MIT
