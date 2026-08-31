-- Directory paths now define document-name and duplicate-content conflicts.
-- Removing these legacy partial unique indexes is non-destructive and allows
-- equal names or content to exist in different directories.
DROP INDEX IF EXISTS "knowledge_base_documents_active_name_key";
DROP INDEX IF EXISTS "knowledge_base_documents_active_sha_key";
