import { describe, expect, it } from "vitest"
import { codeFilter, laneFilter, latestSession, sections, touchedFiles } from "./workbench"

const art = ["spec/contract.md", "sessions/backend-1.md", "sessions/backend-10.md", "sessions/backend-2.md", "design/home.png", "app/preview.png", "qa.md"]

describe("workbench sections", () => {
  it("picks the newest numbered session", () => {
    expect(latestSession(art, "backend")).toBe("sessions/backend-10.md")
  })
  it("lists tabs per agent from what exists", () => {
    expect(sections("backend", art).map((s) => s.title)).toEqual(["code", "last session (10)"])
    expect(sections("frontend", art).map((s) => s.kind)).toEqual(["diff", "device"])
    expect(sections("design", art)[0]).toEqual({ title: "frames (1)", kind: "gallery", prefix: "design/" })
    expect(sections("qa", art).map((s) => s.title)).toEqual(["report card", "qa notes"])
    expect(sections("architect", art).map((s) => s.title)).toEqual(["contract"])
  })
  it("says so when nothing was made", () => {
    expect(sections("review", [])).toEqual([{ title: "about", kind: "note", text: "Nothing made yet." }])
  })
  it("splits coder files by lane and hides the harness's own", () => {
    const fe = laneFilter("frontend"), be = laneFilter("backend")
    expect(fe("composeApp/ui/Home.kt")).toBe(true)
    expect(be("composeApp/ui/Home.kt")).toBe(false)
    expect(be("server/api.kt")).toBe(true)
    expect(be(".harness/state.json")).toBe(false)
  })
})

describe("code tab file choice", () => {
  const ev = [
    { type: "progress", stage: "backend", tool: "Edit", detail: "/w/app/server/api.kt" },
    { type: "progress", stage: "backend", tool: "Read", detail: "/w/app/other.kt" },
    { type: "progress", stage: "backend", tool: "Write", detail: "/w/app/server/api.kt" },
    { type: "progress", stage: "qa", tool: "Edit", detail: "/w/qa.kt" },
  ]
  it("collects the stage's edited files once", () => {
    expect(touchedFiles(ev, ["backend"])).toEqual(["/w/app/server/api.kt"])
  })
  it("prefers touched files, and falls back to the lane guess when none", () => {
    const f = codeFilter("backend", touchedFiles(ev, ["backend"]))
    expect(f("app/server/api.kt")).toBe(true)
    expect(f("app/other.kt")).toBe(false)
    expect(codeFilter("backend", [])("app/other.kt")).toBe(true)
    expect(codeFilter("backend", [])("composeApp/ui/Home.kt")).toBe(false)
  })
})
