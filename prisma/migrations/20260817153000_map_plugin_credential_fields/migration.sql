-- DATA LOSS CONFIRMED: existing plugin credential bindings use the old
-- same-name-only contract and are intentionally discarded. Credentials and
-- their encrypted values are preserved.

BEGIN;

TRUNCATE TABLE "credential_bindings";

ALTER TABLE "credential_bindings"
  ADD COLUMN "credential_key" VARCHAR(120) NOT NULL,
  ADD CONSTRAINT "credential_bindings_env_key_check"
    CHECK ("env_key" ~ '^[A-Za-z_][A-Za-z0-9_]*$'),
  ADD CONSTRAINT "credential_bindings_credential_key_check"
    CHECK ("credential_key" ~ '^[A-Za-z_][A-Za-z0-9_]*$');

COMMIT;
