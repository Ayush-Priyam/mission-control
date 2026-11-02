# Mission Control with Claude Code

Everything a Claude Code user needs: what the dashboard reads, how subagents show up, how to turn on the Needs you queue, and what to do when something looks wrong.

Claude Code support needs no setup (level 0). Hooks (level 1) are optional and add the Needs you queue.

## Run it

```bash
git clone https://github.com/aldefy/mission-control
cd mission-control
npm ci
npm run build
node bin/mission-control.mjs
```

Open `http://localhost:4319` (on macOS it opens by itself; `--no-open` stops that). Useful flags:

```bash
node bin/mission-control.mjs --port 4400                        # another port
node bin/mission-control.mjs --claude-dir /work/other/projects  # another Claude Code projects directory
node bin/mission-control.mjs --no-claude --runs /work/runs      # runs only, no Claude Code
```

## What it reads

Sessions come from `~/.claude/projects` (or `--claude-dir`). Claude Code keeps one directory per working directory there, named after the path with `/` turned into `-`:

```
~/.claude/projects/
  -work-shop/
    <session-id>.jsonl                          the main conversation
    <session-id>/subagents/agent-<id>.jsonl     one file per subagent
    <session-id>/subagents/agent-<id>.meta.json the subagent's description, model, type
```

Each `.jsonl` file is one JSON object per line. These fields are used:

| field | used for |
|---|---|
| `cwd` | the project and worktree the session belongs to |
| `gitBranch` | the branch shown on the worktree |
| `sessionId`, `version` | identity |
| `timestamp` | start, update and call times, durations |
| `type: "summary"` and `summary` | the title (else the first thing you typed) |
| `type: "user"` text content | the title and the chat |
| `type: "assistant"`, `message.id`, `message.model` | one LLM message per id; the model |
| `message.usage` (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) | tokens and estimated cost |
| `tool_use` blocks (`id`, `name`, `input`) | calls: a tool, an MCP tool (`mcp__<server>__<tool>`), a skill, or a subagent |
| `tool_result` blocks (`tool_use_id`, `is_error`, `content`) | each call's result, error flag and duration |

The home list reads only the first 64 KB of each file plus its size and time, so it stays fast with thousands of sessions. A session's totals (calls, tokens, cost) are filled in the first time you open it; until then the list shows "–". Opening a session parses it once and then only reads lines appended since. A half-written last line (Claude Code still writing) is skipped.

A session is **live** (working) while one of its files changed in the last two minutes.

## Subagents are lanes

Every subagent a session started (the Agent or Task tool) is a lane next to `main`:

- the lane label is the subagent's description from `agent-<id>.meta.json`, else its id;
- its model and agent type come from the same file;
- its calls appear on the Calls tab with the lane set to `agent-<id>`, and the Agent call in `main` links to that lane;
- a subagent marked finished shows as done.

The Lanes tab shows one card per lane with what it is doing now (the last call without a result). The Chat tab shows one lane at a time; an Agent call chip opens that subagent's chat.

## Needs you: install the hooks

Without hooks the dashboard cannot know that Claude Code is waiting for you. With them, a session that asks for permission or input moves to the **Needs you** queue on the home page.

1. Print the block for this checkout:

   ```bash
   node bin/mission-control.mjs hooks install
   ```

   It prints something like this, with your own `node` path and checkout path:

   ```json
   {
     "hooks": {
       "Notification": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook Notification"
             }
           ]
         }
       ],
       "PermissionRequest": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook PermissionRequest"
             }
           ]
         }
       ],
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook Stop"
             }
           ]
         }
       ],
       "SubagentStop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook SubagentStop"
             }
           ]
         }
       ],
       "UserPromptSubmit": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook UserPromptSubmit"
             }
           ]
         }
       ],
       "PreToolUse": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook PreToolUse"
             }
           ]
         }
       ],
       "PostToolUse": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook PostToolUse"
             }
           ]
         }
       ],
       "PostToolUseFailure": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook PostToolUseFailure"
             }
           ]
         }
       ],
       "PermissionDenied": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "'/usr/local/bin/node' '/work/mission-control/bin/mission-control.mjs' hook PermissionDenied"
             }
           ]
         }
       ]
     }
   }
   ```

2. Open `~/.claude/settings.json` and merge that `hooks` object into it. If the file already has a `hooks` key, add these events next to the ones there (for an event you already hook, add the inner `{ "type": "command", ... }` entry to its list). The command changes nothing by itself; you merge by hand.

3. Start a new Claude Code session (running sessions keep the settings they started with).

4. Check it: in that session, ask Claude to run a command it must ask permission for. The session shows up under **Needs you** at once, with the tool, the command or file path and "asked Ns ago". Approve it in Claude Code and it leaves the queue.

If you merged an older block (five events), merge the new one: it adds `PermissionRequest` (fires the moment the permission dialog opens; the `Notification` for a permission prompt only comes after about six seconds without typing, and stays as the fallback) and `PostToolUse`, `PostToolUseFailure`, `PermissionDenied` (the prompt was answered, also when you answer in the terminal while the dashboard is down).

