ALTER TABLE "codex_thread_token_usage_cursors"
ADD COLUMN "last_total_tokens" BIGINT;

ALTER TABLE "codex_thread_token_usage_cursors"
ADD CONSTRAINT "codex_token_usage_cursors_last_total_check"
CHECK ("last_total_tokens" IS NULL OR "last_total_tokens" >= 0);
