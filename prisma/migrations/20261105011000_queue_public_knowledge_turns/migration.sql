-- Extend only the new public-Q&A state set; preserve every existing record.
ALTER TABLE "public_knowledge_turns" DROP CONSTRAINT "public_knowledge_turns_status_check";
ALTER TABLE "public_knowledge_turns" ADD CONSTRAINT "public_knowledge_turns_status_check"
  CHECK ("status" IN ('queued', 'running', 'completed', 'failed', 'interrupted'));
ALTER TABLE "public_knowledge_turns" ADD COLUMN "cancel_requested_at" TIMESTAMPTZ(6);
