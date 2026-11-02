import { chmodSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export const DEFAULT_DAYS = 30 // Claude Code's own default for cleanupPeriodDays
const MAX_DAYS = 3650

/**
 * How long Claude Code keeps session transcripts: `cleanupPeriodDays` in <configDir>/settings.json.
 * Only that key is written; a settings.json that is not valid JSON is never overwritten.
 */
export function createRetention(configDir) {
  const path = join(configDir, "settings.json")
  const read = () => {
    let text
    try { text = readFileSync(path, "utf8") } catch { return {} } // no settings.json yet
    const d = JSON.parse(text) // throws on a broken file: callers must not write over it
    if (!d || typeof d !== "object" || Array.isArray(d)) throw new Error("not a JSON object")
    return d
  }
  return {
    get() {
      try {
        const d = read().cleanupPeriodDays
        return { configDir, days: Number.isInteger(d) ? d : DEFAULT_DAYS, isDefault: !Number.isInteger(d) }
      } catch { return { configDir, days: null, isDefault: false, error: `${path} is not valid JSON` } }
    },
    set(days) {
      if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) throw { status: 400, message: `days must be a whole number from 1 to ${MAX_DAYS}` }
      let d
      try { d = read() } catch { throw { status: 409, message: `${path} is not valid JSON; not changing it` } }
      let mode = 0o644
      try { mode = statSync(path).mode & 0o777 } catch { /* new file */ }
      const tmp = `${path}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify({ ...d, cleanupPeriodDays: days }, null, 2) + "\n", { mode })
      chmodSync(tmp, mode)
      renameSync(tmp, path)
      return this.get()
    },
  }
}
