import { useMemo, useState } from "react"
import { useExtra } from "@/lib/api"
import { normaliseDiff, splitPatch, type DiffFile, type DiffList } from "@/lib/extras"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const PAGE = 300, TOO_BIG = 5000
const HIDDEN = /^(diff --git|index |--- |\+\+\+ )/
const lineClass = (l: string) => (l.startsWith("+") ? "bg-running/10 text-running" : l.startsWith("-") ? "bg-failed/10 text-failed" : l.startsWith("@@") ? "text-consult" : "text-muted-foreground")

function Patch({ file, text, lines, cmd }: { file: DiffFile; text: string | null; lines?: number; cmd: string }) {
  const [shown, setShown] = useState(PAGE)
  if (file.binary) return <Big>Binary file. Open it in the repo.{cmd && <pre className="mt-2 font-mono text-[11px]">{cmd}</pre>}</Big>
  if (!text || (lines ?? 0) > TOO_BIG)
    return <Big><b className="text-foreground">{file.file}</b> {text ? `changes ${lines} lines, too many to read usefully here.` : "has no patch to show."}{cmd && <pre className="mt-2 font-mono text-[11px]">{cmd}</pre>}</Big>
  const all = text.split("\n").filter((l) => !HIDDEN.test(l))
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
        <b className="text-foreground">{file.file.split("/").pop()}</b><span>+{file.add} −{file.del}</span><span className="ml-auto">{all.length} lines</span>
      </div>
      <pre className="overflow-x-auto py-1 font-mono text-xs leading-5 [font-variant-ligatures:none]">
        {all.slice(0, shown).map((l, i) => <div key={i} className={cn("px-3 whitespace-pre", lineClass(l))}>{l || " "}</div>)}
      </pre>
      {shown < all.length && (
        <button type="button" className="m-2 self-start rounded-md border px-3 py-1 font-mono text-xs hover:bg-muted" onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, all.length - shown)} more of {all.length - shown}
        </button>
      )}
    </div>
  )
}

const Big = ({ children }: { children: React.ReactNode }) => <div className="p-4 text-xs text-muted-foreground">{children}</div>

/** One file's patch, asked per file (`?file=`). */
function FilePatch({ runId, file, cmd, refresh }: { runId: string; file: DiffFile; cmd: string; refresh: number }) {
  const r = useExtra<{ patch: string | null; lines?: number }>("diff", runId, { file: file.file }, refresh)
  if (r.loading && !r.data) return <Skeleton className="m-3 h-24" />
  return <Patch key={file.file} file={file} text={r.data?.patch ?? null} lines={r.data?.lines} cmd={cmd} />
}

/** One file's patch cut out of the whole diff text (`?full=1`). */
function FullPatch({ runId, file, cmd, refresh }: { runId: string; file: DiffFile; cmd: string; refresh: number }) {
  const r = useExtra<{ text?: string }>("diff", runId, { full: "1" }, refresh)
  const text = useMemo(() => splitPatch(r.data?.text ?? "", file.file), [r.data, file.file])
  if (r.loading && !r.data) return <Skeleton className="m-3 h-24" />
  return <Patch key={file.file} file={file} text={text || null} lines={text.split("\n").length} cmd={cmd} />
}

/** The Diff tab (and a coder's "code" tab): files biggest first, one patch at a time. */
export default function DiffView({ runId, keep = () => true, label = "the branch as it is now", refresh = 0 }: { runId: string; keep?: (file: string) => boolean; label?: string; refresh?: number }) {
  const r = useExtra<unknown>("diff", runId, undefined, refresh)
  const list: DiffList = useMemo(() => normaliseDiff(r.data), [r.data])
  const files = useMemo(() => list.files.filter((f) => keep(f.file)).sort((a, b) => b.add + b.del - (a.add + a.del)), [list, keep])
  const [pick, setPick] = useState<string | null>(null)
  if (r.loading && !r.data) return <Skeleton className="h-48 w-full" />
  if (!r.data) return <p className="font-mono text-xs text-failed">Diff not available ({r.error ?? "none"}).</p>
  if (!files.length) return <p className="py-10 text-center font-mono text-xs text-muted-foreground">{list.error ?? "No changes yet."}</p>
  const sel = files.find((f) => f.file === pick) ?? files.find((f) => !f.binary) ?? files[0]
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0), max = Math.max(1, ...files.map((f) => f.add + f.del))
  const cmd = list.repo && list.base && list.branch ? `git -C ${list.repo} diff ${list.base.slice(0, 10)} ${list.branch} -- ${sel.file}` : ""
  const Pane = list.patch === "full" ? FullPatch : FilePatch
  return (
    <div className="grid min-h-[360px] overflow-hidden rounded-xl border md:grid-cols-[minmax(220px,300px)_minmax(0,1fr)]">
      <div className="border-b md:border-r md:border-b-0">
        <p className="border-b px-3 py-2 font-mono text-[11px] text-muted-foreground">
          {files.length} files · <span className="text-running">+{add}</span> <span className="text-failed">−{del}</span>
          <br />{label}{list.base ? ` vs ${list.base.slice(0, 9)}` : ""}, biggest first
        </p>
        <ScrollArea className="max-h-[60vh]">
          <ul>
            {files.map((f) => (
              <li key={f.file}>
                <button type="button" aria-current={f === sel} onClick={() => setPick(f.file)}
                  className={cn("flex w-full flex-col gap-1 px-3 py-1.5 text-left font-mono text-xs hover:bg-muted/60", f === sel && "bg-muted")}>
                  <span className="flex items-center gap-2">
                    {f.status && <b className="text-muted-foreground">{f.status}</b>}
                    <span className="min-w-0 flex-1 truncate" title={f.file}>{f.file}</span>
                    <span className="flex-none text-[11px]">{f.binary ? "binary" : <><i className="text-running not-italic">+{f.add}</i> <u className="text-failed no-underline">−{f.del}</u></>}</span>
                  </span>
                  <span className="flex h-1 gap-px"><i className="bg-running" style={{ width: `${(f.add / max) * 100}%` }} /><i className="bg-failed" style={{ width: `${(f.del / max) * 100}%` }} /></span>
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>
      <ScrollArea className="max-h-[70vh] min-w-0"><Pane runId={runId} file={sel} cmd={cmd} refresh={refresh} /></ScrollArea>
    </div>
  )
}
