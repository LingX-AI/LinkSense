import { describe, expect, it } from "vitest"

import {
  renderPasswordResetEmail,
  renderRegistrationEmail,
} from "../src/lib/password-reset-email.js"

describe("renderPasswordResetEmail", () => {
  it("renders a monochrome Chinese email without decorative cards", () => {
    const email = renderPasswordResetEmail({
      locale: "zh-CN",
      productName: "MOSS & Co",
      resetUrl:
        "https://linksense.example/reset-password#token=opaque-token&mode=reset",
      expiresInMinutes: 30,
      recipientName: '林<script>alert("x")</script>',
    })

    expect(email.subject).toBe("设置或重置 MOSS & Co 密码")
    expect(email.text).toContain("此安全链接将在 30 分钟后失效")
    expect(email.text).toContain(
      "https://linksense.example/reset-password#token=opaque-token&mode=reset",
    )
    expect(email.html).toContain('<html lang="zh-CN">')
    expect(email.html).toContain(">MOSS &amp; Co</div>")
    expect(email.html).toContain(">设置或重置密码</a>")
    expect(email.html).toContain("此安全链接将在 30 分钟后失效")
    expect(email.html).toContain(
      "https://linksense.example/reset-password#token=opaque-token&amp;mode=reset",
    )
    expect(email.html).toContain(
      "林&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;，您好",
    )
    expect(email.html).toContain('bgcolor="#171717"')
    expect(email.html).toContain("border-bottom:1px solid #171717")
    expect(email.html).not.toContain("border-radius")
    expect(email.html).not.toContain("box-shadow")
    expect(email.html).not.toContain("#f3f7f9")
    expect(email.html).not.toContain("#183f52")
    expect(email.html).not.toContain(">LS</td>")
    expect(email.html).not.toContain("<script>")
    expect(email.html).not.toMatch(/<(?:img|link)\b/iu)
  })

  it("renders the same hierarchy and expiry details in English", () => {
    const email = renderPasswordResetEmail({
      locale: "en-US",
      productName: "MOSS",
      resetUrl: "https://linksense.example/reset-password#token=opaque-token",
      expiresInMinutes: 45,
      recipientName: "Taylor",
    })

    expect(email.subject).toBe("Set or reset your MOSS password")
    expect(email.text).toContain("Hello Taylor,")
    expect(email.text).toContain("This secure link expires in 45 minutes")
    expect(email.html).toContain('<html lang="en-US">')
    expect(email.html).toContain(">Set or reset password</a>")
    expect(email.html).toContain("Didn&#39;t request this?")
  })

  it("rejects an invalid expiry instead of sending misleading security copy", () => {
    expect(() =>
      renderPasswordResetEmail({
        locale: "zh-CN",
        productName: "LinkSense",
        resetUrl: "https://linksense.example/reset-password#token=opaque-token",
        expiresInMinutes: 0,
      }),
    ).toThrow("Authentication email expiry must be a positive integer")
  })
})

describe("renderRegistrationEmail", () => {
  it("renders a localized one-time activation link without leaking executable markup", () => {
    const email = renderRegistrationEmail({
      locale: "zh-CN",
      productName: "MOSS & Co",
      activationUrl:
        "https://linksense.example/register/activate#token=opaque-token&mode=activate",
      expiresInMinutes: 30,
    })

    expect(email.subject).toBe("激活您的 MOSS & Co 账号")
    expect(email.text).toContain("设置登录密码并激活账号")
    expect(email.text).toContain("此激活链接将在 30 分钟后失效")
    expect(email.html).toContain(">设置密码并激活账号</a>")
    expect(email.html).toContain(
      "https://linksense.example/register/activate#token=opaque-token&amp;mode=activate",
    )
    expect(email.html).not.toMatch(/<(?:img|link|script)\b/iu)
  })

  it("renders the account activation message in English", () => {
    const email = renderRegistrationEmail({
      locale: "en-US",
      productName: "LinkSense",
      activationUrl:
        "https://linksense.example/register/activate#token=opaque-token",
      expiresInMinutes: 45,
    })

    expect(email.subject).toBe("Activate your LinkSense account")
    expect(email.text).toContain("set your sign-in password")
    expect(email.html).toContain(">Set password and activate account</a>")
    expect(email.html).toContain("This activation link expires in 45 minutes")
  })
})
