import { expect, test, type Page } from "@playwright/test"
import {
  botChannelAdminCreateSchema,
  botChannelConnectionSchema,
  type BotChannelAdminConnection,
  type BotChannelConnection,
} from "@linksense/shared"
import { createE2EAuthSession, E2E_ADMIN } from "./support/auth-fixture"
const ID = "10000000-0000-4000-8000-000000000009"
for (const width of [1440, 320]) {
  test(`personal QR and organization setup at ${width}px`, async ({ page }) => {
    const controls = await mockApi(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/settings/weixin")
    const wecom = page.locator("article").filter({
      has: page.getByRole("heading", { name: "企业微信", exact: true }),
    })
    await expect(
      wecom.getByRole("button", { name: "关联我的账号" })
    ).toBeDisabled()
    await page.getByRole("button", { name: "扫码连接" }).click()
    await expect(
      page.getByRole("img", { name: "钉钉连接二维码" })
    ).toBeVisible()
    await expect(page.getByLabel("应用密钥")).toHaveCount(0)
    await noOverflow(page, width)
    controls.authorize()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关联我的账号", exact: true })
      .click()
    await page.getByRole("button", { name: "获取确认消息" }).click()
    await expect(page.getByLabel("确认消息")).toHaveValue(
      `LINK ${"AB".repeat(12)}`
    )
    await noOverflow(page, width)
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click()
    await page.goto("/admin/settings?section=channels")
    await expect(
      page.getByRole("heading", { name: "组织消息渠道", exact: true })
    ).toBeVisible()
    for (const name of ["企业微信", "Microsoft Teams"]) {
      await page
        .getByRole("button", { name: `连接${name}`, exact: true })
        .click()
      const dialog = page.getByRole("dialog")
      await dialog
        .getByLabel(name === "企业微信" ? "机器人 ID" : "应用 Client ID")
        .fill(
          name === "企业微信"
            ? "test-bot"
            : "11111111-1111-4111-8111-111111111111"
        )
      await dialog.getByLabel("应用密钥").fill("test-secret")
      if (name === "Microsoft Teams")
        await dialog
          .getByLabel("租户 ID")
          .fill("22222222-2222-4222-8222-222222222222")
      await expect(dialog.getByLabel(/成员 ID/u)).toHaveCount(0)
      await noOverflow(page, width)
      await dialog.getByRole("button", { name: "保存配置" }).click()
      await expect(dialog).not.toBeVisible()
    }
    const teams = page.locator('[data-slot="settings-card"]').filter({
      has: page.getByRole("heading", {
        name: "Microsoft Teams",
        exact: true,
      }),
    })
    await expect(teams.getByLabel("消息接收地址")).toHaveValue(/https:\/\//u)
    await teams.getByRole("button", { name: "暂停", exact: true }).click()
    await expect(
      teams.getByRole("button", { name: "启用", exact: true })
    ).toBeVisible()
    await teams.getByRole("button", { name: "启用", exact: true }).click()
    await expect(
      teams.getByRole("button", { name: "暂停", exact: true })
    ).toBeVisible()
    await teams
      .getByRole("button", { name: "断开Microsoft Teams", exact: true })
      .click()
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认断开" })
      .click()
    await expect(
      teams.getByRole("button", { name: "连接Microsoft Teams", exact: true })
    ).toBeVisible()
    await noOverflow(page, width)
  })
}
async function noOverflow(page: Page, width: number) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true)
  const dialog = page.getByRole("dialog")
  if (await dialog.count()) {
    const rect = await dialog.boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.x).toBeGreaterThanOrEqual(0)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(width)
  }
}
async function mockApi(page: Page) {
  const organization: BotChannelAdminConnection[] = []
  let personal: BotChannelConnection | null = null
  let authorized = false
  const row = (
    provider: BotChannelConnection["provider"],
    id = crypto.randomUUID()
  ): BotChannelConnection => ({
    id,
    provider,
    scope: provider === "dingtalk" ? "personal" : "organization",
    identity_linked: false,
    allow_group_messages: true,
    runtime_status: "online",
    last_connected_at: null,
    last_inbound_at: null,
    last_error_code: null,
    created_at: "2026-10-29T00:00:00.000Z",
  })
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
        /^\/api\/v1/u,
        ""
      ),
      method = route.request().method()
    const ok = (data: unknown, status = 200) =>
      route.fulfill({ status, json: { success: true, data } })
    if (path === "/system/bootstrap")
      return ok({
        initialized: true,
        system_name: "LinkSense",
        default_language: "zh-CN",
      })
    if (path === "/auth/refresh") return ok(createE2EAuthSession())
    if (path === "/me") return ok(E2E_ADMIN)
    if (["/weixin", "/feishu"].includes(path)) return ok({ items: [] })
    if (
      path === "/bot-channels/dingtalk/registration-sessions" ||
      path.endsWith(`/registration-sessions/${ID}`)
    ) {
      if (authorized) personal = row("dingtalk", ID)
      return ok(
        {
          id: ID,
          status: authorized ? "connected" : "waiting_scan",
          qr_code_url: authorized
            ? null
            : "https://open-dev.dingtalk.com/qr?code=test",
          expires_at: "2026-10-29T01:00:00.000Z",
          connection_id: authorized ? ID : null,
        },
        method === "POST" ? 201 : 200
      )
    }
    if (path.endsWith("/linking-sessions"))
      return ok(
        {
          command: `LINK ${"AB".repeat(12)}`,
          expires_at: "2026-10-29T01:00:00.000Z",
        },
        201
      )
    if (path === "/bot-channels/organization") {
      if (method === "POST") {
        const input = botChannelAdminCreateSchema.parse(
          route.request().postDataJSON()
        )
        const value = {
          ...row(input.provider),
          account_hint:
            input.provider === "wecom" ? input.bot_id : input.client_id,
          callback_url:
            input.provider === "teams"
              ? "https://example.test/api/v1/bot-channels/teams/test/messages"
              : null,
        }
        organization.push(value)
        return ok(value, 201)
      }
      return ok({ items: organization })
    }
    if (path.startsWith("/bot-channels/organization/")) {
      const index = organization.findIndex((item) => path.endsWith(item.id))
      if (method === "DELETE") organization.splice(index, 1)
      else if (index >= 0)
        organization[index]!.runtime_status = route.request().postDataJSON()
          .enabled
          ? "online"
          : "disabled"
      return route.fulfill({ status: 204 })
    }
    if (path === "/bot-channels")
      return ok({
        items: [
          ...organization.map((item) =>
            botChannelConnectionSchema.strip().parse(item)
          ),
          ...(personal ? [personal] : []),
        ],
      })
    if (path === "/admin/product-settings")
      return ok({
        organization_display_name: "LinkSense",
        default_locale: "zh-CN",
        logo_url: null,
        logo_updated_at: null,
      })
    if (path === "/admin/registration-settings") return ok({ enabled: false })
    if (path === "/admin/execution-concurrency-settings")
      return ok({
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
    if (path === "/admin/authentication-settings")
      return ok({
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
          issuer_url: "https://identity.example.test",
          client_id: "linksense",
          redirect_uri: "http://127.0.0.1:4173/api/v1/auth/oidc/callback",
          client_secret_configured: true,
        },
        teams: {
          mode: "inherit",
          status: "configured",
          source: "environment",
          revision: 0,
          tenant_id: "22222222-2222-4222-8222-222222222222",
          client_id: "11111111-1111-4111-8111-111111111111",
        },
      })
    return route.fulfill({
      status: 404,
      json: { success: false, error_code: "NOT_FOUND" },
    })
  })
  return {
    authorize: () => {
      authorized = true
    },
  }
}
