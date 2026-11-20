CREATE TABLE "conversation_desktop_approvals" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "codex_thread_id" TEXT NOT NULL,
    "codex_turn_id" TEXT NOT NULL,
    "codex_item_id" TEXT NOT NULL,
    "native_request_id" BIGINT NOT NULL,
    "approval_json" JSONB NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_action" VARCHAR(24),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "conversation_desktop_approvals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_desktop_approvals_native_request_key"
    ON "conversation_desktop_approvals"("turn_id", "native_request_id");

CREATE INDEX "conversation_desktop_approvals_conversation_turn_idx"
    ON "conversation_desktop_approvals"("conversation_id", "turn_id", "created_at", "id");
