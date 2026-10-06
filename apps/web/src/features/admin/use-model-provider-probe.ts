import { useMutation } from "@tanstack/react-query"
import {
  discoverModelProviderResultSchema,
  modelProviderProbeInputSchema,
  testModelProviderConnectionInputSchema,
  testModelProviderConnectionResultSchema,
  type ModelProviderProbeInput,
  type TestModelProviderConnectionInput,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export function useDiscoverModels(input: ModelProviderProbeInput) {
  return useMutation({
    mutationFn: () =>
      apiRequest("/admin/model-provider-settings/discover", {
        method: "POST",
        body: modelProviderProbeInputSchema.parse(input),
        schema: discoverModelProviderResultSchema,
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
