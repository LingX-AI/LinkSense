-- Intentional data removal: permanently purge previously soft-deleted sites,
-- their releases and address reservations. Task files and active sites remain.
-- The user explicitly requested permanent deletion and address reuse by anyone.
BEGIN;

DELETE FROM "web_site_releases"
WHERE "site_id" IN (SELECT "id" FROM "web_sites" WHERE "deleted_at" IS NOT NULL);

DELETE FROM "web_site_addresses"
WHERE "site_id" IN (SELECT "id" FROM "web_sites" WHERE "deleted_at" IS NOT NULL);

DELETE FROM "web_sites" WHERE "deleted_at" IS NOT NULL;

ALTER TABLE "web_sites" DROP COLUMN "deleted_at";

COMMIT;
