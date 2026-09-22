import AxeBuilder from "@axe-core/playwright"
import type { AuthenticationSettings } from "@linksense/shared"
import { expect, test, type Page, type Route } from "@playwright/test"

import {
  createE2EAuthSession,
  E2E_ADMIN as ADMIN,
} from "./support/auth-fixture"

const initialAuthenticationSettings = {
  smtp: {
    mode: "inherit",
    status: "not_configured",
    source: "none",
    revision: 0,
    host: null,
    port: null,
    security: null,
    username: null,
    from: null,
    password_configured: false,
  },
  oidc: {
    mode: "managed",
    status: "configured",
    source: "system",
    revision: 2,
    issuer_url: "https://identity.example.com",
    client_id: "linksense-web",
    redirect_uri: "http://127.0.0.1:4173/api/v1/auth/oidc/callback",
    client_secret_configured: true,
  },
  teams: {
    mode: "inherit",
    status: "configured",
    source: "environment",
    revision: 0,
    tenant_id: "00000000-0000-4000-8000-000000000111",
    client_id: "00000000-0000-4000-8000-000000000222",
  },
} satisfies AuthenticationSettings

for (const viewport of [
  { width: 1440, height: 1024 },
  { width: 320, height: 568 },
]) {
  test(`authentication settings remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const requests: Array<Record<string, unknown>> = []
    await mockApi(page, requests)
    await page.setViewportSize(viewport)
    await page.goto("/admin/settings")

    await expect(
      page.getByRole("heading", { level: 1, name: "管理", exact: true })
    ).toBeVisible()
    await expect(
      page.getByRole("tablist", { name: "系统设置分类" })
    ).toBeVisible()
    await page.getByRole("tab", { name: "认证邮件" }).click()
    await expect(
      page.getByRole("heading", { name: "认证邮件功能", exact: true })
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const smtpSection = page.locator('[data-slot="settings-card"]').filter({
      has: page.getByRole("heading", { name: "认证邮件功能", exact: true }),
    })
    await smtpSection.getByRole("combobox", { name: "配置来源" }).click()
    await page.getByRole("option", { name: "由系统设置管理" }).click()
    await smtpSection.getByLabel("SMTP 主机").fill("smtp.example.com")
    await smtpSection
      .getByLabel("发件人")
      .fill("LinkSense <no-reply@example.com>")
    await smtpSection.getByLabel("用户名").fill("mailer@example.com")
    await smtpSection.locator("#smtp-password").fill("browser-smtp-secret")
    await smtpSection.getByRole("button", { name: "保存" }).click()

    await expect(page.getByText("认证配置已更新并立即生效")).toBeVisible()
    await expect(smtpSection.locator("#smtp-password")).toHaveValue("")
    expect(requests).toContainEqual({
      mode: "managed",
      expected_revision: 0,
      host: "smtp.example.com",
      port: 587,
      security: "starttls",
      username: "mailer@example.com",
      password: "browser-smtp-secret",
      from: "LinkSense <no-reply@example.com>",
    })

    await page.getByRole("tab", { name: "登录方式" }).click()
    const oidcSection = page.locator('[data-slot="settings-card"]').filter({
      has: page.getByRole("heading", {
        name: "企业统一登录（OIDC）",
        exact: true,
      }),
    })
    await expect(oidcSection.locator("#oidc-client-secret")).toHaveValue("")
    await expect(oidcSection.locator("#oidc-client-secret")).toHaveAttribute(
      "placeholder",
      "••••••••••••"
    )
    await oidcSection.getByRole("combobox", { name: "配置来源" }).click()
    await page.getByRole("option", { name: "禁用此功能" }).click()
    await oidcSection.getByRole("button", { name: "保存" }).click()
    const confirmation = page.getByRole("dialog")
    await expect(confirmation).toContainText("确认更改配置来源？")
    await confirmation.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished.catch(() => undefined))
      )
    })
    const dialogAccessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .analyze()
    expect(
      dialogAccessibility.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious"
      )
    ).toEqual([])
    await confirmation.getByRole("button", { name: "取消" }).click()
    await expect(confirmation).toHaveCount(0)

    await expect(
      page.getByRole("heading", { name: "Teams 内登录", exact: true })
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const accessibility = await new AxeBuilder({ page }).analyze()
    expect(
      accessibility.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious"
      )
    ).toEqual([])
  })
}

async function mockApi(
  page: Page,
  requests: Array<Record<string, unknown>>
): Promise<void> {
  let authenticationSettings: AuthenticationSettings = structuredClone(
    initialAuthenticationSettings
  )
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      /^\/api\/v1/u,
      ""
    )
    if (path === "/system/bootstrap") {
      return ok(route, {
        initialized: true,
        system_name: "LinkSense",
        default_language: "zh-CN",
      })
    }
    if (path === "/auth/refresh") {
      return ok(route, createE2EAuthSession())
    }
    if (path === "/me") return ok(route, ADMIN)
    if (path === "/admin/product-settings") {
      return ok(route, {
        organization_display_name: "LinkSense",
        default_locale: "zh-CN",
        logo_url: null,
        logo_updated_at: null,
      })
    }
    if (path === "/admin/registration-settings") {
      return ok(route, { enabled: false })
    }
    if (path === "/admin/execution-concurrency-settings") {
      return ok(route, {
        max_concurrent_conversations: null,
        runner_app_server_process_limit: null,
        environment_defaults: {
          max_concurrent_conversations: 20,
          runner_app_server_process_limit: 20,
        },
        effective: {
          max_concurrent_conversations: 20,
          runner_app_server_process_limit: 20,
        },
      })
    }
    if (
      path === "/admin/authentication-settings/smtp" &&
      route.request().method() === "PUT"
    ) {
      const body = route.request().postDataJSON() as Record<string, unknown>
      requests.push(body)
      authenticationSettings = {
        ...authenticationSettings,
        smtp: {
          mode: "managed",
          status: "configured",
          source: "system",
          revision: 1,
          host: String(body.host),
          port: Number(body.port),
          security: body.security === "tls" ? "tls" : "starttls",
          username: typeof body.username === "string" ? body.username : null,
          from: String(body.from),
          password_configured: true,
        },
      }
      return ok(route, {
        code: "AUTHENTICATION_SETTINGS_UPDATED",
        settings: authenticationSettings,
      })
    }
    if (path === "/admin/authentication-settings") {
      return ok(route, authenticationSettings)
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error_code: "NOT_FOUND",
        message_key: "errors.notFound",
      }),
    })
  })
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(widths.body).toBeLessThanOrEqual(widths.viewport)
  expect(widths.document).toBeLessThanOrEqual(widths.viewport)
}

function ok(route: Route, data: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  })
}
