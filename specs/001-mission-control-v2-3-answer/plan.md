# Plan 001: v2.3 remote answering

## Fit with the existing code

- **Server** (`src/server.mjs`): `createServer` binds loopback on v4 and v6 with the Host, Origin and content-type guards. That listener stays as it is. The only change is one read-only GET route, `/api/remote/status`. The second listener is a new module so it merges cleanly, the same way `src/api-v22.mjs` was kept apart.
- **Hooks** (`src/hooks.mjs`, `bin/mission-control.mjs`): the hook entry is synchronous, swallows errors and always exits 0. The wait keeps that model:
  - a sync poll with `Atomics.wait` (already used for the stdin retry);
  - file IPC under `~/.mission-control/remote/`;
  - no sockets in the hook, so the hook needs no network path into a listener and `:4319` gets no write route.
- **Waiting state**: `waitingFromHooks` already clears on PostToolUse, PermissionDenied and the rest. New `RemoteAnswered` lines join `CLEARS` and `KEYED_CLEARS`, so the desktop card clears through the existing path.
- **Change feed**: the remote listener runs its own `createChangeFeed` (from `src/events.mjs`) over the hook directories and `remote/pending`.
- **Config**: `remote.waitSeconds` is read like the other `config.json` keys. A broken file means the default.
- **Web**: Vite gains a second HTML entry (`web/remote.html`) that shares `@/components/ui/*` and the theme tokens. `web/public/` (a new directory) holds the manifest, the service worker and the icons, copied to `dist/`.
- **Design system**: the design system is provided by the user. The PWA uses the existing tokens in `web/src/styles/globals.css` and the primitives in `web/src/components/ui/`. When the provided design system lands in the repo, its tokens replace those in `globals.css` and the PWA picks them up with no code change.

## On-disk layout (new)

```
~/.mission-control/            (MISSION_CONTROL_HOME/.mission-control in tests and demo)
  audit.jsonl                  0600, append-only
  remote/                      0700
    server.json                {pid, remotePort, host, waitSeconds, enabled:true, startedAt}; mtime touched every 2 s = heartbeat
    pairing.json               {tokenHash, expiresAt, usedAt|null}
    devices.json               {devices:[{id, label, secretHash, pairedAt}]}
    pending/<promptId>.json    written by the hook (FR-11) + pid
    pending/<promptId>.decision.json   written once by the listener via tmp + linkSync (EEXIST = already answered)
```

- All writes use temp file then `renameSync` or `linkSync`, with mode 0600. The `remote/` directory is 0700.
- `server.json` is removed on clean shutdown. A stale mtime (over 6 s) or a dead pid means the server is down.

## Modules and files

