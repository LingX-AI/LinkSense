import { Readable } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import {
  DOCLING_HYBRID_MAX_TOKENS,
  parseHybridChunkResponse,
} from "../src/modules/knowledge-processing/docling-hybrid.js"
import { DoclingServeClient } from "../src/modules/knowledge-processing/docling.js"

const hybridOptions = {
  tokenizer: "/models/tokenizers/Qwen3-Embedding-4B",
  maxTokens: DOCLING_HYBRID_MAX_TOKENS,
  mergePeers: false as const,
  includeRawText: true as const,
}

describe("Docling Hybrid chunk protocol", () => {
  it("submits the exact Docling JSON through the pinned async Hybrid contract", async () => {
    const json = Buffer.from(JSON.stringify(doclingDocumentFixture()))
    let multipart = ""
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      expect(String(url)).toBe(
        "https://docling.example.test/v1/chunk/hybrid/file/async",
      )
      const headers = new Headers(init?.headers)
      expect(headers.get("x-api-key")).toBe("secret")
      expect(headers.get("x-tenant-id")).toBe("knowledge")
      multipart = await new Response(init?.body).text()
      return Response.json(taskStatus("chunk"))
    })
    const client = new DoclingServeClient(
      {
        baseUrl: "https://docling.example.test",
        apiKey: "secret",
        tenantId: "knowledge",
      },
      fetcher,
    )

    await expect(
      client.submitHybridChunk({
        filename: "policy.pdf",
        json,
        options: hybridOptions,
      }),
    ).resolves.toMatchObject({ task_id: "task-id", task_type: "chunk" })

    expect(multipart).toContain(
      'name="files"; filename="policy.json"\r\nContent-Type: application/json',
    )
    expect(multipart).toContain(
      'name="convert_from_formats"\r\n\r\njson_docling',
    )
    expect(multipart).toContain(
      'name="chunking_include_raw_text"\r\n\r\ntrue',
    )
    expect(multipart).toContain(
      'name="chunking_tokenizer"\r\n\r\n/models/tokenizers/Qwen3-Embedding-4B',
    )
    expect(multipart).toContain(
      `name="chunking_max_tokens"\r\n\r\n${DOCLING_HYBRID_MAX_TOKENS}`,
    )
    expect(multipart).toContain(
      'name="chunking_merge_peers"\r\n\r\nfalse',
    )
    expect(multipart).toContain(
      'name="chunking_use_markdown_tables"\r\n\r\ntrue',
    )
    expect(multipart).toContain(
      'name="chunking_use_markdown_images"\r\n\r\ntrue',
    )
    expect(multipart).toContain(
      'name="chunking_image_placeholder"\r\n\r\n![IMAGE]',
    )
    expect(multipart).toContain(
      'name="include_converted_doc"\r\n\r\nfalse',
    )
    expect(multipart).toContain('name="target_type"\r\n\r\ninbody')
    expect(multipart).toContain(json.toString("utf8"))
  })

  it("uses the same tenant for conversion submission, status, and result", async () => {
    const seenHeaders: Headers[] = []
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
      seenHeaders.push(new Headers(init?.headers))
      const requestUrl = String(url)
      if (requestUrl.endsWith("/v1/convert/file/async")) {
        await new Response(init?.body).arrayBuffer()
        return Response.json(taskStatus("convert"))
      }
      if (requestUrl.endsWith("/v1/status/poll/task-id")) {
        return Response.json(taskStatus("convert"))
      }
      return new Response(Buffer.from("archive"), {
        headers: { "content-type": "application/zip" },
      })
    })
    const client = new DoclingServeClient(
      {
        baseUrl: "https://docling.example.test",
        apiKey: "secret",
        tenantId: "knowledge",
      },
      fetcher,
    )

    await client.submitConversion(
      {
        filename: "policy.pdf",
        contentType: "application/pdf",
        openStream: async () => Readable.from(Buffer.from("document")),
      },
      { documentTimeoutSeconds: 60, ocrEnabled: false },
    )
    await client.getTaskStatus("task-id")
    await client.getConversionResult("task-id")

    expect(seenHeaders).toHaveLength(3)
    expect(
      seenHeaders.every((headers) => headers.get("x-tenant-id") === "knowledge"),
    ).toBe(true)
  })

  it("maps a strict response without losing child retrieval evidence", async () => {
    const response = hybridResponseFixture()
    const client = new DoclingServeClient(
      {
        baseUrl: "https://docling.example.test",
        apiKey: "secret",
      },
      vi.fn<typeof fetch>().mockResolvedValue(Response.json(response)),
    )

    await expect(
      client.getHybridChunkResult("task-id", {
        maxTokens: DOCLING_HYBRID_MAX_TOKENS,
      }),
    ).resolves.toEqual({
      filename: "policy.json",
      chunks: [
        {
          chunkIndex: 0,
          text: "Policy\nPassword requirements",
          rawText: "Password requirements",
          numTokens: 12,
          headings: ["Policy"],
          captions: [],
          docItems: ["#/texts/0"],
          pageNumbers: [1, 2],
          metadata: { has_image: false },
        },
      ],
    })
  })

  it.each([
    [
      "non-contiguous chunk indexes",
      (response: ReturnType<typeof hybridResponseFixture>) => {
        response.chunks[0]!.chunk_index = 1
      },
    ],
    [
      "over-budget chunks",
      (response: ReturnType<typeof hybridResponseFixture>) => {
        response.chunks[0]!.num_tokens = DOCLING_HYBRID_MAX_TOKENS + 1
      },
    ],
    [
      "unsorted page numbers",
      (response: ReturnType<typeof hybridResponseFixture>) => {
        response.chunks[0]!.page_numbers = [2, 1]
      },
    ],
    [
      "duplicate doc-item references",
      (response: ReturnType<typeof hybridResponseFixture>) => {
        response.chunks[0]!.doc_items = ["#/texts/0", "#/texts/0"]
      },
    ],
    [
      "unexpected response fields",
      (response: ReturnType<typeof hybridResponseFixture>) => {
        Reflect.set(response.chunks[0]!, "future_field", true)
      },
    ],
    [
      "mismatched filenames",
      (response: ReturnType<typeof hybridResponseFixture>) => {
        response.documents[0]!.content.filename = "other.json"
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const response = hybridResponseFixture()
    mutate(response)
    expect(() =>
      parseHybridChunkResponse(response, {
        maxTokens: DOCLING_HYBRID_MAX_TOKENS,
      }),
    ).toThrowError(
      expect.objectContaining({ code: "KNOWLEDGE_DOCLING_RESULT_INVALID" }),
    )
  })

  it("classifies an empty successful response as an unavailable Hybrid chunker", () => {
    const response = hybridResponseFixture()
    response.chunks = []

    expect(() =>
      parseHybridChunkResponse(response, {
        maxTokens: DOCLING_HYBRID_MAX_TOKENS,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "KNOWLEDGE_DOCLING_CHUNKER_UNAVAILABLE",
        retryable: true,
      }),
    )
  })
})

