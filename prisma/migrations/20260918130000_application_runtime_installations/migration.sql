-- Additive migration: no existing columns, versions, tasks or files are removed.
ALTER TABLE "application_versions" ADD COLUMN "purpose" VARCHAR(16) NOT NULL DEFAULT 'release';
CREATE TABLE "application_runtime_installations" (
  "owner_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "version_id" UUID NOT NULL,
  "channel" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_runtime_installations_pkey" PRIMARY KEY ("owner_id", "application_id")
);
CREATE INDEX "application_runtime_installations_application_idx" ON "application_runtime_installations"("application_id");

-- Preserve the last admitted version for existing consumers. Further publication
-- never changes these installations. Owners without a captured version are
-- handled by the offline environment conversion before execution is reopened.
INSERT INTO "application_runtime_installations" ("owner_id", "application_id", "version_id", "channel")
SELECT DISTINCT ON (c.owner_id, c.application_id)
  c.owner_id, c.application_id, c.application_version_id, COALESCE(c.application_channel, 'direct')
FROM conversations c
JOIN application_versions v ON v.id = c.application_version_id AND v.assets_ready = true
JOIN applications a ON a.id = c.application_id AND a.development_only = false
WHERE c.application_id IS NOT NULL
ORDER BY c.owner_id, c.application_id, c.updated_at DESC, c.id;

INSERT INTO "application_runtime_installations" ("owner_id", "application_id", "version_id", "channel")
SELECT a.owner_id, a.id, a.published_version_id, 'direct'
FROM applications a JOIN application_versions v ON v.id = a.published_version_id AND v.assets_ready = true
WHERE a.development_only = false
ON CONFLICT (owner_id, application_id) DO NOTHING;
