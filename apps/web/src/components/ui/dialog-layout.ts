import { cn } from "@/lib/utils"

/**
 * For the main scrollable body inside a default p-6 DialogContent. Extend its
 * scrollport to both horizontal edges and leave a small vertical focus gutter,
 * then restore the content inset with padding so focus rings remain visible.
 * Keep headers/footers outside and intermediate wrappers free of clipping.
 * Dialogs using p-0 with padded bodies already scroll at the edge; nested
 * controls (textareas, lists, tables) should retain their own scroll layout.
 */
export function dialogBodyStyles(className?: string): string {
  return cn(
    "-mx-6 -my-1 min-h-0 w-auto overflow-y-auto overscroll-contain px-6 py-1",
    className
  )
}
