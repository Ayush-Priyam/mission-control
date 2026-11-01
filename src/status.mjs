// The one "waiting on you" rule, shared by the trace, the adapters' run summaries and the page.
// Pure: no node: imports, so Node and the browser bundle load the same file.
//
// A run's current stop is its last `stop` event not followed by stage.start, human.input,
// run.resume or run.start. It waits on you when that stop's rule is "human"; any other rule
// (budget, stage-failed, …) is stopped, not waiting.

const CLEARS = new Set(["stage.start", "human.input", "run.resume", "run.start"])

/** The stop the run is on now (the event itself), or null. Events in file order. */
export function openStop(events) {
  let stop = null
  for (const e of events ?? []) {
    if (!e || typeof e !== "object") continue
    if (e.type === "stop") stop = e
    else if (CLEARS.has(e.type)) stop = null
  }
  return stop
}

/** True when the run's current stop is an owner stop (rule "human"). */
export const isWaiting = (events) => openStop(events)?.rule === "human"
