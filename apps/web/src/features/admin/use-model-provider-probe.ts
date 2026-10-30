import { useEffect, useId, useRef } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  discoverModelProviderResultSchema,
  discoverImageGenerationModelsInputSchema,
  discoverVoiceTranscriptionModelsInputSchema,
  type DiscoverImageGenerationModelsInput,
  type DiscoverVoiceTranscriptionModelsInput,
  detectModelProviderProtocolInputSchema,
  detectModelProviderProtocolResultSchema,
  type DetectModelProviderProtocolInput,
  type DetectModelProviderProtocolResult,
  modelProviderProbeInputSchema,
  testModelProviderConnectionInputSchema,
  testModelProviderConnectionResultSchema,
  type ModelProviderProbeInput,
  type TestModelProviderConnectionInput,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"

export type ModelDiscoverySource =
  | { kind?: "chat"; input: ModelProviderProbeInput }
  | { kind: "image"; input: DiscoverImageGenerationModelsInput }
  | { kind: "voice"; input: DiscoverVoiceTranscriptionModelsInput }

export function useDetectModelProtocol(
  input: DetectModelProviderProtocolInput,
  onDetected: (
    result: Extract<DetectModelProviderProtocolResult, { status: "detected" }>
  ) => void
) {
  const controllerRef = useRef<AbortController | null>(null)
  const lastInputRef = useRef<string | null>(null)
  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: ({
      input,
      signal,
    }: {
      input: DetectModelProviderProtocolInput
      signal: AbortSignal
    }) =>
      apiRequest("/admin/model-provider-settings/detect-protocol", {
        method: "POST",
        body: input,
        signal,
        schema: detectModelProviderProtocolResultSchema,
      }),
  })
  useEffect(() => () => controllerRef.current?.abort(), [])

  function cancel() {
    controllerRef.current?.abort()
    controllerRef.current = null
    lastInputRef.current = null
    mutation.reset()
  }

  function detect(force = false) {
    const parsed = detectModelProviderProtocolInputSchema.safeParse(input)
    if (!parsed.success) return
    const signature = JSON.stringify({ ...parsed.data, protocol_mode: null })
    if (!force && signature === lastInputRef.current) return
    cancel()
    lastInputRef.current = signature
    const controller = new AbortController()
    controllerRef.current = controller
    mutation.mutate(
      { input: parsed.data, signal: controller.signal },
      {
        onSuccess(result) {
          if (
            controllerRef.current !== controller ||
            result.status !== "detected"
          )
            return
          lastInputRef.current = JSON.stringify({
            ...parsed.data,
            model_id: result.model_id,
            protocol_mode: null,
          })
          onDetected(result)
        },
      }
    )
  }

  return { ...mutation, detect, cancel }
}

export function useDiscoverModels(
  source: ModelDiscoverySource,
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
      source.kind === "image"
        ? apiRequest("/admin/image-generation-settings/discover", {
            method: "POST",
            body: discoverImageGenerationModelsInputSchema.parse(source.input),
            schema: discoverModelProviderResultSchema,
            signal,
          })
        : source.kind === "voice"
          ? apiRequest("/admin/voice-transcription-settings/discover", {
              method: "POST",
              body: discoverVoiceTranscriptionModelsInputSchema.parse(
                source.input
              ),
              schema: discoverModelProviderResultSchema,
              signal,
            })
          : apiRequest("/admin/model-provider-settings/discover", {
              method: "POST",
              body: modelProviderProbeInputSchema.parse(source.input),
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
