DROP INDEX IF EXISTS "application_embed_tickets_resume_session_idx";

ALTER TABLE "application_embed_tickets"
  DROP COLUMN "resume_session_id";
