// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { contrast, ensureContrast } from "./contrast"
import { BASES, buildTokens, contrastPairs, customSpec, DEFAULT_CUSTOM, itermTheme, KEYS, parseItermColors, parseThemeParam, PRESETS, storedTheme, type Mode } from "./themes"

const MODES: Mode[] = ["light", "dark"]

describe("contrast", () => {
  it("matches WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1)
    expect(contrast("#15803d", "#ffffff")).toBeCloseTo(5.02, 2)
    expect(contrast("#a1a1aa", "#ffffff")).toBeCloseTo(2.56, 2)
  })
  it("ensureContrast moves a colour only as far as needed", () => {
    expect(ensureContrast("#15803d", ["#ffffff"], 4.5)).toEqual({ color: "#15803d", adjusted: false, ok: true })
    const r = ensureContrast("#a1a1aa", ["#ffffff", "#f4f4f5"], 4.5)
    expect(r.adjusted).toBe(true)
    expect(contrast(r.color, "#f4f4f5")).toBeGreaterThanOrEqual(4.5)
    expect(r.ok).toBe(true)
  })
  it("ensureContrast says ok:false when neither black nor white reaches the ratio on every surface", () => {
    const r = ensureContrast("#888888", ["#777777", "#707070"], 4.5)
    expect(r).toMatchObject({ adjusted: true, ok: false })
    expect(["#000000", "#ffffff"]).toContain(r.color)
  })
})

describe("every preset passes contrast in both modes", () => {
  for (const [id, p] of Object.entries(PRESETS))
    for (const mode of MODES)
      it(`${id} ${mode}`, () => {
        const { tokens, adjusted } = buildTokens(p.spec, mode)
        expect(adjusted).toEqual([]) // presets are tuned by hand, never silently moved
        const fails = contrastPairs(tokens).filter((x) => x.ratio < x.min)
        expect(fails).toEqual([])
      })
  for (const base of Object.keys(BASES) as (keyof typeof BASES)[])
    for (const mode of MODES)
      it(`custom base ${base} ${mode} with a light accent still passes (adjusted)`, () => {
        const { tokens } = buildTokens(customSpec({ kind: "pick", base: base as any, accent: "#fde047" }), mode)
        expect(contrastPairs(tokens).filter((x) => x.ratio < x.min)).toEqual([])
      })
})

describe("tinted presets (Blossom, Mint)", () => {
  for (const id of ["blossom", "mint"] as const)
    for (const mode of MODES)
      it(`${id} ${mode}: primary controls are the accent, selected rows a wash of it`, () => {
        const spec = PRESETS[id].spec
        const t = buildTokens(spec, mode).tokens
        expect(t["--primary"]).toBe(t["--brand"])
        expect(t["--primary-foreground"]).toBe(t["--brand-foreground"])
        const hover = spec.base[mode].hover
        expect(t["--accent"]).not.toBe(hover)
        expect(t["--sidebar-accent"]).toBe(t["--accent"])
        // nearer the accent than the plain grey is, yet still a quiet surface
        expect(contrast(t["--accent"], t["--brand"])).toBeLessThan(contrast(hover, t["--brand"]))
        expect(contrast(t["--accent"], hover)).toBeLessThan(1.3)
      })
  it("Mission and Mono keep neutral primary and selected states", () => {
    for (const id of ["mission", "mono"] as const) {
      const t = buildTokens(PRESETS[id].spec, "light").tokens
      expect(t["--accent"]).toBe(PRESETS[id].spec.base.light.hover)
      expect(t["--primary"]).not.toBe(t["--brand"])
    }
  })
})

