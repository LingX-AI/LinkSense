export class ConversationReferenceRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode?: string,
  ) {
    super("Conversation reference unavailable");
  }
}
