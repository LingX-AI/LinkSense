import nodemailer from "nodemailer"
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js"

import type { AppConfig } from "../../config.js"
import type {
  PasswordMailGateway,
  PasswordResetMail,
  RegistrationMail,
} from "./types.js"

type MailTransport = {
  verify(): Promise<boolean>
  sendMail(message: {
    from: string
    to: string
    subject: string
    text: string
    html: string
  }): Promise<unknown>
}

type TransportFactory = (options: SMTPTransport.Options) => MailTransport

export class NodemailerPasswordMailGateway implements PasswordMailGateway {
  private transport: MailTransport | null = null

  constructor(
    private readonly smtp: AppConfig["smtp"],
    private readonly createTransport: TransportFactory = (options) =>
      nodemailer.createTransport(options),
  ) {}

  async status(): Promise<"available" | "not_configured" | "unavailable"> {
    if (this.smtp.status === "not_configured") return "not_configured"
    if (!this.configuration()) return "unavailable"
    try {
      return (await this.getTransport().verify()) ? "available" : "unavailable"
    } catch {
      return "unavailable"
    }
  }

  async sendPasswordReset(mail: PasswordResetMail): Promise<void> {
    await this.send(mail)
  }

  async sendRegistration(mail: RegistrationMail): Promise<void> {
    await this.send(mail)
  }

  private async send(mail: PasswordResetMail | RegistrationMail): Promise<void> {
    if ((await this.status()) !== "available" || !this.smtp.from) {
      throw new Error("SMTP unavailable")
    }
    await this.getTransport().sendMail({
      from: this.smtp.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
  }

  private getTransport(): MailTransport {
    const configuration = this.configuration()
    if (!configuration) throw new Error("SMTP unavailable")
    this.transport ??= this.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.port === 465,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
      ...(configuration.user && configuration.password
        ? { auth: { user: configuration.user, pass: configuration.password } }
        : {}),
    })
    return this.transport
  }

  private configuration(): {
    host: string
    port: number
    from: string
    user?: string
    password?: string
  } | null {
    const authenticationComplete =
      (this.smtp.user === undefined && this.smtp.password === undefined) ||
      (this.smtp.user !== undefined && this.smtp.password !== undefined)
    if (
      this.smtp.status !== "configured" ||
      !this.smtp.host ||
      !this.smtp.port ||
      !this.smtp.from ||
      !authenticationComplete
    ) {
      return null
    }
    return {
      host: this.smtp.host,
      port: this.smtp.port,
      from: this.smtp.from,
      ...(this.smtp.user ? { user: this.smtp.user } : {}),
      ...(this.smtp.password ? { password: this.smtp.password } : {}),
    }
  }
}
