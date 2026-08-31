import type { Transporter } from "nodemailer"
import { describe, expect, it, vi } from "vitest"

import { SmtpMailer } from "../src/adapters/mailer.js"
import type { ResolvedAuthenticationSettings } from "../src/modules/system/authentication-settings.js"

describe("SmtpMailer", () => {
  it("rebuilds the transport when managed settings change without a restart", async () => {
    let smtp = configuredSmtp("smtp-one.example", "secret-one", 1)
    const firstTransport = transport()
    const secondTransport = transport()
    const createTransport = vi
      .fn()
      .mockReturnValueOnce(firstTransport as unknown as Transporter)
      .mockReturnValueOnce(secondTransport as unknown as Transporter)
    const mailer = new SmtpMailer(
      { resolveSmtp: vi.fn(async () => smtp) },
      createTransport,
    )

    await expect(mailer.health()).resolves.toMatchObject({ status: "available" })
    expect(createTransport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        host: "smtp-one.example",
        secure: false,
        requireTLS: true,
      }),
    )

    smtp = configuredSmtp("smtp-two.example", "secret-two", 2)
    await mailer.sendRaw({
      to: "member@example.com",
      subject: "Password reset",
      text: "Open the one-time link.",
      html: "<p>Open the one-time link.</p>",
    })

    expect(createTransport).toHaveBeenCalledTimes(2)
    expect(createTransport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        host: "smtp-two.example",
        auth: { user: "mailer", pass: "secret-two" },
      }),
    )
    expect(secondTransport.sendMail).toHaveBeenCalledWith({
      from: "LinkSense <no-reply@example.com>",
      to: "member@example.com",
      subject: "Password reset",
      text: "Open the one-time link.",
      html: "<p>Open the one-time link.</p>",
    })
  })

  it("treats resolver failures as unavailable and disabled settings as optional", async () => {
    const unavailable = new SmtpMailer({
      resolveSmtp: vi.fn(async () => {
        throw new Error("database unavailable")
      }),
    })
    await expect(unavailable.health()).resolves.toEqual({
      status: "unavailable",
      reasonCode: "SMTP_CONFIGURATION_UNAVAILABLE",
    })

    const disabled = new SmtpMailer({
      resolveSmtp: vi.fn(async () => ({
        mode: "disabled" as const,
        status: "not_configured" as const,
        source: "none" as const,
        revision: 1,
      })),
    })
    await expect(disabled.health()).resolves.toEqual({
      status: "not_configured",
      reasonCode: "SMTP_NOT_CONFIGURED",
    })
  })
})

function configuredSmtp(
  host: string,
  password: string,
  revision: number,
): ResolvedAuthenticationSettings["smtp"] {
  return {
    mode: "managed",
    status: "configured",
    source: "system",
    revision,
    configuration: {
      host,
      port: 587,
      security: "starttls",
      username: "mailer",
      password,
      from: "LinkSense <no-reply@example.com>",
    },
  }
}

function transport() {
  return {
    verify: vi.fn(async () => true),
    sendMail: vi.fn(async () => undefined),
  }
}
