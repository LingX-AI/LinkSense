import { getNativeCodexPayload, type ConversationEvent } from "@/api/contracts"

type Stage = "sse_first_text" | "ui_first_text_commit"
type Sample = {
  conversationId: string
  turnId: string
  kind: "new_task" | "follow_up"
  stage: Stage
  startedAt: number
  endedAt: number
}
type Timing = {
  startedAt: number
  kind: Sample["kind"]
  turnId?: string
  candidates: Map<string, Partial<Record<Stage, number>>>
  emitted: Set<Stage>
}

export class ResponseLatencyTracker {
  private readonly pending = new Map<string, Timing>()
  private readonly emit: (sample: Sample) => void
  private readonly now: () => number
  constructor(emit: (sample: Sample) => void, now = () => performance.now()) {
    this.emit = emit
    this.now = now
  }

  begin(conversationId: string, kind: Sample["kind"]) {
    this.pending.delete(conversationId)
    if (this.pending.size >= 64) {
      const oldest = this.pending.keys().next().value
      if (oldest) this.pending.delete(oldest)
    }
    this.pending.set(conversationId, {
      startedAt: this.now(),
      kind,
      candidates: new Map(),
      emitted: new Set(),
    })
  }

  move(from: string, to: string) {
    const timing = this.pending.get(from)
    if (!timing || from === to) return
    this.pending.delete(from)
    this.pending.set(to, timing)
  }

  bind(conversationId: string, turnId: string) {
    const timing = this.pending.get(conversationId)
    if (!timing) return
    timing.turnId = turnId
    this.flush(conversationId, timing)
  }

  record(conversationId: string, turnId: string, stage: Stage) {
    const timing = this.pending.get(conversationId)
    if (!timing || (timing.turnId && timing.turnId !== turnId)) return
    if (!timing.candidates.has(turnId) && timing.candidates.size >= 8) {
      const oldest = timing.candidates.keys().next().value
      if (oldest) timing.candidates.delete(oldest)
    }
    const candidate = timing.candidates.get(turnId) ?? {}
    candidate[stage] ??= this.now()
    timing.candidates.set(turnId, candidate)
    this.flush(conversationId, timing)
  }

  private flush(conversationId: string, timing: Timing) {
    if (!timing.turnId) return
    const candidate = timing.candidates.get(timing.turnId)
    for (const stage of ["sse_first_text", "ui_first_text_commit"] as const) {
      const endedAt = candidate?.[stage]
      if (endedAt === undefined || timing.emitted.has(stage)) continue
      timing.emitted.add(stage)
      this.emit({
        conversationId,
        turnId: timing.turnId,
        kind: timing.kind,
        stage,
        startedAt: timing.startedAt,
        endedAt,
      })
    }
    if (timing.emitted.size === 2) this.pending.delete(conversationId)
  }
}

export const responseLatency = new ResponseLatencyTracker((sample) => {
  const name = `linksense:${sample.stage}`
  try {
    if (performance.getEntriesByName(name).length >= 100)
      performance.clearMeasures(name)
    performance.measure(name, {
      start: sample.startedAt,
      end: sample.endedAt,
      detail: {
        conversationId: sample.conversationId,
        turnId: sample.turnId,
        kind: sample.kind,
      },
    })
  } catch {
    /* Optional diagnostics must never interrupt a conversation. */
  }
})

export function recordFirstTextReceived(
  conversationId: string,
  event: ConversationEvent
): void {
  if (!event.turn_id) return
  const native = getNativeCodexPayload(event)
  const delta =
    event.type === "conversation.message.delta" &&
    typeof event.payload === "object" &&
    event.payload !== null &&
    "role" in event.payload &&
    event.payload.role === "assistant" &&
    "delta" in event.payload
      ? event.payload.delta
      : native?.method === "item/agentMessage/delta"
        ? native.params.delta
        : undefined
  if (typeof delta === "string" && delta.trim())
    responseLatency.record(conversationId, event.turn_id, "sse_first_text")
}
