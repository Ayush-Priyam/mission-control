// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PairScreen } from "./PairScreen"

beforeEach(() => history.replaceState(null, "", "/pair#t=abc123"))
afterEach(cleanup)

describe("PairScreen", () => {
  it("clears the fragment before posting the token, then goes on", async () => {
    let hashAtPost = "unset"
    const pair = vi.fn(async (t: string) => {
      hashAtPost = location.hash
      return { kind: "ok" as const, device: { id: "d1", label: "iPhone" } }
    })
    const onPaired = vi.fn()
    render(<PairScreen pair={pair} onPaired={onPaired} />)
    expect(screen.getByText("Pairing this phone…")).toBeTruthy()
    await waitFor(() => expect(onPaired).toHaveBeenCalled())
    expect(pair).toHaveBeenCalledWith("abc123")
    expect(hashAtPost).toBe("")
    expect(location.hash).toBe("")
  })

  it("an expired or used link shows the contract text and the command", async () => {
    render(<PairScreen pair={async () => ({ kind: "expired" })} onPaired={() => {}} />)
    await screen.findByText("This pairing link expired or was already used. Run `mission-control remote pair` again.")
    expect(screen.getByText("mission-control remote pair")).toBeTruthy()
  })

  it("429 asks to wait", async () => {
    render(<PairScreen pair={async () => ({ kind: "limited" })} onPaired={() => {}} />)
    await screen.findByText("Too many attempts. Wait a minute and try again.")
  })

  it("a link without a token never posts", async () => {
    history.replaceState(null, "", "/pair")
    const pair = vi.fn()
    render(<PairScreen pair={pair} onPaired={() => {}} />)
    await screen.findByRole("alert")
    expect(pair).not.toHaveBeenCalled()
  })
})
