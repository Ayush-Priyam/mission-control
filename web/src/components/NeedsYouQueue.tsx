import { useState } from "react"
import { postItemAction, type ItemSummary, type NeedsYou } from "@/lib/api"
import { ago } from "@/lib/format"
import { toHash } from "@/lib/route"
import { cn } from "@/lib/utils"
import { STATUS_LABEL } from "@/components/StatusDot"

const itemHref = (source: string, id: string) => toHash({ view: "item", source, id, tab: "lanes" })
const BTN = "inline-flex h-7 items-center rounded-md px-2.5 text-xs whitespace-nowrap transition-colors disabled:opacity-50"

function Ask({ e, actions, now, onActed }: { e: NeedsYou; actions: string[]; now: number; onActed?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const canSign = actions.includes("sign")
  const canSay = actions.includes("say")
  const href = itemHref(e.source, e.id)
  const sign = async () => {
    setBusy(true)
    setNote(null)
    try {
      await postItemAction(e.source, e.id, "sign", { notes: "" })
      setNote({ ok: true, text: "Signed." })
      onActed?.()
    } catch (err: any) {
      setNote({ ok: false, text: String(err?.message ?? err) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="relative rounded-xl border border-needs-you/40 bg-card p-3 hover:border-needs-you/70">
      <div className="flex items-baseline justify-between gap-2 text-xs text-faint">
        <span className="truncate">{[e.project?.name, e.lane].filter(Boolean).join(" · ")}</span>
        <span className="shrink-0 font-mono">{ago(e.updatedAt, now)}</span>
      </div>
      {/* The title is the card's link; its ::after covers the card, so the whole card opens the item. */}
      <a href={href} className="mt-0.5 line-clamp-2 block text-sm after:absolute after:inset-0 after:rounded-xl after:content-[''] hover:underline">
        {e.title || e.id}
      </a>
      {e.detail && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{e.detail}</p>}
      {canSign || canSay ? (
        <div className="relative z-[1] mt-2 flex flex-wrap gap-2">
          {canSign && (
            <button type="button" disabled={busy} onClick={() => void sign()} className={cn(BTN, "bg-primary text-primary-foreground hover:bg-primary/85")}>
              Sign
            </button>
          )}
          <a href={href} className={cn(BTN, "border border-input hover:bg-accent")}>
            Answer…
          </a>
        </div>
      ) : (
        <div className="relative z-[1] mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">answer in terminal</span>
          <a href={href} className="inline-flex h-7 items-center rounded-md border border-input px-2.5 text-xs hover:bg-accent">
            Open
          </a>
        </div>
      )}
      {note && (
        <p role="status" className={cn("mt-1.5 font-mono text-xs", note.ok ? "text-running" : "text-failed")}>
          {note.text}
        </p>
      )}
    </article>
  )
}

/**
 * The needs-you queue (directions.html B, left rail): one card per item waiting on you, with answer
 * buttons when its source declares actions and an "answer in terminal" hint when it does not; then
 * what stopped recently.
 */
export function NeedsYouQueue({
  entries,
  stopped,
  actions,
  onActed,
  now = Date.now(),
}: {
  entries: NeedsYou[]
  stopped: ItemSummary[]
  /** Source name -> the actions it declares (from /api/sources). */
  actions: Record<string, string[]>
  onActed?: () => void
  now?: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">
        Needs you <span className={cn("text-sm", entries.length ? "text-needs-you" : "text-faint")}>{entries.length}</span>
      </h2>
      {!entries.length && (
        <div className="rounded-xl border border-dashed p-3">
          <p className="text-sm text-muted-foreground">Nothing needs you</p>
          <p className="mt-0.5 text-xs text-faint">Questions and permission prompts from any session show up here.</p>
        </div>
      )}
      {entries.map((e) => (
        <Ask key={`${e.source}/${e.id}`} e={e} actions={actions[e.source] ?? []} now={now} onActed={onActed} />
      ))}
      {stopped.length > 0 && (
        <>
          <h3 className="pt-2 text-xs text-faint">Stopped</h3>
          {stopped.map((i) => (
            <article key={`${i.source}/${i.id}`} className="rounded-xl border bg-card p-3">
              <div className="flex items-baseline justify-between gap-2 text-xs text-faint">
                <span className="truncate">{[i.project?.name, i.branch].filter(Boolean).join(" · ")}</span>
                <span className={cn("shrink-0 font-mono", i.status === "failed" && "text-failed")}>
                  {STATUS_LABEL[i.status]} · {ago(i.updatedAt, now)}
                </span>
              </div>
              <a href={itemHref(i.source, i.id)} className="mt-0.5 line-clamp-2 block text-sm hover:underline">
                {i.title || i.id}
              </a>
            </article>
          ))}
        </>
      )}
    </div>
  )
}
