import {
  resolveOrganizationDisplayName,
  type Locale,
} from "@linksense/shared"

import { backendI18n } from "./i18n.js"

export type PasswordResetEmail = {
  subject: string
  text: string
  html: string
}

export type PasswordResetEmailInput = {
  locale: Locale
  productName: string
  resetUrl: string
  expiresInMinutes: number
  recipientName?: string
}

export type RegistrationEmailInput = {
  locale: Locale
  productName: string
  activationUrl: string
  expiresInMinutes: number
}

export function renderPasswordResetEmail(
  input: PasswordResetEmailInput,
): PasswordResetEmail {
  return renderAuthenticationActionEmail({
    locale: input.locale,
    productName: input.productName,
    actionUrl: input.resetUrl,
    expiresInMinutes: input.expiresInMinutes,
    ...(input.recipientName ? { recipientName: input.recipientName } : {}),
    translationPrefix: "mail.passwordReset",
  })
}

export function renderRegistrationEmail(
  input: RegistrationEmailInput,
): PasswordResetEmail {
  return renderAuthenticationActionEmail({
    locale: input.locale,
    productName: input.productName,
    actionUrl: input.activationUrl,
    expiresInMinutes: input.expiresInMinutes,
    translationPrefix: "mail.registration",
  })
}

function renderAuthenticationActionEmail(input: {
  locale: Locale
  productName: string
  actionUrl: string
  expiresInMinutes: number
  recipientName?: string
  translationPrefix: "mail.passwordReset" | "mail.registration"
}): PasswordResetEmail {
  if (
    !Number.isInteger(input.expiresInMinutes) ||
    input.expiresInMinutes <= 0
  ) {
    throw new Error("Authentication email expiry must be a positive integer")
  }

  const productName = resolveOrganizationDisplayName(input.productName)
  const translate = (
    key: string,
    params?: Record<string, string | number>,
  ): string =>
    backendI18n.t(`${input.translationPrefix}.${key}`, {
      lng: input.locale,
      productName,
      ...params,
    })
  const recipientName = input.recipientName?.trim()
  const greeting = recipientName
    ? translate("greetingNamed", { name: recipientName })
    : translate("greeting")
  const subject = translate("subject")
  const preheader = translate("preheader")
  const eyebrow = translate("eyebrow")
  const title = translate("title")
  const intro = translate("intro")
  const action = translate("action")
  const expiry = translate("expiry", {
    minutes: input.expiresInMinutes,
  })
  const fallback = translate("fallback")
  const securityTitle = translate("securityTitle")
  const securityBody = translate("securityBody")
  const automated = translate("automated")
  const htmlActionUrl = escapeHtml(input.actionUrl)

  const text = [
    title,
    "",
    greeting,
    "",
    intro,
    "",
    action,
    input.actionUrl,
    "",
    expiry,
    "",
    `${securityTitle} ${securityBody}`,
    "",
    automated,
  ].join("\n")

  const html = `<!doctype html>
<html lang="${input.locale}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#ffffff;color:#171717;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#ffffff;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:0 24px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">
            <tr>
              <td style="padding:36px 0 20px;border-bottom:1px solid #171717;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
                <div style="color:#171717;font-size:22px;font-weight:700;line-height:1.2;letter-spacing:-0.3px;">${escapeHtml(productName)}</div>
                <div style="margin-top:6px;color:#737373;font-size:12px;font-weight:600;line-height:1.4;letter-spacing:0.8px;">${escapeHtml(eyebrow)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:52px 0 48px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;">
                <h1 style="margin:0 0 28px;color:#171717;font-size:34px;font-weight:700;line-height:1.25;letter-spacing:-0.8px;">${escapeHtml(title)}</h1>
                <p style="margin:0 0 14px;color:#171717;font-size:16px;line-height:1.75;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 32px;color:#404040;font-size:16px;line-height:1.8;">${escapeHtml(intro)}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;">
                  <tr>
                    <td align="center" bgcolor="#171717">
                      <a href="${htmlActionUrl}" target="_blank" style="display:inline-block;padding:15px 24px;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;font-size:16px;font-weight:700;line-height:22px;text-decoration:none;">${escapeHtml(action)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;padding-top:18px;border-top:1px solid #d4d4d4;color:#525252;font-size:14px;line-height:1.7;">${escapeHtml(expiry)}</p>
                <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e5e5;">
                  <p style="margin:0 0 8px;color:#525252;font-size:13px;line-height:1.65;">${escapeHtml(fallback)}</p>
                  <p style="margin:0;color:#171717;font-size:12px;line-height:1.7;word-break:break-all;">
                    <a href="${htmlActionUrl}" target="_blank" style="color:#171717;text-decoration:underline;">${htmlActionUrl}</a>
                  </p>
                </div>
                <div style="margin-top:30px;">
                  <p style="margin:0 0 6px;color:#171717;font-size:14px;font-weight:700;line-height:1.5;">${escapeHtml(securityTitle)}</p>
                  <p style="margin:0;color:#525252;font-size:13px;line-height:1.7;">${escapeHtml(securityBody)}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 0 36px;border-top:1px solid #171717;text-align:left;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Arial,sans-serif;color:#737373;font-size:12px;line-height:1.65;">${escapeHtml(automated)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}

function escapeHtml(input: string): string {
  return input.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  )
}
