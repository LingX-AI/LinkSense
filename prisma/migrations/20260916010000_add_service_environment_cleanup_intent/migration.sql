-- Existing cleanup intents retain their task-only scope. Only an explicit
-- application-task deletion after this upgrade authorizes environment removal.
ALTER TABLE "runtime_cleanup_outbox"
ADD COLUMN "remove_service_environment" BOOLEAN NOT NULL DEFAULT false;
