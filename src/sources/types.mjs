// Shared shapes for sources (JSDoc only; no runtime code).
//
// A source is anything that lists work items (runs, sessions) with lanes and calls. v1 adapters
// become sources through fromAdapter(); later sources (claude-code, ...) implement Source directly.

/**
 * @typedef {{ in: number, out: number, cacheRead: number, cacheWrite: number }} Tokens
 *
 * @typedef {Object} ItemSummary
 * @property {string} source
 * @property {string} id
 * @property {"run"|"session"} kind
 * @property {string} title
 * @property {string} harness
 * @property {string|null} cwd
 * @property {string|null} branch
 * @property {boolean} live
 * @property {"working"|"waiting"|"stopped"|"failed"|"done"|"idle"} status
 * @property {boolean} waiting
 * @property {string|null} startedAt
 * @property {string|null} updatedAt
 * @property {{ lanes: number, calls: number, errors: number }} counts
 * @property {Tokens} tokens
 * @property {number} cost
 *
 * @typedef {Object} Lane
 * @property {string} id
 * @property {string} label
 * @property {"main"|"subagent"|"stage"|"crew"} kind
 * @property {"working"|"waiting"|"stopped"|"failed"|"done"|"idle"} status
 * @property {string} [model]
 * @property {{ name: string, kind: string, summary: string, ts: string }} [nowDoing]
 * @property {string} [reason]
 * @property {number} calls
 * @property {number} errors
 * @property {Tokens} tokens
 * @property {number} cost
 * @property {string} [parent]
 * @property {string} [startedAt]
 * @property {string} [endedAt]
 *
 * @typedef {Object} Call
 * @property {string} id
 * @property {string} lane
 * @property {string} ts
 * @property {string} name
 * @property {"tool"|"mcp"|"skill"|"agent"} kind
 * @property {string} [server]
 * @property {string} summary
 * @property {unknown} [input]
 * @property {boolean} [ok]
 * @property {string} [error]
 * @property {number} [durationMs]
 * @property {unknown} [result]
 *
 * @typedef {Object} UsageRow
 * @property {string} day YYYY-MM-DD
 * @property {string} source
 * @property {string} harness
 * @property {string} project
 * @property {string} model
 * @property {number} in
 * @property {number} out
 * @property {number} cacheRead
 * @property {number} cacheWrite
 * @property {number} cost
 * @property {number} sessions
 *
 * @typedef {Object} Source
 * @property {string} name
 * @property {string} harness
 * @property {() => Promise<ItemSummary[]>} listItems
 * @property {(id: string) => Promise<{ summary: ItemSummary, lanes: Lane[], events: object[], state?: object }|null>} getItem
 * @property {(id: string, filter?: { lane?: string, kind?: string, q?: string }) => Promise<Call[]>} getCalls
 * @property {(id: string, name: string) => Promise<unknown>} getSession
 * @property {(range: { from?: string, to?: string }) => Promise<UsageRow[]>} [usage]
 * @property {Record<string, Function>} [extras]  keyed handlers: (id, searchParams) => { body, status?, type? }
 * @property {Record<string, Function>} [actions] keyed handlers: (id, body) => result
 * @property {() => { source?: string }} [describe]
 */

export {}
