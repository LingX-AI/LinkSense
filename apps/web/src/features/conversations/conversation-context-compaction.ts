import type { ConversationTurn } from "@/api/contracts"

type ConversationContextCompactionAvailability = Readonly<{
  isNew: boolean
  archived: boolean
  latestTurnStatus: ConversationTurn["status"] | undefined
  turnExecutionActive: boolean
}>

export function isConversationContextCompactionAvailable({
  isNew,
  archived,
  latestTurnStatus,
  turnExecutionActive,
}: ConversationContextCompactionAvailability) {
  return (
    !isNew &&
    !archived &&
    latestTurnStatus !== undefined &&
    latestTurnStatus !== "running" &&
    !turnExecutionActive
  )
}
