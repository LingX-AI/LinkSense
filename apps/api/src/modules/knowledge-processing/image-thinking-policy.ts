import type {
  ImageThinkingStrategy,
  ImageUnderstandingProvider,
} from "@linksense/shared"

const FORCED_REASONING_MARKERS =
  /(?:^|[-_/])(reasoner|reasoning|thinking|qwq|r1|o1|o3|o4)(?:$|[-_/])/iu

export function resolveImageThinkingStrategy(input: {
  provider: ImageUnderstandingProvider
  model: string
}): ImageThinkingStrategy | null {
  const model = input.model.trim().toLowerCase()
  if (model === "" || FORCED_REASONING_MARKERS.test(model)) return null

  switch (input.provider) {
    case "openai":
    case "azure_openai":
      if (/^(?:gpt-4o|gpt-4\.1)(?:$|[-_.])/u.test(model)) {
        return "non_reasoning_model"
      }
      if (/^gpt-5\.1(?:$|[-_.])/u.test(model)) return "openai_none"
      return null
    case "anthropic":
      return /^claude(?:$|[-_.])/u.test(model)
        ? "anthropic_disabled"
        : null
    case "google":
    case "google_vertex":
      return /^gemini-2\.5-(?:flash|flash-lite)(?:$|[-_.])/u.test(model)
        ? "google_zero_budget"
        : null
    case "alibaba":
      return /^qwen(?:$|[0-9_.-])/u.test(model) ? "alibaba_disabled" : null
    case "deepseek":
      return /^deepseek-(?:chat|vl|vl2)(?:$|[-_.])/u.test(model)
        ? "deepseek_disabled"
        : null
    case "openrouter":
      return /^(?:(?:openai\/gpt-(?:4o|4\.1|5\.1))|(?:anthropic\/claude)|(?:google\/gemini-2\.5-(?:flash|flash-lite))|(?:qwen\/qwen)|(?:deepseek\/deepseek-(?:chat|vl|vl2))|(?:meta-llama\/llama-4)|(?:mistralai\/(?:pixtral|mistral-small-3\.1))|(?:x-ai\/grok-2-vision))(?:$|[-_.])/u.test(
        model,
      )
        ? "openrouter_none"
        : null
    case "openai_compatible":
      return /^qwen(?:$|[0-9_.-])/u.test(model)
        ? "vllm_qwen_disabled"
        : null
  }
}

export function hasReasoningEvidence(value: unknown): boolean {
  return inspect(value, new Set(), 0)
}

function inspect(
  value: unknown,
  seen: Set<object>,
  depth: number,
): boolean {
  if (depth > 8 || value === null || value === undefined) return false
  if (typeof value === "string") return value.trim() !== ""
  if (typeof value === "number") return Number.isFinite(value) && value > 0
  if (typeof value === "boolean") return value
  if (typeof value !== "object") return false
  if (seen.has(value)) return false
  seen.add(value)

  if (Array.isArray(value)) {
    return value.some((entry) => inspect(entry, seen, depth + 1))
  }
  for (const [key, entry] of Object.entries(value)) {
    if (
      /reason(?:ing)?|thought|thinking|reasoning[_-]?tokens?/iu.test(key) &&
      hasMeaningfulValue(entry, new Set(), depth + 1)
    ) {
      return true
    }
    if (
      typeof entry === "object" &&
      entry !== null &&
      inspect(entry, seen, depth + 1)
    ) {
      return true
    }
  }
  return false
}

function hasMeaningfulValue(
  value: unknown,
  seen: Set<object>,
  depth: number,
): boolean {
  if (depth > 8 || value === null || value === undefined) return false
  if (typeof value === "string") return value.trim() !== ""
  if (typeof value === "number") return Number.isFinite(value) && value > 0
  if (typeof value === "boolean") return value
  if (typeof value !== "object") return false
  if (seen.has(value)) return false
  seen.add(value)
  return Array.isArray(value)
    ? value.some((entry) => hasMeaningfulValue(entry, seen, depth + 1))
    : Object.values(value).some((entry) =>
        hasMeaningfulValue(entry, seen, depth + 1),
      )
}
