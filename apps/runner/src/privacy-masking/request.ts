import type { PrivacyMaskHit, PrivacyMasker, MaskContext } from "./masker.js";

type JsonObject = Record<string, unknown>;

/**
 * Structural fields a model reads as instructions about the request rather
 * than as conversation text: masking them changes the protocol or breaks a
 * tool. Their values go to the vendor unchanged.
 */
const keptKeys = new Set([
  "model",
  "type",
  "role",
  "id",
  "ids",
  "name",
  "namespace",
  "server_label",
  "server_name",
  "call_id",
  "tool_call_id",
  "item_id",
  "previous_response_id",
  "prompt_cache_key",
  "prompt_cache_retention",
  "stream",
  "store",
  "include",
  "tool_choice",
  "parallel_tool_calls",
  "temperature",
  "top_p",
  "max_output_tokens",
  "truncation",
  "background",
  "service_tier",
  "safety_identifier",
  "user",
  "client_metadata",
  "conversation",
  "status",
  "object",
  "event",
  "finish_reason",
  "stop_reason",
  "effort",
  "reasoning_effort",
  "media_type",
  "mime_type",
  "file_id",
  "url",
  "image_url",
  "encrypted_content",
  "signature",
  "thought_signature",
  "obfuscation",
  "strict",
]);

/**
 * Values defined by the agent for the vendor to read as structure: tool
 * schemas, grammars, output formats and the choice among tools. Only a
 * description inside them is masked.
 */
const keptSubtrees = new Set([
  "parameters",
  "format",
  "response_format",
  "text",
  "reasoning",
  "tool_config",
  "generation_config",
  "stream_options",
  "additional_tools",
  "tool_search_output",
  "allowed_tools",
]);

function isIdKey(key: string): boolean {
  return (
    key === "id" ||
    key === "ids" ||
    key.endsWith("_id") ||
    key.endsWith("_ids") ||
    key.endsWith("Id") ||
    key.endsWith("Ids")
  );
}

function isOpaqueValue(value: string): boolean {
  if (value.startsWith("data:")) return true;
  // Images, archives and other long unbroken payloads have no useful text.
  return value.length > 8_192 && !/\s/u.test(value);
}

/**
 * Returns a copy of the request with free text replaced by placeholders.
 * Ids, tool names, schemas and sealed values stay as they are so Codex and
 * the provider keep matching them.
 */
export function maskResponsesRequest(
  body: JsonObject,
  masker: PrivacyMasker,
): PrivacyMaskHit[] {
  const hits: PrivacyMaskHit[] = [];
  const mask = (value: string, context: MaskContext) => {
    if (isOpaqueValue(value)) return value;
    const result = masker.maskText(value, context);
    hits.push(...result.hits);
    return result.text;
  };
  const walk = (
    value: unknown,
    key: string,
    parentType: string | null,
  ): unknown => {
    if (typeof value === "string") {
      if (keptKeys.has(key) || isIdKey(key)) return value;
      const context: MaskContext =
        key === "arguments" || key === "partial_json"
          ? "embedded-json"
          : "plain";
      return mask(value, context);
    }
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, key, parentType));
    }
    if (value === null || typeof value !== "object") return value;
    if (keptSubtrees.has(key)) return value;
    const object = value as JsonObject;
    const type =
      typeof object.type === "string" ? object.type : parentType;
    const next: JsonObject = {};
    for (const [childKey, childValue] of Object.entries(object)) {
      next[childKey] = walk(childValue, childKey, type);
    }
    return next;
  };

  for (const [key, value] of Object.entries(body)) {
    (body as JsonObject)[key] = walk(value, key, null);
  }
  return hits;
}
