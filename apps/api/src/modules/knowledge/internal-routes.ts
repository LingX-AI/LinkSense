import { timingSafeEqual } from "node:crypto"

import type { FastifyPluginAsync } from "fastify"
import { z } from "zod"

import {
  getKnowledgeDocumentMarkdownInputSchema,
  listKnowledgeDocumentsInputSchema,
  searchKnowledgeBaseInputSchema,
} from "@linksense/shared"

import { AppError } from "../../lib/errors.js"
import type { InternalKnowledgeSearchService } from "./internal-search.js"

const ownerIdHeaderSchema = z.uuid()
const internalKnowledgeSearchInputSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  query: searchKnowledgeBaseInputSchema.shape.query,
  finalTopK: searchKnowledgeBaseInputSchema.shape.final_top_k,
  candidateMultiplier:
    searchKnowledgeBaseInputSchema.shape.candidate_multiplier,
  numCandidates: searchKnowledgeBaseInputSchema.shape.num_candidates,
  minScore: searchKnowledgeBaseInputSchema.shape.min_score,
})
const internalKnowledgeDocumentListInputSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  cursor: listKnowledgeDocumentsInputSchema.shape.cursor,
})
const internalKnowledgeDocumentMarkdownInputSchema = z.strictObject({
  conversationId: z.uuid(),
  turnId: z.uuid(),
  documentRef:
    getKnowledgeDocumentMarkdownInputSchema.shape.document_ref,
  cursor: getKnowledgeDocumentMarkdownInputSchema.shape.cursor,
})

export const internalKnowledgeSearchRoutes: FastifyPluginAsync<{
  service: InternalKnowledgeSearchService
  sharedSecret: string
}> = async (app, options) => {
  app.addHook("onRequest", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? ""
    if (!safeEqual(token, options.sharedSecret)) {
      return reply.code(401).send({ error_code: "AUTH_REQUIRED" })
    }
  })

  app.post("/knowledge/search", async (request, reply) => {
    const ownerId = ownerIdHeaderSchema.parse(
      request.headers["x-linksense-owner-id"],
    )
    const body = internalKnowledgeSearchInputSchema.parse(request.body)
    const controller = new AbortController()
    const abortRequest = () => controller.abort()
    const abortDisconnectedReply = () => {
      if (!reply.raw.writableEnded) controller.abort()
    }
    request.raw.once("aborted", abortRequest)
    reply.raw.once("close", abortDisconnectedReply)
    try {
      return reply.send(
        await options.service.search({
          ownerId,
          conversationId: body.conversationId,
          turnId: body.turnId,
          query: body.query,
          finalTopK: body.finalTopK,
          candidateMultiplier: body.candidateMultiplier,
          ...(body.numCandidates === undefined
            ? {}
            : { numCandidates: body.numCandidates }),
          minScore: body.minScore,
          signal: controller.signal,
        }),
      )
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError("KNOWLEDGE_SEARCH_UNAVAILABLE")
    } finally {
      request.raw.off("aborted", abortRequest)
      reply.raw.off("close", abortDisconnectedReply)
    }
  })

  app.post("/knowledge/documents", async (request, reply) => {
    const ownerId = ownerIdHeaderSchema.parse(
      request.headers["x-linksense-owner-id"],
    )
    const body = internalKnowledgeDocumentListInputSchema.parse(request.body)
    try {
      return reply.send(
        await options.service.listDocuments({
          ownerId,
          conversationId: body.conversationId,
          turnId: body.turnId,
          ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
        }),
      )
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE")
    }
  })

  app.post("/knowledge/document-markdown", async (request, reply) => {
    const ownerId = ownerIdHeaderSchema.parse(
      request.headers["x-linksense-owner-id"],
    )
    const body = internalKnowledgeDocumentMarkdownInputSchema.parse(
      request.body,
    )
    try {
      return reply.send(
        await options.service.getDocumentMarkdown({
          ownerId,
          conversationId: body.conversationId,
          turnId: body.turnId,
          documentRef: body.documentRef,
          ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
        }),
      )
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError("KNOWLEDGE_PROCESSING_UNAVAILABLE")
    }
  })
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}
