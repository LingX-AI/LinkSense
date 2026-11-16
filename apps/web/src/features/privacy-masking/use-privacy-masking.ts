import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  privacyMaskingSettingsResponseSchema,
  type PrivacyMaskingSettings,
} from "@linksense/shared"

import { ApiError, apiRequest } from "@/api/client"

export const privacyMaskingQueryKey = [
  "me",
  "privacy-masking-settings",
] as const

export function usePrivacyMaskingSettings() {
  return useQuery({
    queryKey: privacyMaskingQueryKey,
    queryFn: ({ signal }) =>
      apiRequest("/me/privacy-masking-settings", {
        schema: privacyMaskingSettingsResponseSchema,
        signal,
      }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useUpdatePrivacyMaskingSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      expected_revision: number
      settings: PrivacyMaskingSettings
    }) =>
      apiRequest("/me/privacy-masking-settings", {
        method: "PUT",
        body: input,
        schema: privacyMaskingSettingsResponseSchema,
      }),
    onSuccess: (response) => {
      queryClient.setQueryData(privacyMaskingQueryKey, response)
    },
    onError: (error) => {
      if (error instanceof ApiError && error.errorCode === "CONFLICT") {
        void queryClient.invalidateQueries({ queryKey: privacyMaskingQueryKey })
      }
    },
  })
}
