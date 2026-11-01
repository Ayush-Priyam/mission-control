// Crew stats across runs, derived from events. Pure: no node: imports, so the page can reuse it.
// Keyed by stage and run names from run files, so every map is prototype-free ("__proto__" is a name).
const map = () => Object.create(null)
const blank = (status) => ({ status, rounds: 0, stops: 0, redo: 0, sent: 0 })

export function crewStats(runs) {
  const grid = map(), crew = map(), bounces = map()
  const agent = (s) => (crew[s] ??= { stage: s, sessions: 0, tokens: 0, cost: 0, rounds: 0, stops: 0, raised: 0, models: new Set(), runners: new Set(), runs: new Set() })
  for (const r of runs) {
    const g = (grid[r.id] = map())
    for (const [st, v] of Object.entries(r.state?.stages ?? {})) g[st] = blank(v?.status)
    for (const e of r.events ?? []) {
      if (!e.stage) continue
      const c = (g[e.stage] ??= blank("unknown"))
      if (e.type === "stage.start") { c.rounds++; agent(e.stage).rounds++; agent(e.stage).runs.add(r.id) }
      if (e.type === "stop") { c.stops++; agent(e.stage).stops++ }
      if (e.type === "issue") {
        agent(e.stage).raised++
        if (e.decision?.blocks) e.decision.owner === e.stage ? c.redo++ : c.sent++
        const o = e.decision?.owner
        if (o && e.decision?.blocks) { const k = `${e.stage}>${o}`; bounces[k] = (bounces[k] ?? 0) + 1 }
      }
      if (e.type === "session") {
        const a = agent(e.stage), t = e.tokens ?? {}
        a.sessions++
        a.cost += e.cost ?? 0
        a.tokens += (t.input_tokens ?? 0) + (t.cache_creation_input_tokens ?? 0) + (t.output_tokens ?? 0)
        if (e.model) a.models.add(e.model)
        if (e.runner) a.runners.add(e.runner)
        a.runs.add(r.id)
      }
    }
  }
  for (const a of Object.values(crew)) { a.models = [...a.models]; a.runners = [...a.runners]; a.runs = [...a.runs] }
  return { crew, bounces, grid }
}
