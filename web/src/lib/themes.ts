import { contrast, ensureContrast, mix } from "@/lib/contrast"

/**
 * Themes: every preset is built from one base palette (surfaces and greys) plus an accent and a status
 * set, into the same semantic tokens (CSS custom properties). globals.css carries the Mission values as
 * the no-JS default; `applyTheme` writes the active preset's tokens on <html>, and the pre-paint script in
 * index.html re-applies the stored token map before first render.
 */

export type Mode = "light" | "dark"
export type Appearance = "system" | Mode
export type PresetId = "mission" | "blossom" | "mint" | "mono" | "custom"
export type BaseId = "neutral" | "warm" | "cool"

type Surface = { bg: string; card: string; muted: string; border: string; input: string; fg: string; mutedFg: string; faint: string; hover: string; sidebar: string }
/** `looping` is optional so custom themes stored before it existed stay valid (they take the default). */
type StatusSet = { running: string; needsYou: string; failed: string; consult: string; stopped: string; done: string; tool: string; llm: string; looping?: string }

export const BASES: Record<BaseId | "rose" | "mint", Record<Mode, Surface>> = {
  neutral: {
    light: { bg: "#ffffff", card: "#ffffff", muted: "#f4f4f5", border: "#e4e4e7", input: "#d4d4d8", fg: "#09090b", mutedFg: "#52525b", faint: "#6b6b74", hover: "#f4f4f5", sidebar: "#fafafa" },
    dark: { bg: "#09090b", card: "#111113", muted: "#18181b", border: "#27272a", input: "#3f3f46", fg: "#e4e4e7", mutedFg: "#a1a1aa", faint: "#8a8a93", hover: "#27272a", sidebar: "#0c0c0e" },
  },
  warm: {
    light: { bg: "#fcfbfa", card: "#ffffff", muted: "#f5f5f4", border: "#e7e5e4", input: "#d6d3d1", fg: "#0c0a09", mutedFg: "#57534e", faint: "#6f6964", hover: "#f5f5f4", sidebar: "#faf9f7" },
    dark: { bg: "#0c0a09", card: "#151311", muted: "#1c1917", border: "#292524", input: "#44403c", fg: "#e7e5e4", mutedFg: "#a8a29e", faint: "#8f8882", hover: "#292524", sidebar: "#100e0c" },
  },
  cool: {
    light: { bg: "#ffffff", card: "#ffffff", muted: "#f1f5f9", border: "#e2e8f0", input: "#cbd5e1", fg: "#020617", mutedFg: "#475569", faint: "#5f6d81", hover: "#f1f5f9", sidebar: "#f8fafc" },
    dark: { bg: "#020617", card: "#0b1120", muted: "#0f172a", border: "#1e293b", input: "#334155", fg: "#e2e8f0", mutedFg: "#94a3b8", faint: "#7f8ca3", hover: "#1e293b", sidebar: "#050a1a" },
  },
  rose: {
    light: { bg: "#fffbfc", card: "#ffffff", muted: "#fcf1f5", border: "#f3dbe5", input: "#e6c3d1", fg: "#1a0b12", mutedFg: "#5c4651", faint: "#77616c", hover: "#fcf1f5", sidebar: "#fff7fa" },
    dark: { bg: "#0d090b", card: "#151013", muted: "#1c1519", border: "#2e2228", input: "#47363f", fg: "#f0e6ea", mutedFg: "#b5a3ab", faint: "#978690", hover: "#2e2228", sidebar: "#110c0f" },
  },
  mint: {
    light: { bg: "#fbfdfc", card: "#ffffff", muted: "#eff7f3", border: "#d7eae1", input: "#bcd8ca", fg: "#04110c", mutedFg: "#45574f", faint: "#5f726a", hover: "#eff7f3", sidebar: "#f6fbf9" },
    dark: { bg: "#070b0a", card: "#0e1412", muted: "#141c19", border: "#22302b", input: "#34463f", fg: "#e2ece8", mutedFg: "#9fb2aa", faint: "#81948c", hover: "#22302b", sidebar: "#0a0f0d" },
  },
}

