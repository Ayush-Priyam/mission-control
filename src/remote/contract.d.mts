// Types for the v2.3 remote-answering contract (contract.md C10–C19, C33–C43).
// The web page may import these; web/src/lib/remote.ts must match them exactly.

// ---- constants (contract.mjs) ----
export const DEVICE_COOKIE: "__Host-mc_device"
export const DEVICE_COOKIE_MAX_AGE: 31536000
export const ANSWER_REASONS: readonly AnswerReason[]
export const ERRORS: Readonly<{
  notPaired: "not paired"
  revoked: "device revoked"
  pairingInvalid: "pairing link expired or already used"
  tooManyAttempts: "too many attempts"
}>
export const REMOTE_EVENTS: readonly RemoteEventName[]
export const HEARTBEAT_SECONDS: 3
export const REMOTE_DEFAULTS: Readonly<{ enabled: false; port: 4330; waitSeconds: 120 }>
export const WAIT_SECONDS_MIN: 10
export const WAIT_SECONDS_MAX: 600
export const SERVER_HEARTBEAT_MS: 2000
export const SERVER_STALE_MS: 6000
export const PAIRING_TTL_MS: number
export const PAIR_FAILS_PER_MINUTE: 10
export const REMOTE_API_PATHS: readonly string[]
export const DASHBOARD_REMOTE_ROUTES: readonly { method: "GET" | "POST"; path: string }[]

// ---- shared scalars ----
/** ISO 8601 UTC string (C10). */
export type IsoTime = string
export type Harness = "claude-code" | "codex"
export type PromptKind = "permission" | "ask"
export type AnswerReason = "changed" | "answered" | "terminal" | "gone"
export type RemoteEventName = "changed" | "heartbeat"

// ---- API: remote listener (C11–C18) ----
export type Device = { id: string; label: string }

/** POST /api/remote/pair body (C11). */
export type PairRequest = { token: string }
/** 200 body of pair and of GET /api/remote/me (C11, C12). */
export type DeviceResponse = { device: Device }

export type ErrorBody = { error: string }
/** 401 bodies on cookie routes (C13). */
export type UnauthorizedBody = { error: "not paired" } | { error: "device revoked" }
/** 401 / 429 bodies on pair (C11). */
export type PairRefusalBody = { error: "pairing link expired or already used" } | { error: "too many attempts" }

export type AskOption = { label: string; description: string }
/** One AskUserQuestion question as sent to the phone; multiSelect is always false (C15). */
export type AskQuestion = { question: string; header: string; multiSelect: false; options: AskOption[] }

type EntryBase = {
  source: string
  id: string
  title: string
  project?: string
  lane: string
  tool: string
  /** Already masked, at most 120 characters (C14). */
  target: string
  /** Same type and value as the desktop Needs you entry's `since` (C10). */
  since: string
}
export type ReadOnlyEntry = EntryBase & { answerable: false }
export type PermissionEntry = EntryBase & { answerable: true; promptId: string; bind: string; kind: "permission" }
export type AskEntry = EntryBase & { answerable: true; promptId: string; bind: string; kind: "ask"; questions: AskQuestion[] }
/** C14/C15: promptId, bind, kind iff answerable; questions iff kind is "ask". */
export type Entry = ReadOnlyEntry | PermissionEntry | AskEntry

/** GET /api/remote/prompts 200 body; never null or 204 (C14). */
export type PromptsResponse = { prompts: Entry[] }

/** `{answers: {[question]: label}}`, exactly one listed label per question (C16). */
export type AskDecision = { answers: Record<string, string> }
export type Decision = "allow" | "deny" | AskDecision
/** POST /api/remote/answer body (C16). No "always allow" or updatedPermissions exists. */
export type AnswerRequest = { promptId: string; bind: string; decision: Decision }
export type AnswerOk = { ok: true }
/** 409 body (C17). Frontend treats an unknown reason as "gone". */
export type AnswerConflict = { error: string; reason: AnswerReason }

// ---- API: dashboard :4319 (C19, C38) ----
export type StatusDevice = { id: string; label: string; pairedAt: IsoTime; lastSeenAt: IsoTime | null }
/** GET /api/remote/status and 200 body of POST /api/remote/enabled, exactly (C19). */
export type RemoteStatus = {
  enabled: boolean
  host: string | null
  remotePort: number | null
  waitSeconds: number
  devices: StatusDevice[]
  pairing: { open: boolean; expiresAt: IsoTime | null }
}
/** POST /api/remote/enabled body, exactly (C38). */
export type SetEnabledRequest = { enabled: boolean }
/** 422 body (C37, C38). */
export type ValidationErrorBody = { error: string; key: "remote.host" | "remote.port" | "config.json" }

// ---- config (C36) ----
export type RemoteConfig = { enabled?: boolean; host?: string; port?: number; waitSeconds?: number }

// ---- on-disk files under <home>/.mission-control/remote/ (C33, C41, plan) ----
/** remote/server.json (C41). */
export type ServerFile = {
  pid: number
  port: number
  remotePort: number | null
  host: string | null
  waitSeconds: number
  enabled: boolean
  startedAt: IsoTime
}
/** remote/pairing.json: hash only, never the raw token. */
export type PairingFile = { tokenHash: string; expiresAt: IsoTime; usedAt: IsoTime | null }
export type StoredDevice = { id: string; label: string; secretHash: string; pairedAt: IsoTime; revokedAt?: IsoTime }
/** remote/devices.json. */
export type DevicesFile = { devices: StoredDevice[] }
/** Questions as the hook records them; may include multiSelect true (then not answerable). */
export type PendingQuestion = { question: string; header: string; multiSelect: boolean; options: AskOption[] }
/** remote/pending/<promptId>.json (FR-11). */
export type PendingFile = {
  promptId: string
  harness: Harness
  sessionId: string
  callId?: string
  kind: PromptKind
  tool: string
  target: string
  questions?: PendingQuestion[]
  askedAt: IsoTime
  bind: string
  pid: number
}
/** remote/pending/<promptId>.decision.json, written once (create-exclusive). */
export type DecisionFile =
  | { decision: Decision; device: string; ts: IsoTime }
  | { decision: "abandon"; ts: IsoTime }
/** remote/control/<uuid>.json written by `remote on|off` (C42). */
export type ControlRequest = { enabled: boolean; actor: "cli" }
/** remote/control/<uuid>.result.json (C42). */
export type ControlResult =
  | { ok: true; status: RemoteStatus }
  | { ok: false; error: string; key: ValidationErrorBody["key"] }

// ---- audit.jsonl lines (C34, C43) ----
export type AnswerAuditLine = {
  ts: IsoTime
  device: string
  promptId: string
  decision: "allow" | "deny" | "answer"
  tool: string
  targetHash: string
}
export type ToggleAuditLine = { ts: IsoTime; actor: "dashboard" | "cli"; action: "remote-on" | "remote-off" }
export type AuditLine = AnswerAuditLine | ToggleAuditLine
