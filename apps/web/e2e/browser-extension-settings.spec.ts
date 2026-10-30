import AxeBuilder from "@axe-core/playwright"
import { chromium, expect, test, type Page } from "@playwright/test"
import { createServer } from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createBrowserExtensionFixture } from "../../api/test/fixtures/local-browser-extension"
import { createE2EAuthSession, E2E_ADMIN } from "./support/auth-fixture"

async function useChromeBrand(page: Page) {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgentData", {
      value: {
        brands: [{ brand: "Chromium" }, { brand: "Google Chrome" }],
        mobile: false,
      },
    })
  )
}

async function mockConversation(
  page: Page,
  conversationId: string,
  intent?: Promise<boolean>
) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "")
    if (path.startsWith("/local-browser")) return route.continue()
    let data: unknown = { items: [], next_cursor: null }
    if (path === "/system/bootstrap")
      data = {
        initialized: true,
        system_name: "LinkSense",
        default_language: "zh-CN",
      }
    else if (path === "/auth/refresh") data = createE2EAuthSession("zh-CN")
    else if (path === "/me") data = E2E_ADMIN
    else if (path.endsWith("/browser-use-intent"))
      data = intent ? await intent : true
    else if (path === "/projects") data = []
    else if (path === `/conversations/${conversationId}/sources`)
      data = { items: [] }
    else if (path === "/me/personalization")
      data = {
        custom_instructions: "",
        memories_enabled: false,
        task_auto_naming: "first_message",
        show_reasoning: false,
      }
    else if (path.endsWith("/model-preference"))
      data = {
        configured: false,
        models: [],
        default_model: null,
        selected_model: null,
        selected_reasoning_effort: null,
      }
    else if (path === `/conversations/${conversationId}`)
      data = {
        conversation: {
          id: conversationId,
          title: "本地浏览器操作",
          archive_status: "active",
          project_id: null,
          execution_status: "completed",
          updated_at: "2026-10-27T00:00:00Z",
        },
        messages: [
          {
            id: "40000000-0000-4000-8000-000000000001",
            role: "user",
            content: "google 搜搜看看 guygubaby",
            created_at: "2026-10-27T00:00:00Z",
          },
        ],
      }
    else if (path.endsWith("/events")) {
      await route.fulfill({
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
      return
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data, request_id: "preview-drag" }),
    })
  })
}

test("browser extension settings explain cloud/local and remain usable on narrow and dark screens", async ({
  page,
}) => {
  await useChromeBrand(page)
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname
    let data: unknown = { items: [], next_cursor: null }
    if (pathname.endsWith("/system/bootstrap"))
      data = {
        initialized: true,
        system_name: "LinkSense",
        default_language: "zh-CN",
      }
    else if (pathname.endsWith("/auth/refresh"))
      data = createE2EAuthSession("zh-CN")
    else if (pathname.endsWith("/me"))
      data = { ...E2E_ADMIN, preferred_locale: "zh-CN", language: "zh-CN" }
    else if (pathname.endsWith("/local-browser")) data = { connected: false }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data,
        request_id: "local-browser-visual",
      }),
    })
  })
  await page.goto("/settings/general#browser-extension")
  const section = page.locator("#browser-extension")
  await expect(
    section.getByRole("heading", { name: "Browser Use" })
  ).toBeVisible()
  await expect(section.getByText(/云端浏览器无需安装/u)).toBeVisible()
  await expect(
    section.getByRole("button", { name: "在新标签页打开 chrome://extensions" })
  ).toBeVisible()
  await expect(
    section.getByText("edge://extensions", { exact: true })
  ).toHaveCount(0)
  for (const button of await section
    .getByRole("list")
    .getByRole("button")
    .all()) {
    await expect(button.locator("svg")).toHaveCount(1)
  }
  await expect(
    section.getByRole("button", { name: "连接此浏览器" })
  ).toBeDisabled()
  for (const [width, dark] of [
    [1440, false],
    [390, false],
    [1440, true],
  ] as const) {
    await page.setViewportSize({ width, height: 1050 })
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" })
    await section.scrollIntoViewIfNeeded()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1
    )
    expect(overflow).toBe(false)
    await expect(
      section.getByRole("button", { name: "下载浏览器扩展" })
    ).toBeVisible()
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          `browser-extension-${width}-${dark ? "dark" : "light"}.png`
        ),
      fullPage: true,
    })
  }
  expect(
    (await new AxeBuilder({ page }).include("#browser-extension").analyze())
      .violations
  ).toEqual([])
})

