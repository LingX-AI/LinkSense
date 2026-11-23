import type {
  MaskContext,
  PrivacyMaskHit,
  PrivacyMasker,
} from "@linksense/shared/privacy-masking-engine";
import {
  MAX_ADVANCED_PRIVACY_MASKING_HITS,
  MAX_ADVANCED_PRIVACY_MASKING_TEXT_LENGTH,
  type PrivacyMaskingLocation,
} from "@linksense/shared";

type JsonObject = Record<string, unknown>;

export type MaskRequestHit = PrivacyMaskHit & {
  location: PrivacyMaskingLocation;
};

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

const jsonArgumentItemTypes = new Set(["function_call", "mcp_call", "tool_search_call"]);

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

/**
 * Returns a copy of the request with free text replaced by placeholders.
 * Ids, tool names, schemas and sealed values stay as they are so Codex and
 * the provider keep matching them.
 */
export function maskResponsesRequest(
  body: JsonObject,
  masker: PrivacyMasker,
): MaskRequestHit[] {
  const hits: MaskRequestHit[] = [];
  let remainingText = MAX_ADVANCED_PRIVACY_MASKING_TEXT_LENGTH;
  const deadline = performance.now() + 500;
  const mask = (
    value: string,
    context: MaskContext,
    location: PrivacyMaskingLocation,
  ) => {
    if (/^data:[^,]*;base64,[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
      return value;
    }
    if (masker.hasAdvancedRules) {
      remainingText -= value.length;
      if (remainingText < 0 || performance.now() > deadline) {
        throw new Error("Advanced privacy masking request budget exceeded");
      }
    }
    const result = masker.maskText(value, context);
    if (masker.hasAdvancedRules &&
      (hits.length + result.hits.length > MAX_ADVANCED_PRIVACY_MASKING_HITS ||
        performance.now() > deadline)) {
      throw new Error("Advanced privacy masking request budget exceeded");
    }
    hits.push(...result.hits.map((hit) => ({ ...hit, location })));
    return result.text;
  };
  const walk = (
    value: unknown,
    key: string,
    location: PrivacyMaskingLocation,
  ): unknown => {
    if (typeof value === "string") {
      if (keptKeys.has(key) || isIdKey(key)) return value;
      return mask(value, "plain", location);
    }
    if (Array.isArray(value)) {
      return value.map((item) =>
        walk(item, key, itemLocation(item, location)),
      );
    }
    if (value === null || typeof value !== "object") return value;
    if (keptSubtrees.has(key)) return value;
    const object = value as JsonObject;
    const hasJsonArguments = typeof object.type === "string" &&
      jsonArgumentItemTypes.has(object.type);
    return Object.fromEntries(
      Object.entries(object).map(([childKey, childValue]) => {
        if (hasJsonArguments && childKey === "arguments") {
          if (typeof childValue === "string") {
            return [childKey, mask(childValue, "embedded-json", location)];
          }
          if (childValue !== undefined) {
            const serialized = JSON.stringify(childValue);
            const masked = mask(serialized, "embedded-json", location);
            return [childKey, masked === serialized ? childValue : JSON.parse(masked)];
          }
        }
        const childLocation = object.type === "additional_tools" && childKey === "content"
          ? "instructions"
          : location;
        return [childKey, walk(childValue, childKey, childLocation)];
      }),
    );
  };

  for (const [key, value] of Object.entries(body)) {
    body[key] = walk(
      value,
      key,
      topLevelLocation(key),
    );
  }
  return hits;
}

function topLevelLocation(key: string): PrivacyMaskingLocation {
  if (key === "instructions") return "instructions";
  if (key === "tools") return "tools";
  if (key === "input") return "prompt";
  return "other";
}

/** An input item says where its text belongs; everything else inherits. */
function itemLocation(
  item: unknown,
  inherited: PrivacyMaskingLocation,
): PrivacyMaskingLocation {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return inherited;
  }
  const { type, role } = item as JsonObject;
  if (typeof type === "string") {
    if (type.endsWith("_call")) return "tool_arguments";
    if (type.endsWith("_call_output") || type === "tool_search_output") return "tool_output";
    if (type === "additional_tools") return "tools";
  }
  if (type === "message" || (type === undefined && typeof role === "string")) {
    return role === "system" || role === "developer"
      ? "instructions"
      : "prompt";
  }
  return inherited;
}
