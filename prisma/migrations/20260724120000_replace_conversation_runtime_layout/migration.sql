-- DATA LOSS CONFIRMED: the product owner explicitly approved discarding
-- historical conversation and runtime data. The user-home runtime layout is
-- incompatible with the legacy per-conversation CODEX_HOME path, so clear the
-- complete conversation graph and the capability graph whose package paths
-- point at the retired capability volume before enabling the user-HOME
-- publication model.
--
-- Audit logs and knowledge-base content remain intact. Conversation knowledge
-- selections and citations are cleared with their source conversations so no
-- logical orphan rows survive this migration. Credentials remain intact, but
-- their capability-specific bindings are discarded with the old capabilities.

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
    "conversations",
    "capability_share_requests",
    "capability_user_preferences",
    "capability_grants",
    "credential_bindings",
    "capabilities";

DROP INDEX "conversations_codex_home_rel_path_key";

ALTER TABLE "conversations"
    DROP COLUMN "codex_home_rel_path";

ALTER TABLE "conversation_turn_start_intents"
    ADD COLUMN "capability_generation" VARCHAR(64) NOT NULL,
    ADD CONSTRAINT "conversation_turn_start_intents_capability_generation_check"
        CHECK ("capability_generation" ~ '^[0-9a-f]{64}$');

COMMIT;
