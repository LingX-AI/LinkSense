export class ConversationReferenceRequestError extends Error {
  constructor(readonly statusCode: number) { super("Conversation reference unavailable"); }
}
