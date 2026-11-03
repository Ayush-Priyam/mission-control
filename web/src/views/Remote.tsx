import { useState } from "react"
import { Check, Copy } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { ago, useNow } from "@/lib/format"
import { setRemoteEnabled, useRemoteStatus } from "@/lib/remote"

const PAIR = "mission-control remote pair"

function CopyCmd({ cmd }: { cmd: string }) {
  const [done, setDone] = useState(false)
  return (
    <span className="inline-flex items-center gap-2 rounded-md border bg-card px-2 py-1 font-mono text-xs">
      <code>{cmd}</code>
      <button
        type="button"
        aria-label={`Copy ${cmd}`}
        onClick={() => {
          void navigator.clipboard?.writeText(cmd)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }}
        className="grid size-5 place-items-center rounded text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
      >
        {done ? <Check /> : <Copy />}
      </button>
    </span>
  )
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex gap-3 py-1 text-sm">
    <dt className="w-32 shrink-0 text-muted-foreground">{k}</dt>
    <dd className="min-w-0 font-mono break-words">{children}</dd>
  </div>
)

/** Desktop Remote page: status, devices and the commands. Its one write control is the Remote answering switch. */
export default function Remote({ f }: { f?: typeof fetch }) {
  const { status, error, set } = useRemoteStatus(3000, f)
  const now = useNow(10_000)
  const [busy, setBusy] = useState(false)
  const [switchError, setSwitchError] = useState<string | null>(null)

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    setSwitchError(null)
    const r = await setRemoteEnabled(enabled, f)
    if (r.ok) set(r.status)
    else setSwitchError(r.error) // never optimistic: the switch keeps its prior state
    setBusy(false)
  }

  if (!status) return <p className="text-sm text-faint">{error ? `could not load remote status: ${error}` : "loading remote status…"}</p>

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-title font-semibold">Remote</h1>

      <section className="flex flex-col gap-2">
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch checked={status.enabled} disabled={busy} onCheckedChange={(v) => void toggle(v)} aria-label="Remote answering" />
          Remote answering
          <span className="font-mono text-xs text-muted-foreground">{busy ? "switching…" : status.enabled ? "on" : "off"}</span>
        </label>
        {switchError && (
          <p role="alert" className="text-sm text-failed">
            {switchError}
          </p>
        )}
      </section>

      <dl>
        <Row k="host">{status.host ?? "not set"}</Row>
        <Row k="remote port">{status.remotePort ?? "not set"}</Row>
        <Row k="wait">{status.waitSeconds} s</Row>
        <Row k="pairing">{status.pairing.open ? `open until ${status.pairing.expiresAt ?? "?"}` : "closed"}</Row>
      </dl>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-xs tracking-wider text-faint uppercase">Paired devices</h2>
        {status.devices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No paired devices</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {status.devices.map((d) => (
              <li key={d.id} className="flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold">{d.label}</span>
                  <code className="font-mono text-xs text-muted-foreground">{d.id}</code>
                </div>
                <div className="font-mono text-xs text-muted-foreground">
                  paired {d.pairedAt} · last seen {d.lastSeenAt ? `${ago(d.lastSeenAt, now)} ago` : "never"}
                </div>
                <CopyCmd cmd={`mission-control remote revoke ${d.id}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-mono text-xs tracking-wider text-faint uppercase">Commands</h2>
        <p className="text-xs text-muted-foreground">Pairing and revoking happen in a terminal only.</p>
        <div className="flex flex-wrap gap-2">
          <CopyCmd cmd={PAIR} />
          <CopyCmd cmd="mission-control remote on" />
          <CopyCmd cmd="mission-control remote off" />
        </div>
      </section>
    </div>
  )
}
