/**
 * Keep every title write within the PostgreSQL conversations.title contract.
 * Array.from operates on Unicode code points, so truncating never splits an
 * emoji surrogate pair.
 */
export const MAX_CONVERSATION_TITLE_CHARACTERS = 240;

export function truncateConversationTitle(value: string): string {
  const characters = Array.from(value);
  if (characters.length <= MAX_CONVERSATION_TITLE_CHARACTERS) return value;
  return `${characters
    .slice(0, MAX_CONVERSATION_TITLE_CHARACTERS - 1)
    .join("")}…`;
}
