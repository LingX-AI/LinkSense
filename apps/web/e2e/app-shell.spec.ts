import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page, type Route } from "@playwright/test"
import { writeFile } from "node:fs/promises"
import dayjs from "dayjs"
import JSZip from "jszip"

import {
  createE2EAuthSession,
  E2E_ADMIN as ADMIN,
} from "./support/auth-fixture"

const NOW = "2026-07-11T08:00:00.000Z"
const AUDIT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
const HEALTH_STATUS = {
  status: "unavailable",
  overall_status: "unavailable",
  readiness: "unready",
  checked_at: NOW,
  running_turn_count: 1,
  app_server_process_count: 2,
  concurrency_limit: 5,
  components: {
    api: { status: "available", checked_at: NOW, reason_code: null },
    database: { status: "available", checked_at: NOW, reason_code: null },
    runner: { status: "available", checked_at: NOW, reason_code: null },
    workspace: { status: "available", checked_at: NOW, reason_code: null },
    minio: {
      status: "unavailable",
      checked_at: NOW,
      reason_code: "MINIO_UNAVAILABLE",
    },
    codex_app_server: {
      status: "available",
      checked_at: NOW,
      reason_code: null,
    },
    codex_home: { status: "available", checked_at: NOW, reason_code: null },
    codex_home_root: {
      status: "available",
      checked_at: NOW,
      reason_code: null,
    },
  },
}

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

async function installVoiceCaptureMock(page: Page) {
  await page.addInitScript(() => {
    const track = { stop() {} }
    const stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true
      }

      readonly mimeType = "audio/webm"
      state: RecordingState = "inactive"
      ondataavailable: ((event: BlobEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onstop: ((event: Event) => void) | null = null

      start() {
        this.state = "recording"
      }

      stop() {
        this.state = "inactive"
        this.onstop?.(new Event("stop"))
      }
    }

    const analyser = {
      fftSize: 1024,
      frequencyBinCount: 512,
      smoothingTimeConstant: 0,
      getByteTimeDomainData(samples: Uint8Array) {
        samples.forEach((_, index) => {
          samples[index] = index % 2 === 0 ? 144 : 112
        })
      },
      getByteFrequencyData(samples: Uint8Array) {
        samples.fill(180)
      },
      disconnect() {},
    } as unknown as AnalyserNode
    const source = {
      connect() {},
      disconnect() {},
    } as unknown as MediaStreamAudioSourceNode

    class FakeAudioContext {
      readonly state: AudioContextState = "running"
      readonly sampleRate = 48_000

      createAnalyser() {
        return analyser
      }

      createMediaStreamSource() {
        return source
      }

      resume() {
        return Promise.resolve()
      }

      close() {
        return Promise.resolve()
      }
    }

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(stream) },
    })
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    })
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: FakeAudioContext,
    })
  })
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 320, height: 568 },
]) {
  test(`voice recording controls stay left of Send at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await installVoiceCaptureMock(page)
    await page.setViewportSize(viewport)
    await page.goto("/conversations/new")

    const input = page.getByRole("textbox", { name: "任务输入框" })
    await page.getByRole("button", { name: "语音输入" }).click()

    const actions = page.getByTestId("composer-primary-actions")
    const recordingPanel = page.getByTestId("voice-recording-panel")
    const stopVoice = page.getByRole("button", { name: "停止语音输入" })
    const send = page.getByRole("button", { name: "发送" })
    await expect(input).toBeVisible()
    await expect(page.getByText("正在连接麦克风…")).toHaveCount(0)
    await expect(recordingPanel).toBeVisible()
    await expect(
      recordingPanel.locator("[data-waveform-sample]").first()
    ).toBeVisible()

    const [actionsBox, recordingBox, stopBox, sendBox] = await Promise.all([
      actions.boundingBox(),
      recordingPanel.boundingBox(),
      stopVoice.boundingBox(),
      send.boundingBox(),
    ])
    expect(actionsBox).not.toBeNull()
    expect(recordingBox).not.toBeNull()
    expect(stopBox).not.toBeNull()
    expect(sendBox).not.toBeNull()
    expect(recordingBox!.x + recordingBox!.width).toBeLessThanOrEqual(
      sendBox!.x
    )
    expect(stopBox!.x + stopBox!.width).toBeLessThanOrEqual(sendBox!.x)
    expect(
      Math.abs(
        recordingBox!.y +
          recordingBox!.height / 2 -
          (sendBox!.y + sendBox!.height / 2)
      )
    ).toBeLessThanOrEqual(1)
    await expectNoHorizontalOverflow(page)
  })
}

for (const viewport of [
  { width: 1440, height: 1024 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`new task welcome remains clear at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto("/conversations/new")

    await expect(
      page.getByRole("heading", {
        name: "我们一起在 LinkSense 中做些什么？",
        exact: true,
      })
    ).toBeVisible()
    await expect(page.locator(".conversation-welcome-icon")).toBeVisible()
    await expect(
      page.getByText("还没有任务。可以直接从输入框开始。", {
        exact: true,
      })
    ).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    const welcomeBox = await page.locator(".conversation-welcome").boundingBox()
    const composerBox = await page
      .getByRole("form", { name: "任务输入框" })
      .boundingBox()
    expect(welcomeBox).not.toBeNull()
    expect(composerBox).not.toBeNull()
    if (!welcomeBox || !composerBox) return
    expect(welcomeBox.y + welcomeBox.height).toBeLessThanOrEqual(composerBox.y)
  })
}

