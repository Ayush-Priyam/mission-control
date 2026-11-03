// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AnswerResult, Entry } from "@/lib/remote"
import { AuthScreen } from "./RemoteApp"
import { PromptList } from "./PromptList"

afterEach(cleanup)

const since = new Date(Date.now() - 2 * 60_000).toISOString()
const perm: Entry = { source: "claude-code", id: "s1", title: "Fix tests", project: "~/app", lane: "main", tool: "Bash", target: "npm test --silent", since, answerable: true, promptId: "p1", bind: "b1", kind: "permission" }
const one: Entry = {
  ...perm,
  id: "s2",
  promptId: "p2",
  bind: "b2",
  kind: "ask",
  tool: "AskUserQuestion",
  title: "Pick a db",
  questions: [{ question: "Which db?", header: "DB", multiSelect: false, options: [{ label: "SQLite", description: "file" }, { label: "Postgres", description: "server" }] }],
}
const many: Entry = {
  ...one,
  id: "s3",
  promptId: "p3",
  bind: "b3",
  title: "Two questions",
  questions: [
    { question: "Which db?", header: "DB", multiSelect: false, options: [{ label: "SQLite", description: "" }, { label: "Postgres", description: "" }] },
    { question: "Which orm?", header: "ORM", multiSelect: false, options: [{ label: "None", description: "" }, { label: "Drizzle", description: "" }] },
  ],
}
const ro: Entry = { source: "codex", id: "c1", title: "Codex task", lane: "main", tool: "Bash", target: "ls", since, answerable: false }

const ok = (): Promise<AnswerResult> => Promise.resolve({ kind: "ok" })
const show = (entries: Entry[] | null, answer = vi.fn(ok), extra: Partial<Parameters<typeof PromptList>[0]> = {}) =>
  render(<PromptList entries={entries} online answer={answer} onAuth={() => {}} {...extra} />)

