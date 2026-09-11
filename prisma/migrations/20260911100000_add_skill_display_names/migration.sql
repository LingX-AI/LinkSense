-- Optional presentation metadata; existing rows remain NULL.
ALTER TABLE "capabilities" ADD COLUMN "display_name" VARCHAR(64);
ALTER TABLE "marketplace_releases" ADD COLUMN "display_name" VARCHAR(64);
