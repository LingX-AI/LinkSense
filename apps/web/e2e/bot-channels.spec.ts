import { expect, test } from "@playwright/test"
import {
  botChannelCreateSchema,
  type BotChannelConnection,
} from "@linksense/shared"
import { createE2EAuthSession, E2E_ADMIN } from "./support/auth-fixture"

for (const width of [1440, 320]) {
  test(`enterprise channel setup and disconnect remain usable at ${width}px`, async ({
    page,
  }) => {
    const items: BotChannelConnection[] = []
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        /^\/api\/v1/u,
        ""
      )
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
      if (path === "/bot-channels" && route.request().method() === "POST") {
        const input = botChannelCreateSchema.parse(
          route.request().postDataJSON()
        )
        const row: BotChannelConnection = {
          id: crypto.randomUUID(),
          provider: input.provider,
          account_hint:
            input.provider === "wecom" ? input.bot_id : input.client_id,
          allowed_sender_id: input.allowed_sender_id,
          allow_group_messages: input.allow_group_messages,
          runtime_status:
            input.provider === "teams" ? "waiting_message" : "connecting",
          last_connected_at: null,
          last_inbound_at: null,
          last_error_code: null,
          callback_url:
            input.provider === "teams"
              ? "https://example.test/api/v1/bot-channels/teams/test/messages"
              : null,
          created_at: "2026-09-06T00:00:00Z",
        }
        items.push(row)
        return ok(row, 201)
      }
      if (path === "/bot-channels") return ok({ items })
      if (
        path.startsWith("/bot-channels/") &&
        route.request().method() === "DELETE"
      ) {
        items.splice(
          items.findIndex((item) => path.endsWith(item.id)),
          1
        )
        return route.fulfill({ status: 204 })
      }
      return route.fulfill({
        status: 404,
        json: { success: false, error_code: "NOT_FOUND" },
      })
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/settings/weixin")
    for (const name of ["企业微信", "钉钉", "Microsoft Teams"]) {
      const teams = name === "Microsoft Teams"
      const card = page.locator("article").filter({
        has: page.getByRole("heading", { name, exact: true }),
      })
      await card.getByRole("button", { name: "连接", exact: true }).click()
      const dialog = page.getByRole("dialog")
      await dialog
        .getByLabel(name === "企业微信" ? "机器人 ID" : "应用 Client ID")
        .fill(teams ? "11111111-1111-4111-8111-111111111111" : "test-app")
      await dialog.getByLabel("应用密钥").fill("test-secret")
      if (teams)
        await dialog
          .getByLabel("租户 ID")
          .fill("22222222-2222-4222-8222-222222222222")
      await dialog
        .getByLabel("允许使用的成员 ID")
        .fill(teams ? "33333333-3333-4333-8333-333333333333" : "member")
      await expect(
        dialog.getByRole("button", { name: "保存配置" })
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)
      const bounds = await dialog.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await dialog.getByRole("button", { name: "保存配置" }).click()
      await expect(dialog).not.toBeVisible()
      await page
        .getByRole("button", { name: `断开${name}`, exact: true })
        .click()
      await dialog.getByRole("button", { name: "确认断开" }).click()
      await expect(dialog).not.toBeVisible()
      await expect(
        card.getByRole("button", { name: "连接", exact: true })
      ).toBeEnabled()
    }
    expect(items).toHaveLength(0)
  })
}
