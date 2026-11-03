// `mission-control remote setup` and `remote doctor`: one command from zero to a paired phone, and a
// read-only check that says which step is missing. Every step checks first and changes something only
// when it is missing, so setup can be run again at any time. Writes ask first (y/N) unless --yes; a
// file it changes is backed up next to itself. All effects are injected, so tests never touch the real
// ~/.claude, ~/.codex, ~/.mission-control or tailscale.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { settingsBlock, codexHooksBlock } from "../hooks.mjs"
import { readConfigFile, remoteFromConfig, writeJsonAtomic } from "./state.mjs"

const TAILSCALE_BINS = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/usr/local/bin/tailscale", "/opt/homebrew/bin/tailscale"]
// A Mission Control hook command, in any form `hooks install` ever printed or a user wrote.
const MC_HOOK = /mission-control(\.mjs)?'?\s+hook\b/

/** Node for hook commands: a stable symlink (Homebrew's bin) over a versioned Cellar path that breaks on upgrade. */
export function stableNode(execPath = process.execPath, exists = existsSync, real = realpathSync) {
  if (!execPath.includes("/Cellar/")) return execPath
  for (const p of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) {
    try { if (exists(p) && real(p) === real(execPath)) return p } catch { /* keep looking */ }
  }
  return execPath
}

/** The tailnet name and state from `tailscale status --self --json`, or why it is not usable. */
export function tailscaleSelf(run) {
  for (const bin of TAILSCALE_BINS) {
    const r = run(bin, ["status", "--self", "--json"])
    if (r.error?.code === "ENOENT" || r.status === null && !r.stdout) continue
    let j
    try { j = JSON.parse(r.stdout || "{}") } catch { j = {} }
    const name = String(j?.Self?.DNSName ?? "").replace(/\.$/, "").toLowerCase()
    if (j.BackendState !== "Running" || !name.endsWith(".ts.net")) return { bin, ok: false, why: j.BackendState === "NeedsLogin" || /logged out/i.test(r.stdout + r.stderr) ? "logged out: run `tailscale up`" : `not running (${j.BackendState ?? "no status"}): open Tailscale and log in` }
    return { bin, ok: true, name }
  }
  return { ok: false, why: "not installed: get it from https://tailscale.com/download" }
}

