// Shapes the extras routes return, normalised to one form per tab. Adapters differ
// (spec-kit's scan_diff vs a numstat-plus-?file= adapter), so every tab reads these helpers.

export type DiffFile = { file: string; add: number; del: number; binary: boolean; status?: string }
export type DiffList = {
  files: DiffFile[]
  /** How to get one file's patch: `file` asks `?file=`, `full` reads one whole-diff text (`?full=1`) and splits it. */
  patch: "file" | "full" | "none"
  base?: string
  repo?: string
  branch?: string
  error?: string
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** Either adapter's diff listing as one shape. Anything unreadable is an empty list (with `error` when one was given). */
export function normaliseDiff(raw: any): DiffList {
  if (!raw || typeof raw !== "object") return { files: [], patch: "none" }
  const list: any[] = Array.isArray(raw.files) ? raw.files : []
  const error = typeof raw.files?.error === "string" ? raw.files.error : typeof raw.error === "string" ? raw.error : undefined
  const files: DiffFile[] = list
    .map((f) => {
      const file = String(f?.file ?? f?.path ?? "")
      return { file, add: num(f?.add), del: num(f?.del), binary: f?.binary === true, ...(f?.status ? { status: String(f.status) } : {}) }
    })
    .filter((f) => f.file)
  // Ronin's listing names the repo and branch and serves patches per file; spec-kit's carries `path` rows and one text.
  const perFile = raw.repo !== undefined || raw.branch !== undefined || list.some((f) => f?.file !== undefined)
  const out: DiffList = { files, patch: !files.length ? "none" : perFile ? "file" : "full" }
  if (raw.base) out.base = String(raw.base)
  if (raw.repo) out.repo = String(raw.repo)
  if (raw.branch) out.branch = String(raw.branch)
  if (error) out.error = error
  return out
}

/** One file's section of a unified diff text (`diff --git a/x b/x` blocks), or "" when it is not in it. */
export function splitPatch(text: string, file: string): string {
  const blocks = String(text ?? "").split(/^(?=diff --git )/m)
  return blocks.find((b) => b.startsWith(`diff --git a/${file} b/`) || b.startsWith(`diff --git a/${file} `)) ?? ""
}

export type Task = { id?: string; lane?: string; done: boolean; text: string }

/** Tasks from either shape: an array of `{id, lane, done, text}` rows or `{items: [{done, text}]}`. */
export function normaliseTasks(raw: any): Task[] {
  const list: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : []
  return list
    .filter((t) => t && typeof t === "object")
    .map((t) => ({ ...(t.id ? { id: String(t.id) } : {}), ...(t.lane ? { lane: String(t.lane) } : {}), done: t.done === true, text: String(t.text ?? "") }))
}

export type QaRow = { id: string; status: string; evidence: string }

/** The latest `qa` event's rows (a report replaces the one before it); null when the run has none yet. */
export function qaRows(events: Record<string, any>[]): QaRow[] | null {
  let rows: any[] | null = null
  for (const e of events) if (e?.type === "qa" && Array.isArray(e.rows)) rows = e.rows
  return rows && rows.map((r) => ({ id: String(r?.id ?? ""), status: String(r?.status ?? ""), evidence: String(r?.evidence ?? "") }))
}

/** Which run tabs to offer: a tab shows only when its extra is listed; QA also when the run holds `qa` events. */
export function extraTabs(extras: string[], events: Record<string, any>[]): { board: boolean; qa: boolean; diff: boolean; docs: boolean } {
  return {
    board: extras.includes("tasks"),
    qa: extras.includes("qa") || qaRows(events) !== null,
    diff: extras.includes("diff"),
    docs: extras.includes("doc"),
  }
}