for (const viewport of [
  { width: 1440, height: 1024 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`settings and fixed roles remain usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.goto("/settings/general")
    await expect(
      page.getByRole("heading", { name: "常规", exact: true })
    ).toBeVisible()
    await expect(page.locator("main")).toHaveCount(1)
    await expect(
      page.getByRole("complementary", { name: "设置导航" })
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)

    if (viewport.width < 768) {
      const navigation = page.getByRole("button", { name: "设置导航" })
      await navigation.click()
      await expect(page.getByRole("navigation", { name: "个人" })).toBeVisible()
      await expect(
        page.getByRole("link", { name: "常规", exact: true })
      ).toHaveCSS("height", "32px")
      await page.keyboard.press("Escape")
      await expect(navigation).toHaveAttribute("aria-expanded", "false")
    } else {
      await expect(
        page.getByRole("link", { name: "常规", exact: true })
      ).toHaveCSS("height", "32px")
      await page.getByRole("textbox", { name: "搜索设置" }).fill("安全")
      await expect(page.getByRole("link", { name: /安全/ })).toBeVisible()
      await expect(page.getByRole("link", { name: /个人资料/ })).toHaveCount(0)
    }

    await page.goto("/settings/appearance")
    await expect(
      page.getByRole("heading", { name: "外观", exact: true })
    ).toBeVisible()
    await expect(page.getByRole("radio")).toHaveCount(3)
    const uiFontSize = page.getByRole("spinbutton", { name: "UI 字号" })
    await expect(uiFontSize).toHaveValue("14")
    await uiFontSize.fill("18")
    await uiFontSize.blur()
    await expect(page.locator("html")).toHaveAttribute(
      "data-ui-font-size",
      "18"
    )
    await expectNoHorizontalOverflow(page)

    await page.goto("/capabilities")
    await expect(
      page.getByRole("heading", { name: "插件中心", exact: true })
    ).toBeVisible()
    await expect(page.getByRole("tab", { name: "插件" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    await expect(
      page.getByText("还没有已安装的插件", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("没有符合条件的个人插件", { exact: true })
    ).toBeVisible()
    await page.getByRole("tab", { name: "技能" }).click()
    await expect(
      page.getByText("还没有已安装的技能", { exact: true })
    ).toBeVisible()
    await expect(
      page.getByText("没有符合条件的个人技能", { exact: true })
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto("/archived")
    await expect(
      page.getByRole("heading", { name: "已归档任务", exact: true })
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "搜索" })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto("/admin/roles")
    await expect(
      page.getByRole("heading", { name: "角色与权限", exact: true })
    ).toBeVisible()
    await expect(page.getByText("user", { exact: true })).toBeVisible()
    await expect(page.getByText("admin", { exact: true })).toBeVisible()
    await expect(
      page.getByRole("button", { name: /新增角色|创建角色/ })
    ).toHaveCount(0)
    await expect(
      page.getByRole("complementary", { name: "设置导航" })
    ).toBeVisible()
    await expect(
      page.getByRole("complementary", { name: "LinkSense 导航" })
    ).toHaveCount(0)

    if (viewport.width < 768) {
      await page.getByRole("button", { name: "设置导航" }).click()
    }
    await expect(page.getByRole("link", { name: /用户与用户组/ })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
}

test("desktop sidebar reveals its resize handle, resizes, and restores the width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/conversations/new")

  const sidebar = page.getByRole("complementary", {
    name: "LinkSense 导航",
  })
  const resizeHandle = page.getByRole("separator", {
    name: "调整侧边栏宽度",
  })
  await expect(resizeHandle).toBeVisible()
  await expect(resizeHandle).toHaveCSS("cursor", "col-resize")
  expect(
    await resizeHandle.evaluate(
      (element) => getComputedStyle(element, "::after").opacity
    )
  ).toBe("0")
  expect(
    await resizeHandle.evaluate((element) => {
      const style = getComputedStyle(element, "::after")
      return { top: style.top, bottom: style.bottom }
    })
  ).toEqual({ top: "0px", bottom: "0px" })

  const handleBox = await resizeHandle.boundingBox()
  expect(handleBox).not.toBeNull()
  if (!handleBox) return

  const startX = handleBox.x + handleBox.width / 2
  const dragY = handleBox.y + 120
  await page.mouse.move(startX, dragY)
  await expect
    .poll(() =>
      resizeHandle.evaluate(
        (element) => getComputedStyle(element, "::after").opacity
      )
    )
    .toBe("0.35")

  await page.mouse.down()
  await page.mouse.move(startX + 92, dragY, { steps: 4 })
  await page.mouse.up()

  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "340")
  const resizedSidebarBox = await sidebar.boundingBox()
  expect(resizedSidebarBox?.width).toBeCloseTo(340, 0)
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("linksense.sidebarWidth")
    )
  ).toBe("340")

  await page.reload()
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "340")
  const restoredSidebarBox = await sidebar.boundingBox()
  expect(restoredSidebarBox?.width).toBeCloseTo(340, 0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(resizeHandle).toBeHidden()
})

test("light theme uses a neutral sidebar with translucent interaction colors without changing dark theme", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/conversations/20000000-0000-4000-8000-000000000001")

  const appSidebar = page.getByRole("complementary", {
    name: "LinkSense 导航",
  })
  await expect(appSidebar).toHaveCSS("background-color", "rgb(245, 245, 245)")
  await expect(
    appSidebar.locator(".sidebar-conversation-item.sidebar-link-active")
  ).toHaveCSS("background-color", "color(srgb 0.12549 0.12549 0.12549 / 0.0509804)")
  const capabilitiesLink = appSidebar.getByRole("link", { name: "插件中心" })
  await capabilitiesLink.hover()
  await expect(capabilitiesLink).toHaveCSS(
    "background-color",
    "rgba(32, 32, 32, 0.03)"
  )

  await page.goto("/settings/general")
  const settingsSidebar = page.getByRole("complementary", {
    name: "设置导航",
  })
  await expect(settingsSidebar).toHaveCSS(
    "background-color",
    "rgb(245, 245, 245)"
  )
  await expect(
    settingsSidebar.locator(".settings-navigation-link-active")
  ).toHaveCSS("background-color", "rgba(32, 32, 32, 0.08)")
  const inactiveSettingsLink = settingsSidebar
    .locator(".settings-navigation-link:not(.settings-navigation-link-active)")
    .first()
  await inactiveSettingsLink.hover()
  await expect(inactiveSettingsLink).toHaveCSS(
    "background-color",
    "rgba(32, 32, 32, 0.03)"
  )

  await page.emulateMedia({ colorScheme: "dark" })
  await expect(settingsSidebar).toHaveCSS("background-color", "rgb(32, 32, 32)")
  await expect(
    settingsSidebar.locator(".settings-navigation-link-active")
  ).toHaveCSS("background-color", "rgb(52, 52, 52)")
  await inactiveSettingsLink.hover()
  await expect(inactiveSettingsLink).toHaveCSS(
    "background-color",
    "rgb(40, 40, 40)"
  )
})

test("account menu follows keyboard dismissal and routes to standalone settings", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/conversations/new")
  const accountTrigger = page.getByRole("button", { name: "Eli", exact: true })
  await accountTrigger.focus()
  await page.keyboard.press("Enter")
  const menu = page.getByRole("menu")
  const settingsItem = menu.getByRole("menuitem", { name: "设置" })
  await expect(settingsItem).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "管理中心" })).toHaveCount(0)
  await expect(menu.getByRole("menuitem", { name: "个人设置" })).toHaveCount(0)
  await expect(menu.getByRole("menuitem", { name: "个人凭据" })).toHaveCount(0)
  await expect(menu.getByText("Eli", { exact: true })).toHaveCSS(
    "font-size",
    "14px"
  )
  await expect(menu.getByText("eli@example.com", { exact: true })).toHaveCount(
    0
  )
  await expect(menu.getByText("管理员", { exact: true })).toHaveCount(0)
  await expect(accountTrigger.getByText("管理员", { exact: true })).toHaveCount(
    0
  )
  await expect(settingsItem).toHaveCSS("font-size", "14px")
  await page.keyboard.press("Escape")
  await expect(accountTrigger).toBeFocused()

  await page.keyboard.press("Enter")
  await page.getByRole("menuitem", { name: "设置" }).click()
  await expect(page).toHaveURL(/\/settings\/general$/u)
  await expect(
    page.getByRole("heading", { name: "常规", exact: true })
  ).toBeVisible()
})

test("200 percent zoom keeps settings controls available without page overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/settings/general")
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2"
  })
  await expect(page.getByRole("combobox", { name: "语言" })).toBeVisible()
  await expect(page.getByRole("button", { name: "保存" })).toHaveCount(0)
  await expect(page.getByRole("textbox", { name: "搜索设置" })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto("/settings/appearance")
  const uiFontSize = page.getByRole("spinbutton", { name: "UI 字号" })
  await uiFontSize.fill("18")
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2"
  })
  await expect(uiFontSize).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test("language selection updates the interface and persists automatically", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/settings/general")

  const saveRequestPromise = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === "/api/v1/me"
  )
  await page.getByRole("combobox", { name: "语言" }).click()
  await page.getByRole("option", { name: "English" }).click()
  const saveRequest = await saveRequestPromise

  await expect(page.locator("html")).toHaveAttribute("lang", "en-US")
  await expect(
    page.getByRole("heading", { name: "General", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("complementary", { name: "LinkSense settings navigation" })
  ).toBeVisible()
  expect(saveRequest.postDataJSON()).toEqual({ preferred_locale: "en-US" })
  await expect(page.getByText("Language preference saved.")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0)

  await page.reload()
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US")
  await expect(
    page.getByRole("heading", { name: "General", exact: true })
  ).toBeVisible()

  await page.goto("/conversations/new")
  const sidebar = page.getByRole("complementary", {
    name: "LinkSense navigation",
  })
  const accountTrigger = sidebar.getByRole("button", {
    name: "Eli",
    exact: true,
  })
  await accountTrigger.click()
  const menu = page.getByRole("menu")
  const [sidebarBox, triggerBox, menuBox] = await Promise.all([
    sidebar.boundingBox(),
    accountTrigger.boundingBox(),
    menu.boundingBox(),
  ])
  expect(sidebarBox).not.toBeNull()
  expect(triggerBox).not.toBeNull()
  expect(menuBox).not.toBeNull()
  if (!sidebarBox || !triggerBox || !menuBox) return
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
    sidebarBox.x + sidebarBox.width + 0.5
  )
  await expectNoHorizontalOverflow(page)

  await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 320, height: 568 })
  await page.getByRole("button", { name: "Open navigation" }).click()
  await page.getByRole("button", { name: "Eli", exact: true }).click()
  const mobileMenu = page.getByRole("menu")
  await expect(mobileMenu).toBeVisible()
  await expect
    .poll(async () => (await mobileMenu.boundingBox())?.x ?? -1)
    .toBeGreaterThanOrEqual(12)
  await expect
    .poll(async () => {
      const box = await mobileMenu.boundingBox()
      return box ? box.x + box.width : Number.POSITIVE_INFINITY
    })
    .toBeLessThanOrEqual(308)
  await expectNoHorizontalOverflow(page)
})

test("appearance supports themes and a persistent UI font size without backend persistence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.emulateMedia({ colorScheme: "dark" })
  const patchRequests: string[] = []
  page.on("request", (request) => {
    if (request.method() === "PATCH") patchRequests.push(request.url())
  })
  await page.goto("/settings/appearance")

  await expect(
    page.getByRole("heading", { name: "外观", exact: true })
  ).toBeVisible()
  const systemTheme = page.getByRole("radio", { name: "系统" })
  const lightTheme = page.getByRole("radio", { name: "浅色" })
  const darkTheme = page.getByRole("radio", { name: "深色" })
  const uiFontSize = page.getByRole("spinbutton", { name: "UI 字号" })
  const systemThemeLabel = page.locator('label[for="appearance-theme-system"]')
  const lightThemeLabel = page.locator('label[for="appearance-theme-light"]')
  await expect(systemTheme).toBeChecked()
  await expect(uiFontSize).toHaveValue("14")
  await expect(uiFontSize).toHaveAttribute("min", "12")
  await expect(uiFontSize).toHaveAttribute("max", "18")
  await expect(uiFontSize).toHaveAttribute("step", "1")
  await expect(page.locator("html")).toHaveClass(/dark/u)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  const systemThemePreview = systemThemeLabel.locator(
    ".appearance-theme-preview"
  )
  const lightThemePreview = lightThemeLabel.locator(".appearance-theme-preview")
  const defaultPreviewBorderColor = await lightThemePreview.evaluate(
    (preview) => getComputedStyle(preview).borderLeftColor
  )
  await expect(systemThemePreview).toHaveCSS(
    "border-left-color",
    defaultPreviewBorderColor
  )
  await expect(systemThemePreview).toHaveCSS("box-shadow", "none")

  await uiFontSize.fill("12")
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "12")
  await expect(page.locator("html")).toHaveCSS("--app-ui-font-size", "12px")
  expect(
    await page.evaluate(() => localStorage.getItem("linksense.uiFontSize"))
  ).toBe("12")
  await expect(page.getByRole("link", { name: /外观/u })).toHaveCSS(
    "font-size",
    "12px"
  )

  await page.reload()
  await expect(uiFontSize).toHaveValue("12")
  await uiFontSize.fill("19")
  await uiFontSize.blur()
  await expect(uiFontSize).toHaveValue("18")
  await expect(page.locator("html")).toHaveAttribute("data-ui-font-size", "18")
  await expectNoHorizontalOverflow(page)

  await lightThemeLabel.click()
  await expect(lightTheme).toBeChecked()
  await expect(page.locator("html")).not.toHaveClass(/dark/u)
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  expect(
    await page.evaluate(() => localStorage.getItem("linksense.theme"))
  ).toBe("light")

  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")

  await lightTheme.focus()
  await page.keyboard.press("ArrowRight")
  await expect(darkTheme).toBeChecked()
  await expect(page.locator("html")).toHaveClass(/dark/u)
  await page.emulateMedia({ colorScheme: "light" })
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")

  await page.reload()
  await expect(page.getByRole("radio", { name: "深色" })).toBeChecked()
  await expect(page.locator("html")).toHaveClass(/dark/u)

  await systemThemeLabel.click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  expect(
    await page.evaluate(() => localStorage.getItem("linksense.theme"))
  ).toBe("system")
  expect(patchRequests).toEqual([])
  await expect(page.getByRole("button", { name: "保存" })).toHaveCount(0)
  await expect(
    page.getByText(/强调色|自定义字体|透明|对比度|动态效果/u)
  ).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  const results = await new AxeBuilder({ page }).analyze()
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious"
    )
  ).toEqual([])

  await page.goto("/settings/general")
  const languageSave = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      new URL(request.url()).pathname === "/api/v1/me"
  )
  await page.getByRole("combobox", { name: "语言" }).click()
  await page.getByRole("option", { name: "English" }).click()
  await languageSave
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto("/settings/appearance")
  await expect(
    page.getByRole("heading", { name: "Appearance", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("spinbutton", { name: "UI font size" })
  ).toHaveValue("18")
  await expectNoHorizontalOverflow(page)

  await page.goto("/conversations/20000000-0000-4000-8000-000000000001")
  await expect(page.locator(".message-row").first()).toHaveCSS(
    "font-size",
    "18px"
  )
  await expect(page.locator(".sidebar-nav-item").first()).toHaveCSS(
    "font-size",
    "18px"
  )
  const composerPlaceholderStyle = await page
    .getByRole("textbox", { name: "Task composer" })
    .evaluate((element) => {
      const inputStyle = getComputedStyle(element)
      const placeholderStyle = getComputedStyle(element, "::placeholder")
      return {
        color: placeholderStyle.color,
        fontSize: placeholderStyle.fontSize,
        fontWeight: placeholderStyle.fontWeight,
        inputFontWeight: inputStyle.fontWeight,
      }
    })
  expect(composerPlaceholderStyle).toMatchObject({
    fontSize: "18px",
    fontWeight: "500",
    inputFontWeight: "500",
  })
  expect(composerPlaceholderStyle.color).toMatch(
    /(?:\/\s*0\.72\)|,\s*0\.72\))$/u
  )
})

test("security password fields use independent visibility controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/settings/security")

  await expect(page.getByRole("heading", { name: "安全" })).toBeVisible()
  const currentPassword = page.getByLabel("当前密码", { exact: true })
  const newPassword = page.getByLabel("新密码", { exact: true })
  const confirmation = page.getByLabel("确认新密码", { exact: true })
  await currentPassword.fill("CurrentPass1!")
  await newPassword.fill("NextPass2!")
  await confirmation.fill("NextPass2!")

  await expect(currentPassword).toHaveAttribute("type", "password")
  await expect(newPassword).toHaveAttribute("type", "password")
  await expect(confirmation).toHaveAttribute("type", "password")
  await expect(page.getByRole("button", { name: "显示当前密码" })).toBeVisible()
  await expect(page.getByRole("button", { name: "显示新密码" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "显示确认新密码" })
  ).toBeVisible()

  await page.getByRole("button", { name: "显示当前密码" }).click()
  await expect(currentPassword).toHaveAttribute("type", "text")
  await expect(currentPassword).toHaveValue("CurrentPass1!")
  await expect(newPassword).toHaveAttribute("type", "password")
  await expect(confirmation).toHaveAttribute("type", "password")
  await expect(page.getByRole("button", { name: "隐藏当前密码" })).toBeVisible()
})

test("settings errors keep panel spacing and align the icon with the first text line", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/settings/profile")
  await page.getByRole("button", { name: "编辑名称" }).click()
  const dialog = page.getByRole("dialog", { name: "编辑名称" })
  await dialog.getByRole("textbox", { name: "名称" }).fill("One Updated")
  await dialog.getByRole("button", { name: "保存" }).click()

  const alert = dialog.getByRole("alert")
  await expect(alert).toContainText("无法连接服务，请检查网络后重试。")
  const panel = dialog.getByRole("textbox", { name: "名称" }).locator("..")
  const icon = alert.locator("svg").first()
  const description = alert.locator('[data-slot="alert-description"]')
  const [alertBox, panelBox, iconBox, descriptionBox] = await Promise.all([
    alert.boundingBox(),
    panel.boundingBox(),
    icon.boundingBox(),
    description.boundingBox(),
  ])

  expect(alertBox).not.toBeNull()
  expect(panelBox).not.toBeNull()
  expect(iconBox).not.toBeNull()
  expect(descriptionBox).not.toBeNull()
  if (!alertBox || !panelBox || !iconBox || !descriptionBox) return

  expect(panelBox.y - (alertBox.y + alertBox.height)).toBeGreaterThanOrEqual(
    15.5
  )
  const iconCenter = iconBox.y + iconBox.height / 2
  const firstLineCenter =
    descriptionBox.y + Math.min(descriptionBox.height, 20) / 2
  expect(Math.abs(iconCenter - firstLineCenter)).toBeLessThanOrEqual(1)
})

test("form controls and dropdown surfaces use partial radii", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/settings/general")
  const language = page.getByRole("combobox", { name: "语言" })

  await expect(language).toHaveCSS("border-radius", "11.2px")
  await expect(language).toHaveCSS("font-weight", "500")
  await expect(page.getByRole("button", { name: "保存" })).toHaveCount(0)
  await language.click()
  await expect(page.locator('[data-slot="select-content"]')).toHaveCSS(
    "border-radius",
    "11.2px"
  )
  await expect(page.getByRole("option").first()).toHaveCSS(
    "border-radius",
    "8.96px"
  )
  await expect(page.getByRole("option").first()).toHaveCSS("font-weight", "500")
})

test("navigation, menus, and tabs use the stronger typography hierarchy", async ({
  page,
}) => {
  const longTaskTitle =
    "请创建 artifacts/mcp-e2e-verification 中的完整任务并验证导入结果"
  const updatedAt = "2026-07-13T08:00:00.000Z"
  await page.route("**/api/v1/conversations?**", (route) =>
    ok(route, {
      items: [
        {
          id: "20000000-0000-4000-8000-000000000001",
          title: longTaskTitle,
          archive_status: "active",
          project_id: null,
          execution_status: "running",
          updated_at: updatedAt,
        },
      ],
      next_cursor: null,
    })
  )
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/conversations/new")
  const sidebar = page.getByRole("complementary", { name: "LinkSense 导航" })

  await expect(sidebar.getByRole("button", { name: "搜索" })).toHaveCSS(
    "font-weight",
    "500"
  )
  await expect(
    sidebar.getByRole("link", { name: "任务", exact: true })
  ).toHaveCount(0)
  await expect(sidebar.getByRole("link", { name: "插件中心" })).toHaveAttribute(
    "href",
    "/capabilities"
  )
  await expect(
    sidebar.getByRole("link", { name: "已归档", exact: true })
  ).toHaveCount(0)
  await expect(
    sidebar.getByRole("heading", { name: "任务", exact: true })
  ).toHaveCSS("font-weight", "600")
  const recentTask = sidebar
    .locator(".sidebar-conversation-item")
    .filter({ hasText: longTaskTitle })
  const recentTaskTitle = recentTask.getByText(longTaskTitle, { exact: true })
  const recentTaskLink = recentTask.locator("a").first()
  const taskStatus = recentTask.getByRole("status").first()
  const recentTaskActions = recentTask.locator(".sidebar-conversation-actions")

  await expect(recentTaskTitle).toHaveCSS("font-weight", "500")
  await expect(recentTaskTitle).toHaveCSS("overflow", "hidden")
  await expect(recentTaskTitle).toHaveCSS("white-space", "nowrap")
  await expect(recentTaskTitle).toHaveCSS("text-overflow", "clip")
  expect(
    await recentTaskTitle.evaluate((element) => {
      const style = getComputedStyle(element)
      return (
        style.getPropertyValue("mask-image") ||
        style.getPropertyValue("-webkit-mask-image")
      )
    })
  ).toContain("linear-gradient")
  expect(
    await recentTaskTitle.evaluate(
      (element) => element.scrollWidth > element.clientWidth
    )
  ).toBe(true)
  await expect(recentTaskLink).toHaveCSS("min-height", "32px")
  await expect(recentTask.locator("time")).toHaveCount(0)
  await expect(taskStatus).toBeVisible()
  await expect(taskStatus).toHaveCSS("opacity", "1")
  await expect(recentTaskActions).toHaveCSS("opacity", "0")
  await expect(recentTaskActions).toHaveCSS("gap", "4px")

  await recentTaskLink.hover()
  await expect(recentTaskActions).toHaveCSS("opacity", "1")
  await expect(recentTask.getByRole("button", { name: /归档任务/u })).toHaveCSS(
    "width",
    "20px"
  )
  await expect(
    recentTask.getByRole("button", { name: /删除任务/u })
  ).toHaveCount(0)

  await sidebar.getByRole("button", { name: "Eli", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "设置" })).toHaveCSS(
    "font-weight",
    "500"
  )
  await expect(page.getByRole("menuitem", { name: "设置" })).toHaveCSS(
    "font-size",
    "14px"
  )
  await page.getByRole("menuitem", { name: "设置" }).click()

  const settingsSidebar = page.getByRole("complementary", { name: "设置导航" })
  const personalHeading = settingsSidebar.getByRole("heading", {
    name: "个人",
  })
  await expect(personalHeading).toHaveCSS("font-weight", "600")
  await expect(personalHeading).toHaveCSS("font-size", "14px")
  await expect(
    settingsSidebar.getByRole("link", { name: "返回 LinkSense" })
  ).toHaveCSS("font-size", "14px")
  await expect(
    settingsSidebar.getByRole("textbox", { name: "搜索设置" })
  ).toHaveCSS("font-size", "14px")
  const generalLink = settingsSidebar.getByRole("link", {
    name: "常规",
    exact: true,
  })
  const settingsNavigationLabels = settingsSidebar.locator(
    ".settings-navigation-link > span"
  )
  await expect(settingsNavigationLabels).toHaveCount(22)
  await expect(
    settingsSidebar.locator(".settings-navigation-link > span > span")
  ).toHaveCount(0)
  await expect(generalLink.locator("span")).toHaveCount(1)
  await expect(generalLink.locator("span")).toHaveCSS("font-weight", "500")
  await expect(generalLink).toHaveCSS("font-size", "14px")
  await expect(generalLink).toHaveCSS("min-height", "32px")
  await expect(generalLink).toHaveCSS("height", "32px")
  for (const description of [
    "界面语言",
    "姓名和头像",
    "管理用户账号、角色和状态",
  ]) {
    await expect(
      settingsSidebar.getByText(description, { exact: true })
    ).toHaveCount(0)
  }
  await expect(
    settingsSidebar.getByRole("link", { name: "插件", exact: true })
  ).toHaveCount(0)
  await expect(
    settingsSidebar.getByRole("link", { name: "已归档任务" })
  ).toHaveAttribute("href", "/archived")
  await expect(
    settingsSidebar.getByRole("link", { name: "插件中心" })
  ).toHaveAttribute("href", "/admin/capabilities")

  await page.goto("/capabilities")
  await expect(
    page.getByRole("complementary", { name: "LinkSense 导航" })
  ).toBeVisible()
  await expect(
    page.getByRole("complementary", { name: "设置导航" })
  ).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: "插件中心", exact: true })
  ).toBeVisible()
  await expect(page.getByRole("tab", { name: "插件" })).toHaveAttribute(
    "aria-selected",
    "true"
  )
  await expect(
    page.getByText("还没有已安装的插件", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("没有符合条件的个人插件", { exact: true })
  ).toBeVisible()
  await page.getByRole("tab", { name: "技能" }).click()
  await expect(
    page.getByText("还没有已安装的技能", { exact: true })
  ).toBeVisible()
  await expect(
    page.getByText("没有符合条件的个人技能", { exact: true })
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto("/admin/capabilities")
  await expect(
    page.getByRole("complementary", { name: "设置导航" })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "插件中心", exact: true })
  ).toBeVisible()
  await expect(page.getByRole("tab", { name: "插件" })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "技能" })).toHaveCount(0)

  await page.goto("/archived")
  await expect(
    page.getByRole("complementary", { name: "设置导航" })
  ).toBeVisible()
  await expect(
    page.getByRole("complementary", { name: "LinkSense 导航" })
  ).toHaveCount(0)
  await expect(
    page.getByRole("heading", { name: "已归档任务", exact: true })
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.goto("/admin/audit")
  await expect(page.locator('[data-slot="tabs-trigger"]').first()).toHaveCSS(
    "font-weight",
    "500"
  )
})

test("task message rail stays compact at rest and expands into a message preview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/conversations/20000000-0000-4000-8000-000000000001")

  const messageNavigation = page.getByRole("navigation", {
    name: "任务消息导航",
  })
  await expect(messageNavigation).toBeVisible()
  const markers = messageNavigation.locator("button > span")
  await expect(markers).toHaveCount(2)
  const lineItems = messageNavigation.locator(
    'li[data-testid^="conversation-line-"]'
  )
  await expect(lineItems).toHaveCount(2)
  await expect(page.getByRole("dialog")).toHaveCount(0)

  await expect
    .poll(() =>
      lineItems.first().evaluate((element) => {
        const nextElement = element.nextElementSibling
        if (!nextElement) return Number.POSITIVE_INFINITY
        return (
          nextElement.getBoundingClientRect().top -
          element.getBoundingClientRect().top
        )
      })
    )
    .toBeLessThanOrEqual(10.5)

  await expect
    .poll(() =>
      markers
        .first()
        .evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeLessThanOrEqual(6.5)

  await messageNavigation
    .getByRole("button", { name: "分析项目参与度" })
    .hover()
  const preview = page.getByRole("dialog", { name: "分析项目参与度" })
  await expect(preview).toContainText("分析项目参与度")
  await expect(preview).toContainText("已完成参与度分析，并整理了异常团队。")
  await expect
    .poll(() =>
      markers
        .first()
        .evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeGreaterThanOrEqual(25)
  await expect
    .poll(() =>
      markers
        .first()
        .evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeLessThanOrEqual(26.5)
  await expect
    .poll(() =>
      markers
        .nth(1)
        .evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeGreaterThan(6.5)

  await page.mouse.move(1400, 80)
  await expect(preview).toHaveCount(0)
  await expect
    .poll(() =>
      markers
        .first()
        .evaluate((element) => element.getBoundingClientRect().width)
    )
    .toBeLessThanOrEqual(6.5)

  const conversationScroll = page.locator(".conversation-scroll")
  const targetMessage = page.locator("#conversation-message-message-user-2")
  await targetMessage.evaluate((element) => {
    element.style.marginTop = "1200px"
  })
  await messageNavigation.getByRole("button", { name: "补充改进建议" }).click()
  await expect
    .poll(() => conversationScroll.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0)
  await expect(targetMessage).toBeInViewport()
})

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`100 historical messages load on scroll and keep navigation working (${viewport.name})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    const conversationId = "20000000-0000-4000-8000-000000000001"
    const turns = Array.from({ length: 50 }, (_, index) => ({
      id: `history-turn-${index + 1}`,
      sequence_no: index + 1,
      status: "completed",
      created_at: dayjs(NOW).add(index, "minute").toISOString(),
      started_at: dayjs(NOW).add(index, "minute").toISOString(),
      completed_at: dayjs(NOW)
        .add(index, "minute")
        .add(4, "second")
        .toISOString(),
    }))
    const messages = turns.flatMap((turn) => [
      {
        id: `history-user-${turn.sequence_no}`,
        turn_id: turn.id,
        sequence_no: turn.sequence_no * 2 - 1,
        role: "user",
        content_text: `第 ${turn.sequence_no} 轮：请分析项目进展`,
        created_at: turn.created_at,
      },
      {
        id: `history-assistant-${turn.sequence_no}`,
        turn_id: turn.id,
        sequence_no: turn.sequence_no * 2,
        role: "assistant",
        phase: "final_answer",
        content_text: `第 ${turn.sequence_no} 轮分析结果。\n\n项目已完成需求梳理、方案评审和开发验证，当前进度符合预期。\n\n- 已完成：核心流程和数据检查。\n- 进行中：异常处理与交互细节。\n- 下一步：结合反馈安排下一轮验证。${"\n\n补充说明：本轮记录用于检查长对话的阅读体验。".repeat(turn.sequence_no % 3)}`,
        created_at: turn.completed_at,
      },
    ])
    expect(messages).toHaveLength(100)
    const requests: { around: number | null; count: number }[] = []
    const deliveredIds = new Set<string>()
    const pageErrors: string[] = []
    page.on("pageerror", (error) => pageErrors.push(error.message))
    await page.route(
      (url) => url.pathname === `/api/v1/conversations/${conversationId}`,
      async (route) => {
        const value = new URL(route.request().url()).searchParams.get(
          "around_turn"
        )
        const around = value === null ? null : Number(value)
        const pageStart =
          around === null
            ? turns.length - 20
            : Math.floor((around - 1) / 20) * 20
        const pageTurns = turns.slice(pageStart, pageStart + 20)
        const pageTurnIds = new Set(pageTurns.map((turn) => turn.id))
        const pageMessages = messages.filter((message) =>
          pageTurnIds.has(message.turn_id)
        )
        requests.push({ around, count: pageMessages.length })
        pageMessages.forEach((message) => deliveredIds.add(message.id))
        await ok(route, {
          conversation: {
            id: conversationId,
            title: "100 条历史消息滚动测试",
            archive_status: "active",
            project_id: null,
            execution_status: "completed",
            updated_at: NOW,
          },
          messages: pageMessages,
          turns,
          history: {
            scope_id: turns[0].id,
            turn_ids: [...pageTurnIds],
            index: turns.map((turn) => ({
              turn_id: turn.id,
              sequence_no: turn.sequence_no,
              message_id: `history-user-${turn.sequence_no}`,
              created_at: turn.created_at,
              has_content: true,
            })),
          },
          pending_requests: [],
          files: [],
          events: [],
        })
      }
    )

    await page.goto(`/conversations/${conversationId}`)
    const scroller = page.locator(".conversation-scroll")
    const mountedMessages = page.locator(
      '.message-row[id^="conversation-message-history-"]'
    )
    const latestMessage = page.locator(
      "#conversation-message-history-assistant-50"
    )
    const navigation = page.getByRole("navigation", { name: "任务消息导航" })
    const activeIds = () =>
      navigation
        .locator('[aria-current="true"]')
        .evaluateAll((elements) =>
          elements.map((element) =>
            element
              .closest("li")
              ?.getAttribute("data-testid")
              ?.replace("conversation-line-", "")
          )
        )
    const visibleIds = () =>
      scroller.evaluate((element) => {
        const viewport = element.getBoundingClientRect()
        const workspace = element.closest(".conversation-workspace")
        const bottom =
          workspace
            ?.querySelector(".conversation-bottom-stack")
            ?.getBoundingClientRect().top ?? viewport.bottom
        const top =
          workspace
            ?.querySelector(".conversation-top-bar")
            ?.getBoundingClientRect().bottom ?? viewport.top
        return [
          ...element.querySelectorAll<HTMLElement>(
            '[data-conversation-row][data-loaded="true"]'
          ),
        ]
          .filter((row) => {
            const bounds = row.getBoundingClientRect()
            return (
              bounds.height > 0 &&
              bounds.bottom > Math.max(viewport.top, top) &&
              bounds.top < Math.min(viewport.bottom, bottom)
            )
          })
          .flatMap((row) =>
            (row.dataset.messageIds ?? "").split(" ").filter(Boolean)
          )
      })
    const expectVisibleHighlights = async () => {
      if (viewport.name !== "desktop") return
      await expect
        .poll(
          async () =>
            JSON.stringify(await activeIds()) ===
            JSON.stringify(await visibleIds())
        )
        .toBe(true)
      await expect(navigation.getByRole("button")).toHaveCount(50)
    }
    await expect(latestMessage).toBeInViewport()
    expect(requests).toEqual([{ around: null, count: 40 }])
    expect(await mountedMessages.count()).toBeLessThan(30)
    await expect(
      page.locator("#conversation-message-history-user-1")
    ).toHaveCount(0)
    await expectVisibleHighlights()
    if (viewport.name === "desktop") {
      await expect
        .poll(async () => (await activeIds()).length)
        .toBeGreaterThanOrEqual(2)
      // Jump directly to an unloaded exchange: intermediate pages stay unloaded.
      await navigation
        .getByRole("button", { name: "第 1 组问答", exact: true })
        .click()
    } else {
      const previousTop = await scroller.evaluate(
        (element) => element.scrollTop
      )
      await scroller.hover()
      await page.mouse.wheel(0, -650)
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollTop))
        .toBeLessThan(previousTop)
      await scroller.evaluate((element) => {
        element.scrollTop = 0
      })
    }
    await expect(
      page.locator("#conversation-message-history-user-1")
    ).toBeInViewport()
    await expect.poll(() => requests.length).toBe(2)
    expect(requests).toEqual([
      { around: null, count: 40 },
      { around: 1, count: 40 },
    ])
    expect(deliveredIds.size).toBe(80)
    await expectVisibleHighlights()
    const previousVisible = await visibleIds()
    await scroller.hover()
    await page.mouse.wheel(0, 650)
    await expect.poll(visibleIds).not.toEqual(previousVisible)
    await expectVisibleHighlights()

    // Scroll into the gap between the two loaded windows. It loads that page,
    // without silently skipping the missing exchanges.
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight / 2
    })
    await expect.poll(() => requests.length).toBe(3)
    expect(requests).toEqual([
      { around: null, count: 40 },
      { around: 1, count: 40 },
      { around: 21, count: 40 },
    ])
    await expect(scroller.locator('[data-loaded="false"]')).toHaveCount(0)
    expect(deliveredIds.size).toBe(100)
    expect(await mountedMessages.count()).toBeLessThan(30)
    await expectVisibleHighlights()
    if (viewport.name === "desktop") {
      await expect
        .poll(async () => (await activeIds()).length)
        .toBeGreaterThanOrEqual(2)
      const target = page.locator("#conversation-message-history-user-10")
      await expect(target).toHaveCount(0)
      const marker = navigation.getByRole("button", {
        name: "第 10 轮：请分析项目进展",
        exact: true,
      })
      await marker.hover()
      await expect(
        page.getByRole("dialog", { name: "第 10 轮：请分析项目进展" })
      ).toContainText("第 10 轮分析结果")
      await marker.click()
      await expect(target).toBeInViewport()
      await expect
        .poll(async () => {
          const box = await target.boundingBox()
          const header = await page
            .locator(".conversation-top-bar")
            .boundingBox()
          return (box?.y ?? 0) - ((header?.y ?? 0) + (header?.height ?? 0))
        })
        .toBeGreaterThanOrEqual(0)
      await expect(marker).toHaveAttribute("aria-current", "true")
      await expectVisibleHighlights()
    }
    await page.keyboard.press("Escape")
    await page.mouse.click(viewport.width / 2, 120)
    const screenshot = `../../output/playwright/history-global-nav-${viewport.name}.png`
    await page.screenshot({ path: screenshot, fullPage: true })
    await testInfo.attach(`100 messages - ${viewport.name}`, {
      path: screenshot,
      contentType: "image/png",
    })
    const highlightedMessageIds =
      viewport.name === "desktop" ? await activeIds() : []
    await page.getByRole("button", { name: "回到底部" }).click()
    await expect(latestMessage).toBeInViewport()
    await expectVisibleHighlights()
    expect(await mountedMessages.count()).toBeLessThan(30)
    await expectNoHorizontalOverflow(page)
    expect(requests).toHaveLength(3)
    expect(pageErrors).toEqual([])
    const reportPath = `../../output/playwright/history-global-nav-${viewport.name}.json`
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          viewport,
          requests,
          uniqueMessages: deliveredIds.size,
          navigationItems: await navigation.getByRole("button").count(),
          highlightedMessageIds,
          mountedMessages: await mountedMessages.count(),
          pageErrors,
        },
        null,
        2
      )
    )
    await testInfo.attach("history-pagination", {
      path: reportPath,
      contentType: "application/json",
    })
  })
}