describe("PromptList", () => {
  it("first load shows two skeletons and nothing else", () => {
    show(null)
    expect(document.querySelectorAll("[data-skeleton]")).toHaveLength(2)
    expect(screen.queryByText("Nothing needs you right now.")).toBeNull()
  })

  it("empty list says so", () => {
    show([])
    expect(screen.getByText("Nothing needs you right now.")).toBeTruthy()
  })

  it("header counts what can be answered here and at the terminal", () => {
    show([perm, one, ro])
    expect(screen.getByText("2 you can answer here · 1 at the terminal")).toBeTruthy()
  })

  it("permission card: tool, target, project, asked time, Allow and Deny of at least 48px", () => {
    show([perm])
    expect(screen.getByText("npm test --silent")).toBeTruthy()
    expect(screen.getByText("~/app")).toBeTruthy()
    expect(screen.getByText("asked 2m ago")).toBeTruthy()
    expect(screen.getByRole("article", { name: "Fix tests" })).toBeTruthy()
    const allow = screen.getByRole("button", { name: /^Allow/ })
    const deny = screen.getByRole("button", { name: /^Deny/ })
    expect(allow.className).toContain("h-13")
    expect(deny.className).toContain("h-13")
  })

  it("tapping Allow sends promptId and bind once, locks the card, then shows Allowed", async () => {
    let resolve!: (r: AnswerResult) => void
    const answer = vi.fn(() => new Promise<AnswerResult>((r) => (resolve = r)))
    show([perm], answer)
    fireEvent.click(screen.getByRole("button", { name: /^Allow/ }))
    expect(answer).toHaveBeenCalledWith("p1", "b1", "allow")
    expect(screen.getByText("Allowing…")).toBeTruthy()
    expect(screen.getByRole("article").getAttribute("aria-busy")).toBe("true")
    for (const b of screen.getAllByRole("button")) expect((b as HTMLButtonElement).disabled).toBe(true)
    await act(async () => resolve({ kind: "ok" }))
    expect(screen.getByText("Allowed")).toBeTruthy()
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(answer).toHaveBeenCalledTimes(1)
  })

  it("Deny sends deny and shows Denied", async () => {
    const answer = vi.fn(ok)
    show([perm], answer)
    fireEvent.click(screen.getByRole("button", { name: /^Deny/ }))
    expect(answer).toHaveBeenCalledWith("p1", "b1", "deny")
    await screen.findByText("Denied")
  })

  it("one-question ask: one button per option, a tap sends the label", async () => {
    const answer = vi.fn(ok)
    show([one], answer)
    expect(screen.getByRole("group", { name: "Which db?" })).toBeTruthy()
    expect(screen.getAllByRole("button")).toHaveLength(2)
    fireEvent.click(screen.getByRole("button", { name: /Postgres/ }))
    expect(answer).toHaveBeenCalledWith("p2", "b2", { answers: { "Which db?": "Postgres" } })
    await screen.findByText("Answered")
  })

  it("several questions: radios, and Send stays disabled until every question has a pick", async () => {
    const answer = vi.fn(ok)
    show([many], answer)
    const send = screen.getByRole("button", { name: "Send answers" }) as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: "SQLite" }))
    expect(screen.getByRole("radio", { name: "SQLite" }).getAttribute("aria-checked")).toBe("true")
    expect(send.disabled).toBe(true)
    expect(answer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("radio", { name: "Drizzle" }))
    expect(send.disabled).toBe(false)
    fireEvent.click(send)
    expect(answer).toHaveBeenCalledWith("p3", "b3", { answers: { "Which db?": "SQLite", "Which orm?": "Drizzle" } })
    await screen.findByText("Answered")
  })

  it("a read-only card has no buttons and says where to answer", () => {
    show([ro])
    expect(screen.getByText("answer where the agent runs")).toBeTruthy()
    expect(screen.queryAllByRole("button")).toHaveLength(0)
  })

  it.each([
    ["changed", "prompt changed, nothing was approved"],
    ["answered", "already answered"],
    ["terminal", "answered in terminal"],
    ["gone", "no longer waiting"],
  ] as const)("a 409 %s shows its text, no buttons, and focuses the reason", async (reason, text) => {
    show([perm], vi.fn(async () => ({ kind: "refused", reason }) as AnswerResult))
    fireEvent.click(screen.getByRole("button", { name: /^Allow/ }))
    const line = await screen.findByText(text)
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    await waitFor(() => expect(document.activeElement).toBe(line.closest("p")))
  })

  it("a network failure shows the offline text on the card and keeps the buttons for a later try", async () => {
    show([perm], vi.fn(async () => ({ kind: "offline" }) as AnswerResult))
    fireEvent.click(screen.getByRole("button", { name: /^Allow/ }))
    await screen.findByText("offline, can't answer")
    expect((screen.getByRole("button", { name: /^Allow/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("a revoked answer calls onAuth('revoked')", async () => {
    const onAuth = vi.fn()
    show([perm], vi.fn(async () => ({ kind: "revoked" }) as AnswerResult), { onAuth })
    fireEvent.click(screen.getByRole("button", { name: /^Deny/ }))
    await waitFor(() => expect(onAuth).toHaveBeenCalledWith("revoked"))
  })

  it("the same card with a new promptId is flagged as a new prompt, and the new bind is used", () => {
    const answer = vi.fn(ok)
    const { rerender } = show([perm], answer)
    expect(screen.queryByText("new prompt")).toBeNull()
    rerender(<PromptList entries={[{ ...perm, promptId: "p9", bind: "b9" }]} online answer={answer} onAuth={() => {}} />)
    expect(screen.getByText("new prompt")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /^Allow/ }))
    expect(answer).toHaveBeenCalledWith("p9", "b9", "allow")
  })
})

describe("AuthScreen", () => {
  it("revoked and not paired", () => {
    const { rerender } = render(<AuthScreen kind="revoked" />)
    expect(screen.getByText("This device was revoked. Pair again.")).toBeTruthy()
    rerender(<AuthScreen kind="not-paired" />)
    expect(screen.getByRole("alert").textContent).toBe("Run mission-control remote pair on your computer.")
  })
})
