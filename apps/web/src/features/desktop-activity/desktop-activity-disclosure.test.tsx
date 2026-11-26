import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  auditTranslationResource,
  type DesktopActivityItem,
} from "@linksense/shared"

const api = vi.hoisted(() => ({ request: vi.fn() }))
const native = vi.hoisted(() => ({ mac: true }))

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  return { ...actual, apiRequest: api.request }
})

vi.mock("@/adapters/desktop/desktop-adapter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/adapters/desktop/desktop-adapter")>()
  return { ...actual, isMacDesktopHost: () => native.mac }
})

import i18n from "@/i18n"
import { ApiError } from "@/api/client"
import { beginLoginSession } from "@/api/session"

import { DesktopActivityDisclosure } from "./desktop-activity-disclosure"
import { desktopActivityMessages } from "./messages"

const ownerA = "9f4e6a1a-5d1c-4d25-8d63-2a0f0e1c7b11"
const ownerB = "c5b7a0d4-2f6e-4f8a-9a3c-7d1e2b4c6a90"
const audit = auditTranslationResource("en-US")
const messages = desktopActivityMessages["en-US"]

function makeItem(
  overrides: Partial<DesktopActivityItem> = {}
): DesktopActivityItem {
  return {
    id: "2b8f4c3a-7d1e-4a9b-8c2d-5e6f7a8b9c0d",
    created_at: "2026-11-26T08:00:00.000Z",
    action: "desktop_tool_requested",
    result: "success",
    ...overrides,
  }
}

