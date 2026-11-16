import type { ConversationMessage, ConversationTurn } from "@/api/contracts"
import { conversationContextCompactionCommand } from "@/features/conversations/conversation-slash-command"

const compactionCommandMessageIdPrefix = "context-compaction-command:"

export function isConversationCompactionCommandMessage(
  message: ConversationMessage
) {
  return message.id.startsWith(compactionCommandMessageIdPrefix)
}

/**
 * A compact turn stores no messages, so the transcript shows the command that
 * started it. Each command sits before the first message created after its
 * turn started, leaving the server order of real messages untouched.
 */
export function insertConversationCompactionCommandMessages(
  messages: readonly ConversationMessage[],
  turns: readonly ConversationTurn[]
): ConversationMessage[] {
  const turnIdsWithMessages = new Set(
    messages.flatMap((message) => (message.turn_id ? [message.turn_id] : []))
  )
  const commands = turns.flatMap((turn): ConversationMessage[] =>
    turn.task_kind !== "compact" || turnIdsWithMessages.has(turn.id)
      ? []
      : [
          {
            id: `${compactionCommandMessageIdPrefix}${turn.id}`,
            role: "user",
            content: conversationContextCompactionCommand,
            turn_id: turn.id,
            created_at: turn.started_at,
          },
        ]
  )
  if (commands.length === 0) return [...messages]

  const merged: ConversationMessage[] = []
  let commandIndex = 0
  for (const message of messages) {
    let nextCommand = commands[commandIndex]
    while (
      nextCommand &&
      (nextCommand.created_at ?? "") <= (message.created_at ?? "")
    ) {
      merged.push(nextCommand)
      commandIndex += 1
      nextCommand = commands[commandIndex]
    }
    merged.push(message)
  }
  return [...merged, ...commands.slice(commandIndex)]
}
