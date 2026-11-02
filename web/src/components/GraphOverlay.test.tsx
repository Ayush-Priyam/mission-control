// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GraphOverlay } from "./GraphOverlay"

afterEach(cleanup)

function Host({ n, onClose }: { n: number; onClose: () => void }) {
  return (
    <GraphOverlay title="Flow" onClose={() => onClose()}>
      <button type="button">node {n}</button>
    </GraphOverlay>
  )
}

describe("GraphOverlay", () => {
  it("a parent re-render with new data (a new inline onClose) leaves focus and the body's overflow alone", () => {
    const onClose = vi.fn()
    const { rerender } = render(<Host n={1} onClose={onClose} />)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close full screen" }))
    const node = screen.getByRole("button", { name: "node 1" })
    node.focus()
    expect(document.body.style.overflow).toBe("hidden")
    rerender(<Host n={2} onClose={onClose} />)
    rerender(<Host n={3} onClose={onClose} />)
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "node 3" }))
    expect(document.body.style.overflow).toBe("hidden")
    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
