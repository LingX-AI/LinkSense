-- DATA LOSS CONFIRMED: the product owner explicitly requested a clean
-- capability-store refactor without preserving historical capability data or
-- the former public/global capability structure.
--
-- Conversation history is preserved. Draft and queued capability selections
-- are reset because they may point at discarded capabilities. Credentials
-- remain, but every capability-specific binding is discarded.

BEGIN;

TRUNCATE TABLE
    "credential_bindings",
    "capability_share_requests",
    "capability_user_preferences",
    "capability_grants",
    "capabilities";

UPDATE "conversation_drafts"
SET "priority_capability_ids_json" = '[]'::jsonb;

UPDATE "pending_requests"
SET "priority_capability_ids_json" = '[]'::jsonb;

DROP TABLE "capability_user_preferences";
DROP TABLE "capability_share_requests";
DROP TABLE "capability_grants";
DROP TABLE "capabilities";

CREATE TABLE "capabilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" VARCHAR(32) NOT NULL,
    "scope" VARCHAR(32) NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "description" TEXT,
    "source_type" VARCHAR(32) NOT NULL,
    "marketplace_listing_id" UUID,
    "marketplace_release_id" UUID,
    "logo_object_key" TEXT,
    "storage_path" TEXT NOT NULL,
    "manifest_json" JSONB,
    "risk_summary_json" JSONB,
    "status" VARCHAR(32) NOT NULL,
    "installed_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capabilities_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capabilities_type_check" CHECK ("type" IN ('plugin', 'skill')),
    CONSTRAINT "capabilities_scope_check" CHECK ("scope" IN ('personal', 'shared')),
    CONSTRAINT "capabilities_source_type_check" CHECK (
        "source_type" IN ('local', 'url', 'marketplace')
    ),
    CONSTRAINT "capabilities_marketplace_origin_check" CHECK (
        (
            "source_type" = 'marketplace'
            AND "marketplace_listing_id" IS NOT NULL
            AND "marketplace_release_id" IS NOT NULL
        )
        OR (
            "source_type" <> 'marketplace'
            AND "marketplace_listing_id" IS NULL
            AND "marketplace_release_id" IS NULL
        )
    ),
    CONSTRAINT "capabilities_status_check" CHECK (
        "status" IN ('active', 'disabled', 'failed')
    ),
    CONSTRAINT "capabilities_approval_pair_check" CHECK (
        ("approved_by" IS NULL AND "approved_at" IS NULL)
        OR (
            "scope" = 'shared'
            AND "approved_by" IS NOT NULL
            AND "approved_at" IS NOT NULL
        )
    ),
    CONSTRAINT "capabilities_manifest_object_check" CHECK (
        "manifest_json" IS NULL OR jsonb_typeof("manifest_json") = 'object'
    ),
    CONSTRAINT "capabilities_risk_summary_object_check" CHECK (
        "risk_summary_json" IS NULL OR jsonb_typeof("risk_summary_json") = 'object'
    )
);

CREATE TABLE "capability_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability_id" UUID NOT NULL,
    "grantee_type" VARCHAR(32) NOT NULL,
    "user_id" UUID,
    "user_group_id" UUID,
    "grant_kind" VARCHAR(40) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "granted_by" UUID NOT NULL,
    "approval_request_id" UUID,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capability_grants_grantee_type_check" CHECK (
        "grantee_type" IN ('user', 'user_group')
    ),
    CONSTRAINT "capability_grants_grantee_check" CHECK (
        (
            "grantee_type" = 'user'
            AND "user_id" IS NOT NULL
            AND "user_group_id" IS NULL
        )
        OR (
            "grantee_type" = 'user_group'
            AND "user_id" IS NULL
            AND "user_group_id" IS NOT NULL
        )
    ),
    CONSTRAINT "capability_grants_kind_check" CHECK (
        "grant_kind" IN (
            'owner',
            'direct_share',
            'group_share',
            'admin_user_grant',
            'admin_group_grant'
        )
    ),
    CONSTRAINT "capability_grants_kind_target_check" CHECK (
        (
            "grantee_type" = 'user'
            AND "grant_kind" IN ('owner', 'direct_share', 'admin_user_grant')
        )
        OR (
            "grantee_type" = 'user_group'
            AND "grant_kind" IN ('group_share', 'admin_group_grant')
        )
    ),
    CONSTRAINT "capability_grants_status_check" CHECK (
        "status" IN ('active', 'revoked')
    ),
    CONSTRAINT "capability_grants_revocation_check" CHECK (
        (
            "status" = 'active'
            AND "revoked_at" IS NULL
            AND "revoked_by" IS NULL
        )
        OR (
            "status" = 'revoked'
            AND "revoked_at" IS NOT NULL
        )
    )
);

