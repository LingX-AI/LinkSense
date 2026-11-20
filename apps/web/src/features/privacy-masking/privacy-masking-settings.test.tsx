import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { defaultPrivacyMaskingSettings } from "@linksense/shared"

import i18n from "@/i18n"
import { PrivacyMaskingSettingsPage } from "@/features/privacy-masking/privacy-masking-settings"

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
        `${i18n.t("settings.privacyMaskingKindApiKey")} ×1`
      )
    ).toBeInTheDocument()
    expect(screen.getByText(placeholder)).toBeInTheDocument()
    expect(words).toBeInTheDocument()
  })
})
