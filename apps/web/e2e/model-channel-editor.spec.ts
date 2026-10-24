import { expect, test, type Page } from "@playwright/test"
import {
  managedConversationModelSchema,
  supportedLocales,
  type Locale,
  type ModelProviderSettings,
} from "@linksense/shared"
import { createE2EAuthSession, E2E_ADMIN } from "./support/auth-fixture"
import { expectPopupPadding } from "./support/popup-padding"

const settings: ModelProviderSettings = {
  configured: false,
  revision: 1,
  providers: [
    {
      id: "existing-channel",
      name: "Existing channel",
      provider: "openai_compatible",
      provider_project: null,
      provider_location: null,
      base_url: "https://models.example.test/v1",
      protocol_mode: "chat_completions_bridge",
      api_key_configured: true,
      models: [],
    },
  ],
  default_model: null,
  memory_extraction_model: null,
  title_model: null,
}

for (const width of [1440, 375]) {
  for (const mode of ["create", "edit"] as const) {
    test(`${mode} channel keeps connection fields usable after every provider change at ${width}px`, async ({
      page,
    }) => {
      const probes = await mockApi(page)
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/admin/models")
      if (mode === "create") {
        await page.getByRole("button", { name: "添加模型渠道" }).click()
      } else {
        await page.getByRole("button", { name: "渠道操作" }).click()
        await page.getByRole("menuitem", { name: "编辑渠道" }).click()
        await expect.poll(() => probes.length).toBe(1)
      }
      const dialog = page.getByRole("dialog")
      const name = dialog.getByRole("textbox", {
        name: "渠道名称",
        exact: true,
      })
      const url = dialog.getByRole("textbox", { name: "Base URL", exact: true })
      const key = dialog.getByLabel(/^API_KEY\s*\*?$/u)
      const provider = dialog.getByRole("combobox", { name: "模型服务商" })
      await name.fill("Browser test channel")
      await key.fill("browser-test-key")

      // Real CSS layout is required: JSDOM reports these fields as visible even
      // when Chromium drops their layout boxes inside a native fieldset.
      for (const label of [
        "OpenAI",
        "Azure OpenAI",
        "Anthropic",
        "Google Gemini",
        "Google Vertex AI",
        "阿里云 / Qwen",
        "DeepSeek",
        "OpenRouter",
        "OpenAI 兼容 / vLLM",
      ]) {
        await provider.click()
        await page.getByRole("option", { name: label, exact: true }).click()
        await expect(page.getByRole("listbox")).toBeHidden()
        for (const control of [name, provider, url, key]) {
          await expect(control).toBeVisible()
          await expect(control).toBeEnabled()
        }
        await expect(provider.locator('[data-slot="select-value"]')).toHaveText(
          label
        )
        await expect(name).toHaveValue("Browser test channel")
        await expect(key).toHaveValue("browser-test-key")
        await url.fill("https://edited.example.test/v1")
        await expect(url).toHaveValue("https://edited.example.test/v1")
      }
      await name.fill("Edited channel")
      await key.fill("edited-test-key")
      await expect(name).toHaveValue("Edited channel")
      await expect(key).toHaveValue("edited-test-key")
      const testModel = dialog.getByRole("combobox", {
        name: "用于测试的模型 ID",
      })
      await testModel.fill("manual-before-discovery")
      await dialog.getByRole("button", { name: "获取可用模型" }).click()
      await expect(
        dialog.getByRole("button", { name: "正在获取模型…" })
      ).toBeHidden()
      await expect(testModel).toHaveValue("manual-before-discovery")
      await testModel.fill("Demo")
      await page
        .getByRole("option", { name: "Demo model (demo-model)", exact: true })
        .click()
      await expect(testModel).toHaveValue("demo-model")
      await dialog.getByRole("button", { name: "测试模型连接" }).click()
      await expect(dialog.getByText(/模型 demo-model 已成功响应/)).toBeVisible()
      await testModel.fill("manual-model")
      await testModel.press("Tab")
      await expect(testModel).toHaveValue("manual-model")
      await dialog.getByRole("button", { name: "测试模型连接" }).click()
      await expect(
        dialog.getByText(/模型 manual-model 已成功响应/)
      ).toBeVisible()
      expect(probes.map(({ body }) => body.model_id)).toEqual([
        ...(mode === "edit" ? [undefined] : []),
        undefined,
        "demo-model",
        "manual-model",
      ])
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true)
    })
  }
}

