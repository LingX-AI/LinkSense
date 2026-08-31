import { describe, expect, it, vi } from "vitest"

import type { AppConfig } from "../src/config.js"
import { NodemailerPasswordMailGateway } from "../src/modules/auth/mail.js"

describe("NodemailerPasswordMailGateway", () => {
  it("treats an entirely absent deployment as optional and never creates a transport", async () => {
    const factory = vi.fn()
    const gateway = new NodemailerPasswordMailGateway(
      smtp({ status: "not_configured" }),
      factory,
    )
    await expect(gateway.status()).resolves.toBe("not_configured")
    expect(factory).not.toHaveBeenCalled()
  })

  it("treats partial authentication settings as unavailable without blocking construction", async () => {
    const factory = vi.fn()
    const gateway = new NodemailerPasswordMailGateway(
      smtp({ status: "configured", user: "mailer", password: undefined }),
      factory,
    )
    await expect(gateway.status()).resolves.toBe("unavailable")
    expect(factory).not.toHaveBeenCalled()
  })

  it("recovers dynamically when SMTP verification becomes healthy", async () => {
    const transport = {
      verify: vi
        .fn<() => Promise<boolean>>()
        .mockRejectedValueOnce(new Error("temporarily unavailable"))
        .mockResolvedValueOnce(true),
      sendMail: vi.fn(async () => undefined),
    }
    const gateway = new NodemailerPasswordMailGateway(
      smtp(),
      vi.fn(() => transport),
    )
    await expect(gateway.status()).resolves.toBe("unavailable")
    await expect(gateway.status()).resolves.toBe("available")
  })

  it("sends only the already-localized message through a timeout-bounded transport", async () => {
    const transport = {
      verify: vi.fn(async () => true),
      sendMail: vi.fn(async () => undefined),
    }
    const factory = vi.fn(() => transport)
    const gateway = new NodemailerPasswordMailGateway(smtp(), factory)
    await gateway.sendPasswordReset({
      deliveryId: "00000000-0000-4000-8000-000000000001",
      tokenHash: "a".repeat(64),
      to: "person@example.com",
      locale: "en-US",
      subject: "Set or reset your LinkSense password",
      text: "Open the one-time link.",
      html: "<p>Open the one-time link.</p>",
    })
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionTimeout: 5_000,
        greetingTimeout: 5_000,
        socketTimeout: 5_000,
      }),
    )
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: "LinkSense <no-reply@example.com>",
      to: "person@example.com",
      subject: "Set or reset your LinkSense password",
      text: "Open the one-time link.",
      html: "<p>Open the one-time link.</p>",
    })
  })
})

function smtp(
  overrides: Partial<AppConfig["smtp"]> = {},
): AppConfig["smtp"] {
  return {
    status: "configured",
    host: "smtp.example.com",
    port: 587,
    user: undefined,
    password: undefined,
    from: "LinkSense <no-reply@example.com>",
    ...overrides,
  }
}
