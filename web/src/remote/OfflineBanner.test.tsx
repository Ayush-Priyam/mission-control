// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Entry } from "@/lib/remote"
import { OfflineBanner } from "./OfflineBanner"
import { PromptList } from "./PromptList"

afterEach(cleanup)

const perm: Entry = { source: "claude-code", id: "s1", title: "Fix tests", lane: "main", tool: "Bash", target: "npm test", since: new Date().toISOString(), answerable: true, promptId: "p1", bind: "b1", kind: "permission" }
const ask: Entry = {
  ...perm,
  id: "s2",
  promptId: "p2",
  bind: "b2",
  kind: "ask",
  tool: "AskUserQuestion",
  questions: [{ question: "Which db?", header: "DB", multiSelect: false, options: [{ label: "SQLite", description: "" }, { label: "Postgres", description: "" }] }],
}

describe("offline", () => {
  it("online: no banner", () => {
    render(<OfflineBanner offline={false} />)
    expect(screen.queryByText("offline, can't answer")).toBeNull()
  })

  it("offline: the banner shows and every answer button is disabled and points at it", () => {
    const answer = vi.fn()
    render(
      <>
        <OfflineBanner offline />
        <PromptList entries={[perm, ask]} online={false} answer={answer} onAuth={() => {}} />
      </>,
    )
    expect(screen.getByText("offline, can't answer")).toBeTruthy()
    const buttons = screen.getAllByRole("button")
    expect(buttons).toHaveLength(4)
    for (const b of buttons) {
      expect((b as HTMLButtonElement).disabled).toBe(true)
      expect(b.getAttribute("aria-disabled")).toBe("true")
      expect(b.getAttribute("aria-describedby")).toBe("mc-offline-banner")
    }
    expect(document.querySelector("[data-live-dot]")!.className).not.toContain("bg-running")
  })
})
