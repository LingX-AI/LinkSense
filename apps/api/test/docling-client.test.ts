import { describe, expect, it, vi } from "vitest"

import { DoclingServeClient } from "../src/modules/knowledge-processing/docling.js"

const baseConfig = {
  baseUrl: "https://docling.example.test",
  apiKey: "docling-key",
}

describe("Docling Serve HTTP error classification", () => {
  it.each([
    ["poll", (client: DoclingServeClient) => client.poll("expired-task")],
    ["result", (client: DoclingServeClient) => client.result("expired-task")],
  ])(
    "classifies a task-not-found response from %s as an expired Docling task",
    async (_operation, request) => {
      const client = new DoclingServeClient(
        baseConfig,
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json(
            { detail: "Task not found." },
            { status: 404 },
          ),
        ),
      )

      await expect(request(client)).rejects.toMatchObject({
        code: "KNOWLEDGE_DOCLING_TASK_NOT_FOUND",
        retryable: false,
      })
    },
  )

  it("keeps an unrelated task-endpoint 404 safely classified as unavailable", async () => {
    const client = new DoclingServeClient(
      baseConfig,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: "Route not found." },
          { status: 404 },
        ),
      ),
    )

    await expect(client.poll("task-id")).rejects.toMatchObject({
      code: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
      retryable: false,
    })
  })

  it("does not treat a task-not-found body from a non-task endpoint as an expired task", async () => {
    const client = new DoclingServeClient(
      baseConfig,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: "Task not found." },
          { status: 404 },
        ),
      ),
    )

    await expect(client.verifyContract()).rejects.toMatchObject({
      code: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
      retryable: false,
    })
  })

  it("preserves authentication failure classification for HTTP 401", async () => {
    const client = new DoclingServeClient(
      baseConfig,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: "Unauthorized" },
          { status: 401 },
        ),
      ),
    )

    await expect(client.poll("task-id")).rejects.toMatchObject({
      code: "KNOWLEDGE_EXTERNAL_SERVICE_AUTHENTICATION_FAILED",
      retryable: false,
    })
  })

  it("preserves retryable service-unavailable classification for HTTP 5xx", async () => {
    const client = new DoclingServeClient(
      baseConfig,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          { detail: "Internal server error" },
          { status: 503 },
        ),
      ),
    )

    await expect(client.result("task-id")).rejects.toMatchObject({
      code: "KNOWLEDGE_EXTERNAL_SERVICE_UNAVAILABLE",
      retryable: true,
    })
  })
})

describe("Docling Serve pinned OpenAPI contract", () => {
  it("requires both async conversion and async Hybrid chunking", async () => {
    const client = new DoclingServeClient(
      baseConfig,
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json(openApiFixture())),
    )

    await expect(client.verifyContract()).resolves.toBeUndefined()
  })

  it("rejects a contract without the async Hybrid endpoint", async () => {
    const openApi = openApiFixture()
    Reflect.deleteProperty(openApi.paths, "/v1/chunk/hybrid/file/async")
    const client = new DoclingServeClient(
      baseConfig,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(openApi)),
    )

    await expect(client.verifyContract()).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE",
    })
  })

  it("rejects a Hybrid multipart contract missing a field sent by LinkSense", async () => {
    const openApi = openApiFixture()
    Reflect.deleteProperty(
      openApi.components.schemas.HybridBody.properties,
      "chunking_include_raw_text",
    )
    const client = new DoclingServeClient(
      baseConfig,
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(openApi)),
    )

    await expect(client.verifyContract()).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCLING_CONTRACT_INCOMPATIBLE",
    })
  })
})

describe("Docling Serve Hybrid capability probe", () => {
  it("runs a real non-empty Hybrid request and caches a successful probe", async () => {
    const fetcher = hybridProbeFetcher(hybridProbeResult())
    const client = new DoclingServeClient(
      {
        ...baseConfig,
        pollIntervalMs: 1,
        hybridProbe: {
          tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
          maxTokens: 768,
          successCacheTtlMs: 60_000,
        },
      },
      fetcher,
    )

    await expect(client.health()).resolves.toBeUndefined()
    await expect(client.health()).resolves.toBeUndefined()

    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/v1/chunk/hybrid/file/async"),
      ),
    ).toHaveLength(1)
    expect(
      fetcher.mock.calls.filter(([url]) =>
        String(url).endsWith("/openapi.json"),
      ),
    ).toHaveLength(2)
  })

  it("rejects Docling's false-success empty result when the default chunker is unavailable", async () => {
    const result = hybridProbeResult()
    result.chunks = []
    const client = new DoclingServeClient(
      {
        ...baseConfig,
        pollIntervalMs: 1,
        hybridProbe: {
          tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
          maxTokens: 768,
        },
      },
      hybridProbeFetcher(result),
    )

    await expect(client.health()).rejects.toMatchObject({
      code: "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE",
      retryable: true,
    })
  })
})

