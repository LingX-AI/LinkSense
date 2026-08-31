BEGIN;

ALTER TABLE "clawhub_skills"
  ADD COLUMN "install_block_reason" VARCHAR(32),
  ADD CONSTRAINT "clawhub_skills_install_block_reason_check"
    CHECK (
      "install_block_reason" IS NULL
      OR "install_block_reason" IN (
        'files_unavailable',
        'manifest_too_large',
        'manifest_unsafe',
        'metadata_unavailable'
      )
    );

ALTER TABLE "clawhub_skill_sync_staging"
  ADD COLUMN "install_block_reason" VARCHAR(32),
  ADD CONSTRAINT "clawhub_skill_sync_staging_install_block_reason_check"
    CHECK (
      "install_block_reason" IS NULL
      OR "install_block_reason" IN (
        'files_unavailable',
        'manifest_too_large',
        'manifest_unsafe',
        'metadata_unavailable'
      )
    );

COMMIT;