describe("globals.css defaults equal the Mission preset", () => {
  const css = readFileSync(join(import.meta.dirname, "../styles/globals.css"), "utf8")
  const block = (sel: string) => {
    const m = new RegExp(`\\n${sel.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css)
    return Object.fromEntries([...(m?.[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]))
  }
  for (const [mode, sel] of [["light", ":root"], ["dark", ".dark"]] as const)
    it(mode, () => {
      const want = buildTokens(PRESETS.mission.spec, mode).tokens
      const got = block(sel)
      for (const [k, v] of Object.entries(want)) expect([k, got[k]]).toEqual([k, v])
    })
})

const ITERM = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
${[
  ["Background Color", 0.11, 0.11, 0.13],
  ["Foreground Color", 0.85, 0.85, 0.85],
  ["Selection Color", 0.25, 0.25, 0.3],
  ["Ansi 1 Color", 0.5, 0.1, 0.1],
  ["Ansi 2 Color", 0.3, 0.8, 0.3],
  ["Ansi 3 Color", 0.9, 0.8, 0.2],
  ["Ansi 4 Color", 0.3, 0.5, 0.9],
  ["Ansi 8 Color", 0.4, 0.4, 0.4],
]
  .map(([k, r, g, b]) => `<key>${k}</key><dict><key>Blue Component</key><real>${b}</real><key>Green Component</key><real>${g}</real><key>Red Component</key><real>${r}</real></dict>`)
  .join("\n")}
</dict></plist>`

describe("iTerm2 import", () => {
  it("parses the plist and maps ANSI colours to statuses", () => {
    const c = parseItermColors(ITERM)
    expect(c["Background Color"]).toBe("#1c1c21")
    expect(c["Ansi 2 Color"]).toBe("#4dcc4d")
    const t = itermTheme("Test", c)
    expect(t.kind).toBe("iterm")
    if (t.kind !== "iterm") return
    const { tokens } = buildTokens(t.spec, "dark")
    expect(tokens["--running"]).toBe("#4dcc4d")
    expect(contrastPairs(tokens).filter((x) => x.ratio < x.min)).toEqual([])
    // dark red (Ansi 1) and the bright-black faint had to be lifted, and that is reported
    expect(t.warnings).toContain("--failed")
  })
  it("rejects a file that is not a colour preset", () => {
    expect(() => parseItermColors("<plist><dict></dict></plist>")).toThrow()
    expect(() => parseItermColors("not xml")).toThrow()
  })
})

describe("?theme= parameter", () => {
  it("accepts a mode, a preset, or preset-mode", () => {
    expect(parseThemeParam("light")).toEqual({ appearance: "light" })
    expect(parseThemeParam("blossom")).toEqual({ preset: "blossom", appearance: undefined })
    expect(parseThemeParam("mint-dark")).toEqual({ preset: "mint", appearance: "dark" })
    expect(parseThemeParam("bogus")).toEqual({})
  })
})

describe("storedTheme", () => {
  const custom = (v: string) => {
    localStorage.clear()
    localStorage.setItem(KEYS.custom, v)
    return storedTheme().custom
  }
  it("falls back to the default custom theme when the stored one is corrupt or the wrong shape", () => {
    expect(custom("{not json")).toEqual(DEFAULT_CUSTOM)
    expect(custom(JSON.stringify({ kind: "pick", base: "neutral", accent: "red" }))).toEqual(DEFAULT_CUSTOM)
    expect(custom(JSON.stringify({ kind: "pick", base: "lava", accent: "#ff0000" }))).toEqual(DEFAULT_CUSTOM)
    expect(custom(JSON.stringify({ kind: "iterm", name: "x", warnings: [], spec: {} }))).toEqual(DEFAULT_CUSTOM)
    const good = itermTheme("Solar", { "Background Color": "#002b36", "Foreground Color": "#eee8d5" })
    const bad = JSON.parse(JSON.stringify(good))
    bad.spec.base.dark.bg = "url(javascript:alert(1))"
    expect(custom(JSON.stringify(bad))).toEqual(DEFAULT_CUSTOM)
    expect(custom(JSON.stringify({ kind: "iterm" }))).toEqual(DEFAULT_CUSTOM)
    expect(custom("42")).toEqual(DEFAULT_CUSTOM)
  })
  it("keeps a valid stored custom theme", () => {
    expect(custom(JSON.stringify({ kind: "pick", base: "cool", accent: "#ffff00" }))).toEqual({ kind: "pick", base: "cool", accent: "#ffff00" })
    const good = itermTheme("Solar", { "Background Color": "#002b36", "Foreground Color": "#eee8d5" })
    expect(custom(JSON.stringify(good))).toEqual(good)
    localStorage.clear()
  })
})

describe("an iTerm theme on a mid-grey background", () => {
  it("lists the tokens that cannot reach contrast, and the picker shows them", async () => {
    const t = itermTheme("Grey", { "Background Color": "#777777", "Foreground Color": "#000000" })
    expect(t.kind === "iterm" && t.unmet?.length).toBeGreaterThan(0)
    expect(t.kind === "iterm" && t.unmet).toContain("--foreground")
    const ok = itermTheme("Solar", { "Background Color": "#002b36", "Foreground Color": "#eee8d5" })
    expect(ok.kind === "iterm" && ok.unmet).toBeUndefined()
  })
})
