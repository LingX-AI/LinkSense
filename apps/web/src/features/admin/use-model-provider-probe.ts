import { useId } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  discoverModelProviderResultSchema,
  modelProviderProbeInputSchema,
  testModelProviderConnectionInputSchema,
  testModelProviderConnectionResultSchema,
  type ModelProviderProbeInput,
  type TestModelProviderConnectionInput,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export function useDiscoverModels(
  input: ModelProviderProbeInput,
  enabled: boolean
) {
  const id = useId()
  return useQuery({
    // The keyed editor owns this result; draft API keys stay out of cache keys.
    queryKey: ["admin", "model-provider-discovery", id],
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: ({ signal }) =>
      apiRequest("/admin/model-provider-settings/discover", {
        method: "POST",
        body: modelProviderProbeInputSchema.parse(input),
        schema: discoverModelProviderResultSchema,
        signal,
      }),
  })
}

export function useTestModelConnection(
  input: TestModelProviderConnectionInput
) {
  return useMutation({
    mutationFn: () =>
      apiRequest("/admin/model-provider-settings/test-connection", {
        method: "POST",
        body: testModelProviderConnectionInputSchema.parse(input),
        schema: testModelProviderConnectionResultSchema,
      }),
  })
}
