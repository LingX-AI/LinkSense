import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  privacyMaskingPreviewResponseSchema,
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

export const privacyMaskingPreviewQueryKey = [
  ...privacyMaskingQueryKey,
  "preview",
] as const

/** The try-it box: the draft settings are the ones previewed. */
export function usePrivacyMaskingPreview(
  text: string,
  settings: PrivacyMaskingSettings
) {
  return useQuery({
    queryKey: [...privacyMaskingPreviewQueryKey, text, settings],
    queryFn: ({ signal }) =>
      apiRequest("/me/privacy-masking-settings/preview", {
        method: "POST",
        body: { text, settings },
        schema: privacyMaskingPreviewResponseSchema,
        signal,
      }),
    enabled: text.trim().length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
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
