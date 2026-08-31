import { conversationFormAcceptedOutcome } from "@linksense/shared"

import type { ConversationUserInputRequest } from "@/api/contracts"

export type ConversationUserInputDisplayStatus =
  | "pending"
  | "submitting"
  | "submitted"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "terminated"

export function getConversationUserInputDisplayStatus(
  request: ConversationUserInputRequest
): ConversationUserInputDisplayStatus {
  if (request.status === "pending") return "pending"
  if (request.status === "answering") return "submitting"
  if (request.status === "expired") return "expired"
  if (request.status === "cancelled") {
    if (request.resolved_action === "decline") return "rejected"
    if (request.resolved_action === "cancel") return "cancelled"
    return "terminated"
  }
  if (request.kind === "form") {
    return conversationFormAcceptedOutcome(
      request.response_semantics,
      request.response_content
    )
  }
  return "submitted"
}

export function isTerminalUserInputDisplayStatus(
  status: ConversationUserInputDisplayStatus
): boolean {
  return status !== "pending" && status !== "submitting"
}