function taskStatus(taskType: "convert" | "chunk") {
  return {
    task_id: "task-id",
    task_type: taskType,
    task_status: "started",
    task_position: null,
    task_meta: {
      num_docs: 1,
      num_processed: 0,
      num_succeeded: 0,
      num_partially_succeeded: 0,
      num_failed: 0,
    },
    error_message: null,
    failure: null,
  }
}

function hybridResponseFixture() {
  return {
    chunks: [
      {
        filename: "policy.json",
        chunk_index: 0,
        text: "Policy\nPassword requirements",
        raw_text: "Password requirements",
        num_tokens: 12,
        headings: ["Policy"],
        captions: null,
        doc_items: ["#/texts/0"],
        page_numbers: [1, 2],
        metadata: { has_image: false },
      },
    ],
    documents: [
      {
        kind: "ExportResult" as const,
        content: {
          filename: "policy.json",
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
    processing_time: 0.25,
  }
}

function doclingDocumentFixture(): Record<string, unknown> {
  return {
    schema_name: "DoclingDocument",
    version: "1.10.0",
    name: "fixture",
    origin: null,
    body: root("body"),
    furniture: root("furniture"),
    groups: [],
    texts: [],
    pictures: [],
    tables: [],
    key_value_items: [],
    form_items: [],
    field_regions: [],
    field_items: [],
    pages: {},
  }
}

function root(layer: "body" | "furniture") {
  return {
    self_ref: `#/${layer}`,
    parent: null,
    children: [],
    content_layer: layer,
    name: "_root_",
    label: "unspecified",
  }
}
