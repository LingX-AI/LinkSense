import { z } from "zod"

const localConversationDraftSchema = z.strictObject({
  version: z.literal(1),
  input: z.string().max(1_000_000),
  capability_ids: z.array(z.string()),
  knowledge_base_ids: z.array(z.string()),
})

export type LocalConversationDraft = Readonly<{
  input: string
  capabilityIds: readonly string[]
  knowledgeBaseIds: readonly string[]
}>

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">

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
      draft.knowledgeBaseIds.length === 0
    ) {
      storage.removeItem(key)
      return
    }
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        input: draft.input,
        capability_ids: draft.capabilityIds,
        knowledge_base_ids: draft.knowledgeBaseIds,
      })
    )
  } catch {
    // Draft persistence is best-effort. The composer remains usable when
    // storage is unavailable or full.
  }
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
