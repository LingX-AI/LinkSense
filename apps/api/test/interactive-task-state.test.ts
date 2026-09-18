import { describe, expect, it } from "vitest";
import { projectInteractiveTaskState } from "../src/modules/conversations/interactive-task-state.js";
const turnId = "40000000-0000-4000-8000-000000000001";
const fileId = "50000000-0000-4000-8000-000000000001";
const base = { starting_turn: null, turns: [], files: [], user_input_requests: [], plan_reviews: [], pending_requests: [], events: [] };
describe("interactive task state projection", () => {
  it("recovers an accepted start and its reserved files without exposing the prompt or storage fields", () => {
    const state = projectInteractiveTaskState({ ...base, starting_turn: { turn_id: turnId, created_at: "2026-09-18T00:00:00Z", attachments: [{ id: fileId }, { id: "ordinary-chat-file" }] }, files: [{ id: fileId, turn_id: null, source: "interactive_application_upload" }, { id: "ordinary-chat-file", turn_id: null, source: "user_upload" }] });
    expect(state).toEqual({ status: "starting", turn_id: turnId, file_ids: [fileId], can_submit: false, interrupt_requested: false });
  });
  it.each(["running", "completed", "failed", "interrupted"] as const)("recovers %s and application files from an existing turn", status => {
    expect(projectInteractiveTaskState({ ...base, turns: [{ id: turnId, status, started_at: "2026-09-18T00:00:00Z", interrupt_requested_at: null }], files: [{ id: fileId, turn_id: turnId, source: "interactive_application_upload" }, { id: "other", turn_id: turnId, source: "user_upload" }] })).toMatchObject({ status, turn_id: turnId, file_ids: [fileId], can_submit: status !== "running" });
  });
  it("uses the projected terminal turn instead of a stale starting snapshot", () => {
    expect(projectInteractiveTaskState({ ...base, starting_turn: { turn_id: turnId, created_at: "2026-09-18T00:00:00Z", attachments: [] }, turns: [{ id: turnId, status: "completed", started_at: "2026-09-18T00:00:00Z" }] }).status).toBe("completed");
  });
  it("reports pending user input and queued work without permitting another submission", () => {
    expect(projectInteractiveTaskState({ ...base, turns: [{ id: turnId, status: "running", started_at: "2026-09-18T00:00:00Z" }], user_input_requests: [{ turn_id: turnId, status: "pending" }] })).toMatchObject({ status: "waiting_for_input", can_submit: false });
    expect(projectInteractiveTaskState({ ...base, pending_requests: [{}] })).toMatchObject({ status: "idle", can_submit: false });
  });
  it("shows failed admission without creating a native turn and ignores it after a later start", () => {
    const events = [{ event_type: "conversation.error", created_at: "2026-09-18T01:00:00Z", payload: { schema_version: 1, error_code: "TURN_START_CLOSED", message_key: "errors.turnStartClosed", retryable: true, start_failure: { turn_id: turnId, idempotency_key: null } } }];
    expect(projectInteractiveTaskState({ ...base, events })).toMatchObject({ status: "failed", turn_id: turnId, can_submit: true });
    expect(projectInteractiveTaskState({ ...base, events, starting_turn: { turn_id: fileId, created_at: "2026-09-18T02:00:00Z", attachments: [] } })).toMatchObject({ status: "starting", turn_id: fileId });
  });
  it("keeps historical empty conversations idle", () => {
    expect(projectInteractiveTaskState({ ...base, files: [{ id: fileId, turn_id: null, source: "interactive_application_upload" }] })).toMatchObject({ status: "idle", turn_id: null, file_ids: [], can_submit: true });
  });
});

it("does not turn a failed native turn into a waiting task because of a stale question", () => {
  expect(projectInteractiveTaskState({ ...base, turns: [{ id: turnId, status: "failed", started_at: "2026-09-18T00:00:00Z" }], user_input_requests: [{ turn_id: turnId, status: "pending" }] })).toMatchObject({ status: "failed", can_submit: true });
});
