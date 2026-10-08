import { createReadStream, createWriteStream } from "node:fs"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, posix } from "node:path"
import { Readable, Transform } from "node:stream"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { pipeline } from "node:stream/promises"
import { setTimeout as delay } from "node:timers/promises"

import unzipper from "unzipper"
import { z } from "zod"

import {
  createHybridChunkMultipartStream,
  type DoclingHybridChunkInput,
  type DoclingHybridChunkOptions,
  type HybridChunkResult,
  parseHybridChunkResponse,
  requiredHybridMultipartFields,
} from "./docling-hybrid.js"
import { KnowledgeProcessingError } from "./errors.js"
import { doclingRuntimeVersions } from "./config.js"

const failureCategorySchema = z.enum([
  "policy",
  "capacity",
  "source_unavailable",
  "target_unavailable",
  "timeout",
  "internal",
  "backend_failure",
  "inference_failure",
  "unknown",
])

const publicFailureSchema = z.strictObject({
  category: failureCategorySchema,
  message: z.string(),
  retryable: z.boolean(),
  phase: z.enum([
    "admission",
    "source_enumeration",
    "execution",
    "orchestration",
  ]),
  details: z.record(z.string(), z.string()).default({}),
})

const taskStatusSchema = z.strictObject({
  task_id: z.string().min(1),
  task_type: z.enum(["convert", "chunk"]),
  task_status: z.enum([
    "pending",
    "started",
    "success",
    "failure",
    "partial_success",
    "skipped",
  ]),
  task_position: z.number().int().nullable().optional(),
  task_meta: z
    .strictObject({
      num_docs: z.number().int().nonnegative(),
      num_processed: z.number().int().nonnegative().optional(),
      num_succeeded: z.number().int().nonnegative().optional(),
      num_partially_succeeded: z.number().int().nonnegative().optional(),
      num_failed: z.number().int().nonnegative().optional(),
    })
    .nullable()
    .optional(),
  error_message: z.string().nullable().optional(),
  failure: publicFailureSchema.nullable().optional(),
})

const directResultSchema = z.strictObject({
  document: z.strictObject({
    filename: z.string().min(1),
    md_content: z.string().nullable().optional(),
    json_content: z.record(z.string(), z.unknown()).nullable().optional(),
    html_content: z.string().nullable().optional(),
    text_content: z.string().nullable().optional(),
    doctags_content: z.string().nullable().optional(),
    doclang_content: z.string().nullable().optional(),
  }),
  status: z.enum([
    "success",
    "failure",
    "partial_success",
    "skipped",
  ]),
  errors: z
    .array(
      z.strictObject({
        component_type: z.string(),
        module_name: z.string(),
        error_message: z.string(),
        category: failureCategorySchema.default("unknown"),
        page_no: z.number().int().nullable().optional(),
      }),
    )
    .default([]),
  processing_time: z.number().nonnegative(),
  timings: z.record(z.string(), z.unknown()).default({}),
  confidence: z.record(z.string(), z.unknown()).nullable().optional(),
})

const openApiSchema = z.object({
  openapi: z.string().min(1),
  info: z
    .object({
      version: z.string().min(1),
    })
    .passthrough(),
  paths: z.record(z.string(), z.unknown()),
  components: z
    .object({
      schemas: z.record(z.string(), z.unknown()).default({}),
    })
    .passthrough()
    .default({ schemas: {} }),
})

const supportedDoclingServeVersion = doclingRuntimeVersions.serve

const taskNotFoundResponseSchema = z
  .object({
    detail: z.string(),
  })
  .passthrough()

const requiredDoclingOperations = [
  ["/v1/convert/file/async", "post"],
  ["/v1/chunk/hybrid/file/async", "post"],
  ["/v1/status/poll/{task_id}", "get"],
  ["/v1/result/{task_id}", "get"],
] as const

const requiredSubmitMultipartFields = [
  "files",
  "to_formats",
  "target_type",
  "image_export_mode",
  "include_images",
  "include_page_images",
  "pipeline",
  "table_mode",
  "do_ocr",
  "force_ocr",
  "ocr_preset",
  "do_code_enrichment",
  "do_formula_enrichment",
  "do_picture_classification",
  "do_picture_description",
  "document_timeout",
] as const

