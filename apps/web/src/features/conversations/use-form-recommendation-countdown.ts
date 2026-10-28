import { useEffect, useState } from "react"
import dayjs from "dayjs"
import type { ConversationUserInputRequest } from "@/api/contracts"

export function useFormRecommendationCountdown(
  request: Extract<ConversationUserInputRequest, { kind: "form" }>
): number | null {
  const [now, setNow] = useState(() => dayjs().valueOf())
  const deadline =
    request.waiting_policy?.kind === "optional" &&
    (request.status === "pending" || request.status === "answering")
      ? request.auto_resolve_at
      : null
  useEffect(() => {
    if (!deadline) return
    const timer = window.setInterval(() => setNow(dayjs().valueOf()), 1_000)
    return () => window.clearInterval(timer)
  }, [deadline])
  return deadline
    ? Math.max(0, Math.ceil(dayjs(deadline).diff(dayjs(now)) / 1_000))
    : null
}
