# Contract: v2.3 remote answering (spec 001, revised for the pm's runtime on/off change)

Lanes: **design**, **backend**, **frontend**. These rules come from spec.md, plan.md and the pm's change that lets you turn remote answering on and off at runtime. If a rule has to change, add it to amendments.md before changing any code. Rule numbers C1–C35 keep their meaning. C7, C9, C19, C24, C32 and C33 are revised. C36–C47 are new.

## Ownership
- C1: Backend owns `src/**`, `bin/**`, `test/**/*.mjs`, `test/fixtures/remote/**`, `README.md`, `docs/**` and `ROADMAP.md`. Frontend owns `web/**` except `web/public/icons/**`. Design owns `web/public/icons/**` and `design/remote-pwa.md`. No lane edits another lane's files; changes go through amendments.md.
- C2: Design delivers three PNG icons: `web/public/icons/icon-192.png` (192×192), `icon-512.png` (512×512) and `maskable-512.png` (512×512, artwork inside the central 80% safe zone). Design also delivers `design/remote-pwa.md`, which specifies, using only existing tokens in `web/src/styles/globals.css`: every phone screen and card state in C25–C31; the desktop "Remote answering" switch in its off, on, switching and error states; and the top-bar "Remote on"/"Remote off" indicator. It also gives one `theme_color` and one `background_color` hex value.
- C3: `theme_color` and `background_color` in `web/public/manifest.webmanifest`, and `<meta name="theme-color">` in `web/remote.html`, equal the hex values in `design/remote-pwa.md` exactly. Phone and desktop remote components contain no hard-coded colour literals. They use only the tokens in `globals.css` and the primitives in `web/src/components/ui/`. Frontend may add a Switch primitive there.

## Build output the backend serves
- C4: `npm run build` produces `dist/remote.html`, `dist/manifest.webmanifest`, `dist/sw.js`, `dist/icons/{icon-192,icon-512,maskable-512}.png` and hashed bundles under `dist/assets/`. `remote.html` references them only by root-absolute paths (`/assets/...`, `/manifest.webmanifest`, `/sw.js`, `/icons/...`).
- C5: While it is open, the remote listener serves only these paths:
  - `GET /` and `GET /pair` return `dist/remote.html`.
  - `/manifest.webmanifest` is served with `Content-Type: application/manifest+json`.
  - `/sw.js` is served with `Content-Type: text/javascript` and `Cache-Control: no-cache`.
  - `/icons/*` and `/assets/*`.
  - `/api/remote/{pair,me,prompts,events,answer}`.
  - Every other path returns 404, including `/api/items`, `/api/calls`, `/api/usage` and `/api/remote/enabled`.
- C6: The manifest has `name` and `short_name` "Mission Control", `start_url "/"`, `scope "/"` and `display "standalone"`. Its icons are the three C2 files, and the maskable one has `"purpose":"maskable"`. The service worker is registered as `/sw.js` with scope `/`.

## Listeners and guards
- C7 (revised): The remote listener is open only while remote is on (C36–C40). It binds `127.0.0.1` only, on the effective remote port. Requests are refused as follows:
  - a Host other than `<host>` or `<host>:443` gets 403;
  - an Origin other than exactly `https://<host>` gets 403;
  - a POST with no Origin gets 403;
  - a non-JSON POST gets 415.
  
  While remote is off, no second socket is open.
- C8: The phone page makes only relative, same-origin requests: `fetch("/api/remote/...", {credentials:"same-origin"})` and `new EventSource("/api/remote/events")`. It never contacts another host or port. Every POST sends `Content-Type: application/json`.
- C9 (revised): `:4319` serves exactly two remote routes, `GET /api/remote/status` and `POST /api/remote/enabled`. Every other `/api/remote/*` path or method on `:4319` returns 404. That includes `POST /api/remote/pair`, `POST /api/remote/answer`, `GET /api/remote/prompts`, `GET /api/remote/events`, `GET` and `OPTIONS /api/remote/enabled`, and any devices or revoke path. Every other `:4319` route stays read-only, and its existing 403 and 415 behaviour is unchanged.

