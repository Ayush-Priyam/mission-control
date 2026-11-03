import { useCallback, useEffect, useRef, useState } from "react"
import { answer as answerApi, me as meApi, prompts as promptsApi, useOnline, type AnswerResult, type Decision, type Entry, type MeResult, type PromptsResult } from "@/lib/remote"
import { NotifyButton } from "./NotifyButton"
import { OfflineBanner } from "./OfflineBanner"
import { PairScreen } from "./PairScreen"
import { PromptList } from "./PromptList"

const CMD = "mission-control remote pair"

export type RemoteApi = {
  me: () => Promise<MeResult>
  prompts: () => Promise<PromptsResult>
  answer: (promptId: string, bind: string, decision: Decision) => Promise<AnswerResult>
}
const REAL: RemoteApi = { me: () => meApi(), prompts: () => promptsApi(), answer: (p, b, d) => answerApi(p, b, d) }

/** Not paired / revoked (C25). Revoked also clears the list from memory because the queue is unmounted. */
export function AuthScreen({ kind }: { kind: "not-paired" | "revoked" }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-base">
      {kind === "revoked" ? (
        <>
          <p role="alert" className="font-semibold">This device was revoked. Pair again.</p>
          <code className="rounded-lg border bg-card p-3 font-mono text-sm break-words">{CMD}</code>
        </>
      ) : (
        <p role="alert" className="font-semibold">
          Run <code className="rounded border bg-card px-1.5 py-0.5 font-mono text-sm">{CMD}</code> on your computer.
        </p>
      )}
    </main>
  )
}

/** The signed-in phone page: fetches prompts, re-fetches on `changed` and when coming back online. */
function Queue({ api, onAuth, makeEventSource }: { api: RemoteApi; onAuth: (k: "revoked" | "not-paired") => void; makeEventSource?: (u: string) => EventSource }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)
  useEffect(() => () => void (alive.current = false), [])

  const refresh = useCallback(async () => {
    const r = await api.prompts()
    if (!alive.current) return
    if (r.kind === "ok") {
      setEntries(r.prompts)
      setFailed(false)
    } else if (r.kind === "offline") setFailed(true)
    else onAuth(r.kind)
  }, [api, onAuth])

  const online = useOnline(() => void refresh(), makeEventSource)
  useEffect(() => void refresh(), [refresh])
  const was = useRef(online)
  useEffect(() => {
    if (online && !was.current) void refresh()
    was.current = online
  }, [online, refresh])

  return (
    <>
      <OfflineBanner offline={!online || (failed && entries === null)} />
      <div className="mx-auto w-full max-w-md px-4 pt-3">
        <NotifyButton />
      </div>
      <PromptList entries={entries} online={online} answer={api.answer} onAuth={onAuth} failed={failed} />
    </>
  )
}

export function RemoteApp({ api = REAL, makeEventSource }: { api?: RemoteApi; makeEventSource?: (u: string) => EventSource }) {
  const onPair = location.pathname === "/pair"
  const [auth, setAuth] = useState<"loading" | "ok" | "not-paired" | "revoked">("loading")

  useEffect(() => {
    if (onPair) return
    let dead = false
    const load = () =>
      api.me().then((r) => {
        if (dead) return
        if (r.kind === "ok") setAuth("ok")
        else if (r.kind === "offline") setAuth("ok") // already paired as far as we know; the list shows the offline banner
        else setAuth(r.kind)
      })
    void load()
    return () => void (dead = true)
  }, [api, onPair])

  if (onPair) return <PairScreen />
  if (auth === "loading") return <PromptList entries={null} online answer={api.answer} onAuth={setAuth} />
  if (auth !== "ok") return <AuthScreen kind={auth} />
  return <Queue api={api} onAuth={setAuth} makeEventSource={makeEventSource} />
}
