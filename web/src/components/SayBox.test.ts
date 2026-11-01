import { describe, expect, it } from "vitest"
import { parseSay } from "./SayBox"

describe("parseSay", () => {
  it("routes @stage text to that stage", () => {
    expect(parseSay("@backend use 400", "qa")).toEqual({ stage: "backend", text: "use 400" })
  })
  it("sends plain text to the fallback stage", () => {
    expect(parseSay("  looks fine ", "qa")).toEqual({ stage: "qa", text: "looks fine" })
  })
  it("asks for @stage when there is no fallback", () => {
    expect(parseSay("looks fine", "")).toEqual({ error: "Start with @stage" })
  })
  it("treats a bare @stage with no text as an error, not as text", () => {
    expect(parseSay("@backend", "qa")).toEqual({ error: "Write a message after @backend" })
    expect(parseSay("@backend   ", "")).toEqual({ error: "Write a message after @backend" })
  })
})
