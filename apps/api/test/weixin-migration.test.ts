import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260813160000_add_native_weixin_channel/migration.sql",
  import.meta.url,
);

describe("native Weixin channel migration", () => {
  it("adds durable channel state without destructive SQL or foreign keys", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE TABLE "weixin_connections"');
    expect(sql).toContain('CREATE TABLE "weixin_peer_sessions"');
    expect(sql).toContain('CREATE TABLE "weixin_inbound_messages"');
    expect(sql).toContain('CREATE TABLE "weixin_outbound_deliveries"');
    expect(sql).toContain('"encrypted_state" TEXT NOT NULL');
    expect(sql).toContain('"encrypted_context" TEXT NOT NULL');
    expect(sql).not.toContain('"context_token"');
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/\bREFERENCES\b/iu);
  });

  it("enforces one account per owner and durable queue state checks", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    expect(sql).toContain('CREATE UNIQUE INDEX "weixin_connections_owner_key"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "weixin_inbound_messages_connection_message_key"',
    );
    expect(sql).toContain('CONSTRAINT "weixin_inbound_messages_status_check"');
    expect(sql).toContain('"processing_token" UUID');
    expect(sql).toContain('"ingest_order" BIGINT NOT NULL');
    expect(sql).toContain("'processing'");
    expect(sql).toContain(
      'CONSTRAINT "weixin_outbound_deliveries_sent_check"',
    );
    expect(sql).toContain(
      'CONSTRAINT "weixin_outbound_deliveries_processing_check"',
    );
  });
});
