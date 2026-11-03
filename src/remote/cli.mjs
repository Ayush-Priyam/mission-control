// `mission-control remote pair|devices|revoke <id>|on|off|status` (spec FR-6, FR-9; contract C24, C37, C42).
// Pairing and revoke are CLI-only. on/off talk to a running server through remote/control/ files, or set
// config.json when no server runs. Returns an exit code; output goes through the injected `out` / `err`.
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { appendToggle } from "./audit.mjs"
import { createPairingToken, listDevices, revokeDevice } from "./pairing.mjs"
import { encode, toTerminal } from "../qr.mjs"
import { ensureDir, readConfigFile, readJson, readRemoteConfig, readServer, remoteFromConfig, removeFile, validateRemote, writeJsonAtomic, writeRemoteEnabled } from "./state.mjs"

const USAGE = "usage: mission-control remote pair | devices | revoke <id> | on | off | status"

/** Validate --remote-port / --remote-host at startup (FR-2, C37): null when fine, else the message (exit 2). */
export function checkRemoteFlags({ remotePort, remoteHost, port }) {
  if (remotePort === undefined && remoteHost === undefined) return null
  if (remotePort === undefined || remoteHost === undefined) return "--remote-port and --remote-host go together: pass both (for example --remote-port 4330 --remote-host laptop.tail1234.ts.net)"
  const p = /^\d+$/.test(String(remotePort)) ? Number(remotePort) : NaN
  const bad = validateRemote({ host: String(remoteHost).toLowerCase(), port: p, dashboardPort: port })
  if (!bad) return null
  return bad.key === "remote.host" ? `--remote-host must be your <name>.ts.net name, got ${JSON.stringify(String(remoteHost).slice(0, 80))}` : `--remote-port must be a port from 1 to 65535 that differs from --port ${port}`
}

/**
 * Run one `remote` subcommand. ctx: { args, remoteDir, home, configPath, out, err, now, sleep, waitMs }.
 * Resolves with the exit code.
 */
export async function runRemote({ args, remoteDir, home, configPath, out = console.log, err = console.error, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), waitMs = 5000 }) {
  const [cmd, ...rest] = args
  if (cmd === "pair") {
    // The host the phone will open: the running server's (it may come from --remote-host), else config.
    const srv = readServer(remoteDir, { now: now() })
    const host = (srv?.enabled && srv.host) || readRemoteConfig(configPath).host
    const bad = validateRemote({ host, port: 1, dashboardPort: 0, configPath })
    if (bad && bad.key === "remote.host") { err(`mission control: ${bad.error}`); return 2 }
    ensureDir(remoteDir)
    const { url, expiresAt } = createPairingToken({ remoteDir, host, now: now() })
    out("Scan this on your phone (it works once, for 10 minutes):\n")
    try { out(toTerminal(encode(url).modules)) } catch { /* too long for a QR: the URL below still works */ }
    out(`\n${url}\n`)
    out(`expires ${expiresAt}. A new \`remote pair\` replaces this link.`)
    if (!srv?.enabled) out("Remote answering is off: run `mission-control remote on` (or start with --remote-port) before you open it.")
    return 0
  }
  if (cmd === "devices") {
    const list = listDevices({ remoteDir })
    if (!list.length) { out("No paired devices."); return 0 }
    for (const d of list) out(`${d.id}  ${d.label}  paired ${d.pairedAt}`)
    return 0
  }
  if (cmd === "revoke") {
    const id = rest[0]
    if (!id) { err(USAGE); return 2 }
    const d = revokeDevice({ remoteDir, id, now: now() })
    if (!d) { err(`mission control: no paired device with id ${JSON.stringify(id)} (see \`mission-control remote devices\`)`); return 1 }
    out(`revoked ${d.id}  ${d.label}  (paired ${d.pairedAt}); its next request is refused`)
    return 0
  }
  if (cmd === "on" || cmd === "off") return toggle({ enabled: cmd === "on", remoteDir, home, configPath, out, err, now, sleep, waitMs })
  if (cmd === "status") {
    const srv = readServer(remoteDir, { now: now() })
    const c = readRemoteConfig(configPath)
    const on = srv ? srv.enabled === true : c.enabled
    out(`remote: ${on ? "on" : "off"}`)
    out(`host: ${(srv?.enabled && srv.host) || c.host || "not set"}`)
    out(`port: ${(srv?.enabled && srv.remotePort) || c.port}`)
    out(`server: ${srv ? "running" : "not running"}`)
    out(`devices: ${listDevices({ remoteDir }).length}`)
    return 0
  }
  err(USAGE)
  return 2
}

async function toggle({ enabled, remoteDir, home, configPath, out, err, now, sleep, waitMs }) {
  const srv = readServer(remoteDir, { now: now() })
  if (srv) {
    // A running server applies it through the same path as the dashboard switch (C42).
    const id = randomUUID()
    const dir = join(remoteDir, "control")
    ensureDir(dir)
    writeJsonAtomic(join(dir, `${id}.json`), { enabled, actor: "cli" })
    const result = join(dir, `${id}.result.json`)
    const until = now() + waitMs
    while (now() < until) {
      const r = readJson(result)
      if (r) {
        removeFile(result)
        if (r.ok) { out(`remote answering ${r.status?.enabled ? "on" : "off"}`); return 0 }
        err(`mission control: ${r.error}`)
        return 2
      }
      await sleep(100)
    }
    removeFile(join(dir, `${id}.json`))
    err("mission control: server did not respond (nothing was changed)")
    return 1
  }
  // No server: validate and persist; it applies at the next start (C42).
  const file = readConfigFile(configPath)
  if (!file.ok) { err(`mission control: ${configPath} is not valid JSON; fix it first (nothing was changed)`); return 2 }
  const cur = remoteFromConfig(file.config)
  if (enabled) {
    const bad = validateRemote({ host: cur.host, port: cur.port, dashboardPort: null, configPath })
    if (bad) { err(`mission control: ${bad.error}`); return 2 }
  }
  if (cur.enabled !== enabled) {
    writeRemoteEnabled(configPath, enabled)
    appendToggle({ home, actor: "cli", enabled, now: now() })
  }
  out(`remote answering ${enabled ? "on" : "off"}: takes effect when mission-control starts`)
  return 0
}
