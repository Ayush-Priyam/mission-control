import { useState } from "react"
import { Bell, BellOff, History, Info, Power } from "lucide-react"
import { postSettings, postTestNotification, useSettings, type Settings } from "@/lib/api"
import { InfoTip } from "@/components/IconAction"
import { askNotifyPermission, notifyPermission } from "@/lib/notify"
import { cn } from "@/lib/utils"

const BROWSER_INFO =
  "Lets this page show the notifications. Clicking one opens that session here. Without it, macOS shows them, but a click does nothing. Works while a dashboard tab is open, even in the background."
const row = "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-sidebar-accent/60 hover:text-muted-foreground disabled:opacity-50 [&_svg]:size-3"

const DEFAULT_DAYS = 30 // Claude Code's own default for cleanupPeriodDays
const PRESETS = [DEFAULT_DAYS, 60, 90]

/** Keep sessions: type any number of days (Enter or leaving the box saves), or pick a preset. */
function RetentionRow({ retention, busy, onSet }: { retention: NonNullable<Settings["retention"]>; busy: boolean; onSet: (days: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const value = draft ?? String(retention.days ?? "")
  const save = () => {
    const n = Number(value)
    setDraft(null)
    if (Number.isInteger(n) && n >= 1 && n <= 3650 && n !== retention.days) onSet(n)
  }
  const title = `How long Claude Code keeps session history (cleanupPeriodDays in ${retention.configDir}/settings.json, default 30). Older sessions are deleted when Claude Code starts. Applies from its next start.`
  if (retention.error) {
    return (
      <div className={row} title={retention.error}>
        <History />
        <span className="flex-1">Keep sessions</span>
        <span className="text-failed">settings.json invalid</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-0.5 px-1 py-0.5" title={title}>
      <div className="flex items-center gap-1.5 [&_svg]:size-3">
        <History />
        <span className="flex-1">Keep sessions</span>
        <input
          type="number"
          aria-label="Keep sessions for, in days"
          min={1}
          max={3650}
          disabled={busy}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            if (e.key === "Escape") setDraft(null)
          }}
          className="w-14 rounded border border-sidebar-border bg-transparent px-1 text-right text-foreground outline-none focus-visible:border-ring"
        />
        <span>days</span>
      </div>
      <div className="flex items-center justify-end gap-1">
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={busy}
            aria-pressed={retention.days === d}
            onClick={() => { setDraft(null); if (d !== retention.days) onSet(d) }}
            className={cn("rounded px-1.5 hover:bg-sidebar-accent/60 hover:text-muted-foreground", retention.days === d && "bg-sidebar-accent text-foreground")}
          >
            {d === DEFAULT_DAYS ? `${d} (default)` : d}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Waits for the dashboard to answer again (launchd's copy taking over the port), then reloads the page. */
async function reloadWhenBack() {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    try { if ((await fetch("/api/sources")).ok) return location.reload() } catch { /* still restarting */ }
  }
}

/** Sidebar settings: notifications (needs you, done), the browser permission and a test, session retention, start at login. */
export function SettingsToggles() {
  const s = useSettings()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState(notifyPermission)
  if (typeof s.data?.notify !== "boolean") return null // not loaded, or a server without settings
  const { notify } = s.data
  const notifyDone = s.data.notifyDone ?? false
  const autostart = s.data.autostart ?? { supported: false, enabled: false }
  const retention = s.data.retention ?? null
  const change = async (patch: { notify?: boolean; notifyDone?: boolean; autostart?: boolean; retentionDays?: number }) => {
    setBusy(true)
    setNote(null)
    try {
      const r = await postSettings(patch)
      if (r.restarting) {
        setNote("restarting under launchd…")
        await reloadWhenBack()
        return
      }
      if (patch.autostart === false) setNote("won't start at next login")
      s.reload()
    } catch (e) {
      setNote(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }
  const any = notify || notifyDone
  const toggle = (on: boolean, label: string, title: string, patch: () => void, icon = on ? <Bell /> : <BellOff />) => (
    <button type="button" role="switch" aria-checked={on} disabled={busy} className={row} onClick={patch} title={title}>
      {icon}
      <span className="flex-1">{label}</span>
      <span className={cn(on && "text-foreground")}>{on ? "on" : "off"}</span>
    </button>
  )
  return (
    <div className="flex flex-col gap-0.5 border-t border-sidebar-border px-2 py-1.5 font-mono text-xs text-faint">
      <span className="px-1 pb-0.5 text-[11px] uppercase tracking-wide">Notifications</span>
      {toggle(notify, "Needs you", "When a session needs you: a permission prompt or a question", () => change({ notify: !notify }))}
      {toggle(notifyDone, "Done", "When a session finishes your prompt and is ready for the next one", () => change({ notifyDone: !notifyDone }))}
      {any && permission === "default" && (
        <div className="flex items-center gap-1">
          <button type="button" className={cn(row, "flex-1 text-foreground")} onClick={async () => setPermission(await askNotifyPermission())}>
            <Bell />
            <span className="flex-1">Allow notifications (browser)</span>
          </button>
          <InfoTip text={BROWSER_INFO}>
            <Info />
          </InfoTip>
        </div>
      )}
      {any && (
        <button type="button" className={row} disabled={busy}
          onClick={async () => {
            try {
              const { via } = await postTestNotification()
              setNote(via.startsWith("page")
                ? "sent to this page: none showing? Allow your browser in macOS System Settings → Notifications, and check Focus"
                : "sent as a macOS notification (no page has allowed browser notifications)")
            } catch (e) { setNote(String((e as Error).message ?? e)) }
          }}>
          <Bell />
          <span className="flex-1">Send test</span>
        </button>
      )}
      {any && permission === "denied" && (
        <span className="px-1 text-[11px]" title="Allow notifications for this site in the browser's site settings">
          browser blocked notifications: macOS ones show, without a click action
        </span>
      )}
      {retention && (
        <RetentionRow retention={retention} busy={busy} onSet={(days) => change({ retentionDays: days })} />
      )}
      {autostart.supported &&
        toggle(autostart.enabled, "Start at login", `Start this dashboard at login and restart it if it stops (LaunchAgent ${autostart.label ?? ""})`,
          () => change({ autostart: !autostart.enabled }), <Power />)}
      {note && <span className="px-1 text-[11px]">{note}</span>}
    </div>
  )
}
