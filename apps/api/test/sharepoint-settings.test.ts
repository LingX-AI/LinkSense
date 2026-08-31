import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import {
  SharePointSettingsService,
  type SharePointCredentialProbe,
} from "../src/modules/knowledge-sources/sharepoint-settings.js";
import { testConfig } from "./test-config.js";

const ACTOR_ID = "00000000-0000-4000-8000-000000000099";

describe("SharePointSettingsService", () => {
  it("validates credentials, encrypts the secret, and never projects it", async () => {
    const database = inMemoryDatabase();
    const probe: SharePointCredentialProbe = {
      validateCredentials: vi.fn(async () => undefined),
    };
    const service = new SharePointSettingsService(
      database.prisma,
      testConfig(),
      probe,
    );

    const saved = await service.update(
      ACTOR_ID,
      {
        expected_revision: 0,
        enabled: true,
        tenant_id: "00000000-0000-4000-8000-000000000111",
        client_id: "00000000-0000-4000-8000-000000000222",
        tenant_domain: "Contoso.SharePoint.com",
        client_secret: "sharepoint-secret",
      },
      {},
    );

    expect(probe.validateCredentials).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantDomain: "contoso.sharepoint.com",
        clientSecret: "sharepoint-secret",
      }),
    );
    expect(saved).toMatchObject({
      enabled: true,
      revision: 1,
      tenant_domain: "contoso.sharepoint.com",
      client_secret_configured: true,
    });
    expect(JSON.stringify(saved)).not.toContain("sharepoint-secret");
    expect(JSON.stringify(database.settingsJson())).not.toContain(
      "sharepoint-secret",
    );
    await expect(service.resolveRuntime()).resolves.toMatchObject({
      clientSecret: "sharepoint-secret",
    });
  });

  it("does not persist settings when Microsoft identity validation fails", async () => {
    const database = inMemoryDatabase();
    const service = new SharePointSettingsService(
      database.prisma,
      testConfig(),
      {
        validateCredentials: vi.fn(async () => {
          throw new Error("invalid client");
        }),
      },
    );

    await expect(
      service.update(
        ACTOR_ID,
        {
          expected_revision: 0,
          enabled: true,
          tenant_id: "00000000-0000-4000-8000-000000000111",
          client_id: "00000000-0000-4000-8000-000000000222",
          tenant_domain: "contoso.sharepoint.com",
          client_secret: "sharepoint-secret",
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: "KNOWLEDGE_SOURCE_CREDENTIAL_VALIDATION_FAILED",
    });
    expect(database.settingsJson()).toEqual({});
  });
});

function inMemoryDatabase(): {
  prisma: PrismaClient;
  settingsJson: () => Record<string, unknown>;
} {
  let settingsJson: Record<string, unknown> = {};
  const findUnique = vi.fn(async () =>
    Object.keys(settingsJson).length === 0 ? null : { settingsJson },
  );
  const upsert = vi.fn(
    async (input: {
      create: { settingsJson: Record<string, unknown> };
      update: { settingsJson: Record<string, unknown> };
    }) => {
      settingsJson =
        Object.keys(settingsJson).length === 0
          ? { ...input.create.settingsJson }
          : { ...input.update.settingsJson };
      return { settingsJson };
    },
  );
  const transactionClient = {
    $executeRaw: vi.fn(async () => 1),
    systemSetting: { findUnique, upsert },
    auditLog: { create: vi.fn(async () => ({ id: "audit-id" })) },
  };
  const prisma = {
    systemSetting: { findUnique },
    $transaction: vi.fn(
      async (
        callback: (client: typeof transactionClient) => Promise<unknown>,
      ) => callback(transactionClient),
    ),
  } as unknown as PrismaClient;
  return { prisma, settingsJson: () => ({ ...settingsJson }) };
}
