CREATE TABLE "conversation_shares" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" UUID NOT NULL,
  "owner_id" UUID NOT NULL,
  "title_snapshot" VARCHAR(240) NOT NULL,
  "snapshot_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "conversation_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_shares_conversation_id_key"
ON "conversation_shares"("conversation_id");

CREATE INDEX "conversation_shares_owner_updated_idx"
ON "conversation_shares"("owner_id", "updated_at" DESC);
