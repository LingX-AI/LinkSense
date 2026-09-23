import {
  creditAmountSchema,
  creditLimitValueSchema,
  CREDIT_INPUT_PATTERN,
  type Locale,
} from "@linksense/shared"

export const CREDIT_QUOTA_INPUT_PATTERN = CREDIT_INPUT_PATTERN

export function creditLimitToCreditQuotaInput(
  value: string | null | undefined
): string {
  return value == null || value.trim() === ""
    ? ""
    : creditAmountSchema.parse(value)
}

export function creditQuotaInputToCreditLimit(value: string): string | null {
  return value.trim() === "" ? null : creditLimitValueSchema.parse(value)
}

/** Display only: discard fractional credits without changing the stored value. */
export function formatCreditAmount(value: string, language: string): string {
  const parsed = creditAmountSchema.safeParse(value)
  if (!parsed.success) return "-"
  const whole = parsed.data.split(".")[0] ?? "0"
  return BigInt(whole).toLocaleString(language)
}

export function formatRemainingCredits(
  value: string | null | undefined,
  language: Locale
): string {
  return value == null ? "-" : formatCreditAmount(value, language)
}
