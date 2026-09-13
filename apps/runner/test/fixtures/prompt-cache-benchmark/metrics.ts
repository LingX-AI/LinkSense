import { createHash } from "node:crypto";

export const cacheBenchmarkArms = ["baseline", "key", "prefix", "combined"] as const;
export type CacheBenchmarkArm = typeof cacheBenchmarkArms[number];
export type CacheUsage = { input: number | null; read: number | null; write: number | null; output: number | null };
export type CachePricing = { input: number; read: number; write: number | null; output: number };
export type CacheSample = { usage: CacheUsage; firstTextMs: number | null; estimatedCost: number | null };
type AdditionalContext = Record<string, { kind: "application" | "untrusted"; value: string }>;
const commonContextKeys = [
  "linksense.runtime-identity",
  "linksense.interactive-forms",
  "linksense.local-web-server-policy",
  "linksense.inline-html-preview",
];

/** Experimental partition of generated platform rules; never apply to user files. */
export function partitionPlatformInstructions(agents: string, paths: string[], additionalContext: AdditionalContext): {
  agents: string; developerInstructions: string; additionalContext: AdditionalContext;
} {
  if (!agents.startsWith("<!-- linksense-template:")) {
    throw new Error("Expected a generated LinkSense AGENTS.md");
  }
  if (paths.length !== 3 || paths.some((value) => !value.startsWith("/"))) {
    throw new Error("Expected workspace, HOME and CODEX_HOME paths");
  }
  const common: string[] = [];
  const dynamic: string[] = [];
  for (const line of agents.split("\n")) {
    if (line.startsWith("- ") && !paths.some((value) => line.includes(value))) {
      common.push(line);
    } else if (line.startsWith("- ") || line.startsWith("<!--") || line.startsWith("#") || line === "") {
      dynamic.push(line);
    } else {
      throw new Error("Generated platform rule format changed; review partitioning");
    }
  }
  const context = structuredClone(additionalContext);
  for (const key of commonContextKeys) {
    const entry = context[key];
    if (!entry || entry.kind !== "application" || typeof entry.value !== "string") {
      throw new Error(`Missing trusted common context: ${key}`);
    }
    common.push(entry.value);
    delete context[key];
  }
  return {
    agents: dynamic.join("\n"),
    developerInstructions: ["# LinkSense platform instructions", ...common].join("\n\n"),
    additionalContext: context,
  };
}

/** Request separate run/arm cache groups; effective isolation is provider-controlled. */
export function experimentCacheKey({ runId, arm, ownerId, providerId, model, nativeKey }: {
  runId: string; arm: CacheBenchmarkArm; ownerId: string; providerId: string; model: string; nativeKey: string;
}): string {
  if (!cacheBenchmarkArms.includes(arm)) throw new Error("Unknown experiment arm");
  if ([runId, ownerId, providerId, model, nativeKey].some((v) => typeof v !== "string" || !v)) {
    throw new Error("Incomplete cache scope");
  }
  const group = arm === "key" || arm === "combined" ? "shared" : nativeKey;
  return `ls-exp-${createHash("sha256")
    .update(JSON.stringify([runId, arm, ownerId, providerId, model, group]))
    .digest("hex").slice(0, 48)}`;
}

/** Ignore only native message IDs, never tool IDs, order, roles, or content. */
export function comparablePrompt(request: Record<string, unknown>): string {
  return JSON.stringify({
    model: request.model,
    tools: request.tools,
    instructions: request.instructions,
    input: Array.isArray(request.input) ? request.input.map((item: unknown) => {
      if (!isObject(item) || item.type !== "message") return item;
      return Object.fromEntries(Object.entries(item).filter(([key]) => key !== "id"));
    }) : request.input,
  });
}

export function commonPrefixCharacters(left: string, right: string): number {
  let index = 0;
  while (index < Math.min(left.length, right.length) && left[index] === right[index]) index++;
  return index;
}

