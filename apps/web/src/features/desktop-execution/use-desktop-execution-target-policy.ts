import { useContext } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { BootstrapStatus } from "@/api/contracts"
import { BootstrapContext, bootstrapQueryKey } from "@/app/bootstrap-state"

import {
  desktopExecutionTargetPolicy,
  type DesktopExecutionTargetPolicy,
} from "./desktop-execution-target"

export type DesktopExecutionTargetPolicyState =
  DesktopExecutionTargetPolicy & {
    readLatest: () => DesktopExecutionTargetPolicy
  }

/**
 * Reads the rollout from the existing bootstrap context. The app always mounts
 * BootstrapProvider; a missing provider (focused fixtures, embed) carries the
 * same meaning as an absent initial bootstrap payload: legacy defaults.
 *
 * `readLatest` reads the BootstrapProvider query cache directly so a create can
 * re-check the rollout after an awaited native read without fetching or a timer.
 */
export function useDesktopExecutionTargetPolicy(): DesktopExecutionTargetPolicyState {
  const queryClient = useQueryClient()
  const bootstrap = useContext(BootstrapContext)?.bootstrap
  return {
    ...desktopExecutionTargetPolicy(bootstrap),
    readLatest: () =>
      desktopExecutionTargetPolicy(
        queryClient.getQueryData<BootstrapStatus>(bootstrapQueryKey) ?? bootstrap
      ),
  }
}
