import { compact, money, OTHER, PALETTE, pct, totalTokens, type Group } from "@/lib/usage-api"

export type Slice = { key: string; label: string; tokens: number; cost: number; sessions: number; color: string }

/** Groups as bar slices by token share: the top `max` keep a colour each, the rest fold into "other". */
export function slices(groups: Group[], max = PALETTE.length): Slice[] {
  const ranked = [...groups].map((g) => ({ g, t: totalTokens(g) })).filter((x) => x.t > 0 || x.g.cost > 0).sort((a, b) => b.t - a.t)
  const head = ranked.slice(0, max).map(({ g, t }, i) => ({ key: g.key, label: g.name ?? g.key, tokens: t, cost: g.cost, sessions: g.sessions, color: PALETTE[i] }))
  const rest = ranked.slice(max)
  if (rest.length)
    head.push({
      key: "(other)",
      label: `${rest.length} other`,
      tokens: rest.reduce((a, x) => a + x.t, 0),
      cost: rest.reduce((a, x) => a + x.g.cost, 0),
      sessions: rest.reduce((a, x) => a + x.g.sessions, 0),
      color: OTHER,
    })
  return head
}

/** A full-width bar split by share of tokens, with a legend under it. */
export function SplitBar({ groups, label }: { groups: Group[]; label: string }) {
  const s = slices(groups)
  const total = s.reduce((a, x) => a + x.tokens, 0)
  if (!total) return <div className="h-2 rounded-full bg-muted" aria-label={`No usage by ${label}`} />
  return (
    <div className="flex flex-col gap-3">
      <div role="img" aria-label={`Token share by ${label}`} className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted">
        {s.map((x) => (
          <i key={x.key} title={`${x.label}: ${pct(x.tokens, total)} · ${compact(x.tokens)} tokens · ${money(x.cost)}`} style={{ width: `${(x.tokens / total) * 100}%`, background: x.color }} className="block h-full min-w-[2px]" />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-xs">
        {s.map((x) => (
          <li key={x.key} className="flex items-center gap-1.5">
            <i className="inline-block size-2 rounded-[2px]" style={{ background: x.color }} />
            <span className="max-w-56 truncate text-muted-foreground" title={x.label}>{x.label}</span>
            <span>{pct(x.tokens, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
