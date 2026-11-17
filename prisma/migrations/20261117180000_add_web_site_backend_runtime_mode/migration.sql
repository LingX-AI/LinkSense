-- NULL preserves every existing application's origin and browser sessions.
ALTER TABLE "web_site_backends" ADD COLUMN "runtime_mode" VARCHAR(16);
ALTER TABLE "web_site_backends" ADD CONSTRAINT "web_site_backends_runtime_mode_check"
  CHECK ("runtime_mode" IS NULL OR "runtime_mode" = 'sandbox');
