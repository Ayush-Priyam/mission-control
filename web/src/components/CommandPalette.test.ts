import { describe, expect, it } from "vitest"
import { paletteStep } from "./CommandPalette"

describe("paletteStep", () => {
  it("clamps to the list, and stays at 0 with no results (never -1)", () => {
    expect(paletteStep(0, 1, 0)).toBe(0)
    expect(paletteStep(0, -1, 0)).toBe(0)
    expect(paletteStep(2, 1, 3)).toBe(2)
    expect(paletteStep(1, 1, 3)).toBe(2)
    expect(paletteStep(0, -1, 3)).toBe(0)
  })
})
