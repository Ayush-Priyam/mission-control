// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThemePicker } from "./ThemePicker"
import { useTheme } from "@/lib/use-theme"
import { buildTokens, KEYS, PRESETS } from "@/lib/themes"

let dark = true
const listeners = new Set<() => void>()
beforeEach(() => {
  localStorage.clear()
  dark = true
  vi.stubGlobal("matchMedia", (q: string) => ({
    get matches() {
      return q.includes("prefers-color-scheme: dark") ? dark : false
    },
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  listeners.clear()
  document.documentElement.removeAttribute("style")
  document.documentElement.className = ""
})

function Harness() {
  return <ThemePicker theme={useTheme()} />
}
const css = (k: string) => document.documentElement.style.getPropertyValue(k)

describe("theme picker", () => {
  it("lists the presets with a check on the active one; picking one applies and persists it", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Theme" }))
    const group = screen.getByRole("radiogroup", { name: "Theme preset" })
    expect(group.textContent).toMatch(/Mission.*Blossom.*Mint.*Mono.*Custom/)
    expect(screen.getByRole("radio", { name: "Mission" }).getAttribute("aria-checked")).toBe("true")
    fireEvent.click(screen.getByRole("radio", { name: "Blossom" }))
    expect(css("--brand")).toBe(buildTokens(PRESETS.blossom.spec, "dark").tokens["--brand"])
    expect(localStorage.getItem(KEYS.preset)).toBe("blossom")
    expect(JSON.parse(localStorage.getItem(KEYS.vars)!).preset).toBe("blossom") // the pre-paint script's map
  })

  it("System follows prefers-color-scheme live", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Theme" }))
    fireEvent.click(screen.getByRole("radio", { name: "System" }))
    expect(document.documentElement.classList.contains("dark")).toBe(true)
    dark = false
    act(() => listeners.forEach((f) => f()))
    expect(document.documentElement.classList.contains("dark")).toBe(false)
    expect(css("--background")).toBe("#ffffff")
    expect(localStorage.getItem(KEYS.appearance)).toBe("system")
  })

  it("Mono turns on status shapes; Custom takes a base and an accent, contrast-adjusted", () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Theme" }))
    fireEvent.click(screen.getByRole("radio", { name: "Mono" }))
    expect(document.documentElement.hasAttribute("data-shapes")).toBe(true)
    fireEvent.click(screen.getByRole("radio", { name: /^Custom/ }))
    expect(document.documentElement.hasAttribute("data-shapes")).toBe(false)
    fireEvent.click(screen.getByRole("radio", { name: "Cool" }))
    fireEvent.change(screen.getByLabelText("Accent colour"), { target: { value: "#ffff00" } })
    expect(css("--background")).toBe("#020617")
    expect(css("--brand")).toBe("#ffff00") // yellow on near-black passes as is
    expect(JSON.parse(localStorage.getItem(KEYS.custom)!)).toEqual({ kind: "pick", base: "cool", accent: "#ffff00" })
  })

  it("Esc closes the popover and returns focus to the button", () => {
    render(<Harness />)
    const b = screen.getByRole("button", { name: "Theme" })
    fireEvent.click(b)
    expect(screen.getByRole("dialog", { name: "Theme" })).toBeTruthy()
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(document.activeElement).toBe(b)
  })

  it("refuses an import over 256 KB before reading it, with a visible error", async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("button", { name: "Theme" }))
    fireEvent.click(screen.getByRole("radio", { name: /^Custom/ }))
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const f = new File(["x"], "huge.itermcolors", { type: "application/xml" })
    Object.defineProperty(f, "size", { value: 256 * 1024 + 1 })
    const text = vi.spyOn(f, "text")
    await act(async () => {
      fireEvent.change(input, { target: { files: [f] } })
    })
    expect(text).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toMatch(/at most 256 KB/)
    expect(localStorage.getItem(KEYS.custom)).not.toMatch(/huge/)
  })
})
