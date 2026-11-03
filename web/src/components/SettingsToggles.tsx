import { useState } from "react"
import { Bell, BellOff, Info } from "lucide-react"
import { postSettings, postTestNotification, useSettings } from "@/lib/api"
import { InfoTip } from "@/components/IconAction"
import { askNotifyPermission, notifyPermission } from "@/lib/notify"
import { cn } from "@/lib/utils"

const BROWSER_INFO =
  "Lets this page show the notifications. Clicking one opens that session here. Without it, macOS shows them, but a click does nothing. Works while a dashboard tab is open, even in the background."
const row = "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-sidebar-accent/60 hover:text-muted-foreground disabled:opacity-50 [&_svg]:size-3"

/** Sidebar switches: notifications (needs you, done), the browser permission and a test. */
export function SettingsToggles() {
  const s = useSettings()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState(notifyPermission)
  if (typeof s.data?.notify !== "boolean") return null // not loaded, or a server without settings
  const { notify } = s.data
  const notifyDone = s.data.notifyDone ?? false
  const change = async (patch: { notify?: boolean; notifyDone?: boolean }) => {
    setBusy(true)
    setNote(null)
    try {
      await postSettings(patch)
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
      {note && <span className="px-1 text-[11px]">{note}</span>}
    </div>
  )
}
