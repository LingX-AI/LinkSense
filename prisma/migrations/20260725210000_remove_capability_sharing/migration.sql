-- DATA LOSS CONFIRMED: capabilities and marketplace data are rebuilt without
-- preserving historical records or structures. Existing capabilities,
-- listings, releases, preferences, grants, share requests, bindings, runtime
-- snapshots, pending selections, capability events, and related audit records
-- are intentionally discarded.

BEGIN;

UPDATE "conversation_drafts"
SET "priority_capability_ids_json" = '[]'::jsonb;

UPDATE "pending_requests"
SET "priority_capability_ids_json" = '[]'::jsonb;

UPDATE "conversation_turns"
SET "capabilities_json" = '[]'::jsonb;

UPDATE "conversation_turn_start_intents"
SET
  "priority_capability_ids_json" = '[]'::jsonb,
  "capabilities_json" = '[]'::jsonb,
  "credential_usage_receipts_json" = '[]'::jsonb;

DELETE FROM "conversation_events"
WHERE "event_type" = 'conversation.capability.attached';

DELETE FROM "audit_logs"
WHERE
  starts_with("action", 'capability_')
  OR starts_with("action", 'marketplace_')
  OR "action" IN ('credential_bound', 'credential_unbound', 'credential_used')
  OR "target_type" IN (
    'capability',
    'capability_grant',
    'capability_share_request',
    'marketplace_listing',
    'marketplace_release',
    'credential_binding'
  );

TRUNCATE TABLE
  "credential_bindings",
  "marketplace_releases",
  "marketplace_listings",
  "capability_user_preferences",
  "capability_share_requests",
  "capability_grants",
  "capabilities";

DELETE FROM "credentials" WHERE "scope" = 'school';

DROP INDEX "credential_bindings_active_school_key";
DROP INDEX "credential_bindings_active_personal_key";

ALTER TABLE "credential_bindings"
  DROP CONSTRAINT "credential_bindings_scope_check",
  DROP CONSTRAINT "credential_bindings_user_check",
  ALTER COLUMN "user_id" SET NOT NULL,
  DROP COLUMN "binding_scope";

CREATE UNIQUE INDEX "credential_bindings_active_user_key"
  ON "credential_bindings" ("capability_id", "user_id", "env_key")
  WHERE "status" = 'active';

ALTER TABLE "credentials"
  DROP CONSTRAINT "credentials_scope_check",
  DROP CONSTRAINT "credentials_owner_check",
  ADD CONSTRAINT "credentials_scope_check"
    CHECK ("scope" IN ('personal', 'public')),
  ADD CONSTRAINT "credentials_owner_check" CHECK (
    ("scope" = 'personal' AND "owner_id" IS NOT NULL)
    OR ("scope" = 'public' AND "owner_id" IS NULL)
  );

DROP TABLE "capability_share_requests";
DROP TABLE "capability_grants";

DROP INDEX "capabilities_scope_status_idx";
DROP INDEX "capabilities_approved_by_idx";

ALTER TABLE "capabilities"
    DROP CONSTRAINT "capabilities_scope_check",
    DROP CONSTRAINT "capabilities_approval_pair_check",
    DROP COLUMN "scope",
    DROP COLUMN "approved_by",
    DROP COLUMN "approved_at";

COMMIT;
