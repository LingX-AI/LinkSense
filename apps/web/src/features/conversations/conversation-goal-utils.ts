import type { ThreadGoal } from "@/api/contracts"

export function formatGoalDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  if (safeSeconds < 60) return `${safeSeconds}s`
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`
}

export function projectGoalElapsedSeconds(
  goal: Pick<ThreadGoal, "status" | "time_used_seconds" | "updated_at">,
  nowMs: number
): number {
  const reportedSeconds = Math.max(0, Math.floor(goal.time_used_seconds))
  if (goal.status !== "active") return reportedSeconds

  const updatedAtMs = Date.parse(goal.updated_at)
  if (!Number.isFinite(updatedAtMs) || nowMs <= updatedAtMs) {
    return reportedSeconds
  }
  return reportedSeconds + Math.floor((nowMs - updatedAtMs) / 1_000)
}
