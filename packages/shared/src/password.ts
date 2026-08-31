import { z } from "zod";

export const PASSWORD_MIN_CODE_POINTS = 8;
export const PASSWORD_MAX_CODE_POINTS = 16;
export const PASSWORD_POLICY_MESSAGE_KEY =
  "errors.auth.passwordPolicyViolation";

const hasUppercase = /\p{Lu}/u;
const hasLowercase = /\p{Ll}/u;
const hasDecimalDigit = /\p{Nd}/u;
const hasPunctuationOrSymbol = /[\p{P}\p{S}]/u;

export const passwordSchema = z.string().superRefine((password, context) => {
  const codePointLength = Array.from(password).length;
  const isValid =
    codePointLength >= PASSWORD_MIN_CODE_POINTS &&
    codePointLength <= PASSWORD_MAX_CODE_POINTS &&
    hasUppercase.test(password) &&
    hasLowercase.test(password) &&
    hasDecimalDigit.test(password) &&
    hasPunctuationOrSymbol.test(password);

  if (!isValid) {
    context.addIssue({
      code: "custom",
      message: PASSWORD_POLICY_MESSAGE_KEY,
    });
  }
});

export type Password = z.infer<typeof passwordSchema>;
