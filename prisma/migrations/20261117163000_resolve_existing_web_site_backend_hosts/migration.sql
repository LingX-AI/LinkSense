-- Null labels occur in both UUID-host and short-host development versions.
-- Resolve them from the existing Appwrite platform once before emitting a URL.
ALTER TABLE "web_site_backends" ADD COLUMN "host_resolved" BOOLEAN NOT NULL DEFAULT false;
UPDATE "web_site_backends" SET "host_resolved" = true WHERE "host_label" IS NOT NULL;
