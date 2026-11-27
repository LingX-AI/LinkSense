import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useState } from "react"

import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import {
  answerDesktopCloudApproval,
  listDesktopCloudApprovals,
  subscribeDesktopCloudApproval,
  subscribeDesktopCloudApprovalSettled,
  type DesktopCloudApproval,
} from "@/adapters/desktop/desktop-device-adapter"

export const desktopCloudApprovalsQueryKey = [
  "desktop",
  "cloud-approvals",
] as const

/**
 * One live native approval for this conversation. The Mac owns the request
 * and the decision; the card only renders it and sends the person's answer.
 * Nothing is cached as server data and a settled request disappears.
 */
export function useCloudApproval(conversationId: string | null | undefined) {
  const queryClient = useQueryClient()
  const host = isMacDesktopHost()
  const [answeringId, setAnsweringId] = useState<string | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const query = useQuery({
    queryKey: desktopCloudApprovalsQueryKey,
    queryFn: listDesktopCloudApprovals,
    enabled: host,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })

  const remove = useCallback(
    (requestId: string) => {
      queryClient.setQueryData<DesktopCloudApproval[]>(
        desktopCloudApprovalsQueryKey,
        (current) => (current ?? []).filter((entry) => entry.id !== requestId)
      )
    },
    [queryClient]
  )

  useEffect(() => {
    if (!host) return
    const stopApproval = subscribeDesktopCloudApproval((approval) => {
      queryClient.setQueryData<DesktopCloudApproval[]>(
        desktopCloudApprovalsQueryKey,
        (current) => [
          ...(current ?? []).filter((entry) => entry.id !== approval.id),
          approval,
        ]
      )
    })
    const stopSettled =
      subscribeDesktopCloudApprovalSettled((requestId) => remove(requestId))
    return () => {
      stopApproval()
      stopSettled()
    }
  }, [host, queryClient, remove])

  const approval =
    query.data?.find(
      (entry) => entry.conversationId === conversationId
    ) ?? null
  // A warning belongs to the exact request that produced it.
  const failed = failedId !== null && failedId === approval?.id

  // The Mac settles the request at the same deadline; dropping the card here
  // keeps the UI honest even if the settle event is missed.
  useEffect(() => {
    if (!approval) return
    const delay = Date.parse(approval.expiresAt) - Date.now()
    if (delay <= 0) {
      remove(approval.id)
      return
    }
    const timer = window.setTimeout(() => remove(approval.id), delay + 500)
    return () => window.clearTimeout(timer)
  }, [approval, remove])

  const answer = useCallback(
    async (decision: "allow" | "deny") => {
      if (!approval || answeringId) return
      setAnsweringId(approval.id)
      setFailedId(null)
      try {
        await answerDesktopCloudApproval(approval.id, decision)
        remove(approval.id)
      } catch {
        // The Mac may have taken the answer but could not confirm it. Keep the
        // card up so the person sees the warning; the native deadline still
        // removes it, and retrying is refused once the request is gone.
        setFailedId(approval.id)
      } finally {
        setAnsweringId(null)
      }
    },
    [answeringId, approval, remove]
  )

  return {
    approval,
    answering: answeringId !== null,
    failed,
    answer,
  }
}
