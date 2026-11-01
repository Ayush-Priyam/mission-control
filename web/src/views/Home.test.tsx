// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { RunStatusBadge } from "./Home"

afterEach(cleanup)

describe("RunStatusBadge", () => {
  it("says Waiting on you only when the adapter's summary says waiting", () => {
    render(<RunStatusBadge run={{ id: "a", idea: "", live: false, waiting: true, stages: {} }} />)
    expect(screen.getByText("Waiting on you")).toBeTruthy()
    cleanup()
    // A stage marked stopped (say by a budget stop) is not waiting on you.
    render(<RunStatusBadge run={{ id: "b", idea: "", live: false, waiting: false, stages: { qa: { status: "stopped" } } }} />)
    expect(screen.queryByText("Waiting on you")).toBeNull()
    expect(screen.getByText("Ended")).toBeTruthy()
  })
})
