import { z } from "zod"

const projectPreferenceSchema = z.string().uuid().nullable()
const navigationSchema = z.looseObject({
  newTaskSource: z
    .object({
      userId: z.string().min(1),
      conversationId: z.string().min(1).max(200),
    })
    .optional(),
})

export function newProjectStorageKey(userId: string): string {
  return `linksense.new-project:${encodeURIComponent(userId)}`
}

export function readNewProject(userId: string): string | null {
  try {
    const raw = window.localStorage.getItem(newProjectStorageKey(userId))
    if (raw === null) return null
    const parsed = projectPreferenceSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function rememberNewProject(
  userId: string,
  projectId: string | null
): void {
  const value = projectPreferenceSchema.parse(projectId)
  try {
    window.localStorage.setItem(
      newProjectStorageKey(userId),
      JSON.stringify(value)
    )
  } catch {
    // A blocked or full browser store must not prevent choosing a project.
  }
}

export function newProjectNavigationState(
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