export const STATUS: Record<"color" | "mono", Record<Mode, StatusSet>> = {
  color: {
    light: { running: "#15803d", needsYou: "#b45309", failed: "#b91c1c", consult: "#0369a1", stopped: "#6b6b74", done: "#8a8a93", tool: "#0f766e", llm: "#6d5fd3", looping: "#a21caf" },
    dark: { running: "#22c55e", needsYou: "#f59e0b", failed: "#ef4444", consult: "#38bdf8", stopped: "#a1a1aa", done: "#6b6b74", tool: "#2dd4bf", llm: "#a78bfa", looping: "#e879f9" },
  },
  mono: {
    light: { running: "#27272a", needsYou: "#09090b", failed: "#3f3f46", consult: "#52525b", stopped: "#6b6b74", done: "#8a8a93", tool: "#3f3f46", llm: "#52525b", looping: "#44403c" },
    dark: { running: "#f4f4f5", needsYou: "#ffffff", failed: "#d4d4d8", consult: "#b4b4bb", stopped: "#a1a1aa", done: "#6b6b74", tool: "#d4d4d8", llm: "#b4b4bb", looping: "#e7e5e4" },
  },
}

const SERIES: Record<Mode, string[]> = {
  light: ["#6d5fd3", "#0f766e", "#1d4ed8", "#be185d", "#a16207", "#4d7c0f"],
  dark: ["#a78bfa", "#2dd4bf", "#60a5fa", "#f472b6", "#fbbf24", "#a3e635"],
}

/** `tint`: primary buttons take the accent, and selected/hover rows take a wash of it (Blossom, Mint). */
export type ThemeSpec = { base: Record<Mode, Surface>; accent: Record<Mode, string>; status: Record<Mode, StatusSet>; series?: Record<Mode, string[]>; shapes?: boolean; tint?: boolean }

export const PRESETS: Record<Exclude<PresetId, "custom">, { label: string; spec: ThemeSpec }> = {
  mission: { label: "Mission", spec: { base: BASES.neutral, accent: { light: "#18181b", dark: "#fafafa" }, status: STATUS.color } },
  blossom: { label: "Blossom", spec: { base: BASES.rose, accent: { light: "#be185d", dark: "#f472b6" }, status: STATUS.color, tint: true } },
  mint: { label: "Mint", spec: { base: BASES.mint, accent: { light: "#047857", dark: "#34d399" }, status: STATUS.color, tint: true } },
  mono: {
    label: "Mono",
    spec: {
      base: BASES.neutral,
      accent: { light: "#18181b", dark: "#fafafa" },
      status: STATUS.mono,
      series: { light: ["#18181b", "#3f3f46", "#52525b", "#6b6b74", "#8a8a93", "#a1a1aa"], dark: ["#fafafa", "#d4d4d8", "#b4b4bb", "#a1a1aa", "#8a8a93", "#71717a"] },
      shapes: true,
    },
  },
}
export const PRESET_IDS: PresetId[] = ["mission", "blossom", "mint", "mono", "custom"]

export type Tokens = Record<string, string>

/** Text tokens that must reach 4.5:1 on background, card and muted. */
export const TEXT_TOKENS = ["--foreground", "--muted-foreground", "--faint", "--running", "--needs-you", "--looping", "--failed", "--consult", "--stopped", "--tool", "--llm", "--brand"]
/** Non-text tokens (dots, focus ring) that must reach 3:1 on background and card. */
export const MARK_TOKENS = ["--done", "--focus", "--running", "--needs-you", "--looping", "--failed", "--consult", "--stopped"]
export const SURFACES = ["--background", "--card", "--muted"]

/**
 * The token map for one mode of a spec, contrast-checked; `adjusted` lists tokens that had to move and
 * `unmet` those that still fall short (no colour reaches the ratio on these surfaces).
 */
