import nodemailer, { type Transporter } from "nodemailer"
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js"
import type { Locale } from "@linksense/shared"

import { sha256 } from "../lib/crypto.js"
import type {
  AuthenticationSettingsReader,
  SmtpRuntimeConfiguration,
} from "../modules/system/authentication-settings.js"
import { renderPasswordResetEmail } from "../lib/password-reset-email.js"

export type MailHealth =
  | { status: "not_configured"; reasonCode: "SMTP_NOT_CONFIGURED" }
  | { status: "unavailable"; reasonCode: string }
  | { status: "available"; reasonCode: null }

export interface Mailer {
  health(force?: boolean): Promise<MailHealth>
  sendPasswordReset(input: {
    to: string
    name: string
    productName: string
    url: string
    locale: Locale
    expiresInMinutes?: number
  }): Promise<void>
  sendRaw(input: {
    to: string
    subject: string
    text: string
    html?: string
  }): Promise<void>
}

type TransportFactory = (options: SMTPTransport.Options) => Transporter

export class SmtpMailer implements Mailer {
  private transport: { key: string; value: Transporter } | null = null
  private cached: {
    key: string
    value: MailHealth
    expiresAt: number
  } | null = null

  constructor(
    private readonly settings: Pick<AuthenticationSettingsReader, "resolveSmtp">,
    private readonly createTransport: TransportFactory = (options) =>
      nodemailer.createTransport(options),
  ) {}

  async health(force = false): Promise<MailHealth> {
    let resolved
    try {
      resolved = await this.settings.resolveSmtp()
    } catch {
      return { status: "unavailable", reasonCode: "SMTP_CONFIGURATION_UNAVAILABLE" }
    }
    if (resolved.status === "not_configured") {
      return { status: "not_configured", reasonCode: "SMTP_NOT_CONFIGURED" }
    }
    if (resolved.status !== "configured" || !resolved.configuration) {
      return { status: "unavailable", reasonCode: "SMTP_CONFIGURATION_INVALID" }
    }
    return this.verify(resolved.configuration, force)
  }

  private async verify(
    configuration: SmtpRuntimeConfiguration,
    force: boolean,
  ): Promise<MailHealth> {
    const key = configurationKey(configuration)
    if (
      !force &&
      this.cached?.key === key &&
      this.cached.expiresAt > Date.now()
    ) {
      return this.cached.value
    }
    let value: MailHealth
    try {
      await this.transporter(configuration).verify()
      value = { status: "available", reasonCode: null }
    } catch {
      value = { status: "unavailable", reasonCode: "SMTP_CONNECTION_FAILED" }
    }
    this.cached = { key, value, expiresAt: Date.now() + 30_000 }
    return value
  }

  async sendPasswordReset(input: {
    to: string
    name: string
    productName: string
    url: string
    locale: Locale
    expiresInMinutes?: number
  }): Promise<void> {
    const content = renderPasswordResetEmail({
      locale: input.locale,
      productName: input.productName,
      resetUrl: input.url,
      recipientName: input.name,
      expiresInMinutes: input.expiresInMinutes ?? 30,
    })
    await this.sendRaw({
      to: input.to,
      ...content,
    })
  }

  async sendRaw(input: {
    to: string
    subject: string
    text: string
    html?: string
  }): Promise<void> {
    let resolved
    try {
      resolved = await this.settings.resolveSmtp()
    } catch {
      throw new Error("SMTP_UNAVAILABLE")
    }
    if (resolved.status !== "configured" || !resolved.configuration) {
      throw new Error("SMTP_UNAVAILABLE")
    }
    const health = await this.verify(resolved.configuration, false)
    if (health.status !== "available") throw new Error("SMTP_UNAVAILABLE")
    await this.transporter(resolved.configuration).sendMail({
      from: resolved.configuration.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    })
  }

  private transporter(configuration: SmtpRuntimeConfiguration): Transporter {
    const key = configurationKey(configuration)
    if (this.transport?.key === key) return this.transport.value
    const value = this.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.security === "tls",
      requireTLS: configuration.security === "starttls",
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
      ...(configuration.username && configuration.password
        ? {
            auth: {
              user: configuration.username,
              pass: configuration.password,
            },
          }
        : {}),
    })
    this.transport = { key, value }
    return value
  }
}

function configurationKey(configuration: SmtpRuntimeConfiguration): string {
  return sha256(JSON.stringify(configuration))
}
