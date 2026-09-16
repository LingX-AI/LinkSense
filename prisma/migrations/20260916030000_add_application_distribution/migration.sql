-- Approved migration: preserve applications, conversations and existing copies.
-- Replace the global copy flag with explicit per-grant usage permissions.
ALTER TABLE application_grants ADD COLUMN usage_modes TEXT[];
UPDATE application_grants AS g
SET usage_modes = CASE WHEN a.allow_copy THEN ARRAY['install', 'service'] ELSE ARRAY['service'] END
FROM applications AS a WHERE a.id = g.application_id;
-- Revoked grants may outlive a removed application; retain their historical service meaning.
UPDATE application_grants SET usage_modes = ARRAY['service'] WHERE usage_modes IS NULL;
ALTER TABLE application_grants ALTER COLUMN usage_modes SET NOT NULL;
ALTER TABLE application_grants ADD CONSTRAINT application_grants_usage_modes_check
  CHECK (usage_modes <@ ARRAY['install', 'service']::TEXT[] AND cardinality(usage_modes) BETWEEN 1 AND 2 AND
    (cardinality(usage_modes) = 1 OR usage_modes[1] <> usage_modes[2]));
ALTER TABLE applications DROP COLUMN allow_copy;

CREATE TABLE application_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), application_id UUID NOT NULL, publisher_id UUID NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft', current_release_id UUID, suspension_reason TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_listings_status_check CHECK (status IN ('draft', 'published', 'unlisted', 'suspended')),
  CONSTRAINT application_listings_application_key UNIQUE (application_id)
);
CREATE INDEX application_listings_status_updated_idx ON application_listings(status, updated_at DESC);
CREATE INDEX application_listings_publisher_idx ON application_listings(publisher_id);

CREATE TABLE application_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), listing_id UUID NOT NULL, application_id UUID NOT NULL, version_id UUID NOT NULL,
  name VARCHAR(160) NOT NULL, description TEXT, publisher_name VARCHAR(120) NOT NULL, usage_modes TEXT[] NOT NULL,
  release_notes TEXT NOT NULL, status VARCHAR(32) NOT NULL DEFAULT 'pending', reviewer_id UUID, review_comment TEXT,
  submitted_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMPTZ(6),
  CONSTRAINT application_releases_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn')),
  CONSTRAINT application_releases_usage_modes_check CHECK (usage_modes <@ ARRAY['install', 'service']::TEXT[] AND
    cardinality(usage_modes) BETWEEN 1 AND 2 AND (cardinality(usage_modes) = 1 OR usage_modes[1] <> usage_modes[2])),
  CONSTRAINT application_releases_text_bounds_check CHECK (length(release_notes) BETWEEN 1 AND 8000 AND
    (description IS NULL OR length(description) <= 4000) AND (review_comment IS NULL OR length(review_comment) <= 4000))
);
CREATE INDEX application_releases_listing_submitted_idx ON application_releases(listing_id, submitted_at DESC);
CREATE INDEX application_releases_status_submitted_idx ON application_releases(status, submitted_at);
CREATE INDEX application_releases_version_idx ON application_releases(version_id);
CREATE UNIQUE INDEX application_releases_one_pending_key ON application_releases(listing_id) WHERE status = 'pending';

CREATE TABLE application_installations (
  application_id UUID PRIMARY KEY, owner_id UUID NOT NULL, source_application_id UUID NOT NULL, channel VARCHAR(32) NOT NULL,
  installed_version_id UUID NOT NULL, baseline_json JSONB NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT application_installations_channel_check CHECK (channel IN ('direct', 'center')),
  CONSTRAINT application_installations_baseline_check CHECK (jsonb_typeof(baseline_json) = 'object' AND octet_length(baseline_json::TEXT) <= 131072),
  CONSTRAINT application_installations_owner_source_channel_key UNIQUE (owner_id, source_application_id, channel)
);
CREATE INDEX application_installations_source_idx ON application_installations(source_application_id);

ALTER TABLE conversations ADD COLUMN application_channel VARCHAR(32);
UPDATE conversations SET application_channel = 'direct' WHERE application_id IS NOT NULL;
ALTER TABLE conversations ADD CONSTRAINT conversations_application_channel_check
  CHECK (application_channel IS NULL OR application_channel IN ('direct', 'center'));
ALTER TABLE interactive_application_runtime_tickets ADD COLUMN channel VARCHAR(32) NOT NULL DEFAULT 'direct';
ALTER TABLE interactive_application_runtime_tickets ADD CONSTRAINT interactive_application_runtime_tickets_channel_check
  CHECK (channel IN ('direct', 'center'));
