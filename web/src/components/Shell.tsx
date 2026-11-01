import { useEffect, useState, type ReactNode } from "react"
import { Moon, Sun } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useCapabilities } from "@/lib/api"
import { useSharedRuns } from "@/lib/runs-context"
import { toHash, type Route } from "@/lib/route"

type Theme = "dark" | "light"
const KEY = "mission-control-theme"

function initialTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === "light" || v === "dark") return v
  } catch {}
  return "dark"
}

function Crumbs({ route }: { route: Route }) {
  const items: { label: string; to?: Route }[] = [{ label: "home", to: { view: "home" } }]
  if (route.view === "project") items.push({ label: route.repo })
  if (route.view === "run") items.push({ label: route.id })
  if (route.view === "agent") {
    items.push({ label: route.id, to: { view: "run", id: route.id, tab: "map" } }, { label: route.stage })
  }
  return (
    <nav className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap font-mono text-xs text-muted-foreground">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <i className="not-italic opacity-60">/</i>}
          {c.to && i < items.length - 1 ? (
            <a href={toHash(c.to)} className="hover:text-foreground">
              {c.label}
            </a>
          ) : (
            <span className="max-w-[280px] truncate text-foreground">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

/** The footer note: the page writes nothing unless the adapter declares actions. */
export const footerNote = (actions: string[] | undefined) =>
  `${actions?.length ? "read-only except your actions" : "read-only"} · local · 127.0.0.1`

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const caps = useCapabilities()
  const runs = useSharedRuns()
  const live = (runs.data ?? []).some((r) => r.live)

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    try {
      localStorage.setItem(KEY, theme)
    } catch {}
  }, [theme])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 items-center gap-4 border-b px-4">
        <a href="#/" className="text-sm font-extrabold tracking-tight">
          mission control
        </a>
        {caps.data && (
          <span className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
            {caps.data.adapter}
          </span>
        )}
        <Crumbs route={route} />
        <div className="ml-auto flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <span className={`size-2 rounded-full ${live ? "animate-pulse bg-running" : "bg-muted-foreground/40"}`} />
            {live ? "live" : "idle"}
          </span>
          <ToggleGroup
            value={[theme]}
            onValueChange={(v) => v[0] && setTheme(v[0] as Theme)}
            variant="outline"
            size="sm"
            aria-label="Theme"
          >
            <ToggleGroupItem value="light" aria-label="Light theme">
              <Sun />
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" aria-label="Dark theme">
              <Moon />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </header>
      <main className="flex-1 p-4">{children}</main>
      <footer className="border-t px-4 py-2 font-mono text-[11px] text-muted-foreground">
        {footerNote(caps.data?.actions)}
      </footer>
    </div>
  )
}
