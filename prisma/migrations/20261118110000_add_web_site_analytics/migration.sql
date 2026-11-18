-- Analytics is opt-in; existing sites keep collecting nothing.
ALTER TABLE "web_sites"
  ADD COLUMN "analytics_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "analytics_site_id" INTEGER,
  ADD COLUMN "analytics_domain" VARCHAR(255);
