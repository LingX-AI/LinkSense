-- DATA LOSS CONFIRMED: the product owner explicitly approved discarding
-- historical data that cannot provide the immutable capability generation and
-- snapshot required to recover an already-running Codex turn safely.
--
-- Clear the complete conversation graph before making the new turn snapshot
-- columns required. Knowledge bases, users, credentials, capabilities and
-- audit logs remain intact. Conversation citations and knowledge selections
-- are cleared with their source conversations so no logical orphans remain.

BEGIN;

TRUNCATE TABLE
    "conversation_message_knowledge_citation_anchors",
    "conversation_message_knowledge_citations",
    "conversation_turn_knowledge_bases",
    "conversation_turn_start_intents",
    "conversation_drafts",
    "pending_requests",
    "conversation_messages",
    "conversation_events",
    "conversation_files",
    "conversation_turns",
    "retained_artifacts",
    "runtime_cleanup_outbox",
    "conversations";

ALTER TABLE "conversation_turns"
    ADD COLUMN "capability_generation" VARCHAR(64) NOT NULL,
    ADD COLUMN "capabilities_json" JSONB NOT NULL,
    ADD CONSTRAINT "conversation_turns_capability_generation_check"
        CHECK ("capability_generation" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "conversation_turns_capabilities_json_shape_check"
        CHECK (jsonb_typeof("capabilities_json") = 'array');

COMMIT;
