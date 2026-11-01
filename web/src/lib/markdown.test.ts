import { describe, expect, it } from "vitest"
import { parseInline, parseMarkdown } from "./markdown"

describe("parseMarkdown", () => {
  it("reads headings, paragraphs, lists, tasks, tables, quotes, rules and fences", () => {
    const md = ["# Title", "", "one", "two", "", "- a", "- [x] done", "- [ ] todo", "", "1. first", "", "| k | v |", "|---|---|", "| a | b |", "", "> note", "", "---", "", "```js", "let x = 1", "```"].join("\n")
    expect(parseMarkdown(md)).toEqual([
      { t: "h", n: 1, text: "Title" },
      { t: "p", text: "one two" },
      { t: "ul", items: [{ text: "a" }, { text: "done", task: true, done: true }, { text: "todo", task: true, done: false }] },
      { t: "ol", items: [{ text: "first" }] },
      { t: "table", head: ["k", "v"], rows: [["a", "b"]] },
      { t: "quote", text: "note" },
      { t: "hr" },
      { t: "code", text: "let x = 1" },
    ])
  })

  it("drops front matter", () => {
    expect(parseMarkdown('---\nstatus: "approved"\n---\n# Hi')).toEqual([{ t: "h", n: 1, text: "Hi" }])
    expect(parseMarkdown("---\n\ntext")).toEqual([{ t: "hr" }, { t: "p", text: "text" }])
  })

  it("never loops on odd input", () => {
    expect(parseMarkdown("```\nunclosed")).toEqual([{ t: "code", text: "unclosed" }])
    expect(parseMarkdown("")).toEqual([])
  })
})

describe("parseInline", () => {
  it("splits code, bold and italic runs", () => {
    expect(parseInline("a `b` **c** *d* e")).toEqual([
      { k: "text", text: "a " }, { k: "code", text: "b" }, { k: "text", text: " " },
      { k: "b", text: "c" }, { k: "text", text: " " }, { k: "i", text: "d" }, { k: "text", text: " e" },
    ])
  })
})
