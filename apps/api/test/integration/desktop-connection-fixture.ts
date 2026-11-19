import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ConnectionConfiguration } from "@linksense/shared";
import type { AppConfig } from "../../src/config.js";
import type { PrismaClient } from "../../src/generated/prisma/client.js";
import { encryptJson } from "../../src/lib/crypto.js";
import type { AuditService } from "../../src/modules/audit/service.js";
import { connectionScopes } from "../../src/modules/connections/protocol.js";
import { PrismaConnectionRepository } from "../../src/modules/connections/repository.js";
import { ConnectionService } from "../../src/modules/connections/service.js";

export async function createDesktopConnectionFixture(
  prisma: PrismaClient, config: AppConfig, audit: AuditService, ownerId: string, otherOwnerId: string,
) {
  const settings: ConnectionConfiguration = { revision: 1, client_id: randomUUID(), client_secret: randomUUID() };
  const providers = ["onedrive", "google_docs"] as const;
  const tokens = new Map<string, string>();
  const secrets = [settings.client_secret];
  const repository = new PrismaConnectionRepository(prisma);
  const foreignAccount = "other-connector-fixture@example.test";
  for (const [ownedBy, accountName, provider] of [
    [ownerId, "desktop-connector-fixture@example.test", "onedrive"],
    [ownerId, "desktop-connector-fixture@example.test", "google_docs"],
    [otherOwnerId, foreignAccount, "onedrive"],
  ] as const) {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    const token = {
      clientId: settings.client_id, accountId: accountName, accessToken, refreshToken,
      expiresAt: Date.now() + 600_000, scopes: connectionScopes[provider],
      ...(provider === "onedrive" ? { tenantId: randomUUID() } : {}),
    };
    secrets.push(accessToken, refreshToken);
    tokens.set(`${ownedBy}:${provider}`, accessToken);
    await repository.mutate(ownedBy, provider, async () => ({
      status: "connected", enabled: true, accountName, connectedAt: new Date(),
      encryptedPayload: encryptJson(token, config.credentialMasterKey, config.credentialKeyId,
        `linksense:connections:v1:account:${ownedBy}:${provider}`),
      encryptionKeyId: config.credentialKeyId, revision: 1,
    }));
  }
  const driveName = `fixture-drive-${randomUUID()}`;
  const documentName = `fixture-docs-${randomUUID()}`;
  const documentText = '你好🌿 "fixture" \\ \n'.repeat(550);
  const stats = { graph: 0, workspace: 0, documentPages: 0, started: 0, aborted: 0 };
  const outsideFixture = async (): Promise<never> => { throw new Error("Unexpected connector provider call"); };
  const service = new ConnectionService({
    repository, audit, masterKey: config.credentialMasterKey, keyId: config.credentialKeyId,
    settings: { resolve: async provider => providers.some(item => item === provider) ? settings : null },
    states: { read: outsideFixture, put: outsideFixture, throttle: outsideFixture },
    protocol: { start: outsideFixture, complete: outsideFixture, refresh: outsideFixture },
    graph: {
      async execute(token, request, next, signal) {
        assert(token === tokens.get(`${ownerId}:onedrive`), "connector did not use the Mac owner's account");
        assert.equal(request.operation, "list_drives");
        assert.equal(next, undefined);
        assert(signal);
        stats.graph++;
        return {
          result: { kind: "page", items: [{
            id: "fixture-drive", name: driveName, web_url: null, kind: "drive",
            drive_id: null, mime_type: null, size_bytes: null, etag: null,
          }], next_cursor: null },
          nextLink: null,
        };
      },
    },
    workspace: {
      async execute(token, request, next, signal) {
        assert(token === tokens.get(`${ownerId}:google_docs`), "connector did not use the Mac owner's account");
        assert(request.provider === "google_docs");
        assert.equal(next, undefined);
        assert(signal);
        if (request.operation === "read_document") {
          assert.equal(request.document_id, "fixture-doc");
          stats.documentPages++;
          return { result: { kind: "workspace_data", data: {
            documentId: "fixture-doc", title: documentName,
            body: { content: [{ paragraph: { elements: [{ textRun: { content: documentText } }] } }] },
            inlineObjects: { fixture: { contentUri: "https://images.example.test/hidden-fixture" } },
          }, next_cursor: null }, nextLink: null };
        }
        assert(request.operation === "search_documents");
        stats.workspace++;
        if (request.query === "fixture pending connector") {
          stats.started++;
          try {
            await delay(15_000, null, { signal });
          } finally {
            if (signal.aborted) stats.aborted++;
          }
        }
        return { result: { kind: "workspace_data", data: [{ name: documentName }], next_cursor: null }, nextLink: null };
      },
    },
  });
  return { service, stats, secrets, driveName, documentName, documentText, foreignAccount };
}
