import { expect, test, type Page, type Route } from "@playwright/test"

const PUBLIC_VIEWPORTS = [
  { width: 1440, height: 1024 },
  { width: 320, height: 568 },
]

for (const viewport of PUBLIC_VIEWPORTS) {
  test(`public account actions remain 44px high at ${viewport.width}px`, async ({
    page,
  }) => {
    await mockPublicApi(page, true)
    await page.setViewportSize(viewport)

    for (const [route, buttonName] of [
      ["/login", "登录"],
      ["/forgot-password", "发送安全链接"],
      ["/reset-password#token=browser-reset-token", "保存新密码"],
    ] as const) {
      await page.goto(route)
      await expect(
        page.getByRole("button", { name: buttonName, exact: true })
      ).toHaveCSS("height", "44px")
    }

    await page.goto("/login")
    await expect(page.getByRole("button", { name: "使用单点登录" })).toHaveCSS(
      "height",
      "44px"
    )
  })

  test(`initialization action remains 44px high at ${viewport.width}px`, async ({
    page,
  }) => {
    await mockPublicApi(page, false)
    await page.setViewportSize(viewport)
    await page.goto("/initialize")

    await expect(
      page.getByRole("button", { name: "创建管理员并完成初始化" })
    ).toHaveCSS("height", "44px")

    const passwordInput = page.getByLabel("新密码", { exact: true })
    const confirmationInput = page.getByLabel("确认新密码", { exact: true })
    await expect(passwordInput).toHaveAttribute("type", "password")
    await expect(confirmationInput).toHaveAttribute("type", "password")
    await expect(page.getByRole("button", { name: "显示新密码" })).toBeVisible()
    await expect(
      page.getByRole("button", { name: "显示确认新密码" })
    ).toBeVisible()

    await page.getByRole("button", { name: "显示新密码" }).click()
    await expect(passwordInput).toHaveAttribute("type", "text")
    await expect(confirmationInput).toHaveAttribute("type", "password")
    await expect(page.getByRole("button", { name: "隐藏新密码" })).toBeVisible()
  })
}

async function mockPublicApi(page: Page, initialized: boolean) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api\/v1/u, "")
    if (path === "/system/bootstrap") {
      return ok(route, {
        initialized,
        system_name: "LinkSense",
        default_language: "zh-CN",
        teams_sso: { status: "not_configured" },
        oidc: { status: "available" },
      })
    }
    if (path === "/auth/refresh") {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error_code: "AUTH_SESSION_EXPIRED",
          message_key: "errors.sessionExpired",
        }),
      })
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

function ok(route: Route, data: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  })
}