test("Edge settings show only the Edge manager address with icons", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0",
    viewport: { width: 1440, height: 1050 },
    locale: "zh-CN",
  })
  try {
    await context.addInitScript(() =>
      Object.defineProperty(navigator, "userAgentData", {
        value: {
          brands: [{ brand: "Chromium" }, { brand: "Microsoft Edge" }],
          mobile: false,
        },
      })
    )
    const page = await context.newPage()
    await mockConversation(page, "20000000-0000-4000-8000-000000000001")
    await page.route("**/api/v1/local-browser", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { connected: false } }),
      })
    )
    await page.goto("/settings/general#browser-extension")
    const section = page.locator("#browser-extension")
    await expect(
      section.getByRole("button", { name: "在新标签页打开 edge://extensions" })
    ).toBeVisible()
    await expect(
      section.getByText("chrome://extensions", { exact: true })
    ).toHaveCount(0)
    await page.screenshot({
      path: test.info().outputPath("browser-use-edge-settings.png"),
    })
  } finally {
    await context.close()
  }
})

test("a browser request offers Browser Use and links to the focused settings section without blocking chat", async ({
  page,
}) => {
  await useChromeBrand(page)
  const conversationId = "20000000-0000-4000-8000-000000000001"
  let finishIntent!: (value: boolean) => void
  const intent = new Promise<boolean>((resolve) => {
    finishIntent = resolve
  })
  const intentRequests: string[] = []
  page.on("request", (request) => {
    if (request.url().endsWith("/browser-use-intent"))
      intentRequests.push(request.url())
  })
  await mockConversation(page, conversationId, intent)
  await page.route("**/api/v1/local-browser", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { connected: false } }),
    })
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/conversations/${conversationId}`)
  const guide = page.getByRole("dialog", { name: "让助手操作你的本机浏览器" })
  await expect.poll(() => intentRequests.length).toBe(1)
  const composer = page.getByRole("textbox", { name: "任务输入框" })
  await composer.fill("意图判断期间仍可继续输入")
  await expect(composer).toHaveValue("意图判断期间仍可继续输入")
  await expect(guide).toBeHidden()
  finishIntent(true)
  await expect(guide.getByRole("link", { name: "前往安装" })).toBeVisible()
  expect(intentRequests).toHaveLength(1)
  await expect(page.getByRole("textbox", { name: "任务输入框" })).toBeEnabled()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(guide).toBeInViewport({ ratio: 1 })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      )
    ).toBe(false)
    await page.screenshot({
      path: test.info().outputPath(`browser-use-guide-${width}.png`),
    })
  }
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-slot="popover-content"][role="dialog"]')
        .analyze()
    ).violations
  ).toEqual([])
  await page.setViewportSize({ width: 1440, height: 1000 })
  await composer.click()
  await expect(guide).toBeHidden()
  const trigger = page.getByRole("button", { name: "Browser Use", exact: true })
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute("aria-expanded", "false")
  await trigger.click()
  await expect(guide.getByRole("link", { name: "前往安装" })).toBeVisible()
  expect(intentRequests).toHaveLength(1)
  await guide.getByRole("link", { name: "前往安装" }).click()
  await expect(page).toHaveURL(/\/settings\/general#browser-extension$/u)
  const section = page.getByRole("region", { name: "Browser Use", exact: true })
  await expect(section).toBeFocused()
  await expect(
    section.getByRole("heading", { name: "Browser Use", exact: true })
  ).toBeInViewport()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({
    path: test.info().outputPath("browser-use-settings-target.png"),
  })
  await page.getByRole("link", { name: "返回 LinkSense" }).click()
  await expect(page).toHaveURL(`/conversations/${conversationId}`)
  await expect(guide).toBeHidden()
  expect(intentRequests).toHaveLength(1)
})

test("unsupported browsers skip intent detection and guide the user to Chrome or Edge in settings", async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15",
    viewport: { width: 1440, height: 1050 },
    locale: "zh-CN",
  })
  try {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "userAgentData", { value: undefined })
    })
    const page = await context.newPage()
    let intents = 0
    page.on("request", (request) => {
      if (request.url().endsWith("/browser-use-intent")) intents++
    })
    await mockConversation(page, "20000000-0000-4000-8000-000000000001")
    await page.goto("/conversations/20000000-0000-4000-8000-000000000001")
    await expect(
      page.getByRole("textbox", { name: "任务输入框" })
    ).toBeVisible()
    await expect(
      page.getByRole("dialog", { name: "让助手操作你的本机浏览器" })
    ).toBeHidden()
    await page.goto("/settings/general#browser-extension")
    const section = page.locator("#browser-extension")
    await expect(
      section.getByText("目前仅支持桌面版 Chrome / Edge")
    ).toBeVisible()
    await expect(
      section.getByText(/当前浏览器暂不支持 Browser Use/u)
    ).toBeVisible()
    await expect(
      section.getByRole("link", { name: "下载 Chrome" })
    ).toHaveAttribute("href", "https://www.google.com/chrome/")
    await expect(
      section.getByRole("link", { name: "下载 Edge" })
    ).toHaveAttribute("href", "https://www.microsoft.com/edge/download")
    await expect(
      section.getByRole("button", { name: "连接此浏览器" })
    ).toBeDisabled()
    expect(intents).toBe(0)
    await page.screenshot({
      path: test.info().outputPath("browser-use-unsupported-desktop.png"),
    })
    await page.setViewportSize({ width: 390, height: 1000 })
    await section.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: test.info().outputPath("browser-use-unsupported-narrow.png"),
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1
      )
    ).toBe(false)
    expect(
      (await new AxeBuilder({ page }).include("#browser-extension").analyze())
        .violations
    ).toEqual([])
  } finally {
    await context.close()
  }
})

test("local browser snapshots drag to all four corners, stay reachable and activate their exact tab", async ({
  page,
  context,
}, testInfo) => {
  const conversationId = "20000000-0000-4000-8000-000000000001"
  const reference = await context.newPage()
  await reference.setContent(
    '<!doctype html><html><body style="margin:0;background:#f3f5f8;color:#252b49;font:16px system-ui"><header style="background:#fff;padding:24px;border-bottom:1px solid #e5e8f0">Reference workspace</header><main style="padding:36px"><h1>Browser preview</h1><p>Keep the page in sight while the assistant works.</p><section style="display:flex;gap:20px;margin-top:36px"><article style="padding:28px;background:white;border-radius:12px;flex:1">Overview</article><article style="padding:28px;background:white;border-radius:12px;flex:1">Latest activity</article></section></main></body></html>'
  )
  const image = (
    await reference.screenshot({ type: "jpeg", quality: 60 })
  ).toString("base64")
  await reference.close()
  await page.addInitScript(
    ({ image, conversationId }) => {
      let frame = 0
      let previewRequests = 0
      window.addEventListener("message", (event) => {
        const data = event.data
        if (event.source !== window || data?.source !== "linksense-web") return
        if (data.type === "preview" && ++previewRequests === 1) return
        if (data.type === "activate")
          document.documentElement.dataset.previewActivations = String(
            Number(document.documentElement.dataset.previewActivations ?? 0) + 1
          )
        const result =
          data.type === "preview" && data.conversation_id === conversationId
            ? {
                detected: true,
                ok: true,
                preview: {
                  tab_id: 7,
                  title: "Reference workspace",
                  url: "https://example.test/",
                  image,
                  captured_at: ++frame,
                },
              }
            : { detected: true, ok: true, pairing_mode: "connected" }
        window.postMessage(
          { source: "linksense-extension", id: data.id, result },
          location.origin
        )
      })
    },
    { image, conversationId }
  )
  await mockConversation(page, conversationId)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/conversations/${conversationId}`)
  await page.getByRole("button", { name: "关闭任务概览", exact: true }).click()
  await expect(
    page.getByRole("region", { name: "任务概览", exact: true })
  ).toBeHidden()
  const panel = page.getByRole("complementary", {
    name: "Browser Use",
    exact: true,
  })
  const boundary = page.locator("[data-local-browser-preview-boundary]")
  const grip = panel.getByRole("button", {
    name: "拖动预览到四角，或使用方向键移动",
  })
  await expect(panel).toBeVisible()
  for (const corner of [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
  ] as const) {
    const area = (await boundary.boundingBox())!
    const card = (await panel.boundingBox())!
    const handle = (await grip.boundingBox())!
    const start = { x: handle.x + 12, y: handle.y + handle.height / 2 }
    const hit = await grip.evaluate(
      (element, point) => ({
        reachable: element.contains(
          document.elementFromPoint(point.x, point.y)
        ),
        target: document
          .elementFromPoint(point.x, point.y)
          ?.outerHTML.slice(0, 500),
        point,
        rect: element.getBoundingClientRect().toJSON(),
      }),
      start
    )
    expect(hit.reachable, JSON.stringify({ corner, ...hit })).toBe(true)
    const destination = {
      x: area.x + (corner.endsWith("right") ? area.width - card.width : 0),
      y: area.y + (corner.startsWith("bottom") ? area.height - card.height : 0),
    }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(
        start.x + ((destination.x - card.x) * step) / 12,
        start.y + ((destination.y - card.y) * step) / 12
      )
      const moving = (await panel.boundingBox())!
      expect(moving.x).toBeGreaterThanOrEqual(area.x - 1)
      expect(moving.y).toBeGreaterThanOrEqual(area.y - 1)
      expect(moving.x + moving.width).toBeLessThanOrEqual(
        area.x + area.width + 1
      )
      expect(moving.y + moving.height).toBeLessThanOrEqual(
        area.y + area.height + 1
      )
    }
    await page.mouse.up()
    await panel.screenshot({
      path: testInfo.outputPath(`preview-${corner}.png`),
    })
    await expect(panel).toHaveAttribute("data-corner", corner)
    await expect
      .poll(async () => {
        const actual = (await panel.boundingBox())!
        return (
          Math.abs(actual.x - destination.x) < 1 &&
          Math.abs(actual.y - destination.y) < 1
        )
      })
      .toBe(true)
  }
  expect(
    await page.locator("html").getAttribute("data-preview-activations")
  ).toBeNull()
  await panel
    .getByRole("button", { name: "切换到标签页：Reference workspace" })
    .click()
  await expect(page.locator("html")).toHaveAttribute(
    "data-preview-activations",
    "1"
  )
  await grip.press("ArrowUp")
  await expect(panel).toHaveAttribute("data-corner", "top-right")
  await page.reload()
  await expect(panel).toHaveAttribute("data-corner", "top-right")
  await page.screenshot({
    path: testInfo.outputPath("browser-preview-desktop.png"),
  })
  await page.setViewportSize({ width: 390, height: 780 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect
    .poll(async () => {
      const card = (await panel.boundingBox())!
      const area = (await boundary.boundingBox())!
      return (
        card.x >= area.x - 1 &&
        card.y >= area.y - 1 &&
        card.x + card.width <= area.x + area.width + 1 &&
        card.y + card.height <= area.y + area.height + 1
      )
    })
    .toBe(true)
  await grip.press("ArrowDown")
  await expect(panel).toHaveAttribute("data-corner", "bottom-right")
  expect(
    (
      await new AxeBuilder({ page })
        .include("[data-local-browser-preview-boundary]")
        .analyze()
    ).violations
  ).toEqual([])
  await page.screenshot({
    path: testInfo.outputPath("browser-preview-mobile.png"),
  })
  await panel.getByRole("button", { name: "隐藏浏览器预览" }).click()
  await expect(panel).toBeHidden()
})

