import { z } from "zod"

const projectOpenSchema = z.boolean()

export function sidebarProjectStorageKey(
  userId: string,
  projectId: string
): string {
  return `linksense.sidebar-project-open:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}`
}

export function readSidebarProjectOpen(
  userId: string,
  projectId: string
): boolean {
  try {
    const raw = window.localStorage.getItem(
      sidebarProjectStorageKey(userId, projectId)
    )
    if (raw === null) return true
    const parsed = projectOpenSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : true
  } catch {
    return true
  }
}

export function rememberSidebarProjectOpen(
  userId: string,
  projectId: string,
  open: boolean
): void {
  try {
    window.localStorage.setItem(
      sidebarProjectStorageKey(userId, projectId),
      JSON.stringify(open)
    )
  } catch {
    // Toggling remains available when browser storage is blocked or full.
  }
}
