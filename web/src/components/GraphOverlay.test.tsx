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

describe("GraphOverlay start view", () => {
  it("startView: a fit that is already readable wins; else minK, centred on the focus point", async () => {
    const { startView, fitView } = await import("./GraphOverlay")
    const start = { minK: 0.8, focus: [] }
    expect(startView(400, 200, 1000, 600, start)).toEqual(fitView(400, 200, 1000, 600))
    expect(startView(4000, 800, 1000, 600, start, { x: 3100, y: 125 })).toEqual({ k: 0.8, x: 500 - 3100 * 0.8, y: 300 - 125 * 0.8 })
    expect(startView(4000, 800, 1000, 600, start, null)).toEqual({ k: 0.8, x: 500 - 2000 * 0.8, y: 300 - 400 * 0.8 })
  })
  it("opens at ≥80% on the first matching focus element; the fit button still fits", () => {
    // content 4000 × 800 in a 1000 × 600 view (the view is the content's parent)
    const size = (el: Element) => (el.hasAttribute("data-graph-content") ? { w: 4000, h: 800 } : { w: 0, h: 0 })
    const isView = (el: Element) => !!el.firstElementChild?.hasAttribute("data-graph-content")
    const spies = [
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return size(this).w }),
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return size(this).h }),
      vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) { return isView(this) ? 1000 : 0 }),
      vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function (this: Element) { return isView(this) ? 600 : 0 }),
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        const r = this.getAttribute("data-target") === "ask" ? { x: 3000, y: 100, width: 200, height: 50 } : { x: 0, y: 0, width: 0, height: 0 }
        return { ...r, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height, toJSON() {} } as DOMRect
      }),
    ]
    render(
      <GraphOverlay title="Map" onClose={() => {}} start={{ minK: 0.8, focus: ['[data-target="none"]', '[data-target="ask"]'] }}>
        <div data-target="ask">qa</div>
      </GraphOverlay>,
    )
    const content = document.querySelector<HTMLElement>("[data-graph-content]")!
    expect(screen.getByRole("button", { name: "Fit" }).textContent).toBe("80%")
    expect(content.style.transform).toBe(`translate(${500 - 3100 * 0.8}px, ${300 - 125 * 0.8}px) scale(0.8)`)
    fireEvent.click(screen.getByRole("button", { name: "Fit" }))
    expect(screen.getByRole("button", { name: "Fit" }).textContent).toBe("23%") // (1000 - 64) / 4000
    spies.forEach((s) => s.mockRestore())
  })
})
