ALTER TABLE "application_external_access"
  ADD COLUMN "app_secret_encrypted" TEXT,
  ADD COLUMN "app_secret_encryption_key_id" VARCHAR(120);
