// Shared on-disk state for v2.3 remote answering (contract.md C33, C36, C41).
// The hook and the server talk only through files under <home>/.mission-control/remote/:
// directory 0700, files 0600, every write atomic (temp file + rename or link). Sync and node: built-ins
// only, because the hook loads this module and must stay fast and never throw into the session.
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { REMOTE_DEFAULTS, SERVER_STALE_MS, WAIT_SECONDS_MAX, WAIT_SECONDS_MIN } from "./contract.mjs"

/** <home>/.mission-control/remote (home: MISSION_CONTROL_HOME in tests and the demo, else the real one). */
export const remoteDir = (home = homedir()) => join(home, ".mission-control", "remote")

/**
 * The remote dir the CLI, the hook and the server use, in this order: MISSION_CONTROL_REMOTE_DIR; under
 * MISSION_CONTROL_HOME; next to MISSION_CONTROL_HOOKS_DIR (<x>/hooks -> <x>/remote, so a hook pointed at a
 * temp hooks dir never reads the real ~/.mission-control); else ~/.mission-control/remote.
 */
export function remoteDirFromEnv(env = process.env) {
  if (env.MISSION_CONTROL_REMOTE_DIR) return env.MISSION_CONTROL_REMOTE_DIR
  if (env.MISSION_CONTROL_HOME) return remoteDir(env.MISSION_CONTROL_HOME)
  if (env.MISSION_CONTROL_HOOKS_DIR) return join(dirname(env.MISSION_CONTROL_HOOKS_DIR), "remote")
  return remoteDir(homedir())
}

/** Create `dir` (and parents) owner-only. The leaf is chmod'ed too: mkdir's mode is masked by umask. */
export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try { chmodSync(dir, 0o700) } catch { /* not ours to fix */ }
  return dir
}

const tmpName = (path) => `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`

/** Write JSON to `path` atomically (temp file 0600, then rename). The parent dir is created 0700. */
export function writeJsonAtomic(path, value) {
  ensureDir(dirname(path))
  const tmp = tmpName(path)
  try {
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" })
    renameSync(tmp, path)
  } catch (e) {
    try { unlinkSync(tmp) } catch { /* already gone */ }
    throw e
  }
}

/**
 * Create `path` with JSON content only if it does not exist yet (temp file + link): exactly one of
 * several concurrent writers wins. true when this call created it, false when it already existed.
 */
export function writeJsonExclusive(path, value) {
  ensureDir(dirname(path))
  const tmp = tmpName(path)
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" })
  try {
    linkSync(tmp, path)
    return true
  } catch (e) {
    if (e?.code === "EEXIST") return false
    throw e
  } finally {
    try { unlinkSync(tmp) } catch { /* already gone */ }
  }
}

/** Parsed JSON at `path`, or null when it is missing or not JSON. */
export function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null }
}

/** Remove a file; true when it was there. */
export function removeFile(path) {
  try { unlinkSync(path); return true } catch { return false }
}

/** Whether a process with this pid exists (EPERM: it exists but is not ours, still alive). */
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e?.code === "EPERM" }
}

export const serverFile = (dir) => join(dir, "server.json")

/** Write remote/server.json (C41): {pid, port, remotePort, host, waitSeconds, enabled, startedAt}. */
export function publishServer(dir, info) {
  writeJsonAtomic(serverFile(dir), info)
}

/**
 * Keep server.json fresh: re-publish it (atomically, so its mtime moves) every `everyMs`, with the current
 * contents from `info()`. stop({ remove }) clears the timer and, with remove, deletes the file.
 */
export function startHeartbeat(dir, info, { everyMs = 2000 } = {}) {
  const path = serverFile(dir)
  const beat = () => {
    try { publishServer(dir, info()) } catch {
      try { const t = new Date(); utimesSync(path, t, t) } catch { /* try again next beat */ }
    }
  }
  beat()
  const timer = setInterval(beat, everyMs)
  timer.unref?.()
  return {
    beat,
    stop({ remove = true } = {}) {
      clearInterval(timer)
      if (remove) {
        // Only our own file: a second server may have published since.
        const cur = readJson(path)
        if (!cur || cur.pid === process.pid) removeFile(path)
      }
    },
  }
}

