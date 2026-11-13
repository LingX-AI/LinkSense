import {
  createBraveProvider, createExaProvider, createGoogleProvider,
  createSearxNGProvider, createSerpApiProvider, createTavilyProvider, webSearch,
  type SearchProvider, type SearchResult,
} from "@plust/search-sdk"
import {
  webSearchRequestSchema, webSearchSuccessSchema,
  type WebSearchProvider, type WebSearchRequest, type WebSearchSuccess,
} from "@linksense/shared"
import { z } from "zod"

import { AppError } from "../lib/errors.js"
import { readResponseWithLimit, requestPublicHttpResource } from "../lib/safe-http-fetch.js"

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const providerResultSchema = z.object({
  title: z.string(), url: z.string(), snippet: z.string().optional(),
  publishedDate: z.string().nullable().optional(), raw: z.unknown().optional(),
})
const deepseekResultSchema = z.object({
  title: z.string(), url: z.string(), snippet: z.string(), summary: z.string(),
  date: z.string().nullable(),
})
const deepseekResponseSchema = z.object({ results: z.array(deepseekResultSchema).max(50) })

export type WebSearchRuntime = {
  provider: WebSearchProvider
  endpoint: string
  apiKey: string | null
  searchEngineId: string | null
  defaultMaxResults: number
  timeoutMs: number
}
export type WebSearchRunner = (
  runtime: WebSearchRuntime, request: WebSearchRequest, signal?: AbortSignal,
) => Promise<WebSearchSuccess>

export function createWebSearchRunner(
  transport?: typeof fetch,
  safeHttp: { allowBenchmarkProxyAddresses?: boolean } = {},
): WebSearchRunner {
  const requestTransport: typeof fetch = transport ?? ((input, init) => safeSearchFetch(input, init, safeHttp))
  return async (runtime, rawRequest, callerSignal) => {
    const request = webSearchRequestSchema.parse(rawRequest)
    const deadline = AbortSignal.timeout(runtime.timeoutMs)
    const signal = AbortSignal.any([deadline, ...(callerSignal ? [callerSignal] : [])])
    let requestFailure: AppError | undefined
    // SDK adapters wrap errors; retain the classified transport error without exposing provider bodies.
    const requestFetch: typeof fetch = async (url, init) => {
      try {
        signal.throwIfAborted()
        const response = await requestTransport(url, { ...init, redirect: "manual", signal })
        if (!response.ok) {
          await response.body?.cancel()
          throw new AppError(response.status === 401 || response.status === 403
            ? "WEB_SEARCH_AUTH_FAILED" : response.status === 429
              ? "WEB_SEARCH_RATE_LIMITED" : "WEB_SEARCH_UNAVAILABLE")
        }
        if (!response.body) throw new AppError("WEB_SEARCH_RESPONSE_INVALID")
        const bytes = await readResponseWithLimit(response.body, MAX_RESPONSE_BYTES, "WEB_SEARCH_RESPONSE_INVALID")
        // Validate the envelope before the SDK can mistake an invalid response for an empty search.
        const body: unknown = JSON.parse(bytes.toString("utf8"))
        const envelope = z.record(z.string(), z.unknown()).parse(body)
        const key = runtime.provider === "google" ? "items" : runtime.provider === "serpapi" ? "organic_results" : "results"
        const results = runtime.provider === "brave"
          ? z.object({ web: z.object({ results: z.array(z.unknown()) }).optional(), type: z.string().optional() }).parse(body).web?.results
          : envelope[key]
        // Google, Brave and SerpAPI omit their result collection on a successful empty search.
        if (results === undefined && !["google", "brave", "serpapi"].includes(runtime.provider)) {
          throw new AppError("WEB_SEARCH_RESPONSE_INVALID")
        }
        if (results !== undefined) {
          for (const item of z.array(z.unknown()).max(100).parse(results)) {
            const entry = z.record(z.string(), z.unknown()).parse(item)
            z.string().parse(entry.title)
            z.string().parse(entry[["google", "serpapi"].includes(runtime.provider) ? "link" : "url"])
          }
        }
        if (runtime.provider === "deepseek") deepseekResponseSchema.parse(body)
        if (results === undefined) {
          if (runtime.provider === "google" && envelope.kind !== "customsearch#search") throw new AppError("WEB_SEARCH_RESPONSE_INVALID")
          if (runtime.provider === "brave" && envelope.type !== "search") throw new AppError("WEB_SEARCH_RESPONSE_INVALID")
          if (runtime.provider === "serpapi") z.object({ search_metadata: z.object({ status: z.literal("Success") }) }).parse(body)
        }
        if (envelope.error !== undefined) throw new AppError("WEB_SEARCH_UNAVAILABLE")
        return Response.json(body)
      } catch (error) {
        requestFailure = error instanceof AppError ? error : new AppError(error instanceof z.ZodError || error instanceof SyntaxError ? "WEB_SEARCH_RESPONSE_INVALID" : "WEB_SEARCH_UNAVAILABLE")
        throw requestFailure
      }
    }
    const maxResults = request.max_results ?? runtime.defaultMaxResults
    try {
      const provider = providerFor(runtime, requestFetch, signal)
      const results = await webSearch({
        query: request.query, maxResults, timeout: runtime.timeoutMs, signal, provider: [provider],
      })
      signal.throwIfAborted()
      return webSearchSuccessSchema.parse({
        success: true, provider: runtime.provider, query: request.query,
        results: results.slice(0, maxResults).map((value) => {
          const result = providerResultSchema.parse(value)
          const raw = z.object({ summary: z.string().optional() }).passthrough().safeParse(result.raw)
          return {
            title: result.title.slice(0, 1_000), url: result.url,
            snippet: (result.snippet ?? "").slice(0, 8_000),
            summary: raw.success ? raw.data.summary?.slice(0, 12_000) ?? null : null,
            published_at: result.publishedDate?.slice(0, 120) ?? null,
          }
        }),
      })
    } catch (error) {
      if (callerSignal?.aborted) throw callerSignal.reason
      if (deadline.aborted) throw new AppError("WEB_SEARCH_TIMEOUT")
      if (requestFailure) throw requestFailure
      if (error instanceof z.ZodError) throw new AppError("WEB_SEARCH_RESPONSE_INVALID")
      throw new AppError("WEB_SEARCH_UNAVAILABLE")
    }
  }
}