export function buildTokens(spec: ThemeSpec, mode: Mode): { tokens: Tokens; adjusted: string[]; unmet: string[] } {
  const s = spec.base[mode]
  const st = spec.status[mode]
  const adjusted: string[] = []
  const unmet: string[] = []
  const bgs = [s.bg, s.card, s.muted]
  const check = (name: string, r: ReturnType<typeof ensureContrast>) => {
    if (r.adjusted) adjusted.push(name)
    if (!r.ok) unmet.push(name)
    return r.color
  }
  const text = (name: string, c: string) => check(name, ensureContrast(c, bgs, 4.5))
  const mark = (name: string, c: string) => check(name, ensureContrast(c, [s.bg, s.card], 3))
  const brand = text("--brand", spec.accent[mode])
  const brandFg = contrast(brand, "#ffffff") >= contrast(brand, "#000000") ? "#ffffff" : "#09090b"
  const fg = text("--foreground", s.fg)
  const primary = spec.tint ? brand : mode === "dark" ? mix(fg, "#ffffff", 0.6) : mix(fg, "#000000", 0.2)
  const primaryFg = spec.tint ? brandFg : mode === "dark" ? s.bg : "#ffffff"
  // selected and hovered rows: the base's hover grey, washed with the accent on a tinted theme
  const selected = spec.tint ? mix(s.hover, brand, 0.12) : s.hover
  const focus = mark("--focus", mode === "dark" ? s.mutedFg : mix(s.mutedFg, s.fg, 0.4))
  const series = (spec.series ?? SERIES)[mode]
  const heatTop = brand
  const heat0 = mode === "dark" ? mix(s.muted, s.border, 0.5) : s.border
  const t: Tokens = {
    "--background": s.bg,
    "--foreground": fg,
    "--card": s.card,
    "--card-foreground": fg,
    "--popover": s.card,
    "--popover-foreground": fg,
    "--primary": primary,
    "--primary-foreground": primaryFg,
    "--secondary": s.hover,
    "--secondary-foreground": fg,
    "--muted": s.muted,
    "--muted-foreground": text("--muted-foreground", s.mutedFg),
    "--accent": selected,
    "--accent-foreground": fg,
    "--destructive": text("--failed", st.failed),
    "--border": s.border,
    "--input": s.input,
    "--ring": focus,
    "--focus": focus,
    "--brand": brand,
    "--brand-foreground": brandFg,
    "--surface": s.muted,
    "--faint": text("--faint", s.faint),
    "--running": text("--running", st.running),
    "--needs-you": text("--needs-you", st.needsYou),
    "--looping": text("--looping", st.looping ?? STATUS.color[mode].looping!),
    "--failed": text("--failed", st.failed),
    "--consult": text("--consult", st.consult),
    "--stopped": text("--stopped", st.stopped),
    "--done": mark("--done", st.done),
    "--tool": text("--tool", st.tool),
    "--llm": text("--llm", st.llm),
    "--heat-0": heat0,
    "--heat-1": mix(heat0, heatTop, 0.3),
    "--heat-2": mix(heat0, heatTop, 0.55),
    "--heat-3": mix(heat0, heatTop, 0.8),
    "--heat-4": heatTop,
    "--chart-other": mode === "dark" ? "#52525b" : "#a1a1aa",
    "--sidebar": s.sidebar,
    "--sidebar-foreground": mix(fg, s.mutedFg, 0.15),
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": primaryFg,
    "--sidebar-accent": selected,
    "--sidebar-accent-foreground": fg,
    "--sidebar-border": s.border,
    "--sidebar-ring": focus,
  }
  series.forEach((c, i) => (t[`--chart-${i + 1}`] = c))
  return { tokens: t, adjusted: [...new Set(adjusted)], unmet: [...new Set(unmet)] }
}

/** Every contrast pair a theme must meet, with its ratio. */
export function contrastPairs(t: Tokens): { fg: string; bg: string; ratio: number; min: number }[] {
  const out: { fg: string; bg: string; ratio: number; min: number }[] = []
  for (const f of TEXT_TOKENS) for (const b of SURFACES) out.push({ fg: f, bg: b, ratio: contrast(t[f], t[b]), min: 4.5 })
  for (const f of MARK_TOKENS) for (const b of ["--background", "--card"]) out.push({ fg: f, bg: b, ratio: contrast(t[f], t[b]), min: 3 })
  out.push({ fg: "--primary-foreground", bg: "--primary", ratio: contrast(t["--primary-foreground"], t["--primary"]), min: 4.5 })
  out.push({ fg: "--brand-foreground", bg: "--brand", ratio: contrast(t["--brand-foreground"], t["--brand"]), min: 4.5 })
  out.push({ fg: "--sidebar-foreground", bg: "--sidebar", ratio: contrast(t["--sidebar-foreground"], t["--sidebar"]), min: 4.5 })
  // text on a selected / hovered row
  for (const [f, b] of [["--accent-foreground", "--accent"], ["--sidebar-accent-foreground", "--sidebar-accent"]]) out.push({ fg: f, bg: b, ratio: contrast(t[f], t[b]), min: 4.5 })
  return out
}

// ---- Custom ------------------------------------------------------------------------------------

export type CustomTheme =
  | { kind: "pick"; base: BaseId; accent: string }
  | { kind: "iterm"; name: string; spec: ThemeSpec; warnings: string[]; /** tokens no colour could bring to contrast on this background */ unmet?: string[] }

