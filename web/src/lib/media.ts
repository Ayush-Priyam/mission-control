import { useEffect, useState } from "react"

/** Whether a media query matches now, following changes live (false where matchMedia is missing). */
export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia === "function" && matchMedia(query).matches
  const [on, setOn] = useState(get)
  useEffect(() => {
    if (typeof matchMedia !== "function") return
    const m = matchMedia(query)
    const f = () => setOn(m.matches)
    f()
    m.addEventListener?.("change", f)
    return () => m.removeEventListener?.("change", f)
  }, [query])
  return on
}

/** Tailwind's breakpoints, for layout decisions made in code. */
export const BP = { lg: "(min-width: 1024px)", xl: "(min-width: 1280px)", "2xl": "(min-width: 1536px)" } as const

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
