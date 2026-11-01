# Run format

A harness is anything that writes runs in this format. Mission Control reads it and never writes to it.

A runs directory holds one folder per run:

```
<runs>/<run-id>/state.json
<runs>/<run-id>/runs.jsonl
<runs>/<run-id>/sessions/<name>.md|.jsonl   (optional transcripts)
```

`<run-id>` matches `^[\w-]+$`.

## state.json

Minimum:

```json
{
  "runId": "20261101-2114",
  "idea": "one-line title of the run",
  "stages": { "<stage>": { "status": "pending|running|done|skipped|stopped|failed|blocked", "rounds": 1 } }
}
```

Key order of `stages` is the display order. Statuses: `pending` (not started), `running`, `done`, `skipped`, `stopped` (halted at a `stop`), `failed` (ended with an error), `blocked` (cannot go on until something else changes, for example a failed verification). The stage bar draws `running` green, `stopped` amber, `failed` and `blocked` red, `done` grey, and anything else (including `pending`, `skipped` and unknown words) blank.

Optional fields:

| field | meaning |
|---|---|
| `harness` | name shown in the header |
| `repo` | repository path or name; runs are grouped by its basename |
| `branch` | branch the run works on |
| `graph` | crew layout, see below |

A run folder with `state.json` but no `runs.jsonl` is listed with zero events. A malformed line in `runs.jsonl` (for example one still being appended) is skipped.

## runs.jsonl

One JSON object per line. Every event has `type` and `ts` (ISO time). Core events:

| type | fields | drives |
|---|---|---|
| `run.start`, `run.end`, `run.resume` | | run span, Live vs Ended |
| `stage.start` | `stage`, `attempt?` | waterfall bar opens |
| `stage.end` | `stage`, `ok`, `reason?`, `durationMs?` | bar closes, failure mark |
| `stage.skipped` | `stage`, `reason` | skipped stage |
| `session` | `stage`, `model`, `tokens{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}`, `cost`, `transcript?` | LLM calls, cost, tokens, transcript link |
| `progress` | `stage`, `tool`, `detail?` | tool-call ticks |
| `issue` | `stage`, `summary`, `decision?{owner,blocks}` | errors, send-backs |
| `stop` | `stage?`, `rule`, `detail` | `rule: "human"`: waiting on you; any other rule: Stopped (`<rule>`) |
| `human.input` | `stage?`, `text` | owner resumed or replied; clears a stop |

### Waiting on you

A run's current stop is its last `stop` event not followed by `stage.start`, `human.input`, `run.resume` or `run.start` (a `run.end` or other bookkeeping after it does not clear it). The run waits on you when that stop has `rule: "human"`: the home badge says "Waiting on you", and the banner says "Needs you" with the adapter's sign/answer buttons. Any other rule (`budget`, `stage-failed`, …) is shown as "Stopped (<rule>)", with no buttons. The rule lives in `src/status.mjs` (`openStop`, `isWaiting`), shared by the trace, the adapters and the page.

### Extensions

Events outside the core table are extensions: the page uses the ones it knows and ignores the rest. Known extensions, shown where the page already has a place for them:

`consult.*` (draws a question edge in the crew view), `architect.signed`, `qa`, `check`, `handoff`, `memory.used`.

## transcript

`transcript` on a `session` event is a file name inside `<run>/sessions/`, never a path. Names match `^[\w.-]+\.(md|jsonl)$`. A `.md` file renders as text; a `.jsonl` file (a Claude Code session, or any JSONL of messages) renders as a message list. Text is served up to 200,000 bytes and flagged `truncated` when cut. Adapters that keep transcripts elsewhere serve them through their own `getSession(runId, name)`.

## Live or ended

A `run.lock` file in the run folder holding a live pid wins if present. Otherwise a run is Live when there is no `run.end` after the last `run.start` or `run.resume` and some event is less than 10 minutes old. Adapters may decide differently (the spec-kit adapter calls a feature Live when any of its files changed in the last 10 minutes).

## graph (optional)

By default the crew view draws `state.stages` left to right and adds edges from what happened (an `issue` with `decision.owner` is a send-back edge, `consult.*` a question edge). A harness can supply its own layout:

```json
"graph": {
  "nodes": { "backend": { "label": "Backend", "x": 700, "y": 280, "stages": ["backend"] } },
  "flow": [["spec", "backend"]],
  "consult": [["qa", "backend"]]
}
```

`x` and `y` are in a 1000 × 560 space (origin top left), the same one the default layout uses; the map scales it to fit. `nodes` may be an id-keyed map or an array of `{ id, … }`. `stages` lists the stages a node stands for (default: its id).

## Example

`state.json`:

```json
{"runId":"20261101-0900-greeter","idea":"add a greeting page","harness":"example","repo":"/work/greeter","stages":{"spec":{"status":"done","rounds":1},"backend":{"status":"done","rounds":1}}}
```

`runs.jsonl`:

```jsonl
{"ts":"2026-11-01T09:00:00Z","type":"run.start"}
{"ts":"2026-11-01T09:01:00Z","type":"stage.start","stage":"spec"}
{"ts":"2026-11-01T09:05:00Z","type":"stage.end","stage":"spec","ok":true}
{"ts":"2026-11-01T09:05:30Z","type":"stage.start","stage":"backend"}
{"ts":"2026-11-01T09:06:30Z","type":"progress","stage":"backend","tool":"Edit","detail":"greeting handler written"}
{"ts":"2026-11-01T09:08:00Z","type":"session","stage":"backend","model":"claude-sonnet-4-5","cost":0.42,"tokens":{"input_tokens":1200,"output_tokens":450,"cache_creation_input_tokens":300,"cache_read_input_tokens":9000},"transcript":"backend-1.md"}
{"ts":"2026-11-01T09:09:00Z","type":"stage.end","stage":"backend","ok":true}
{"ts":"2026-11-01T09:20:00Z","type":"run.end","ok":true}
```

A complete runnable copy is in [`examples/runs/`](examples/runs).
