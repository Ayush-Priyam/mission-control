import { WifiOff } from "lucide-react"
import { OFFLINE_TEXT } from "@/lib/remote"

export const OFFLINE_BANNER_ID = "mc-offline-banner"

/** Shown while the phone cannot answer (C30). Answer buttons point at it with aria-describedby. */
export function OfflineBanner({ offline }: { offline: boolean }) {
  if (!offline) return null
  return (
    <div id={OFFLINE_BANNER_ID} role="status" className="flex items-center gap-2 border-b border-failed/40 bg-card px-4 py-2 text-sm text-failed">
      <WifiOff className="size-4 shrink-0" aria-hidden />
      <span>{OFFLINE_TEXT}</span>
    </div>
  )
}
