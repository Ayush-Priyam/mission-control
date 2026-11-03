# Spec 001: Mission Control v2.3, answer prompts from a phone

## What and why

The **Needs you** queue shows that a Claude Code or Codex session is blocked, but you can only unblock it at the terminal. Step away from the desk and every session stalls on its permission prompt until you come back.

v2.3 lets a paired phone answer those prompts over the user's own tailnet. It keeps everything Mission Control promises today: local only, no cloud, no account, zero runtime dependencies, and a `:4319` dashboard that stays read-only.

How it works:
- The hooks the user already installs can wait a short, finite time for a remote answer.
- A second, opt-in loopback listener sits behind `tailscale serve` and serves a small installable PWA.
- A phone pairs once with a one-time token and gets a per-device cookie.
- From then on it sees the open prompts and can Allow, Deny or pick an option.
- On any failure the hook prints nothing and exits 0, so the terminal prompt handles the request exactly as it does today.

## Users

- **Primary:** a developer who runs several Claude Code or Codex sessions at once and has the Needs you hooks installed. Tailscale is on their laptop and phone. They are comfortable running a CLI flag and `tailscale serve`.
- **Secondary:** the same developer at the desk. The dashboard shows which devices are paired and how answering is configured.

## User stories

1. **Turn it on.** As the developer, I start `mission-control --remote-port 4330 --remote-host laptop.tail1234.ts.net` and run `tailscale serve`. The phone side is then reachable at `https://laptop.tail1234.ts.net` and nowhere else. Without the flags, nothing new listens.
2. **Pair a phone.** I run `mission-control remote pair`. The terminal shows a QR code and a URL that expire in 10 minutes. I scan it on my phone and the phone is paired. Scanning the same code again, or after it expires, is refused.
3. **See prompts.** On the paired phone I open the installed app. I see the same open prompts as the desktop Needs you card: project and session title, tool, target (command or path, masked, 120 characters at most) and "asked N ago". The list updates live.
4. **Allow or deny.** I tap Allow or Deny on a Claude Code or Codex permission prompt. The session continues (or is denied), and the card clears on the phone and the desktop.
5. **Pick an option.** A Claude Code AskUserQuestion prompt shows its question and one large button per option. I tap one (or pick one per question and tap Send) and Claude Code continues with that answer.
6. **Stale safety.** If the prompt was answered in the terminal, timed out, or was replaced by a new prompt before I tapped, my tap does nothing to the session. The phone tells me why: "answered in terminal", "no longer waiting", "prompt changed" or "already answered".
7. **Revoke.** I run `mission-control remote revoke <id>` and the dashboard's device list drops that device. The phone is refused on its next request and shows "this device was revoked, pair again".
8. **Fail open.** If the server is down, nothing is paired, or nobody answers within the wait (default 120 s), the terminal prompt behaves exactly as it does without Mission Control.
9. **Audit.** Every decision made from a phone appends one line to `~/.mission-control/audit.jsonl`. I can see which device decided what and when, and the line never contains the raw command.
10. **Offline.** With the phone offline, the installed app still opens. It shows "offline, can't answer" and every answer button is disabled.

## Spike (gates the final design)

Before the hook wait is finished, a real Claude Code session in a temp directory runs a PermissionRequest hook that waits about 60 s. The spike records:
- (a) whether the terminal permission prompt is visible while the hook waits;
- (b) whether answering it in the terminal kills or cancels the waiting hook process;
- (c) the exact hook output Claude Code accepts for allow and deny on PermissionRequest, and for PreToolUse(AskUserQuestion) with `updatedInput.answers`;
- (d) the Host and Origin headers the remote listener receives behind `tailscale serve`;
- (e) the Codex PermissionRequest decision output the installed Codex accepts.

The write-up goes in `docs/remote-answering.md` under "Spike findings". It names the Claude Code and Codex versions, which of the three outcomes below was observed, and the outputs from (c) and (e).

The design works under every outcome:

| Outcome | Behaviour |
|---|---|
| **A.** Terminal prompt visible, terminal answer cancels the hook | Both sides can answer. The killed hook's pending prompt is dropped by the pid liveness check, and the hook log's PostToolUse or PermissionDenied clears the desktop card. |
| **B.** Terminal prompt visible, hook not cancelled | The listener sees the clearing hook event after the prompt was asked and tells the hook to abandon. The hook prints nothing and exits 0. A phone tap gets 409 "answered in terminal". The hook also checks the log itself right before it prints a decision, and discards the decision if the prompt was already cleared. No late answer ever reaches the session. |
| **C.** Terminal prompt hidden while the hook waits | The wait (default 120 s) and the fail-open paths (server down, no paired device) are the only way back to the terminal. The docs and the `--remote-port` startup line say so. |

