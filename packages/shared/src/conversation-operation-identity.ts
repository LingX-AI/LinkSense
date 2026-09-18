/** The persisted request identity for regenerating a specific message. */
export function regenerationIdempotencyKey(messageId: string, requestId: string): string {
  return `regenerate:${messageId}:${requestId}`;
}
