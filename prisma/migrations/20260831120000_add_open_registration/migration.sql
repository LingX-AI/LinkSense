CREATE TABLE "registration_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "locale" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "request_ip" INET,
    "request_user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "registration_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "registration_tokens_locale_check" CHECK ("locale" IN ('zh-CN', 'en-US'))
);

CREATE UNIQUE INDEX "registration_tokens_token_hash_key"
    ON "registration_tokens"("token_hash");

CREATE INDEX "registration_tokens_email_state_idx"
    ON "registration_tokens"("email", "consumed_at", "expires_at");

CREATE INDEX "registration_tokens_state_idx"
    ON "registration_tokens"("consumed_at", "expires_at");
