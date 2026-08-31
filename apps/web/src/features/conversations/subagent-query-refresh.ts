import type { NativeSubAgentDetail } from "@/api/contracts"
import type { NativeSubAgentViewModel } from "@/features/conversations/native-subagent-activity"

const activeSubAgentStatuses = new Set([
  "pendingInit",
  "running",
  "started",
  "updated",
])

function isActiveSubAgentStatus(status: string | undefined) {
  return status !== undefined && activeSubAgentStatuses.has(status)
}

export function reconcileSubAgentDetailStatus(
  detailStatus: NativeSubAgentDetail["status"] | undefined,
  projectedStatus: NativeSubAgentViewModel["status"] | undefined
): NativeSubAgentViewModel["status"] {
  if (
    projectedStatus !== undefined &&
    isActiveSubAgentStatus(projectedStatus)
  ) {
    return projectedStatus
  }
  if (detailStatus !== undefined && isActiveSubAgentStatus(detailStatus)) {
    return detailStatus
  }
  return projectedStatus ?? detailStatus ?? "pendingInit"
}

export function subAgentDetailRefetchInterval(
  detailStatus: NativeSubAgentDetail["status"] | undefined,
  projectedStatus: NativeSubAgentViewModel["status"] | undefined
) {
  return isActiveSubAgentStatus(
    reconcileSubAgentDetailStatus(detailStatus, projectedStatus)
  )
    ? 1_500
    : false
}
