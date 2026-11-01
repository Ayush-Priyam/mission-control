import { describe, expect, it } from "vitest"
import { footerNote } from "./Shell"

describe("shell footer (M5)", () => {
  it("is read-only with no actions, else read-only except your actions", () => {
    expect(footerNote([])).toBe("read-only · local · 127.0.0.1")
    expect(footerNote(undefined)).toBe("read-only · local · 127.0.0.1")
    expect(footerNote(["sign", "say"])).toBe("read-only except your actions · local · 127.0.0.1")
  })
})
