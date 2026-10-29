-- Approved breaking change: remove legacy WeCom/DingTalk/Teams connections,
-- channel peer mappings and queued messages. Users, conversations, tasks and
-- Feishu/Weixin connections are preserved. Stop old API workers before upgrade.
BEGIN;
DELETE FROM "bot_channel_outbound_deliveries";
DELETE FROM "bot_channel_inbound_messages";
DELETE FROM "bot_channel_peer_sessions";
DELETE FROM "bot_channel_connections";
ALTER TABLE "bot_channel_connections" ALTER COLUMN "owner_id" DROP NOT NULL;
ALTER TABLE "bot_channel_connections" DROP COLUMN "allowed_sender_id";
ALTER TABLE "bot_channel_connections" ADD CONSTRAINT "bot_channel_connections_scope_check"
  CHECK ((provider = 'dingtalk' AND owner_id IS NOT NULL) OR (provider IN ('wecom', 'teams') AND owner_id IS NULL));
CREATE UNIQUE INDEX "bot_channel_connections_organization_provider_key"
  ON "bot_channel_connections" (provider) WHERE owner_id IS NULL;
CREATE TABLE "bot_channel_identities" (
  "id" UUID NOT NULL PRIMARY KEY,
  "connection_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "sender_id" VARCHAR(256) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bot_channel_identities_connection_sender_key" ON "bot_channel_identities" (connection_id, sender_id);
CREATE UNIQUE INDEX "bot_channel_identities_connection_user_key" ON "bot_channel_identities" (connection_id, user_id);
CREATE INDEX "bot_channel_identities_user_idx" ON "bot_channel_identities" (user_id);
ALTER TABLE "bot_channel_peer_sessions" ADD COLUMN "owner_id" UUID NOT NULL;
DROP INDEX "bot_channel_peer_sessions_connection_chat_key";
CREATE UNIQUE INDEX "bot_channel_peer_sessions_connection_chat_owner_key" ON "bot_channel_peer_sessions" (connection_id, chat_id, owner_id);
ALTER TABLE "bot_channel_inbound_messages" ADD COLUMN "owner_id" UUID NOT NULL;
DROP INDEX "bot_channel_inbound_messages_chat_queue_idx";
CREATE INDEX "bot_channel_inbound_messages_chat_queue_idx" ON "bot_channel_inbound_messages" (connection_id, chat_id, owner_id, status, ingest_order);
COMMIT;
