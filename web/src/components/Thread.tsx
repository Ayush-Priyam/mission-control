import { useEffect, useRef, useState, type ReactNode } from "react"
import { SayBox } from "@/components/SayBox"
import { cn } from "@/lib/utils"
import { toHash } from "@/lib/route"
import { hhmm, short } from "@/lib/events"
import type { CrewCard, Stop } from "@/lib/graph"

type Ev = Record<string, any>

/** Choices the stopped stage offered, from its last issue before the stop (old page's stopOptions). */
function stopOptions(events: Ev[], i: number, stage?: string) {
  let iss: Ev | undefined
  for (let j = i - 1; j >= 0; j--) if (events[j].type === "issue" && events[j].stage === stage) { iss = events[j]; break }
  const q = iss?.questions?.[0]
  const opts: any[] = q?.options ?? iss?.options ?? []
  return {
    q: q?.question as string | undefined,
    opts: opts.map((o) => (typeof o === "string" ? o : o?.label ?? o?.value)).filter(Boolean).slice(0, 5) as string[],
  }
}

function Line({ ts, tone, children }: { ts: unknown; tone?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[3.25rem_1fr] gap-2 px-1 font-mono text-xs text-muted-foreground">
      <span>{hhmm(ts)}</span>
      <span className={cn("min-w-0 break-words", tone)}>{children}</span>
    </div>
  )
}

function Box({ head, ask, done, children }: { head: ReactNode; ask?: boolean; done?: boolean; children: ReactNode }) {
  return (
    <div className={cn("my-1 flex flex-col gap-1.5 rounded-xl border bg-card p-3", ask && "border-needs-you/70", done && "opacity-60")}>
      <div className={cn("font-mono text-[11px] text-muted-foreground", ask && "text-needs-you")}>{head}</div>
      {children}
    </div>
  )
}

const Who = ({ runId, stage }: { runId: string; stage?: string }) =>
  stage ? (
    <a href={toHash({ view: "agent", id: runId, stage })} className="font-bold text-foreground hover:underline">
      {stage}
    </a>
  ) : (
    <b className="font-bold text-foreground">run</b>
  )