## API shapes (backend implements them; frontend types them in `web/src/lib/remote.ts` exactly)
- C10: All timestamps in `/api/remote/*` JSON are ISO 8601 UTC strings, with one exception: `since` in prompts has the same type and value as the `since` of the matching desktop Needs you entry.
- C11: `POST /api/remote/pair {token:string}` returns one of:
  - 200 `{device:{id,label}}`, plus `Set-Cookie: __Host-mc_device=<id>.<secret>; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000`;
  - 401 `{error:"pairing link expired or already used"}` when the token was used, has expired or is unknown;
  - 429 `{error:"too many attempts"}` after 10 failures in one minute;
  - 400 `{error}` for a malformed body.
- C12: `GET /api/remote/me` returns 200 `{device:{id,label}}`.
- C13: The cookie routes (`me`, `prompts`, `events`, `answer`) refuse only with 401, in one of two forms:
  - `{error:"not paired"}` when the cookie is missing or unknown;
  - `{error:"device revoked"}` for a revoked device, together with a `Set-Cookie` that clears `__Host-mc_device` (`Max-Age=0`).
  
  The frontend tells the two apart only by these exact strings.
- C14: `GET /api/remote/prompts` returns 200 `{prompts: Entry[]}`. With nothing open it returns `{prompts:[]}`, never 204 or null.
  - `Entry` is `{source, id, title, project?, lane, tool, target, since, answerable:boolean, promptId?, bind?, kind?:"permission"|"ask", questions?}`.
  - `target` is already masked and at most 120 characters. The frontend shows it unchanged.
- C15: `promptId`, `bind` and `kind` are present if and only if `answerable` is true, and `questions` is present if and only if `kind` is `"ask"`.
  - `questions` is `[{question, header, multiSelect:false, options:[{label, description}]}]`.
  - An ask with any `multiSelect` question, or with no options, is sent as `answerable:false` without these fields.
- C16: `POST /api/remote/answer {promptId, bind, decision}`. `decision` is `"allow"`, `"deny"` or `{answers:{[question]: label}}`.
  - Permission prompts accept only allow or deny.
  - Ask prompts accept only an answer set with exactly one listed label per question.
  - Success returns 200 `{ok:true}`. A malformed body or a wrong decision type returns 400 `{error}`.
  - No "always allow" or `updatedPermissions` field exists.
- C17: Every answer refusal is 409 `{error, reason}`, where `reason` is one of `changed`, `answered`, `terminal` or `gone`, with the meanings in FR-14. The frontend treats any other reason as `gone`.
- C18: `GET /api/remote/events` is `text/event-stream`. Its only named events are `changed` and `heartbeat`, both with data `{}`.
  - A heartbeat is sent at least every 3 s.
  - On `changed`, the frontend re-fetches `/api/remote/prompts`. The event never carries prompt data.
- C19 (revised): `GET /api/remote/status`, and the 200 body of `POST /api/remote/enabled`, are exactly `{enabled:boolean, host:string|null, remotePort:number|null, waitSeconds:number, devices:[{id,label,pairedAt,lastSeenAt|null}], pairing:{open:boolean, expiresAt:string|null}}`.
  - `enabled` is the live state: true only while the remote listener is open.
  - `host` and `remotePort` are the effective values (flag, else config, else null for host and 4330 for port), whether remote is on or off.
  - `devices` is always read from disk.
  - No key contains token, secret or hash material.

## State and binding
- C20: The frontend sends back the exact `promptId` and `bind` from the last prompts response it rendered for that card. It never computes, caches across reloads or reuses a `bind`.
- C21: A card's identity is `source` + `id`. Backend keeps both stable across prompt replacements in a session. When the same identity comes back with a different `promptId`, the frontend shows the "new prompt" flag on that card.
- C22: An answer POST is sent once and never retried, queued or replayed, whatever the failure. The service worker sends `/api/*` straight to the network, never caches it, and returns failures as they are.
- C23: Device auth lives only in the HttpOnly cookie. Frontend code never touches `document.cookie`, `localStorage` or `sessionStorage` for auth. Revocation is read from `remote/devices.json` on every request.
- C24 (revised): Pairing and revoke are CLI-only (`mission-control remote pair`, `remote devices`, `remote revoke <id>`). The only write route on `:4319` is `POST /api/remote/enabled`. The only write control on the desktop is the Remote switch on `#/remote`. No pair, revoke or device-edit control or route exists on `:4319`.