test("long task follows new content without interrupting historical reading", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/conversations/20000000-0000-4000-8000-000000000001")

  const conversationScroll = page.locator(".conversation-scroll")
  const conversationColumn = page.locator(".conversation-column")
  const scrollToBottom = page.getByRole("button", { name: "回到底部" })
  const composer = page.locator(".composer-shell")
  const distanceFromBottom = () =>
    conversationScroll.evaluate((element) =>
      Math.max(
        0,
        element.scrollHeight - element.clientHeight - element.scrollTop
      )
    )
  const setConversationHeight = async (height: number) => {
    await conversationColumn.evaluate((element, nextHeight) => {
      element.style.minHeight = `${nextHeight}px`
    }, height)
    await expect
      .poll(() =>
        conversationColumn.evaluate(
          (element) => element.getBoundingClientRect().height
        )
      )
      .toBeGreaterThanOrEqual(height)
  }
  const wheelUp = async () => {
    const box = await conversationScroll.boundingBox()
    expect(box).not.toBeNull()
    if (!box) return
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -900)
  }
  const expectButtonAboveComposer = async () => {
    const [buttonBox, composerBox] = await Promise.all([
      scrollToBottom.boundingBox(),
      composer.boundingBox(),
    ])
    expect(buttonBox).not.toBeNull()
    expect(composerBox).not.toBeNull()
    if (!buttonBox || !composerBox) return
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(composerBox.y)
  }

  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2)
  await setConversationHeight(4_200)
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2)

  await wheelUp()
  await expect.poll(distanceFromBottom).toBeGreaterThan(500)
  await expect(scrollToBottom).toBeVisible()
  await expect(scrollToBottom).toHaveClass(
    /conversation-scroll-to-bottom-button/u
  )
  await expect(scrollToBottom).toHaveCSS("width", "36px")
  await expect(scrollToBottom).toHaveCSS("height", "36px")
  await expectButtonAboveComposer()

  const historicalScrollTop = await conversationScroll.evaluate(
    (element) => element.scrollTop
  )
  await setConversationHeight(4_800)
  expect(
    await conversationScroll.evaluate(
      (element, previousScrollTop) =>
        Math.abs(element.scrollTop - previousScrollTop),
      historicalScrollTop
    )
  ).toBeLessThanOrEqual(2)
  await expect(scrollToBottom).toBeVisible()

  await scrollToBottom.click()
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2)
  await expect(scrollToBottom).toBeHidden()

  await setConversationHeight(5_400)
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2)
  await expect(scrollToBottom).toBeHidden()

  await page.setViewportSize({ width: 320, height: 568 })
  await page.getByRole("button", { name: "关闭任务概览" }).click()
  await expect.poll(distanceFromBottom).toBeLessThanOrEqual(2)
  await wheelUp()
  await expect.poll(distanceFromBottom).toBeGreaterThan(500)
  await expect(scrollToBottom).toBeVisible()
  await expectButtonAboveComposer()
  await expectNoHorizontalOverflow(page)
})

