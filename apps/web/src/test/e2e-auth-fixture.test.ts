// @vitest-environment node

import { authSessionSchema } from "@linksense/shared"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createE2EAuthSession } from "../../e2e/support/auth-fixture"

afterEach(() => vi.useRealTimers())

describe("browser authentication fixture", () => {
  it.each(["zh-CN", "en-US"] as const)(
    "issues a valid, unexpired %s session even after the fixture creation date",
    (locale) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"))

      const session = authSessionSchema.parse(createE2EAuthSession(locale))

      expect(session.user.preferred_locale).toBe(locale)
      expect(session.access_token_expires_at).toBe("2030-01-01T01:00:00.000Z")
      expect(session.refresh_session_expires_at).toBe(
        "2030-01-08T00:00:00.000Z"
      )
    }
  )
})
