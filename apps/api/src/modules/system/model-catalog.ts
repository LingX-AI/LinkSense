import {
  reasoningEffortValues,
  type ModelReasoningProfile,
  type ModelServiceProvider,
} from "@linksense/shared"
import { z } from "zod"

const catalogUrl = "https://models.dev/api.json"
const requestTimeoutMs = 4_000
const successTtlMs = 24 * 60 * 60 * 1_000
const failureTtlMs = 10 * 60 * 1_000
const maxCatalogBytes = 32 * 1024 * 1024

const catalogModelSchema = z.object({
  id: z.string().min(1).nullable().optional(),
  name: z.string().min(1).nullable().optional(),
  canonical_model_id: z.string().min(1).nullable().optional(),
  // Audio and image models report zero context; ignore those values instead of
  // rejecting the whole catalog.
  limit: z
    .object({ context: z.number().int().nonnegative().nullable().optional() })
    .nullable()
    .optional(),
  reasoning_options: z
    .array(
      z.object({
        type: z.string().min(1),
        values: z.array(z.string().min(1)).optional(),
      })
    )
    .nullable()
    .optional(),
})
const catalogSchema = z.record(
  z.string(),
  z.object({
    // Validate models individually so one malformed entry cannot discard the
    // whole catalog.
    models: z.record(z.string(), z.unknown()).optional(),
  })
)

export type CatalogModel = Readonly<{
  id: string
  name: string | null
  canonicalId: string | null
  contextWindow: number | null
  reasoningProfile: ModelReasoningProfile | null
}>

export interface ModelCatalog {
  resolveContextWindows(
    provider: ModelServiceProvider,
    models: readonly { id: string; display_name: string }[]
  ): Promise<ReadonlyMap<string, number>>
  resolveReasoningProfiles(
    provider: ModelServiceProvider,
    models: readonly { id: string; display_name: string }[]
  ): Promise<ReadonlyMap<string, ModelReasoningProfile>>
}

/** Providers whose models.dev catalog keys match the LinkSense presets. */
const modelsDevProviderIds: Partial<Record<ModelServiceProvider, string>> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google",
  google_vertex: "google-vertex",
  alibaba: "alibaba",
  deepseek: "deepseek",
  openrouter: "openrouter",
}

export function parseModelsDevCatalog(
  payload: unknown
): ReadonlyMap<string, readonly CatalogModel[]> | null {
  const parsed = catalogSchema.safeParse(payload)
  if (!parsed.success) return null
  const providers = new Map<string, CatalogModel[]>()
  for (const [providerId, provider] of Object.entries(parsed.data)) {
    const models: CatalogModel[] = []
    for (const [key, rawModel] of Object.entries(provider.models ?? {})) {
      const model = catalogModelSchema.safeParse(rawModel)
      if (!model.success) continue
      models.push({
        id: model.data.id ?? key,
        name: model.data.name ?? null,
        canonicalId: model.data.canonical_model_id ?? null,
        contextWindow:
          model.data.limit?.context !== undefined &&
          model.data.limit.context !== null &&
          model.data.limit.context > 0
            ? model.data.limit.context
            : null,
        reasoningProfile: reasoningProfileFrom(model.data.reasoning_options),
      })
    }
    providers.set(providerId, models)
  }
  return providers
}

/**
 * Provider APIs often omit the context window (DeepSeek and OpenAI do), so the
 * catalog is matched by id, display name, canonical id, and finally a dated
 * suffix such as "1017". Exact matches win; fuzzy matches must be unambiguous.
 */
export function resolveCatalogContextWindow(
  models: readonly CatalogModel[],
  query: { id: string; display_name: string }
): number | null {
  return resolveCatalogValue(
    models,
    query,
    (model) => model.contextWindow,
    String
  )
}

export function resolveCatalogReasoningProfile(
  models: readonly CatalogModel[],
  query: { id: string; display_name: string }
): ModelReasoningProfile | null {
  return resolveCatalogValue(
    models,
    query,
    (model) => model.reasoningProfile,
    reasoningProfileKey
  )
}

function resolveCatalogValue<T>(
  models: readonly CatalogModel[],
  query: { id: string; display_name: string },
  extract: (model: CatalogModel) => T | null,
  keyOf: (value: T) => string
): T | null {
  for (const value of [query.id, query.display_name]) {
    if (value.trim() === "") continue
    for (const matches of modelMatchers) {
      const matched = new Map<string, T>()
      for (const model of models) {
        const extracted = extract(model)
        if (extracted === null || !matches(model, value)) continue
        matched.set(keyOf(extracted), extracted)
      }
      if (matched.size === 1) {
        for (const resolved of matched.values()) return resolved
      }
      if (matched.size > 1) break
    }
  }
  return null
}

function reasoningProfileKey(profile: ModelReasoningProfile): string {
  return `${profile.default_reasoning_effort}:${profile.supported_reasoning_efforts.join(",")}`
}