test("composer aligns with the message container and uses a subtle border", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/conversations/20000000-0000-4000-8000-000000000001")

  const conversationColumn = page.locator(".conversation-column")
  const composer = page.locator(".composer-shell")
  const [conversationColumnBox, composerBox] = await Promise.all([
    conversationColumn.boundingBox(),
    composer.boundingBox(),
  ])

  expect(conversationColumnBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(
    Math.abs(conversationColumnBox!.x - composerBox!.x)
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(conversationColumnBox!.width - composerBox!.width)
  ).toBeLessThanOrEqual(1)
  await expect(composer).toHaveCSS("border-top-width", "1px")
  await expect(composer).toHaveCSS("border-top-color", "rgba(32, 32, 32, 0.1)")
})

test("user and assistant messages use consistent typography and radius", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/conversations/20000000-0000-4000-8000-000000000001")

  await expect(page.locator(".conversation-top-bar h1")).toHaveCSS(
    "font-weight",
    "500"
  )
  const userMessage = page.getByRole("article", { name: "用户消息" }).first()
  const userMessageContent = userMessage.locator(".message-content")
  await expect(userMessageContent).toHaveCSS("font-weight", "500")
  await expect(userMessageContent).toHaveCSS("border-radius", "12px")
  const userMessageBox = await userMessageContent.boundingBox()
  expect(userMessageBox).not.toBeNull()
  expect(userMessageBox!.height).toBeLessThanOrEqual(48)
  const copyAction = userMessage.getByRole("button", { name: "复制消息" })
  const copyIcon = copyAction.locator("svg")
  await expect(copyAction).toHaveCSS("width", "28px")
  await expect(copyAction).toHaveCSS("height", "28px")
  await expect(copyIcon).toHaveCSS("width", "12px")
  await expect(copyIcon).toHaveCSS("height", "12px")
  await expect(copyIcon).toHaveAttribute("stroke-width", "1.5")
  await expect(
    page
      .getByRole("article", { name: "助手回复" })
      .first()
      .locator(".assistant-markdown")
  ).toHaveCSS("font-weight", "500")

  const titleActionsButton = page
    .locator(".conversation-title-actions")
    .getByRole("button", { name: "操作" })
  const titleActionsIcon = titleActionsButton.locator("svg")
  await expect(titleActionsIcon).toHaveCSS("color", "rgb(98, 98, 98)")
  await expect(titleActionsIcon).toHaveCSS("opacity", "0.7")
  await titleActionsButton.click()
  const archiveIcon = page
    .getByRole("menuitem", { name: "归档任务" })
    .locator("svg")
  const deleteIcon = page
    .getByRole("menuitem", { name: "删除任务" })
    .locator("svg")
  await expect(archiveIcon).toHaveCSS("width", "14px")
  await expect(archiveIcon).toHaveCSS("color", "rgb(98, 98, 98)")
  await expect(archiveIcon).toHaveCSS("opacity", "0.7")
  await expect(deleteIcon).toHaveCSS("width", "14px")
  await expect(deleteIcon).toHaveCSS("opacity", "0.7")
})

