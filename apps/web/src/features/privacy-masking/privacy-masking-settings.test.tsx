import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  defaultPrivacyMaskingSettings,
  updatePrivacyMaskingSettingsSchema,
} from "@linksense/shared"

import i18n from "@/i18n"
import { PrivacyMaskingSettingsPage } from "@/features/privacy-masking/privacy-masking-settings"
import { privacyMaskingRuleMessages } from "@/features/privacy-masking/rule-messages"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function envelope(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function emptyActivity() {
  return envelope({
    summary: { masked_count: 0, request_count: 0 },
    records: [],
    next_before: null,
  })
}

function isActivityRequest(input: RequestInfo | URL): boolean {
  return String(input).includes("/me/privacy-masking-activity")
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PrivacyMaskingSettingsPage />
    </QueryClientProvider>
  )
}

describe("privacy masking settings page", () => {
  it.each([
    ["zh-CN", /不保护自动标题/u],
    ["en-US", /does not protect automatic titles/u],
    ["es-ES", /no protege los títulos automáticos/iu],
    ["pt-BR", /não protege os títulos automáticos/iu],
    ["fr-FR", /ne protège pas les titres automatiques/u],
    ["ja-JP", /自動タイトル.*対象外/u],
  ] as const)(
    "renders the saved settings in %s",
    async (language, scope) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          isActivityRequest(input)
            ? emptyActivity()
            : envelope({
                revision: 0,
                settings: defaultPrivacyMaskingSettings,
              })
        )
      )
      renderPage()
      expect(
        await screen.findByRole("switch", {
          name: i18n.t("settings.privacyMaskingEnabled"),
        })
      ).not.toBeChecked()
      const activeMessages = privacyMaskingRuleMessages[language]
      expect(
        screen.getByRole("heading", { name: activeMessages.personalTitle })
      ).toBeVisible()
      expect(
        screen.getByRole("button", { name: activeMessages.addRegex })
      ).toBeVisible()
      for (const [key, message] of Object.entries(activeMessages)) {
        expect(i18n.getResource(language, "translation", `privacyMaskingRules.${key}`)).toBe(message)
      }
      expect(i18n.t("privacyMaskingRules.previewHit", {
        name: "CUS",
        action: activeMessages.mask,
        count: 3,
      })).toEqual(expect.stringContaining("×3"))
      expect(
        screen.getByRole("heading", {
          level: 1,
          name: i18n.t("settings.privacyMasking"),
        })
      ).toBeInTheDocument()
      expect(
        screen.getByRole("button", {
          name: i18n.t("settings.privacyMaskingSave"),
        })
      ).toBeDisabled()
      expect(
        screen.getByRole("switch", {
          name: i18n.t("settings.privacyMaskingEnabled"),
        })
      ).toHaveAccessibleDescription(i18n.t("settings.privacyMaskingEnabledDescription"))
      expect(i18n.t("settings.privacyMaskingEnabledDescription")).toMatch(scope)
    }
  )

  it("splits configuration and activity into two tabs", async () => {
    await i18n.changeLanguage("en-US")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        isActivityRequest(input)
          ? emptyActivity()
          : envelope({
              revision: 0,
              settings: defaultPrivacyMaskingSettings,
            })
      )
    )
    const user = userEvent.setup()
    renderPage()

    const settingsTab = await screen.findByRole("tab", {
      name: i18n.t("settings.privacyMaskingSectionSettings"),
    })
    const activityTab = screen.getByRole("tab", {
      name: i18n.t("settings.privacyMaskingSectionActivity"),
    })
    expect(settingsTab).toHaveAttribute("aria-selected", "true")
    expect(
      screen.getByRole("switch", {
        name: i18n.t("settings.privacyMaskingEnabled"),
      })
    ).toBeVisible()
    expect(
      screen.getByRole("button", {
        name: i18n.t("settings.privacyMaskingSave"),
      })
    ).toBeVisible()

    await user.click(activityTab)

    expect(
      await screen.findByText(
        i18n.t("settings.privacyMaskingActivityEmpty")
      )
    ).toBeVisible()
    expect(activityTab).toHaveAttribute("aria-selected", "true")
    expect(
      screen.queryByRole("switch", {
        name: i18n.t("settings.privacyMaskingEnabled"),
      })
    ).toBeNull()
    expect(
      screen.queryByRole("button", {
        name: i18n.t("settings.privacyMaskingSave"),
      })
    ).toBeNull()

    await user.click(settingsTab)
    expect(
      screen.getByRole("switch", {
        name: i18n.t("settings.privacyMaskingEnabled"),
      })
    ).toBeVisible()
  })

  it("saves the switch and parsed custom words", async () => {
    await i18n.changeLanguage("en-US")
    let settings = { ...defaultPrivacyMaskingSettings }
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input)
        if (isActivityRequest(input)) return emptyActivity()
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as {
            expected_revision: number
            settings: typeof settings
          }
          settings = body.settings
          return envelope({ revision: 1, settings })
        }
        expect(path).toBe("/api/v1/me/privacy-masking-settings")
        return envelope({ revision: 0, settings })
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    renderPage()

    const enable = await screen.findByRole("switch", {
      name: i18n.t("settings.privacyMaskingEnabled"),
    })
    await user.click(enable)
    const words = screen.getByRole("textbox", {
      name: i18n.t("settings.privacyMaskingWords"),
    })
    await user.type(words, "Nightjar\n\nAcme")
    const save = screen.getByRole("button", {
      name: i18n.t("settings.privacyMaskingSave"),
    })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([, init]) => init?.method === "PUT"
      )
      expect(call).toBeTruthy()
      expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
        expected_revision: 0,
        settings: {
          enabled: true,
          words: ["Nightjar", "Acme"],
        },
      })
    })
    expect(
      await screen.findByRole("switch", {
        name: i18n.t("settings.privacyMaskingEnabled"),
      })
    ).toBeChecked()
  })

  it("reloads settings after a conflicting save and uses the current revision on retry", async () => {
    await i18n.changeLanguage("en-US")
    const settings = { ...defaultPrivacyMaskingSettings, enabled: true }
    let revision = 0
    const savedRevisions: number[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (isActivityRequest(input)) return emptyActivity()
        if (init?.method !== "PUT") {
          return envelope({ revision, settings })
        }
        const body = JSON.parse(String(init.body)) as {
          expected_revision: number
          settings: typeof settings
        }
        savedRevisions.push(body.expected_revision)
        if (savedRevisions.length === 1) {
          revision = 1
          settings.words = ["Saved in another tab"]
          return new Response(
            JSON.stringify({ success: false, error_code: "CONFLICT" }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            }
          )
        }
        return envelope({ revision: 2, settings: body.settings })
      })
    )
    const user = userEvent.setup()
    renderPage()
    const words = await screen.findByRole("textbox", {
      name: i18n.t("settings.privacyMaskingWords"),
    })
    await user.type(words, "First draft")
    const save = screen.getByRole("button", {
      name: i18n.t("settings.privacyMaskingSave"),
    })
    await user.click(save)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.conflict")
    )
    await waitFor(() => expect(words).toHaveValue("Saved in another tab"))
    await user.type(words, "\nSecond draft")
    await user.click(save)
    await waitFor(() => expect(savedRevisions).toEqual([0, 1]))
    await waitFor(() => expect(save).toBeDisabled())
  })

  it("previews the draft rules and highlights the placeholders", async () => {
    await i18n.changeLanguage("en-US")
    const placeholder = "{{API_KEY_0123456789abcdef}}"
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "/api/v1/me/privacy-masking-settings/preview"
        )
        const body = JSON.parse(String(init?.body)) as {
          text: string
          settings: { words: string[] }
        }
        expect(body.text).toBe("Nightjar ships with sk-1234567890abcdef")
        return envelope({
          text: `Nightjar ships with ${placeholder}`,
          hits: [{ placeholder, kind: "API_KEY", action: "mask" }],
        })
      }
    )
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (isActivityRequest(input)) return emptyActivity()
        if (init?.method === "POST") return fetchMock(input, init)
        return envelope({
          revision: 0,
          settings: { ...defaultPrivacyMaskingSettings, enabled: true },
        })
      })
    )
    const user = userEvent.setup()
    renderPage()
    const words = await screen.findByRole("textbox", {
      name: i18n.t("settings.privacyMaskingWords"),
    })
    const tryInput = screen.getByRole("textbox", {
      name: i18n.t("settings.privacyMaskingTryIt"),
    })
    await user.type(tryInput, "Nightjar ships with sk-1234567890abcdef")
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce(), {
      timeout: 2000,
    })
    expect(
      await screen.findByText(
        i18n.t("privacyMaskingRules.previewHit", {
          name: i18n.t("settings.privacyMaskingKindApiKey"),
          action: i18n.t("privacyMaskingRules.mask"),
          count: 1,
        })
      )
    ).toBeInTheDocument()
    expect(screen.getByText(placeholder)).toBeInTheDocument()
    expect(words).toBeInTheDocument()
  })

  it("adds a template and blocking regex, previews the matched rule, and saves the full policy", async () => {
    await i18n.changeLanguage("en-US")
    const messages = privacyMaskingRuleMessages["en-US"]
    const put = vi.fn(async (init: RequestInit) => {
      const { expected_revision, settings } = updatePrivacyMaskingSettingsSchema.parse(
        JSON.parse(String(init.body))
      )
      expect(expected_revision).toBe(4)
      return envelope({ settings, revision: 5 })
    })
    const preview = vi.fn(async (init: RequestInit) => {
      const { settings } = updatePrivacyMaskingSettingsSchema.parse({
        expected_revision: 4,
        settings: JSON.parse(String(init.body)).settings,
      })
      const rule = settings.custom_rules?.find(({ type }) => type === "regex")
      if (!rule) throw new Error("Regex is missing from the preview draft")
      return envelope({
        blocked: true,
        text: "",
        hits: [{
          placeholder: "{{TERM_0123456789abcdef}}",
          kind: "TERM",
          action: "block",
          rule_ids: [rule.id],
        }],
      })
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isActivityRequest(input)) return emptyActivity()
      if (init?.method === "PUT") return put(init)
      if (init?.method === "POST") return preview(init)
      return envelope({
        revision: 4,
        settings: { ...defaultPrivacyMaskingSettings, enabled: true, words: ["Nightjar"] },
      })
    }))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("combobox", {
      name: i18n.t("settings.privacyMaskingKindEmail"),
    }))
    await user.click(await screen.findByRole("option", { name: messages.mask }))
    await user.click(screen.getByRole("button", { name: messages.addTemplate }))
    const template = within(screen.getByRole("group", { name: messages.template }))
    await user.type(template.getByRole("textbox", { name: messages.name }), "Customer ID")
    await user.type(template.getByRole("textbox", { name: messages.prefix }), "CUS-")
    await user.click(screen.getByRole("button", { name: messages.addRegex }))
    const regex = within(screen.getByRole("group", { name: messages.regex }))
    await user.type(regex.getByRole("textbox", { name: messages.name }), "Warehouse ID")
    await user.click(regex.getByRole("textbox", { name: messages.pattern }))
    await user.paste("WH-[0-9]+")
    await user.click(regex.getByRole("combobox", { name: messages.action }))
    await user.click(await screen.findByRole("option", { name: messages.block }))
    const tryInput = screen.getByRole("textbox", { name: i18n.t("settings.privacyMaskingTryIt") })
    await user.type(tryInput, "Visit WH-123")
    expect(await screen.findByText(messages.previewBlocked)).toBeVisible()
    expect(screen.getByText(`Warehouse ID · ${messages.block} ×1`)).toBeVisible()
    expect(screen.queryByText("{{TERM_0123456789abcdef}}")).not.toBeInTheDocument()
    expect(put).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: i18n.t("settings.privacyMaskingSave") }))
    await waitFor(() => expect(put).toHaveBeenCalledOnce())
    expect(JSON.parse(String(put.mock.calls[0]?.[0].body))).toMatchObject({
      settings: {
        words: ["Nightjar"],
        personal_rules: { EMAIL: "mask" },
        custom_rules: [
          { name: "Customer ID", action: "mask", type: "prefix_digits", prefix: "CUS-", digits: 6 },
          { name: "Warehouse ID", action: "block", type: "regex", pattern: "WH-[0-9]+" },
        ],
      },
    })
  })

  it("focuses an invalid regex on save and clears the error when edited", async () => {
    await i18n.changeLanguage("en-US")
    const messages = privacyMaskingRuleMessages["en-US"]
    const put = vi.fn(async (init: RequestInit) => {
      const input = updatePrivacyMaskingSettingsSchema.parse(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({
        success: false,
        error_code: "VALIDATION_ERROR",
        params: { privacy_masking_rule_id: input.settings.custom_rules?.[0]?.id },
      }), { status: 400, headers: { "content-type": "application/json" } })
    })
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isActivityRequest(input)) return emptyActivity()
      if (init?.method === "PUT") return put(init)
      return envelope({ revision: 0, settings: defaultPrivacyMaskingSettings })
    }))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: messages.addRegex }))
    const name = screen.getByRole("textbox", { name: messages.name })
    const pattern = screen.getByRole("textbox", { name: messages.pattern })
    const save = screen.getByRole("button", { name: i18n.t("settings.privacyMaskingSave") })
    await user.click(save)
    await waitFor(() => expect(name).toHaveFocus())
    expect(name).toHaveAttribute("aria-invalid", "true")
    expect(put).not.toHaveBeenCalled()
    await user.type(name, "Custom ID")
    await user.type(pattern, "(?=WH-)")
    await user.click(save)
    await waitFor(() => expect(pattern).toHaveFocus())
    expect(pattern).toHaveAccessibleDescription(`${messages.patternHint} ${messages.invalidRegex}`)
    expect(pattern).toHaveAttribute("aria-invalid", "true")
    await user.clear(pattern)
    expect(pattern).not.toHaveAttribute("aria-invalid")
  })
})
