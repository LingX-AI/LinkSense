import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import {
  requestComputerControl,
  type ComputerControlAction,
  type ComputerControlFailureCode,
  type ComputerControlOutcome,
  type ComputerControlScope,
} from "./computer-control-adapter"

const statusPollIntervalMs = 10_000

export type DesktopComputerControlScope = ComputerControlScope &
  Readonly<{ ownerId: string }>

export const desktopComputerControlQueryKey = (
  scope: DesktopComputerControlScope
) =>
  [
    "desktop-computer-control",
    scope.ownerId,
    scope.conversationId,
    scope.turnId,
    scope.deviceId,
  ] as const

function scopeKey(scope: DesktopComputerControlScope): string {
  return [
    scope.ownerId,
    scope.conversationId,
    scope.turnId,
    scope.deviceId,
  ].join("\u0000")
}

// A pause or stop closes local input before the host waits for the server, so
// these failures leave the native state uncertain even though the call failed.
// A renewal that times out, returns an unreadable result, fails to send, or is
// reported unavailable may also have closed input and started retiring the
// selection; native maps a malformed or ambiguous renewal acknowledgement to
// COMPUTER_UNAVAILABLE after it has already retired locally. Each such failure
// gets one read-only status refresh; the action itself is never retried. Known
// refusals such as busy, forbidden, and canceled leave the grant untouched and
// are not refreshed, and a renewal superseded by Stop loses ownership, so it
// cannot trigger a stale read.
const uncertainActionFailureCodes: ReadonlySet<ComputerControlFailureCode> =
  new Set(["timeout", "unavailable", "failed", "invalid_response"])

type ActionVariables = Readonly<{
  requestId: number
  action: ComputerControlAction
  signal: AbortSignal
  scope: DesktopComputerControlScope
}>

type CurrentRequest = Readonly<{
  id: number
  action: ComputerControlAction
  controller: AbortController
}>

/**
 * Owns the native Computer Control status query and one action at a time.
 * Status polling is read-only and never checks TCC. A result is applied only
 * while the account, conversation, turn, and device that produced it are still
 * current; a stale reply can therefore never activate controls for another
 * turn or account.
 */
