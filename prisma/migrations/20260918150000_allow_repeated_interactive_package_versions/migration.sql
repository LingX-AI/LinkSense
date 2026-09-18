-- Preserve every package and its assets. Package UUIDs identify immutable revisions;
-- user-facing version labels may repeat when an application is updated.
DROP INDEX "interactive_application_packages_application_version_key";
