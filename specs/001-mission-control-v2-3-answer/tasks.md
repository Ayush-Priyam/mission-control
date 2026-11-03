# Tasks 001: v2.3 remote answering

- [x] T1 [backend] Spike. In a temp dir, run a real Claude Code session with a PermissionRequest hook that waits 60 s, and a PreToolUse(AskUserQuestion) hook, then run Codex with a PermissionRequest hook. Record findings (a)–(e) from spec.md, including the Host and Origin headers seen behind `tailscale serve`. Write them in `docs/remote-answering.md` under "Spike findings": versions, the outcome observed (A, B or C), and the exact accepted outputs. Save those outputs as fixtures in `test/fixtures/remote/` (`claude-permission-allow.json`, `claude-permission-deny.json`, `claude-ask.json`, `codex-permission-allow.json`, `codex-permission-deny.json`).
- [x] T2 [backend] Create `src/remote/state.mjs`: `remoteDir`, atomic JSON writes (mode 0600, dir 0700), `isPidAlive`, the `server.json` publish and 2 s heartbeat, `readServer` (stale after 6 s or dead pid), and `readWaitSeconds` (10–600, default 120, broken config means default). Tests in `test/remote-state.test.mjs` with temp homes.
- [x] T3 [backend] Create `src/remote/pairing.mjs`:
  - token create, which stores the SHA-256 only, expires after 10 minutes and replaces any unused token;
  - redeem, which is single use and creates a device;
  - `listDevices` and `revokeDevice`;
  - cookie build and parse;
  - constant-time `verifyDevice` returning a device, `"revoked"` or `null`;
  - the failed-attempt counter (429 after 10 a minute).

  Tests in `test/remote-pairing.test.mjs`: second use, expired, unknown, no raw token on disk, revoke means refused on the next verify, and cookie attributes `__Host-`, HttpOnly, Secure, SameSite=Strict, Path=/.
- [x] T4 [backend] Create `src/remote/prompts.mjs`:
  - `bindHash`;
  - `writePending` and `removePending`;
  - `listPending`, which drops dead pids, decided prompts and prompts cleared in the log after `askedAt`;
  - `decide`, using a create-exclusive decision via tmp + `linkSync` and returning reasons `changed`, `answered`, `terminal` or `gone`;
  - abandon for prompts cleared in the terminal;
  - `validateAnswers`, which allows exactly one listed label per question and no multiSelect or free text.

  Tests in `test/remote-prompts.test.mjs`, including concurrent decide giving exactly one ok, and a replaced prompt giving `changed` while the new prompt stays undecided.
- [x] T5 [backend] Create `src/remote/audit.mjs` (`appendAudit`, file mode 0600, append-only, `targetHash` = SHA-256 of the masked target, or of the question texts for ask). Tests in `test/remote-audit.test.mjs`: one line per call, mode 0600, and none of the raw target, command, question or option text present.
- [x] T6 [backend] In `src/hooks.mjs`:
  - add `RemoteAnswered` to `CLEARS` and `KEYED_CLEARS`;
  - add `recordRemoteAnswered`, and `recordAskOpen` (Notification, kind `ask_user_question`);
  - make `settingsBlock` and `codexHooksBlock` take `waitSeconds` and set `timeout: waitSeconds + 15` on Claude PermissionRequest and PreToolUse and on Codex PermissionRequest, leaving other Codex entries at 10.

  Extend `test/hooks.test.mjs`. All existing hook tests must still pass.
- [x] T7 [backend] Create `src/remote/hook-wait.mjs`:
  - `shouldWait`, which waits only for main-agent Claude PermissionRequest, Claude PreToolUse AskUserQuestion and Codex PermissionRequest, and only with a live server, remote enabled and at least one device;
  - a sync `waitForDecision` (200 ms poll; exits on deadline, stale heartbeat, abandon, or a log clear after `askedAt`);
  - the output builders, matching the T1 fixtures.