function renderDisclosure(ownerId: string | undefined, client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <DesktopActivityDisclosure ownerId={ownerId} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function rerenderDisclosure(
  view: ReturnType<typeof render>,
  ownerId: string | undefined,
  client: QueryClient
) {
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <DesktopActivityDisclosure ownerId={ownerId} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function disclosureTrigger() {
  return screen.getByRole("button", { name: messages.title })
}

async function expand() {
  const trigger = disclosureTrigger()
  trigger.focus()
  await userEvent.keyboard("{Enter}")
  return trigger
}

beforeEach(async () => {
  vi.clearAllMocks()
  native.mac = true
  api.request.mockResolvedValue({ items: [] })
  await i18n.changeLanguage("en-US")
})

afterEach(cleanup)

describe("desktop activity disclosure", () => {
  it("stays collapsed and makes no request in a plain Web or Windows host", () => {
    native.mac = false
    const { container } = renderDisclosure(ownerA)

    expect(container).toBeEmptyDOMElement()
    expect(api.request).not.toHaveBeenCalled()
  })

  it("requests nothing until the disclosure is expanded, then shows latest first", async () => {
    api.request.mockResolvedValue({
      items: [
        makeItem({
          computer_request: "act",
          computer_action: "click",
          delivery: "unconfirmed",
        }),
        makeItem({
          id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
          created_at: "2026-11-25T08:00:00.000Z",
          action: "desktop_approval_responded",
          delivery: "confirmed",
          approval_decision: "accept",
        }),
      ],
    })
    renderDisclosure(ownerA)

    const trigger = disclosureTrigger()
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByText(messages.description)).toBeVisible()
    expect(api.request).not.toHaveBeenCalled()

    trigger.focus()
    await userEvent.keyboard("{Enter}")

    await waitFor(() =>
      expect(api.request).toHaveBeenCalledExactlyOnceWith(
        "/desktop/activity",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          loginSessionBoundary: expect.any(Number),
        })
      )
    )
    expect(trigger).toHaveAttribute("aria-expanded", "true")
    const panelId = trigger.getAttribute("aria-controls")
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)).toBeVisible()

    expect(
      await screen.findByText(audit.actions.desktop_tool_requested)
    ).toBeVisible()
    expect(screen.getByText(messages.attempt)).toBeVisible()
    expect(screen.getByText(messages.deliveryUnconfirmed)).toBeVisible()
    expect(screen.getByText("Request: Act")).toBeVisible()
    expect(screen.getByText("Action: Click")).toBeVisible()
    expect(
      screen.queryByText("Attempt result: Success")
    ).not.toBeInTheDocument()

    expect(
      screen.getByText(audit.actions.desktop_approval_responded)
    ).toBeVisible()
    expect(screen.getByText(messages.deliveryConfirmed)).toBeVisible()
    expect(screen.getByText("Decision: Allow")).toBeVisible()

    const rows = screen.getAllByRole("listitem")
    expect(rows).toHaveLength(2)
    const renderedTime = (rows[0] as HTMLElement).querySelector("time")
    expect(renderedTime).toHaveAttribute("datetime", "2026-11-26T08:00:00.000Z")
    expect(renderedTime?.textContent?.trim()).not.toBe("")
    expect(
      within(rows[0] as HTMLElement).getByText(
        audit.actions.desktop_tool_requested
      )
    ).toBeVisible()
    expect(
      within(rows[1] as HTMLElement).getByText(
        audit.actions.desktop_approval_responded
      )
    ).toBeVisible()
  })

  it("does not claim success for an unconfirmed attempt but keeps a recorded rejection", async () => {
    api.request.mockResolvedValue({
      items: [
        makeItem({ computer_request: "status", delivery: "unconfirmed" }),
        makeItem({
          id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
          result: "rejected",
          computer_request: "observe",
          delivery: "unconfirmed",
        }),
      ],
    })
    renderDisclosure(ownerA)
    await expand()

    expect(await screen.findByText("Request: Status")).toBeVisible()
    expect(screen.getAllByText(messages.attempt)).toHaveLength(2)
    expect(screen.getAllByText(messages.deliveryUnconfirmed)).toHaveLength(2)
    expect(
      screen.queryByText("Attempt result: Success")
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(`Attempt result: ${audit.results.rejected}`)
    ).toBeVisible()
  })

  it("shows an empty state when the account has no activity", async () => {
    renderDisclosure(ownerA)
    await expand()

    expect(await screen.findByText(messages.emptyTitle)).toBeVisible()
    expect(screen.getByText(messages.emptyDescription)).toBeVisible()
  })

  it("recovers from a failed read on retry", async () => {
    api.request.mockRejectedValueOnce(new Error("boom"))
    renderDisclosure(ownerA)
    await expand()

    expect(await screen.findByText(messages.loadFailed)).toBeVisible()
    api.request.mockResolvedValueOnce({
      items: [
        makeItem({
          id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
          action: "desktop_device_paired",
        }),
      ],
    })
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.retry") })
    )

    expect(
      await screen.findByText(audit.actions.desktop_device_paired)
    ).toBeVisible()
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it("shows a localized inline unavailable state for an older API", async () => {
    api.request.mockRejectedValue(
      new ApiError({ status: 404, errorCode: "API_RESPONSE_INVALID" })
    )
    renderDisclosure(ownerA)
    await expand()

    expect(await screen.findByText(messages.unavailable)).toBeVisible()
    expect(screen.queryByText(messages.loadFailed)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: i18n.t("common.retry") })
    ).not.toBeInTheDocument()
  })

  it("aborts a pending read when the disclosure closes and fetches again on reopen", async () => {
    let signal: AbortSignal | undefined
    let finishFirst!: (value: unknown) => void
    api.request.mockImplementationOnce(
      (_path: string, options: { signal?: AbortSignal }) => {
        signal = options.signal
        return new Promise((resolve) => {
          finishFirst = resolve
        })
      }
    )
    renderDisclosure(ownerA)
    const trigger = await expand()
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))
    expect(trigger).toHaveAttribute("aria-expanded", "true")

    trigger.focus()
    await userEvent.keyboard("{Enter}")
    expect(trigger).toHaveAttribute("aria-expanded", "false")
    await waitFor(() => expect(signal?.aborted).toBe(true))

    await act(async () => {
      finishFirst({ items: [makeItem({ action: "desktop_device_paired" })] })
    })
    expect(
      screen.queryByText(audit.actions.desktop_device_paired)
    ).not.toBeInTheDocument()

    api.request.mockResolvedValueOnce({
      items: [
        makeItem({
          id: "8b7c6d5e-4f3a-4b2c-8d1e-9f0a1b2c3d4e",
          action: "computer_session_started",
        }),
      ],
    })
    await userEvent.click(trigger)

    expect(
      await screen.findByText(audit.actions.computer_session_started)
    ).toBeVisible()
    expect(
      screen.queryByText(audit.actions.desktop_device_paired)
    ).not.toBeInTheDocument()
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it("drops the old account's data and does not read until the new disclosure is expanded", async () => {
    api.request.mockResolvedValueOnce({
      items: [
        makeItem({
          id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
          action: "desktop_device_paired",
        }),
      ],
    })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const view = renderDisclosure(ownerA, client)
    await expand()
    expect(
      await screen.findByText(audit.actions.desktop_device_paired)
    ).toBeVisible()

    rerenderDisclosure(view, ownerB, client)

    expect(
      screen.queryByText(audit.actions.desktop_device_paired)
    ).not.toBeInTheDocument()
    expect(disclosureTrigger()).toHaveAttribute("aria-expanded", "false")
    expect(api.request).toHaveBeenCalledTimes(1)

    api.request.mockResolvedValueOnce({
      items: [
        makeItem({
          id: "8b7c6d5e-4f3a-4b2c-8d1e-9f0a1b2c3d4e",
          action: "computer_session_started",
        }),
      ],
    })
    await expand()
    expect(
      await screen.findByText(audit.actions.computer_session_started)
    ).toBeVisible()
    expect(
      screen.queryByText(audit.actions.desktop_device_paired)
    ).not.toBeInTheDocument()
    expect(api.request).toHaveBeenCalledTimes(2)

    rerenderDisclosure(view, undefined, client)
    expect(
      screen.queryByText(audit.actions.computer_session_started)
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: messages.title })
    ).not.toBeInTheDocument()
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it("ignores a late response from the previous account", async () => {
    let signal: AbortSignal | undefined
    let finishA!: (value: unknown) => void
    api.request.mockImplementationOnce(
      (_path: string, options: { signal?: AbortSignal }) => {
        signal = options.signal
        return new Promise((resolve) => {
          finishA = resolve
        })
      }
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const view = renderDisclosure(ownerA, client)
    await expand()
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))

    rerenderDisclosure(view, ownerB, client)

    await waitFor(() => expect(signal?.aborted).toBe(true))
    expect(disclosureTrigger()).toHaveAttribute("aria-expanded", "false")
    expect(api.request).toHaveBeenCalledTimes(1)

    await act(async () => {
      finishA({ items: [makeItem({ action: "desktop_device_paired" })] })
    })
    expect(
      screen.queryByText(audit.actions.desktop_device_paired)
    ).not.toBeInTheDocument()
    expect(api.request).toHaveBeenCalledTimes(1)

    api.request.mockResolvedValueOnce({
      items: [
        makeItem({
          id: "8b7c6d5e-4f3a-4b2c-8d1e-9f0a1b2c3d4e",
          action: "computer_session_started",
        }),
      ],
    })
    await expand()
    expect(
      await screen.findByText(audit.actions.computer_session_started)
    ).toBeVisible()
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it("does not fetch or show stale data after a same-ID login replacement until reopened", async () => {
    api.request.mockResolvedValueOnce({
      items: [
        makeItem({
          id: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
          action: "desktop_device_paired",
        }),
      ],
    })
    renderDisclosure(ownerA)
    await expand()
    expect(
      await screen.findByText(audit.actions.desktop_device_paired)
    ).toBeVisible()
    const firstBoundary = api.request.mock.calls[0]?.[1] as {
      loginSessionBoundary: number
    }

    act(() => {
      beginLoginSession("sign-in")
    })

    expect(
      screen.queryByText(audit.actions.desktop_device_paired)
    ).not.toBeInTheDocument()
    expect(disclosureTrigger()).toHaveAttribute("aria-expanded", "false")
    expect(api.request).toHaveBeenCalledTimes(1)

    api.request.mockResolvedValueOnce({
      items: [
        makeItem({
          id: "8b7c6d5e-4f3a-4b2c-8d1e-9f0a1b2c3d4e",
          action: "computer_session_started",
        }),
      ],
    })
    await expand()
    expect(
      await screen.findByText(audit.actions.computer_session_started)
    ).toBeVisible()
    expect(api.request).toHaveBeenCalledTimes(2)
    const replacement = api.request.mock.calls[1]?.[1] as {
      loginSessionBoundary: number
    }
    expect(replacement.loginSessionBoundary).toBeGreaterThan(
      firstBoundary.loginSessionBoundary
    )

    act(() => {
      beginLoginSession("sign-out")
    })
    expect(
      screen.queryByText(audit.actions.computer_session_started)
    ).not.toBeInTheDocument()
    expect(api.request).toHaveBeenCalledTimes(2)
  })

  it("passes TanStack's cancellation signal to the read", async () => {
    let signal: AbortSignal | undefined
    api.request.mockImplementationOnce(
      (_path: string, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal = options.signal
          options.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          )
        })
    )
    const view = renderDisclosure(ownerA)
    await expand()
    await waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))

    view.unmount()
    await waitFor(() => expect(signal?.aborted).toBe(true))
  })
})
