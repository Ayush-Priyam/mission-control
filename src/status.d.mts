// Types for status.mjs, for the web page (which imports it directly).
export type StopEvent = { type: "stop"; stage?: string; rule?: string; detail?: string; ts?: string; [k: string]: unknown }
export function openStop(events: readonly object[] | null | undefined): StopEvent | null
export function isWaiting(events: readonly object[] | null | undefined): boolean