## Functional requirements

### Listeners
- **FR-1** Without `--remote-port`, no second socket is opened. Behaviour and responses on `:4319` are unchanged, including the 403 for a wrong Host or Origin and the 415 for a non-JSON POST.
- **FR-2** `--remote-port <n>` needs `--remote-host <name>.ts.net`. Otherwise the CLI exits 2 with a message. The port must differ from `--port`.
  - The remote listener binds `127.0.0.1` only.
  - The startup line prints the `tailscale serve` command and a one-line Funnel warning.
- **FR-3** Remote listener Host allow-list: exactly the configured name, plus `<name>:443`. Origin allow-list: exactly `https://<name>`. A wrong Host gets 403. A request with a wrong Origin, or a POST with no Origin, gets 403. A non-JSON POST gets 415.
- **FR-4** The remote listener serves only:
  - the PWA shell: `/`, `/pair`, `/manifest.webmanifest`, `/sw.js`, `/icons/*`, `/assets/*`;
  - the `/api/remote/*` routes.

  Every other path gets 404. It serves no dashboard API: no transcripts, calls or usage.
- **FR-5** `:4319` serves no answering or pairing route. `POST /api/remote/pair` and `POST /api/remote/answer` get 404 there, and so do `GET /api/remote/prompts` and `GET /api/remote/events`. `:4319` gains one read-only route, `GET /api/remote/status`.

### Pairing and devices
- **FR-6** `mission-control remote pair` creates a pairing token.
  - The token is 32 random bytes, base64url.
  - Only its SHA-256 is stored, with a 10-minute expiry, in `remote/pairing.json`.
  - A new token replaces any unused one.
  - The command prints the URL `https://<host>/pair#t=<token>` and a terminal QR code of it.
  - The token sits in the URL fragment, so it never reaches server logs.
- **FR-7** `POST /api/remote/pair {token}` (JSON, allowed Origin) redeems the token.
  - It succeeds only if the hash matches, the token has not expired and has not been used. The token is then marked used.
  - It creates a device: random id, label from the user agent (40 characters at most), and the SHA-256 of a 32-byte secret.
  - It sets `__Host-mc_device=<id>.<secret>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000`.
  - A second use, an expired token or an unknown token gets 401 `{error:"pairing link expired or already used"}`.
  - After 10 failed attempts in one minute, further attempts get 429.
- **FR-8** Every `/api/remote/*` route except `pair` needs a valid device cookie.
  - The secret is compared constant-time against the stored hash.
  - No cookie gets 401 "not paired". A revoked device gets 401 "device revoked" and its cookie is cleared.
  - Revocation is read from disk on each request, so a CLI revoke takes effect on the next request.
- **FR-9** `mission-control remote devices` lists devices (id, label, paired at). `mission-control remote revoke <id>` removes one and prints what it removed. An unknown id exits 1.
- **FR-10** `GET /api/remote/status` on `:4319` returns:
  - `{enabled, host, remotePort, waitSeconds}`;
  - `devices: [{id, label, pairedAt, lastSeenAt|null}]`;
  - `pairing: {open: boolean, expiresAt|null}`.

  It never returns token or secret material.

### Prompts and answers
- **FR-11** A prompt the hook is holding for a remote answer is "pending". Its fields:

  | Field | Value |
  |---|---|
  | `promptId` | random UUID |
  | `harness` | `claude-code` or `codex` |
  | `sessionId` | the session id |
  | `callId` | optional |
  | `kind` | `permission` or `ask` |
  | `tool` | the tool name |
  | `target` | the masked target from `targetOf`, 120 characters at most |
  | `questions` | AskUserQuestion only: question text, header, option labels and descriptions, `multiSelect` |
  | `askedAt` | when the prompt was asked |
  | `bind` | the binding hash (FR-13) |
- **FR-12** `GET /api/remote/prompts` returns the Needs you entries the desktop shows, each with title, project, lane, tool, target and since.
  - An entry with a live pending prompt also gets `{promptId, bind, kind, questions?}` and is answerable.
  - Entries without one show "answer where the agent runs": run-format sources, Codex option prompts, subagent prompts, and hooks installed before v2.3.
