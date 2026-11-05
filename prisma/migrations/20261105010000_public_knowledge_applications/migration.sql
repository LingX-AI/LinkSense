-- Additive migration: existing applications, sessions, tasks and files are retained.
-- Extend the kind/package invariant without changing either existing kind.
ALTER TABLE "applications" DROP CONSTRAINT "applications_kind_package_check";
ALTER TABLE "applications" ADD CONSTRAINT "applications_kind_package_check" CHECK (
  ("kind" IN ('standard', 'public_knowledge') AND "interactive_package_id" IS NULL)
  OR ("kind" = 'interactive' AND "interactive_package_id" IS NOT NULL)
);

CREATE TABLE "public_knowledge_applications" (
  "application_id" UUID PRIMARY KEY, "public_id" VARCHAR(80) NOT NULL,
  "settings_json" JSONB NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "public_knowledge_applications_settings_check" CHECK (jsonb_typeof("settings_json") = 'object' AND octet_length("settings_json"::text) <= 65536)
);
CREATE UNIQUE INDEX "public_knowledge_applications_public_key" ON "public_knowledge_applications" ("public_id");
CREATE TABLE "public_knowledge_visitors" (
  "id" UUID PRIMARY KEY, "application_id" UUID NOT NULL, "token_hash" VARCHAR(64) NOT NULL,
  "origin" VARCHAR(2048) NOT NULL, "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "public_knowledge_visitors_token_key" ON "public_knowledge_visitors" ("token_hash");
CREATE INDEX "public_knowledge_visitors_application_expiry_idx" ON "public_knowledge_visitors" ("application_id", "expires_at");
CREATE TABLE "public_knowledge_conversations" (
  "id" UUID PRIMARY KEY, "application_id" UUID NOT NULL, "visitor_id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL, "codex_thread_id" VARCHAR(200),
  "expires_at" TIMESTAMPTZ(6) NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL
);
CREATE INDEX "public_knowledge_conversations_application_created_idx" ON "public_knowledge_conversations" ("application_id", "created_at" DESC, "id");
CREATE INDEX "public_knowledge_conversations_visitor_created_idx" ON "public_knowledge_conversations" ("visitor_id", "created_at" DESC, "id");
CREATE INDEX "public_knowledge_conversations_expiry_idx" ON "public_knowledge_conversations" ("expires_at");
CREATE TABLE "public_knowledge_turns" (
  "id" UUID PRIMARY KEY, "conversation_id" UUID NOT NULL, "application_version_id" UUID NOT NULL,
  "application_version" VARCHAR(80) NOT NULL, "request_id" UUID NOT NULL,
  "input_text" TEXT NOT NULL, "output_text" TEXT NOT NULL DEFAULT '',
  "status" VARCHAR(24) NOT NULL DEFAULT 'running', "model" VARCHAR(240) NOT NULL,
  "citations_json" JSONB NOT NULL DEFAULT '[]', "codex_turn_id" VARCHAR(200), "error_code" VARCHAR(100),
  "completed_at" TIMESTAMPTZ(6), "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "public_knowledge_turns_status_check" CHECK ("status" IN ('running', 'completed', 'failed', 'interrupted')),
  CONSTRAINT "public_knowledge_turns_citations_check" CHECK (jsonb_typeof("citations_json") = 'array' AND jsonb_array_length("citations_json") <= 8 AND octet_length("citations_json"::text) <= 98304),
  CONSTRAINT "public_knowledge_turns_input_check" CHECK (char_length("input_text") BETWEEN 1 AND 4000),
  CONSTRAINT "public_knowledge_turns_output_check" CHECK (char_length("output_text") <= 100000)
);
CREATE UNIQUE INDEX "public_knowledge_turns_request_key" ON "public_knowledge_turns" ("conversation_id", "request_id");
CREATE INDEX "public_knowledge_turns_conversation_created_idx" ON "public_knowledge_turns" ("conversation_id", "created_at", "id");
CREATE INDEX "public_knowledge_turns_status_created_idx" ON "public_knowledge_turns" ("status", "created_at");
