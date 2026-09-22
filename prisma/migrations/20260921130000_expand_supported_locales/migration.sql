BEGIN;

ALTER TABLE "users"
  DROP CONSTRAINT "users_preferred_locale_check",
  ADD CONSTRAINT "users_preferred_locale_check" CHECK (
    "preferred_locale" IS NULL
    OR "preferred_locale" IN ('zh-CN', 'en-US', 'es-ES', 'pt-BR', 'fr-FR', 'ja-JP')
  );

ALTER TABLE "registration_tokens"
  DROP CONSTRAINT "registration_tokens_locale_check",
  ADD CONSTRAINT "registration_tokens_locale_check" CHECK (
    "locale" IN ('zh-CN', 'en-US', 'es-ES', 'pt-BR', 'fr-FR', 'ja-JP')
  );

COMMIT;
