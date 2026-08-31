import { randomBytes } from "node:crypto"

import { z } from "zod"

const DEFAULT_REFERENCE_TTL_SECONDS = 24 * 60 * 60
const DOCUMENT_MAP_KEY_PREFIX = "linksense:knowledge-document-map:"
const LIST_CURSOR_MAP_KEY_PREFIX =
  "linksense:knowledge-document-list-cursor-map:"
const MARKDOWN_CURSOR_MAP_KEY_PREFIX =
  "linksense:knowledge-document-markdown-cursor-map:"
const STORE_HASH_VALUE_SCRIPT = `
redis.call('HSET', KEYS[1], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`
const MARK_DOCUMENT_VERIFIED_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[2])
if not raw then
  return 0
end
local value = cjson.decode(raw)
value.contentVerified = true
redis.call('HSET', KEYS[1], ARGV[2], cjson.encode(value))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
return 1
`

const documentReferenceSchema = z.strictObject({
  knowledgeBaseId: z.uuid(),
  documentId: z.uuid(),
  documentVersionId: z.uuid(),
  contentVerified: z.boolean(),
})
const listCursorSchema = z.strictObject({
  knowledgeBaseId: z.uuid(),
  documentCursor: z.uuid().nullable(),
})
const markdownCursorSchema = z.strictObject({
  documentRef: z.string().min(16).max(256),
  byteOffset: z.number().int().safe().nonnegative(),
  chunkIndex: z.number().int().safe().nonnegative(),
})

type KnowledgeDocumentReferenceRedisClient = {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>
  hget(key: string, field: string): Promise<string | null>
}

export type TurnKnowledgeDocumentReference = z.infer<
  typeof documentReferenceSchema
>
export type TurnKnowledgeDocumentListCursor = z.infer<
  typeof listCursorSchema
>
export type TurnKnowledgeDocumentMarkdownCursor = z.infer<
  typeof markdownCursorSchema
>

/**
 * Keeps model-visible document handles and pagination cursors in Redis.
 *
 * Handles are scoped to one projected turn, expire automatically, and contain
 * no business identifiers. Every consuming API call still rechecks the turn
 * snapshot, current authorization, document state, and exact current version.
 */
export class TurnKnowledgeDocumentReferenceStore {
  constructor(
    private readonly redis: KnowledgeDocumentReferenceRedisClient,
    private readonly ttlSeconds = DEFAULT_REFERENCE_TTL_SECONDS,
  ) {}

  async registerDocument(
    projectionTurnId: string,
    document: Omit<TurnKnowledgeDocumentReference, "contentVerified">,
  ): Promise<string> {
    const documentRef = createOpaqueReference()
    await this.#store(
      documentMapKey(projectionTurnId),
      documentRef,
      documentReferenceSchema.parse({
        ...document,
        contentVerified: false,
      }),
    )
    return documentRef
  }

  async readDocument(
    projectionTurnId: string,
    documentRef: string,
  ): Promise<TurnKnowledgeDocumentReference | null> {
    return this.#read(
      documentMapKey(projectionTurnId),
      documentRef,
      documentReferenceSchema,
    )
  }

  async markContentVerified(
    projectionTurnId: string,
    documentRef: string,
  ): Promise<boolean> {
    const updated = await this.redis.eval(
      MARK_DOCUMENT_VERIFIED_SCRIPT,
      1,
      documentMapKey(projectionTurnId),
      this.ttlSeconds,
      documentRef,
    )
    return Number(updated) === 1
  }

  async registerListCursor(
    projectionTurnId: string,
    cursor: TurnKnowledgeDocumentListCursor,
  ): Promise<string> {
    const cursorRef = createOpaqueReference()
    await this.#store(
      listCursorMapKey(projectionTurnId),
      cursorRef,
      listCursorSchema.parse(cursor),
    )
    return cursorRef
  }

  async readListCursor(
    projectionTurnId: string,
    cursorRef: string,
  ): Promise<TurnKnowledgeDocumentListCursor | null> {
    return this.#read(
      listCursorMapKey(projectionTurnId),
      cursorRef,
      listCursorSchema,
    )
  }

  async registerMarkdownCursor(
    projectionTurnId: string,
    cursor: TurnKnowledgeDocumentMarkdownCursor,
  ): Promise<string> {
    const cursorRef = createOpaqueReference()
    await this.#store(
      markdownCursorMapKey(projectionTurnId),
      cursorRef,
      markdownCursorSchema.parse(cursor),
    )
    return cursorRef
  }

  async readMarkdownCursor(
    projectionTurnId: string,
    cursorRef: string,
  ): Promise<TurnKnowledgeDocumentMarkdownCursor | null> {
    return this.#read(
      markdownCursorMapKey(projectionTurnId),
      cursorRef,
      markdownCursorSchema,
    )
  }

  async #store(
    key: string,
    field: string,
    value: unknown,
  ): Promise<void> {
    await this.redis.eval(
      STORE_HASH_VALUE_SCRIPT,
      1,
      key,
      this.ttlSeconds,
      field,
      JSON.stringify(value),
    )
  }

  async #read<T>(
    key: string,
    field: string,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    const raw = await this.redis.hget(key, field)
    if (raw === null) return null
    try {
      const parsed = schema.safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }
}

function documentMapKey(projectionTurnId: string): string {
  return `${DOCUMENT_MAP_KEY_PREFIX}${z.uuid().parse(projectionTurnId)}`
}

function listCursorMapKey(projectionTurnId: string): string {
  return `${LIST_CURSOR_MAP_KEY_PREFIX}${z.uuid().parse(projectionTurnId)}`
}

function markdownCursorMapKey(projectionTurnId: string): string {
  return `${MARKDOWN_CURSOR_MAP_KEY_PREFIX}${z.uuid().parse(projectionTurnId)}`
}

function createOpaqueReference(): string {
  return randomBytes(24).toString("base64url")
}
