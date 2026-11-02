// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RightRail } from "./RightRail"

afterEach(() => { cleanup(); location.hash = "" })

const detail = (waiting: boolean) => ({
  summary: { source: "claude-code", id: "s1", kind: "session", title: "t", live: false, status: waiting ? "waiting" : "idle", waiting, updatedAt: "2026-01-01T10:00:00Z", counts: { lanes: 1, calls: 0, errors: 0 } },
  lanes: [{ id: "main", label: "main", kind: "main", status: waiting ? "waiting" : "idle", reason: waiting ? "approve Bash" : undefined, calls: 0, errors: 0 }],
  events: [],
}) as any

describe("RightRail flash (the map's you node)", () => {
  it("flashes the needs-you card from state, not by toggling classes by hand", async () => {
    const { rerender } = render(<RightRail detail={detail(true)} calls={[]} actions={[]} now={0} flash={0} />)
    expect(screen.getByLabelText("Needs you").className).not.toContain("mc-flash")
    rerender(<RightRail detail={detail(true)} calls={[]} actions={[]} now={0} flash={1} />)
    await waitFor(() => expect(screen.getByLabelText("Needs you").className).toContain("mc-flash"))
  })

  it("with no needs-you card it flashes the rail and stays on this tab", async () => {
    location.hash = "#/item/claude-code/s1/lanes"
    const { rerender } = render(<RightRail detail={detail(false)} calls={[]} actions={[]} now={0} flash={0} />)
    rerender(<RightRail detail={detail(false)} calls={[]} actions={[]} now={0} flash={1} />)
    await waitFor(() => expect(screen.getByLabelText("Item rail").className).toContain("mc-flash"))
    expect(location.hash).toBe("#/item/claude-code/s1/lanes")
  })
})
