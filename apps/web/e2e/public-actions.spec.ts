import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page, type Route } from "@playwright/test"
import { supportedLocales } from "@linksense/shared"
import { expectPopupPadding } from "./support/popup-padding"

const PUBLIC_VIEWPORTS = [
  { width: 1440, height: 1024 },
  { width: 320, height: 568 },
]

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`login stays static on entry and return with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await mockPublicApi(page, true)
    await page.emulateMedia({ reducedMotion })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/login", { waitUntil: "domcontentloaded" })

    for (const visit of ["initial", "return"]) {
      const layout = page.locator('[data-slot="account-access-layout"]')
      const heading = page.getByRole("heading", {
        name: "登录 LinkSense",
        exact: true,
      })
      await expect(heading).toBeVisible()
      await expect(heading.locator("span")).toHaveCount(0)
      await expect(page.getByRole("complementary")).toBeVisible()
      expect(
        await layout.evaluate(
          (node) => node.getAnimations({ subtree: true }).length
        )
      ).toBe(0)
      await expect(page.getByRole("textbox", { name: "邮箱" })).toBeEnabled()
      await expect(
        page.getByRole("button", { name: "登录", exact: true })
      ).toBeEnabled()

      if (visit === "initial") {
        await page
          .getByRole("link", { name: "忘记密码或首次设置密码", exact: true })
          .click()
        // Keep the returning page's inputs out of the pointer's hover position.
        await page.mouse.move(0, 0)
        await page
          .getByRole("link", { name: "返回登录页", exact: true })
          .press("Enter")
      }
    }
    await page.getByRole("textbox", { name: "邮箱" }).focus()
    await expect(page.getByRole("textbox", { name: "邮箱" })).toBeFocused()
  })
}

test("brand artwork keeps its source proportions when the panel becomes wider", async ({
  page,
}) => {
  await mockPublicApi(page, true)
  await page.goto("/login")
  const artwork = page.getByRole("complementary").locator('img[alt=""]')
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 2222, height: 1000 },
  ]) {
    await page.setViewportSize(viewport)
    await expect(artwork).toBeVisible()
    await artwork.evaluate((node: HTMLImageElement) => node.decode())
    const undistorted = await artwork.evaluate((node: HTMLImageElement) => {
      const rect = node.getBoundingClientRect()
      const sourceRatio = node.naturalWidth / node.naturalHeight
      const boxRatio = rect.width / rect.height
      return (
        Math.abs(sourceRatio - boxRatio) < 0.01 ||
        ["cover", "contain", "scale-down"].includes(
          getComputedStyle(node).objectFit
        )
      )
    })
    expect(undistorted).toBe(true)
  }
})

for (const theme of ["light", "dark"] as const) {
  for (const viewport of PUBLIC_VIEWPORTS) {
    test(`account access remains usable in ${theme} at ${viewport.width}px`, async ({
      page,
    }) => {
      await mockPublicApi(page, true)
      await page.setViewportSize(viewport)
      await page.emulateMedia({ colorScheme: theme })
      await page.addInitScript(() => {
        window.localStorage.setItem("linksense.language", "fr-FR")
      })

      for (const path of ["/login", "/forgot-password"]) {
        await page.goto(path)
        const layout = page.locator('[data-slot="account-access-layout"]')
        await expect(layout).toBeVisible()
        const form = page.locator("form")
        await expect(form.locator('input[type="email"]')).toBeVisible()
        await form.locator('input[type="email"]').click()
        await expect(form.locator('input[type="email"]')).toHaveCSS(
          "border-color",
          theme === "light" ? "rgb(98, 136, 221)" : "rgb(163, 163, 163)"
        )
        await expect(
          form.getByRole("button", { name: /.+/u }).last()
        ).toBeEnabled()
        const brand = page.getByRole("complementary")
        if (viewport.width >= 1024) await expect(brand).toBeVisible()
        else await expect(brand).toBeHidden()
        expect(
          await layout.evaluate((node) => node.scrollWidth <= node.clientWidth)
        ).toBe(true)
        const accessibility = await new AxeBuilder({ page })
          .include("main")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
        expect(accessibility.violations).toEqual([])
        await form.getByRole("button", { name: /.+/u }).last().click()
        await expect(form.locator('input[type="email"]')).toBeFocused()
        await expect(form.locator('input[type="email"]')).toHaveAttribute(
          "aria-invalid",
          "true"
        )
        const action = form.locator('button[type="submit"]')
        await action.scrollIntoViewIfNeeded()
        await expect(action).toBeInViewport()
      }
    })
  }
}

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

    const passwordInput = page.getByLabel(/^新密码\s*\*?$/u)
    const confirmationInput = page.getByLabel(/^确认新密码\s*\*?$/u)
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

for (const locale of supportedLocales) {
  test(`language popup padding supports ${locale} at the largest UI font size`, async ({
    page,
  }) => {
    await mockPublicApi(page, true)
    await page.addInitScript((language) => {
      localStorage.setItem("linksense.language", language)
      localStorage.setItem("linksense.uiFontSize", "18")
    }, locale)
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/login")
      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      await page.getByRole("combobox").click()
      await expectPopupPadding(page.getByRole("listbox"), '[role="option"]')
      await page.keyboard.press("Escape")
    }
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
    if (path === "/auth/social/providers") return ok(route, ["microsoft"])
    if (path === "/auth/saml/status") return ok(route, { enabled: false })
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
