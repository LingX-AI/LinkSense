import { describe, expect, it } from "vitest";

import {
  defaultPrivacyMaskingSettings,
  privacyMaskingRuntimeSchema,
} from "../src/privacy-masking.js";
import {
  InvalidPrivacyMaskingRegex,
  PrivacyMasker,
} from "../src/privacy-masking-engine/index.js";

const templateId = "10000000-0000-4000-8000-000000000001";
const regexId = "10000000-0000-4000-8000-000000000002";

function masker(overrides: Record<string, unknown> = {}): PrivacyMasker {
  const { enabled: _enabled, ...settings } = defaultPrivacyMaskingSettings;
  return new PrivacyMasker(
    privacyMaskingRuntimeSchema.parse({
      ...settings,
      revision: 1,
      placeholder_key: "a".repeat(64),
      ...overrides,
    }),
  );
}

describe("advanced privacy masking", () => {
  it("leaves new detectors off for an existing policy even if legacy reserved settings are populated", () => {
    const mask = masker({ personal: true, kinds: { EMAIL: true }, words: ["Nightjar"] });
    const result = mask.maskText("Nightjar reaches demo@example.test");
    expect(result.text).toMatch(/^\{\{TERM_[a-f0-9]+\}\} reaches demo@example\.test$/u);
  });

  it("recognizes opted-in email addresses without enabling the other personal-data categories", () => {
    const mask = masker({ personal_rules: { EMAIL: "mask" } });
    const text = "联系demo+team@example.test，电话 +1 202-555-0143";
    const result = mask.maskText(text);
    expect(result.text).toMatch(/^联系\{\{EMAIL_[a-f0-9]+\}\}，电话 \+1 202-555-0143$/u);
    expect(mask.restoreText(result.text)).toBe(text);
  });

  it("keeps assignment syntax and surrounding quotes while masking an email address", () => {
    const mask = masker({ personal_rules: { EMAIL: "mask" } });
    const text = "email='demo+team@example.test'; backup=demo2@example.test";
    const result = mask.maskText(text);
    expect(result.text).toMatch(
      /^email='\{\{EMAIL_[a-f0-9]+\}\}'; backup=\{\{EMAIL_[a-f0-9]+\}\}$/u,
    );
    expect(mask.restoreText(result.text)).toBe(text);
  });

  it("matches international phones but only matches national formats for the selected region", () => {
    const options = { personal_rules: { PHONE: "mask" } };
    const text = "call +1 202-555-0143; local (202) 555-0144; order 734892";
    expect(masker(options).maskText(text).text).toMatch(
      /^call \{\{PHONE_[a-f0-9]+\}\}; local \(202\) 555-0144; order 734892$/u,
    );
    const mask = masker({ ...options, phone_region: "US" });
    const result = mask.maskText(text);
    expect(result.text).toMatch(
      /^call \{\{PHONE_[a-f0-9]+\}\}; local \{\{PHONE_[a-f0-9]+\}\}; order 734892$/u,
    );
    expect(mask.restoreText(result.text)).toBe(text);
  });

  it("requires a valid date and checksum for an 18-character mainland China ID", () => {
    const mask = masker({ personal_rules: { ID_CARD: "mask" } });
    const text = "身份证99000020000229001x，错码990000200002290010，错误日期990000190002290013";
    const result = mask.maskText(text);
    expect(result.text).toMatch(
      /^身份证\{\{ID_CARD_[a-f0-9]+\}\}，错码990000200002290010，错误日期990000190002290013$/u,
    );
    expect(mask.restoreText(result.text)).toBe(text);
  });

  it("checks the card label and checksum without masking a same-length order number", () => {
    const mask = masker({ personal_rules: { BANK_CARD: "mask" } });
    const text = "银行卡号码：4111 1111 1111 1111；order 4111111111111111；card number: 4111111111111112";
    const result = mask.maskText(text);
    expect(result.text).toMatch(
      /^银行卡号码：\{\{BANK_CARD_[a-f0-9]+\}\}；order 4111111111111111；card number: 4111111111111112$/u,
    );
    expect(mask.restoreText(result.text)).toBe(text);
    const argumentsJson = '{"card_number":"4111-1111-1111-1111"}';
    const maskedArguments = mask.maskText(argumentsJson, "embedded-json");
    expect(maskedArguments.text).toMatch(/^\{"card_number":"\{\{BANK_CARD_[a-f0-9]+\}\}"\}$/u);
    expect(mask.restoreText(maskedArguments.text, "embedded-json")).toBe(argumentsJson);
  });

  it("masks business IDs by template or regex and attributes each hit to its rule", () => {
    const mask = masker({
      words: ["Nightjar"],
      custom_rules: [
        { id: templateId, name: "Customer number", type: "prefix_digits", prefix: "CUS+", digits: 6, action: "mask" },
        { id: regexId, name: "Warehouse ID", type: "regex", pattern: "WH-[A-Z]{2}[0-9]{3}", action: "mask" },
      ],
    });
    const text = "Nightjar 📦 CUS+000042 / WH-AB123 / CUS+1234567 / XCUS+000042";
    const result = mask.maskText(text);
    expect(result.text).not.toContain("WH-AB123");
    expect(result.text).toMatch(/\/ CUS\+1234567 \/ XCUS\+000042$/u);
    expect(result.hits.map(({ rule_ids }) => rule_ids)).toEqual([undefined, [templateId], [regexId]]);
    expect(mask.restoreText(result.text)).toBe(text);
  });

  it("masks the entire union of overlapping values and does not let a mask rule hide a block", () => {
    const mask = masker({
      personal_rules: { EMAIL: "mask" },
      custom_rules: [
        { id: templateId, name: "Customer number", type: "prefix_digits", prefix: "CUS-", digits: 6, action: "mask" },
        { id: regexId, name: "Confidential suffix", type: "regex", pattern: "example\\.test", action: "block" },
      ],
    });
    const result = mask.maskText("ref CUS-123456@example.test");
    expect(result.text).toMatch(/^ref \{\{EMAIL_[a-f0-9]+\}\}$/u);
    expect(result.hits).toEqual([
      expect.objectContaining({ kind: "TERM", action: "block", rule_ids: [regexId] }),
      expect.objectContaining({ kind: "EMAIL", action: "mask", rule_ids: [templateId] }),
    ]);
    expect(mask.restoreText(result.text)).toBe("ref CUS-123456@example.test");
  });

  it.each(["(", "(?=CUS-)", "(CUS-)\\1", "a*", "[a-z]{300}"])(
    "rejects the unsupported regex %s instead of silently ignoring the rule",
    (pattern) => {
      expect(() => masker({
        custom_rules: [{ id: regexId, name: "Customer ID", type: "regex", pattern, action: "mask" }],
      })).toThrow(InvalidPrivacyMaskingRegex);
    },
  );

  it("fails closed if a contextual assertion yields a zero-length match", () => {
    const mask = masker({
      custom_rules: [{
        id: regexId, name: "Customer ID", type: "regex",
        pattern: "\\b|CUS-[0-9]{6}", action: "mask",
      }],
    });
    expect(() => mask.maskText("CUS-123456")).toThrow(InvalidPrivacyMaskingRegex);
  });

  it("honors an exact case-insensitive allowlisted match, including for block", () => {
    const mask = masker({
      allow: ["demo@example.test"],
      personal_rules: { EMAIL: "block" },
    });
    const text = "Demo@example.test contacting another@example.test";
    const result = mask.maskText(text);
    expect(result.hits).toEqual([
      expect.objectContaining({ kind: "EMAIL", action: "block" }),
    ]);
    expect(result.hits[0]?.length).toBe("another@example.test".length);
  });
});
