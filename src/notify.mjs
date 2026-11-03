import { execFile } from "node:child_process"

const as = (s) => `"${String(s).replace(/[\\"]/g, "\\$&").replace(/\s+/g, " ").slice(0, 200)}"`

/**
 * A macOS notification through osascript (no click action: osascript cannot carry one); never throws.
 * Laid out like the page's: the session name, then what happened, then where.
 */
export function macNotify({ title, subtitle, message, where }) {
  const head = subtitle || title
  const what = subtitle ? `${title} · ${message}` : message
  const script = `display notification ${as(where || " ")} with title ${as(head)} subtitle ${as(what)}`
  execFile("osascript", ["-e", script], { timeout: 5000 }, () => {})
}

const HARNESS = { "claude-code": "Claude Code", codex: "Codex" }

/**
 * Every `everyMs`, notify once when an item newly needs you (`enabled("needs")`) and when one finishes its
 * prompt, working to idle while still open (`enabled("done")`). The first pass only records the current
 * state, so starting the dashboard never replays old prompts. Archived items are skipped; `enabled` is read
 * each pass so the page toggles apply at once.
 */
export function startNotifier({ registry, enabled, notify = macNotify, link = () => undefined, everyMs = 5000 }) {
  let seen = null, working = null
  let busy = false
  const key = (i) => `${i.source}/${i.id}`
  // Where a session runs, for the notification's last line: its tool, folder and branch.
  const where = (i) => [HARNESS[i.harness] ?? i.harness, String(i.cwd ?? "").split(/[\\/]/).filter(Boolean).pop(), i.branch].filter(Boolean).join(" · ")
  async function pass() {
    if (busy) return
    busy = true
    try {
      const items = (await registry.list()).filter((i) => !i.archived)
      const { needsYou } = await registry.overview(items)
      const now = new Set(needsYou.map(key))
      const nowWorking = new Set(items.filter((i) => i.status === "working").map(key))
      if (seen && enabled("needs")) {
        for (const n of needsYou) {
          if (!seen.has(key(n))) notify({ title: "Needs you", subtitle: n.title, message: n.detail || "waiting for you", where: where(n), url: link(n), group: key(n) })
        }
      }
      if (working && enabled("done")) {
        for (const i of items) {
          // Not done: closed, moved to another session id, or stopped by you (an interrupt).
          if (working.has(key(i)) && i.status === "idle" && i.open !== false && !i.parkedInto && !i.interrupted) {
            notify({ title: "Done", subtitle: i.title, message: "ready for your next prompt", where: where(i), url: link(i), group: key(i) })
          }
        }
      }
      seen = now
      working = nowWorking
    } catch (e) {
      console.error(`${new Date().toISOString()} notifier pass failed: ${e?.stack ?? e}`) // logged, so the next pass still runs
    } finally { busy = false }
  }
  const ready = pass() // the seeding pass
  const t = setInterval(pass, everyMs)
  t.unref?.()
  return { ready, pass, stop: () => clearInterval(t) }
}
