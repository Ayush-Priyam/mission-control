import { useEffect, useId, useRef, useState, type ChangeEvent } from "react"
import { Check, Palette } from "lucide-react"
import type { ThemeState } from "@/lib/use-theme"
import { customSpec, itermTheme, parseItermColors, PRESETS, swatches, type Appearance, type BaseId, type PresetId } from "@/lib/themes"
import { cn } from "@/lib/utils"

const APPEARANCES: { id: Appearance; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
]
/** A real .itermcolors file is a few KB; anything past this is not one, so it is refused before it is read. */
export const MAX_ITERM_BYTES = 256 * 1024
const BASE_LABEL: Record<BaseId, string> = { warm: "Warm", neutral: "Neutral", cool: "Cool" }

function Swatches({ colors }: { colors: string[] }) {
  return (
    <span aria-hidden className="flex shrink-0 overflow-hidden rounded border">
      {colors.map((c, i) => (
        <i key={i} className="block h-4 w-2.5" style={{ background: c }} />
      ))}
    </span>
  )
}

/**
 * The top bar's theme button and its popover: appearance (System / Light / Dark), presets with a check on
 * the active one and a live swatch row each, and Custom (base + accent, or an iTerm2 .itermcolors import).
 */
export function ThemePicker({ theme }: { theme: ThemeState }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const { appearance, setAppearance, preset, setPreset, custom, setCustom, mode } = theme

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        button.current?.focus()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onDown)
    box.current?.querySelector<HTMLElement>("[aria-checked=true]")?.focus()
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onDown)
    }
  }, [open])

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    if (f.size > MAX_ITERM_BYTES) {
      setError(`That file is ${Math.ceil(f.size / 1024)} KB; an .itermcolors file is at most 256 KB.`)
      return
    }
    try {
      const t = itermTheme(f.name.replace(/\.itermcolors$/i, ""), parseItermColors(await f.text()))
      setError(null)
      setCustom(t)
      setPreset("custom")
    } catch (err: any) {
      setError(String(err?.message ?? err))
    }
  }

  const presets = Object.entries(PRESETS) as [Exclude<PresetId, "custom">, (typeof PRESETS)["mission"]][]
  const warnings = custom.kind === "iterm" ? custom.warnings : []

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Theme"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        className="grid size-8 place-items-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Palette className="size-4" />
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label="Theme" className="absolute top-10 right-0 z-50 flex w-72 flex-col gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-xl">
          <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 rounded-lg border p-0.5">
            {APPEARANCES.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={appearance === a.id}
                onClick={() => setAppearance(a.id)}
                className={cn("h-7 rounded-md text-xs text-muted-foreground hover:text-foreground", appearance === a.id && "bg-accent font-medium text-foreground")}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Theme preset" className="flex flex-col">
            {presets.map(([id, p]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={preset === id}
                onClick={() => setPreset(id)}
                className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent"
              >
                <Check aria-hidden className={cn("size-4 shrink-0", preset === id ? "opacity-100" : "opacity-0")} />
                <span className="flex-1 text-left">{p.label}</span>
                <Swatches colors={swatches(p.spec, mode)} />
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={preset === "custom"}
              onClick={() => setPreset("custom")}
              className="flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-accent"
            >
              <Check aria-hidden className={cn("size-4 shrink-0", preset === "custom" ? "opacity-100" : "opacity-0")} />
              <span className="flex-1 truncate text-left">Custom{custom.kind === "iterm" ? ` · ${custom.name}` : ""}</span>
              <Swatches colors={swatches(customSpec(custom), mode)} />
            </button>
          </div>
          {preset === "custom" && (
            <div className="flex flex-col gap-2 border-t pt-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-12 text-muted-foreground">Base</span>
                <div role="radiogroup" aria-label="Base" className="grid flex-1 grid-cols-3 rounded-md border p-0.5">
                  {(Object.keys(BASE_LABEL) as BaseId[]).map((b) => (
                    <button
                      key={b}
                      type="button"
                      role="radio"
                      aria-checked={custom.kind === "pick" && custom.base === b}
                      onClick={() => setCustom({ kind: "pick", base: b, accent: custom.kind === "pick" ? custom.accent : "#7c3aed" })}
                      className={cn("h-6 rounded text-muted-foreground hover:text-foreground", custom.kind === "pick" && custom.base === b && "bg-accent text-foreground")}
                    >
                      {BASE_LABEL[b]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2">
                <span className="w-12 text-muted-foreground">Accent</span>
                <input
                  type="color"
                  aria-label="Accent colour"
                  value={custom.kind === "pick" ? custom.accent : "#7c3aed"}
                  onChange={(e) => setCustom({ kind: "pick", base: custom.kind === "pick" ? custom.base : "neutral", accent: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border bg-transparent"
                />
                <span className="font-mono text-muted-foreground">{custom.kind === "pick" ? custom.accent : "from file"}</span>
              </label>
              <label className="flex h-8 cursor-pointer items-center justify-center rounded-md border hover:bg-accent focus-within:outline-2 focus-within:outline-focus">
                Import iTerm2 .itermcolors…
                <input type="file" accept=".itermcolors,application/xml,text/xml" onChange={(e) => void onFile(e)} className="sr-only" />
              </label>
              {error && <p role="alert" className="text-failed">{error}</p>}
              {warnings.length > 0 && (
                <p role="status" className="text-muted-foreground">
                  Adjusted for contrast: {warnings.map((w) => w.replace(/^--/, "")).join(", ")}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