### Backend (new)
- **`src/remote/state.mjs`**
  - `remoteDir(home)`, `writeJsonAtomic`, `readJson` (stat-cached), `isPidAlive`.
  - `publishServer` and `touchHeartbeat` (interval, unref'd), `readServer(remoteDir, now)`.
  - `readWaitSeconds(configPath)`: integer 10–600, default 120.
- **`src/remote/pairing.mjs`**
  - `createPairingToken({remoteDir, now})` → `{token, url, expiresAt}`.
  - `redeemToken({remoteDir, token, ua, now})` → `{device, cookie}` or `null`.
  - `listDevices`, `revokeDevice(id)`.
  - `parseCookie(header)`, `verifyDevice({remoteDir, cookie})` → device, `"revoked"` or `null`. Uses `timingSafeEqual` on SHA-256 digests.
  - `cookieHeader(id, secret)` and `clearCookieHeader()`.
  - An in-memory failed-attempt counter for the 429.
- **`src/remote/prompts.mjs`**
  - `bindHash(p)`.
  - `writePending` and `removePending` (hook side).
  - `listPending({remoteDir, hooksDir, now})`: drops dead pids and deletes their files; drops prompts with a decision; drops prompts whose session log shows a clear after `askedAt`.
  - `decide({remoteDir, hooksDir, promptId, bind, decision, device})` → `{ok}` or `{reason}`.
  - `abandonAnswered(...)`: writes `abandon` for prompts cleared in the terminal (outcome B).
  - `validateAnswers(questions, answers)`.
- **`src/remote/hook-wait.mjs`**: sync, `node:` built-ins only.
  - `shouldWait({event, input, remoteDir, now})`.
  - `waitForDecision({...pending, deadline, sleep, now})` → decision or `null`.
  - Output builders: `claudePermissionOutput`, `claudeAskOutput(questions, answers)`, `codexPermissionOutput`. Their shapes are pinned by the spike (fixtures).
- **`src/remote/audit.mjs`**: `appendAudit({home, device, promptId, decision, tool, target})`. It hashes the target and opens with `{flag:"a", mode:0o600}`.
- **`src/remote/server.mjs`**: `createRemoteServer({port, host, home, remoteDir, hooksDir, codexHooksDir, distDir, registry, now})`.
  - Binds `127.0.0.1` only.
  - Host and Origin guards (FR-3) and a JSON-only POST, reusing `json` and `readBody`, now exported from `src/server.mjs`.
  - Routes from FR-4 and FR-7 to FR-15. The static allow-list maps `/` and `/pair` to `dist/remote.html`.
  - Its own SSE clients and change feed.
  - Keeps `lastSeenAt` per device in memory and exposes it to the status route through a shared `remote` object.
- **`src/qr.mjs`**: QR encoder, byte mode, ECC M, versions 1–10. Pure, with no `node:` imports. `toTerminal(matrix)` draws it with half-block characters.

### Backend (changed)
- **`src/hooks.mjs`**
  - `RemoteAnswered` is added to `CLEARS` and `KEYED_CLEARS`.
  - `recordRemoteAnswered({hooksDir, harness, sessionId, callId})`.
  - `recordAskOpen` writes the Notification line with kind `ask_user_question`.
  - `settingsBlock` and `codexHooksBlock` take `waitSeconds` and set the timeouts from FR-21.
  - The existing tests in `test/hooks.test.mjs` must keep passing.
- **`bin/mission-control.mjs`**
  - Hook path: after `recordHook` or `recordCodexHook`, call `shouldWait`. If it says wait, write pending, wait, re-check, record `RemoteAnswered`, then `process.stdout.write(output)`. All of it sits inside the existing try with `process.exit(0)`.
  - The remote directory resolves from `MISSION_CONTROL_HOME` or `homedir()`.
  - SIGTERM and SIGINT handlers remove the pending file.
  - New `remote pair|devices|revoke <id>` subcommands.
  - `hooks install` reads `waitSeconds` and prints the re-merge and re-trust note to stderr.
  - Server start: when `--remote-port` is set, call `createRemoteServer` after `createServer` and print the `tailscale serve --bg --https=443 http://127.0.0.1:<rp>` hint and the Funnel warning.
- **`src/adapters/load.mjs`**: `VALUE_FLAGS` gains `--remote-port` and `--remote-host`. The validation (FR-2) runs in bin.
- **`src/server.mjs`**: export `json` and `readBody`. Add `GET /api/remote/status`, which reads the shared `remote` object (disabled → `{enabled:false, devices:[...from disk]}`). No POST route is added; a test proves the 404s.
- **`src/sources/registry.mjs`** and **`src/sources/codex/index.mjs`**: needsYou entries carry `sessionId` (Claude: the id; Codex: the session_id it already keys hook state by), so pending prompts can be joined to entries.
- **`src/events.mjs`**: no change. The remote feed passes its own targets.

### Frontend
- **`web/vite.config.ts`**: `build.rollupOptions.input = {main: "index.html", remote: "remote.html"}`. The dev proxy is unchanged.
- **`web/remote.html`**: viewport, theme-color, manifest link, and the same pre-paint theme script. It loads `/src/remote/main.tsx`.
- **`web/src/remote/main.tsx`**: registers `/sw.js` and renders `RemoteApp`.
- **`web/src/remote/RemoteApp.tsx`**: path router (`/pair` vs `/`) and state machine `loading | unpaired | revoked | ready`.
- **`web/src/remote/PairScreen.tsx`**, **`PromptList.tsx`**, **`PromptCard.tsx`** (permission, ask and read-only variants), **`OfflineBanner.tsx`**.
- **`web/src/lib/remote.ts`**: typed client with `pair`, `prompts`, `answer`, `status`, an `connectRemoteEvents` (the `server-events.ts` pattern), `reasonText(reason)`, and a `useOnline` hook.
- **`web/public/manifest.webmanifest`**, **`web/public/sw.js`**, **`web/public/icons/{icon-192,icon-512,maskable-512}.png`**.
  - `sw.js`: precache the shell on install. Cache-first for `/assets/*` and `/icons/*`. Network-first navigation with fallback to the cached `/`. `/api/*` is passed straight to the network, never cached, and a failure is returned as-is.
- **`web/src/views/Remote.tsx`**, plus `web/src/lib/route.ts` (`view: "remote"`), `web/src/App.tsx` and `web/src/components/Sidebar.tsx` (link): the read-only desktop page.

## API summary

| Listener | Method and path | Auth | Result |
|---|---|---|---|
| :4319 | GET `/api/remote/status` | loopback Host | `{enabled, host, remotePort, waitSeconds, devices[], pairing}` |
| :4319 | any other `/api/remote/*` | – | 404 |
| remote | POST `/api/remote/pair` | Origin + JSON | 200 + Set-Cookie / 401 / 429 |
| remote | GET `/api/remote/me` | cookie | `{device:{id,label}}` / 401 `{error}` |
| remote | GET `/api/remote/prompts` | cookie | `{prompts:[{source,id,title,project?,lane,tool,target,since, answerable, promptId?, bind?, kind?, questions?}]}` |
| remote | GET `/api/remote/events` | cookie + Origin if sent | SSE `changed`, `heartbeat` |
| remote | POST `/api/remote/answer` | cookie + Origin + JSON | 200 / 400 / 401 / 409 `{reason}` |

## Answer flow

```
hook (sync)                      files                        remote listener                 phone
record line ─┐
shouldWait? ─┤ no → exit 0 (empty)
             └ yes → pending/<id>.json ─────────────▶ listPending → SSE changed ───▶ card
poll 200ms ◀── <id>.decision.json ◀─ link (once) ◀── decide(bind ok, alive, not cleared) ◀ tap
re-check log → RemoteAnswered line → print output → rm pending → exit 0
terminal answered (B) → log clear → listener writes abandon → hook exits empty
```

## Testing (node --test, temp homes)
- `test/remote-pairing.test.mjs`: single use, expiry, unknown token, hash at rest (no raw token in the file), 429, revoke means 401 on the next request, cookie attributes.
- `test/remote-prompts.test.mjs`: bind mismatch gives `changed`; replaced prompt gives `changed` and the new one stays undecided; concurrent decide gives exactly one ok; dead pid gives `gone`; a log clear after `askedAt` gives `terminal`; ask validation (option not listed, multiSelect, extra keys).
- `test/remote-hook-wait.test.mjs`:
  - Spawns `bin/mission-control.mjs hook PermissionRequest` with temp env.
  - Fail-open cases each give empty stdout and exit 0: server down, stale heartbeat, no device, timeout (`waitSeconds` shortened via `server.json`), abandon.
  - A decision gives the exact fixture output and a `RemoteAnswered` line.
  - Outcome B guard: a clear lands just before the decision, and stdout is empty.
  - The subagent case does not wait.
- `test/remote-server.test.mjs`: Host and Origin and 415 refusals; static allow-list; no dashboard API; SSE `changed` on a new pending prompt; audit line written once, 0600, with no raw target; end to end pair → prompts → answer.
- `test/server.test.mjs` (extended): no second listener without the flag; `:4319` 404s for the answering routes; existing 403 and 415 unchanged; status route read-only.
- `test/hooks.test.mjs` (extended): `RemoteAnswered` clears (keyed and unkeyed); ask Notification opens; install timeouts.
- `test/qr.test.mjs`: known vectors (version, ECC, mask) match reference matrices.
- `test/remote-spike-outcome.test.mjs`: encodes the observed outcome against the fixtures in `test/fixtures/remote/`.
- vitest: `web/src/remote/*.test.tsx`, one per screen (pair, list with each card type, result and 409 texts, offline and revoked), plus `web/src/views/Remote.test.tsx`.

## Risks
- **Spike outcome C** (prompt hidden while the hook waits): a phone user who never answers costs a 120 s stall. This is mitigated by fail-open on no device or server down, and by `waitSeconds` being configurable. It is documented.
- **Hook output schemas** (Claude PermissionRequest, PreToolUse `updatedInput`, Codex) can change between versions. They are pinned by spike fixtures, and the docs name the tested versions.
- **`tailscale serve` header handling**: if Host is rewritten, the allow-list refuses everything. The spike records the headers. If they are rewritten, raise it with pm; do not loosen the check.
- **Hook timeouts in old installs**: Codex `timeout: 10` kills the wait early. That is safe, because it fails open. The docs tell users to re-merge.
- **Security-critical surface grows**: cookie verification, the static allow-list and the decision exclusivity. Each has a dedicated test, and `readBody`'s 64 KB limit is reused.
- **File races** between a CLI revoke and a server pair: atomic rename means the last writer wins. The server re-reads before it adds a device. Accepted, given one user.
- **Model-written AskUserQuestion text** is shown on the phone and kept in pending files (0600, deleted on exit). It is never in the hook log or the audit.
- **QR encoder correctness**: tested against reference vectors, and the URL is always printed too.

## Design decisions
- **Cookies and sessions (sd101), applied:** each device holds only an opaque id and secret in a `__Host-` cookie. The server keeps the device record and checks it on every request, so a revoke takes effect on the next request. The scalability downside does not apply to one local process.
- **Session-cookie "not mobile app friendly", rejected as a concern:** the phone client is a browser PWA, where HttpOnly, SameSite=Strict cookies are the strongest option and stay hidden from JS.
- **Token / JWT (stateless), rejected:** a self-contained token cannot be revoked before it expires without a server-side denylist, which is the session store again. Single-use pairing needs server state anyway.
- **SSO / OAuth 2.0, rejected:** it needs an identity provider, accounts or a cloud, all ruled out ("No accounts", no relay). Tailscale identity headers are not trusted on their own.
- **One-time pairing token, applied:** a hashed, 10-minute, single-use token in the URL fragment bridges the trusted desktop and the phone without accounts.
- **File IPC between hook and server, chosen over a hook HTTP endpoint:** it keeps the hook synchronous and network-free, and it adds no write route on any listener the hook would need to reach.