test("browser preview avoids task overview and uses a reachable compact control when space runs out", async ({
  page,
}, testInfo) => {
  const conversationId = "20000000-0000-4000-8000-000000000001"
  await page.addInitScript(() => {
    localStorage.setItem(
      "linksense.browser-preview-corner:10000000-0000-4000-8000-000000000001",
      "top-right"
    )
    localStorage.setItem("linksense.taskOverviewOpen", "true")
    window.addEventListener("message", (event) => {
      const data = event.data
      if (event.source !== window || data?.source !== "linksense-web") return
      const result =
        data.type === "preview"
          ? {
              detected: true,
              ok: true,
              preview: {
                tab_id: 7,
                title: "Reference workspace",
                url: "https://example.test/",
                image:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aksAAAAASUVORK5CYII=",
                captured_at: 1,
              },
            }
          : { detected: true, ok: true, pairing_mode: "connected" }
      window.postMessage(
        { source: "linksense-extension", id: data.id, result },
        location.origin
      )
    })
  })
  await mockConversation(page, conversationId)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`/conversations/${conversationId}`)
  const panel = page.getByRole("complementary", {
    name: "Browser Use",
    exact: true,
  })
  const overview = page.getByRole("region", { name: "任务概览", exact: true })
  await expect(panel).toBeVisible()
  await expect(overview).toBeVisible()
  const clear = async () => {
    const card = await panel.boundingBox()
    const task = await overview.boundingBox()
    return Boolean(
      card &&
      task &&
      (card.x + card.width <= task.x ||
        card.x >= task.x + task.width ||
        card.y + card.height <= task.y ||
        card.y >= task.y + task.height)
    )
  }
  await expect.poll(clear).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath("overview-preview-desktop.png"),
  })

  const preferenceKey = `linksense.browser-preview-corner:${E2E_ADMIN.id}`
  await expect
    .poll(() =>
      page.evaluate((key) => localStorage.getItem(key), preferenceKey)
    )
    .toBe("top-right")
  await page.getByRole("button", { name: "关闭任务概览", exact: true }).click()
  await expect(overview).toBeHidden()
  const bounds = page.locator("[data-local-browser-preview-boundary]")
  await expect
    .poll(async () => {
      const card = await panel.boundingBox()
      const boundary = await bounds.boundingBox()
      return Boolean(
        card &&
        boundary &&
        Math.abs(card.y - boundary.y) < 1 &&
        Math.abs(card.x + card.width - boundary.x - boundary.width) < 1
      )
    })
    .toBe(true)

  for (const viewport of [
    { width: 390, height: 600 },
    { width: 800, height: 480 },
  ]) {
    await page.setViewportSize(viewport)
    if (viewport.width === 800)
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" })
    await page
      .getByRole("button", { name: "打开任务概览", exact: true })
      .click()
    const expand = page.getByRole("button", {
      name: "展开浏览器预览：Reference workspace",
    })
    await expect(expand).toBeVisible()
    await expect(panel).toBeHidden()
    await expect(overview).toBeVisible()
    await expect(overview).toHaveCSS("opacity", "1")
    expect(
      await expand.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          )
        )
      })
    ).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath(
        `overview-preview-compact-${viewport.width}.png`
      ),
    })
    await expand.focus()
    await page.keyboard.press("Enter")
    await expect(panel).toBeVisible()
    await expect(overview).toBeHidden()
    await expect(panel).toHaveCSS("transition-property", "none")
    await expect(
      panel.getByRole("button", { name: "拖动预览到四角，或使用方向键移动" })
    ).toBeFocused()
    expect(
      await page.evaluate(() =>
        localStorage.getItem("linksense.taskOverviewOpen")
      )
    ).toBe("true")
    expect(
      await page.evaluate((key) => localStorage.getItem(key), preferenceKey)
    ).toBe("top-right")
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true)
  }
})

