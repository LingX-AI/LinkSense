import { desktopModelProxyUrl, desktopRunCredentialsSchema, type ModelTokenPricing } from "@linksense/shared";
import type { StartTurnInput } from "../process-pool.js";

const unpricedOnDevice: ModelTokenPricing = {
  input_price_per_million: "0",
  cached_input_price_per_million: "0",
  output_price_per_million: "0",
};

/** Convert the device wire contract only at the private desktop runner boundary. */
export function desktopModelProviders(
  serverOrigin: string,
  raw: unknown,
): Pick<StartTurnInput, "model" | "modelProvider" | "modelTransitionSource"> {
  const { turn_id, primary, memory_extraction, transition_source } = desktopRunCredentialsSchema.parse(raw);
  return {
    model: primary.model,
    modelProvider: {
      revision: primary.revision,
      baseUrl: desktopModelProxyUrl(serverOrigin, turn_id, primary.purpose),
      protocolMode: primary.protocol_mode,
      apiKey: primary.token,
      ...(primary.context_window === undefined ? {} : { modelContextWindow: primary.context_window }),
      ...(primary.auto_compact_token_limit === undefined ? {} : { modelAutoCompactTokenLimit: primary.auto_compact_token_limit }),
      ...(primary.supports_image_input === undefined ? {} : { supportsImageInput: primary.supports_image_input }),
      ...(memory_extraction && {
        memoryExtraction: {
          model: memory_extraction.model,
          reasoningEffort: memory_extraction.reasoning_effort,
          baseUrl: desktopModelProxyUrl(serverOrigin, turn_id, memory_extraction.purpose),
          protocolMode: memory_extraction.protocol_mode,
          apiKey: memory_extraction.token,
          pricing: unpricedOnDevice,
        },
      }),
    },
    ...(transition_source && {
      modelTransitionSource: {
        model: transition_source.model,
        provider: {
          revision: transition_source.revision,
          baseUrl: desktopModelProxyUrl(serverOrigin, turn_id, transition_source.purpose),
          protocolMode: transition_source.protocol_mode,
          apiKey: transition_source.token,
          ...(transition_source.context_window === undefined ? {} : { modelContextWindow: transition_source.context_window }),
          ...(transition_source.auto_compact_token_limit === undefined ? {} : { modelAutoCompactTokenLimit: transition_source.auto_compact_token_limit }),
          ...(transition_source.supports_image_input === undefined ? {} : { supportsImageInput: transition_source.supports_image_input }),
        },
      },
    }),
  };
}
