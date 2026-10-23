import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_PREVIEW_BYTES, imagePreviewMimeTypeSchema } from "@linksense/shared";

const migrationUrl = new URL("../../../prisma/migrations/20261023090000_allow_conversation_image_previews/migration.sql", import.meta.url);

describe("image preview database invariants", () => {
  it("widens both kind constraints in a forward transaction without rewriting historical records or fields", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toMatch(/\bBEGIN;/u);
    expect(sql).toMatch(/\bCOMMIT;/u);
    expect(sql).toContain('DROP CONSTRAINT "conversation_files_kind_check"');
    expect(sql).toContain('DROP CONSTRAINT "conversation_files_kind_status_check"');
    expect(sql).toContain("'attachment', 'artifact', 'image_preview'");
    expect(sql).toContain("'artifact', 'image_preview'");
    expect(sql).toContain("'staged', 'pending', 'bound'");
    expect(sql).not.toMatch(/\b(?:DELETE|UPDATE|INSERT|TRUNCATE)\b|DROP\s+(?:TABLE|COLUMN)|NOT\s+VALID/iu);
  });

  it("requires preview snapshots to be turn-bound private workspace images with a checksum", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain('ADD CONSTRAINT "conversation_files_image_preview_binding_check"');
    for (const invariant of [
      '"source" = \'system_generated\'', '"status" = \'registered\'',
      '"turn_id" IS NOT NULL', '"pending_request_id" IS NULL',
      '"storage_backend" = \'workspace\'', '"minio_object_key" IS NULL',
      '"workspace_relative_path" IS NOT NULL', '"workspace_root_rel_path" IS NOT NULL',
      '"downloadable" = FALSE', '"download_card_event_id" IS NULL',
      '"checksum_sha256" IS NOT NULL', '"mime_type" IS NOT NULL',
      `"size_bytes" BETWEEN 1 AND ${MAX_IMAGE_PREVIEW_BYTES}`,
    ]) expect(sql).toContain(invariant);
    for (const mime of imagePreviewMimeTypeSchema.options) expect(sql).toContain(`'${mime}'`);
  });
});