CREATE TABLE "capability_share_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "user_group_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "reviewer_id" UUID,
    "review_comment" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_share_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capability_share_requests_status_check" CHECK (
        "status" IN ('pending', 'approved', 'rejected', 'cancelled', 'revoked')
    ),
    CONSTRAINT "capability_share_requests_review_time_check" CHECK (
        "reviewed_at" IS NULL OR "reviewed_at" >= "created_at"
    )
);

CREATE TABLE "capability_user_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "disabled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_user_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capability_user_preferences_status_check" CHECK (
        "status" IN ('enabled', 'disabled')
    ),
    CONSTRAINT "capability_user_preferences_disabled_at_check" CHECK (
        ("status" = 'disabled' AND "disabled_at" IS NOT NULL)
        OR ("status" = 'enabled' AND "disabled_at" IS NULL)
    )
);

CREATE TABLE "marketplace_listings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "publisher_id" UUID NOT NULL,
    "publisher_name" VARCHAR(120) NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "slug" VARCHAR(180) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "current_release_id" UUID,
    "suspended_by" UUID,
    "suspended_at" TIMESTAMPTZ(6),
    "suspension_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_listings_type_check" CHECK (
        "type" IN ('plugin', 'skill')
    ),
    CONSTRAINT "marketplace_listings_status_check" CHECK (
        "status" IN ('draft', 'published', 'unlisted', 'suspended')
    ),
    CONSTRAINT "marketplace_listings_release_check" CHECK (
        ("status" = 'draft' AND "current_release_id" IS NULL)
        OR (
            "status" IN ('published', 'unlisted', 'suspended')
            AND "current_release_id" IS NOT NULL
        )
    ),
    CONSTRAINT "marketplace_listings_suspension_check" CHECK (
        (
            "status" = 'suspended'
            AND "suspended_by" IS NOT NULL
            AND "suspended_at" IS NOT NULL
            AND "suspension_reason" IS NOT NULL
        )
        OR (
            "status" <> 'suspended'
            AND "suspended_by" IS NULL
            AND "suspended_at" IS NULL
            AND "suspension_reason" IS NULL
        )
    )
);

CREATE TABLE "marketplace_releases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "listing_id" UUID NOT NULL,
    "source_capability_id" UUID NOT NULL,
    "release_number" INTEGER NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "release_notes" TEXT,
    "logo_object_key" TEXT,
    "package_path" TEXT NOT NULL,
    "content_sha256" VARCHAR(64) NOT NULL,
    "manifest_json" JSONB NOT NULL,
    "risk_summary_json" JSONB NOT NULL,
    "submitted_by" UUID NOT NULL,
    "reviewer_id" UUID,
    "review_comment" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketplace_releases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_releases_number_check" CHECK ("release_number" > 0),
    CONSTRAINT "marketplace_releases_status_check" CHECK (
        "status" IN ('pending', 'approved', 'rejected', 'withdrawn')
    ),
    CONSTRAINT "marketplace_releases_content_sha256_check" CHECK (
        "content_sha256" ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT "marketplace_releases_manifest_object_check" CHECK (
        jsonb_typeof("manifest_json") = 'object'
    ),
    CONSTRAINT "marketplace_releases_risk_summary_object_check" CHECK (
        jsonb_typeof("risk_summary_json") = 'object'
    ),
    CONSTRAINT "marketplace_releases_review_check" CHECK (
        (
            "status" = 'pending'
            AND "reviewer_id" IS NULL
            AND "reviewed_at" IS NULL
            AND "published_at" IS NULL
        )
        OR (
            "status" = 'approved'
            AND "reviewer_id" IS NOT NULL
            AND "reviewed_at" IS NOT NULL
            AND "published_at" IS NOT NULL
        )
        OR (
            "status" = 'rejected'
            AND "reviewer_id" IS NOT NULL
            AND "reviewed_at" IS NOT NULL
            AND "published_at" IS NULL
        )
        OR (
            "status" = 'withdrawn'
            AND "reviewer_id" IS NULL
            AND "published_at" IS NULL
        )
    ),
    CONSTRAINT "marketplace_releases_review_time_check" CHECK (
        "reviewed_at" IS NULL OR "reviewed_at" >= "submitted_at"
    ),
    CONSTRAINT "marketplace_releases_publish_time_check" CHECK (
        "published_at" IS NULL OR "published_at" >= "submitted_at"
    )
);

CREATE UNIQUE INDEX "capabilities_owner_slug_type_key"
    ON "capabilities"("owner_id", "slug", "type");