## Phone screens and copy (design specifies, frontend builds, strings are exact)
- C25: On load, `RemoteApp` calls `GET /api/remote/me` and shows a screen by result:
  - 200: the prompt list;
  - 401 "not paired": "Run `mission-control remote pair` on your computer.";
  - 401 "device revoked": "This device was revoked. Pair again."
  
  A "device revoked" 401 from any later request also switches to the revoked screen.
- C26: `/pair` reads `#t=<token>` and clears the fragment with `history.replaceState` before it POSTs. Then:
  - on 200 it goes to `/`;
  - on 401 it shows "This pairing link expired or was already used. Run `mission-control remote pair` again.";
  - on 429 it shows "Too many attempts. Wait a minute and try again."
- C27: Each card shows project and title, tool, target and "asked N ago".
  - Permission cards have exactly two buttons, "Allow" and "Deny".
  - Ask cards have one button per option. With one question, a tap sends. With several, "Send" stays disabled until every question has a pick.
  - Read-only cards show "answer where the agent runs" and no buttons.
  - Every answer button is at least 48×48 CSS px.
- C28: After a 200, the card shows "Allowed", "Denied" or "Answered" until the next prompts fetch drops it.
- C29: After a 409, the card shows the text from `reasonText()` in `web/src/lib/remote.ts`. These strings appear nowhere else:
  - `changed`: "prompt changed, nothing was approved"
  - `answered`: "already answered"
  - `terminal`: "answered in terminal"
  - `gone`: "no longer waiting"
- C30: The phone is offline while `navigator.onLine` is false, or while the event stream has been in error or silent for more than 5 s.
  - While offline, the banner reads "offline, can't answer" and every answer and Send button is disabled.
  - An answer POST that fails at the network level shows the same text on its card.
- C31: An empty prompt list shows "Nothing needs you right now." The desktop Remote page shows "No paired devices" when `devices` is empty.

## Desktop and hooks
- C32 (revised): The desktop Remote page is at `#/remote` (`view:"remote"`), with the sidebar label "Remote". It shows:
  - the "Remote answering" switch (C44);
  - `host` (or "not set"), `remotePort`, `waitSeconds`, `pairing.open` and `expiresAt`;
  - each device's label, id, `pairedAt` and `lastSeenAt` (or "never");
  - the copyable commands `mission-control remote pair`, `mission-control remote revoke <id>`, `mission-control remote on` and `mission-control remote off`.
  
  It reads only `GET /api/remote/status`.
- C33 (revised): The hook and the server communicate only through files under `<home>/.mission-control/remote/` (directory 0700, files 0600, atomic writes). The hook opens no socket.
  - The hook waits only when all of these hold: `server.json` is fresh (heartbeat under 6 s old), its pid is alive, it has `enabled:true`, and at least one device is paired.
  - Otherwise, and on timeout, abandon, a log clear, or `enabled` turning false mid-wait, the hook prints nothing and exits 0. It never emits `onFailure`.
- C34: Each accepted answer appends exactly one line `{ts, device, promptId, decision:"allow"|"deny"|"answer", tool, targetHash}` to `<home>/.mission-control/audit.jsonl` (mode 0600, append-only). Refused attempts append nothing. No raw target, question or option text is stored.
- C35: Tests in every lane use temp homes and fakes only: `MISSION_CONTROL_HOME`, `MISSION_CONTROL_HOOKS_DIR`, an injected `remoteDir`, and fake `fetch`, `EventSource` and `Cache`. `package.json` gains no runtime `dependencies`.

## Runtime on/off (new)
- C36: Configuration lives in `<home>/.mission-control/config.json` under `remote: {enabled:boolean, host:"<name>.ts.net", port:number, waitSeconds:10–600}`. The defaults are `enabled` false, port 4330 and waitSeconds 120.
  - `--remote-host` and `--remote-port` override `host` and `port` for that run and are never written to config.
  - Starting with `--remote-port` starts remote on for that run without changing `remote.enabled`. Otherwise the server starts in the state given by `remote.enabled`.
- C37: Turning on, from startup, the CLI or the dashboard, requires a valid effective configuration: host must match `<name>.ts.net`, and port must be in 1–65535, differ from `--port`, and be free to bind. On failure:
  - The error message names the offending key (`remote.host` or `remote.port`) and the config file path.
  - `remote on` exits 2, and the dashboard route returns 422 `{error, key}`.
  - Remote stays off. Nothing is persisted and no audit line is written.
  - An invalid flag at startup exits 2 (FR-2). An invalid config at startup prints the error, and the dashboard still starts with remote off.
