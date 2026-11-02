import { useState, type ReactNode } from "react"
import { Bell, BellOff, History, Info, Power } from "lucide-react"
import { postSettings, postTestNotification, useSettings, type Settings } from "@/lib/api"
import { InfoTip } from "@/components/IconAction"
import { askNotifyPermission, notifyPermission } from "@/lib/notify"
import { cn } from "@/lib/utils"

const BROWSER_INFO =
  "Browser notifications: this page shows them, and clicking one opens that session here. Without them, macOS shows them, but a click does nothing. Works while a dashboard tab is open, even in the background."
// Every row: icon, label, value on the right. `row` is the clickable variant.
const line = "flex h-6 w-full items-center gap-1.5 rounded px-1 [&_svg]:size-3 [&_svg]:shrink-0"
const row = `${line} text-left hover:bg-sidebar-accent/60 hover:text-muted-foreground disabled:opacity-50`

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-1 pb-0.5 text-[11px] tracking-wide uppercase">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

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
      <div className={line} title={retention.error}>
        <History />
        <span className="flex-1">Keep sessions</span>
        <span className="text-failed">settings.json invalid</span>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1" title={title}>
      <div className={line}>
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
          className="h-5 w-12 rounded border border-sidebar-border bg-transparent px-1 text-right text-foreground outline-none [appearance:textfield] focus-visible:border-ring [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span>days</span>
      </div>
      <div className="flex items-center gap-1 pl-[18px]">
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={busy}
            aria-pressed={retention.days === d}
            onClick={() => { setDraft(null); if (d !== retention.days) onSet(d) }}
            className={cn("rounded border border-sidebar-border px-1.5 leading-5 hover:text-muted-foreground", retention.days === d && "border-foreground/40 text-foreground")}
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
  const sendTest = async () => {
    try {
      const { via } = await postTestNotification()
      setNote(via.startsWith("page")
        ? "test sent to this page: none showing? Allow your browser in macOS System Settings → Notifications, and check Focus"
        : "test sent as a macOS notification (this page has not allowed browser notifications)")
    } catch (e) { setNote(String((e as Error).message ?? e)) }
  }
  const browser =
    permission === "granted" ? <span className="text-foreground">allowed</span>
    : permission === "denied" ? <span title="Blocked in the browser's site settings: macOS notifications show instead, without a click action">blocked</span>
    : permission === "unsupported" ? <span>n/a</span>
    : <button type="button" className="text-foreground underline underline-offset-2 hover:text-muted-foreground" onClick={async () => setPermission(await askNotifyPermission())}>allow</button>
  return (
    <div className="flex flex-col gap-2.5 border-t border-sidebar-border px-2 py-2 font-mono text-xs text-faint">
      <Section
        title="Notifications"
        action={any && <button type="button" disabled={busy} onClick={sendTest} className="normal-case tracking-normal underline-offset-2 hover:text-muted-foreground hover:underline">send test</button>}
      >
        {toggle(notify, "Needs you", "When a session needs you: a permission prompt or a question", () => change({ notify: !notify }))}
        {toggle(notifyDone, "Done", "When a session finishes your prompt and is ready for the next one", () => change({ notifyDone: !notifyDone }))}
        <div className={line}>
          <Bell />
          <span className="flex-1">Browser</span>
          {browser}
          <InfoTip text={BROWSER_INFO}>
            <Info />
          </InfoTip>
        </div>
      </Section>
      {retention && (
        <Section title="History">
          <RetentionRow retention={retention} busy={busy} onSet={(days) => change({ retentionDays: days })} />
        </Section>
      )}
      {autostart.supported && (
        <Section title="Startup">
          {toggle(autostart.enabled, "Start at login", `Start this dashboard at login and restart it if it stops (LaunchAgent ${autostart.label ?? ""})`,
            () => change({ autostart: !autostart.enabled }), <Power />)}
        </Section>
      )}
      {note && <span className="px-1 text-[11px] leading-snug">{note}</span>}
    </div>
  )
}