export const DEFAULT_CUSTOM: CustomTheme = { kind: "pick", base: "neutral", accent: "#7c3aed" }

export function customSpec(c: CustomTheme): ThemeSpec {
  if (c.kind === "iterm") return c.spec
  return { base: BASES[c.base], accent: { light: c.accent, dark: c.accent }, status: STATUS.color }
}

/** iTerm2 `.itermcolors` (plist XML) → named #rrggbb colours. */
export function parseItermColors(xml: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(xml, "application/xml")
  if (doc.getElementsByTagName("parsererror").length) throw new Error("Not a valid .itermcolors file")
  const root = doc.querySelector("plist > dict")
  if (!root) throw new Error("Not a valid .itermcolors file")
  const out: Record<string, string> = {}
  const kids = Array.from(root.children)
  for (let i = 0; i < kids.length - 1; i++) {
    if (kids[i].tagName !== "key" || kids[i + 1].tagName !== "dict") continue
    const name = kids[i].textContent ?? ""
    const d = Array.from(kids[i + 1].children)
    const comp: Record<string, number> = {}
    for (let j = 0; j < d.length - 1; j++) if (d[j].tagName === "key") comp[d[j].textContent ?? ""] = Number(d[j + 1].textContent)
    const r = comp["Red Component"], g = comp["Green Component"], b = comp["Blue Component"]
    if ([r, g, b].every((v) => Number.isFinite(v))) out[name] = "#" + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")
  }
  if (!out["Background Color"] || !out["Foreground Color"]) throw new Error("No Background/Foreground colour in this file")
  return out
}

/**
 * An iTerm2 palette as a theme: Background/Foreground/Selection set the surfaces, ANSI green → working,
 * yellow → needs you, red → failed, blue → consult, bright black → muted. The file's own mode (dark or
 * light background) is used for both appearances; colours are moved just enough to keep contrast, and
 * each move is reported.
 */
export function itermTheme(name: string, c: Record<string, string>): CustomTheme {
  const bg = c["Background Color"]
  const fg = c["Foreground Color"]
  const dark = contrast(bg, "#000000") < contrast(bg, "#ffffff")
  const mode: Mode = dark ? "dark" : "light"
  const sel = c["Selection Color"] ?? mix(bg, fg, 0.15)
  const muted = mix(bg, fg, 0.06)
  const brightBlack = c["Ansi 8 Color"] ?? mix(bg, fg, 0.5)
  const surface: Surface = {
    bg,
    card: mix(bg, fg, 0.03),
    muted,
    border: mix(bg, fg, 0.14),
    input: mix(bg, fg, 0.24),
    fg,
    mutedFg: mix(brightBlack, fg, 0.35),
    faint: brightBlack,
    hover: sel,
    sidebar: mix(bg, dark ? "#000000" : "#ffffff", 0.2),
  }
  const base = STATUS.color[mode]
  const status: StatusSet = {
    ...base,
    running: c["Ansi 2 Color"] ?? base.running,
    needsYou: c["Ansi 3 Color"] ?? base.needsYou,
    failed: c["Ansi 1 Color"] ?? base.failed,
    consult: c["Ansi 4 Color"] ?? base.consult,
    stopped: brightBlack,
    done: brightBlack,
    tool: c["Ansi 6 Color"] ?? base.tool,
    llm: c["Ansi 5 Color"] ?? base.llm,
  }
  const spec: ThemeSpec = { base: { light: surface, dark: surface }, accent: { light: c["Cursor Color"] ?? status.consult, dark: c["Cursor Color"] ?? status.consult }, status: { light: status, dark: status } }
  const { adjusted: warnings, unmet } = buildTokens(spec, mode)
  return { kind: "iterm", name, spec, warnings, ...(unmet.length ? { unmet } : {}) }
}

// ---- Persistence + application ----------------------------------------------------------------

export const KEYS = { appearance: "mission-control-theme", preset: "mission-control-preset", custom: "mission-control-custom", vars: "mission-control-theme-vars" }

export function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
export function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v)
  } catch {}
}

export function specOf(preset: PresetId, custom: CustomTheme): ThemeSpec {
  return preset === "custom" ? customSpec(custom) : PRESETS[preset].spec
}

