import {
  getNativeCodexPayload,
  type ConversationEvent,
  type NativeCodexPayload,
} from "@/api/contracts"

type NativePlanPayload = Extract<
  NativeCodexPayload,
  { method: "turn/plan/updated" }
>

export type ConversationPlanStep = NativePlanPayload["params"]["plan"][number]

export type ConversationTurnPlan = {
  turnId: string
  steps: ConversationPlanStep[]
  currentStepIndex: number | null
  completedCount: number
  total: number
  changedFileCount: number
  sourceEventId: string
  sequenceNo: number
}

function compareEvents(left: ConversationEvent, right: ConversationEvent) {
  if (left.sequence_no !== right.sequence_no) {
    return left.sequence_no < right.sequence_no ? -1 : 1
  }
  const createdAtComparison = left.created_at.localeCompare(right.created_at)
  if (createdAtComparison !== 0) return createdAtComparison
  return left.id.localeCompare(right.id)
}

function uniqueOrderedTurnEvents(events: ConversationEvent[], turnId: string) {
  const latestDuplicateById = new Map<string, ConversationEvent>()

  for (const event of events) {
    if (event.turn_id !== turnId) continue

    const duplicate = latestDuplicateById.get(event.id)
    if (!duplicate || compareEvents(duplicate, event) <= 0) {
      latestDuplicateById.set(event.id, event)
    }
  }

  return [...latestDuplicateById.values()].sort(compareEvents)
}

function deriveCurrentStepIndex(steps: ConversationPlanStep[]) {
  const inProgressIndex = steps.findIndex(
    (step) => step.status === "inProgress"
  )
  if (inProgressIndex >= 0) return inProgressIndex

  const pendingIndex = steps.findIndex((step) => step.status === "pending")
  if (pendingIndex >= 0) return pendingIndex

  return steps.length > 0 ? steps.length - 1 : null
}

function countChangedFiles(events: ConversationEvent[]) {
  const latestFileChangeByItemId = new Map<
    string,
    Extract<
      Extract<
        NativeCodexPayload,
        { method: "item/started" | "item/completed" }
      >["params"]["item"],
      { type: "fileChange" }
    >
  >()

  for (const event of events) {
    const native = getNativeCodexPayload(event)
    if (
      !native ||
      (native.method !== "item/started" &&
        native.method !== "item/completed") ||
      native.params.item.type !== "fileChange"
    ) {
      continue
    }

    latestFileChangeByItemId.set(native.params.item.id, native.params.item)
  }

  const changedPaths = new Set<string>()
  for (const item of latestFileChangeByItemId.values()) {
    for (const change of item.changes) {
      if (change.path) changedPaths.add(change.path)
    }
  }
  return changedPaths.size
}

/**
 * Selects the latest complete native plan snapshot for one LinkSense turn.
 * The local event turn_id is authoritative because Codex turn IDs and local
 * turn IDs belong to different namespaces.
 */
export function selectConversationTurnPlan(
  events: ConversationEvent[],
  turnId: string
): ConversationTurnPlan | null {
  const orderedEvents = uniqueOrderedTurnEvents(events, turnId)
  let latestPlan:
    | {
        event: ConversationEvent
        steps: ConversationPlanStep[]
      }
    | undefined

  for (const event of orderedEvents) {
    const native = getNativeCodexPayload(event)
    if (native?.method !== "turn/plan/updated") continue

    latestPlan = {
      event,
      steps: native.params.plan.map((step) => ({ ...step })),
    }
  }

  if (!latestPlan) return null

  const completedCount = latestPlan.steps.filter(
    (step) => step.status === "completed"
  ).length

  return {
    turnId,
    steps: latestPlan.steps,
    currentStepIndex: deriveCurrentStepIndex(latestPlan.steps),
    completedCount,
    total: latestPlan.steps.length,
    changedFileCount: countChangedFiles(orderedEvents),
    sourceEventId: latestPlan.event.id,
    sequenceNo: latestPlan.event.sequence_no,
  }
}