export type DoclingTaskStatus = z.infer<typeof taskStatusSchema>

export type DoclingInputFile = {
  filename: string
  contentType: string
  openStream: () => Promise<Readable>
}

export type DoclingConversionOptions = {
  documentTimeoutSeconds: number
  ocrEnabled: boolean
}

export type DoclingResult =
  | { kind: "archive"; stream: Readable }
  | { kind: "direct"; result: z.infer<typeof directResultSchema> }

export class DoclingServeClient {
  private readonly baseUrl: string
  private readonly tenantId: string
  private hybridProbeSucceededUntil = 0
  private hybridProbeInFlight: Promise<void> | undefined

  constructor(
    private readonly config: {
      baseUrl: string
      apiKey: string
      tenantId?: string
      requestTimeoutMs?: number
      pollIntervalMs?: number
      hybridProbe?: {
        tokenizer: string
        maxTokens: number
        successCacheTtlMs?: number
      }
    },
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/$/u, "")
    this.tenantId = z
      .string()
      .trim()
      .min(1)
      .max(255)
      .parse(config.tenantId ?? "linksense")
  }

  async verifyContract(signal?: AbortSignal): Promise<void> {
    const response = await this.request("/openapi.json", {
      method: "GET",
      ...(signal ? { signal } : {}),
    })
    const parsed = openApiSchema.safeParse(await readJson(response))
    if (
      !parsed.success ||
      parsed.data.info.version !== supportedDoclingServeVersion ||
      requiredDoclingOperations.some(
        ([path, method]) =>
          getOpenApiOperation(parsed.data.paths, path, method) === null,
      ) ||
      !multipartFieldsAreCompatible(
        parsed.data,
        "/v1/convert/file/async",
        requiredSubmitMultipartFields,
      ) ||
      !multipartFieldsAreCompatible(
        parsed.data,
        "/v1/chunk/hybrid/file/async",
        requiredHybridMultipartFields,
      )
    ) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE",
      )
    }
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.verifyContract(signal)
    const probe = this.config.hybridProbe
    if (!probe || this.hybridProbeSucceededUntil > Date.now()) return
    if (this.hybridProbeInFlight) return this.hybridProbeInFlight

    const inFlight = this.verifyHybridChunker(probe, signal)
      .then(() => {
        this.hybridProbeSucceededUntil =
          Date.now() + (probe.successCacheTtlMs ?? 300_000)
      })
      .finally(() => {
        if (this.hybridProbeInFlight === inFlight) {
          this.hybridProbeInFlight = undefined
        }
      })
    this.hybridProbeInFlight = inFlight
    return inFlight
  }

  async verifyHybridChunker(
    options: {
      tokenizer: string
      maxTokens: number
    },
    signal?: AbortSignal,
  ): Promise<void> {
    const requestOptions: DoclingHybridChunkOptions = {
      tokenizer: options.tokenizer,
      maxTokens: options.maxTokens,
      mergePeers: false,
      includeRawText: true,
    }
    const submitted = await this.submitHybridChunk(
      {
        filename: hybridHealthFilename,
        json: hybridHealthDocument(),
        options: requestOptions,
      },
      signal,
    )
    await this.waitForSuccess({
      taskId: submitted.task_id,
      deadlineEpochMs: Date.now() + 10_000,
      ...(signal ? { signal } : {}),
    })
    await this.getHybridChunkResult(
      submitted.task_id,
      { maxTokens: options.maxTokens },
      signal,
    )
  }

  async submit(
    file: DoclingInputFile,
    options: DoclingConversionOptions,
    signal?: AbortSignal,
  ): Promise<DoclingTaskStatus> {
    return this.submitConversion(file, options, signal)
  }

  async submitConversion(
    file: DoclingInputFile,
    options: DoclingConversionOptions,
    signal?: AbortSignal,
  ): Promise<DoclingTaskStatus> {
    const boundary = `linksense-${crypto.randomUUID()}`
    const fileStream = await file.openStream()
    const body = createDoclingMultipartStream({
      boundary,
      file,
      fileStream,
      options,
    })
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-api-key": this.config.apiKey,
      },
      body: toFetchBody(body),
      duplex: "half",
      ...(signal ? { signal } : {}),
    }
    const response = await this.request("/v1/convert/file/async", init)
    const parsed = taskStatusSchema.safeParse(await readJson(response))
    if (!parsed.success) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_RESPONSE_INVALID",
      )
    }
    if (parsed.data.task_type !== "convert") {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_RESPONSE_INVALID",
      )
    }
    return parsed.data
  }

  async submitHybridChunk(
    input: DoclingHybridChunkInput,
    signal?: AbortSignal,
  ): Promise<DoclingTaskStatus> {
    const boundary = `linksense-${crypto.randomUUID()}`
    const body = createHybridChunkMultipartStream({
      boundary,
      request: input,
    })
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      body: toFetchBody(body),
      duplex: "half",
      ...(signal ? { signal } : {}),
    }
    const response = await this.request(
      "/v1/chunk/hybrid/file/async",
      init,
    )
    const parsed = taskStatusSchema.safeParse(await readJson(response))
    if (!parsed.success || parsed.data.task_type !== "chunk") {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_RESPONSE_INVALID",
      )
    }
    return parsed.data
  }

  async poll(taskId: string, signal?: AbortSignal): Promise<DoclingTaskStatus> {
    return this.getTaskStatus(taskId, signal)
  }

  async getTaskStatus(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<DoclingTaskStatus> {
    const safeTaskId = encodeURIComponent(z.string().min(1).parse(taskId))
    const response = await this.request(`/v1/status/poll/${safeTaskId}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    })
    const parsed = taskStatusSchema.safeParse(await readJson(response))
    if (!parsed.success || parsed.data.task_id !== taskId) {
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_RESPONSE_INVALID",
      )
    }
    return parsed.data
  }

  async waitForSuccess(input: {
    taskId: string
    deadlineEpochMs: number
    signal?: AbortSignal
    continueCheck?: () => Promise<boolean>
  }): Promise<DoclingTaskStatus> {
    const pollInterval = this.config.pollIntervalMs ?? 2_000
    for (;;) {
      if (input.signal?.aborted) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      if (input.continueCheck && !(await input.continueCheck())) {
        throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
      }
      if (Date.now() >= input.deadlineEpochMs) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
          { retryable: true },
        )
      }
      const status = await this.poll(input.taskId, input.signal)
      if (status.task_status === "success") return status
      if (
        status.task_status === "failure" ||
        status.task_status === "partial_success" ||
        status.task_status === "skipped"
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
      }
      await abortableDelay(pollInterval, input.signal)
    }
  }

  async result(taskId: string, signal?: AbortSignal): Promise<DoclingResult> {
    return this.getConversionResult(taskId, signal)
  }

  async getConversionResult(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<DoclingResult> {
    const safeTaskId = encodeURIComponent(z.string().min(1).parse(taskId))
    const response = await this.request(`/v1/result/${safeTaskId}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    })
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (contentType.includes("json")) {
      const parsed = directResultSchema.safeParse(await readJson(response))
      if (
        !parsed.success ||
        parsed.data.status !== "success" ||
        parsed.data.document.json_content === null ||
        parsed.data.document.json_content === undefined
      ) {
        throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
      }
      return { kind: "direct", result: parsed.data }
    }
    if (
      !contentType.includes("application/zip") &&
      !contentType.includes("application/x-zip-compressed")
    ) {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
    }
    if (response.body === null) {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
    }
    return {
      kind: "archive",
      stream: Readable.fromWeb(
        response.body as unknown as NodeReadableStream<Uint8Array>,
      ),
    }
  }

  async getHybridChunkResult(
    taskId: string,
    options: Pick<DoclingHybridChunkOptions, "maxTokens">,
    signal?: AbortSignal,
  ): Promise<HybridChunkResult> {
    const safeTaskId = encodeURIComponent(z.string().min(1).parse(taskId))
    const response = await this.request(`/v1/result/${safeTaskId}`, {
      method: "GET",
      ...(signal ? { signal } : {}),
    })
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (!contentType.includes("json")) {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
    }
    return parseHybridChunkResponse(await readJson(response), options)
  }

  private async request(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs ?? 30_000)
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout
    try {
      const headers = new Headers(init.headers)
      if (!headers.has("x-api-key")) headers.set("x-api-key", this.config.apiKey)
      headers.set("x-tenant-id", this.tenantId)
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal,
      })
      if (response.ok) return response
      if (response.status === 401 || response.status === 403) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED",
        )
      }
      if (await isDoclingTaskNotFoundResponse(path, response)) {
        throw new KnowledgeProcessingError(
          "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
        )
      }
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        {
          retryable:
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        },
      )
    } catch (error) {
      if (error instanceof KnowledgeProcessingError) throw error
      throw new KnowledgeProcessingError(
        "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
        { cause: error, retryable: true },
      )
    }
  }
}

