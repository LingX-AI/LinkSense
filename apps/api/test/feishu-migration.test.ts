import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260827120000_add_feishu_personal_agent_channel/migration.sql",
  import.meta.url,
);

describe("Feishu personal Agent migration", () => {
  it("adds durable channel state without destructive SQL or foreign keys", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "feishu_connections"');
    expect(sql).toContain('CREATE TABLE "feishu_peer_sessions"');
    expect(sql).toContain('CREATE TABLE "feishu_inbound_messages"');
    expect(sql).toContain('CREATE TABLE "feishu_outbound_deliveries"');
    expect(sql).toContain('"encrypted_credentials" TEXT NOT NULL');
    expect(sql).not.toContain('"app_secret"');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/\bREFERENCES\b/iu);
  });

  it("enforces owner, app, message, and queue integrity constraints", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE UNIQUE INDEX "feishu_connections_owner_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "feishu_connections_app_key"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "feishu_inbound_messages_connection_message_key"',
    );
    expect(sql).toContain('CONSTRAINT "feishu_inbound_messages_status_check"');
    expect(sql).toContain(
      'CONSTRAINT "feishu_outbound_deliveries_processing_check"',
    );
  });
});
