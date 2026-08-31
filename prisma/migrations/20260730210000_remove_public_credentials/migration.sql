DELETE FROM "credential_bindings"
WHERE "credential_id" IN (
  SELECT "id"
  FROM "credentials"
  WHERE "scope" = 'public'
);

DELETE FROM "credentials" WHERE "scope" = 'public';

DROP INDEX "credentials_scope_owner_status_idx";

ALTER TABLE "credentials"
  DROP CONSTRAINT "credentials_scope_check",
  DROP CONSTRAINT "credentials_owner_check",
  ALTER COLUMN "owner_id" SET NOT NULL,
  DROP COLUMN "scope";

CREATE INDEX "credentials_owner_status_idx"
  ON "credentials"("owner_id", "status");
