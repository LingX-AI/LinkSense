import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  connectionSettingsListSchema,
  type ConnectionProvider,
  type UpdateConnectionSettings,
} from "@linksense/shared"
import { ApiError, apiRequest } from "@/api/client"
import { connectionQueryKey } from "./api"

export const adminConnectionSettingsKey = [
  "admin",
  "connection-settings",
] as const

export function useAdminConnectionSettings() {
  return useQuery({
    queryKey: adminConnectionSettingsKey,
    queryFn: ({ signal }) =>
      apiRequest("/admin/connection-settings", {
        schema: connectionSettingsListSchema,
        signal,
      }),
  })
}

export function useUpdateConnectionSettings(provider: ConnectionProvider) {
  const client = useQueryClient()
  return useMutation({
    retry: false,
    mutationFn: (input: UpdateConnectionSettings) =>
      apiRequest(`/admin/connection-settings/${provider}`, {
        method: "PUT",
        body: input,
        schema: connectionSettingsListSchema,
      }),
    onSuccess: (items) => {
      client.setQueryData(adminConnectionSettingsKey, items)
      void client.invalidateQueries({ queryKey: connectionQueryKey })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.errorCode === "CONFLICT")
        void client.invalidateQueries({ queryKey: adminConnectionSettingsKey })
    },
  })
}
