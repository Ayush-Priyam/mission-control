# Cross-lane tests

- X1 (C4): Run `npm run build` and list `dist/`. It contains `remote.html`, `manifest.webmanifest`, `sw.js`, the three icons under `icons/` and bundles under `assets/`. Every script, style and manifest reference in `remote.html` starts with `/`.
- X2 (C5, C7): Start with `--remote-port 4330 --remote-host laptop.tail1234.ts.net` and send Host `laptop.tail1234.ts.net`. Request `/`, `/pair`, `/manifest.webmanifest`, `/sw.js`, `/icons/icon-192.png` and one `/assets/*` file: each returns 200 with the Content-Type from C5. `/api/items`, `/api/usage`, `/api/remote/enabled` and `/foo` return 404.
- X3 (C2, C6): Open `dist/manifest.webmanifest`. It has the C6 fields, every icon `src` resolves to a design-delivered PNG of its declared size, and the maskable entry has `purpose:"maskable"`.
- X4 (C3): Compare the manifest colours and the `theme-color` meta with the hex values in `design/remote-pwa.md`: they match. Grep `web/src/remote/`, `web/src/views/Remote.tsx` and the top-bar indicator for hex or rgb literals: there are none.
- X5 (C7, C8): Load the phone page through the remote listener with the correct Host and Origin, then pair, list and answer. All succeed. Every request in the network log goes to the page's own origin under `/api/remote/`, and every POST has `Content-Type: application/json`.
- X6 (C7): Send `POST /api/remote/answer` to the remote listener with a wrong Host, then a wrong Origin, then no Origin. Each returns 403. A `text/plain` POST returns 415.
- X7 (C9, C24, C47): Start with a fresh temp home and no flags. Only `:4319` listens. On it:
  - `GET /api/remote/status` returns 200 with `enabled:false`;
  - POST `/api/remote/pair`, POST `/api/remote/answer`, GET `/api/remote/prompts`, GET `/api/remote/events`, GET `/api/remote/enabled` and POST `/api/remote/devices` all return 404;
  - `POST /api/remote/enabled` with no Origin returns 403.
  
  Click every control on `#/remote`. The only non-GET request sent is `POST /api/remote/enabled` from the switch, and there is no pair or revoke button.
- X8 (C11, C26): Run `mission-control remote pair` and open the URL on the phone. The phone lands on `/` with a `__Host-mc_device` cookie that has Path=/, Secure, HttpOnly and SameSite=Strict, and no `#t=` in the address bar. Reopen the same URL: it shows the "expired or was already used" message.
- X9 (C11, C26): Make 11 bad pair POSTs within one minute. The 11th returns 429 `{error:"too many attempts"}`, and the screen shows "Too many attempts. Wait a minute and try again."
- X10 (C12, C13, C25): Clear the phone's cookie and open `/`: the not-paired screen shows. Pair again, run `remote revoke <id>`, then refresh. The revoked screen shows, and the response carried `Set-Cookie` with `Max-Age=0`.
- X11 (C13, C23, C25): With the prompt list open, run `remote revoke <id>`. The next SSE-triggered prompts fetch returns 401 "device revoked", and the phone switches to the revoked screen without a reload.
- X12 (C14, C10, C27): Open one Claude permission prompt. Phone and desktop show the same tool, masked target and "asked N ago". The phone card has exactly two buttons, Allow and Deny.
- X13 (C14, C31): With no prompts open, `GET /api/remote/prompts` returns `{prompts:[]}` and the phone shows "Nothing needs you right now."
- X14 (C15, C27):
  - Trigger an AskUserQuestion with two single-select questions. Each question shows its option buttons, and Send stays disabled until both are picked.
  - Trigger one with a `multiSelect` question. The card shows "answer where the agent runs" and has no buttons, and the JSON entry has no `promptId` or `bind`.
- X15 (C16, C28): Tap Allow. The POST body is `{promptId, bind, decision:"allow"}` with the values from the prompts response, and the reply is 200 `{ok:true}`. The card shows "Allowed", then clears on phone and desktop, and the session continues. Repeat with Deny, which shows "Denied", and with an ask pick, which shows "Answered" and continues Claude with that label.
- X16 (C17, C29, C21): Display a prompt, replace it within the same session, then tap Allow on the old card. The phone shows "prompt changed, nothing was approved", and the new prompt stays pending. After a refresh, the card shows the "new prompt" flag.
- X17 (C17, C29):
  - Answer in the terminal, then tap on the phone: it shows "answered in terminal".
  - Let a prompt time out (waitSeconds 10), then tap: it shows "no longer waiting".
  - Tap Allow on two phones at once: one shows "Allowed" and the other "already answered".