/** Responses usage only. Missing cache fields are unknown, not zero. */
export function readResponsesUsage(value: unknown): CacheUsage {
  const tokenCount = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const usage = isObject(value) ? value : {};
  const details = isObject(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const result = {
    input: tokenCount(usage?.input_tokens),
    read: tokenCount(details.cached_tokens),
    write: tokenCount(details.cache_write_tokens),
    output: tokenCount(usage?.output_tokens),
  };
  if (result.input !== null && (
    (result.read ?? 0) > result.input ||
    (result.write ?? 0) > result.input ||
    (result.read ?? 0) + (result.write ?? 0) > result.input
  )) throw new Error("Inconsistent upstream cache token counts");
  return result;
}

/** Configured-price estimate, not an invoice. An unknown write rate is valid only for zero writes. */
export function estimateCost(usage: CacheUsage, pricing: CachePricing | null): number | null {
  if (!pricing || (["input", "read", "output"] as const).some((key) =>
    usage[key] === null || !Number.isFinite(pricing[key]) || pricing[key] < 0
  )) return null;
  const { input, read, write, output } = usage;
  if (input === null || read === null || write === null || output === null) return null;
  if (write > 0 && (pricing.write === null || !Number.isFinite(pricing.write) || pricing.write < 0)) return null;
  return (
    (input - read - write) * pricing.input +
    read * pricing.read + (write === 0 ? 0 : write * (pricing.write ?? 0)) + output * pricing.output
  ) / 1_000_000;
}

export function summarizeSamples(samples: CacheSample[]): {
  count: number; inputTokens: number | null; cacheReadTokens: number | null;
  cacheWriteTokens: number | null; outputTokens: number | null; tokenWeightedHitRate: number | null;
  estimatedCost: number | null; firstTextSamples: number; medianFirstTextMs: number | null;
} {
  const sum = (getValue: (sample: CacheSample) => number | null): number | null => {
    if (samples.length === 0) return null;
    const values = samples.map(getValue);
    return values.some((value) => value === null) ? null : values.reduce<number>((a, b) => a + (b ?? 0), 0);
  };
  const input = sum((sample) => sample.usage.input);
  const read = sum((sample) => sample.usage.read);
  const latencies = samples.map((sample) => sample.firstTextMs).filter((v) => v !== null).sort((a, b) => a - b);
  const lower = latencies[Math.floor((latencies.length - 1) / 2)];
  const upper = latencies[Math.floor(latencies.length / 2)];
  return {
    count: samples.length,
    inputTokens: input,
    cacheReadTokens: read,
    cacheWriteTokens: sum((sample) => sample.usage.write),
    outputTokens: sum((sample) => sample.usage.output),
    tokenWeightedHitRate: input !== null && input > 0 && read !== null ? read / input : null,
    estimatedCost: sum((sample) => sample.estimatedCost),
    firstTextSamples: latencies.length,
    medianFirstTextMs: lower !== undefined && upper !== undefined ? (lower + upper) / 2 : null,
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ResponseObservation = { firstTextMs: number | null; terminal: Record<string, unknown> | null };

/** Consume model SSE events without accumulating intermediate/cumulative usage. */
export function observeResponseEvent(state: ResponseObservation, event: unknown, elapsedMs: number): ResponseObservation {
  if (!isObject(event)) throw new Error("Invalid upstream event");
  if (event.type === "error" || event.type === "response.failed") throw new Error("Upstream generation failed");
  if (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta && state.firstTextMs === null) {
    return { ...state, firstTextMs: elapsedMs };
  }
  if (event.type === "response.completed" || event.type === "response.incomplete") {
    if (state.terminal || !isObject(event.response)) throw new Error("Invalid terminal response");
    const expected = event.type === "response.completed" ? "completed" : "incomplete";
    if (event.response.status !== expected) throw new Error("Inconsistent terminal response status");
    return { ...state, terminal: event.response };
  }
  return state;
}
