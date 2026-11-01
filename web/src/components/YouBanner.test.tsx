// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { YouBanner } from "./YouBanner"

afterEach(cleanup)

describe("YouBanner", () => {
  it("an owner stop says Needs you and offers the declared actions", () => {
    render(<YouBanner runId="r1" stop={{ stage: "qa", rule: "human", detail: "copy?", waiting: true }} actions={["sign", "say"]} />)
    expect(screen.getByLabelText("Needs you")).toBeTruthy()
    expect(screen.getByText("NEEDS YOU")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Sign" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Send back" })).toBeTruthy()
  })

  it("any other stop says Stopped (<rule>) and offers no buttons", () => {
    render(<YouBanner runId="r1" stop={{ stage: "qa", rule: "budget", detail: "over budget", waiting: false }} actions={["sign", "say"]} />)
    expect(screen.getByLabelText("Stopped")).toBeTruthy()
    expect(screen.getByText("STOPPED (BUDGET)")).toBeTruthy()
    expect(screen.getByText(/Stopped \(budget\)/)).toBeTruthy()
    expect(screen.queryByText("NEEDS YOU")).toBeNull()
    expect(screen.queryAllByRole("button")).toHaveLength(0)
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})
