// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import type { ItemConfig, JoinRow } from "@/lib/api-v22"
import { ConfigJoin, joinLabel } from "./ConfigJoin"

afterEach(cleanup)
const row = (name: string, status: JoinRow["status"], calls = 0, errors = 0, configured = true): JoinRow => ({ name, scope: "user", configured, status, calls, errors, errorRate: calls ? errors / calls : 0 })

describe("ConfigJoin", () => {
  it("labels each state", () => {
    expect(joinLabel(row("a", "used", 12))).toBe("used · 12×")
    expect(joinLabel(row("a", "failing", 4, 3))).toBe("failing · 3/4 errored")
    expect(joinLabel(row("a", "unused"))).toBe("loaded, not used")
    expect(joinLabel(row("a", "used", 2, 0, false))).toBe("used · 2× · not in config")
  })
  it("shows used and failing first, unused capped with a toggle, and the counts line", () => {
    const skills = [row("tdd", "used", 2), ...Array.from({ length: 9 }, (_, i) => row(`s${i}`, "unused"))]
    const config: ItemConfig = { harness: "claude-code", servers: [row("web", "failing", 2, 2), row("docs", "used", 5), row("figma", "unused")], skills, plugins: [] }
    render(<ConfigJoin config={config} />)
    expect(screen.getByText(/1 servers and 9 skills loaded, not used/)).toBeTruthy()
    expect(screen.getByText(/1 failing/)).toBeTruthy()
    const list = screen.getByLabelText("skills")
    expect(list.querySelectorAll("[data-join]")).toHaveLength(7)
    fireEvent.click(screen.getByText("+ 3 more loaded, not used"))
    expect(list.querySelectorAll("[data-join]")).toHaveLength(10)
  })
})
