import Fastify from "fastify"
import { describe, expect, it, vi } from "vitest"

import { internalKnowledgeSearchRoutes } from "../src/modules/knowledge/internal-routes.js"
import type { InternalKnowledgeSearchService } from "../src/modules/knowledge/internal-search.js"

const sharedSecret = "s".repeat(32)
const ownerId = "10000000-0000-4000-8000-000000000001"
const conversationId = "20000000-0000-4000-8000-000000000002"
const turnId = "30000000-0000-4000-8000-000000000003"

describe("internalKnowledgeSearchRoutes", () => {
  it("authenticates the runner and preserves per-call retrieval parameters", async () => {
    const search = vi.fn().mockResolvedValue({
      success: true,
      results: [],
      unavailable_knowledge_base_count: 0,
    })
    const app = await createApp(search)
    const response = await app.inject({
      method: "POST",
      url: "/internal/knowledge/search",
      headers: {
        authorization: `Bearer ${sharedSecret}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        conversationId,
        turnId,
        query: "年度制度",
        finalTopK: 5,
        candidateMultiplier: 3,
        numCandidates: 80,
        minScore: 0.2,
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      success: true,
      results: [],
      unavailable_knowledge_base_count: 0,
    })
    expect(search).toHaveBeenCalledWith({
      ownerId,
      conversationId,
      turnId,
      query: "年度制度",
      finalTopK: 5,
      candidateMultiplier: 3,
      numCandidates: 80,
      minScore: 0.2,
      signal: expect.any(AbortSignal),
    })
    await app.close()
  })

  it("rejects a request without the runner shared secret", async () => {
    const search = vi.fn()
    const app = await createApp(search)
    const response = await app.inject({
      method: "POST",
      url: "/internal/knowledge/search",
      headers: { "x-linksense-owner-id": ownerId },
      payload: {
        conversationId,
        turnId,
        query: "test",
        finalTopK: 5,
        candidateMultiplier: 3,
        minScore: 0.2,
      },
    })

    expect(response.statusCode).toBe(401)
    expect(search).not.toHaveBeenCalled()
    await app.close()
  })

  it("forwards only opaque document references and cursors to document services", async () => {
    const search = vi.fn()
    const listDocuments = vi.fn().mockResolvedValue({
      success: true,
      documents: [],
      next_cursor: null,
      unavailable_knowledge_base_count: 0,
    })
    const getDocumentMarkdown = vi.fn().mockResolvedValue({
      success: true,
      markdown: "# 完整内容",
      complete: true,
    })
    const app = await createApp(search, listDocuments, getDocumentMarkdown)
    const headers = {
      authorization: `Bearer ${sharedSecret}`,
      "x-linksense-owner-id": ownerId,
    }
    const listCursor = "list-cursor-000000000000000001"
    const documentRef = "document-ref-0000000000000001"
    const markdownCursor = "markdown-cursor-00000000000001"

    const listed = await app.inject({
      method: "POST",
      url: "/internal/knowledge/documents",
      headers,
      payload: { conversationId, turnId, cursor: listCursor },
    })
    expect(listed.statusCode).toBe(200)
    expect(listDocuments).toHaveBeenCalledWith({
      ownerId,
      conversationId,
      turnId,
      cursor: listCursor,
    })

    const markdown = await app.inject({
      method: "POST",
      url: "/internal/knowledge/document-markdown",
      headers,
      payload: {
        conversationId,
        turnId,
        documentRef,
        cursor: markdownCursor,
      },
    })
    expect(markdown.statusCode).toBe(200)
    expect(getDocumentMarkdown).toHaveBeenCalledWith({
      ownerId,
      conversationId,
      turnId,
      documentRef,
      cursor: markdownCursor,
    })
    await app.close()
  })
})

async function createApp(
  search: ReturnType<typeof vi.fn>,
  listDocuments = vi.fn(),
  getDocumentMarkdown = vi.fn(),
) {
  const app = Fastify()
  await app.register(internalKnowledgeSearchRoutes, {
    prefix: "/internal",
    service: {
      search,
      listDocuments,
      getDocumentMarkdown,
    } as unknown as InternalKnowledgeSearchService,
    sharedSecret,
  })
  return app
}
