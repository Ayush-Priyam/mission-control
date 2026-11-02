// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import Trace from "./Trace"

afterEach(cleanup)

const fixture = (id: string) =>
  readFileSync(join(import.meta.dirname, "../../../test/fixtures/runs", id, "runs.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))

describe("Trace", () => {
  it("draws the done fixture's totals, status and spans", () => {
    render(<Trace runId="20261101-0900-done" events={fixture("20261101-0900-done")} live={false} />)
    const totals = screen.getByLabelText("Trace totals").textContent
    expect(totals).toContain("10m 38s")
    expect(totals).toContain("$0.42")
    expect(totals).toContain("10.9k")
    expect(screen.getByText("done")).toBeTruthy()
    expect(document.querySelectorAll("[data-trace-row]")).toHaveLength(6)
    expect(screen.getByText("slowest")).toBeTruthy()
    // M6: the trace total counts cache reads and says so.
    expect(totals).toContain("incl. cache reads")
    // M7: a stage that ended fine has no red mark.
    expect(document.querySelectorAll("[data-stage-icon]").length).toBeGreaterThan(0)
    expect(document.querySelectorAll("[data-stage-icon] .bg-failed")).toHaveLength(0)
  })

  it("marks only a failed stage's icon red (M7)", () => {
    const events = [
      { ts: "2026-11-01T09:00:00Z", type: "stage.start", stage: "spec" },
      { ts: "2026-11-01T09:01:00Z", type: "stage.end", stage: "spec", ok: true },
      { ts: "2026-11-01T09:02:00Z", type: "stage.start", stage: "build" },
      { ts: "2026-11-01T09:03:00Z", type: "stage.end", stage: "build", ok: false },
    ]
    render(<Trace runId="r" events={events} live={false} />)
    const red = [...document.querySelectorAll("[data-stage-icon]")].filter((i) => i.querySelector(".bg-failed"))
    expect(red.map((i) => i.getAttribute("data-stage-icon"))).toEqual(["build"])
  })

  it("shows an unfinished trace on a dead run as Ended with no spinner, and marks approx stages", () => {
    const events = [
      { ts: "2026-11-01T09:00:00Z", type: "stage.start", stage: "plan", approx: true },
      { ts: "2026-11-01T09:00:30Z", type: "progress", stage: "plan", tool: "Read", detail: "spec.md" },
    ]
    render(<Trace runId="r" events={events} live={false} />)
    expect(screen.getByText("ended")).toBeTruthy()
    expect(document.querySelector(".animate-spin")).toBeNull()
    expect(document.querySelector(".border-dashed")).toBeTruthy()
    expect(screen.getAllByText("approx. from file times").length).toBeGreaterThan(0)
  })

  it("spins a running span while the run is live", () => {
    const events = [{ ts: "2026-11-01T09:00:00Z", type: "stage.start", stage: "plan" }]
    render(<Trace runId="r" events={events} live />)
    expect(screen.getByText("working")).toBeTruthy()
    expect(document.querySelector(".animate-spin")).toBeTruthy()
  })
})