test("user message editor uses a shorter borderless light surface", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000004"
  await mockEditableConversation(page, conversationId)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)
  await page.getByRole("button", { name: "关闭任务概览" }).click()

  const userMessage = page.getByRole("article", { name: "用户消息" })
  const editAction = userMessage.getByRole("button", { name: "编辑消息" })
  const editIcon = editAction.locator("svg")
  await expect(editAction).toHaveCSS("width", "28px")
  await expect(editAction).toHaveCSS("height", "28px")
  await expect(editIcon).toHaveCSS("width", "12px")
  await expect(editIcon).toHaveCSS("height", "12px")
  await expect(editIcon).toHaveAttribute("stroke-width", "1.5")
  await userMessage.hover()
  await editAction.click()

  const editorSurface = userMessage.locator(".message-content")
  const editor = userMessage.getByRole("textbox", { name: "编辑消息内容" })
  await expect(editorSurface).toHaveCSS(
    "background-color",
    "rgb(248, 248, 248)"
  )
  await expect(editorSurface).toHaveCSS("border-top-width", "0px")
  await expect(editor).toHaveCSS("min-height", "72px")
  await expect(editor).toHaveCSS("border-top-width", "0px")
  await expect(editor).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")

  const editorSurfaceBox = await editorSurface.boundingBox()
  expect(editorSurfaceBox).not.toBeNull()
  expect(editorSurfaceBox!.height).toBeLessThanOrEqual(140)
})

test("assistant artifact cards use a transparent surface with hover feedback", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000003"
  const turnId = "turn-artifact-card"
  const filename = "500名学生模拟数据.xlsx"
  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "学生数据生成",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: "message-artifact-request",
          role: "user",
          turn_id: turnId,
          content: "生成学生模拟数据",
          created_at: NOW,
        },
        {
          id: "message-artifact-answer",
          role: "assistant",
          turn_id: turnId,
          item_id: "agent-artifact-answer",
          phase: "final_answer",
          event_sequence_no: 2,
          content: "已生成并登记可下载的 Excel。",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [
        {
          id: "artifact-card-file",
          filename,
          mime_type:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size_bytes: 90_522,
          kind: "artifact",
          turn_id: turnId,
          status: "available",
          created_at: NOW,
          downloadable: true,
        },
      ],
      events: [],
      activities: [],
    })
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)

  const artifactCard = page
    .getByRole("article", { name: "助手回复" })
    .getByRole("button", { name: `下载 ${filename}` })
  await expect(artifactCard).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(artifactCard).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(artifactCard).toHaveCSS("border-top-width", "1px")
  await expect(artifactCard).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)")

  await artifactCard.hover()
  // The shared ghost button transitions to the theme hover color. Checking
  // transparency immediately after hover could pass before that transition.
  await expect(artifactCard).toHaveCSS(
    "background-color",
    "rgba(32, 32, 32, 0.04)"
  )
  await page.mouse.move(0, 0)
  await expect(artifactCard).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
})

test("read-only code artifacts open in the preview pane without annotation controls", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000020"
  const turnId = "turn-code-preview"
  const fileId = "artifact-code-file"
  const filename = "server.ts"
  const content = "export const previewReady = true\n"

  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/files/${fileId}/content`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: content,
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "代码文件预览",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: "message-code-request",
          role: "user",
          turn_id: turnId,
          content: "生成 TypeScript 示例",
          created_at: NOW,
        },
        {
          id: "message-code-answer",
          role: "assistant",
          turn_id: turnId,
          item_id: "agent-code-answer",
          phase: "final_answer",
          event_sequence_no: 2,
          content: "已生成可预览的代码文件。",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [
        {
          id: fileId,
          filename,
          mime_type: "text/plain",
          size_bytes: content.length,
          kind: "artifact",
          turn_id: turnId,
          status: "available",
          created_at: NOW,
          downloadable: true,
        },
      ],
      events: [],
      activities: [],
    })
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)
  await page.getByRole("button", { name: `预览文件 ${filename}` }).click()

  const preview = page.getByLabel(`预览文档 ${filename}`)
  await expect(preview.getByTestId("code-file-preview")).toBeVisible()
  await expect(preview.locator(".cm-content")).toContainText(
    "export const previewReady = true"
  )
  await expect(preview.getByRole("button", { name: "自动换行" })).toBeVisible()
  await expect(preview.getByText("问 LinkSense")).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test("audio artifacts use a short-lived source preview without annotation controls", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000021"
  const turnId = "turn-audio-preview"
  const fileId = "artifact-audio-file"
  const filename = "briefing.wav"
  const previewUrl = "http://127.0.0.1:4173/artifact-audio.wav"
  const wav = Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x25, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x40, 0x1f, 0x00, 0x00, 0x40, 0x1f, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x01, 0x00, 0x00, 0x00, 0x80,
  ])

  await page.route("**/artifact-audio.wav", (route) =>
    route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: wav,
    })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/files/${fileId}/preview`,
    (route) =>
      ok(route, {
        url: previewUrl,
        expires_at: "2099-07-14T10:49:00.000Z",
        filename,
      })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "音频文件预览",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: "message-audio-request",
          role: "user",
          turn_id: turnId,
          content: "生成音频摘要",
          created_at: NOW,
        },
        {
          id: "message-audio-answer",
          role: "assistant",
          turn_id: turnId,
          item_id: "agent-audio-answer",
          phase: "final_answer",
          event_sequence_no: 2,
          content: "已生成可播放的音频文件。",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [
        {
          id: fileId,
          filename,
          mime_type: "audio/wav",
          size_bytes: wav.byteLength,
          kind: "artifact",
          turn_id: turnId,
          status: "available",
          created_at: NOW,
          downloadable: true,
        },
      ],
      events: [],
      activities: [],
    })
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)
  await page.getByRole("button", { name: `预览文件 ${filename}` }).click()

  const preview = page.getByLabel(`预览文档 ${filename}`)
  const audio = preview.getByTestId("audio-file-preview").locator("audio")
  await expect(audio).toBeVisible()
  await expect(audio).toHaveAttribute("preload", "metadata")
  await expect(audio.locator("source")).toHaveAttribute("src", previewUrl)
  await expect(preview.getByText("问 LinkSense")).toHaveCount(0)
})

