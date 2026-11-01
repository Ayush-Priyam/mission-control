import { describe, expect, it } from "vitest"
import { footer } from "./Run"

describe("run footer (M6)", () => {
  it("sums tokens without cache reads and says so", () => {
    const events = [{ type: "session", cost: 0.5, tokens: { input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 500, cache_read_input_tokens: 90000 } }]
    expect(footer(events, [])).toBe("$0.50 · 2k tok excl. cache reads · 0 running")
  })
})
