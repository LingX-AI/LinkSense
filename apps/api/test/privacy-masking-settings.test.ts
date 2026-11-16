import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultPrivacyMaskingSettings,
  type PrivacyMaskingSettings,
} from "@linksense/shared";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrivacyMaskingSettingsService } from "../src/modules/privacy-masking/service.js";
import { testConfig } from "./test-config.js";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";

afterEach(() => vi.restoreAllMocks());

function settings(
  overrides: Partial<PrivacyMaskingSettings> = {},
): PrivacyMaskingSettings {
  return {
    ...defaultPrivacyMaskingSettings,
    enabled: true,
    words: ["Nightjar", "  nightjar "],
    allow: ["example@example.test"],
    ...overrides,
  };
}

function fixture() {
  const rows = new Map<
    string,
    {
      encryptedSettings: string;
      encryptionKeyId: string;
      revision: number;
    }
  >();
  const database = {
    $executeRaw: vi.fn(),
    userPrivacyMaskingSetting: {
      findUnique: vi.fn(
        async ({ where }: { where: { userId: string } }) =>
          rows.get(where.userId) ?? null,
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { userId: string };
          create: {
            encryptedSettings: string;
            encryptionKeyId: string;
            revision: number;
          };
          update: {
            encryptedSettings: string;
            encryptionKeyId: string;
            revision: number;
          };
        }) => {
          const value = rows.has(where.userId) ? update : create;
          rows.set(where.userId, {
            encryptedSettings: value.encryptedSettings,
            encryptionKeyId: value.encryptionKeyId,
            revision: value.revision,
          });
        },
      ),
    },
    auditLog: { create: vi.fn() },
  };
  const prisma = {
    ...database,
    $transaction: async <T>(
      fn: (transaction: typeof database) => Promise<T>,
    ) => fn(database),
  } as unknown as PrismaClient;
  return {
    database,
    rows,
    service: new PrivacyMaskingSettingsService(prisma, testConfig()),
  };
}

describe("privacy masking settings", () => {
  it("uses defaults and stays off until the user changes something", async () => {
    const f = fixture();
    await expect(f.service.getForUser(userA)).resolves.toEqual({
      revision: 0,
      settings: defaultPrivacyMaskingSettings,
    });
    await expect(f.service.runtimeForUser(userA)).resolves.toBeUndefined();
    expect(f.database.auditLog.create).not.toHaveBeenCalled();
  });

  it("stores encrypted settings and exposes only the runner configuration", async () => {
    const f = fixture();
    const saved = await f.service.updateForUser(
      userA,
      { expected_revision: 0, settings: settings() },
      {},
    );
    expect(saved.revision).toBe(1);
    expect(saved.settings.words).toEqual(["Nightjar"]);
    expect(JSON.stringify(f.rows.get(userA))).not.toContain("Nightjar");
    expect(JSON.stringify(f.rows.get(userA))).not.toContain(
      "example@example.test",
    );
    expect(f.database.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "privacy_masking_settings_updated",
          targetType: "user_privacy_masking",
          targetId: userA,
          metadataJson: expect.objectContaining({
            revision: 1,
            enabled: true,
            word_count: 1,
            allow_count: 1,
          }),
        }),
      }),
    );
    expect(
      JSON.stringify(f.database.auditLog.create.mock.calls),
    ).not.toContain("Nightjar");

    const runtime = await f.service.runtimeForUser(userA);
    expect(runtime).toMatchObject({
      revision: 1,
      secrets: true,
      words: ["Nightjar"],
      allow: ["example@example.test"],
    });
    expect(runtime).not.toHaveProperty("enabled");
    expect(runtime?.placeholder_key).toMatch(/^[0-9a-f]{64}$/u);
    const other = await f.service.runtimeForUser(userB);
    expect(other).toBeUndefined();
    await f.service.updateForUser(
      userB,
      { expected_revision: 0, settings: settings() },
      {},
    );
    const otherRuntime = await f.service.runtimeForUser(userB);
    expect(otherRuntime?.placeholder_key).not.toBe(runtime?.placeholder_key);
  });

  it("rejects a stale revision without changing the stored settings", async () => {
    const f = fixture();
    await f.service.updateForUser(
      userA,
      { expected_revision: 0, settings: settings() },
      {},
    );
    await expect(
      f.service.updateForUser(
        userA,
        { expected_revision: 0, settings: settings({ words: ["Other"] }) },
        {},
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.getForUser(userA)).resolves.toMatchObject({
      revision: 1,
      settings: { words: ["Nightjar"] },
    });
  });

  it("fails closed when the stored settings cannot be decrypted", async () => {
    const f = fixture();
    await f.service.updateForUser(
      userA,
      { expected_revision: 0, settings: settings() },
      {},
    );
    const row = f.rows.get(userA);
    if (!row) throw new Error("row missing");
    row.encryptedSettings = "corrupt-envelope";
    await expect(f.service.getForUser(userA)).rejects.toMatchObject({
      code: "PRIVACY_MASKING_SETTINGS_UNAVAILABLE",
    });
    await expect(f.service.runtimeForUser(userA)).rejects.toMatchObject({
      code: "PRIVACY_MASKING_SETTINGS_UNAVAILABLE",
    });
  });

  it("validates the settings before storing them", async () => {
    const f = fixture();
    await expect(
      f.service.updateForUser(
        userA,
        {
          expected_revision: 0,
          settings: settings({
            words: Array.from({ length: 201 }, (_, index) => `word-${index}`),
          }),
        },
        {},
      ),
    ).rejects.toThrow();
    await expect(
      f.service.updateForUser(
        userA,
        {
          expected_revision: 0,
          settings: settings({ actions: { UNKNOWN: "mask" } }),
        },
        {},
      ),
    ).rejects.toThrow();
    expect(f.rows.size).toBe(0);
  });
});
