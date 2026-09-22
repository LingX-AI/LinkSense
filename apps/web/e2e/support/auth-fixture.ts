import type { AuthSession, Locale } from "@linksense/shared"
import dayjs from "dayjs"

const NOW = "2026-07-11T08:00:00.000Z"

export const E2E_ADMIN = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Eli",
  email: "eli@example.com",
  role: "admin",
  status: "active",
  avatar_url: null,
  preferred_locale: "zh-CN",
  language: "zh-CN",
  running_message_action: "queue",
  registration_source: "organization_invitation",
} as const

export function createE2EAuthSession(
  preferredLocale: Locale = "zh-CN"
): AuthSession {
  const issuedAt = dayjs()
  return {
    access_token: "browser-test-access-token-0000000000000000",
    access_token_expires_at: issuedAt.add(1, "hour").toISOString(),
    refresh_session_expires_at: issuedAt.add(7, "day").toISOString(),
    user: {
      id: E2E_ADMIN.id,
      email: E2E_ADMIN.email,
      name: E2E_ADMIN.name,
      avatar_object_key: null,
      role: E2E_ADMIN.role,
      status: E2E_ADMIN.status,
      preferred_locale: preferredLocale,
      running_message_action: E2E_ADMIN.running_message_action,
      last_login_at: NOW,
      last_login_method: "password",
      password_updated_at: NOW,
      created_at: NOW,
      updated_at: NOW,
    },
  }
}
