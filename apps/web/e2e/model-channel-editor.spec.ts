import { expect, test, type Page } from "@playwright/test"
import type { ModelProviderSettings } from "@linksense/shared"
import { createE2EAuthSession, E2E_ADMIN } from "./support/auth-fixture"

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
      }
      const dialog = page.getByRole("dialog")
      const name = dialog.getByLabel("渠道名称", { exact: true })
      const url = dialog.getByLabel("Base URL", { exact: true })
      const key = dialog.getByLabel("API_KEY", { exact: true })
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

async function mockApi(
  page: Page
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
        default_language: "zh-CN",
      })
    if (path === "/auth/refresh") return ok(createE2EAuthSession())
    if (path === "/me") return ok(E2E_ADMIN)
    if (path === "/admin/model-provider-settings") return ok(settings)
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
