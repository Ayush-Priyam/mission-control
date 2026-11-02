// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { budgetAlert, type BudgetState } from "@/lib/api-v22"
import { BudgetBars, BudgetChip } from "./Budgets"

afterEach(cleanup)
const b = (ratio: number, level: BudgetState["level"], match = "shop"): BudgetState => ({ scope: "project", match, period: "weekly", limit: 10, spent: ratio * 10, ratio, level })

describe("budgets UI", () => {
  it("no chip under 80%; warn chip at 80%; over chip at 100% wins", () => {
    expect(budgetAlert([b(0.5, "ok")])).toBeNull()
    const { container, rerender } = render(<BudgetChip budgets={[b(0.5, "ok")]} />)
    expect(container.innerHTML).toBe("")
    rerender(<BudgetChip budgets={[b(0.85, "warn")]} />)
    expect(screen.getByText("Budget 85%")).toBeTruthy()
    rerender(<BudgetChip budgets={[b(0.85, "warn"), b(1.2, "over", "api")]} />)
    expect(screen.getByText("Over budget").closest("a")!.getAttribute("href")).toBe("#/usage")
  })
  it("bars show spent of limit, capped at full width", () => {
    render(<BudgetBars budgets={[b(1.5, "over")]} />)
    expect(screen.getByText("$15.00 / $10.00 · 150%")).toBeTruthy()
    expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("100")
  })
})