for (const locale of supportedLocales) {
  test(`model action menus preserve text padding in ${locale}`, async ({
    page,
  }) => {
    const model = managedConversationModelSchema.parse({
      id: "model-a",
      display_name: "Model A",
      kind: "chat",
      enabled: true,
      supported_reasoning_efforts: ["medium"],
      default_reasoning_effort: "medium",
    })
    await mockApi(
      page,
      {
        ...settings,
        configured: true,
        default_model: model.id,
        title_model: model.id,
        providers: settings.providers.map((provider) => ({
          ...provider,
          models: [model, { ...model, id: "model-b", display_name: "Model B" }],
        })),
      },
      locale
    )
    for (const width of [1440, 375]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/admin/models")
      await expect(page.locator("html")).toHaveAttribute("lang", locale)
      await page
        .getByRole("row", { name: "Model A", exact: true })
        .locator('[data-slot="dropdown-menu-trigger"]')
        .click()
      const menu = page.getByRole("menu")
      await expect(menu).toBeVisible()
      for (const item of await menu.getByRole("menuitem").all()) {
        const spacing = await item.evaluate((element) => {
          const text = [...element.childNodes].find(
            (node) =>
              node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
          )
          if (!text) throw new Error("Menu item has no text")
          const range = document.createRange()
          range.selectNodeContents(text)
          return {
            actual:
              element.getBoundingClientRect().right -
              range.getBoundingClientRect().right,
            expected: parseFloat(getComputedStyle(element).paddingRight),
          }
        })
        expect(spacing.actual).toBeGreaterThanOrEqual(spacing.expected - 0.5)
      }
      const bounds = await menu.boundingBox()
      if (!bounds) throw new Error("Menu has no layout box")
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
      await page.keyboard.press("Escape")
    }
  })
}

