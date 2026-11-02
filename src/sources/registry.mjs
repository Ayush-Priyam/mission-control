const OVERVIEW_POOL = 6

/** One place that fans out over every source. Later tasks add sources by passing more to createRegistry. */
export function createRegistry(sources) {
  const byName = new Map()
  for (const s of sources) {
    // Two sources of one kind (two native dirs) keep distinct names: native, native-2, ...
    let name = s.name, n = 1
    while (byName.has(name)) name = `${s.name}-${++n}`
    byName.set(name, name === s.name ? s : { ...s, name })
  }
  const all = () => [...byName.values()]

  const errors = new Map() // source name -> last listItems failure
  // Requests that arrive together (overview, slim tree, items on one poll) share one listing.
  let listing = null
  function list() {
    listing ??= listAll().finally(() => { listing = null })
    return listing
  }
  async function listAll() {
    const lists = await Promise.all(
      all().map(async (s) => {
        try {
          const items = (await s.listItems()).map((i) => ({ ...i, source: s.name }))
          errors.delete(s.name)
          return items
        } catch (e) {
          errors.set(s.name, String(e?.message ?? e))
          return [] // one broken source must not hide the others
        }
      }),
    )
    return lists.flat().sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
  }

  async function get(source, id) {
    const s = byName.get(source)
    const item = s ? await s.getItem(id) : null
    return item ? { ...item, summary: { ...item.summary, source: s.name } } : null
  }

  /**
   * Status counts, what needs you, and what each live lane is doing now (newest first). `items`
   * (default: every item) lets the caller leave some out, such as hidden projects.
   */
  async function overview(items) {
    items ??= await list()
    const counts = { waiting: 0, working: 0, stopped: 0, done: 0 }
    for (const i of items) {
      if (i.status === "waiting") counts.waiting++
      else if (i.status === "working") counts.working++
      else if (i.status === "done") counts.done++
      else if (i.status === "stopped" || i.status === "failed") counts.stopped++
    }
    const where = (i) => ({ title: i.title, cwd: i.cwd ?? null, branch: i.branch ?? null, harness: i.harness, updatedAt: i.updatedAt ?? null, ...(i.project ? { project: i.project } : {}) })
    const needsYou = []
    const live = []
    const busy = items.filter((x) => x.status === "waiting" || x.live || x.status === "working")
    // Details load at most OVERVIEW_POOL at a time; results keep the list order.
    const details = new Array(busy.length)
    let next = 0
    await Promise.all(Array.from({ length: Math.min(OVERVIEW_POOL, busy.length) }, async () => {
      while (next < busy.length) {
        const k = next++
        try { details[k] = await get(busy[k].source, busy[k].id) } catch { details[k] = null }
      }
    }))
    for (const [k, i] of busy.entries()) {
      const d = details[k]
      if (i.status === "waiting") {
        const lane = d?.lanes.find((l) => l.status === "waiting")
        needsYou.push({ source: i.source, id: i.id, ...where(i), lane: lane?.id ?? "", detail: lane?.reason ?? "" })
      }
      for (const l of d?.lanes ?? []) {
        if (l.status !== "working") continue
        live.push({ source: i.source, id: i.id, ...where(i), lane: l.id, label: l.label, kind: l.kind, model: l.model ?? null, nowDoing: l.nowDoing ?? null, startedAt: l.startedAt ?? null })
      }
    }
    const at = (l) => String(l.nowDoing?.ts ?? l.startedAt ?? l.updatedAt ?? "")
    live.sort((a, b) => at(b).localeCompare(at(a)))
    return { counts, needsYou, live }
  }

  return {
    list,
    get,
    overview,
    sources: all,
    error: (name) => errors.get(name) ?? null,
    source: (name) => byName.get(name) ?? null,
    async calls(source, id, filter) {
      const s = byName.get(source)
      return s ? s.getCalls(id, filter ?? {}) : []
    },
    /** Chat turns of one lane; null when the source has no transcript turns or the item/lane is unknown. */
    async turns(source, id, lane, page) {
      const s = byName.get(source)
      return s?.getTurns ? s.getTurns(id, lane, page) : null
    },
    async session(source, id, name) {
      const s = byName.get(source)
      return s ? s.getSession(id, name) : null
    },
    /** True when every source that scans in the background has finished its first pass. */
    usageComplete: () => all().every((s) => !s.usageStatus || s.usageStatus().complete),
    async usage(range = {}) {
      const rows = await Promise.all(all().map((s) => (s.usage ? s.usage(range).catch(() => []) : [])))
      return rows.flat()
    },
  }
}