/**
 * The running server's info, or null when server.json is missing, unreadable, older than 6 s (mtime) or
 * its pid is gone. `now` is ms since epoch; `isAlive` is injectable for tests.
 */
export function readServer(dir, { now = Date.now(), isAlive = isPidAlive } = {}) {
  const path = serverFile(dir)
  let st
  try { st = statSync(path) } catch { return null }
  if (now - st.mtimeMs > SERVER_STALE_MS) return null
  const info = readJson(path)
  if (!info || typeof info !== "object" || !isAlive(info.pid)) return null
  return info
}

/** An integer waitSeconds in 10–600, else the default 120. */
export function clampWaitSeconds(v) {
  return Number.isInteger(v) && v >= WAIT_SECONDS_MIN && v <= WAIT_SECONDS_MAX ? v : REMOTE_DEFAULTS.waitSeconds
}

/**
 * config.json as an object: `{ ok: true, config }` ({} when the file is missing), or `{ ok: false }` when it
 * exists but is not a JSON object (C38: such a file is never overwritten).
 */
export function readConfigFile(configPath) {
  if (!configPath) return { ok: true, config: {} }
  let text
  try { text = readFileSync(configPath, "utf8") } catch (e) { return e?.code === "ENOENT" ? { ok: true, config: {} } : { ok: false } }
  try {
    const v = JSON.parse(text)
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, config: v } : { ok: false }
  } catch { return { ok: false } }
}

/** The `remote` block of a parsed config object with defaults (C36): {enabled, host, port, waitSeconds}. */
export function remoteFromConfig(config) {
  const r = config?.remote && typeof config.remote === "object" && !Array.isArray(config.remote) ? config.remote : {}
  return {
    enabled: r.enabled === true,
    host: typeof r.host === "string" && r.host ? r.host : null,
    port: r.port === undefined ? REMOTE_DEFAULTS.port : r.port,
    waitSeconds: clampWaitSeconds(r.waitSeconds),
  }
}

/** The `remote` block of config.json with defaults; a broken file means the defaults (existing convention). */
export const readRemoteConfig = (configPath) => remoteFromConfig(readConfigFile(configPath).config ?? {})

/** `remote.waitSeconds` from config.json: an integer 10–600, default 120 (broken config: default). */
export const readWaitSeconds = (configPath) => readRemoteConfig(configPath).waitSeconds

/**
 * Set `remote.enabled` in config.json, keeping every other key (C39, C40). Throws { key: "config.json" }
 * without writing when the file exists but cannot be parsed.
 */
export function writeRemoteEnabled(configPath, enabled) {
  const { ok, config } = readConfigFile(configPath)
  if (!ok) throw Object.assign(new Error(`${configPath} is not valid JSON; fix it before turning remote answering on or off`), { key: "config.json" })
  const remote = config.remote && typeof config.remote === "object" && !Array.isArray(config.remote) ? config.remote : {}
  writeJsonAtomic(configPath, { ...config, remote: { ...remote, enabled } })
}

/** `<name>.ts.net`, lower case, DNS labels only. */
export const isTsNetHost = (h) =>
  typeof h === "string" && h.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/.test(h)

/**
 * Check an effective remote config before turning on (C37). null when fine, else { error, key } where the
 * message names the key and the config file.
 */
export function validateRemote({ host, port, dashboardPort, configPath }) {
  const where = configPath ? ` (set it in ${configPath} or pass the flag)` : ""
  if (!host) return { error: `remote.host is not set: it must be your <name>.ts.net name${where}`, key: "remote.host" }
  if (!isTsNetHost(host)) return { error: `remote.host must be a <name>.ts.net name, got ${JSON.stringify(String(host).slice(0, 80))}${where}`, key: "remote.host" }
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: `remote.port must be a port number from 1 to 65535${where}`, key: "remote.port" }
  if (port === dashboardPort) return { error: `remote.port must differ from the dashboard port ${dashboardPort}${where}`, key: "remote.port" }
  return null
}