export function useDesktopComputerControl(scope: DesktopComputerControlScope) {
  const queryClient = useQueryClient()
  const queryKey = desktopComputerControlQueryKey(scope)
  const currentScopeKey = scopeKey(scope)

  const [pendingAction, setPendingAction] =
    useState<ComputerControlAction | null>(null)
  const [feedback, setFeedback] = useState<ComputerControlFailureCode | null>(
    null
  )
  const currentRequestRef = useRef<CurrentRequest | null>(null)
  const nextRequestIdRef = useRef(0)
  const activeRef = useRef(true)
  // Every bridge call that has not settled, including a renewal that Stop
  // superseded. Unmount aborts all of them; Stop itself must not.
  const inFlightControllersRef = useRef<Map<number, AbortController>>(new Map())

  useEffect(() => {
    activeRef.current = true
    const controllers = inFlightControllersRef.current
    return () => {
      activeRef.current = false
      // Unmount is the only Web-owned cancellation. It also cancels the native
      // picker or wait behind each call.
      for (const controller of controllers.values()) {
        controller.abort()
      }
      controllers.clear()
      currentRequestRef.current = null
    }
  }, [])

  const status = useQuery({
    queryKey,
    queryFn: ({ signal }) => requestComputerControl(scope, "status", signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    // This read is a native bridge call on the local Mac, not a server
    // request. Go owns the real link state, so the WebView's online manager
    // must never pause status polling until a browser "reconnect".
    networkMode: "always",
    refetchInterval: (query) => {
      const data = query.state.data
      return data?.kind === "state" &&
        (data.state === "active" ||
          data.state === "paused" ||
          data.state === "retiring")
        ? statusPollIntervalMs
        : false
    },
    refetchIntervalInBackground: false,
  })

  const mutation = useMutation({
    // Pause and Stop close native input immediately and must reach IPC even
    // while the WebView reports offline; the default online mode would queue
    // them and replay them only after a reconnect.
    networkMode: "always",
    mutationFn: (
      variables: ActionVariables
    ): Promise<ComputerControlOutcome> => {
      // A request that lost ownership (Stop superseded a renewal) or was
      // canceled by unmount never reaches the bridge. Stop leaves a dispatched
      // renewal running so native can cancel it under its own lock; this
      // identity guard covers a renewal that had not dispatched yet.
      if (
        variables.signal.aborted ||
        currentRequestRef.current?.id !== variables.requestId
      ) {
        return Promise.resolve({ kind: "failure", code: "canceled" })
      }
      return requestComputerControl(
        variables.scope,
        variables.action,
        variables.signal
      )
    },
    onMutate: async () => {
      // A status read started before the action must not overwrite its result.
      // A superseding action rechecks ownership in mutationFn, so this late
      // continuation cannot revive the request it canceled.
      await queryClient.cancelQueries({ queryKey, exact: true })
    },
    onSuccess: (outcome, variables) => {
      if (!isCurrent(variables)) return
      if (outcome.kind === "state") {
        // onMutate cancels only reads already in flight. The 10 s poll can
        // start while a renewal or Stop waits up to 15 s for its native
        // acknowledgement, and native may snapshot the pre-action expiry for
        // that read. Cancel it synchronously before this manual write so its
        // ordinary fetch result cannot replace the acknowledged state when it
        // arrives.
        void queryClient.cancelQueries({ queryKey, exact: true })
        queryClient.setQueryData<ComputerControlOutcome>(queryKey, outcome)
        setFeedback(null)
        return
      }
      // A canceled picker or aborted call returns quietly to the polled state.
      if (outcome.code === "canceled") return
      setFeedback(outcome.code)
      const canReconcile =
        variables.action === "renew" ||
        variables.action === "pause" ||
        variables.action === "stop"
      if (canReconcile && uncertainActionFailureCodes.has(outcome.code)) {
        void queryClient.invalidateQueries({ queryKey, exact: true })
      }
    },
    onError: (_error, variables) => {
      if (isCurrent(variables)) setFeedback("failed")
    },
    onSettled: (_data, _error, variables) => {
      inFlightControllersRef.current.delete(variables.requestId)
      if (currentRequestRef.current?.id !== variables.requestId) return
      currentRequestRef.current = null
      if (activeRef.current && scopeKey(variables.scope) === currentScopeKey) {
        setPendingAction(null)
      }
    },
  })

  function isCurrent(variables: ActionVariables): boolean {
    return (
      activeRef.current &&
      scopeKey(variables.scope) === currentScopeKey &&
      !variables.signal.aborted &&
      currentRequestRef.current?.id === variables.requestId
    )
  }

  /**
   * Starts one action. Ownership is held by a single request identity, so a
   * stale settlement cannot clear a newer request. Only a Stop may supersede a
   * pending renewal: native input is already closed and Stop cancels that
   * exact wait, while every other action stays blocked. The superseded renewal
   * is not aborted here because MyGo sends a separate bridge cancel on abort,
   * which can reach native before Stop takes its lock and retire the selection
   * without ever sending the service revocation. Request identity suppresses
   * its late result instead, and unmount still aborts every bridge call.
   */
  function run(action: ComputerControlAction): boolean {
    const current = currentRequestRef.current
    if (current && (action !== "stop" || current.action !== "renew")) {
      return false
    }
    const controller = new AbortController()
    const request: CurrentRequest = {
      id: nextRequestIdRef.current++,
      action,
      controller,
    }
    inFlightControllersRef.current.set(request.id, controller)
    currentRequestRef.current = request
    setPendingAction(action)
    setFeedback(null)
    mutation.mutate({
      requestId: request.id,
      action,
      signal: controller.signal,
      scope,
    })
    return true
  }

  return {
    status,
    pendingAction,
    feedback,
    run,
    clearFeedback: () => setFeedback(null),
  }
}
