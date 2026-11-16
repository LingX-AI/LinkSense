CREATE TABLE "user_privacy_masking_settings" (
    "user_id" UUID NOT NULL,
    "encrypted_settings" TEXT NOT NULL,
    "encryption_key_id" VARCHAR(120) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "user_privacy_masking_settings_pkey" PRIMARY KEY ("user_id")
);
