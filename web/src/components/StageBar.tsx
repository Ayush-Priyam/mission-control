import type { RunSummary } from "@/lib/api"

const COLOR: Record<string, string> = {
  done: "bg-foreground/35",
  running: "bg-running",
  stopped: "bg-needs-you",
  failed: "bg-failed",
}

export function StageBar({ stages }: { stages: RunSummary["stages"] }) {
  const entries = Object.entries(stages ?? {})
  if (!entries.length) return <div className="h-1.5 rounded-full bg-muted" aria-label="no stages yet" />
  return (
    <div className="flex h-1.5 gap-0.5" role="img" aria-label={entries.map(([n, s]) => `${n} ${s.status}`).join(", ")}>
      {entries.map(([name, s]) => (
        <span key={name} title={`${name}: ${s.status}`} className={`h-full flex-1 rounded-full ${COLOR[s.status] ?? "bg-muted"}`} />
      ))}
    </div>
  )
}
