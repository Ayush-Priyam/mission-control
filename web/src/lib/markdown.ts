// A small markdown reader for run documents: headings, paragraphs, lists, task lists, tables,
// quotes, rules and fenced code. Pure (blocks, not HTML), so the component renders it as React nodes.

export type Block =
  | { t: "h"; n: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: { text: string; task?: boolean; done?: boolean }[] }
  | { t: "code"; text: string }
  | { t: "quote"; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "hr" }

const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
const isRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)

export function parseMarkdown(text: string): Block[] {
  // YAML front matter (a leading --- block) is metadata, not reading.
  const lines = String(text ?? "").replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "").split(/\r\n|\r|\n/)
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    if (/^\s*```/.test(l)) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++])
      i++
      out.push({ t: "code", text: buf.join("\n") })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l)
    if (h) { out.push({ t: "h", n: h[1].length, text: h[2].trim() }); i++; continue }
    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) { out.push({ t: "hr" }); i++; continue }
    if (l.includes("|") && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(l), rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]))
      out.push({ t: "table", head, rows })
      continue
    }
    if (/^\s*>/.test(l)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""))
      out.push({ t: "quote", text: buf.join(" ") })
      continue
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/
    if (li.test(l)) {
      const ordered = /^\s*\d+\./.test(l)
      const items: { text: string; task?: boolean; done?: boolean }[] = []
      while (i < lines.length && li.test(lines[i])) {
        const body = li.exec(lines[i++])![2]
        const task = /^\[( |x|X)\]\s+(.*)$/.exec(body)
        items.push(task ? { text: task[2], task: true, done: task[1] !== " " } : { text: body })
      }
      out.push({ t: ordered ? "ol" : "ul", items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim())
    if (!para.length) { para.push(l.trim()); i++ }
    out.push({ t: "p", text: para.join(" ") })
  }
  return out
}

export type Inline = { k: "text" | "code" | "b" | "i"; text: string }

/** `code`, **bold** and *italic* runs; everything else stays text. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])/g
  let last = 0
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ k: "text", text: s.slice(last, m.index) })
    out.push(m[1] !== undefined ? { k: "code", text: m[1] } : m[2] !== undefined ? { k: "b", text: m[2] } : { k: "i", text: m[3] })
    last = m.index! + m[0].length
  }
  if (last < s.length) out.push({ k: "text", text: s.slice(last) })
  return out
}
