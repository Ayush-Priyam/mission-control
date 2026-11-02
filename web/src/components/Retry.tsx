import { Button } from "@/components/ui/button"

/** The recovery for any failed load: fetch again now (polls retry on their own too). */
export function Retry({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    <Button size="sm" variant="outline" onClick={onRetry} className={className}>
      Retry
    </Button>
  )
}