const hybridHealthFilename = "linksense-hybrid-health.json"
const hybridHealthText =
  "LinkSense verifies that Docling Hybrid Chunker can tokenize this document."

function hybridHealthDocument(): Buffer {
  const root = (layer: "body" | "furniture") => ({
    self_ref: `#/${layer}`,
    parent: null,
    children: layer === "body" ? [{ $ref: "#/texts/0" }] : [],
    content_layer: layer,
    meta: null,
    name: "_root_",
    label: "unspecified",
  })
  return Buffer.from(
    JSON.stringify({
      schema_name: "DoclingDocument",
      version: "1.10.0",
      name: "linksense-hybrid-health",
      origin: null,
      furniture: root("furniture"),
      body: root("body"),
      groups: [],
      texts: [
        {
          self_ref: "#/texts/0",
          parent: { $ref: "#/body" },
          children: [],
          content_layer: "body",
          meta: null,
          label: "text",
          prov: [],
          source: [],
          comments: [],
          orig: hybridHealthText,
          text: hybridHealthText,
          formatting: null,
          hyperlink: null,
        },
      ],
      pictures: [],
      tables: [],
      key_value_items: [],
      form_items: [],
      field_regions: [],
      field_items: [],
      pages: {},
    }),
  )
}

async function isDoclingTaskNotFoundResponse(
  path: string,
  response: Response,
): Promise<boolean> {
  if (
    response.status !== 404 ||
    !/^\/v1\/(?:status\/poll|result)\/[^/?#]+$/u.test(path)
  ) {
    return false
  }
  try {
    const parsed = taskNotFoundResponseSchema.safeParse(
      await response.json(),
    )
    if (!parsed.success) return false
    return /^task not found\.?$/iu.test(parsed.data.detail.trim())
  } catch {
    return false
  }
}

function getOpenApiOperation(
  paths: Record<string, unknown>,
  path: string,
  method: string,
): Record<string, unknown> | null {
  const pathItem = asOpenApiObject(paths[path])
  return pathItem ? asOpenApiObject(pathItem[method]) : null
}

function multipartFieldsAreCompatible(
  document: z.infer<typeof openApiSchema>,
  operationPath: string,
  requiredFields: readonly string[],
): boolean {
  const operation = getOpenApiOperation(
    document.paths,
    operationPath,
    "post",
  )
  if (!operation) return false
  const requestBody = resolveOpenApiObject(document, operation.requestBody)
  const content = requestBody ? asOpenApiObject(requestBody.content) : null
  const multipart = content
    ? asOpenApiObject(content["multipart/form-data"])
    : null
  const propertyNames = multipart
    ? collectOpenApiSchemaPropertyNames(document, multipart.schema)
    : new Set<string>()
  return requiredFields.every((field) =>
    propertyNames.has(field),
  )
}

function collectOpenApiSchemaPropertyNames(
  document: z.infer<typeof openApiSchema>,
  value: unknown,
  seenReferences = new Set<string>(),
): Set<string> {
  const object = asOpenApiObject(value)
  if (!object) return new Set()
  const names = new Set<string>()
  const reference = object.$ref
  if (typeof reference === "string" && !seenReferences.has(reference)) {
    seenReferences.add(reference)
    const target = resolveOpenApiPointer(document, reference)
    for (const name of collectOpenApiSchemaPropertyNames(
      document,
      target,
      seenReferences,
    )) {
      names.add(name)
    }
  }
  const properties = asOpenApiObject(object.properties)
  if (properties) {
    for (const name of Object.keys(properties)) names.add(name)
  }
  if (Array.isArray(object.allOf)) {
    for (const member of object.allOf) {
      for (const name of collectOpenApiSchemaPropertyNames(
        document,
        member,
        seenReferences,
      )) {
        names.add(name)
      }
    }
  }
  return names
}

function resolveOpenApiObject(
  document: z.infer<typeof openApiSchema>,
  value: unknown,
  seenReferences = new Set<string>(),
): Record<string, unknown> | null {
  const object = asOpenApiObject(value)
  if (!object) return null
  if (typeof object.$ref !== "string") return object
  if (seenReferences.has(object.$ref)) return null
  seenReferences.add(object.$ref)
  return resolveOpenApiObject(
    document,
    resolveOpenApiPointer(document, object.$ref),
    seenReferences,
  )
}

function resolveOpenApiPointer(
  document: z.infer<typeof openApiSchema>,
  reference: string,
): unknown {
  if (!reference.startsWith("#/")) return undefined
  let current: unknown = document
  for (const encodedSegment of reference.slice(2).split("/")) {
    const segment = encodedSegment.replace(/~1/gu, "/").replace(/~0/gu, "~")
    const object = asOpenApiObject(current)
    if (!object || !(segment in object)) return undefined
    current = object[segment]
  }
  return current
}

function asOpenApiObject(value: unknown): Record<string, unknown> | null {
  return isOpenApiObject(value) ? value : null
}

function isOpenApiObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export type ExtractedDoclingArchive = {
  directory: string
  archivePath: string
  markdownPath: string
  jsonPath: string
  assetPaths: string[]
  cleanup: () => Promise<void>
}

export type DoclingArchiveLimits = {
  maximumEntries: number
  maximumEntryBytes: number
  maximumTotalBytes: number
  maximumCompressionRatio: number
  maximumArchiveBytes?: number
}

const defaultArchiveLimits: DoclingArchiveLimits = {
  maximumEntries: 2_000,
  maximumEntryBytes: 256 * 1024 * 1024,
  maximumTotalBytes: 1024 * 1024 * 1024,
  maximumCompressionRatio: 200,
  maximumArchiveBytes: 512 * 1024 * 1024,
}

export async function extractDoclingArchive(
  input: Readable,
  limits: DoclingArchiveLimits = defaultArchiveLimits,
): Promise<ExtractedDoclingArchive> {
  validateArchiveLimits(limits)
  const directory = await mkdtemp(join(tmpdir(), "linksense-docling-"))
  const archivePath = join(directory, "source.zip")
  const extractionDirectory = join(directory, "contents")
  const seen = new Set<string>()
  const files: string[] = []
  let totalBytes = 0
  let entryCount = 0

  try {
    let archiveBytes = 0
    const archiveLimiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        archiveBytes += chunk.byteLength
        if (archiveBytes > (limits.maximumArchiveBytes ?? limits.maximumTotalBytes)) {
          callback(unsafeArchiveError())
          return
        }
        callback(null, chunk)
      },
    })
    await pipeline(
      input,
      archiveLimiter,
      createWriteStream(archivePath, { flags: "wx" }),
    )
    if (archiveBytes === 0) throw unsafeArchiveError()

    await mkdir(extractionDirectory, { recursive: true })
    const archiveSource = createReadStream(archivePath)
    const archive = unzipper.Parse({ forceStream: true })
    // unzipper.Parse emits close manually, so it cannot be an intermediate
    // pipeline stream. Bridge source errors explicitly and always close both.
    archiveSource.once("error", (error) => archive.destroy(error))
    archive.once("error", () => archiveSource.destroy())
    archiveSource.pipe(archive)
    try {
      for await (const entry of archive) {
        entryCount += 1
        if (entryCount > limits.maximumEntries) {
          entry.autodrain()
          throw unsafeArchiveError()
        }
        const normalized = normalizeArchivePath(entry.path)
        if (seen.has(normalized)) {
          entry.autodrain()
          throw unsafeArchiveError()
        }
        seen.add(normalized)
        if (entry.type === "Directory") {
          entry.autodrain()
          continue
        }
        if (entry.type !== "File") {
          entry.autodrain()
          throw unsafeArchiveError()
        }

        const declaredSize = Number(entry.vars.uncompressedSize ?? 0)
        const compressedSize = Number(entry.vars.compressedSize ?? 0)
        if (
          !Number.isSafeInteger(declaredSize) ||
          !Number.isSafeInteger(compressedSize) ||
          declaredSize < 0 ||
          compressedSize < 0 ||
          declaredSize > limits.maximumEntryBytes ||
          (declaredSize > 0 && compressedSize === 0) ||
          (compressedSize > 0 &&
            declaredSize / compressedSize > limits.maximumCompressionRatio)
        ) {
          entry.autodrain()
          throw unsafeArchiveError()
        }

        const target = join(extractionDirectory, ...normalized.split("/"))
        await mkdir(dirname(target), { recursive: true })
        let entryBytes = 0
        const limiter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            entryBytes += chunk.byteLength
            totalBytes += chunk.byteLength
            if (
              entryBytes > limits.maximumEntryBytes ||
              totalBytes > limits.maximumTotalBytes
            ) {
              callback(unsafeArchiveError())
              return
            }
            callback(null, chunk)
          },
        })
        await pipeline(entry, limiter, createWriteStream(target, { flags: "wx" }))
        files.push(target)
      }
    } finally {
      archiveSource.destroy()
      archive.destroy()
    }

    const markdownFiles = files.filter((file) => file.toLowerCase().endsWith(".md"))
    const jsonFiles = files.filter((file) => file.toLowerCase().endsWith(".json"))
    if (markdownFiles.length !== 1 || jsonFiles.length !== 1) {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
    }
    const primary = new Set([...markdownFiles, ...jsonFiles])
    const assetPaths = files.filter((file) => !primary.has(file))
    if (
      assetPaths.some(
        (file) =>
          !/\.(?:png|jpe?g|webp|tiff?|bmp)$/iu.test(file) ||
          !file.split("/").includes("artifacts"),
      )
    ) {
      throw unsafeArchiveError()
    }
    return {
      directory,
      archivePath,
      markdownPath: markdownFiles[0]!,
      jsonPath: jsonFiles[0]!,
      assetPaths,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    if (error instanceof KnowledgeProcessingError) throw error
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_UNSAFE", {
      cause: error,
    })
  }
}