export const systemMode = (): Mode => (typeof matchMedia === "function" && !matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark")
export const resolveMode = (a: Appearance): Mode => (a === "system" ? systemMode() : a)

/** `?theme=` values: a mode (light|dark|system), a preset, or `<preset>-<mode>`. */
export function parseThemeParam(q: string | null): { appearance?: Appearance; preset?: PresetId } {
  if (!q) return {}
  const [a, b] = q.split("-")
  const isMode = (x: string | undefined): x is Appearance => x === "light" || x === "dark" || x === "system"
  const isPreset = (x: string | undefined): x is PresetId => !!x && (PRESET_IDS as string[]).includes(x)
  if (isMode(a)) return { appearance: a }
  if (isPreset(a)) return { preset: a, appearance: isMode(b) ? b : undefined }
  return {}
}

/** Write a spec's tokens for `mode` on <html>, and store both modes' maps (tagged with the preset) for the pre-paint script. */
export function applyTheme(spec: ThemeSpec, mode: Mode, preset: PresetId = "mission", root: HTMLElement = document.documentElement) {
  const light = buildTokens(spec, "light").tokens
  const dark = buildTokens(spec, "dark").tokens
  const t = mode === "dark" ? dark : light
  for (const [k, v] of Object.entries(t)) root.style.setProperty(k, v)
  root.classList.toggle("dark", mode === "dark")
  root.style.colorScheme = mode
  if (spec.shapes) root.setAttribute("data-shapes", "")
  else root.removeAttribute("data-shapes")
  root.setAttribute("data-preset", preset)
  write(KEYS.vars, JSON.stringify({ preset, light, dark, shapes: !!spec.shapes }))
}

const HEX = /^#[0-9a-f]{6}$/i
const isHex = (v: unknown): v is string => typeof v === "string" && HEX.test(v)
const SURFACE_KEYS: (keyof Surface)[] = ["bg", "card", "muted", "border", "input", "fg", "mutedFg", "faint", "hover", "sidebar"]
const STATUS_KEYS: (keyof StatusSet)[] = ["running", "needsYou", "failed", "consult", "stopped", "done", "tool", "llm"]
const allHex = (o: any, keys: string[]) => !!o && typeof o === "object" && keys.every((k) => isHex(o[k]))
const perMode = (o: any, ok: (v: any) => boolean) => !!o && typeof o === "object" && ok(o.light) && ok(o.dark)

/** A stored custom theme, checked field by field (every colour #rrggbb); null when anything is off. */
export function validCustom(c: any): CustomTheme | null {
  if (!c || typeof c !== "object") return null
  if (c.kind === "pick") return (["neutral", "warm", "cool"] as const).includes(c.base) && isHex(c.accent) ? { kind: "pick", base: c.base, accent: c.accent } : null
  const strings = (v: unknown) => Array.isArray(v) && v.every((w) => typeof w === "string")
  if (c.kind !== "iterm" || typeof c.name !== "string" || !strings(c.warnings) || (c.unmet !== undefined && !strings(c.unmet))) return null
  const sp = c.spec
  if (!sp || typeof sp !== "object") return null
  const ok =
    perMode(sp.base, (v) => allHex(v, SURFACE_KEYS)) &&
    perMode(sp.status, (v) => allHex(v, STATUS_KEYS)) &&
    perMode(sp.accent, isHex) &&
    (sp.series === undefined || perMode(sp.series, (v) => Array.isArray(v) && v.length > 0 && v.every(isHex))) &&
    (sp.shapes === undefined || typeof sp.shapes === "boolean")
  return ok ? (c as CustomTheme) : null
}

/** The stored appearance (default dark), preset (default mission) and custom theme (DEFAULT_CUSTOM when missing or corrupt). */
export function storedTheme(): { appearance: Appearance; preset: PresetId; custom: CustomTheme } {
  const a = read(KEYS.appearance)
  const p = read(KEYS.preset)
  let custom = DEFAULT_CUSTOM
  try {
    custom = validCustom(JSON.parse(read(KEYS.custom) ?? "null")) ?? DEFAULT_CUSTOM
  } catch {}
  return {
    appearance: a === "light" || a === "system" ? a : "dark",
    preset: p && (PRESET_IDS as string[]).includes(p) ? (p as PresetId) : "mission",
    custom,
  }
}

/** A preset's swatches for the picker: background, card, text, accent and the status colours. */
export function swatches(spec: ThemeSpec, mode: Mode): string[] {
  const t = buildTokens(spec, mode).tokens
  return ["--background", "--card", "--foreground", "--brand", "--running", "--needs-you", "--failed", "--consult"].map((k) => t[k])
}
