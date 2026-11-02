import { useEffect, useState } from "react"
import { useMedia } from "@/lib/media"
import { applyTheme, KEYS, parseThemeParam, specOf, storedTheme, write, type Appearance, type CustomTheme, type Mode, type PresetId } from "@/lib/themes"

/** The page's theme: appearance (system follows the OS live), preset and custom theme, applied and persisted. */
export function useTheme() {
  const [init] = useState(() => {
    const s = storedTheme()
    const q = parseThemeParam(typeof location === "undefined" ? null : new URLSearchParams(location.search).get("theme"))
    return { ...s, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)) } as ReturnType<typeof storedTheme>
  })
  const [appearance, setAppearance] = useState<Appearance>(init.appearance)
  const [preset, setPreset] = useState<PresetId>(init.preset)
  const [custom, setCustom] = useState<CustomTheme>(init.custom)
  const osDark = useMedia("(prefers-color-scheme: dark)")
  const mode: Mode = appearance === "system" ? (osDark ? "dark" : "light") : appearance

  useEffect(() => {
    applyTheme(specOf(preset, custom), mode, preset)
  }, [preset, custom, mode])
  useEffect(() => write(KEYS.appearance, appearance), [appearance])
  useEffect(() => write(KEYS.preset, preset), [preset])
  useEffect(() => write(KEYS.custom, JSON.stringify(custom)), [custom])

  return { appearance, setAppearance, preset, setPreset, custom, setCustom, mode }
}
export type ThemeState = ReturnType<typeof useTheme>
