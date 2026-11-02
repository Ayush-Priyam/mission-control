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

  async function list() {
    const lists = await Promise.all(
      all().map(async (s) => {
        try {
          return (await s.listItems()).map((i) => ({ ...i, source: s.name }))
        } catch {
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

  async function overview() {
    const items = await list()
    const counts = { waiting: 0, working: 0, stopped: 0, done: 0 }
    for (const i of items) {
      if (i.status === "waiting") counts.waiting++
      else if (i.status === "working") counts.working++
      else if (i.status === "done") counts.done++
      else if (i.status === "stopped" || i.status === "failed") counts.stopped++
    }
    const needsYou = []
    for (const i of items.filter((x) => x.status === "waiting")) {
      const full = await get(i.source, i.id)
      const lane = full?.lanes.find((l) => l.status === "waiting")
      needsYou.push({ source: i.source, id: i.id, title: i.title, lane: lane?.id ?? "", detail: lane?.reason ?? "" })
    }
    return { counts, needsYou }
  }

  return {
    list,
    get,
    overview,
    sources: all,
    source: (name) => byName.get(name) ?? null,
    async calls(source, id, filter) {
      const s = byName.get(source)
      return s ? s.getCalls(id, filter ?? {}) : []
    },
    async session(source, id, name) {
      const s = byName.get(source)
      return s ? s.getSession(id, name) : null
    },
    async usage(range = {}) {
      const rows = await Promise.all(all().map((s) => (s.usage ? s.usage(range).catch(() => []) : [])))
      return rows.flat()
    },
  }
}