test("ZIP artifacts open a safe, navigable directory preview", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000019"
  const turnId = "turn-archive-preview"
  const fileId = "artifact-archive-file"
  const filename = "项目资料.zip"
  const zip = new JSZip()
  zip.file("README.md", "Archive preview")
  zip.file("docs/guide.txt", "Guide")
  const archive = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  })

  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/files/${fileId}/content`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/zip",
        body: Buffer.from(archive),
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "压缩包预览",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: "message-archive-request",
          role: "user",
          turn_id: turnId,
          content: "生成压缩包",
          created_at: NOW,
        },
        {
          id: "message-archive-answer",
          role: "assistant",
          turn_id: turnId,
          item_id: "agent-archive-answer",
          phase: "final_answer",
          event_sequence_no: 2,
          content: "已生成可下载的压缩包。",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [
        {
          id: fileId,
          filename,
          mime_type: "application/zip",
          size_bytes: archive.byteLength,
          kind: "artifact",
          turn_id: turnId,
          status: "available",
          created_at: NOW,
          downloadable: true,
        },
      ],
      events: [],
      activities: [],
    })
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)
  await page.getByRole("button", { name: `预览压缩包 ${filename}` }).click()

  const preview = page.getByLabel(`预览文档 ${filename}`)
  await expect(preview.getByText("2 个文件 · 1 个文件夹")).toBeVisible()
  await expect(preview.locator(".archive-preview-list")).toContainText(
    "README.md"
  )
  await preview
    .locator(".archive-preview-list")
    .getByRole("button", { name: "docs" })
    .click()
  await expect(preview.locator(".archive-preview-list")).toContainText(
    "guide.txt"
  )
})

test("assistant image artifacts show a thumbnail and open the shared preview", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000005"
  const turnId = "turn-image-artifact"
  const fileId = "artifact-image-file"
  const filename = "小狗和可乐.png"
  const previewUrl = "http://127.0.0.1:4173/artifact-preview.png"
  await page.route("**/artifact-preview.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      ),
    })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/files/${fileId}/preview`,
    (route) =>
      ok(route, {
        url: previewUrl,
        expires_at: "2099-07-14T10:49:00.000Z",
        filename,
      })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/files/${fileId}/download`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/png",
        headers: {
          "content-disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        },
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64"
        ),
      })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "图片产物预览",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: "message-image-request",
          role: "user",
          turn_id: turnId,
          content: "生成一张图片",
          created_at: NOW,
        },
        {
          id: "message-image-answer",
          role: "assistant",
          turn_id: turnId,
          item_id: "agent-image-answer",
          phase: "final_answer",
          event_sequence_no: 2,
          content: "图片已生成。",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [
        {
          id: fileId,
          filename,
          mime_type: "image/png",
          size_bytes: 235_520,
          kind: "artifact",
          turn_id: turnId,
          status: "available",
          created_at: NOW,
          downloadable: true,
        },
      ],
      events: [],
      activities: [],
    })
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)

  const card = page.locator(".artifact-image-tile")
  await expect(card).toBeVisible()
  await expect(card).toContainText(filename)
  await expect(card).toContainText(/230\s*kB/u)
  await expect(
    card.getByRole("button", { name: `下载 ${filename}` })
  ).toBeVisible()
  const thumbnail = card.getByRole("button", { name: `预览图片 ${filename}` })
  await expect(thumbnail.locator("img")).toHaveAttribute("src", previewUrl)

  const cardBox = await card.boundingBox()
  const thumbnailBox = await thumbnail.boundingBox()
  const metadataBox = await card
    .locator(".file-tile-name")
    .locator("..")
    .boundingBox()
  const download = card.getByRole("button", { name: `下载 ${filename}` })
  const downloadBox = await download.boundingBox()
  const assistantMessageBox = await page
    .getByRole("article", { name: "助手回复" })
    .last()
    .boundingBox()
  expect(cardBox).not.toBeNull()
  expect(thumbnailBox).not.toBeNull()
  expect(metadataBox).not.toBeNull()
  expect(downloadBox).not.toBeNull()
  expect(assistantMessageBox).not.toBeNull()
  if (
    cardBox &&
    thumbnailBox &&
    metadataBox &&
    downloadBox &&
    assistantMessageBox
  ) {
    const cardCenter = cardBox.y + cardBox.height / 2
    expect(cardBox.height).toBeLessThanOrEqual(78)
    expect(
      Math.abs(thumbnailBox.y + thumbnailBox.height / 2 - cardCenter)
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(metadataBox.y + metadataBox.height / 2 - cardCenter)
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(downloadBox.y + downloadBox.height / 2 - cardCenter)
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(
        assistantMessageBox.y +
          assistantMessageBox.height -
          (cardBox.y + cardBox.height)
      )
    ).toBeLessThanOrEqual(2)
  }

  await thumbnail.click()
  const preview = page.getByRole("region", { name: `预览文档 ${filename}` })
  await expect(preview.getByRole("img", { name: filename })).toBeVisible()
  await expect(
    preview.getByRole("button", { name: `下载文档 ${filename}` })
  ).toBeVisible()
  await preview.getByRole("button", { name: "关闭文档预览" }).click()
  await expect(preview).toBeHidden()

  const downloadPromise = page.waitForEvent("download")
  await download.click()
  const downloadedArtifact = await downloadPromise
  expect(downloadedArtifact.suggestedFilename()).toBe(filename)

  await page.setViewportSize({ width: 320, height: 568 })
  await expect(card).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test("assistant inline images use authenticated previews and never request server-local paths", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000015"
  const turnId = "turn-inline-image"
  const fileId = "40000000-0000-4000-8000-000000000015"
  const filename = "风格参考.png"
  const previewUrl = "http://127.0.0.1:4173/inline-image-preview.png"
  const serverLocalRequests: string[] = []
  let previewRequestCount = 0

  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/data/linksense/")) {
      serverLocalRequests.push(request.url())
    }
  })
  await page.route("**/inline-image-preview.png", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      ),
    })
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/files/${fileId}/preview`,
    (route) => {
      previewRequestCount += 1
      return ok(route, {
        url: previewUrl,
        expires_at: "2099-07-14T10:49:00.000Z",
        filename,
      })
    }
  )
  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "消息内图片预览",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: "message-inline-image-request",
          role: "user",
          turn_id: turnId,
          content: "展示生成的风格参考图",
          created_at: NOW,
        },
        {
          id: "message-inline-image-answer",
          role: "assistant",
          turn_id: turnId,
          item_id: "agent-inline-image-answer",
          phase: "final_answer",
          event_sequence_no: 2,
          content:
            `已生成：\n\n![风格参考](linksense-artifact:${fileId})\n\n` +
            "![旧路径](/data/linksense/codex-homes/private/theme.png)",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [
        {
          id: fileId,
          filename,
          mime_type: "image/png",
          size_bytes: 128,
          kind: "artifact",
          turn_id: turnId,
          status: "available",
          created_at: NOW,
          downloadable: true,
        },
      ],
      events: [],
      activities: [],
    })
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)

  await expect(page.getByRole("img", { name: "风格参考" })).toHaveAttribute(
    "src",
    previewUrl
  )
  await expect(
    page.getByRole("img", { name: "无法预览图片 旧路径" })
  ).toBeVisible()
  await expect(page.locator(".artifact-image-tile")).toHaveCount(0)
  expect(previewRequestCount).toBe(1)
  expect(serverLocalRequests).toEqual([])
})

test("expanded activity labels use compact medium typography", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/conversations/20000000-0000-4000-8000-000000000001")

  const summary = page.getByTestId("turn-summary-turn-1")
  await summary.getByRole("button", { name: "展开中间过程" }).click()
  const activityLabel = summary.getByText("工具调用已完成")
  await expect(activityLabel).toBeVisible()
  await expect(activityLabel).toHaveCSS("font-size", "14px")
  await expect(activityLabel).toHaveCSS("font-weight", "500")
  await expect(activityLabel).toHaveCSS("line-height", "20px")
  await expect(
    summary
      .locator(".activity-item-main")
      .filter({ hasText: "工具调用已完成" })
      .locator("svg")
  ).toHaveClass(/size-3\.5/)
})

test("expanded command detail wraps long commands safely", async ({ page }) => {
  const conversationId = "30000000-0000-4000-8000-000000000003"
  const command =
    "rsvg-convert -w 1400 -h 1000 temp/puppy_cola.svg -o artifacts/puppy_cola.png && file artifacts/puppy_cola.png && ls -lh artifacts/puppy_cola.png"
  const turnId = await mockNativeCommandConversation(
    page,
    conversationId,
    command
  )
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto(`/conversations/${conversationId}`)

  const summary = page.getByTestId(`turn-summary-${turnId}`)
  await summary.getByRole("button", { name: "展开中间过程" }).click()
  await summary
    .getByRole("button", {
      name: "展开“运行了一个命令”的详情",
    })
    .click()

  const detailRow = summary
    .locator(".native-activity-detail-lines > li")
    .filter({ hasText: command })
    .first()
  await expect(detailRow).toBeVisible()

  const alignment = await detailRow.evaluate((element) => {
    const text = element.querySelector<HTMLElement>(":scope > code")
    if (!text) throw new Error("Missing command detail content")

    const textRect = text.getBoundingClientRect()
    const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight)
    return {
      lineHeight,
      overflowWrap: getComputedStyle(text).overflowWrap,
      textHeight: textRect.height,
    }
  })

  expect(alignment.textHeight).toBeGreaterThan(alignment.lineHeight)
  expect(alignment.overflowWrap).toBe("anywhere")
})

test("commentary stays prominent until the final answer starts", async ({
  page,
}) => {
  const liveConversationId = "30000000-0000-4000-8000-000000000001"
  const finalConversationId = "30000000-0000-4000-8000-000000000002"
  await mockCommentaryConversation(page, liveConversationId, false)
  await mockCommentaryConversation(page, finalConversationId, true)

  await page.goto(`/conversations/${liveConversationId}`)
  const liveCommentary = page
    .locator(".process-commentary")
    .filter({ hasText: "正在检查演示文稿" })
    .locator(".assistant-markdown")
  await expect(liveCommentary).toHaveCSS("color", "rgb(32, 32, 32)")
  await expect(liveCommentary).toHaveCSS("font-weight", "500")

  await page.goto(`/conversations/${finalConversationId}`)
  const settledCommentary = page
    .locator(".process-commentary")
    .filter({ hasText: "正在检查演示文稿" })
    .locator(".assistant-markdown")
  await expect(settledCommentary).toHaveCSS("color", "rgb(98, 98, 98)")
  await expect(settledCommentary).toHaveCSS("font-weight", "500")

  const finalAnswer = page
    .getByRole("article", { name: "助手回复" })
    .locator(".assistant-markdown")
  await expect(finalAnswer).toHaveCSS("color", "rgb(32, 32, 32)")
  await expect(finalAnswer).toHaveCSS("font-weight", "500")
})