test("discovered model popup padding handles long model IDs at the largest UI font size", async ({
  page,
}) => {
  await mockApi(page, settings, "en-US")
  await page.addInitScript(() =>
    localStorage.setItem("linksense.uiFontSize", "18")
  )
  await page.route(
    "**/api/v1/admin/model-provider-settings/discover",
    (route) =>
      route.fulfill({
        status: 200,
        json: {
          success: true,
          data: {
            status: "supported",
            models: [
              {
                id: `model-${"a".repeat(210)}`,
                display_name: "Long discovered model",
                context_window: null,
                supports_image_input: null,
              },
            ],
            truncated: false,
          },
        },
      })
  )
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/admin/models")
    await page.getByRole("button", { name: "Add model", exact: true }).click()
    const selection = page.getByRole("combobox", {
      name: "Select an available model",
    })
    await expect(selection).toBeEnabled()
    await selection.click()
    await expectPopupPadding(page.getByRole("listbox"), '[role="option"]')
    await page.keyboard.press("Escape")
  }
})

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`segmented tab backgrounds remain local during layout shifts with ${reducedMotion} motion`, async ({
    page,
  }) => {
    await mockApi(page, settings, "en-US")
    await page.emulateMedia({ reducedMotion })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto("/admin/models")
    const list = page.getByRole("tablist", { name: "Model setting categories" })
    const background = list.locator('[data-slot="tabs-indicator"]')
    await expect(background).toBeVisible()
    const original = await background.elementHandle()
    if (!original) throw new Error("Missing segmented background")
    await page.addStyleTag({
      content:
        '[data-slot="tabs"]:has(> [data-slot="tabs-list"] > [role="tab"]:nth-child(2)[aria-selected="true"]) { margin-top: 120px; }',
    })
    const sampleFrames = () =>
      page.evaluate(async () => {
        const list = document.querySelector(
          '[role="tablist"][aria-label="Model setting categories"]'
        )
        if (!list) throw new Error("Missing model segments")
        const frames: {
          x: number
          y: number
          listY: number
          rootHeight: number
          inBounds: boolean
        }[] = []
        for (let index = 0; index < 36; index++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          )
          const listBox = list.getBoundingClientRect()
          const indicator = list
            .querySelector('[data-slot="tabs-indicator"]')
            ?.getBoundingClientRect()
          if (!indicator) throw new Error("Segmented background was removed")
          frames.push({
            x: indicator.left - listBox.left,
            y: indicator.top - listBox.top,
            listY: listBox.top,
            rootHeight:
              list.closest('[data-slot="tabs"]')?.getBoundingClientRect()
                .height ?? 0,
            inBounds:
              indicator.left >= listBox.left - 1 &&
              indicator.right <= listBox.right + 1 &&
              indicator.top >= listBox.top - 1 &&
              indicator.bottom <= listBox.bottom + 1,
          })
        }
        return frames
      })
    for (const target of [1, 0, 2, 0]) {
      const [frames] = await Promise.all([
        sampleFrames(),
        list.getByRole("tab").nth(target).click(),
      ])
      expect(frames.every((frame) => frame.inBounds)).toBe(true)
      const first = frames[0]
      const last = frames.at(-1)
      if (!first || !last) throw new Error("Missing animation frames")
      expect(frames.every((frame) => Math.abs(frame.y - last.y) < 1)).toBe(true)
      if (target === 1) {
        expect(
          Math.max(...frames.map((frame) => frame.listY)) -
            Math.min(...frames.map((frame) => frame.listY))
        ).toBeGreaterThan(80)
        expect(
          Math.max(...frames.map((frame) => frame.rootHeight)) -
            Math.min(...frames.map((frame) => frame.rootHeight))
        ).toBeGreaterThan(40)
      }
      expect(
        frames.some(
          (frame) =>
            Math.abs(frame.x - first.x) > 2 && Math.abs(frame.x - last.x) > 2
        )
      ).toBe(reducedMotion === "no-preference")
      expect(await original.evaluate((node) => node.isConnected)).toBe(true)
      await expect(background).toHaveCount(1)
      await expect
        .poll(() =>
          background.evaluate((element) => {
            const selected = element
              .closest('[role="tablist"]')
              ?.querySelector('[role="tab"][aria-selected="true"]')
            if (!selected) return Infinity
            const from = element.getBoundingClientRect()
            const to = selected.getBoundingClientRect()
            return Math.max(
              Math.abs(from.left - to.left),
              Math.abs(from.top - to.top),
              Math.abs(from.width - to.width)
            )
          })
        )
        .toBeLessThan(1)
    }
    const [rapidFrames] = await Promise.all([
      sampleFrames(),
      (async () => {
        await list.getByRole("tab").nth(1).click()
        await list.getByRole("tab").nth(2).click()
        await list.getByRole("tab").nth(0).click()
      })(),
    ])
    expect(rapidFrames.every((frame) => frame.inBounds)).toBe(true)
    await expect(background).toHaveCount(1)
    expect(await original.evaluate((node) => node.isConnected)).toBe(true)
    await page.setViewportSize({ width: 375, height: 900 })
    await list.getByRole("tab").nth(2).click()
    await expect(list).toBeInViewport()
    await expect(list.getByRole("tab").nth(2)).toBeInViewport()
    expect(
      await list.evaluate(
        (element) => element.getBoundingClientRect().right <= window.innerWidth
      )
    ).toBe(true)
  })
}

async function mockApi(
  page: Page,
  modelSettings = settings,
  locale: Locale = "zh-CN"
): Promise<Array<{ path: string; body: Record<string, unknown> }>> {
  const probes: Array<{ path: string; body: Record<string, unknown> }> = []
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(
      /^\/api\/v1/u,
      ""
    )
    const ok = (data: unknown) =>
      route.fulfill({ status: 200, json: { success: true, data } })
    if (path === "/system/bootstrap")
      return ok({
        initialized: true,
        system_name: "LinkSense",
        default_language: locale,
      })
    if (path === "/auth/refresh") return ok(createE2EAuthSession(locale))
    if (path === "/me")
      return ok({ ...E2E_ADMIN, preferred_locale: locale, language: locale })
    if (path === "/admin/model-provider-settings") return ok(modelSettings)
    if (path === "/admin/model-provider-settings/discover") {
      probes.push({ path, body: route.request().postDataJSON() })
      return ok({
        status: "supported",
        models: [
          {
            id: "demo-model",
            display_name: "Demo model",
            context_window: null,
            supports_image_input: null,
          },
        ],
        truncated: false,
      })
    }
    if (path === "/admin/model-provider-settings/test-connection") {
      const body: Record<string, unknown> = route.request().postDataJSON()
      probes.push({ path, body })
      return ok({ status: "success", model_id: body.model_id })
    }
    return route.fulfill({
      status: 404,
      json: { success: false, error_code: "NOT_FOUND" },
    })
  })
  return probes
}
