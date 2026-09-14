import { z } from "zod"

const categoryOpenSchema = z.boolean()

export function sidebarCategoryStorageKey(
  userId: string,
  categoryId: string
): string {
  return `linksense.sidebar-category-open:${encodeURIComponent(userId)}:${encodeURIComponent(categoryId)}`
}

export function readSidebarCategoryOpen(
  userId: string,
  categoryId: string
): boolean {
  try {
    const raw = window.localStorage.getItem(
      sidebarCategoryStorageKey(userId, categoryId)
    )
    if (raw === null) return true
    const parsed = categoryOpenSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : true
  } catch {
    return true
  }
}

export function rememberSidebarCategoryOpen(
  userId: string,
  categoryId: string,
  open: boolean
): void {
  try {
    window.localStorage.setItem(
      sidebarCategoryStorageKey(userId, categoryId),
      JSON.stringify(open)
    )
  } catch {
    // Toggling remains available when browser storage is blocked or full.
  }
}