- [x] T8 [backend] In `bin/mission-control.mjs`, wire the hook path:
  1. record;
  2. `shouldWait`;
  3. on wait for AskUserQuestion, `recordAskOpen`;
  4. write pending and wait;
  5. re-check the log;
  6. `recordRemoteAnswered`;
  7. print the output.

  Pending is removed on every exit, including SIGTERM and SIGINT, and the path always exits 0. `hooks install [codex]` uses `readWaitSeconds` and prints the re-merge note (plus the Codex `/hooks` re-trust note). Tests in `test/remote-hook-wait.test.mjs` spawn the bin with temp env and cover:
  - server down, stale heartbeat, no device, timeout, abandon, and a subagent request (each gives empty stdout and exit 0);
  - allow, deny and ask (each gives the exact fixture output plus a `RemoteAnswered` line);
  - the outcome B guard;
  - `onFailure` absent from the install output.
- [x] T9 [backend] Create `src/qr.mjs` (pure, no `node:` imports; byte mode, ECC M, versions 1–10, `toTerminal`). Tests in `test/qr.test.mjs` against reference matrices.
- [x] T10 [backend] Add the `remote pair` (prints URL and QR), `remote devices` and `remote revoke <id>` (unknown id exits 1) subcommands to `bin/mission-control.mjs`, and the `--remote-port` and `--remote-host` flags to `src/adapters/load.mjs`. Validate in bin: the host must be `*.ts.net`, the port must differ from `--port`, and either flag alone exits 2. Tests in `test/remote-cli.test.mjs`.
- [x] T11 [backend] Create `src/remote/server.mjs` (`createRemoteServer`):
  - binds 127.0.0.1 only;
  - Host allow-list `<host>` and `<host>:443`; Origin `https://<host>` (403); POST with no Origin gets 403; non-JSON POST gets 415;
  - the static allow-list from `dist/remote.html` and the assets; every other path gets 404, including dashboard APIs;
  - the `pair`, `me`, `prompts`, `events` (SSE) and `answer` routes;
  - an audit line on each accepted decision;
  - in-memory `lastSeenAt`, and abandon for terminal-cleared prompts on each scan.

  Export `json` and `readBody` from `src/server.mjs`. Start it from `bin/mission-control.mjs` when the flag is set, printing the `tailscale serve` hint and the Funnel warning; `server.json` is removed on close. Tests in `test/remote-server.test.mjs`, covering an end-to-end pair → prompts → answer flow and every refusal.
- [x] T12 [backend] Add read-only `GET /api/remote/status` to `src/server.mjs` (never returns token or secret material). Extend `test/server.test.mjs`:
  - without `--remote-port`, no second listener is opened;
  - `:4319` returns 404 for POST `/api/remote/pair` and `/api/remote/answer` and GET `/api/remote/prompts` and `/api/remote/events`;
  - the existing 403 (Host, Origin) and 415 tests are unchanged and still pass.
- [x] T13 [backend] Add `sessionId` to needsYou entries in `src/sources/registry.mjs` (Claude: item id; Codex: the session_id from `src/sources/codex/index.mjs`). The remote prompts route joins pending prompts to entries by harness and sessionId (and `callId` for Codex). Extend `test/sources.test.mjs` and `test/codex.test.mjs`.
- [x] T14 [backend] Docs:
  - Rewrite the Security section and Flags table in `README.md`. Cover the two listeners, pairing and cookies, the audit log, the hook wait and fail-open, the Tailscale setup, the Funnel warning, and "Codex hooks are a guardrail, not a complete enforcement boundary".
  - Update `docs/claude-code.md` (new timeouts, AskUserQuestion, re-merge) and `docs/codex.md` (timeout raised from 10, re-trust with `/hooks`, allow and deny only).
  - Complete `docs/remote-answering.md` with setup, pairing, revoke, `remote.waitSeconds`, and what each spike outcome means for the user.