function validateArchiveLimits(limits: DoclingArchiveLimits): void {
  const values = [
    limits.maximumEntries,
    limits.maximumEntryBytes,
    limits.maximumTotalBytes,
    limits.maximumCompressionRatio,
    limits.maximumArchiveBytes ?? limits.maximumTotalBytes,
  ]
  if (
    values.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  ) {
    throw unsafeArchiveError()
  }
}

export async function readExtractedDoclingArchive(
  extracted: ExtractedDoclingArchive,
): Promise<{
  markdown: string
  markdownBytes: Buffer
  json: unknown
  jsonBytes: Buffer
  assetPaths: string[]
  archivePath: string
}> {
  const [markdownStat, jsonStat, archiveStat] = await Promise.all([
    stat(extracted.markdownPath),
    stat(extracted.jsonPath),
    stat(extracted.archivePath),
  ])
  if (
    !markdownStat.isFile() ||
    markdownStat.size > 64 * 1024 * 1024 ||
    !jsonStat.isFile() ||
    jsonStat.size === 0 ||
    jsonStat.size > 256 * 1024 * 1024 ||
    !archiveStat.isFile() ||
    archiveStat.size === 0
  ) {
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID")
  }
  // The pinned Docling Markdown serializer is a lossy projection and can
  // legitimately emit an empty file for structures that remain present in
  // DoclingDocument JSON. Keep the stat call as an existence check, but never
  // use Markdown byte length as a structural-validity gate.
  try {
    const [markdownBytes, jsonBytes] = await Promise.all([
      readFile(extracted.markdownPath),
      readFile(extracted.jsonPath),
    ])
    const decoder = new TextDecoder("utf-8", { fatal: true })
    const markdown = decoder.decode(markdownBytes)
    const jsonText = decoder.decode(jsonBytes)
    if (containsUnsafeControlCharacter(markdown)) {
      throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_UNSAFE")
    }
    const json: unknown = JSON.parse(jsonText)
    return {
      markdown,
      markdownBytes,
      json,
      jsonBytes,
      assetPaths: extracted.assetPaths,
      archivePath: extracted.archivePath,
    }
  } catch (error) {
    if (error instanceof KnowledgeProcessingError) throw error
    throw new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_INVALID", {
      cause: error,
    })
  }
}

function containsUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    if (
      (codePoint < 0x20 &&
        codePoint !== 0x09 &&
        codePoint !== 0x0a &&
        codePoint !== 0x0d) ||
      codePoint === 0x7f
    ) {
      return true
    }
  }
  return false
}

function createDoclingMultipartStream(input: {
  boundary: string
  file: DoclingInputFile
  fileStream: Readable
  options: DoclingConversionOptions
}): Readable {
  const ocrFields: Array<[string, string]> = [
    ["do_ocr", String(input.options.ocrEnabled)],
    ["force_ocr", "false"],
  ]
  if (input.options.ocrEnabled) {
    ocrFields.push(["ocr_preset", "rapidocr"])
  }
  const fields: Array<[string, string]> = [
    ["to_formats", "md"],
    ["to_formats", "json"],
    ["target_type", "zip"],
    ["image_export_mode", "referenced"],
    ["include_images", "true"],
    ["include_page_images", "false"],
    ["pipeline", "standard"],
    ["table_mode", "accurate"],
    ...ocrFields,
    ["do_code_enrichment", "false"],
    ["do_formula_enrichment", "false"],
    ["do_picture_classification", "false"],
    ["do_picture_description", "false"],
    ["document_timeout", String(input.options.documentTimeoutSeconds)],
  ]
  const safeFilename = basename(input.file.filename)
    .replace(/[\r\n"]/gu, "")
    .slice(0, 255)

  async function* generate() {
    for (const [name, value] of fields) {
      yield Buffer.from(
        `--${input.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      )
    }
    yield Buffer.from(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="files"; filename="${safeFilename}"\r\nContent-Type: ${input.file.contentType}\r\n\r\n`,
    )
    for await (const chunk of input.fileStream) yield chunk
    yield Buffer.from(`\r\n--${input.boundary}--\r\n`)
  }

  return Readable.from(generate())
}

function normalizeArchivePath(value: string): string {
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    posix.isAbsolute(value)
  ) {
    throw unsafeArchiveError()
  }
  const normalized = posix.normalize(value)
  if (
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized !== value.replace(/^\.\//u, "")
  ) {
    throw unsafeArchiveError()
  }
  return normalized
}

function unsafeArchiveError(): KnowledgeProcessingError {
  return new KnowledgeProcessingError("KNOWLEDGE_DOCLING_RESULT_UNSAFE")
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw new KnowledgeProcessingError("KNOWLEDGE_EXTERNAL_RESPONSE_INVALID", {
      cause: error,
    })
  }
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(milliseconds, undefined, { signal })
  } catch (error) {
    if (signal?.aborted) {
      throw new KnowledgeProcessingError("KNOWLEDGE_PROCESSING_CANCELLED")
    }
    throw error
  }
}

function toFetchBody(stream: Readable): BodyInit {
  return Readable.toWeb(stream) as unknown as BodyInit
}
