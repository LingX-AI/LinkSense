import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const migrationPath = fileURLToPath(
  new URL(
    "../../../prisma/migrations/20260724190000_rebuild_knowledge_processing/migration.sql",
    import.meta.url,
  ),
)

describe("knowledge processing rebuild migration", () => {
  it("resets only the approved knowledge domain and preserves ordinary conversations", async () => {
    const migration = await readFile(migrationPath, "utf8")
    const truncate = migration.match(/TRUNCATE TABLE([\s\S]*?);/u)?.[1] ?? ""

    for (const table of [
      "knowledge_bases",
      "knowledge_base_documents",
      "knowledge_base_document_versions",
      "knowledge_base_objects",
      "conversation_message_knowledge_citations",
      "conversation_turn_knowledge_bases",
    ]) {
      expect(truncate).toContain(`"${table}"`)
    }
    for (const preservedTable of [
      "users",
      "conversations",
      "conversation_messages",
    ]) {
      expect(truncate).not.toContain(`"${preservedTable}"`)
    }
    expect(migration).not.toMatch(/\bCASCADE\b/u)
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b/iu)
    expect(migration).toContain(
      'UPDATE "conversations"\nSET "selected_knowledge_base_ids_json" = \'[]\'::jsonb',
    )
  })

  it("replaces legacy processing fields with explicit artifacts and attempts", async () => {
    const migration = await readFile(migrationPath, "utf8")

    for (const legacyColumn of [
      "docling_task_id",
      "docling_result_discarded",
      "markdown_normalization_version",
      "checkpoint_json",
      "segmentation_config_digest",
    ]) {
      expect(migration).toContain(`DROP COLUMN "${legacyColumn}"`)
    }
    for (const column of [
      "docling_bundle_object_id",
      "display_markdown_object_id",
      "docling_json_object_id",
      "hybrid_chunks_object_id",
      "retrieval_manifest_object_id",
      "parsed_asset_count",
      "chunking_config_digest",
      "child_count",
      "index_integrity_digest",
    ]) {
      expect(migration).toContain(`ADD COLUMN "${column}"`)
    }
    expect(migration).toContain(
      'CREATE TABLE "knowledge_base_processing_attempts"',
    )
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "kb_processing_attempts_one_active_key"',
    )
    expect(migration).toContain('WHERE "status" = \'active\'')
  })

  it("stores only parent-child and page citation evidence", async () => {
    const migration = await readFile(migrationPath, "utf8")

    expect(migration).toContain('DROP COLUMN "provenance_json"')
    expect(migration).toContain('ADD COLUMN "title_path"')
    expect(migration).toContain('ADD COLUMN "matched_child_ids"')
    expect(migration).toContain('ADD COLUMN "page_numbers"')
    expect(migration).toContain('0 < ALL("page_numbers")')
  })
})
