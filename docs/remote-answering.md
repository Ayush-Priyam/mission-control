# Remote answering: answer prompts from your phone

Mission Control v2.3 lets a paired phone (or another browser) answer the prompts in **Needs you** over your own tailnet:

- **Allow** once or **Deny** a Claude Code or Codex permission prompt;
- pick one option of a Claude Code **AskUserQuestion** prompt.

Nothing else: no "always allow" or permission rules, no free text, no plan approval, no Codex option prompts, no new prompts or steering. Run-format sources and other harnesses stay read-only.

Everything stays local: no cloud, no account. On any problem the hook prints nothing and the terminal prompt handles the request exactly as without Mission Control.

## What you need

- The Needs you hooks, installed from v2.3 or later ([Claude Code](claude-code.md#needs-you-install-the-hooks), [Codex](codex.md#needs-you-codex-hooks)). Older blocks keep working but never wait for a phone: run `hooks install` (and `hooks install codex`) again and merge. For Codex, re-trust the changed hook with `/hooks`.
- [Tailscale](https://tailscale.com) on the laptop and the phone, logged in to the same tailnet, with HTTPS certificates enabled for the tailnet (Tailscale admin console → DNS → HTTPS Certificates).
- Your laptop's tailnet name, for example `laptop.tail1234.ts.net` (`tailscale status --self` shows it).

## Set it up: one command

With Tailscale signed in on the laptop (`tailscale up`) and on the phone, with HTTPS certificates enabled for the tailnet:

```bash
mission-control remote setup
```

It checks each step and fixes only what is missing, asking first (`y/N`; `--yes` accepts all):

1. Tailscale is signed in, and reads your `*.ts.net` name;
2. writes `remote.host` to `~/.mission-control/config.json`;
3. merges the hooks into `~/.claude/settings.json` (and `~/.codex/hooks.json` when `~/.codex` exists), keeping your other hooks and saving a backup first. For Codex, run `/hooks` once and approve them;
4. runs `tailscale serve --bg --https=443 http://127.0.0.1:4330` (tailnet only);
5. turns remote answering on, and shows a pairing QR when no device is paired yet.

Run it again any time: a finished step is left alone. To see what is missing without changing anything:

```bash
mission-control remote doctor
```

On the phone: scan the QR, then Share → **Add to Home Screen**, open the app from there, and tap **Turn on notifications**.

The steps below are what `remote setup` does, for doing them by hand.

## Set it up by hand

1. Tell Mission Control the name, in `~/.mission-control/config.json`:

   ```json
   { "remote": { "host": "laptop.tail1234.ts.net" } }
   ```

2. Turn it on, any of these ways:

   - `mission-control remote on` (works with or without a running server);
   - the **Remote answering** switch on the dashboard's Remote page (`#/remote`);
   - for one run only: `mission-control --remote-port 4330 --remote-host laptop.tail1234.ts.net`.

   The server prints the listener address, the `tailscale serve` command and a Funnel warning.

3. Put it on your tailnet:

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:4330
   ```

   **Never use `tailscale funnel` for this.** Funnel puts the answering page on the public internet. The listener only answers requests for the configured `*.ts.net` name with an `https://` Origin from that name, but it is not built to face the internet.

4. Pair the phone (next section).

## Pair a phone

```bash
mission-control remote pair
```

It prints a QR code and a link like `https://laptop.tail1234.ts.net/pair#t=…`. Scan it or open it on the phone. The link works **once** and for **10 minutes**; running `remote pair` again replaces an unused link. The phone gets a long-lived, HttpOnly device cookie and lands on the prompt list. Add it to the home screen to install it as an app.

The token sits after `#`, so it is never sent in a request line and never lands in a log. Only its SHA-256 is stored, in `~/.mission-control/remote/pairing.json`.

## Notifications

Tap **Turn on notifications** in the app. On iPhone this works only in the Home Screen app (iOS 16.4 or later), and the button says so in Safari. From then on, a new prompt sends that phone one notification ("Needs you", with the tool and target) and a tap opens the app on the list.

The ping itself carries nothing: Apple (or Google, or Mozilla) only learns that something is waiting. The app fetches the prompt from your laptop over the tailnet before it shows the notification. Turn it off with the same button, or revoke the device.

## Devices and revoke

```bash
mission-control remote devices        # id, label, paired at
mission-control remote revoke <id>    # unknown id: exit 1
```

A revoke applies on the device's next request: the phone shows "This device was revoked. Pair again." Pairing and revoke are CLI-only. The dashboard's Remote page shows the devices and these commands, but it has no pair or revoke button. A copied cookie works until you revoke it, so **revoke a lost phone**.

## On, off and status

```bash
mission-control remote on      # exit 2 if remote.host or remote.port is invalid
mission-control remote off
mission-control remote status  # remote: on|off, host, port, server: running|not running, devices
```

- With the dashboard running, `on` and `off` are applied by the server (the same path as the dashboard switch) within a few seconds. Without a running server they set `remote.enabled` in `config.json` and say "takes effect when mission-control starts".
- Turning off is immediate: waiting hooks give up within a second and fall back to the terminal, phones see "offline, can't answer", and the port is closed. Paired devices stay paired; turning it on again needs no re-pairing.
- Every actual change adds one line to `~/.mission-control/audit.jsonl` (`{ts, actor: "cli"|"dashboard", action: "remote-on"|"remote-off"}`).

### Config keys and precedence

| key | default | meaning |
|---|---|---|
| `remote.enabled` | `false` | start with remote answering on |
| `remote.host` | none | your `<name>.ts.net`; required to turn it on |
| `remote.port` | `4330` | the loopback port `tailscale serve` points at; must differ from the dashboard port |
| `remote.waitSeconds` | `120` | how long a hook waits for a phone answer, 10–600 |

`--remote-host` and `--remote-port` override `host` and `port` for that run, turn remote answering on for that run, and are never written to `config.json`. A broken `config.json` means the defaults; the switch and `remote on|off` refuse to overwrite it.

## How a prompt reaches the phone

1. Claude Code or Codex runs the hook. The hook records its line as always.
2. It waits only for a main-agent Claude `PermissionRequest`, a Claude `PreToolUse` for `AskUserQuestion` whose questions are all single-select, or a Codex `PermissionRequest`, and only while the server is running (heartbeat under 6 s), remote answering is on and a device is paired. Otherwise it exits at once.
3. It writes a pending prompt under `~/.mission-control/remote/pending/` and polls every 200 ms, for at most `remote.waitSeconds`.
4. The phone shows the prompt. A tap sends the prompt id and a hash of the tool, target and options it displayed.
5. The server accepts the answer only if that prompt is still the one waiting, its hook is alive, nobody answered yet and the terminal did not answer it. Otherwise the phone shows "prompt changed, nothing was approved", "already answered", "answered in terminal" or "no longer waiting".
6. The hook re-checks the session log, records `RemoteAnswered` (the desktop card clears), prints the decision and exits 0.

If anything is off (timeout, server stopped, remote turned off, the prompt answered in the terminal, an error) the hook prints nothing and exits 0, and the terminal prompt handles the request.

Every accepted answer appends one line to `~/.mission-control/audit.jsonl` (0600): time, device id, prompt id, `allow`, `deny` or `answer`, the tool, and a SHA-256 of the masked target or question texts. It never holds the raw command, path, question or option.

## Spike findings

The spike runs a real Claude Code session in a temp directory with a `PermissionRequest` hook that waits about 60 s and a `PreToolUse(AskUserQuestion)` hook, then a Codex session with a `PermissionRequest` hook, and the listener behind `tailscale serve`. It records:

- (a) whether the terminal permission prompt is visible while the hook waits;
- (b) whether answering it in the terminal cancels the waiting hook;
- (c) the outputs Claude Code accepts;
- (d) the `Host` and `Origin` headers behind `tailscale serve`;
- (e) the output Codex accepts.

**Run on 2026-11-03** on macOS (Darwin 25.6) with **Claude Code 2.1.317** and **codex-cli 0.159.3**, each in a fresh git repo under `/tmp`. The spike used a stand-alone hook script that logged its stdin and its lifetime and printed a prepared decision. The interactive sessions ran in a pseudo-terminal. Claude Code ran with `--setting-sources project --permission-mode manual` so the machine's own allow rules could not answer for it. Codex ran with `-s read-only -a on-request` and the hook passed with `-c hooks.PermissionRequest=…` plus `--dangerously-bypass-hook-trust` for that run only.

**Observed for Claude Code: outcome B** (with a twist on "No").

- (a) **Visible.** While the hook waits, the terminal shows the normal "Do you want to proceed?" dialog, with "running PermissionRequest hooks…" in the status line.
- (b) **It depends on the answer.**
  - **Yes** in the terminal runs the tool at once, but the hook is *not* stopped. It kept running until its own deadline or the end of the session. A decision the hook printed afterwards (a late deny) was parsed but ignored: the tool had already run, and the session carried on.
  - **No** in the terminal cancels the hook. Claude Code logs `cancelled` and kills it without a signal the hook can catch, so the hook cannot clean up after itself. The server drops the pending prompt because its pid is dead, and a late tap gets "no longer waiting".
  - A hook answer while the dialog is showing applies at once: the tool runs and the terminal dialog closes.
- (c) **Accepted as in the fixtures.**
  - The allow and deny outputs were accepted in both `-p` and interactive mode. Deny reached the model as the tool error "Denied from Mission Control".
  - The AskUserQuestion output (`permissionDecision: "allow"` plus `updatedInput` with the original `questions` and an `answers` map of question → label) was accepted. The debug log said "Hook satisfied user interaction for AskUserQuestion via updatedInput", and the model replied with the picked labels.
  - AskUserQuestion exists only in interactive sessions; in `-p` mode the model cannot call it.
- **Other blocking hooks delay the answer.** Claude Code applies a PermissionRequest decision only when *every* PermissionRequest hook has finished. With a terminal wrapper that adds its own blocking PermissionRequest hook (cmux did on the build machine), a phone answer took effect only when that other hook returned.

**Observed for Codex: outcome C**.

- While the hook waits, Codex shows only "Running hook". The "Would you like to run the following command?" dialog appears only after the hook exits without a decision, which is the fail-open path.
- (e) The allow and deny outputs were accepted (deny shows "Blocked by hook └ Denied from Mission Control").
- Codex's `PermissionRequest` payload carries `session_id`, `turn_id`, `tool_name` and `tool_input`, but **no call id**, so Codex prompts are keyed by session only.
- `codex exec` always runs with `approval: never`, so it never asks and the hook never fires there.

The outputs in `test/fixtures/remote/` are the ones these harnesses accepted, byte for byte (`claude-ask.json` is the exact accepted output). The `*.input.json` files there are the real hook payloads (home path replaced):

| fixture | output |
|---|---|
| `claude-permission-allow.json` | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}` |
| `claude-permission-deny.json` | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Mission Control"}}}` |
| `claude-ask.json` | `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","updatedInput":{"questions":[…],"answers":{"<question>":"<label>"}}}}` |
| `codex-permission-allow.json` | the same allow shape (Codex: `updatedInput`, `updatedPermissions` and `interrupt` fail closed, so none are sent) |
| `codex-permission-deny.json` | the same deny shape |

`test/remote-spike-outcome.test.mjs` pins the hook to these outputs. It also replays the observed paths through the bin using the real payloads:
- terminal Yes, then PostToolUse: nothing printed;
- terminal No as an uncatchable kill: the prompt is gone;
- the AskUserQuestion pick;
- Codex allow and deny without a call id.

### What each outcome means for you

The design works under all three. The spike saw **outcome B for Claude Code** and **outcome C for Codex**.

| Outcome | What you see |
|---|---|
| **Outcome A.** Terminal prompt visible, and a terminal answer cancels the hook | Answer in either place. If you answer in the terminal, Claude Code stops the hook, its pending prompt disappears (the server drops prompts whose hook process is gone), and the desktop and phone cards clear. A late phone tap shows "no longer waiting" or "answered in terminal". |
| **Outcome B.** Terminal prompt visible, but the hook keeps waiting | Answer in either place. The server sees the terminal answer in the hook log and tells the hook to give up; the hook prints nothing. A late phone tap shows "answered in terminal". The hook also re-checks the log right before it prints, so a late phone answer never reaches the session. |
| **Outcome C.** Terminal prompt hidden while the hook waits | While a phone is paired and remote answering is on, the terminal prompt appears only after `remote.waitSeconds` (default 120) unless the phone answers. Lower `remote.waitSeconds` or turn remote answering off (`mission-control remote off`) when you sit at the desk. With the server stopped, remote off, or no paired device, the hook returns at once. |

In practice, with these versions:

- **Claude Code:** answer in either place. A terminal **Yes** leaves the hook waiting until Claude Code's `PostToolUse` arrives; then the hook gives up silently. A phone tap after that shows "answered in terminal". For a long-running command, the tap can be accepted before `PostToolUse` arrives. Then the audit log records it, but Claude Code ignores the late output: the command was already allowed. A terminal **No** kills the hook, and a phone tap shows "no longer waiting".
- **Codex:** while a phone is paired and remote answering is on, the Codex approval dialog appears only after `remote.waitSeconds` (default 120) unless the phone answers first. At the desk, lower `remote.waitSeconds` or run `mission-control remote off`.

`(d)` **not run.** Checking the `Host` and `Origin` headers needs `tailscale serve` turned on for the machine's tailnet name, which the spike did not do. It stays for the on-device check (T24). The listener accepts only `Host` `<name>.ts.net` or `<name>.ts.net:443` and `Origin` `https://<name>.ts.net`. If `tailscale serve` turns out to rewrite `Host`, every request gets 403; that will be raised, not worked around by loosening the check.

## Troubleshooting

| Problem | Fix |
|---|---|
| Not sure what is missing | `mission-control remote doctor` lists each step with its fix. |
| No notification arrives | Notifications are per phone: open the Home Screen app and tap **Turn on notifications**; check iOS Settings → Notifications → Mission Control. The laptop needs internet to reach the push service. |
| `remote on` exits 2 naming `remote.host` | Set `remote.host` to your `<name>.ts.net` in `config.json`. |
| `remote on` exits 2 naming `remote.port` | The port is in use or equals the dashboard port. Set another `remote.port`. |
| `remote on` says "server did not respond" | The dashboard is hung or stopping. Nothing changed; restart it. |
| The phone shows "Run `mission-control remote pair` on your computer." | The phone has no device cookie (new browser, cleared data). Pair again. |
| "This pairing link expired or was already used." | Links work once, for 10 minutes. Run `remote pair` again. |
| The phone shows "offline, can't answer" | The phone is offline, the server stopped, remote answering is off, or `tailscale serve` is not running. |
| Every request gets 403 | The Host is not exactly the configured name. Open `https://<remote.host>`, not an IP or another name. |
| The phone shows a prompt as "answer where the agent runs" | It cannot be answered remotely: a run-format source, a subagent, a Codex option prompt, a multi-select question, or a hook installed before v2.3. |
| A Codex approval never waits | Re-run `hooks install codex`, merge, and re-trust with `/hooks`. The old `timeout: 10` stops the hook early. |
| The Codex approval dialog shows up only after about two minutes | Expected while remote answering is on and a phone is paired: Codex hides its dialog while the hook waits. Answer on the phone, lower `remote.waitSeconds`, or run `mission-control remote off` at the desk. |
| A phone answer applies only after a delay, or never before the terminal prompt | Another `PermissionRequest` hook is still running: Claude Code waits for all of them. Check your other hooks and terminal wrappers (for example cmux) for a blocking `PermissionRequest` hook. |
