ALTER TABLE "local_computer_sessions" ADD COLUMN "runtime_generation" UUID;

ALTER TABLE "computer_permission_grants" ADD COLUMN "session_id" UUID;

CREATE INDEX "computer_grants_session_revoked_idx"
    ON "computer_permission_grants"("session_id", "revoked_at");
