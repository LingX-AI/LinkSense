import { z } from "zod"

const localConversationDraftSchema = z.strictObject({
  version: z.literal(1),
  input: z.string().max(1_000_000),
  capability_ids: z.array(z.string()),
  knowledge_base_ids: z.array(z.string()),
  task_references: z
    .array(z.object({ id: z.uuid(), title: z.string().max(240) }))
    .max(3)
    .optional(),
  idempotency_key: z.string().min(1).max(120).optional(),
})

export type LocalConversationDraft = Readonly<{
  input: string
  capabilityIds: readonly string[]
  knowledgeBaseIds: readonly string[]
  taskReferences?: readonly { id: string; title: string }[]
  idempotencyKey?: string
}>

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

const desktopAttachmentStartSchema = z.strictObject({
  idempotencyKey: z.uuid(),
  createdAt: z.iso.datetime(),
})

type DesktopAttachmentStart = z.infer<typeof desktopAttachmentStartSchema>

function desktopAttachmentStartKey(
  userId: string,
  conversationId: string
): string {
  return `linksense.desktop-attachment-start.v1:${encodeURIComponent(userId)}:${encodeURIComponent(conversationId)}`
}

export function readDesktopAttachmentStart(
  userId: string,
  conversationId: string
): DesktopAttachmentStart | undefined {
  try {
    const raw = window.sessionStorage.getItem(
      desktopAttachmentStartKey(userId, conversationId)
    )
    return raw
      ? desktopAttachmentStartSchema.safeParse(JSON.parse(raw)).data
      : undefined
  } catch {
    return undefined
  }
}

export function writeDesktopAttachmentStart(
  userId: string,
  conversationId: string,
  start: DesktopAttachmentStart
): void {
  try {
    window.sessionStorage.setItem(
      desktopAttachmentStartKey(userId, conversationId),
      JSON.stringify(start)
    )
  } catch {
    return
  }
}

export function clearDesktopAttachmentStart(
  userId: string,
  conversationId: string,
  idempotencyKey?: string
): void {
  try {
    if (
      idempotencyKey &&
      readDesktopAttachmentStart(userId, conversationId)?.idempotencyKey !==
        idempotencyKey
    )
      return
    window.sessionStorage.removeItem(
      desktopAttachmentStartKey(userId, conversationId)
    )
  } catch {
    return
  }
}

export const EMPTY_LOCAL_CONVERSATION_DRAFT: LocalConversationDraft = {
  input: "",
  capabilityIds: [],
  knowledgeBaseIds: [],
}

export function localConversationDraftStorageKey(
  userId: string,
  conversationScope: string
): string {
  return `linksense.conversation-draft.v1:${encodeURIComponent(userId)}:${encodeURIComponent(conversationScope)}`
}

export function readLocalConversationDraft(
  storage: DraftStorage,
  userId: string,
  conversationScope: string
): LocalConversationDraft {
  const key = localConversationDraftStorageKey(userId, conversationScope)
  try {
    const raw = storage.getItem(key)
    if (!raw) return EMPTY_LOCAL_CONVERSATION_DRAFT
    const parsed = localConversationDraftSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      storage.removeItem(key)
      return EMPTY_LOCAL_CONVERSATION_DRAFT
    }
    return {
      input: parsed.data.input,
      capabilityIds: parsed.data.capability_ids,
      knowledgeBaseIds: parsed.data.knowledge_base_ids,
      ...(parsed.data.task_references?.length
        ? { taskReferences: parsed.data.task_references }
        : {}),
      ...(parsed.data.idempotency_key
        ? { idempotencyKey: parsed.data.idempotency_key }
        : {}),
    }
  } catch {
    try {
      storage.removeItem(key)
    } catch {
      // Ignore unavailable storage.
    }
    return EMPTY_LOCAL_CONVERSATION_DRAFT
  }
}

export function writeLocalConversationDraft(
  storage: DraftStorage,
  userId: string,
  conversationScope: string,
  draft: LocalConversationDraft
): void {
  const key = localConversationDraftStorageKey(userId, conversationScope)
  try {
    if (
      draft.input.length === 0 &&
      draft.capabilityIds.length === 0 &&
      draft.knowledgeBaseIds.length === 0 &&
      !draft.taskReferences?.length
    ) {
      storage.removeItem(key)
      return
    }
    // Hydration retains admission provenance; editing creates an unsent draft.
    const previous = readLocalConversationDraft(
      storage,
      userId,
      conversationScope
    )
    const unchanged =
      previous.input === draft.input &&
      JSON.stringify(previous.capabilityIds) ===
        JSON.stringify(draft.capabilityIds) &&
      JSON.stringify(previous.knowledgeBaseIds) ===
        JSON.stringify(draft.knowledgeBaseIds) &&
      JSON.stringify(previous.taskReferences ?? []) ===
        JSON.stringify(draft.taskReferences ?? [])
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        input: draft.input,
        capability_ids: draft.capabilityIds,
        knowledge_base_ids: draft.knowledgeBaseIds,
        ...(draft.taskReferences?.length
          ? { task_references: draft.taskReferences }
          : {}),
        idempotency_key:
          draft.idempotencyKey ??
          (unchanged ? previous.idempotencyKey : undefined),
      })
    )
  } catch {
    // Draft persistence is best-effort. The composer remains usable when
    // storage is unavailable or full.
  }
}

export function consumeAcceptedLocalConversationDraft(
  storage: DraftStorage,
  userId: string,
  conversationScope: string,
  acceptedKeys: readonly (string | null | undefined)[]
): LocalConversationDraft | null {
  const draft = readLocalConversationDraft(storage, userId, conversationScope)
  if (!draft.idempotencyKey || !acceptedKeys.includes(draft.idempotencyKey))
    return null
  clearLocalConversationDraft(storage, userId, conversationScope)
  return draft
}

export function clearLocalConversationDraft(
  storage: DraftStorage,
  userId: string,
  conversationScope: string
): void {
  try {
    storage.removeItem(
      localConversationDraftStorageKey(userId, conversationScope)
    )
  } catch {
    // Clearing a best-effort draft must never block a successful submission.
  }
}
