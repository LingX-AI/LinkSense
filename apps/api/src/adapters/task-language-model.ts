import type { ModelProviderProtocolMode } from "@linksense/shared"
import type { LanguageModel } from "ai"

import {
  createProviderLanguageModel,
  type ProviderLanguageModelOptions,
} from "./provider-language-model.js"

export type TaskLanguageModelRuntime = {
  model: string
  apiKey: string
  baseUrl: string
  protocolMode: ModelProviderProtocolMode
}

/** Task channels use the same Bearer-authenticated contract as the runner. */
export function createTaskLanguageModel(
  runtime: TaskLanguageModelRuntime,
  options: Pick<ProviderLanguageModelOptions, "fetch"> = {},
): LanguageModel {
  return createProviderLanguageModel({
    ...runtime,
    provider: "openai",
  }, options)
}
