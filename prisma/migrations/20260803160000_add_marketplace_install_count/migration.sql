ALTER TABLE "marketplace_listings"
ADD COLUMN "install_count" INTEGER NOT NULL DEFAULT 0;

UPDATE "marketplace_listings" AS "listing"
SET "install_count" = "current_installs"."install_count"
FROM (
  SELECT
    "marketplace_listing_id",
    COUNT(*)::INTEGER AS "install_count"
  FROM "capabilities"
  WHERE "marketplace_listing_id" IS NOT NULL
  GROUP BY "marketplace_listing_id"
) AS "current_installs"
WHERE "listing"."id" = "current_installs"."marketplace_listing_id";

ALTER TABLE "marketplace_listings"
ADD CONSTRAINT "marketplace_listings_install_count_check"
CHECK ("install_count" >= 0);