const modelMatchers: readonly ((model: CatalogModel, value: string) => boolean)[] = [
  (model, value) => model.id.toLowerCase() === value.toLowerCase(),
  (model, value) => model.name?.toLowerCase() === value.toLowerCase(),
  (model, value) => {
    const target = compact(value)
    return [model.id, model.name, canonicalTail(model.canonicalId)].some(
      (candidate) => candidate !== null && compact(candidate) === target
    )
  },
  (model, value) =>
    [model.name, canonicalTail(model.canonicalId)].some(
      (candidate) => candidate !== null && isDatedPrefix(value, candidate)
    ),
]

export function createModelsDevModelCatalog(
  fetcher: typeof fetch = fetch
): ModelCatalog {
  let cache: {
    expiresAt: number
    providers: ReadonlyMap<string, readonly CatalogModel[]> | null
  } | null = null
  let pending: Promise<ReadonlyMap<string, readonly CatalogModel[]> | null> | null =
    null

  async function readCatalog(): Promise<
    ReadonlyMap<string, readonly CatalogModel[]> | null
  > {
    if (cache && cache.expiresAt > Date.now()) return cache.providers
    if (pending) return await pending
    pending = loadCatalog(fetcher)
    const providers = await pending
    pending = null
    cache = {
      providers,
      expiresAt:
        Date.now() + (providers === null ? failureTtlMs : successTtlMs),
    }
    return providers
  }

  async function candidatesFor(
    provider: ModelServiceProvider
  ): Promise<readonly CatalogModel[] | null> {
    const providers = await readCatalog()
    if (!providers) return null
    const providerId = modelsDevProviderIds[provider]
    return providerId === undefined
      ? [...providers.values()].flat()
      : providers.get(providerId) ?? []
  }

  return {
    async resolveContextWindows(provider, models) {
      if (models.length === 0) return new Map()
      const candidates = await candidatesFor(provider)
      if (!candidates) return new Map()
      const windows = new Map<string, number>()
      for (const model of models) {
        const contextWindow = resolveCatalogContextWindow(candidates, model)
        if (contextWindow !== null) windows.set(model.id, contextWindow)
      }
      return windows
    },
    async resolveReasoningProfiles(provider, models) {
      if (models.length === 0) return new Map()
      const candidates = await candidatesFor(provider)
      if (!candidates) return new Map()
      const profiles = new Map<string, ModelReasoningProfile>()
      for (const model of models) {
        const profile = resolveCatalogReasoningProfile(candidates, model)
        if (profile !== null) profiles.set(model.id, profile)
      }
      return profiles
    },
  }
}

async function loadCatalog(
  fetcher: typeof fetch
): Promise<ReadonlyMap<string, readonly CatalogModel[]> | null> {
  try {
    const response = await fetcher(catalogUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (!response.ok) return null
    const declaredLength = Number(response.headers.get("content-length") ?? "0")
    if (declaredLength > maxCatalogBytes) return null
    const body = await response.text()
    if (body.length > maxCatalogBytes) return null
    return parseModelsDevCatalog(JSON.parse(body))
  } catch {
    return null
  }
}

function reasoningProfileFrom(
  options:
    | readonly { type: string; values?: string[] | undefined }[]
    | null
    | undefined
): ModelReasoningProfile | null {
  const effortOption = options?.find(
    (option) => option.type === "effort" && (option.values?.length ?? 0) > 0
  )
  const values = effortOption?.values
  if (!values) return null
  // "none" and "default" exist in provider metadata but not in LinkSense's
  // effort scale, so they are dropped instead of guessed.
  const supported = reasoningEffortValues.filter((effort) =>
    values.includes(effort)
  )
  if (supported.length === 0) return null
  const defaultEffort = supported.includes("medium")
    ? "medium"
    : supported[Math.floor((supported.length - 1) / 2)]
  if (!defaultEffort) return null
  return {
    supported_reasoning_efforts: supported,
    default_reasoning_effort: defaultEffort,
  }
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "")
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9.]+/u).filter(Boolean)
}

function canonicalTail(value: string | null): string | null {
  if (value === null) return null
  const separator = value.lastIndexOf("/")
  return separator === -1 ? value : value.slice(separator + 1)
}

function isDatedPrefix(shortValue: string, longValue: string): boolean {
  const short = tokenize(shortValue)
  const long = tokenize(longValue)
  if (short.length === 0 || short.length >= long.length) return false
  if (!short.every((token, index) => long[index] === token)) return false
  const suffix = long.slice(short.length)
  const datedOrSuffixed = suffix.every(
    (token) =>
      /^\d+$/u.test(token) ||
      /^(?:latest|preview|exp|experimental)$/u.test(token)
  )
  return (
    datedOrSuffixed && suffix.some((token) => /^\d{3,}$/u.test(token))
  )
}

export const defaultModelCatalog = createModelsDevModelCatalog()
