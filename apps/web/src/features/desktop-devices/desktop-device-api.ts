import { z } from "zod"

import { apiRequest, type ApiRequestOptions } from "@/api/client"

const revokeDeviceResultSchema = z.strictObject({ revoked: z.literal(true) })

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
