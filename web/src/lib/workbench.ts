// The workbench tabs for one agent: what it made, in the order you would want to look.
// `art` is the artifacts listing (paths in the run folder; `git:` paths live on the run branch).

export type Section =
  | { title: string; kind: "md"; path: string }
  | { title: string; kind: "gallery"; prefix: string }
  | { title: string; kind: "device"; path: string }
  | { title: string; kind: "qa" }
  | { title: string; kind: "diff" }
  | { title: string; kind: "note"; text: string }

export const IMAGE = /\.(png|jpg|webp)$/
export const images = (art: string[], prefix: string) => art.filter((p) => p.startsWith(prefix) && IMAGE.test(p))
const base = (p: string) => p.split("/").pop() ?? p
const seq = (p: string) => Number(/-(\d+)\.md$/.exec(p)?.[1] ?? 0)

export function latestSession(art: string[], k: string): string | undefined {
  return art.filter((p) => p.startsWith(`sessions/${k}-`)).sort((a, b) => seq(a) - seq(b)).at(-1)
}

export function sections(k: string, art: string[]): Section[] {
  const out: Section[] = []
  const md = (title: string, path: string) => art.includes(path) && out.push({ title, kind: "md", path })
  const session = (label = "last session") => {
    const s = latestSession(art, k)
    if (s) out.push({ title: label === "last session" && seq(s) ? `last session (${seq(s)})` : label, kind: "md", path: s })
  }
  const frames = images(art, "design/")
  if (k === "prep") md("architecture map", "map/architecture.md")
  if (k === "product") md("product note", "product-note.md")
  if (k === "architect") {
    md("contract", "spec/contract.md"); md("cross-lane tests", "spec/cross-lane-tests.md"); md("amendments", "spec/amendments.md")
    session()
  }
  if (k === "spec") for (const p of art.filter((p) => /(^spec\/|^git:.*specs\/).*\.md$/.test(p))) out.push({ title: base(p), kind: "md", path: p })
  if (k === "design") {
    if (frames.length) out.push({ title: `frames (${frames.length})`, kind: "gallery", prefix: "design/" })
    md("directions", "design/directions.md"); md("notes", "design/notes.md"); session()
  }
  if (k === "backend" || k === "frontend") {
    out.push({ title: "code", kind: "diff" })
    if (k === "frontend" && art.includes("app/preview.png")) out.push({ title: "on device", kind: "device", path: "app/preview.png" })
    session()
  }
  if (k === "qa") { out.push({ title: "report card", kind: "qa" }); md("qa notes", "qa.md"); session() }
  if (k === "review") { md("review", "review.md"); md("run report", "report.md"); session() }
  if (k === "orch") md("run report", "report.md")
  if (!out.length) out.push({ title: "about", kind: "note", text: "Nothing made yet." })
  return out
}

/** Which files a coder's "code" tab shows when no edit calls name them: the harness's own files never, UI paths by lane. */
export function laneFilter(k: string): (file: string) => boolean {
  const own = /^(\.harness|specs)\//, ui = /(composeApp|androidApp|iosApp|\/ui\/|Screen|Theme|Component)/
  return (f) => !own.test(f) && (k === "frontend" ? ui.test(f) : !ui.test(f))
}
