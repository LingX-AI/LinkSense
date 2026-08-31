import { arrayMove } from "@dnd-kit/sortable"

export function reorderPendingRequestIds(
  requestIds: readonly string[],
  activeId: string,
  overId: string
) {
  const previousIndex = requestIds.indexOf(activeId)
  const nextIndex = requestIds.indexOf(overId)
  if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) {
    return [...requestIds]
  }
  return arrayMove([...requestIds], previousIndex, nextIndex)
}