- [x] T15 [frontend] Configure the Vite multi-page build in `web/vite.config.ts` (inputs `index.html` and `remote.html`). Create `web/remote.html`, `web/src/remote/main.tsx` (service worker registration) and `web/public/manifest.webmanifest`, plus the icons `web/public/icons/icon-192.png`, `icon-512.png` and `maskable-512.png`.
- [x] T16 [frontend] Create `web/public/sw.js`: precache the shell, cache-first for `/assets/*` and `/icons/*`, network-first navigation with fallback to the cached `/`, and `/api/*` network-only, never cached or replayed. Unit test in `web/src/remote/sw.test.ts` drives the fetch handler with a fake Cache and asserts an `/api/` request is never put into the cache.
- [x] T17 [frontend] Create `web/src/lib/remote.ts`: typed `pair`, `me`, `prompts`, `answer`, `connectRemoteEvents`, `reasonText` (the four 409 texts), and `useOnline` (offline when `navigator.onLine` is false or events have been down for more than 5 s). Tests in `web/src/lib/remote.test.ts`.
- [x] T18 [frontend] Create `web/src/remote/RemoteApp.tsx`, `PairScreen.tsx`, `PromptList.tsx`, `PromptCard.tsx` and `OfflineBanner.tsx`:
  - Allow and Deny buttons at least 48 px; one option button per option; one pick per question plus Send when there are several questions;
  - read-only cards for unanswerable entries;
  - tool, target and asked time shown as on the desktop, plus the "new prompt" flag;
  - result and 409 reason text, the revoked and not-paired screens, and buttons disabled offline.

  Screen tests: `PairScreen.test.tsx` (ok, expired or used), `PromptList.test.tsx` (each card type, tap → `answer` called with `promptId` and `bind`, each 409 reason text, revoked), `OfflineBanner.test.tsx` (offline → banner shown and all answer buttons disabled).
- [x] T19 [frontend] Create `web/src/views/Remote.tsx`: a read-only desktop page showing status, the device list and copyable `remote pair` and `remote revoke <id>` commands, with no write buttons. Add `view: "remote"` to `web/src/lib/route.ts`, the route to `web/src/App.tsx`, and a link to `web/src/components/Sidebar.tsx`. Screen test `web/src/views/Remote.test.tsx`: fake status in, devices and commands shown, and an empty list after a fake revoke.
- [x] T20 [frontend] Make the whole build pass with the backend contract: `npm run typecheck`, `npm run build` (`dist/remote.html`, `dist/manifest.webmanifest` and `dist/sw.js` present) and `npm test`. Fix any type or contract mismatches in `web/src/lib/remote.ts` and `web/src/remote/*`.
- [ ] T21 [qa] From the test results ronin provides, confirm:
  - `remote-pairing`, `remote-prompts`, `remote-audit`, `remote-hook-wait`, `remote-server`, `remote-cli`, `qr`, `remote-spike-outcome`, and the extended `server`, `hooks`, `sources` and `codex` tests ran and passed, none skipped;
  - every vitest file under `web/src/remote/` and `web/src/views/Remote.test.tsx` passed.
- [ ] T22 [qa] From the code, confirm:
  - test setup uses temp homes only: no test reads or writes the real `~/.claude`, `~/.codex` or `~/.mission-control`;
  - `package.json` gained no runtime `dependencies`;
  - no hook output path uses `onFailure` or a non-zero exit.
- [ ] T23 [qa] Confirm `docs/remote-answering.md` names the outcome observed (A, B or C) and the tested versions, and that a test in `test/remote-spike-outcome.test.mjs` covers that outcome.
- [ ] T24 [qa] On a real laptop and phone on one tailnet, with `--remote-port` and `tailscale serve`:
  - pair by QR, and confirm the code is refused on a second scan and after 10 minutes;
  - allow, deny and pick an option on live Claude Code prompts, and allow and deny on a live Codex prompt;
  - check that both screens clear and the sessions continue.

  Record what was seen.
- [ ] T25 [qa] On the device:
  - replace a prompt between display and tap, and confirm "prompt changed" with the new prompt not approved;
  - answer in the terminal, and confirm the phone card clears and a late tap shows "answered in terminal";
  - revoke with the CLI, and confirm the phone is refused and the dashboard list drops the device;
  - stop the server, and confirm the terminal prompt handles the request immediately.
- [ ] T26 [qa] On the phone, run a Lighthouse-style installability check over HTTPS and confirm it passes. Install the app, go offline, and confirm the shell loads with "offline, can't answer" and disabled buttons. Read `~/.mission-control/audit.jsonl` and confirm one line per decision, mode 0600, and no raw command.
- [ ] T27 [qa] Update `ROADMAP.md`: add "Done in v2.3" with the remote answering items, and remove "Answer prompts from the browser" and "Approve and steer from a phone" from Later (noting that steering is still not done).
