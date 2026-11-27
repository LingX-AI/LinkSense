import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultPrivacyMaskingSettings,
  type PrivacyMaskingSettings,
} from "@linksense/shared";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { encryptJson } from "../src/lib/crypto.js";
import { PrivacyMaskingSettingsService } from "../src/modules/privacy-masking/service.js";
import { testConfig } from "./test-config.js";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const ruleId = "10000000-0000-4000-8000-000000000003";

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

  it("preserves separately configured case-sensitive words", async () => {
    const f = fixture();
    const saved = await f.service.updateForUser(
      userA,
      {
        expected_revision: 0,
        settings: settings({
          words: ["Nightjar", "nightjar", "  Nightjar  "],
          words_any_case: false,
        }),
      },
      {},
    );

    expect(saved.settings.words).toEqual(["Nightjar", "nightjar"]);
    await expect(f.service.runtimeForUser(userA)).resolves.toMatchObject({
      words: ["Nightjar", "nightjar"],
      words_any_case: false,
    });
  });

  it("preserves distinct allowlist spellings across save, read, and runner settings", async () => {
    const f = fixture();
    const draft = settings({
      allow: ["  DemoValue-123!  ", "demovalue-123!", "DemoValue-123!"],
    });
    const saved = await f.service.updateForUser(
      userA,
      { expected_revision: 0, settings: draft },
      {},
    );

    const allow = ["DemoValue-123!", "demovalue-123!"];
    expect(saved.settings.allow).toEqual(allow);
    await expect(f.service.getForUser(userA)).resolves.toMatchObject({
      revision: 1,
      settings: { allow },
    });
    await expect(f.service.runtimeForUser(userA)).resolves.toMatchObject({
      revision: 1,
      allow,
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

  it("previews the draft settings with the user's own stable placeholders", async () => {
    const f = fixture();
    const text =
      "Nightjar deploys with sk-proj-abcdefghijklmnopqrstuvwx and mails example@example.test";
    const first = await f.service.previewForUser(userA, {
      text,
      settings: settings(),
    });
    expect(first.text).not.toContain("Nightjar");
    expect(first.text).not.toContain("sk-proj-abcdefghijklmnopqrstuvwx");
    expect(first.text).toContain("example@example.test");
    expect(first.hits.map((hit) => hit.kind).sort()).toEqual([
      "API_KEY",
      "TERM",
    ]);
    expect(first.hits.every((hit) => hit.action === "mask")).toBe(true);

    const again = await f.service.previewForUser(userA, {
      text,
      settings: settings(),
    });
    expect(again.text).toBe(first.text);
    const otherUser = await f.service.previewForUser(userB, {
      text,
      settings: settings(),
    });
    expect(otherUser.text).not.toBe(first.text);
  });

  it("previews only the exact allowlisted spelling as unmasked in a draft", async () => {
    const f = fixture();
    const preview = await f.service.previewForUser(userA, {
      text: "password=DemoValue-123!\npassword=demovalue-123!",
      settings: settings({ allow: ["DemoValue-123!"] }),
    });

    expect(preview.text).toMatch(
      /^password=DemoValue-123!\npassword=\{\{SECRET_[a-f0-9]{16}\}\}$/u,
    );
    expect(f.rows.size).toBe(0);
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

  it("reads and updates an encrypted pre-upgrade policy without enabling the new detectors", async () => {
    const fixtureData = fixture();
    const config = testConfig();
    const legacy = {
      enabled: true,
      secrets: true,
      personal: true,
      kinds: { EMAIL: true },
      words: ["Nightjar"],
      words_any_case: true,
      words_whole: true,
      actions: {},
      allow: ["DemoValue-123!"],
    };
    fixtureData.rows.set(userA, {
      encryptedSettings: encryptJson(
        legacy,
        config.credentialMasterKey,
        config.credentialKeyId,
        "linksense:user-privacy-masking:v1",
      ),
      encryptionKeyId: config.credentialKeyId,
      revision: 7,
    });

    const saved = await fixtureData.service.getForUser(userA);
    expect(saved).toEqual({ revision: 7, settings: legacy });
    await expect(fixtureData.service.previewForUser(userA, {
      text: "Nightjar contacts demo@example.test\npassword=DemoValue-123!\npassword=demovalue-123!",
    })).resolves.toMatchObject({
      text: expect.stringMatching(
        /^\{\{TERM_[a-f0-9]+\}\} contacts demo@example\.test\npassword=DemoValue-123!\npassword=\{\{SECRET_[a-f0-9]{16}\}\}$/u,
      ),
    });
    await expect(fixtureData.service.updateForUser(userA, {
      expected_revision: saved.revision,
      settings: { ...saved.settings, personal_rules: { EMAIL: "mask" } },
    }, {})).resolves.toMatchObject({ revision: 8 });
    await expect(fixtureData.service.runtimeForUser(userA)).resolves.toMatchObject({
      revision: 8,
      words: ["Nightjar"],
      allow: ["DemoValue-123!"],
      personal_rules: { EMAIL: "mask" },
    });
  });

  it("validates RE2 syntax before both preview and storage without returning the pattern", async () => {
    const fixtureData = fixture();
    const draft = settings({
      custom_rules: [{
        id: ruleId, name: "Private ID", type: "regex", pattern: "(?=CUS-)", action: "mask",
      }],
    });
    const error = { code: "VALIDATION_ERROR", params: { privacy_masking_rule_id: ruleId } };
    await expect(fixtureData.service.updateForUser(userA, {
      expected_revision: 0, settings: draft,
    }, {})).rejects.toMatchObject(error);
    await expect(fixtureData.service.previewForUser(userA, {
      settings: draft, text: "CUS-000001",
    })).rejects.toMatchObject(error);
    expect(fixtureData.rows.size).toBe(0);
    expect(fixtureData.database.auditLog.create).not.toHaveBeenCalled();
  });

  it("does not discard advanced rules when a legacy settings update omits them", async () => {
    const fixtureData = fixture();
    const legacy = settings();
    const rule = {
      id: ruleId, name: "Customer ID", type: "prefix_digits",
      prefix: "CUS-", digits: 6, action: "block",
    } as const;
    await fixtureData.service.updateForUser(userA, {
      expected_revision: 0,
      settings: { ...legacy, custom_rules: [rule], personal_rules: { EMAIL: "mask" } },
    }, {});
    await fixtureData.service.updateForUser(userA, {
      expected_revision: 1, settings: { ...legacy, words: ["Updated"] },
    }, {});
    await expect(fixtureData.service.runtimeForUser(userA)).resolves.toMatchObject({
      custom_rules: [rule],
      personal_rules: { EMAIL: "mask" },
      words: ["Updated"],
    });
    await fixtureData.service.updateForUser(userA, {
      expected_revision: 2,
      settings: { ...legacy, custom_rules: [], personal_rules: {} },
    }, {});
    await expect(fixtureData.service.runtimeForUser(userA)).resolves.toMatchObject({
      custom_rules: [],
      personal_rules: {},
    });
  });

  it("identifies overlapping rules in a draft preview and shows no outbound text when a rule blocks", async () => {
    const fixtureData = fixture();
    const draft = settings({
      enabled: false,
      personal_rules: { EMAIL: "mask" },
      custom_rules: [{
        id: ruleId, name: "Private ID", type: "regex", pattern: "CUS-[0-9]{6}", action: "block",
      }],
    });
    const text = "CUS-000001@example.test";
    const preview = await fixtureData.service.previewForUser(userA, { settings: draft, text });
    expect(preview).toMatchObject({
      blocked: true,
      text: "",
      hits: [
        { kind: "TERM", action: "block", rule_ids: [ruleId] },
        { kind: "EMAIL", action: "mask" },
      ],
    });
    expect(JSON.stringify(preview)).not.toContain(text);
    expect(fixtureData.rows.size).toBe(0);

    draft.custom_rules = [{
      id: ruleId, name: "Private ID", type: "regex", pattern: "CUS-[0-9]{6}", action: "mask",
    }];
    await expect(fixtureData.service.previewForUser(userA, {
      settings: draft,
      text,
    })).resolves.toMatchObject({
      text: expect.stringMatching(/^\{\{EMAIL_[a-f0-9]+\}\}$/u),
      hits: [{ kind: "EMAIL", action: "mask", rule_ids: [ruleId], related_kinds: ["TERM"] }],
    });
  });
});
