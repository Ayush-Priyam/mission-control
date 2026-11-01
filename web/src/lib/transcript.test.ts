import { describe, expect, it } from "vitest"
import { renderable, sessionFile } from "./transcript"

describe("renderable", () => {
  it("shows a .md session as markdown text", () => {
    expect(renderable("backend-1.md", "# notes\nhello")).toEqual({ kind: "markdown", text: "# notes\nhello" })
  })

  it("reads a .jsonl session as Claude Code messages", () => {
    const text = [
      JSON.stringify({ type: "user", message: { role: "user", content: "write the handler" } }),
      JSON.stringify({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "Reading it first." }, { type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] },
      }),
    ].join("\n")
    const r = renderable("s.jsonl", text)
    expect(r.kind).toBe("messages")
    if (r.kind !== "messages") return
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toEqual({ role: "user", text: "write the handler" })
    expect(r.items[1].role).toBe("assistant")
    expect(r.items[1].text).toBe("Reading it first.")
    expect(r.items[1].tool).toBe("Read")
  })

  it("skips a bad line and keeps the rest", () => {
    const text = [
      JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "hi" }] } }),
      '{"type":"assistant","message":{"content":[{"type":"te',
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
      "",
    ].join("\n")
    const r = renderable("s.jsonl", text)
    expect(r).toEqual({ kind: "messages", items: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }] })
  })

  it("ignores lines that are not user or assistant messages", () => {
    const text = [JSON.stringify({ type: "summary", summary: "x" }), JSON.stringify({ type: "user", message: { content: "q" } })].join("\n")
    expect(renderable("s.jsonl", text)).toEqual({ kind: "messages", items: [{ role: "user", text: "q" }] })
  })
})

describe("sessionFile", () => {
  it("takes the file name from a transcript path and refuses anything else", () => {
    expect(sessionFile("sessions/backend-1.md")).toBe("backend-1.md")
    expect(sessionFile("abc.jsonl")).toBe("abc.jsonl")
    expect(sessionFile("notes.txt")).toBeNull()
    expect(sessionFile(undefined)).toBeNull()
  })
})