The paths in the block are absolute: your `node` binary and this checkout's `bin/mission-control.mjs`. **Run `hooks install` again and merge again after you move the checkout or upgrade Node**, or the hooks point at files that no longer exist (Claude Code then shows a hook error at each event).

### What the hooks do

Each event runs `mission-control hook <Event>`. It reads Claude Code's JSON from stdin and appends one line to `~/.mission-control/hooks/<session_id>.jsonl`:

```jsonl
{"event":"PreToolUse","sessionId":"sess-1","ts":"2026-11-02T10:00:00.000Z","tool":"Bash","target":"npm run build"}
{"event":"PermissionRequest","sessionId":"sess-1","ts":"2026-11-02T10:00:00.400Z","tool":"Bash","target":"npm run build","message":"Claude needs your permission to use Bash"}
{"event":"PostToolUse","sessionId":"sess-1","ts":"2026-11-02T10:00:31.000Z","tool":"Bash"}
```

It keeps the event name, session id, time, a `Notification` message cut to 500 characters and its type, the tool name, and for `PreToolUse` and `PermissionRequest` a short target: the first 120 characters of the command or the file path, on one line. Nothing else from the payload is stored (no file contents, edit strings, descriptions or prompts). It never prints, never blocks, and always exits 0, so it cannot break a session. The directory is mode 0700 and the files 0600. Set `MISSION_CONTROL_HOOKS_DIR` to keep the logs elsewhere (set it for both Claude Code and the dashboard).

## Needs you vs ready

- **Waiting (Needs you)**: the session's last `PermissionRequest` or `Notification` has no `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `UserPromptSubmit` or `Stop` after it. That is Claude asking for permission or for an answer. The card shows the tool, its command or path, Claude's message and when it was asked. When a different prompt replaces the one on screen, the card shows a **new prompt** badge and flashes once (no flash with reduced motion), so an answer meant for the old prompt is not given to the new one.
- **Ready**: about a minute after a turn ends Claude Code sends an idle reminder (`idle_prompt`, "Claude is waiting for your input"). That is not a block: the session is shown as idle with "ready for input", counted in the calm **Ready (N)** chip and listed (collapsed) under Needs you on Home.
- **Looping**: a working session that keeps retrying the same failure. See "Looping" in the README.
- Answered in the terminal while the dashboard was down: the `PostToolUse` line (or the transcript's newer messages) clears the wait, so a restarted dashboard does not show the old prompt.
- A wait also clears when the session's transcript gets a newer message (you answered in the terminal), and it expires after 12 hours.

## Turns and the usage window

The Turns tab lists each assistant message (one per message id) with its input, cache read, cache write and output tokens, context size and estimated cost, with compaction markers and a short "why expensive" hint. The Usage page estimates your current rolling usage window from these logs (see the README's [Usage-window estimate](../README.md#usage-window-estimate)); it is an estimate with a window and limit you set, never Anthropic's actual limits.

## Privacy

- Everything stays on your machine. The server binds to `127.0.0.1` and `::1` only and refuses other hosts; the page loads nothing from the internet.
- `~/.claude` is only read, never written. Session file names are confined to the projects directory; `..` and symlinks out of it are refused.
- For the Calls tab's "Config vs calls", configured names are read and nothing else: MCP server names from `~/.claude.json` and the project's `.mcp.json`, enabled plugin names from `~/.claude/settings.json` and the project's `.claude/settings*.json`, and skill folder names under `~/.claude/skills` and the project's `.claude/skills`. Commands, URLs, env values, headers and tokens are never returned or stored.
- The only files written are the hook logs (`~/.mission-control/hooks`) and a usage cache (`~/.mission-control/cache`, mode 0600, holds project paths and session ids, no conversation text). Delete either at any time.
- Costs are estimates from token counts at API list prices, not your bill. A Claude plan is billed differently.

## Troubleshooting

| symptom | cause and fix |
|---|---|
| No sessions at all | Check `curl -s http://localhost:4319/api/sources`: the `claude-code` entry shows the directory read. If yours is elsewhere, pass `--claude-dir`. If you passed `--no-claude`, drop it. |
| A session sits under the wrong project | The project comes from the `cwd` in the transcript. Sessions started in a subdirectory are grouped by that directory. |
| Totals show "–" | The session has not been opened since it changed. Open it once. |
| Needs you never fills | The hooks are not merged, or Claude Code was started before you merged them. Run `hooks install`, merge, start a new session. Check that `~/.mission-control/hooks/` gets files. |
| Hook errors in Claude Code after moving the repo | The block holds absolute paths. Run `hooks install` again and replace the old entries. |
| A session stays in Needs you after you answered | It clears on the next tool call, prompt or stop, or when the transcript moves on. Reload the page. |
| Usage page says "partial" | The first scan of all transcripts runs in the background after start. Wait for it to finish; later starts are fast thanks to the cache. |
| Cost is 0 for a model | The model id is not in the price table (`src/sources/claude-code/prices.mjs`); it shows as "–" (no price). |