function hybridProbeFetcher(result: ReturnType<typeof hybridProbeResult>) {
  return vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname
    if (path === "/openapi.json") {
      return Response.json(openApiFixture())
    }
    if (path === "/v1/chunk/hybrid/file/async") {
      const multipart = await new Response(init?.body).text()
      expect(multipart).toContain(
        'name="files"; filename="linksense-hybrid-health.json"',
      )
      expect(multipart).toContain(
        'name="chunking_tokenizer"\r\n\r\n/models/tokenizers/Qwen3-Embedding-4B',
      )
      return Response.json(hybridTaskStatus("started"))
    }
    if (path === "/v1/status/poll/hybrid-health-task") {
      return Response.json(hybridTaskStatus("success"))
    }
    if (path === "/v1/result/hybrid-health-task") {
      return Response.json(result)
    }
    return Response.json({ detail: "Route not found." }, { status: 404 })
  })
}

function hybridTaskStatus(status: "started" | "success") {
  return {
    task_id: "hybrid-health-task",
    task_type: "chunk",
    task_status: status,
    task_position: null,
    task_meta: {
      num_docs: 1,
      num_processed: status === "success" ? 1 : 0,
      num_succeeded: status === "success" ? 1 : 0,
      num_partially_succeeded: 0,
      num_failed: 0,
    },
    error_message: null,
    failure: null,
  }
}

function hybridProbeResult() {
  return {
    chunks: [
      {
        filename: "linksense-hybrid-health.json",
        chunk_index: 0,
        text:
          "LinkSense verifies that Docling Hybrid Chunker can tokenize this document.",
        raw_text:
          "LinkSense verifies that Docling Hybrid Chunker can tokenize this document.",
        num_tokens: 13,
        headings: null,
        captions: null,
        doc_items: ["#/texts/0"],
        page_numbers: [],
        metadata: {},
      },
    ],
    documents: [
      {
        kind: "ExportResult" as const,
        content: {
          filename: "linksense-hybrid-health.json",
          md_content: null,
          json_content: null,
          html_content: null,
          text_content: null,
          doctags_content: null,
          doclang_content: null,
        },
        status: "success" as const,
        errors: [],
        timings: {},
        confidence: null,
      },
    ],
    processing_time: 0.1,
  }
}

function openApiFixture() {
  const convertFields = [
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
  ]
  const hybridFields = [
    "files",
    "convert_from_formats",
    "chunking_use_markdown_tables",
    "chunking_use_markdown_images",
    "chunking_image_placeholder",
    "chunking_include_raw_text",
    "chunking_tokenizer",
    "chunking_max_tokens",
    "chunking_merge_peers",
    "include_converted_doc",
    "target_type",
  ]
  const operation = (reference: string) => ({
    requestBody: {
      content: {
        "multipart/form-data": {
          schema: { $ref: reference },
        },
      },
    },
  })
  return {
    openapi: "3.1.0",
    info: { version: "1.27.0" },
    paths: {
      "/v1/convert/file/async": {
        post: operation("#/components/schemas/ConvertBody"),
      },
      "/v1/chunk/hybrid/file/async": {
        post: operation("#/components/schemas/HybridBody"),
      },
      "/v1/status/poll/{task_id}": { get: {} },
      "/v1/result/{task_id}": { get: {} },
    },
    components: {
      schemas: {
        ConvertBody: {
          type: "object",
          properties: Object.fromEntries(
            convertFields.map((field) => [field, {}]),
          ),
        },
        HybridBody: {
          type: "object",
          properties: Object.fromEntries(
            hybridFields.map((field) => [field, {}]),
          ),
        },
      },
    },
  }
}
