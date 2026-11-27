import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { PrivacyMaskingActivityCard } from "@/features/privacy-masking/privacy-masking-activity-card"

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

function activity(overrides: Record<string, unknown> = {}) {
  return {
    summary: { masked_count: 3, request_count: 1 },
    records: [
      {
        id: "40000000-0000-4000-8000-000000000001",
        model: "model-a",
        masked_count: 3,
        kinds: { API_KEY: 2, TERM: 1 },
        hints: [
          { kind: "API_KEY", length: 40, location: "tool_output", count: 2 },
          { kind: "TERM", length: 4, location: "prompt", count: 1 },
        ],
        created_at: "2026-11-17T08:00:00.000Z",
      },
    ],
    next_before: null,
    ...overrides,
  }
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PrivacyMaskingActivityCard />
    </QueryClientProvider>
  )
}

describe("privacy masking activity card", () => {
  it.each(["zh-CN", "en-US", "es-ES", "pt-BR", "fr-FR", "ja-JP"])(
    "renders the summary and records in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => envelope(activity()))
      )
      renderCard()
      expect(
        await screen.findByText(i18n.t("settings.privacyMaskingActivityMasked"))
      ).toBeInTheDocument()
      expect(screen.getByText("model-a")).toBeInTheDocument()
      expect(
        screen.getByText(
          `${i18n.t("settings.privacyMaskingKindApiKey")} ×2`
        )
      ).toBeInTheDocument()
      expect(
        screen.getByText(`${i18n.t("settings.privacyMaskingKindTerm")} ×1`)
      ).toBeInTheDocument()
    }
  )

  it("expands a record into what was replaced and where", async () => {
    await i18n.changeLanguage("en-US")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => envelope(activity()))
    )
    const user = userEvent.setup()
    renderCard()
    const trigger = (await screen.findByText("model-a")).closest("button")
    expect(trigger).not.toBeNull()
    await user.click(trigger as HTMLElement)

    expect(
      await screen.findByText(i18n.t("settings.privacyMaskingKindApiKey"))
    ).toBeVisible()
    expect(
      screen.getByText(i18n.t("settings.privacyMaskingActivityLocationToolOutput"))
    ).toBeVisible()
    expect(
      screen.getByText(
        i18n.t("settings.privacyMaskingActivityHintLength", { length: "40" })
      )
    ).toBeVisible()
    expect(
      screen.getByText(i18n.t("settings.privacyMaskingActivityLocationPrompt"))
    ).toBeVisible()
  })

  it("shows an empty state and reloads for the wider period", async () => {
    await i18n.changeLanguage("en-US")
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        expect(String(input)).toContain("/me/privacy-masking-activity")
        return envelope(activity({ records: [] }))
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    renderCard()
    expect(
      await screen.findByText(i18n.t("settings.privacyMaskingActivityEmpty"))
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("tab", {
        name: i18n.t("settings.privacyMaskingActivity30Days"),
      })
    )
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("days=30")
        )
      ).toBe(true)
    )
  })

  it.each([false, true])("loads the next page with the returned cursor (legacy API: %s)", async (legacyApi) => {
    await i18n.changeLanguage("en-US")
    const nextBefore = "2026-11-17T08:00:00.000Z"
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost")
        if (legacyApi && url.searchParams.has("before_id")) {
          return new Response(JSON.stringify({ success: false, error_code: "VALIDATION_ERROR" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          })
        }
        if (url.searchParams.has("before")) {
          return envelope(
            activity({
              records: [
                {
                  id: "40000000-0000-4000-8000-000000000002",
                  model: "model-b",
                  masked_count: 2,
                  kinds: { API_KEY: 2 },
                  hints: [],
                  created_at: nextBefore,
                },
              ],
            })
          )
        }
        return envelope(activity({ next_before: nextBefore }))
      }
    )
    vi.stubGlobal("fetch", fetchMock)
    const user = userEvent.setup()
    renderCard()
    await screen.findByText("model-a")
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("settings.privacyMaskingActivityLoadMore"),
      })
    )
    expect(await screen.findByText("model-b")).toBeInTheDocument()
    const pageUrl = new URL(String(fetchMock.mock.calls[1]?.[0]), "http://localhost")
    expect(pageUrl.searchParams.get("before")).toBe(nextBefore)
    expect(pageUrl.searchParams.get("before_id")).toBe("40000000-0000-4000-8000-000000000001")
    expect(fetchMock).toHaveBeenCalledTimes(legacyApi ? 3 : 2)
    if (legacyApi) {
      const legacyUrl = new URL(String(fetchMock.mock.calls[2]?.[0]), "http://localhost")
      expect(legacyUrl.searchParams.get("before")).toBe(nextBefore)
      expect(legacyUrl.searchParams.has("before_id")).toBe(false)
    }
  })

  it("reads older counts-only activity without replacement hints", async () => {
    await i18n.changeLanguage("en-US")
    const legacy = {
      id: "40000000-0000-4000-8000-000000000001",
      model: "legacy-model",
      masked_count: 3,
      kinds: { API_KEY: 3 },
      created_at: "2026-11-17T08:00:00.000Z",
    }
    vi.stubGlobal("fetch", vi.fn(async () => envelope(activity({ records: [legacy] }))))
    renderCard()
    expect((await screen.findByText("legacy-model")).closest("button")).toBeNull()
  })
})