- **FR-13** `bind` is the SHA-256 of `promptId`, `tool`, `target` and (for ask) the canonical JSON of the questions and option labels. A phone answer must send the `promptId` and `bind` it displayed.
- **FR-14** `POST /api/remote/answer {promptId, bind, decision}`, where `decision` is `"allow"`, `"deny"` or `{answers: {<question>: <option label>}}`.
  - It is accepted only when all of these hold:
    - the pending prompt exists and its `bind` matches;
    - its hook process is alive;
    - no decision exists yet;
    - the session's hook log shows no clearing event after `askedAt`;
    - for ask: every question has exactly one listed option label, no `multiSelect` question, and no free text.
  - Success: 200 `{ok:true}`. The decision is written once (create-exclusive), so concurrent taps get exactly one 200.
  - Refusals are 409 `{error, reason}`, with these reasons:

    | Reason | When |
    |---|---|
    | `changed` | The bind differs, or the session now has a different pending prompt. |
    | `answered` | A decision already exists. |
    | `terminal` | A clearing event came after `askedAt`. |
    | `gone` | Timed out, hook gone, or unknown id. |
  - A malformed body gets 400.
  - Permission prompts accept only allow and deny. No "always allow" and no `updatedPermissions`, ever.
- **FR-15** `GET /api/remote/events` is SSE with `changed` and `heartbeat`. `changed` fires when a pending prompt appears or disappears or a hook log changes.

### Hooks
- **FR-16** Only these hooks may wait:
  - Claude Code `PermissionRequest` from the main agent. A subagent's (with `agent_id`) never waits.
  - Claude Code `PreToolUse` with `tool_name` AskUserQuestion.
  - Codex `PermissionRequest`.

  Every other hook event records and exits at once, as today.
- **FR-17** A waiting hook first records its log line as today. It waits only when all of these hold:
  - the server's `remote/server.json` heartbeat is under 6 s old;
  - its pid is alive;
  - remote is enabled;
  - at least one device is paired.

  Otherwise it exits 0 with no output, at once.
- **FR-18** While waiting, the hook polls every 200 ms. It exits 0 with empty stdout when:
  - the deadline passes (`waitSeconds`, default 120; set by `remote.waitSeconds` in `config.json`, range 10–600);
  - the server heartbeat goes stale;
  - an `abandon` decision arrives;
  - the session log shows a clearing event after `askedAt`.

  It always removes its pending file on exit, including on SIGTERM and SIGINT. It never uses `onFailure: "block"` and never exits non-zero.
- **FR-19** On a decision, the hook re-checks the session log (outcome B guard). Then it appends a `RemoteAnswered` line to the hook log; this is a clearing event, keyed by `callId` when present. Then it prints the harness's decision output:
  - Claude allow or deny for PermissionRequest. The deny message is "Denied from Mission Control".
  - Claude PreToolUse `permissionDecision: "allow"` with `updatedInput` = the original `questions` array plus the chosen `answers`.
  - Codex allow or deny, in the format the spike confirms.
- **FR-20** For an AskUserQuestion it waits on, the hook also records an opening `Notification` line (`kind: "ask_user_question"`, tool AskUserQuestion). The desktop then shows the same prompt the phone shows.
- **FR-21** `hooks install` sets `timeout` to `waitSeconds + 15` on the Claude `PermissionRequest` and `PreToolUse` entries. `hooks install codex` sets the same on `PermissionRequest`; other Codex entries stay at 10. The output says to merge again, and for Codex to re-trust with `/hooks`.

### Audit
- **FR-22** Each accepted remote decision appends one JSON line to `~/.mission-control/audit.jsonl`: `{ts, device, promptId, decision: "allow"|"deny"|"answer", tool, targetHash}`.
  - The file is created 0600 and only ever appended to.
  - `targetHash` is the SHA-256 of the masked target (for ask, of the question texts).
  - No raw command, target, question or option text is stored. Refused attempts are not logged.

### Phone UI (PWA)
- **FR-23** Installable:
  - a manifest with name, short name, `start_url "/"`, scope `/`, `display: standalone`, theme colours, and 192 px, 512 px and maskable PNG icons;
  - a service worker with a fetch handler. It caches only the static shell (`/`, manifest, icons, `/assets/*`), never `/api/*`, and never replays requests.