- X18 (C18): Open events with a valid cookie. A heartbeat arrives at least every 3 s. A new pending prompt produces `changed`, and the new card appears without a reload.
- X19 (C19, C32, C31): With one paired device and remote off but `remote.host` set, `#/remote` shows:
  - the switch off;
  - the configured host, port 4330 and waitSeconds;
  - the device's label, id, paired time and last-seen.
  
  No key in the status JSON contains "token", "secret" or "Hash". After `remote revoke`, the page shows "No paired devices".
- X20 (C20, C22): Make the answer POST fail at the network level. The card shows "offline, can't answer", no second POST is sent, and the hook falls back to the terminal on timeout. Cache Storage holds no `/api/` entry.
- X21 (C30, C22): Install the PWA, switch on airplane mode and open it. The shell loads, the banner reads "offline, can't answer", and every answer button is disabled. Stop the server while online: within 6 s the banner appears and the buttons are disabled.
- X22 (C27): Measure the Allow, Deny, option and Send buttons in the phone viewport. Each is at least 48×48 CSS px.
- X23 (C33): Stop the server while a hook waits. The hook exits 0 with empty stdout within about 6 s, and the terminal handles the prompt. With remote on and no device paired, the hook returns at once, empty.
- X24 (C34, C16): Make one accepted tap and one refused tap. `audit.jsonl` (mode 0600) gains exactly one answer line, with the C34 keys and no raw target text.
- X25 (C35): Run `npm test` and `node --test` with `HOME` set to an empty temp dir. Both pass, the real `~/.claude`, `~/.codex` and `~/.mission-control` are untouched, and `package.json` `dependencies` is unchanged.
- X26 (C38, C9): Send `POST /api/remote/enabled {"enabled":true}` to `:4319` with these variations:
  - correct Host but no Origin: 403;
  - `Origin: http://evil.example`: 403;
  - wrong Host: 403;
  - correct Origin but `text/plain`: 415;
  - correct Origin with JSON `{"enabled":"yes"}`: 400.
  
  Afterwards, `status.enabled` is unchanged and `audit.jsonl` has no new line.
- X27 (C37, C44): With no `remote.host` in config, flip the dashboard switch on. The switch stays off and shows an error containing "remote.host", and the response was 422 `{error, key:"remote.host"}`. `mission-control remote on` exits 2 with a message containing "remote.host". No second socket opens and no audit line is added.
- X28 (C36, C39, C43, C44): Set `remote.host` in config and flip the dashboard switch on. Then:
  - the switch shows on and the top bar shows "Remote on";
  - `GET /` on 4330 with the correct Host returns 200;
  - server stdout shows the `tailscale serve` hint and the Funnel warning;
  - `config.json` has `remote.enabled:true` and its other keys intact;
  - `audit.jsonl` gains one line `{actor:"dashboard", action:"remote-on"}`.
- X29 (C40, C45, C33, C18): With a hook waiting and its card open on the phone, flip the switch off. Then:
  - the hook exits 0 with empty stdout within 1 s, and the terminal prompt handles the request;
  - the phone receives `changed`, then shows "offline, can't answer" with its buttons disabled;
  - connecting to 4330 is refused;
  - the audit gains `{actor:"dashboard", action:"remote-off"}`.
  
  Flip the switch on again. The phone recovers with its existing cookie, without pairing.
- X30 (C42, C44, C41, C43): With the server running, run `mission-control remote on` (exit 0), then `remote status` (prints `remote: on`). The dashboard switch and the top bar show on within 5 s without a reload. Run `remote off`: both show off within 5 s. The audit gains two lines with `actor:"cli"`.
- X31 (C42, C36, C47): With no server running and a fresh home, `remote status` prints `remote: off` and `server: not running`. Set the host and run `remote on`. Config gets `remote.enabled:true` and the audit gets one `cli` line. Start `mission-control` with no flags: the remote listener opens and the dashboard shows on. Run `remote off` and restart: remote stays off.
- X32 (C36, C19): Set config host `a.ts.net` and port 4330. Start with `--remote-host b.ts.net --remote-port 4331`. Status shows host `b.ts.net` and remotePort 4331. On 4331, Host `b.ts.net` is accepted and Host `a.ts.net` gets 403. `config.json` is byte-identical afterwards.
- X33 (C38, C43): Turn on from the dashboard, then send the same request again. The second response is 200 with `enabled:true`, and `audit.jsonl` holds exactly one `remote-on` line.
- X34 (C46, C9, C38): Read the README Security section. It names `POST /api/remote/enabled` as the only `:4319` write route, lists its guards, says remote is off by default, and says pairing and revoke are CLI-only. Each statement matches what X7 and X26 observe.
