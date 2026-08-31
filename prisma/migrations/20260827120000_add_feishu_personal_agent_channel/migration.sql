CREATE TABLE "feishu_connections" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "app_id" VARCHAR(64) NOT NULL,
    "owner_open_id" VARCHAR(128) NOT NULL,
    "bot_name" VARCHAR(120),
    "domain" VARCHAR(16) NOT NULL,
    "encrypted_credentials" TEXT NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "last_connected_at" TIMESTAMPTZ(6),
    "last_inbound_at" TIMESTAMPTZ(6),
    "last_error_code" VARCHAR(120),
    "last_error_at" TIMESTAMPTZ(6),
    "next_ingest_order" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feishu_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feishu_connections_status_check"
        CHECK ("status" IN ('active', 'reauthorization_required', 'disconnecting')),
    CONSTRAINT "feishu_connections_domain_check"
        CHECK ("domain" IN ('feishu', 'lark'))
);

CREATE UNIQUE INDEX "feishu_connections_owner_key"
    ON "feishu_connections"("owner_id");
CREATE UNIQUE INDEX "feishu_connections_app_key"
    ON "feishu_connections"("app_id");
CREATE INDEX "feishu_connections_status_updated_idx"
    ON "feishu_connections"("status", "updated_at");

CREATE TABLE "feishu_peer_sessions" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "chat_id" VARCHAR(128) NOT NULL,
    "sender_open_id" VARCHAR(128) NOT NULL,
    "conversation_id" UUID NOT NULL,
    "last_inbound_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feishu_peer_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "feishu_peer_sessions_connection_chat_key"
    ON "feishu_peer_sessions"("connection_id", "chat_id");
CREATE INDEX "feishu_peer_sessions_conversation_idx"
    ON "feishu_peer_sessions"("conversation_id");
CREATE INDEX "feishu_peer_sessions_connection_inbound_idx"
    ON "feishu_peer_sessions"("connection_id", "last_inbound_at" DESC);

CREATE TABLE "feishu_inbound_messages" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "message_key" VARCHAR(240) NOT NULL,
    "chat_id" VARCHAR(128) NOT NULL,
    "sender_open_id" VARCHAR(128) NOT NULL,
    "content_text" TEXT NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "peer_session_id" UUID,
    "conversation_id" UUID,
    "turn_id" UUID,
    "ingest_order" BIGINT NOT NULL,
    "processing_token" UUID,
    "error_code" VARCHAR(120),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feishu_inbound_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feishu_inbound_messages_status_check"
        CHECK ("status" IN ('pending', 'processing', 'accepted', 'ignored', 'failed')),
    CONSTRAINT "feishu_inbound_messages_attempts_check"
        CHECK ("attempts" >= 0),
    CONSTRAINT "feishu_inbound_messages_projection_check"
        CHECK (
            ("status" = 'accepted' AND "peer_session_id" IS NOT NULL AND "conversation_id" IS NOT NULL AND "turn_id" IS NOT NULL AND "processed_at" IS NOT NULL AND "processing_token" IS NULL)
            OR ("status" IN ('pending', 'processing') AND (("peer_session_id" IS NULL AND "conversation_id" IS NULL) OR ("peer_session_id" IS NOT NULL AND "conversation_id" IS NOT NULL)) AND "turn_id" IS NULL AND "processed_at" IS NULL AND (("status" = 'processing') = ("processing_token" IS NOT NULL)))
            OR ("status" IN ('ignored', 'failed') AND "processed_at" IS NOT NULL AND "processing_token" IS NULL)
        )
);

CREATE UNIQUE INDEX "feishu_inbound_messages_connection_message_key"
    ON "feishu_inbound_messages"("connection_id", "message_key");
CREATE INDEX "feishu_inbound_messages_status_next_ingest_idx"
    ON "feishu_inbound_messages"("status", "next_attempt_at", "ingest_order");
CREATE INDEX "feishu_inbound_messages_chat_queue_idx"
    ON "feishu_inbound_messages"("connection_id", "chat_id", "status", "ingest_order");
CREATE INDEX "feishu_inbound_messages_turn_idx"
    ON "feishu_inbound_messages"("conversation_id", "turn_id");

CREATE TABLE "feishu_outbound_deliveries" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "peer_session_id" UUID NOT NULL,
    "inbound_message_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "processing_token" UUID,
    "sent_chunk_count" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error_code" VARCHAR(120),
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feishu_outbound_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feishu_outbound_deliveries_status_check"
        CHECK ("status" IN ('pending', 'processing', 'sent', 'failed')),
    CONSTRAINT "feishu_outbound_deliveries_counts_check"
        CHECK ("sent_chunk_count" >= 0 AND "attempts" >= 0),
    CONSTRAINT "feishu_outbound_deliveries_sent_check"
        CHECK (("status" = 'sent') = ("sent_at" IS NOT NULL)),
    CONSTRAINT "feishu_outbound_deliveries_processing_check"
        CHECK (("status" = 'processing') = ("processing_token" IS NOT NULL))
);

CREATE UNIQUE INDEX "feishu_outbound_deliveries_inbound_key"
    ON "feishu_outbound_deliveries"("inbound_message_id");
CREATE UNIQUE INDEX "feishu_outbound_deliveries_turn_key"
    ON "feishu_outbound_deliveries"("turn_id");
CREATE INDEX "feishu_outbound_deliveries_status_next_idx"
    ON "feishu_outbound_deliveries"("status", "next_attempt_at");
CREATE INDEX "feishu_outbound_deliveries_connection_created_idx"
    ON "feishu_outbound_deliveries"("connection_id", "created_at");
CREATE INDEX "feishu_outbound_deliveries_conversation_idx"
    ON "feishu_outbound_deliveries"("conversation_id");
