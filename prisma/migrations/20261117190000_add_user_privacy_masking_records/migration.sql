CREATE TABLE "user_privacy_masking_records" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID,
    "turn_id" VARCHAR(120),
    "request_id" VARCHAR(120) NOT NULL,
    "model" VARCHAR(200) NOT NULL,
    "masked_count" INTEGER NOT NULL,
    "kinds" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_privacy_masking_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_privacy_masking_records_user_id_request_id_key" ON "user_privacy_masking_records"("user_id", "request_id");

CREATE INDEX "user_privacy_masking_records_user_id_created_at_idx" ON "user_privacy_masking_records"("user_id", "created_at" DESC);
