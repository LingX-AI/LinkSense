import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { ApiError, apiRequest } from "@/api/client"
import { completionNotificationFeedSchema } from "@/api/contracts"
import { useAuth } from "@/app/auth-state"

const CREDIT_QUOTA_REFRESH_INTERVAL_MS = 5_000
const REFRESHED_TURN_HISTORY_LIMIT = 1_000
let nextCreditQuotaRefreshQueryInstanceId = 0

export function CreditQuotaRefreshCenter() {
  const { status, user, refreshUser } = useAuth()
  const hasCreditQuota = Boolean(user?.credit_quota?.weekly)

  if (status !== "authenticated" || !user || !hasCreditQuota) return null

  return (
    <ActiveCreditQuotaRefreshCenter
      key={user.id}
      userId={user.id}
      refreshUser={refreshUser}
    />
  )
}

function ActiveCreditQuotaRefreshCenter({
  userId,
  refreshUser,
}: {
  userId: string
  refreshUser: () => Promise<void>
}) {
  const [queryInstanceId] = useState(
    () => ++nextCreditQuotaRefreshQueryInstanceId
  )
  const cursorRef = useRef<string | null>(null)
  const refreshedTurnIdsRef = useRef(new Set<string>())
  const completionQuery = useQuery({
    queryKey: ["credit-quota-refresh", userId, queryInstanceId],
    queryFn: async ({ signal }) => {
      const requestedCursor = cursorRef.current
      try {
        const feed = await apiRequest("/completion-notifications", {
          schema: completionNotificationFeedSchema,
          query: {
            ...(requestedCursor ? { cursor: requestedCursor } : {}),
            limit: 100,
          },
          signal,
        })
        cursorRef.current = feed.next_cursor
        return { feed, requestedCursor }
      } catch (error) {
        if (
          requestedCursor &&
          error instanceof ApiError &&
          error.status === 400
        ) {
          cursorRef.current = null
        }
        throw error
      }
    },
    gcTime: 0,
    refetchInterval: CREDIT_QUOTA_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: true,
  })
  const { data: completionData, refetch } = completionQuery

  useEffect(() => {
    if (!completionData) return
    if (completionData.requestedCursor === null) {
      void refetch()
      return
    }

    const refreshedTurnIds = refreshedTurnIdsRef.current
    let hasNewTerminalTurn = false
    for (const item of completionData.feed.items) {
      if (refreshedTurnIds.has(item.turn_id)) continue
      refreshedTurnIds.add(item.turn_id)
      hasNewTerminalTurn = true
    }
    trimTurnHistory(refreshedTurnIds)

    if (hasNewTerminalTurn) void refreshUser().catch(() => undefined)
  }, [completionData, refetch, refreshUser])

  return null
}

function trimTurnHistory(turnIds: Set<string>) {
  while (turnIds.size > REFRESHED_TURN_HISTORY_LIMIT) {
    const oldestTurnId = turnIds.values().next().value
    if (!oldestTurnId) return
    turnIds.delete(oldestTurnId)
  }
}
