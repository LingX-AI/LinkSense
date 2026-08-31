const MILLION_TOKEN_UNIT = 1_000_000n

export const MILLION_TOKEN_QUOTA_INPUT_PATTERN = "\\d+(?:\\.\\d{1,6})?"

const millionTokenQuotaInputRegex = new RegExp(
  `^${MILLION_TOKEN_QUOTA_INPUT_PATTERN}$`,
  "u"
)

export function tokenLimitToMillionTokenQuotaInput(
  value: string | null | undefined
): string {
  const trimmed = value?.trim()
  if (!trimmed) return ""
  const tokenCount = BigInt(trimmed)
  const whole = tokenCount / MILLION_TOKEN_UNIT
  const remainder = tokenCount % MILLION_TOKEN_UNIT
  if (remainder === 0n) return whole.toString()
  const fraction = remainder.toString().padStart(6, "0").replace(/0+$/u, "")
  return `${whole.toString()}.${fraction}`
}

export function millionTokenQuotaInputToTokenLimit(
  value: string
): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!millionTokenQuotaInputRegex.test(trimmed)) {
    throw new Error("invalid_million_token_quota")
  }
  const [wholePart, fractionPart = ""] = trimmed.split(".")
  const whole = BigInt(wholePart)
  const fraction = BigInt(fractionPart.padEnd(6, "0"))
  const tokenCount = whole * MILLION_TOKEN_UNIT + fraction
  if (tokenCount <= 0n) {
    throw new Error("invalid_million_token_quota")
  }
  return tokenCount.toString()
}