CREATE UNIQUE INDEX "capabilities_owner_marketplace_listing_key"
    ON "capabilities"("owner_id", "marketplace_listing_id");
CREATE INDEX "capabilities_type_status_idx"
    ON "capabilities"("type", "status");
CREATE INDEX "capabilities_scope_status_idx"
    ON "capabilities"("scope", "status");
CREATE INDEX "capabilities_owner_id_idx"
    ON "capabilities"("owner_id");
CREATE INDEX "capabilities_marketplace_listing_id_idx"
    ON "capabilities"("marketplace_listing_id");
CREATE INDEX "capabilities_marketplace_release_id_idx"
    ON "capabilities"("marketplace_release_id");
CREATE INDEX "capabilities_installed_by_idx"
    ON "capabilities"("installed_by");
CREATE INDEX "capabilities_approved_by_idx"
    ON "capabilities"("approved_by");
CREATE INDEX "capabilities_name_idx"
    ON "capabilities"("name");

CREATE UNIQUE INDEX "capability_grants_active_user_key"
    ON "capability_grants"("capability_id", "user_id", "grant_kind")
    WHERE "status" = 'active' AND "grantee_type" = 'user';
CREATE UNIQUE INDEX "capability_grants_active_group_key"
    ON "capability_grants"("capability_id", "user_group_id", "grant_kind")
    WHERE "status" = 'active' AND "grantee_type" = 'user_group';
CREATE INDEX "capability_grants_capability_id_idx"
    ON "capability_grants"("capability_id");
CREATE INDEX "capability_grants_user_status_idx"
    ON "capability_grants"("grantee_type", "user_id", "status");
CREATE INDEX "capability_grants_group_status_idx"
    ON "capability_grants"("grantee_type", "user_group_id", "status");
CREATE INDEX "capability_grants_granted_by_idx"
    ON "capability_grants"("granted_by");
CREATE INDEX "capability_grants_approval_request_idx"
    ON "capability_grants"("approval_request_id");
CREATE INDEX "capability_grants_revoked_by_idx"
    ON "capability_grants"("revoked_by");

CREATE INDEX "capability_share_requests_status_created_idx"
    ON "capability_share_requests"("status", "created_at");
CREATE INDEX "capability_share_requests_requester_idx"
    ON "capability_share_requests"("requester_id", "status", "created_at");
CREATE INDEX "capability_share_requests_capability_idx"
    ON "capability_share_requests"("capability_id", "status");
CREATE INDEX "capability_share_requests_group_idx"
    ON "capability_share_requests"("user_group_id");
CREATE INDEX "capability_share_requests_reviewer_idx"
    ON "capability_share_requests"("reviewer_id");

CREATE UNIQUE INDEX "capability_user_preferences_user_capability_key"
    ON "capability_user_preferences"("user_id", "capability_id");
CREATE INDEX "capability_user_preferences_user_status_idx"
    ON "capability_user_preferences"("user_id", "status");
CREATE INDEX "capability_user_preferences_capability_idx"
    ON "capability_user_preferences"("capability_id");

CREATE UNIQUE INDEX "marketplace_listings_type_slug_key"
    ON "marketplace_listings"("type", "slug");
CREATE INDEX "marketplace_listings_publisher_status_updated_idx"
    ON "marketplace_listings"("publisher_id", "status", "updated_at" DESC);
CREATE INDEX "marketplace_listings_status_type_updated_idx"
    ON "marketplace_listings"("status", "type", "updated_at" DESC);
CREATE INDEX "marketplace_listings_current_release_id_idx"
    ON "marketplace_listings"("current_release_id");
CREATE INDEX "marketplace_listings_suspended_by_idx"
    ON "marketplace_listings"("suspended_by");

CREATE UNIQUE INDEX "marketplace_releases_listing_number_key"
    ON "marketplace_releases"("listing_id", "release_number");
CREATE UNIQUE INDEX "marketplace_releases_one_pending_key"
    ON "marketplace_releases"("listing_id")
    WHERE "status" = 'pending';
CREATE INDEX "marketplace_releases_listing_status_submitted_idx"
    ON "marketplace_releases"("listing_id", "status", "submitted_at" DESC);
CREATE INDEX "marketplace_releases_status_submitted_idx"
    ON "marketplace_releases"("status", "submitted_at");
CREATE INDEX "marketplace_releases_source_capability_id_idx"
    ON "marketplace_releases"("source_capability_id");
CREATE INDEX "marketplace_releases_submitted_by_idx"
    ON "marketplace_releases"("submitted_by");
CREATE INDEX "marketplace_releases_reviewer_id_idx"
    ON "marketplace_releases"("reviewer_id");

COMMIT;
