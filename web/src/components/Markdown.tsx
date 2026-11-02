import { Fragment } from "react"
import { parseInline, parseMarkdown } from "@/lib/markdown"
import { cn } from "@/lib/utils"

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((r, i) =>
        r.k === "code" ? <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">{r.text}</code>
        : r.k === "b" ? <b key={i}>{r.text}</b>
        : r.k === "i" ? <i key={i}>{r.text}</i>
        : <Fragment key={i}>{r.text}</Fragment>,
      )}
    </>
  )
}

const HEAD = ["", "text-xl font-extrabold", "text-lg font-bold", "text-base font-bold", "text-sm font-bold", "text-sm font-semibold", "text-sm font-semibold"]

/** Markdown as React nodes (no HTML is ever injected). */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 text-body leading-relaxed", className)}>
      {parseMarkdown(text).map((b, i) => {
        switch (b.t) {
          case "h": return <p key={i} role="heading" aria-level={b.n} className={cn("mt-2 tracking-tight", HEAD[b.n])}><Inline text={b.text} /></p>
          case "p": return <p key={i}><Inline text={b.text} /></p>
          case "quote": return <blockquote key={i} className="border-l-2 pl-3 text-muted-foreground"><Inline text={b.text} /></blockquote>
          case "hr": return <hr key={i} className="border-border" />
          case "code": return <pre key={i} className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-xs">{b.text}</pre>
          case "ul":
          case "ol": {
            const L = b.t
            return (
              <L key={i} className={cn("flex flex-col gap-1 pl-5", b.t === "ul" ? "list-disc" : "list-decimal")}>
                {b.items.map((it, j) => (
                  <li key={j} className={cn(it.task && "list-none -ml-5 flex gap-2")}>
                    {it.task && <span className={cn("font-mono text-xs", it.done ? "text-running" : "text-muted-foreground")}>{it.done ? "[x]" : "[ ]"}</span>}
                    <span className={cn(it.done && "text-muted-foreground line-through")}><Inline text={it.text} /></span>
                  </li>
                ))}
              </L>
            )
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead><tr>{b.head.map((c, j) => <th key={j} className="border-b px-2 py-1 text-left font-semibold"><Inline text={c} /></th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k} className="border-b px-2 py-1 align-top"><Inline text={c} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            )
        }
      })}
    </div>
  )
}