- **FR-24** Screens:
  - **Pair:** `/pair` reads the fragment, redeems it, then goes to `/`. It shows a clear message for an expired or used link.
  - **Not paired:** "Run `mission-control remote pair` on your computer."
  - **Prompt list:** one card per entry with project and title, tool, target, "asked N ago", and a "new prompt" flag when it changed. Permission cards show large Allow and Deny buttons. Ask cards show one large button per option; with several questions, one pick per question and a Send button. Read-only cards show "answer where the agent runs".
  - **Result:** after a tap the card shows "Allowed", "Denied" or "Answered" and clears on the next update. On a 409 it shows the reason text:

    | Reason | Phone text |
    |---|---|
    | `changed` | "prompt changed, nothing was approved" |
    | `answered` | "already answered" |
    | `terminal` | "answered in terminal" |
    | `gone` | "no longer waiting" |
  - **Revoked:** "This device was revoked. Pair again."
  - **Offline banner:** "offline, can't answer". All answer buttons are disabled while `navigator.onLine` is false or the event stream is down for more than 5 s.
- **FR-25** Built with React and the existing shadcn-style primitives and theme tokens in `web/src/styles/globals.css`, as a second Vite page. Touch targets are at least 48 px. The page makes no request to any host other than its own origin.

### Desktop
- **FR-26** A "Remote" page (`#/remote`, linked from the sidebar) on `:4319` shows:
  - status from FR-10;
  - the device list;
  - the CLI commands to pair and revoke (copyable).

  It has no buttons that write.

### Docs
- **FR-27** These docs are updated:
  - The README Security section is rewritten. It covers the two listeners, pairing, cookies, the audit log, the hook wait and fail-open, the Tailscale setup, and a Funnel warning. It states "Codex hooks are a guardrail, not a complete enforcement boundary."
  - `docs/claude-code.md` and `docs/codex.md` get the hook changes and the re-merge and re-trust steps.
  - New `docs/remote-answering.md` holds the setup and the spike findings.
  - The Flags table in the README gains the new flags.

## Non-functional requirements
- Zero runtime dependencies, Node 20 or newer. The QR encoder, cookies, SSE and hashing are written in-house on `node:crypto`.
- The hook stays synchronous, with no network. It talks to the server only through files under `~/.mission-control/remote/`: directory 0700, files 0600, atomic writes by temp file and rename or link.
- Tests use temp homes only (`MISSION_CONTROL_HOME`, `MISSION_CONTROL_HOOKS_DIR`, an injected `remoteDir`). They never touch the real `~/.claude`, `~/.codex` or `~/.mission-control`.

## Edge cases
- Two phones tap at once: exactly one decision is accepted. The other gets "already answered".
- A prompt is replaced between display and tap: the old prompt id is gone, or its bind differs. The answer is refused with "prompt changed" and the new prompt is not approved.
- Answered in the terminal (outcomes A and B): the card clears and a later tap gets "answered in terminal". The hook outputs nothing.
- The wait times out while the card is open: the card disappears on the next update, and a tap gets "no longer waiting".
- The server restarts mid-wait: the heartbeat goes stale, the hook exits empty, and the terminal handles the prompt.
- The hook is killed with SIGKILL and its pending file is left behind: the dead pid means it is never listed or answerable. The server deletes it on the next scan.
- Parallel Codex tool calls: each has its own pending prompt and `callId`. Answering one never clears the other.
- A subagent's permission request is never held, so the auto-deny timing is unchanged.
- AskUserQuestion with a `multiSelect` question or free text only: read-only on the phone.
- The pairing link is opened twice, or after 10 minutes: refused, with a message to pair again.
- The cookie is copied to another device: it works until revoked. The docs say to revoke lost phones. A lost phone is revoked from the CLI.
- `config.json` is broken: waitSeconds defaults to 120 (existing convention).
- Old hooks with timeout 10 on Codex: Codex kills the hook at 10 s and the terminal handles it. The docs say to re-install.
- A request through Funnel (public Host) is refused unless the user set that same name as `--remote-host`. The Origin and cookie checks still apply. The docs warn never to enable Funnel.
- `--remote-host` is not a `*.ts.net` name, or `--remote-port` is the same as `--port`: the CLI exits 2.

## Issue raised for pm (owner of scope)

The product note says pairing tokens can be created "from the dashboard or the CLI" and the device list has "revoke". The final decision forbids "any write path on the `:4319` listener". These conflict.

This spec keeps the final decision:
- Token creation and revoke are CLI-only (`remote pair`, `remote revoke`).
- The dashboard Remote page shows the device list and the exact commands, read-only.

If pm wants dashboard buttons, they need a decision on where that write path lives.

## Out of scope
As listed in the final decisions: Web Push; Funnel, public exposure, tunnels and LAN binding; any cloud relay or account; "always allow" and permission-rule changes; free-text, ExitPlanMode and plan answers; Codex option prompts; steering; other harnesses and adapters; any write on `:4319`; offline queueing; multi-user accounts or trusting `Tailscale-User-Login`; reading the terminal screen.
