export class ConversationOwnerMismatchError extends Error {
  constructor() {
    super("conversation owner does not match the bound owner")
    this.name = "ConversationOwnerMismatchError"
  }
}

/**
 * The API remains the source of truth for ownership. This registry prevents a
 * malformed or replayed internal request from reusing a loaded conversation
 * process under a different owner before the API can reconcile it.
 */
export class ConversationOwnerRegistry {
  private readonly owners = new Map<string, string>()

  constructor(private readonly fixedOwnerId?: string) {}

  assertOwner(ownerId: string): void {
    if (this.fixedOwnerId && ownerId !== this.fixedOwnerId) {
      throw new ConversationOwnerMismatchError()
    }
  }

  assertAndBind(conversationId: string, ownerId: string): void {
    this.assertOwner(ownerId)
    const current = this.owners.get(conversationId)
    if (current && current !== ownerId) throw new ConversationOwnerMismatchError()
    this.owners.set(conversationId, ownerId)
  }

  assertBound(conversationId: string, ownerId: string): void {
    this.assertOwner(ownerId)
    const current = this.owners.get(conversationId)
    if (current && current !== ownerId) throw new ConversationOwnerMismatchError()
    if (!current) this.owners.set(conversationId, ownerId)
  }

  remove(conversationId: string, ownerId: string): void {
    this.assertBound(conversationId, ownerId)
    this.owners.delete(conversationId)
  }
}
