import { RE2JS, RE2JSException } from "re2js";

import {
  MAX_PRIVACY_MASKING_REGEX_LENGTH,
  type PrivacyMaskingCustomRule,
} from "../privacy-masking.js";

const maxProgramSize = 256;

export class InvalidPrivacyMaskingRegex extends Error {
  constructor(readonly ruleId: string) {
    super("Unsupported privacy masking regex");
    this.name = "InvalidPrivacyMaskingRegex";
  }
}

export function compilePrivacyMaskingRegex(
  rule: Extract<PrivacyMaskingCustomRule, { type: "regex" }>,
): RE2JS {
  if (rule.pattern.length > MAX_PRIVACY_MASKING_REGEX_LENGTH || !rule.pattern.trim()) {
    throw new InvalidPrivacyMaskingRegex(rule.id);
  }
  try {
    const regex = RE2JS.compile(rule.pattern);
    if (regex.programSize() > maxProgramSize || regex.matcher("").find()) {
      throw new InvalidPrivacyMaskingRegex(rule.id);
    }
    return regex;
  } catch (error) {
    if (error instanceof RE2JSException) throw new InvalidPrivacyMaskingRegex(rule.id);
    throw error;
  }
}

export function validatePrivacyMaskingRegexRules(rules: readonly PrivacyMaskingCustomRule[]): void {
  for (const rule of rules) {
    if (rule.type === "regex") compilePrivacyMaskingRegex(rule);
  }
}