- C38: `POST /api/remote/enabled` takes a body of exactly `{enabled:boolean}`. Guards are checked in this order:
  1. Host not in the existing `:4319` allow-list: 403.
  2. Origin missing, or not equal to `http://<request Host>`: 403 `{error}`.
  3. Not `Content-Type: application/json`: 415.
  4. Any other body: 400 `{error}`.
  5. Validation failure (C37): 422 `{error, key}`.
  
  On 200 it returns the C19 status, and it responds only after the listener is open (on) or fully closed (off). A request that changes nothing returns 200 and appends no audit line. An unparseable `config.json` is never overwritten: the request returns 422 with key `"config.json"` and nothing changes.
- C39: Turning on opens the remote listener on the effective port before responding. The server then:
  - prints the `tailscale serve --bg --https=443 http://127.0.0.1:<port>` hint and the Funnel warning on its stdout;
  - sets `enabled:true` in `server.json`;
  - persists `remote.enabled:true`, keeping every other config key.
- C40: Turning off runs these steps in order:
  1. Set `enabled:false` in `server.json`.
  2. Write an `abandon` decision for every pending prompt.
  3. Send `changed` to every SSE client.
  4. Close the listener and destroy its open sockets, including SSE streams.
  5. Persist `remote.enabled:false`, keeping every other config key.
  
  Waiting hooks exit 0 with empty stdout within 1 s. Once the response has returned, connections to the remote port are refused. Paired devices are not revoked.
- C41: The server publishes `remote/server.json` for as long as it runs, whether remote is on or off. Its shape is `{pid, port, remotePort:number|null, host:string|null, waitSeconds, enabled:boolean, startedAt}`. Its mtime is touched every 2 s, and the file is removed on clean shutdown.
- C42: `mission-control remote on|off|status`:
  - **With a running server** (fresh `server.json` and live pid), on/off writes `remote/control/<uuid>.json {enabled, actor:"cli"}`. The server applies it through the same code path as `POST /api/remote/enabled` and writes `remote/control/<uuid>.result.json`, containing `{ok:true, status}` or `{ok:false, error, key}`. The CLI waits up to 5 s, then exits 0 (applied), exits 2 (validation error) or exits 1 with "server did not respond" (nothing changed).
  - **With no running server**, the CLI validates host and port as in C37, writes `remote.enabled`, appends the audit line itself, and prints "takes effect when mission-control starts".
  - `status` prints these lines: `remote: on|off`, `host: <host|not set>`, `port: <n>`, `server: running|not running` and `devices: <n>`.
- C43: Every actual on/off change appends exactly one line `{ts, actor:"dashboard"|"cli", action:"remote-on"|"remote-off"}` to `audit.jsonl` (0600, append-only). The process that applied the change writes it. No-ops, refused requests and starts via flags append nothing.
- C44: The desktop has one switch labelled "Remote answering" on `#/remote`, plus a top-bar indicator.
  - The switch is checked exactly when `status.enabled` is true. A toggle calls `setRemoteEnabled(enabled)` in `web/src/lib/remote.ts`, which sends a same-origin `fetch` POST with `Content-Type: application/json`.
  - The switch is disabled while the request is in flight and never changes optimistically. On 200 it shows the returned `enabled`. On any other response it keeps its prior state and shows the response's `error` string verbatim beneath it.
  - The top bar shows "Remote on" or "Remote off", taken from status, and links to `#/remote`.
  - Both re-fetch `GET /api/remote/status` at least every 3 s while the page is visible, so a CLI change appears within 5 s without a reload.
- C45: When remote is turned off, the phone needs no new event or screen. It reacts to `changed` per C18, then to the closed stream and failed fetches with the C30 offline banner and disabled buttons. When remote is on again, the same cookie works without re-pairing.
- C46: The README Security section states three things:
  - `:4319` has exactly one write route, `POST /api/remote/enabled`, guarded by loopback bind, the Host check, a required same-origin Origin and JSON only;
  - remote is off by default;
  - pairing and revoke are CLI-only.
  
  `docs/remote-answering.md` documents `remote on|off|status`, the config keys from C36, and the precedence of flags over config.
- C47: On a fresh home (no `config.json`, or no `remote` key), the server starts with remote off. `status.enabled` is false, no second socket is open, and the hook never waits.