test("consecutive commentary paragraphs use a compact vertical rhythm", async ({
  page,
}) => {
  const conversationId = "30000000-0000-4000-8000-000000000006"
  await mockCommentaryConversation(page, conversationId, false)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/conversations/${conversationId}`)

  const commentary = page.locator(".process-commentary")
  await expect(commentary).toHaveCount(2)
  const firstBox = await commentary.nth(0).boundingBox()
  const secondBox = await commentary.nth(1).boundingBox()
  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  if (firstBox && secondBox) {
    const gap = secondBox.y - (firstBox.y + firstBox.height)
    expect(gap).toBeGreaterThanOrEqual(7.5)
    expect(gap).toBeLessThanOrEqual(8.5)
  }
})

test("settings navigation has no item dividers while tables and menus keep necessary dividers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/admin/roles")
  const table = page.locator('[data-slot="table"]').first()
  const headerCell = table.locator('[data-slot="table-head"]').first()
  const bodyCells = table.locator('[data-slot="table-cell"]')

  for (const cell of [headerCell, bodyCells.first()]) {
    const divider = await cell.evaluate((element) => {
      const style = window.getComputedStyle(element, "::after")
      return {
        backgroundColor: style.backgroundColor,
        height: style.height,
      }
    })
    expect(divider).toEqual({
      backgroundColor: "rgba(32, 32, 32, 0.06)",
      height: "0.5px",
    })
  }
  expect(
    await bodyCells
      .last()
      .evaluate(
        (element) => window.getComputedStyle(element, "::after").display
      )
  ).toBe("none")

  const settingsSidebar = page.getByRole("complementary", { name: "设置导航" })
  const personalNavigation = settingsSidebar.getByRole("navigation", {
    name: "个人",
  })
  const administrationNavigation = settingsSidebar.getByRole("navigation", {
    name: "管理",
  })
  for (const navigation of [personalNavigation, administrationNavigation]) {
    await expect(navigation).toHaveCSS("row-gap", "2px")
    await expect(navigation).toHaveCSS("border-top-width", "0px")
    await expect(navigation).toHaveCSS("border-radius", "0px")
    await expect(navigation).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  }
  const activeLink = administrationNavigation.getByRole("link", {
    name: /角色与权限/,
  })
  await expect(activeLink).toHaveCSS("border-radius", "9px")
  await expect(activeLink).toHaveCSS(
    "background-color",
    "rgba(32, 32, 32, 0.08)"
  )
  expect(
    await settingsSidebar
      .locator(".settings-navigation-link")
      .evaluateAll((links) =>
        links.map((link) => window.getComputedStyle(link).backgroundImage)
      )
  ).toEqual(expect.arrayContaining(["none"]))
  expect(
    await settingsSidebar
      .locator(".settings-navigation-link")
      .evaluateAll((links) =>
        links.every(
          (link) => window.getComputedStyle(link).backgroundImage === "none"
        )
      )
  ).toBe(true)

  await page.goto("/conversations/new")
  await page.getByRole("button", { name: "Eli", exact: true }).click()
  const menuSeparator = page
    .locator('[data-slot="dropdown-menu-separator"]')
    .first()
  await expect(menuSeparator).toHaveCSS("height", "0.5px")
  await expect(menuSeparator).toHaveCSS(
    "background-color",
    "rgba(32, 32, 32, 0.06)"
  )
})

test("settings exposes the administrator-only management section", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/conversations/new")
  await page.getByRole("button", { name: "Eli", exact: true }).click()
  await expect(page.getByRole("menuitem", { name: "管理中心" })).toHaveCount(0)
  await page.getByRole("menuitem", { name: "设置" }).click()

  await expect(page).toHaveURL(/\/settings\/general$/u)
  await expect(
    page.getByRole("complementary", { name: "设置导航" })
  ).toBeVisible()
  await expect(page.getByRole("link", { name: /用户与用户组/ })).toBeVisible()
  await expect(
    page.getByRole("complementary", { name: "LinkSense 导航" })
  ).toHaveCount(0)
})

test("personal credential management remains inside the settings shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/settings/credentials")

  const settingsSidebar = page.getByRole("complementary", { name: "设置导航" })
  const credentialLink = settingsSidebar.getByRole("link", {
    name: "插件凭据",
    exact: true,
  })
  await expect(settingsSidebar).toBeVisible()
  await expect(credentialLink).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("complementary", { name: "LinkSense 导航" })
  ).toHaveCount(0)
  await expect(page).toHaveURL(/\/settings\/credentials$/u)
  await expect(
    page.getByRole("heading", { name: "插件凭据", exact: true })
  ).toBeVisible()
  await expect(settingsSidebar).toBeVisible()
  await expect(credentialLink).toHaveAttribute("aria-current", "page")
  await expect(
    page.getByRole("complementary", { name: "LinkSense 导航" })
  ).toHaveCount(0)

  await page.goto("/credentials")
  await expect(page).toHaveURL(/\/settings\/credentials$/u)
  await expect(
    page.getByRole("complementary", { name: "设置导航" })
  ).toBeVisible()
  await expect(
    page.getByRole("complementary", { name: "LinkSense 导航" })
  ).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test("credential editor uses a wider aligned desktop grid", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/settings/credentials")
  await page
    .locator(".management-actions")
    .getByRole("button", { name: "新增凭据" })
    .click()

  const dialog = page.getByRole("dialog", { name: "新增凭据" })
  await dialog.getByRole("button", { name: "添加配置项" }).click()
  const metrics = await dialog.evaluate((element) => {
    const dialogRect = element.getBoundingClientRect()
    const rows = Array.from(
      element.querySelectorAll<HTMLElement>(
        '[data-slot="credential-secret-row"]'
      )
    )
    return {
      dialogWidth: dialogRect.width,
      rows: rows.map((row) => {
        const rowRect = row.getBoundingClientRect()
        const inputs = row.querySelectorAll<HTMLInputElement>("input")
        const removeButton = row.querySelector<HTMLButtonElement>("button")
        const key = inputs[0]?.getBoundingClientRect()
        const secret = inputs[1]?.getBoundingClientRect()
        const remove = removeButton?.getBoundingClientRect()
        return {
          key: key && {
            x: key.x,
            y: key.y,
            width: key.width,
            height: key.height,
          },
          secret: secret && {
            x: secret.x,
            y: secret.y,
            width: secret.width,
            height: secret.height,
          },
          remove: remove && {
            x: remove.x,
            y: remove.y,
            width: remove.width,
            height: remove.height,
            right: remove.right,
            ariaLabel: removeButton?.getAttribute("aria-label"),
            text: removeButton?.textContent?.trim(),
            iconCount: removeButton?.querySelectorAll("svg").length,
          },
          rowRight: rowRect.right,
        }
      }),
    }
  })

  expect(metrics.dialogWidth).toBeGreaterThanOrEqual(640)
  expect(metrics.dialogWidth).toBeLessThanOrEqual(680)
  expect(metrics.rows).toHaveLength(2)
  for (const row of metrics.rows) {
    expect(row.key).toBeDefined()
    expect(row.secret).toBeDefined()
    expect(row.remove).toBeDefined()
    if (!row.key || !row.secret || !row.remove) continue
    expect(Math.abs(row.key.y - row.secret.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(row.key.y - row.remove.y)).toBeLessThanOrEqual(1)
    expect(row.remove.x).toBeGreaterThan(row.secret.x + row.secret.width)
    expect(Math.abs(row.remove.right - row.rowRight)).toBeLessThanOrEqual(1)
    expect(row.remove.ariaLabel).toBe("移除此配置项")
    expect(row.remove.text).toBe("")
    expect(row.remove.iconCount).toBe(1)
  }
  expect(
    Math.abs(metrics.rows[0]!.key!.x - metrics.rows[1]!.key!.x)
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(metrics.rows[0]!.secret!.x - metrics.rows[1]!.secret!.x)
  ).toBeLessThanOrEqual(1)
})

test("credential editor stacks secret fields safely on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await page.goto("/settings/credentials")
  await page
    .locator(".management-actions")
    .getByRole("button", { name: "新增凭据" })
    .click()

  const dialog = page.getByRole("dialog", { name: "新增凭据" })
  await dialog.getByRole("button", { name: "添加配置项" }).click()
  const metrics = await dialog.evaluate((element) => {
    const dialogRect = element.getBoundingClientRect()
    const rows = Array.from(
      element.querySelectorAll<HTMLElement>(
        '[data-slot="credential-secret-row"]'
      )
    )
    return {
      width: dialogRect.width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      rows: rows.map((row) => {
        const rowRect = row.getBoundingClientRect()
        const inputs = row.querySelectorAll<HTMLInputElement>("input")
        const removeButton = row.querySelector<HTMLButtonElement>("button")
        const key = inputs[0]?.getBoundingClientRect()
        const secret = inputs[1]?.getBoundingClientRect()
        const remove = removeButton?.getBoundingClientRect()
        return {
          keyBottom: key?.bottom,
          secretTop: secret?.top,
          removeRight: remove?.right,
          rowRight: rowRect.right,
        }
      }),
    }
  })

  expect(metrics.width).toBeLessThanOrEqual(288)
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1)
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  expect(metrics.overflowY).toBe("auto")
  expect(metrics.rows).toHaveLength(2)
  for (const row of metrics.rows) {
    expect(row.keyBottom).toBeDefined()
    expect(row.secretTop).toBeDefined()
    if (row.keyBottom === undefined || row.secretTop === undefined) continue
    expect(row.secretTop).toBeGreaterThan(row.keyBottom)
    expect(row.removeRight).toBeDefined()
    if (row.removeRight !== undefined) {
      expect(Math.abs(row.removeRight - row.rowRight)).toBeLessThanOrEqual(1)
    }
  }
})

test("user management table vertically centers data cells", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/admin/users")

  await expect(
    page.getByRole("heading", { name: "用户与用户组", exact: true })
  ).toBeVisible()
  const userRow = page.getByRole("row").filter({ hasText: ADMIN.email })
  const dataCells = userRow.getByRole("cell")
  await expect(dataCells).toHaveCount(12)
  expect(
    await dataCells.evaluateAll((cells) =>
      cells
        .slice(1, -1)
        .every((cell) => getComputedStyle(cell).verticalAlign === "middle")
    )
  ).toBe(true)

  const roleCellCenterOffset = await dataCells.nth(1).evaluate((cell) => {
    const range = document.createRange()
    range.selectNodeContents(cell)
    const textRect = range.getBoundingClientRect()
    const cellRect = cell.getBoundingClientRect()
    return Math.abs(
      (textRect.top + textRect.bottom - cellRect.top - cellRect.bottom) / 2
    )
  })
  expect(roleCellCenterOffset).toBeLessThanOrEqual(1)
})

test("user editor protects the current administrator's group membership", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/admin/users")
  await page.getByRole("button", { name: "编辑" }).click()

  const dialog = page.getByRole("dialog", { name: "编辑用户" })
  await expect(
    dialog.getByRole("combobox", { name: "所属用户组" })
  ).toBeDisabled()
  await expect(dialog.getByRole("combobox", { name: "状态" })).toBeDisabled()
})

test("role summaries use aligned responsive rows without the fixed-role notice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/admin/roles")

  await expect(
    page.getByRole("heading", { name: "角色与权限", exact: true })
  ).toBeVisible()
  await expect(page.getByText(/LinkSense 仅有 user 与 admin/)).toHaveCount(0)

  const cards = page.locator(".role-summary")
  const accountCounts = page.locator(".role-account-count")
  await expect(cards).toHaveCount(2)
  await expect(accountCounts).toHaveCount(2)
  const [cardBoxes, contentTopInsets, countBoxes] = await Promise.all([
    cards.evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height }
      })
    ),
    cards.evaluateAll((items) =>
      items.map((item) => {
        const heading = item.querySelector("h2")
        if (!heading) throw new Error("Role heading is missing")
        return (
          heading.getBoundingClientRect().top - item.getBoundingClientRect().top
        )
      })
    ),
    accountCounts.evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect()
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, height: box.height }
      })
    ),
  ])
  expect(cardBoxes[0].bottom).toBeLessThanOrEqual(cardBoxes[1].top)
  expect(
    Math.abs(cardBoxes[0].left - cardBoxes[1].left)
  ).toBeLessThanOrEqual(1)
  expect(
    Math.abs(contentTopInsets[0] - contentTopInsets[1])
  ).toBeLessThanOrEqual(1)
  expect(Math.abs(countBoxes[0].right - countBoxes[1].right)).toBeLessThanOrEqual(1)
  for (const [index, count] of countBoxes.entries()) {
    expect(count.top).toBeGreaterThanOrEqual(cardBoxes[index].top)
    expect(count.bottom).toBeLessThanOrEqual(cardBoxes[index].bottom)
  }

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileCardMetrics = await cards.evaluateAll((items) =>
    items.map((item) => {
      const cardBox = item.getBoundingClientRect()
      const accountCount = item.querySelector(".role-account-count")
      if (!accountCount) throw new Error("Role account count is missing")
      const countBox = accountCount.getBoundingClientRect()
      return {
        height: cardBox.height,
        countBottomInset: cardBox.bottom - countBox.bottom,
      }
    })
  )
  for (const card of mobileCardMetrics) {
    expect(card.height).toBeGreaterThan(0)
    expect(card.countBottomInset).toBeGreaterThanOrEqual(0)
  }
  await expectNoHorizontalOverflow(page)
  expect(
    Math.abs(
      mobileCardMetrics[0].countBottomInset -
        mobileCardMetrics[1].countBottomInset
    )
  ).toBeLessThanOrEqual(1)
})

test("audit settings remain usable without page-level horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto("/admin/audit")
  await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible()
  await expect(page.getByText("已导出审计日志")).toBeVisible()
  await expect(page.getByRole("alert")).toHaveCount(0)
  await expect(page.getByText(/此页只展示跨用户元数据/)).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test("audit table does not render the user-agent column or value", async ({
  page,
}) => {
  await page.route("**/api/v1/admin/audit*", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          items: [
            {
              id: "audit-with-user-agent",
              actor_name: "One.Liu",
              action: "user_profile_updated",
              target_type: "user",
              target_id: "user-1",
              result: "success",
              error_code: null,
              source_ip: "127.0.0.1",
              user_agent: AUDIT_USER_AGENT,
              metadata: {},
              created_at: NOW,
            },
          ],
          next_cursor: null,
        },
      }),
    })
  )
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/admin/audit")

  await expect(page.getByText("已更新个人资料")).toBeVisible()
  await expect(
    page.getByRole("columnheader", { name: "User-Agent" })
  ).toHaveCount(0)
  await expect(page.getByText(AUDIT_USER_AGENT, { exact: true })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test("audit error banner vertically centers its icon, copy, and retry action", async ({
  page,
}) => {
  await page.route("**/api/v1/admin/audit*", async (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error_code: "NETWORK_UNAVAILABLE",
        message_key: "errors.networkUnavailable",
      }),
    })
  )
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/admin/audit")

  const alert = page.getByRole("alert")
  await expect(alert).toContainText("无法连接服务，请检查网络后重试。")
  const [alertBox, iconBox, descriptionBox, actionBox] = await Promise.all([
    alert.boundingBox(),
    alert.locator("svg").first().boundingBox(),
    alert.locator('[data-slot="alert-description"]').boundingBox(),
    alert.getByRole("button", { name: "重试" }).boundingBox(),
  ])

  expect(alertBox).not.toBeNull()
  expect(iconBox).not.toBeNull()
  expect(descriptionBox).not.toBeNull()
  expect(actionBox).not.toBeNull()
  if (!alertBox || !iconBox || !descriptionBox || !actionBox) return

  const alertCenter = alertBox.y + alertBox.height / 2
  for (const box of [iconBox, descriptionBox, actionBox]) {
    expect(Math.abs(box.y + box.height / 2 - alertCenter)).toBeLessThanOrEqual(
      1
    )
  }
})

test("system health hides internal infrastructure component rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await page.goto("/admin/health")

  await expect(
    page.getByRole("heading", { name: "系统健康状态" })
  ).toBeVisible()
  const refreshButton = page.getByRole("button", { name: "刷新" })
  await expect(refreshButton).toHaveCSS("width", "28px")
  await expect(refreshButton).toHaveCSS("height", "28px")
  await expect(refreshButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
  await expect(refreshButton).toHaveText("")
  await expect(
    page.getByText("只读查看 LinkSense 服务与受控目录的健康摘要。")
  ).toBeVisible()
  for (const visible of ["API 服务", "数据库", "Runner", "工作区根目录"]) {
    await expect(page.getByRole("heading", { name: visible })).toBeVisible()
  }
  await expect(page.getByText("app-server 子进程")).toBeVisible()
  await expect(page.getByLabel("总体状态").getByText("不可用")).toBeVisible()
  for (const hidden of ["MinIO", "Codex app-server", "CODEX_HOME 根目录"]) {
    await expect(
      page.getByRole("heading", { name: hidden, exact: true })
    ).toHaveCount(0)
  }
})

for (const [route, heading] of [
  ["/conversations/new", "未命名任务"],
  ["/settings/general", "常规"],
  ["/settings/appearance", "外观"],
  ["/capabilities", "插件中心"],
  ["/archived", "已归档任务"],
  ["/admin/roles", "角色与权限"],
  ["/admin/health", "系统健康状态"],
] as const) {
  test(`has no critical or serious axe violations on ${route}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1024 })
    await page.goto(route)
    await expect(
      page.getByRole("heading", { name: heading, exact: true })
    ).toBeVisible()
    const results = await new AxeBuilder({ page }).analyze()
    expect(
      results.violations.filter(
        (violation) =>
          violation.impact === "critical" || violation.impact === "serious"
      )
    ).toEqual([])
  })
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }))
    )
    .toEqual(
      expect.objectContaining({
        body: expect.any(Number),
        document: expect.any(Number),
        viewport: expect.any(Number),
      })
    )
  const widths = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }))
  expect(widths.body).toBeLessThanOrEqual(widths.viewport + 1)
  expect(widths.document).toBeLessThanOrEqual(widths.viewport + 1)
}

