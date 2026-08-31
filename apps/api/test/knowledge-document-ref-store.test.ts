import { describe, expect, it, vi } from "vitest"

import { TurnKnowledgeDocumentReferenceStore } from "../src/modules/knowledge/knowledge-document-ref-store.js"

const TURN_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_TURN_ID = "00000000-0000-4000-8000-000000000002"
const BASE_ID = "00000000-0000-4000-8000-000000000003"
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000004"
const VERSION_ID = "00000000-0000-4000-8000-000000000005"
const DOCUMENT_CURSOR = "00000000-0000-4000-8000-000000000006"

describe("TurnKnowledgeDocumentReferenceStore", () => {
  it("keeps document references and cursors opaque, turn-scoped, and expiring", async () => {
    const redis = redisFixture()
    const store = new TurnKnowledgeDocumentReferenceStore(redis, 90)
    const documentRef = await store.registerDocument(TURN_ID, {
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
    })
    const listCursor = await store.registerListCursor(TURN_ID, {
      knowledgeBaseId: BASE_ID,
      documentCursor: DOCUMENT_CURSOR,
    })
    const markdownCursor = await store.registerMarkdownCursor(TURN_ID, {
      documentRef,
      byteOffset: 128,
      chunkIndex: 1,
    })

    expect(documentRef).toMatch(/^[A-Za-z0-9_-]{32}$/u)
    expect(documentRef).not.toContain(DOCUMENT_ID)
    await expect(store.readDocument(TURN_ID, documentRef)).resolves.toEqual({
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
      contentVerified: false,
    })
    await expect(
      store.readDocument(OTHER_TURN_ID, documentRef),
    ).resolves.toBeNull()
    await expect(store.readListCursor(TURN_ID, listCursor)).resolves.toEqual({
      knowledgeBaseId: BASE_ID,
      documentCursor: DOCUMENT_CURSOR,
    })
    await expect(
      store.readMarkdownCursor(TURN_ID, markdownCursor),
    ).resolves.toEqual({
      documentRef,
      byteOffset: 128,
      chunkIndex: 1,
    })
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      90,
      expect.any(String),
      expect.any(String),
    )
  })

  it("marks verified content atomically and rejects missing or corrupted entries", async () => {
    const redis = redisFixture()
    const store = new TurnKnowledgeDocumentReferenceStore(redis)
    const documentRef = await store.registerDocument(TURN_ID, {
      knowledgeBaseId: BASE_ID,
      documentId: DOCUMENT_ID,
      documentVersionId: VERSION_ID,
    })

    await expect(
      store.markContentVerified(TURN_ID, documentRef),
    ).resolves.toBe(true)
    await expect(store.readDocument(TURN_ID, documentRef)).resolves.toMatchObject({
      contentVerified: true,
    })
    await expect(
      store.markContentVerified(TURN_ID, "missing-reference-000000000000"),
    ).resolves.toBe(false)

    redis.setRawForField(documentRef, "{not-json")
    await expect(store.readDocument(TURN_ID, documentRef)).resolves.toBeNull()
  })
})

function redisFixture() {
  const hashes = new Map<string, Map<string, string>>()
  let latestDocumentKey = ""
  const evalMock = vi.fn(
    async (
      script: string,
      _numberOfKeys: number,
      ...args: Array<string | number>
    ) => {
      const key = String(args[0])
      const field = String(args[2])
      const rawValue = args[3]
      const value = rawValue === undefined ? undefined : String(rawValue)
      const hash = hashes.get(key) ?? new Map<string, string>()
      hashes.set(key, hash)
      if (script.includes("contentVerified")) {
        const raw = hash.get(field)
        if (raw === undefined) return 0
        const parsed = JSON.parse(raw) as Record<string, unknown>
        parsed.contentVerified = true
        hash.set(field, JSON.stringify(parsed))
        return 1
      }
      hash.set(field, value ?? "")
      if (key.includes("knowledge-document-map")) latestDocumentKey = key
      return 1
    },
  )
  return {
    eval: evalMock,
    hget: vi.fn(async (key: string, field: string) => {
      return hashes.get(key)?.get(field) ?? null
    }),
    setRawForField(field: string, value: string) {
      hashes.get(latestDocumentKey)?.set(field, value)
    },
  }
}