function providerFor(runtime: WebSearchRuntime, requestFetch: typeof fetch, signal: AbortSignal): SearchProvider {
  const config = { apiKey: runtime.apiKey ?? "", baseUrl: runtime.endpoint, fetch: requestFetch }
  switch (runtime.provider) {
    case "tavily": return createTavilyProvider(config)
    case "brave": return createBraveProvider(config)
    case "exa": return createExaProvider(config)
    case "google": return createGoogleProvider({ ...config, cx: runtime.searchEngineId ?? "" })
    case "serpapi": return createSerpApiProvider(config)
    case "searxng": return createSearxNGProvider(config)
    case "deepseek": return {
      name: "deepseek", config,
      async search(options): Promise<SearchResult[]> {
        const response = await requestFetch(runtime.endpoint, {
          method: "POST", headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ query: options.query, count: options.maxResults, need_content: false }), signal,
        })
        const result = deepseekResponseSchema.parse(await response.json())
        return result.results.map((item) => ({
          title: item.title, url: item.url, snippet: item.snippet,
          ...(item.date ? { publishedDate: item.date } : {}), provider: "deepseek", raw: item,
        }))
      },
    }
  }
}

async function safeSearchFetch(
  input: Parameters<typeof fetch>[0], init: RequestInit | undefined,
  safeHttp: { allowBenchmarkProxyAddresses?: boolean },
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  const method = init?.method ?? "GET"
  if (method !== "GET" && method !== "POST") throw new AppError("WEB_SEARCH_INVALID")
  return requestPublicHttpResource(url, {
    method, headers: Object.fromEntries(new Headers(init?.headers)),
    ...(typeof init?.body === "string" ? { body: init.body } : {}),
    ...(init?.signal ? { signal: init.signal } : {}),
    byteLimit: MAX_RESPONSE_BYTES, redirectCount: 0, requestTimeoutMs: 60_000,
    accept: "application/json", userAgent: "LinkSense", errorCode: "WEB_SEARCH_UNAVAILABLE",
    allowBenchmarkProxyAddresses: safeHttp.allowBenchmarkProxyAddresses ?? false,
  })
}