async function mockEditableConversation(page: Page, conversationId: string) {
  const turnId = `turn-edit-${conversationId}`
  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "消息编辑样式",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: `message-user-${conversationId}`,
          role: "user",
          turn_id: turnId,
          content: "帮我生成一张小狗和可乐的图片",
          created_at: NOW,
        },
        {
          id: `message-final-${conversationId}`,
          role: "assistant",
          turn_id: turnId,
          item_id: `agent-final-${conversationId}`,
          phase: "final_answer",
          event_sequence_no: 2,
          content: "我会根据你的要求生成图片。",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [],
      events: [],
      activities: [],
    })
  )
}

async function mockCommentaryConversation(
  page: Page,
  conversationId: string,
  finalAnswerStarted: boolean
) {
  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "演示文稿检查",
        archive_status: "active",
        project_id: null,
        execution_status: "running",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: `message-user-${conversationId}`,
          role: "user",
          turn_id: "turn-commentary-state",
          content: "检查演示文稿",
          created_at: NOW,
        },
        {
          id: `message-commentary-${conversationId}`,
          role: "assistant",
          turn_id: "turn-commentary-state",
          item_id: "agent-commentary",
          phase: "commentary",
          event_sequence_no: 1,
          content: "正在检查演示文稿",
          created_at: NOW,
        },
        {
          id: `message-commentary-follow-up-${conversationId}`,
          role: "assistant",
          turn_id: "turn-commentary-state",
          item_id: "agent-commentary-follow-up",
          phase: "commentary",
          event_sequence_no: 2,
          content: "正在整理检查结果",
          created_at: NOW,
        },
        ...(finalAnswerStarted
          ? [
              {
                id: `message-final-${conversationId}`,
                role: "assistant",
                turn_id: "turn-commentary-state",
                item_id: "agent-final",
                phase: "final_answer",
                event_sequence_no: 3,
                content: "最终答案正在生成",
                created_at: NOW,
              },
            ]
          : []),
      ],
      turns: [
        {
          id: "turn-commentary-state",
          status: "running",
          started_at: NOW,
          completed_at: null,
        },
      ],
      pending_requests: [],
      files: [],
      events: [],
      activities: [],
    })
  )
}

async function mockNativeCommandConversation(
  page: Page,
  conversationId: string,
  command: string
) {
  const turnId = "30000000-0000-4000-8000-000000000003"
  await page.route(
    `**/api/v1/conversations/${conversationId}/events*`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
  )
  await page.route(`**/api/v1/conversations/${conversationId}`, (route) =>
    ok(route, {
      conversation: {
        id: conversationId,
        title: "命令详情对齐",
        archive_status: "active",
        project_id: null,
        execution_status: "completed",
        updated_at: NOW,
      },
      draft: null,
      messages: [
        {
          id: `message-user-${conversationId}`,
          role: "user",
          turn_id: turnId,
          content: "生成并检查图片",
          created_at: NOW,
        },
        {
          id: `message-final-${conversationId}`,
          role: "assistant",
          turn_id: turnId,
          item_id: `agent-final-${conversationId}`,
          phase: "final_answer",
          event_sequence_no: 2,
          content: "图片检查完成。",
          created_at: NOW,
        },
      ],
      turns: [
        {
          id: turnId,
          status: "completed",
          started_at: NOW,
          completed_at: NOW,
        },
      ],
      pending_requests: [],
      files: [],
      events: [
        {
          id: "60000000-0000-4000-8000-000000000003",
          conversation_id: conversationId,
          turn_id: turnId,
          sequence_no: 1,
          visibility: "user_collapsed",
          sse_event_id: "conversation-native-command:1",
          event_type: "item/completed",
          created_at: NOW,
          payload: {
            schema_version: 2,
            source: "codex_app_server",
            method: "item/completed",
            params: {
              threadId: "thread-native-command",
              turnId,
              item: {
                id: "native-command-completed",
                type: "commandExecution",
                status: "completed",
                command,
                commandActions: [{ type: "unknown", command }],
              },
            },
          },
        },
      ],
      activities: [],
    })
  )
  return turnId
}

async function mockApi(page: Page) {
  let currentLanguage = "zh-CN"
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api\/v1/u, "")
    if (path === "/system/bootstrap") {
      return ok(route, {
        initialized: true,
        system_name: "LinkSense",
        default_language: "zh-CN",
      })
    }
    if (path === "/auth/refresh") {
      return ok(route, createE2EAuthSession(currentLanguage))
    }
    if (path === "/me" && route.request().method() === "PATCH") {
      const body: unknown = route.request().postDataJSON()
      const preferredLocale =
        typeof body === "object" && body !== null && "preferred_locale" in body
          ? body.preferred_locale
          : undefined
      if (preferredLocale === "zh-CN" || preferredLocale === "en-US") {
        currentLanguage = preferredLocale
        return ok(route, {
          ...ADMIN,
          preferred_locale: currentLanguage,
          language: currentLanguage,
        })
      }
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error_code: "NETWORK_UNAVAILABLE",
          message_key: "errors.networkUnavailable",
        }),
      })
    }
    if (path === "/me") {
      return ok(route, {
        ...ADMIN,
        preferred_locale: currentLanguage,
        language: currentLanguage,
      })
    }
    if (path === "/auth/logout") return ok(route, {})
    if (path === "/voice/transcriptions/status") {
      return ok(route, { available: true })
    }
    if (path === "/admin/users") {
      return ok(route, {
        items: [
          {
            ...ADMIN,
            login_method: "password",
            group_count: 0,
            last_login_at: NOW,
          },
        ],
        next_cursor: null,
      })
    }
    if (path === "/admin/users/role-summary") {
      return ok(route, {
        items: [
          {
            role: "user",
            active_count: 18,
            disabled_count: 2,
            total_count: 20,
          },
          { role: "admin", active_count: 2, disabled_count: 0, total_count: 2 },
        ],
        next_cursor: null,
      })
    }
    if (path === "/admin/audit") {
      return ok(route, {
        items: [
          {
            id: "audit-without-target",
            actor_id: null,
            action: "audit_exported",
            target_type: null,
            target_id: null,
            result: "success",
            error_code: null,
            ip_address: null,
            user_agent: null,
            metadata: {},
            created_at: NOW,
          },
        ],
        next_cursor: null,
      })
    }
    if (path === "/projects") return ok(route, { items: [], next_cursor: null })
    if (path === "/me/environment") return ok(route, { keep_running: false })
    if (path === "/admin/health") return ok(route, HEALTH_STATUS)
    if (path === "/credentials" || path === "/credentials/bindings") {
      return ok(route, { items: [], next_cursor: null })
    }
    if (path === "/conversations/20000000-0000-4000-8000-000000000001/events") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: ": keep-alive\n\n",
      })
    }
    if (path === "/conversations/20000000-0000-4000-8000-000000000001") {
      return ok(route, {
        conversation: {
          id: "20000000-0000-4000-8000-000000000001",
          title: "项目数据分析",
          archive_status: "active",
          project_id: null,
          execution_status: "completed",
          updated_at: NOW,
        },
        draft: null,
        messages: [
          {
            id: "message-user-1",
            role: "user",
            content: "分析项目参与度\n\n\n",
          },
          {
            id: "message-assistant-1",
            role: "assistant",
            content: "已完成参与度分析，并整理了异常团队。",
          },
          {
            id: "message-user-2",
            role: "user",
            content: "补充改进建议",
          },
          {
            id: "message-assistant-2",
            role: "assistant",
            content: "建议优先跟进连续两周参与度下降的团队。",
          },
        ],
        turns: [{ id: "turn-1", status: "completed" }],
        pending_requests: [],
        files: [],
        events: [],
        activities: [
          {
            id: "activity-tool-completed",
            turn_id: "turn-1",
            type: "tool_completed",
            created_at: NOW,
          },
        ],
      })
    }
    if (path === "/conversations") {
      return ok(route, {
        items: [
          {
            id: "20000000-0000-4000-8000-000000000001",
            title: "项目数据分析",
            archive_status: "active",
            project_id: null,
            execution_status: "completed",
            updated_at: NOW,
          },
        ],
        next_cursor: null,
      })
    }
    if (path === "/capabilities") {
      return ok(route, { items: [], next_cursor: null })
    }
    if (path === "/marketplace/mine") {
      return ok(route, { items: [], next_cursor: null })
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
