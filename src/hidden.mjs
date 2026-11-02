import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, sep } from "node:path"

/** The owner's config file. Read-only for us; only the CLI points at it (tests pass their own path). */
export const defaultConfigPath = () => join(homedir(), ".mission-control", "config.json")

const TOOL_DIRS = [`${sep}.claude-mem${sep}`]
const TOOL_NAMES = new Set(["observer-sessions"])

/**
 * A project is noise (hidden by default) when it lives in a tool's own data dir, carries a known tool
 * project name, or the owner lists its path or name in config.json `hide`.
 */
export function isNoise({ name, path }, hide = []) {
  const p = String(path ?? "")
  if (TOOL_DIRS.some((d) => `${p}${sep}`.includes(d))) return true
  if (TOOL_NAMES.has(name)) return true
  return hide.includes(p) || hide.includes(name)
}

/** `{ list() }`: the config's `hide` strings, re-read when the file changes. Any problem means []. */
export function createHide(configPath) {
  let seen = null, hide = []
  return {
    list() {
      if (!configPath) return []
      let st
      try { st = statSync(configPath) } catch { seen = null; hide = []; return hide }
      const stamp = `${st.mtimeMs}|${st.size}`
      if (stamp === seen) return hide
      seen = stamp
      try {
        const raw = JSON.parse(readFileSync(configPath, "utf8"))
        hide = Array.isArray(raw?.hide) ? raw.hide.filter((s) => typeof s === "string" && s) : []
      } catch { hide = [] }
      return hide
    },
  }
}
