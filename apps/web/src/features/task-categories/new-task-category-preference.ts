import { z } from "zod"

const categoryPreferenceSchema = z.string().uuid().nullable()
const navigationSchema = z.looseObject({
  newTaskSource: z
    .object({
      userId: z.string().min(1),
      conversationId: z.string().min(1).max(200),
    })
    .optional(),
})

export function newTaskCategoryStorageKey(userId: string): string {
  return `linksense.new-task-category:${encodeURIComponent(userId)}`
}

export function readNewTaskCategory(userId: string): string | null {
  try {
    const raw = window.localStorage.getItem(newTaskCategoryStorageKey(userId))
    if (raw === null) return null
    const parsed = categoryPreferenceSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function rememberNewTaskCategory(
  userId: string,
  categoryId: string | null
): void {
  const value = categoryPreferenceSchema.parse(categoryId)
  try {
    window.localStorage.setItem(
      newTaskCategoryStorageKey(userId),
      JSON.stringify(value)
    )
  } catch {
    // A blocked or full browser store must not prevent choosing a category.
  }
}

export function newTaskCategoryNavigationState(
  userId: string | undefined,
  conversationId: string | undefined
): { newTaskSource: { userId: string; conversationId: string } } | null {
  return userId && conversationId && conversationId !== "new"
    ? { newTaskSource: { userId, conversationId } }
    : null
}

export function readNewTaskSource(
  state: unknown,
  userId: string | undefined
): string | undefined {
  const parsed = navigationSchema.safeParse(state)
  const source = parsed.success ? parsed.data.newTaskSource : undefined
  return source?.userId === userId ? source?.conversationId : undefined
}

export function withoutNewTaskSource(
  state: unknown
): Record<string, unknown> | null {
  const parsed = navigationSchema.safeParse(state)
  if (!parsed.success) return null
  delete parsed.data.newTaskSource
  return parsed.data
}
