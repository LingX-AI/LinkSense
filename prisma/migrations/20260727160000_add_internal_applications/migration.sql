-- Additive internal-application storage. This migration only creates new
-- tables and nullable columns, so it does not delete or rewrite historical
-- data and has no data-loss or existing-field compatibility risk.

BEGIN;

CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "model" VARCHAR(240) NOT NULL,
    "reasoning_effort" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "deleted_at" TIMESTAMPTZ(6),
    "deleted_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "applications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "applications_status_check" CHECK (
        "status" IN ('active', 'disabled', 'deleted')
    ),
    CONSTRAINT "applications_reasoning_effort_check" CHECK (
        "reasoning_effort" IN (
            'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'
        )
    ),
    CONSTRAINT "applications_deletion_check" CHECK (
        ("status" = 'deleted' AND "deleted_at" IS NOT NULL AND "deleted_by" IS NOT NULL)
        OR ("status" <> 'deleted' AND "deleted_at" IS NULL AND "deleted_by" IS NULL)
    )
);

CREATE TABLE "application_capabilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "capability_name_snapshot" VARCHAR(160) NOT NULL,
    "capability_type_snapshot" VARCHAR(32) NOT NULL,
    "selection_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_capabilities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_capabilities_order_check" CHECK ("selection_order" >= 0),
    CONSTRAINT "application_capabilities_type_check" CHECK (
        "capability_type_snapshot" IN ('plugin', 'skill')
    )
);

CREATE TABLE "application_knowledge_bases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "knowledge_base_id" UUID NOT NULL,
    "knowledge_base_name_snapshot" VARCHAR(160) NOT NULL,
    "selection_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_knowledge_bases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_knowledge_bases_order_check" CHECK ("selection_order" >= 0)
);

CREATE TABLE "application_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "grantee_type" VARCHAR(32) NOT NULL,
    "user_id" UUID,
    "user_group_id" UUID,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "granted_by" UUID NOT NULL,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_grants_grantee_type_check" CHECK (
        "grantee_type" IN ('user', 'user_group')
    ),
    CONSTRAINT "application_grants_target_check" CHECK (
        ("grantee_type" = 'user' AND "user_id" IS NOT NULL AND "user_group_id" IS NULL)
        OR ("grantee_type" = 'user_group' AND "user_id" IS NULL AND "user_group_id" IS NOT NULL)
    ),
    CONSTRAINT "application_grants_status_check" CHECK (
        "status" IN ('active', 'revoked')
    ),
    CONSTRAINT "application_grants_revocation_check" CHECK (
        ("status" = 'active' AND "revoked_by" IS NULL AND "revoked_at" IS NULL)
        OR ("status" = 'revoked' AND "revoked_by" IS NOT NULL AND "revoked_at" IS NOT NULL)
    )
);

ALTER TABLE "conversations"
    ADD COLUMN "application_id" UUID,
    ADD COLUMN "application_name_snapshot" VARCHAR(160),
    ADD CONSTRAINT "conversations_application_snapshot_check" CHECK (
        ("application_id" IS NULL AND "application_name_snapshot" IS NULL)
        OR ("application_id" IS NOT NULL AND "application_name_snapshot" IS NOT NULL)
    );

ALTER TABLE "conversation_turn_start_intents"
    ADD COLUMN "application_id" UUID,
    ADD COLUMN "application_updated_at" TIMESTAMPTZ(6),
    ADD COLUMN "application_instructions" TEXT,
    ADD CONSTRAINT "conversation_turn_start_intents_application_check" CHECK (
        (
            "application_id" IS NULL
            AND "application_updated_at" IS NULL
            AND "application_instructions" IS NULL
        ) OR (
            "application_id" IS NOT NULL
            AND "application_updated_at" IS NOT NULL
            AND "application_instructions" IS NOT NULL
        )
    );

CREATE INDEX "applications_owner_status_updated_idx"
    ON "applications"("owner_id", "status", "updated_at" DESC);
CREATE INDEX "applications_status_updated_idx"
    ON "applications"("status", "updated_at" DESC);
CREATE INDEX "applications_name_idx" ON "applications"("name");
CREATE INDEX "applications_deleted_by_idx" ON "applications"("deleted_by");

CREATE UNIQUE INDEX "application_capabilities_application_capability_key"
    ON "application_capabilities"("application_id", "capability_id");
CREATE UNIQUE INDEX "application_capabilities_application_order_key"
    ON "application_capabilities"("application_id", "selection_order");
CREATE INDEX "application_capabilities_capability_created_idx"
    ON "application_capabilities"("capability_id", "created_at");

CREATE UNIQUE INDEX "application_knowledge_bases_application_base_key"
    ON "application_knowledge_bases"("application_id", "knowledge_base_id");
CREATE UNIQUE INDEX "application_knowledge_bases_application_order_key"
    ON "application_knowledge_bases"("application_id", "selection_order");
CREATE INDEX "application_knowledge_bases_base_created_idx"
    ON "application_knowledge_bases"("knowledge_base_id", "created_at");

CREATE UNIQUE INDEX "application_grants_active_user_key"
    ON "application_grants"("application_id", "user_id")
    WHERE "status" = 'active' AND "grantee_type" = 'user';
CREATE UNIQUE INDEX "application_grants_active_group_key"
    ON "application_grants"("application_id", "user_group_id")
    WHERE "status" = 'active' AND "grantee_type" = 'user_group';
CREATE INDEX "application_grants_application_status_created_idx"
    ON "application_grants"("application_id", "status", "created_at");
CREATE INDEX "application_grants_user_status_idx"
    ON "application_grants"("grantee_type", "user_id", "status");
CREATE INDEX "application_grants_group_status_idx"
    ON "application_grants"("grantee_type", "user_group_id", "status");
CREATE INDEX "application_grants_granted_by_idx"
    ON "application_grants"("granted_by");
CREATE INDEX "application_grants_revoked_by_idx"
    ON "application_grants"("revoked_by");

CREATE INDEX "conversations_application_owner_updated_idx"
    ON "conversations"("application_id", "owner_id", "updated_at" DESC);

COMMIT;
