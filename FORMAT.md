# Sources and levels

Mission Control reads work from sources. Each level asks more of the harness and shows more.

| level | source | what you provide | what shows |
|---|---|---|---|
| 0 | Claude Code transcripts, Codex CLI rollouts | nothing | sessions, subagent lanes, calls, tokens, estimated cost, usage |
| 1 | hook event files | Claude Code hooks pointing at `mission-control hook <Event>`, or Codex hooks pointing at `mission-control hook codex` | live status and the Needs you queue |
| 2 | native runs | `state.json` and `runs.jsonl` in the [run format](#run-format) below | stages as lanes, timeline, crew map, waiting-on-you |
| 3 | an adapter | a JS module (see the README) | extra tabs and actions on top of level 2 |

Every item, whatever its source, is shown as a session or run made of lanes, so the pages do not care where it came from.

## Claude Code fields read (level 0)

Sessions are read from `<root>/<project-slug>/<session-id>.jsonl`, where the root is `~/.claude/projects` unless `--claude-dir` says otherwise. Subagents are read from `<root>/<project-slug>/<session-id>/subagents/agent-<id>.jsonl`, with an optional `agent-<id>.meta.json` beside each (its fields label the lane). Each line is a JSON object; a line that does not parse (for example one still being written) is skipped. Nothing is ever written back.

| field | used for |
|---|---|
| `cwd` | the project and worktree the session belongs to |
| `gitBranch` | the branch shown on the worktree |
| `sessionId`, `version` | identity |
| `timestamp` | start, update and call times, durations |
| `type: "summary"` and `summary` | the title (else the first user text) |
| `type: "user"`, `message.content` text (skipping `isMeta` and system reminders) | the title and chat turns |
| `type: "assistant"`, `message.id`, `message.model` | one LLM message per id; the model |
| `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) | tokens and estimated cost |
| `message.content[]` blocks of `type: "tool_use"` (`id`, `name`, `input`) | calls, classed as tool, MCP (`mcp__<server>__<tool>`), skill or subagent |
| `message.content[]` blocks of `type: "tool_result"` (`tool_use_id`, `is_error`, `content`) | each call's result, error flag and duration |

Costs are API list-price estimates from token counts, not a bill.

## Codex CLI fields read (level 0)

Rollouts are read from `<root>/YYYY/MM/DD/rollout-*.jsonl`, where the root is `~/.codex/sessions` unless `--codex-dir` says otherwise. The records and fields used, how tokens are counted and how spawned agents become lanes are listed in [docs/codex.md](docs/codex.md#what-it-reads). Nothing is ever written back.

## Hook event files

With the hooks installed (`mission-control hooks install` prints the block to merge into Claude Code's `settings.json`), each of the events `Notification`, `Stop`, `SubagentStop`, `UserPromptSubmit` and `PreToolUse` runs `mission-control hook <Event>`. The command reads Claude Code's JSON from stdin and appends one line to `<hooks dir>/<session_id>.jsonl`. The hooks dir is `~/.mission-control/hooks`, or `MISSION_CONTROL_HOOKS_DIR` when set. The directory is mode 0700 and the files 0600. A session id that is not `^[\w-][\w.-]*$` is ignored.

```jsonl
{"event":"PreToolUse","sessionId":"sess-1","ts":"2026-11-02T10:00:00.000Z","tool":"Bash"}
{"event":"Notification","sessionId":"sess-1","ts":"2026-11-02T10:01:00.000Z","message":"Claude needs your permission to use Bash"}
```

| field | meaning |
|---|---|
| `event` | the hook event name |
| `sessionId` | the Claude Code session id; also the file name |
| `ts` | ISO time the line was written |
| `message` | `Notification` only: the text, cut to 500 characters |
| `tool` | `PreToolUse` only: the tool name |

Codex hooks run `mission-control hook codex`, which writes the same line format to `<hooks dir>/codex/<session_id>.jsonl`, mapping Codex's `PermissionRequest` to `Notification` and its tool, prompt, stop and interrupt events to clearing events (the table is in [docs/codex.md](docs/codex.md#what-the-hook-records)). Each line also carries `codexEvent`, the original name.

A session is **waiting** when its last `Notification` is not followed by a `PreToolUse`, `UserPromptSubmit` or `Stop`. The idle reminder Claude Code sends about a minute after a turn ("waiting for your input") is not a block: it marks the session ready, not waiting. A half-written last line is skipped.

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
