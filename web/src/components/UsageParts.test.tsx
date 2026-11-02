// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { slices } from "./SplitBar"
import { UsageTable, type UsageRowView } from "./UsageTable"

afterEach(cleanup)

const g = (key: string, n: number) => ({ key, in: n, out: 0, cacheRead: 0, cacheWrite: 0, cost: n / 1000, sessions: 1 })

describe("split bar slices", () => {
  it("folds groups under 0.05% of tokens into other, so no slice is drawn too thin to see", () => {
    const s = slices([g("big", 1_000_000), g("mid", 10_000), g("tiny", 400), g("tinier", 100)])
    expect(s.map((x) => x.key)).toEqual(["big", "mid", "(other)"])
    expect(s[2]).toMatchObject({ label: "2 other", tokens: 500 })
    expect(s.reduce((a, x) => a + x.tokens, 0)).toBe(1_010_500)
  })
})

describe("usage table", () => {
  const rows: UsageRowView[] = Array.from({ length: 120 }, (_, i) => ({ ...g(`d${i}`, i + 1), label: `day ${i}` }))
  it("caps long tables at 90 rows until Show all is pressed", () => {
    render(<UsageTable rows={rows} nameLabel="Date" />)
    expect(screen.getAllByRole("row")).toHaveLength(91) // header + 90
    fireEvent.click(screen.getByText("Show all 120 rows"))
    expect(screen.getAllByRole("row")).toHaveLength(121)
  })
})
