import { useEffect, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { pair as pairApi, type PairResult } from "@/lib/remote"

const CMD = "mission-control remote pair"

type State = "pairing" | "expired" | "limited" | "offline"

/** The /pair page: reads #t=<token>, clears the fragment before the POST (C26), then goes to / on success. */
export function PairScreen({ pair = pairApi, onPaired = () => location.replace("/") }: { pair?: (token: string) => Promise<PairResult>; onPaired?: () => void }) {
  const [state, setState] = useState<State>("pairing")
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice; the fragment is already gone the second time
    started.current = true
    const token = new URLSearchParams(location.hash.replace(/^#/, "")).get("t")
    history.replaceState(null, "", location.pathname + location.search)
    if (!token) return setState("expired")
    void pair(token).then((r) => {
      if (r.kind === "ok") onPaired()
      else setState(r.kind === "limited" ? "limited" : r.kind === "offline" ? "offline" : "expired")
    })
  }, [pair, onPaired])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6 text-base">
      {state === "pairing" ? (
        <p role="status" className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          Pairing this phone…
        </p>
      ) : (
        <div role="alert" className="flex flex-col gap-3">
          <p className="font-semibold">
            {state === "expired" && "This pairing link expired or was already used. Run `mission-control remote pair` again."}
            {state === "limited" && "Too many attempts. Wait a minute and try again."}
            {state === "offline" && "Could not reach the server. Check the connection and scan the code again."}
          </p>
          {state === "expired" && <code className="rounded-lg border bg-card p-3 font-mono text-sm break-words">{CMD}</code>}
        </div>
      )}
    </main>
  )
}
