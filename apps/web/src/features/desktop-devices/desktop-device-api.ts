import {
  desktopDeviceListSchema,
  desktopDeviceRenameInputSchema,
  desktopDeviceRenameResultSchema,
  desktopPairingSchema,
  type DesktopDevice,
} from "@linksense/shared"
import { z } from "zod"

import { apiRequest, type ApiRequestOptions } from "@/api/client"

const revokeDeviceResultSchema = z.strictObject({ revoked: z.literal(true) })

export const desktopDeviceKeys = {
  all: ["desktop-devices"] as const,
  list: (ownerId: string | undefined) => ["desktop-devices", ownerId] as const,
}

export function listDesktopDevices(
  signal?: AbortSignal
): Promise<DesktopDevice[]> {
  return apiRequest("/desktop/devices", {
    schema: desktopDeviceListSchema,
    signal,
  }).then((result) => result.items)
}

export function createDesktopPairing() {
  return apiRequest("/desktop/devices/pairing", {
    method: "POST",
    body: {},
    schema: desktopPairingSchema,
  })
}

export function renameDesktopDevice(id: string, name: string) {
  return apiRequest(`/desktop/devices/${id}`, {
    method: "PATCH",
    body: desktopDeviceRenameInputSchema.parse({ name }),
    schema: desktopDeviceRenameResultSchema,
  })
}

export function revokeDesktopDevice(
  id: string,
  options?: Pick<
    ApiRequestOptions<typeof revokeDeviceResultSchema>,
    "beforeAttempt" | "loginSessionBoundary" | "signal"
  >
): Promise<{ revoked: true }> {
  return apiRequest(`/desktop/devices/${id}`, {
    ...options,
    method: "DELETE",
    schema: revokeDeviceResultSchema,
  })
}
