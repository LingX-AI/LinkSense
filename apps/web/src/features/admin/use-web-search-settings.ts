import {
  webSearchSettingsSchema,
  webSearchSettingsUpdateResultSchema,
  webSearchSuccessSchema,
  type UpdateWebSearchSettings,
  type WebSearchRequest,
} from "@linksense/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/api/client"

export const webSearchSettingsQueryKey = [
  "admin",
  "web-search-settings",
] as const
export function useWebSearchSettings() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: webSearchSettingsQueryKey,
    queryFn: ({ signal }) =>
      apiRequest("/admin/web-search-settings", {
        schema: webSearchSettingsSchema,
        signal,
      }),
  })
  const save = useMutation({
    mutationFn: (body: UpdateWebSearchSettings) =>
      apiRequest("/admin/web-search-settings", {
        method: "PUT",
        body,
        schema: webSearchSettingsUpdateResultSchema,
      }),
    onSuccess: (result) =>
      client.setQueryData(webSearchSettingsQueryKey, result.settings),
    onError: () => {
      void client.invalidateQueries({ queryKey: webSearchSettingsQueryKey })
    },
  })
  const probe = useMutation({
    mutationFn: (body: {
      settings: UpdateWebSearchSettings
      request: WebSearchRequest
    }) =>
      apiRequest("/admin/web-search-settings/test-connection", {
        method: "POST",
        body,
        schema: webSearchSuccessSchema,
      }),
  })
  return { query, save, probe }
}
