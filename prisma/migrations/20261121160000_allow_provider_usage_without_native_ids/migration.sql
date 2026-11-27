-- Provider-authoritative desktop usage can arrive before the conversation turn
-- projection (a fast first completion or native pre-turn compaction). The
-- server-issued projection turn id is still authoritative, but the native Codex
-- thread/turn ids do not exist yet. Keep the columns for native history and
-- leave them empty rather than inventing identifiers.
ALTER TABLE "token_usage_records" ALTER COLUMN "codex_thread_id" DROP NOT NULL;
ALTER TABLE "token_usage_records" ALTER COLUMN "codex_turn_id" DROP NOT NULL;
