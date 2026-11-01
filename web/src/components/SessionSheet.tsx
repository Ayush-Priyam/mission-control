import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useSession } from "@/lib/api"
import { renderable, type Message } from "@/lib/transcript"
import { cn } from "@/lib/utils"

const ROLE_CLASS: Record<string, string> = {
  user: "text-consult",
  assistant: "text-foreground",
  tool: "text-muted-foreground",
}

function Item({ m }: { m: Message }) {
  return (
    <li className="flex flex-col gap-1 border-b border-border/60 pb-3 last:border-0">
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-wider">
        <span className={cn("uppercase", ROLE_CLASS[m.role] ?? "text-muted-foreground")}>{m.role}</span>
        {m.tool && <span className="rounded border border-tool/50 bg-tool/10 px-1.5 text-tool">{m.tool}</span>}
      </div>
      {m.text && <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-muted-foreground">{m.text}</p>}
    </li>
  )
}

function Body({ runId, name }: { runId: string; name: string }) {
  const s = useSession(runId, name)
  if (s.loading && !s.data) return <Skeleton className="h-40 w-full" />
  if (!s.data) return <p className="font-mono text-xs text-failed">Transcript not available ({s.error ?? "not found"})</p>
  const r = renderable(name, s.data.text)
  return (
    <div className="flex flex-col gap-3">
      {s.data.truncated && <p className="font-mono text-[11px] text-needs-you">Cut at 200 KB; the rest is in the file.</p>}
      {r.kind === "markdown" ? (
        <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{r.text}</pre>
      ) : r.items.length ? (
        <ol className="flex flex-col gap-3">
          {r.items.map((m, i) => (
            <Item key={i} m={m} />
          ))}
        </ol>
      ) : (
        <p className="font-mono text-xs text-muted-foreground">No messages in this transcript.</p>
      )}
    </div>
  )
}

/** A session's transcript in a side sheet. `name` is the session file; null keeps the sheet shut. */
export function SessionSheet({ runId, name, onClose }: { runId: string; name: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!name} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl" aria-label="Session transcript">
        {name && (
          <>
            <SheetHeader>
              <SheetTitle className="font-mono">{name}</SheetTitle>
              <SheetDescription className="font-mono text-xs">session transcript</SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              <Body runId={runId} name={name} />
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
