import type { Conversation } from "@/api/contracts"

export type ConversationDraftSnapshot = Readonly<{
  input: string
  capabilityIds: readonly string[]
  knowledgeBaseIds: readonly string[]
}>

export type ConversationDraftField =
  "input" | "capabilityIds" | "knowledgeBaseIds"

export type ConversationDraftMergeResult = Readonly<{
  snapshot: ConversationDraftSnapshot
  conflictingFields: readonly ConversationDraftField[]
}>

export function createConversationDraftSnapshot(
  input: string,
  capabilityIds: readonly string[],
  knowledgeBaseIds: readonly string[]
): ConversationDraftSnapshot {
  return {
    input,
    capabilityIds: [...capabilityIds],
    knowledgeBaseIds: [...knowledgeBaseIds],
  }
}

export function effectiveDraftCapabilityIds(
  conversation: Conversation
): string[] {
  return conversation.application
    ? []
    : [...(conversation.draft_capability_ids ?? [])]
}

export function effectiveDraftKnowledgeBaseIds(
  conversation: Conversation
): string[] {
  if (conversation.application) return []
  const draftKnowledgeBaseIds =
    conversation.draft?.knowledge_base_ids ??
    conversation.draft_knowledge_base_ids ??
    []
  return draftKnowledgeBaseIds.length > 0
    ? [...draftKnowledgeBaseIds]
    : [...(conversation.selected_knowledge_base_ids ?? [])]
}

export function conversationDraftSnapshotFromConversation(
  conversation: Conversation
): ConversationDraftSnapshot {
  return createConversationDraftSnapshot(
    conversation.draft_input ?? "",
    effectiveDraftCapabilityIds(conversation),
    effectiveDraftKnowledgeBaseIds(conversation)
  )
}

export function conversationDraftSnapshotKey(
  snapshot: ConversationDraftSnapshot
): string {
  return JSON.stringify({
    input: snapshot.input,
    capability_ids: snapshot.capabilityIds,
    knowledge_base_ids: snapshot.knowledgeBaseIds,
  })
}

export function conversationDraftSnapshotsEqual(
  left: ConversationDraftSnapshot,
  right: ConversationDraftSnapshot
): boolean {
  return (
    conversationDraftSnapshotKey(left) === conversationDraftSnapshotKey(right)
  )
}

function stringArraysEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function mergeField<T>(
  base: T,
  local: T,
  remote: T,
  equals: (left: T, right: T) => boolean
): Readonly<{ value: T; conflict: boolean }> {
  if (equals(local, remote)) return { value: local, conflict: false }
  if (equals(local, base)) return { value: remote, conflict: false }
  if (equals(remote, base)) return { value: local, conflict: false }
  return { value: local, conflict: true }
}

export function mergeConversationDraftSnapshots(
  base: ConversationDraftSnapshot,
  local: ConversationDraftSnapshot,
  remote: ConversationDraftSnapshot
): ConversationDraftMergeResult {
  const input = mergeField(base.input, local.input, remote.input, Object.is)
  const capabilityIds = mergeField(
    base.capabilityIds,
    local.capabilityIds,
    remote.capabilityIds,
    stringArraysEqual
  )
  const knowledgeBaseIds = mergeField(
    base.knowledgeBaseIds,
    local.knowledgeBaseIds,
    remote.knowledgeBaseIds,
    stringArraysEqual
  )
  const conflictingFields: ConversationDraftField[] = []
  if (input.conflict) conflictingFields.push("input")
  if (capabilityIds.conflict) conflictingFields.push("capabilityIds")
  if (knowledgeBaseIds.conflict) conflictingFields.push("knowledgeBaseIds")

  return {
    snapshot: createConversationDraftSnapshot(
      input.value,
      capabilityIds.value,
      knowledgeBaseIds.value
    ),
    conflictingFields,
  }
}
