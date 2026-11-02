import { compact, estMoney, OTHER, PALETTE, pct, totalTokens, type Group } from "@/lib/usage"

export type Slice = { key: string; label: string; tokens: number; cost: number; sessions: number; color: string }

/** Below this share of tokens a group is too thin to draw; it folds into "other". */
export const MIN_SHARE = 0.0005

/** Groups as bar slices by token share: the top `max` above MIN_SHARE keep a colour each, the rest fold into "other". */
export function slices(groups: Group[], max = PALETTE.length): Slice[] {
  const ranked = [...groups].map((g) => ({ g, t: totalTokens(g) })).filter((x) => x.t > 0 || x.g.cost > 0).sort((a, b) => b.t - a.t)
  const all = ranked.reduce((a, x) => a + x.t, 0)
  const shown = ranked.slice(0, max).filter((x) => all > 0 && x.t / all >= MIN_SHARE)
  const head: Slice[] = shown.map(({ g, t }, i) => ({ key: g.key, label: g.name ?? g.key, tokens: t, cost: g.cost, sessions: g.sessions, color: PALETTE[i] }))
  const rest = ranked.slice(shown.length)
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
          <i key={x.key} title={`${x.label}: ${pct(x.tokens, total)} · ${compact(x.tokens)} tokens · ${estMoney(x.cost)} (API list prices)`} style={{ flex: `0 1 ${(x.tokens / total) * 100}%`, background: x.color }} className="block h-full min-w-0" />
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
