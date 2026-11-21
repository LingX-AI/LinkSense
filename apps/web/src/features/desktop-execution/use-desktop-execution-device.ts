import { useDesktopDeviceStatus } from "@/features/desktop-devices/use-desktop-device-status"

import {
  desktopExecutionDeviceQueryAvailability,
  type DesktopExecutionDeviceAvailability,
} from "./desktop-execution-target"

/**
 * Resolve whether the current Mac can accept a local task. Readiness comes
 * from the native host: only a connected device whose host negotiated a live
 * execution link counts. A query error (including a failed background refetch
 * that retains stale data) and a missing executionReady both fail closed.
 */
export function useDesktopExecutionDevice(
  ownerId?: string
): DesktopExecutionDeviceAvailability {
  return desktopExecutionDeviceQueryAvailability(
    useDesktopDeviceStatus(ownerId)
  )
}