/** One event as a thread item, or null when it adds nothing to read (ported from the old page's chat builder). */
function item(e: Ev, i: number, events: Ev[], runId: string, idea: string, pick: ((stage: string, text: string) => void) | null): ReactNode {
  const t = hhmm(e.ts)
  const who = <Who runId={runId} stage={e.stage} />
  switch (e.type) {
    case "run.start":
      return (
        <Box head={<><b>run</b> · {t}</>}>
          <h4 className="text-sm font-semibold">Run started</h4>
          {(e.idea ?? idea) && <p className="text-sm text-muted-foreground">{short(e.idea ?? idea, 400)}</p>}
        </Box>
      )
    case "stage.start":
      return <Line ts={e.ts}>▸ {who} started{e.attempt > 1 ? ` (attempt ${e.attempt})` : ""}</Line>
    case "stage.skipped":
      return <Line ts={e.ts}>– {who} skipped: {short(e.reason, 90)}</Line>
    case "stage.end":
      return e.ok === false
        ? <Line ts={e.ts} tone="text-failed">✕ {who} failed: {short(e.reason, 120)}</Line>
        : <Line ts={e.ts} tone="text-running">✓ {who} done</Line>
    case "check":
      return <Line ts={e.ts} tone={e.exitCode === 0 ? "text-running" : "text-failed"}>{e.exitCode === 0 ? "✓" : "✕"} {who} check {e.exitCode === 0 ? "passed" : "failed"}</Line>
    case "issue": {
      const what = short(e.summary ?? e.title, 110)
      const owner = e.decision?.owner
      if (e.decision?.blocks && owner && owner !== e.stage)
        return <Line ts={e.ts} tone="text-failed">↩ {who} sent back to {owner === "human" ? "you" : <Who runId={runId} stage={owner} />}{e.id ? ` (${e.id})` : ""}: {what}</Line>
      return <Line ts={e.ts}>! {who} raised{e.id ? ` ${e.id}` : ""}: {what}</Line>
    }
    case "consult.asked":
      return <Line ts={e.ts} tone="text-consult">? <Who runId={runId} stage={e.from ?? e.stage} /> asks <Who runId={runId} stage={e.to} />{e.id ? ` ${e.id}` : ""}: “{short(e.question, 140)}”</Line>
    case "consult.answered":
      return <Line ts={e.ts} tone="text-consult">↪ {e.id ?? "question"} answered{e.answer ? `: ${short(e.answer, 140)}` : ""}</Line>
    case "run.resume":
      return <Line ts={e.ts}>▸ resumed</Line>
    case "run.end":
      return e.status === "stopped" ? null : <Line ts={e.ts}>■ run {e.status ?? (e.ok === false ? "failed" : "done")}</Line>
    case "human.input":
      return (
        <div className="my-1 self-end rounded-xl bg-primary/10 px-3 py-2 text-sm">
          <span className="mr-2 font-mono text-[11px] text-muted-foreground">you{e.role ? `, as ${e.role}` : ""}</span>
          {e.text}
        </div>
      )
    case "qa": {
      const rows: any[] = Array.isArray(e.rows) ? e.rows : []
      const pass = rows.filter((r) => r.status === "pass").length, fail = rows.filter((r) => r.status === "fail").length
      return (
        <Box head={<><b>qa</b> · {t}</>}>
          <h4 className="text-sm font-semibold">QA report</h4>
          <div className="flex gap-4 font-mono text-xs">
            <span><b className="text-running">{pass}</b> pass</span>
            <span><b className="text-failed">{fail}</b> fail</span>
            <span><b className="text-foreground">{rows.length - pass - fail}</b> not verified</span>
          </div>
          {rows.filter((r) => r.status !== "pass").slice(0, 3).map((r, k) => (
            <p key={k} className="text-xs"><b className="font-mono">{r.id}</b> {short(r.evidence, 140)}</p>
          ))}
        </Box>
      )
    }
    case "stop": {
      const { q, opts } = stopOptions(events, i, e.stage)
      const done = events.slice(i + 1).some((x) => x.type === "run.resume")
      return (
        <Box ask done={done} head={<><b>NEEDS YOU · {e.stage ?? "run"}</b> · {t}{done ? " · answered" : ""}</>}>
          <h4 className="text-sm font-semibold">{q ?? short(e.detail, 200)}</h4>
          {q && <p className="text-xs text-muted-foreground">{short(e.detail, 300)}</p>}
          {opts.map((o) =>
            pick && !done ? (
              <button key={o} type="button" onClick={() => pick(e.stage ?? "", o)} className="rounded-md border px-2 py-1 text-left text-xs hover:bg-muted">
                ○ {o}
              </button>
            ) : (
              <div key={o} className="px-2 text-xs text-muted-foreground">○ {o}</div>
            ),
          )}
        </Box>
      )
    }
    case "owner.question":
      return (
        <Box ask head={<><b>QUESTION FOR YOU · {e.stage}</b> · {t}</>}>
          <h4 className="text-sm font-semibold">{e.text}</h4>
          <p className="text-xs text-muted-foreground">The lane kept its safest choice and carried on. Your answer reruns it with your call.</p>
          {pick && (
            <button type="button" onClick={() => pick(e.stage ?? "", "")} className="self-start rounded-md border px-2 py-1 text-xs hover:bg-muted">
              Answer {e.stage}
            </button>
          )}
        </Box>
      )
    case "handoff":
      return (
        <Box head={<><b>run</b> · {t}</>}>
          <h4 className="text-sm font-semibold">Handed off on {e.branch}</h4>
          <p className="text-xs text-muted-foreground">
            QA {e.qa?.pass ?? 0} pass, {e.qa?.fail ?? 0} fail{e.skipped?.length ? ` · skipped ${e.skipped.join(", ")}` : ""}
          </p>
        </Box>
      )
  }
  return null
}

/** Quick prompts under the thread: about the stop when there is one, else about whoever is working. */
function chipsFor(stop: Stop | null, cards: CrewCard[]): string[] {
  if (stop) return [`@${stop.stage ?? "qa"} what do you need from me?`, `@${stop.stage ?? "qa"} status`]
  return cards.filter((c) => c.status === "running").slice(0, 3).map((c) => `@${c.stage} what are you on?`)
}

/** The chat tab: the run told as a thread, with an answer box when the adapter allows `say`. */
export function Thread({ runId, idea, events, stop, cards, canSay }: { runId: string; idea: string; events: Ev[]; stop: Stop | null; cards: CrewCard[]; canSay: boolean }) {
  const [draft, setDraft] = useState("")
  const end = useRef<HTMLDivElement>(null)
  const fallback = stop?.stage ?? cards.find((c) => c.status === "running")?.stage ?? ""
  const pick = canSay ? (stage: string, text: string) => setDraft(stage && stage !== fallback ? `@${stage} ${text}` : text) : null
  const items = events.map((e, i) => item(e, i, events, runId, idea, pick)).filter(Boolean)

  // Follow new events while the reader is at the bottom.
  useEffect(() => {
    const el = end.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top < window.innerHeight + 200) el.scrollIntoView({ block: "end" })
  }, [events.length])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <div className="flex flex-col gap-1" aria-live="polite">
        {items.length ? items.map((n, k) => <div key={k} className="flex flex-col">{n}</div>) : <p className="font-mono text-sm text-muted-foreground">No events yet.</p>}
        <div ref={end} />
      </div>
      {canSay && (
        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background pt-3 pb-1">
          <div className="flex flex-wrap gap-1.5">
            {chipsFor(stop, cards).map((c) => (
              <button key={c} type="button" onClick={() => setDraft(c)} className="rounded-full border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground">
                {c}
              </button>
            ))}
          </div>
          <SayBox runId={runId} stage={fallback} value={draft} onValue={setDraft} />
        </div>
      )}
    </div>
  )
}
