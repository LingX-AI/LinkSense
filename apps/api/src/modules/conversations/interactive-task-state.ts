import dayjs from "dayjs";
import {
  INTERACTIVE_APPLICATION_FILE_SOURCE,
  conversationStartFailurePayloadSchema,
  interactiveApplicationTaskStateSchema,
  type InteractiveApplicationTaskState,
} from "@linksense/shared";

interface StateSource {
  conversation?: { execution_status: string };
  starting_turn: {
    turn_id: string;
    created_at: string;
    attachments: { id: string }[];
  } | null;
  turns: {
    id: string;
    status: string;
    started_at: string;
    interrupt_requested_at?: string | null;
  }[];
  files: { id: string; turn_id: string | null; source: string }[];
  user_input_requests: { turn_id: string; status: string }[];
  plan_reviews: { source_turn_id: string; status: string }[];
  pending_requests: unknown[];
  events: { event_type: string; created_at: string; payload: unknown }[];
}

/** A read model of existing records, never an independent execution lifecycle. */
export function projectInteractiveTaskState(
  source: StateSource,
): InteractiveApplicationTaskState {
  const latest = source.turns.at(-1);
  const start = source.starting_turn;
  const unprojectedStart = start && !source.turns.some(turn => turn.id === start.turn_id)
    ? start : null;
  const failure = source.events
    .filter(event => event.event_type === "conversation.error")
    .map(event => ({ ...event, data: conversationStartFailurePayloadSchema.safeParse(event.payload) }))
    .filter(event => event.data.success).at(-1);
  const failedStart = failure?.data.success &&
    (!latest || dayjs(failure.created_at).isAfter(latest.started_at)) &&
    (!unprojectedStart || dayjs(failure.created_at).isAfter(unprojectedStart.created_at))
    ? failure.data.data.start_failure : null;
  const turnId = failedStart?.turn_id ?? unprojectedStart?.turn_id ?? latest?.id ?? null;
  const waiting = latest && ["running", "completed"].includes(latest.status) && (
    source.user_input_requests.some(request =>
      request.turn_id === turnId && ["pending", "answering"].includes(request.status)) ||
    source.plan_reviews.some(review =>
      review.source_turn_id === turnId && ["preparing", "pending"].includes(review.status))
  );
  const status = failedStart ? "failed"
    : unprojectedStart ? "starting"
    : source.conversation?.execution_status === "failed" ? "failed"
    : waiting ? "waiting_for_input"
    : latest?.status ?? "idle";
  const applicationFiles = source.files.filter(file => file.source === INTERACTIVE_APPLICATION_FILE_SOURCE);
  const applicationFileIds = new Set(applicationFiles.map(file => file.id));
  const fileIds = unprojectedStart && !failedStart
    ? unprojectedStart.attachments.filter(file => applicationFileIds.has(file.id)).map(file => file.id)
    : applicationFiles.filter(file =>
      turnId !== null && file.turn_id === turnId,
    ).map(file => file.id);
  return interactiveApplicationTaskStateSchema.parse({
    status,
    turn_id: turnId,
    file_ids: fileIds,
    can_submit: !["starting", "running", "waiting_for_input"].includes(status) && source.pending_requests.length === 0,
    interrupt_requested: turnId === latest?.id && Boolean(latest?.interrupt_requested_at),
  });
}
