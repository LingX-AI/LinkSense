import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { ApiError, apiRequest } from "@/api/client"
import { completionNotificationFeedSchema } from "@/api/contracts"
import { useAuth } from "@/app/auth-state"

const TOKEN_QUOTA_REFRESH_INTERVAL_MS = 5_000
const REFRESHED_TURN_HISTORY_LIMIT = 1_000
let nextTokenQuotaRefreshQueryInstanceId = 0

export function TokenQuotaRefreshCenter() {
  const { status, user, refreshUser } = useAuth()
  const hasTokenQuota = Boolean(
    user?.token_quota?.total ||
    user?.token_quota?.weekly ||
    user?.token_quota?.monthly
  )

  if (status !== "authenticated" || !user || !hasTokenQuota) return null

  return (
    <ActiveTokenQuotaRefreshCenter
      key={user.id}
      userId={user.id}
      refreshUser={refreshUser}
    />
  )
}

function ActiveTokenQuotaRefreshCenter({
  userId,
  refreshUser,
}: {
  userId: string
  refreshUser: () => Promise<void>
}) {
  const [queryInstanceId] = useState(
    () => ++nextTokenQuotaRefreshQueryInstanceId
  )
  const cursorRef = useRef<string | null>(null)
  const refreshedTurnIdsRef = useRef(new Set<string>())
  const completionQuery = useQuery({
    queryKey: ["token-quota-refresh", userId, queryInstanceId],
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
    refetchInterval: TOKEN_QUOTA_REFRESH_INTERVAL_MS,
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
