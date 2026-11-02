import { describe, expect, it } from "vitest"
import { ago, compact, money } from "./format"

describe("format", () => {
  const now = Date.parse("2026-11-02T10:00:00.000Z")
  it("ago", () => {
    expect(ago("2026-11-02T10:00:02.000Z", now)).toBe("now")
    expect(ago("2026-11-02T09:59:18.000Z", now)).toBe("42s")
    expect(ago("2026-11-02T09:55:00.000Z", now)).toBe("5m")
    expect(ago("2026-11-02T07:00:00.000Z", now)).toBe("3h")
    expect(ago("2026-10-29T10:00:00.000Z", now)).toBe("4d")
    expect(ago(null, now)).toBe("–")
  })
  it("money and compact", () => {
    expect(money(0)).toBe("–")
    expect(money(0.004)).toBe("<$0.01")
    expect(money(0.84)).toBe("$0.84")
    expect(money(1234.5)).toBe("$1,235")
    expect(compact(960)).toBe("960")
    expect(compact(1400)).toBe("1.4k")
    expect(compact(7_900_000)).toBe("7.9M")
  })
})
