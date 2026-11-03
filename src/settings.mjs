import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const defaultSettingsPath = () => join(homedir(), ".mission-control", "settings.json")

// notify: a session needs you; notifyDone: a session finished its prompt (working -> idle).
const DEFAULTS = { notify: true, notifyDone: true }

/** Page-set preferences ({ notify, notifyDone }), shared by every dashboard on the machine. null path: defaults only. */
export function createSettings(path) {
  const read = () => {
    try { return { ...DEFAULTS, ...JSON.parse(readFileSync(path, "utf8")) } } catch { return { ...DEFAULTS } }
  }
  return {
    get: () => (path ? read() : { ...DEFAULTS }),
    set(patch) {
      if (!path) throw { status: 501, message: "settings are off" }
      const next = { ...read() }
      for (const k of ["notify", "notifyDone"]) if (typeof patch[k] === "boolean") next[k] = patch[k]
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 })
      renameSync(tmp, path)
      return next
    },
  }
}
