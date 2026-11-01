// A session transcript in a form the session sheet can draw: markdown as text, a Claude Code
// .jsonl log as a list of messages. Pure, so it is tested without a browser.

export type Message = { role: string; text: string; tool?: string }
export type Renderable = { kind: "markdown"; text: string } | { kind: "messages"; items: Message[] }

const CLIP = 4000
const clip = (s: string) => (s.length > CLIP ? `${s.slice(0, CLIP - 1)}…` : s)

/** The text of a content block list (or a bare string): text blocks joined, tool results as their text. */
function textOf(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((b: any) => {
      if (b?.type === "text" && typeof b.text === "string") return b.text
      if (b?.type === "tool_result") return textOf(b.content)
      return ""
    })
    .filter(Boolean)
    .join("\n")
}

/** One .jsonl line as a message, or null for anything else (bad JSON, summaries, system lines). */
function message(line: string): Message | null {
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  if (!o || (o.type !== "user" && o.type !== "assistant")) return null
  const content = o.message?.content
  const blocks: any[] = Array.isArray(content) ? content : []
  const tools = blocks.filter((b) => b?.type === "tool_use" && typeof b.name === "string").map((b) => b.name as string)
  const results = blocks.length > 0 && blocks.every((b) => b?.type === "tool_result")
  const text = clip(textOf(content).trim())
  if (!text && !tools.length) return null
  const m: Message = { role: results ? "tool" : o.type, text }
  if (tools.length) m.tool = tools.join(", ")
  return m
}

/** The session file a `transcript` field names (it may carry a path); null when it is not a session file. */
export function sessionFile(transcript: unknown): string | null {
  const name = String(transcript ?? "").split(/[\\/]/).filter(Boolean).pop() ?? ""
  return /^[\w.-]+\.(md|jsonl)$/.test(name) ? name : null
}

export function renderable(name: string, text: string): Renderable {
  if (!name.endsWith(".jsonl")) return { kind: "markdown", text }
  const items: Message[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    const m = message(line)
    if (m) items.push(m)
  }
  return { kind: "messages", items }
}