/** Whether `tailscale serve` already proxies https :443 to the remote port. */
export function serveReady(run, bin, port) {
  const r = run(bin, ["serve", "status", "--json"])
  return new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`).test(r.stdout ?? "")
}

/**
 * Merge Mission Control's hooks into a settings object (Claude settings.json or Codex hooks.json):
 * every earlier Mission Control entry is removed (so paths and timeouts are current), every other hook is
 * kept as it was, and one group per event is appended. Returns { next, changed }.
 */
export function mergeHooks(settings, block) {
  const next = structuredClone(settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {})
  const hooks = next.hooks && typeof next.hooks === "object" && !Array.isArray(next.hooks) ? next.hooks : {}
  for (const [event, groups] of Object.entries(block.hooks)) {
    const kept = (Array.isArray(hooks[event]) ? hooks[event] : [])
      .map((g) => (g && Array.isArray(g.hooks) ? { ...g, hooks: g.hooks.filter((h) => !MC_HOOK.test(String(h?.command ?? ""))) } : g))
      .filter((g) => !g || !Array.isArray(g.hooks) || g.hooks.length)
    hooks[event] = [...kept, ...groups]
  }
  next.hooks = hooks
  return { next, changed: JSON.stringify(next) !== JSON.stringify(settings ?? {}) }
}

function readJsonFile(path) {
  if (!existsSync(path)) return { ok: true, value: {} }
  try {
    const v = JSON.parse(readFileSync(path, "utf8"))
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v } : { ok: false }
  } catch { return { ok: false } }
}

/** Write pretty JSON, keeping a timestamped backup of what was there. Returns the backup path or null. */
function writeWithBackup(path, value, now) {
  let backup = null
  if (existsSync(path)) {
    backup = `${path}.bak-${new Date(now()).toISOString().replace(/[:.]/g, "-")}`
    copyFileSync(path, backup)
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
  return backup
}

/**
 * The checks, in order. Each: { key, label, ok, detail, fix?, apply? }. `apply` changes something and
 * returns a line to print; it is undefined when there is nothing to do or nothing safe to do.
 */
export function plan(ctx) {
  const { home, configPath, script, run, now, port } = ctx
  const steps = []
  const ts = tailscaleSelf(run)
  steps.push({ key: "tailscale", label: "Tailscale", ok: ts.ok, detail: ts.ok ? ts.name : ts.why, fix: ts.ok ? null : "tailscale up" })
  if (!ts.ok) return steps

  const file = readConfigFile(configPath)
  const cur = file.ok ? remoteFromConfig(file.config) : null
  const remotePort = cur?.port ?? port
  steps.push({
    key: "config", label: "Config", ok: file.ok && cur.host === ts.name,
    detail: !file.ok ? `${configPath} is not valid JSON: fix it first` : cur.host === ts.name ? `remote.host ${ts.name}` : `remote.host ${cur.host ?? "not set"}, should be ${ts.name}`,
    apply: file.ok && cur.host !== ts.name ? () => {
      const c = structuredClone(file.config)
      c.remote = { ...(c.remote && typeof c.remote === "object" ? c.remote : {}), host: ts.name }
      writeJsonAtomic(configPath, c)
      return `wrote remote.host ${ts.name} to ${configPath}`
    } : undefined,
  })

  // Hooks must point at a path that stays: npx runs from a cache npm may delete at any time.
  if (/[\\/]_npx[\\/]/.test(script)) {
    steps.push({ key: "install", label: "Install", ok: false, detail: "running through npx, whose cache can be deleted: hooks would break", fix: "npm install -g @aldefy/mission-control, then run mission-control remote setup" })
    return steps
  }
  const node = stableNode(ctx.execPath)
  const waitSeconds = cur?.waitSeconds
  const hookStep = (key, label, path, block, extra) => {
    const f = readJsonFile(path)
    if (!f.ok) return { key, label, ok: false, detail: `${path} is not valid JSON: fix it first` }
    const { next, changed } = mergeHooks(f.value, block)
    return {
      key, label, ok: !changed, detail: changed ? `${path} needs Mission Control's hooks (other hooks are kept)` : `installed in ${path}`,
      apply: changed ? () => {
        const backup = writeWithBackup(path, next, now)
        return `merged hooks into ${path}${backup ? ` (backup: ${backup})` : ""}${extra ? `. ${extra}` : ""}`
      } : undefined,
    }
  }
  steps.push(hookStep("claude-hooks", "Claude Code hooks", join(home, ".claude", "settings.json"), settingsBlock({ node, script, waitSeconds })))
  if (existsSync(join(home, ".codex"))) {
    steps.push(hookStep("codex-hooks", "Codex hooks", join(home, ".codex", "hooks.json"), codexHooksBlock({ node, script, waitSeconds }), "In Codex, run /hooks and approve the changed hooks"))
  }

  const serving = serveReady(run, ts.bin, remotePort)
  steps.push({
    key: "serve", label: "tailscale serve", ok: serving,
    detail: serving ? `https://${ts.name} → 127.0.0.1:${remotePort} (tailnet only)` : `https://${ts.name} is not served yet`,
    fix: serving ? null : `tailscale serve --bg --https=443 http://127.0.0.1:${remotePort}`,
    apply: serving ? undefined : () => {
      const r = run(ts.bin, ["serve", "--bg", "--https=443", `http://127.0.0.1:${remotePort}`])
      if (r.status !== 0) throw new Error(`tailscale serve failed: ${(r.stderr || r.stdout || "").trim().split("\n")[0]}. If it mentions HTTPS, enable HTTPS certificates at https://login.tailscale.com/admin/dns`)
      return `tailscale serve: https://${ts.name} → 127.0.0.1:${remotePort} (tailnet only, never Funnel)`
    },
  })
  return steps
}

/**
 * `remote setup` (apply) or `remote doctor` (report only). ctx adds: ask(question) → Promise<boolean>,
 * yes, out, err, remote(args) → Promise<exit code> (runs `remote on` / `remote pair`), status() → {on, devices}.
 */
export async function runSetup(ctx, { apply }) {
  const { out, err, ask, yes } = ctx
  let failed = false
  for (const s of plan(ctx)) {
    if (s.ok) { out(`✓ ${s.label}: ${s.detail}`); continue }
    if (apply && s.apply) {
      if (!(yes || (await ask(`${s.label}: ${s.detail}. Fix it now? [y/N] `)))) { out(`- ${s.label}: skipped`); failed = true; continue }
      try { out(`✓ ${s.label}: ${s.apply()}`) } catch (e) { err(`✗ ${s.label}: ${e.message}`); return 2 }
      continue
    }
    out(`✗ ${s.label}: ${s.detail}${s.fix ? `\n    fix: ${s.fix}` : ""}`)
    failed = true
    // Nothing after Tailscale can be checked without it.
    if (s.key === "tailscale" && apply) { err("mission control: fix this, then run `mission-control remote setup` again"); return 2 }
  }
  const st = ctx.status()
  if (!apply) {
    out(`${st.on ? "✓" : "✗"} Remote answering: ${st.on ? "on" : "off"}${st.on ? "" : "\n    fix: mission-control remote on"}`)
    out(`${st.devices ? "✓" : "✗"} Paired devices: ${st.devices}${st.devices ? "" : "\n    fix: mission-control remote pair"}`)
    if (!st.server) out("! The server is not running: start `mission-control` (or `ronin dashboard`) so the phone can reach it")
    return failed || !st.on || !st.devices ? 1 : 0
  }
  if (failed) { err("mission control: some steps were skipped; run `mission-control remote doctor` to see what is left"); return 1 }
  if (!st.on && (await ctx.remote(["on"])) !== 0) return 2
  if (!st.devices || ctx.pair) return ctx.remote(["pair"])
  out("✓ All set. Pair another device with `mission-control remote pair`.")
  return 0
}
