import dayjs from "dayjs"

export const conversationTimeSeparatorThresholdMs = 2 * 60 * 60 * 1_000

export function shouldShowConversationTimeSeparator(
  previousTimestamp: string | null | undefined,
  currentTimestamp: string | null | undefined
): boolean {
  if (!previousTimestamp || !currentTimestamp) return false
  const previous = dayjs(previousTimestamp)
  const current = dayjs(currentTimestamp)
  if (!previous.isValid() || !current.isValid()) return false
  return current.diff(previous) > conversationTimeSeparatorThresholdMs
}
