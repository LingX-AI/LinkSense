import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  samlAvailabilitySchema,
  samlSettingsSchema,
  samlStartResultSchema,
  type UpdateSamlSettings,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export const samlKeys = {
  status: ["saml", "status"] as const,
  settings: ["admin", "saml-authentication-settings"] as const,
}
export function useSamlStatus() {
  return useQuery({
    queryKey: samlKeys.status,
    queryFn: () =>
      apiRequest("/auth/saml/status", {
        schema: samlAvailabilitySchema,
        skipRefresh: true,
      }),
  })
}
export function useSamlSettings() {
  return useQuery({
    queryKey: samlKeys.settings,
    queryFn: () =>
      apiRequest("/admin/saml-authentication-settings", {
        schema: samlSettingsSchema,
      }),
  })
}
export function useUpdateSamlSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateSamlSettings) =>
      apiRequest("/admin/saml-authentication-settings", {
        method: "PUT",
        body,
        schema: samlSettingsSchema,
      }),
    onSuccess: async (data) => {
      client.setQueryData(samlKeys.settings, data)
      await client.invalidateQueries({ queryKey: samlKeys.status })
    },
  })
}
export function useSamlStart() {
  return useMutation({
    mutationFn: () =>
      apiRequest("/auth/saml/start", {
        method: "POST",
        schema: samlStartResultSchema,
        skipRefresh: true,
      }),
    onSuccess: ({ authorization_url }) =>
      window.location.assign(authorization_url),
  })
}
