# Amendments

---

I rewrote the contract to cover the runtime on/off change you raised as pm, worked from the product note, spec and plan. Each rule is now one line, as the output format asks; the earlier tables and sub-bullets are folded into single lines. C1–C35 keep their numbers and meaning; C7, C9, C19, C24, C32 and C33 are revised, and C36–C47 are new. I resolved the points you raised:

- **One write route on `:4319`.** C9, C24 and C38 now allow only `POST /api/remote/enabled`. It checks Host, a required same-origin Origin and JSON, in that order. X7 and X26 check this.
- **Turning off.** C40 abandons waiting hooks, sends `changed` to phones and closes the listener before the request returns. X29 checks this.
- **Terminal control.** `remote on|off|status` talks to a running server through files under `remote/control/`, or sets config when no server runs (C42).

A few gaps your note didn't settle, so I chose these:

- **Startup flag.** Starting with `--remote-port` turns remote on for that run only. It doesn't change the saved on/off choice and adds no audit line.
- **Default port.** `remote.port` defaults to 4330, so only a missing `remote.host` blocks turning on. That error returns 422 and names the key.
- **Broken config.** If `config.json` can't be parsed, an on/off request is refused (422, key `"config.json"`) rather than overwriting the file.
- **Phone when off.** No new event or screen. The phone shows its existing "offline, can't answer" banner and works again with the same cookie once remote is back on.
- **Dashboard refresh.** The switch and top bar re-fetch status every 3 s, so a terminal change shows within 5 s.

The last part of your note was cut off after "README security section mentions the one write ro". I took it to mean the README names the route; C46 also requires it to say remote is off by default and that pairing and revoke are CLI-only.
