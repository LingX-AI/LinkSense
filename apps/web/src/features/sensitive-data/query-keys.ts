export const sensitiveDataUserQueries = ["sensitive-data", "user"] as const

export const sensitiveDataUserQueryKey = (ownerId: string | undefined) =>
  [...sensitiveDataUserQueries, ownerId] as const

export const sensitiveDataTaskQueryKey = (
  ownerId: string | undefined,
  conversationId: string | undefined
) => ["sensitive-data", "task", ownerId, conversationId] as const
