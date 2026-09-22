import type { Prisma } from "../../generated/prisma/client.js"
import {
  quotaSettingsFromJson,
  storedCreditLimits,
} from "../system/quota-settings.js"

export function readSelfRegistrationPolicy(
  value: Prisma.JsonValue | undefined,
): ReturnType<typeof storedCreditLimits> | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null
  const registration = value.self_registration
  if (
    !registration ||
    Array.isArray(registration) ||
    typeof registration !== "object" ||
    registration.enabled !== true
  )
    return null
  const settings = quotaSettingsFromJson(value)
  return storedCreditLimits({
    weekly_credit_limit: settings.weekly_credit_limit,
  })
}
