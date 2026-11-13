import { z } from "zod";

export const webSearchProviders = [
  "deepseek", "tavily", "brave", "exa", "google", "serpapi", "searxng",
] as const;
export const webSearchProviderSchema = z.enum(webSearchProviders);
export type WebSearchProvider = z.infer<typeof webSearchProviderSchema>;

export const webSearchEndpointSchema = z.url().max(2_048).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password &&
    !url.search && !url.hash && (!url.port || url.port === "443");
}, { message: "web_search_endpoint_invalid" });

export const webSearchProviderDefinitions = [
  { key: "deepseek", endpoint: "https://api.deepseek.com/v1/tools/search", requires_api_key: true },
  { key: "tavily", endpoint: "https://api.tavily.com/search", requires_api_key: true },
  { key: "brave", endpoint: "https://api.search.brave.com/res/v1/web/search", requires_api_key: true },
  { key: "exa", endpoint: "https://api.exa.ai/search", requires_api_key: true },
  { key: "google", endpoint: "https://www.googleapis.com/customsearch/v1", requires_api_key: true },
  { key: "serpapi", endpoint: "https://serpapi.com/search.json", requires_api_key: true },
  { key: "searxng", endpoint: null, requires_api_key: false },
] as const satisfies readonly {
  key: WebSearchProvider; endpoint: string | null; requires_api_key: boolean;
}[];

export const WEB_SEARCH_MAX_RESULTS = 20;
export const WEB_SEARCH_MAX_TIMEOUT_MS = 60_000;
export const webSearchRequestSchema = z.strictObject({
  query: z.string().trim().min(1).max(256)
    .refine((value) => Array.from(value).length <= 128),
  max_results: z.number().int().min(1).max(WEB_SEARCH_MAX_RESULTS).optional(),
});

const settingsValuesSchema = z.strictObject({
  enabled: z.boolean(),
  provider: webSearchProviderSchema.nullable(),
  base_url: webSearchEndpointSchema.nullable(),
  search_engine_id: z.string().trim().min(1).max(240).nullable(),
  default_max_results: z.number().int().min(1).max(WEB_SEARCH_MAX_RESULTS),
  timeout_ms: z.number().int().min(1_000).max(WEB_SEARCH_MAX_TIMEOUT_MS),
});

export const updateWebSearchSettingsSchema = settingsValuesSchema.extend({
  expected_revision: z.number().int().nonnegative(),
  api_key: z.string().trim().min(1).max(16_384).nullable().optional(),
}).superRefine((value, context) => {
  if (value.enabled && !value.provider) {
    context.addIssue({ code: "custom", path: ["provider"], message: "web_search_provider_required" });
  }
  if (value.enabled && value.provider === "searxng" && !value.base_url) {
    context.addIssue({ code: "custom", path: ["base_url"], message: "web_search_endpoint_required" });
  }
  if (value.enabled && value.provider === "google" && !value.search_engine_id) {
    context.addIssue({ code: "custom", path: ["search_engine_id"], message: "web_search_engine_id_required" });
  }
});

export const webSearchSettingsSchema = settingsValuesSchema.extend({
  revision: z.number().int().nonnegative(),
  api_key_configured: z.boolean(),
});
export const webSearchSettingsUpdateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"), settings: webSearchSettingsSchema,
});
export const testWebSearchSettingsSchema = z.strictObject({
  settings: updateWebSearchSettingsSchema, request: webSearchRequestSchema,
});

export const webSearchResultSchema = z.strictObject({
  title: z.string().max(1_000),
  url: z.url().max(8_192).refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  }),
  snippet: z.string().max(8_000),
  summary: z.string().max(12_000).nullable(),
  published_at: z.string().max(120).nullable(),
});
export const webSearchSuccessSchema = z.strictObject({
  success: z.literal(true), provider: webSearchProviderSchema,
  query: z.string().min(1).max(256).refine((value) => Array.from(value).length <= 128),
  results: z.array(webSearchResultSchema).max(WEB_SEARCH_MAX_RESULTS),
});

export const webSearchFailureCodeSchema = z.enum([
  "WEB_SEARCH_NOT_CONFIGURED", "WEB_SEARCH_DISABLED", "WEB_SEARCH_FORBIDDEN",
  "WEB_SEARCH_INVALID", "WEB_SEARCH_UNAVAILABLE", "WEB_SEARCH_AUTH_FAILED",
  "WEB_SEARCH_RATE_LIMITED", "WEB_SEARCH_RESPONSE_INVALID", "WEB_SEARCH_TIMEOUT",
]);
export const webSearchFailureSchema = z.strictObject({
  code: webSearchFailureCodeSchema, retryable: z.boolean(),
});
export type WebSearchRequest = z.infer<typeof webSearchRequestSchema>;
export type WebSearchSettings = z.infer<typeof webSearchSettingsSchema>;
export type UpdateWebSearchSettings = z.infer<typeof updateWebSearchSettingsSchema>;
export type WebSearchSuccess = z.infer<typeof webSearchSuccessSchema>;
export type WebSearchFailure = z.infer<typeof webSearchFailureSchema>;
