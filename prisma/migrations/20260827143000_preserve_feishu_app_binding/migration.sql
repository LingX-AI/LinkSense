CREATE TABLE "feishu_app_bindings" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "app_id" VARCHAR(64) NOT NULL,
    "owner_open_id" VARCHAR(128) NOT NULL,
    "domain" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feishu_app_bindings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feishu_app_bindings_domain_check"
        CHECK ("domain" IN ('feishu', 'lark'))
);

CREATE UNIQUE INDEX "feishu_app_bindings_owner_key"
    ON "feishu_app_bindings"("owner_id");
CREATE UNIQUE INDEX "feishu_app_bindings_app_key"
    ON "feishu_app_bindings"("app_id");

INSERT INTO "feishu_app_bindings" (
    "id",
    "owner_id",
    "app_id",
    "owner_open_id",
    "domain",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    "owner_id",
    "app_id",
    "owner_open_id",
    "domain",
    "created_at",
    CURRENT_TIMESTAMP
FROM "feishu_connections";
