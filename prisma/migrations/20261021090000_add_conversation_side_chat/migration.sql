ALTER TABLE "conversations"
  ADD COLUMN "side_chat_parent_id" UUID,
  ADD COLUMN "side_chat_reference_json" JSONB;

CREATE UNIQUE INDEX "conversations_side_chat_parent_key"
  ON "conversations"("side_chat_parent_id");
