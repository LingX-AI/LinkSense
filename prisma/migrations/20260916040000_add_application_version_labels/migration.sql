-- Preserve every version and all existing references. The numeric sequence still
-- orders immutable submissions; the user-facing label may be repeated.
ALTER TABLE application_versions ADD COLUMN version_label VARCHAR(80);
UPDATE application_versions SET version_label = version_number::TEXT || '.0.0';
ALTER TABLE application_versions ALTER COLUMN version_label SET NOT NULL;