test("task overview action icons remain visible in forced colors", async ({
  page,
}) => {
  const conversationId = "20000000-0000-4000-8000-000000000001"
  await mockConversation(page, conversationId)
  await page.addInitScript(() =>
    localStorage.setItem("linksense.taskOverviewOpen", "true")
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          conversation: {
            id: conversationId,
            title: "Overview",
            archive_status: "active",
            project_id: null,
            execution_status: "completed",
            updated_at: "2026-10-30T00:00:00Z",
          },
          messages: [],
          files: [
            {
              id: "overview-file",
              filename: "report.pdf",
              mime_type: "application/pdf",
              size_bytes: 1024,
              kind: "artifact",
              status: "available",
              downloadable: true,
            },
          ],
        },
      }),
    })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/sources`,
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [{ url: "https://example.test/guide", title: "Guide" }],
          },
        }),
      })
  )
  await page.emulateMedia({ forcedColors: "active" })
  await page.goto(`/conversations/${conversationId}`)
  const overview = page.getByRole("region", { name: "任务概览", exact: true })
  await expect(overview).toBeVisible()
  for (const name of ["download", "open-source"]) {
    const icon = overview.locator(`[data-design-icon="${name}"]`)
    await expect(icon).toHaveCSS("forced-color-adjust", "none")
    await expect(icon).not.toHaveCSS("mask-image", "none")
    expect(
      await icon.evaluate(
        (element) =>
          getComputedStyle(element).backgroundColor !==
          getComputedStyle(document.body).backgroundColor
      )
    ).toBe(true)
  }
})

test("the real extension automatically supplies and updates the chat picture in picture", async ({
  baseURL,
}, testInfo) => {
  test.setTimeout(45_000)
  if (!baseURL) throw new Error("web preview server missing")
  const conversationId = "20000000-0000-4000-8000-000000000001"
  const date = new Date("2026-01-01T00:00:00Z")
  const { api, service, address } = await createBrowserExtensionFixture(
    E2E_ADMIN.id,
    date
  )
  const target = createServer((_request, response) => {
    response.setHeader("content-type", "text/html")
    response.end(
      "<!doctype html><html lang=\"en\"><head><title>Reference workspace</title><style>body{margin:0;background:#eef2fa;color:#252b49;font:18px system-ui}main{margin:70px;padding:48px;background:white;border-radius:20px}button{padding:20px;font:inherit}</style></head><body><main><h1>Reference workspace</h1><p>Browser actions appear in the chat preview.</p><button onclick=\"this.textContent='Updated page';document.body.style.background='#cbdaf5'\">Update page</button></main></body></html>"
    )
  })
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve))
  const targetAddress = target.address()
  if (!targetAddress || typeof targetAddress === "string")
    throw new Error("target port missing")
  const directory = await mkdtemp(
    path.join(tmpdir(), "linksense-chat-preview-")
  )
  const extension = path.resolve(
    import.meta.dirname,
    "../../api/dist/browser-extension"
  )
  const browser = await chromium.launchPersistentContext(directory, {
    channel: "chromium",
    headless: true,
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  })
  try {
    let [worker] = browser.serviceWorkers()
    if (!worker) worker = await browser.waitForEvent("serviceworker")
    const extensionId = new URL(worker.url()).host
    const page = await browser.newPage()
    await page.goto(`${address}/settings/general`)
    const pairing = await service.pairing(E2E_ADMIN.id, date.toISOString())
    await page.evaluate(
      (pairing) =>
        window.postMessage(
          {
            source: "linksense-web",
            type: "pair",
            id: "chat-preview",
            pairing,
          },
          location.origin
        ),
      { code: pairing.code, endpoint: `${address}/api/v1/local-browser` }
    )
    const popup = await browser.newPage()
    await popup.goto(`chrome-extension://${extensionId}/popup.html`)
    await expect(popup.locator("#connect")).toBeEnabled()
    await popup.locator("#new-tabs").check()
    await popup.locator("#connect").click()
    await expect
      .poll(async () => (await service.status(E2E_ADMIN.id)).connected)
      .toBe(true)

    await mockConversation(page, conversationId)
    await page.route("**/assets/**", async (route) =>
      route.fulfill({
        response: await browser.request.get(
          `${baseURL}${new URL(route.request().url()).pathname}`
        ),
      })
    )
    await page.route(`${address}/conversations/*`, async (route) =>
      route.fulfill({ response: await browser.request.get(baseURL) })
    )
    await page.goto(`${address}/conversations/new`)
    await page.evaluate((conversationId) => {
      history.pushState({}, "", `/conversations/${conversationId}`)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }, conversationId)
    await expect(
      page.getByRole("heading", { name: "本地浏览器操作", exact: true })
    ).toBeVisible()
    const panel = page.getByRole("complementary", {
      name: "Browser Use",
      exact: true,
    })
    await expect(panel).toBeHidden()
    const opened = await service.execute(E2E_ADMIN.id, conversationId, {
      action: "open",
      url: `http://127.0.0.1:${targetAddress.port}/`,
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok || !opened.data.tab_id) throw new Error("target tab missing")
    const tabId = opened.data.tab_id
    await page.bringToFront()
    await expect(panel).toBeVisible()
    const image = panel.getByRole("img", { name: "Reference workspace" })
    await expect(image).toBeVisible()
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.naturalWidth > 0
        )
      )
      .toBe(true)
    const initial = await image.getAttribute("src")
    await page
      .getByRole("button", { name: "关闭任务概览", exact: true })
      .click()
    await page.getByRole("button", { name: "暂时不用", exact: true }).click()

    const snapshot = await service.execute(E2E_ADMIN.id, conversationId, {
      action: "snapshot",
      tab_id: tabId,
    })
    const ref = snapshot.ok
      ? snapshot.data.elements?.find(
          (item) => item.role === "button" && item.name === "Update page"
        )?.ref
      : undefined
    expect(ref).toBeDefined()
    expect(
      await service.execute(E2E_ADMIN.id, conversationId, {
        action: "click",
        tab_id: tabId,
        ref: ref!,
      })
    ).toMatchObject({ ok: true })
    await expect(image).not.toHaveAttribute("src", initial!)
    await page.screenshot({
      path: testInfo.outputPath("chat-picture-in-picture.png"),
    })
    await panel
      .getByRole("button", { name: "切换到标签页：Reference workspace" })
      .click()
    await expect
      .poll(() =>
        worker.evaluate(
          async (tab) => (await chrome.tabs.get(tab)).active,
          tabId
        )
      )
      .toBe(true)
    await page.bringToFront()
    expect(
      await service.execute(E2E_ADMIN.id, conversationId, {
        action: "release",
        tab_id: tabId,
      })
    ).toMatchObject({ ok: true })
    await expect(panel).toBeHidden()
    for (let index = 0; index < 3; index++) {
      const url = `http://127.0.0.1:${targetAddress.port}/?tab=${index}`
      const next = await service.execute(E2E_ADMIN.id, conversationId, {
        action: "open",
        url,
      })
      expect(next.ok).toBe(true)
      if (!next.ok || !next.data.tab_id)
        throw new Error("next target tab missing")
      await page.bringToFront()
      await expect(panel).toBeVisible()
      await expect(panel.locator("p[title]")).toHaveAttribute("title", url)
      await panel
        .getByRole("button", { name: "切换到标签页：Reference workspace" })
        .click()
      await expect
        .poll(() =>
          worker.evaluate(
            async (tab) => (await chrome.tabs.get(tab)).active,
            next.data.tab_id!
          )
        )
        .toBe(true)
      await page.bringToFront()
      expect(
        await service.execute(E2E_ADMIN.id, conversationId, {
          action: "release",
          tab_id: next.data.tab_id,
        })
      ).toMatchObject({ ok: true })
      await expect(panel).toBeHidden()
    }
  } finally {
    await browser.close()
    await api.close()
    await new Promise<void>((resolve) => target.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  }
})
