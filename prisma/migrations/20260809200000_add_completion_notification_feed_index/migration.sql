CREATE INDEX "conversation_turns_submitter_status_completed_idx"
ON "conversation_turns"("submitted_by", "status", "completed_at", "id");
