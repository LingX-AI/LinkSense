ALTER TABLE "conversation_user_input_requests"
  ADD COLUMN "form_waiting_policy_json" JSONB,
  ADD COLUMN "response_source" VARCHAR(24);

CREATE INDEX "conversation_user_input_requests_deadline_idx"
  ON "conversation_user_input_requests" ("request_kind", "status", "auto_resolve_at");
