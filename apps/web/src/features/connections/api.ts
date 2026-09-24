import {
  connectionAuthorizationSchema,
  connectionListSchema,
  type ConnectionProvider,
} from "@linksense/shared"
import { z } from "zod"
import { apiRequest } from "@/api/client"

export const connectionQueryKey = ["connections"] as const
export const connectionsApi = {
  list: () => apiRequest("/connections", { schema: connectionListSchema }),
  authorize: (provider: ConnectionProvider) =>
    apiRequest(`/connections/${provider}/authorize`, {
      method: "POST",
      schema: connectionAuthorizationSchema,
    }),
  disconnect: (provider: ConnectionProvider) =>
    apiRequest(`/connections/${provider}`, {
      method: "DELETE",
      schema: z.unknown(),
    }),
}
