import { TriangleAlert } from "lucide-react"
import type { SameFile } from "@/lib/api-v22"
import { toHash } from "@/lib/route"

/**
 * Two agents changed the same file close together. On an item page (`self` set) each warning links to the
 * other side; on the project page it links to both.
 */
export function SameFileWarnings({ warnings, self }: { warnings: SameFile[]; self?: { source: string; id: string } }) {
  if (!warnings.length) return null
  const link = (s: SameFile["a"]) => (
    <a href={toHash({ view: "item", source: s.source, id: s.id, tab: "calls" })} className="underline decoration-dotted underline-offset-2 hover:text-foreground" title={s.title}>
      {s.branch ?? s.id}
    </a>
  )
  return (
    <section role="alert" aria-label="Same-file warning" className="rounded-xl border border-consult/40 bg-consult/10 p-3 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-consult">
        <TriangleAlert className="size-3.5" />
        {warnings.length === 1 ? "Two agents edited the same file" : `${warnings.length} files edited by two agents`}
      </div>
      <ul className="mt-1.5 space-y-1.5 text-foreground/90">
        {warnings.slice(0, 8).map((w, i) => {
          const other = self ? (w.a.source === self.source && w.a.id === self.id ? w.b : w.a) : null
          return (
            <li key={`${w.path}|${w.a.id}|${w.b.id}|${i}`} data-same-file>
              <span>{w.text}</span>
              <span className="block font-mono text-faint">
                {other ? <>other side: {link(other)}</> : <>open: {link(w.a)} · {link(w.b)}</>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
