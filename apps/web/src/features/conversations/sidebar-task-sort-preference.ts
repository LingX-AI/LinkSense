import { z } from "zod"

export const sidebarTaskSortModeSchema = z.enum([
  "priority",
  "updated_at",
  "manual",
])

export type SidebarTaskSortMode = z.infer<typeof sidebarTaskSortModeSchema>
export type SidebarTaskSortScope = "pinned" | "projects" | "recent"

export type SidebarTaskSortModes = Record<
  SidebarTaskSortScope,
  SidebarTaskSortMode
>

const sidebarTaskSortModesSchema = z.strictObject({
  pinned: sidebarTaskSortModeSchema,
  projects: sidebarTaskSortModeSchema,
  recent: sidebarTaskSortModeSchema,
})

export const defaultSidebarTaskSortModes: SidebarTaskSortModes = {
  pinned: "manual",
  projects: "updated_at",
  recent: "updated_at",
}

export function sidebarTaskSortStorageKey(userId: string): string {
  return `linksense.sidebar-task-sort:${encodeURIComponent(userId)}`
}

export function readSidebarTaskSortModes(
  userId: string | undefined
): SidebarTaskSortModes {
  if (!userId || typeof window === "undefined") {
    return { ...defaultSidebarTaskSortModes }
  }
  try {
    const raw = window.localStorage.getItem(sidebarTaskSortStorageKey(userId))
    if (raw === null) return { ...defaultSidebarTaskSortModes }
    const parsed = sidebarTaskSortModesSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : { ...defaultSidebarTaskSortModes }
  } catch {
    return { ...defaultSidebarTaskSortModes }
  }
}

export function rememberSidebarTaskSortModes(
  userId: string | undefined,
  modes: SidebarTaskSortModes
): void {
  if (!userId || typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      sidebarTaskSortStorageKey(userId),
      JSON.stringify(sidebarTaskSortModesSchema.parse(modes))
    )
  } catch {
    // Sorting remains available when browser storage is blocked or full.
  }
}
