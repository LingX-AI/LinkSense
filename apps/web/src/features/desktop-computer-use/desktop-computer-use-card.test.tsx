import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopComputerUseCardProps } from "./desktop-computer-use-card"

const host = vi.hoisted(() => ({ mac: true }))

const device = vi.hoisted(() => ({ read: vi.fn() }))

const control = vi.hoisted(() => ({
  call: vi.fn(),
  with: vi.fn(),
}))

const permission = vi.hoisted(() => ({ check: vi.fn() }))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => host.mac,
}))

vi.mock("@/adapters/desktop/desktop-device-adapter", () => ({
  readDesktopDeviceStatus: device.read,
}))

vi.mock("@/adapters/desktop/mygo", () => ({
  Desktop: {
    computerControl: Object.assign(control.call, {
      with: control.with,
    }),
  },
}))

vi.mock(
  "@/features/desktop-computer-permissions/computer-permission-adapter",
  () => ({ checkComputerPermission: permission.check })
)

vi.mock(
  "@/features/desktop-computer-permissions/desktop-computer-permission-guide",
  async () => {
    const { createElement } = await import("react")
    return {
      DesktopComputerPermissionGuide: ({
        open,
        kind,
      }: {
        open: boolean
        kind: string
      }) =>
        open
          ? createElement("div", {
              "data-testid": "permission-guide",
              "data-kind": kind,
            })
          : null,
    }
  }
)

import i18n from "@/i18n"
import { desktopDeviceStatusQueryKey } from "@/features/desktop-devices/use-desktop-device-status"
import { DesktopComputerUseCard } from "./desktop-computer-use-card"
import { desktopComputerUseMessages } from "./messages"

const messages = desktopComputerUseMessages["en-US"]

const conversationId = "20000000-0000-4000-8000-000000000001"
const turnA = "30000000-0000-4000-8000-000000000002"
const turnB = "30000000-0000-4000-8000-000000000003"
const deviceId = "40000000-0000-4000-8000-000000000004"
const otherDeviceId = "40000000-0000-4000-8000-000000000005"
const ownerId = "50000000-0000-4000-8000-000000000006"
const otherOwnerId = "50000000-0000-4000-8000-000000000007"

function futureExpiry(): string {
  return new Date(Date.now() + 5 * 60_000).toISOString()
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason?: unknown) => void = () => undefined
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function readyDevice(overrides: Record<string, unknown> = {}) {
  return {
    state: "online",
    deviceId,
    executionReady: true,
    computerReady: true,
    ...overrides,
  }
}

function newClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createCardView(
  initial: Partial<DesktopComputerUseCardProps> = {},
  client = newClient()
) {
  const base: DesktopComputerUseCardProps = {
    ownerId,
    conversationId,
    turnId: turnA,
    deviceId,
    executionTarget: "local",
    ...initial,
  }
  function tree(props: DesktopComputerUseCardProps) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <DesktopComputerUseCard {...props} />
        </QueryClientProvider>
      </I18nextProvider>
    )
  }
  const view = render(tree(base))
  return {
    ...view,
    client,
    props: base,
    rerenderCard(next: Partial<DesktopComputerUseCardProps>) {
      view.rerender(tree({ ...base, ...next }))
    },
  }
}

function card() {
  return screen.getByTestId("desktop-computer-use-card")
}

function statusText() {
  return screen.getByTestId("desktop-computer-use-status")
}

function actionsOf(action: string): unknown[][] {
  return control.call.mock.calls.filter(([, , name]) => name === action)
}

function signalAt(withCallIndex: number): AbortSignal {
  return (
    control.with.mock.calls[withCallIndex]?.[0] as
      { signal: AbortSignal } | undefined
  )?.signal as AbortSignal
}

function statusCalls(): number {
  return actionsOf("status").length
}

async function waitForIdleCard() {
  await waitFor(() =>
    expect(statusText()).toHaveTextContent(messages.statusIdle)
  )
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
  host.mac = true
  device.read.mockReset().mockResolvedValue(readyDevice())
  control.call.mockReset()
  control.with.mockReset().mockImplementation(() => control.call)
  control.call.mockImplementation(
    (_conversation: string, _turn: string, action: string) =>
      Promise.resolve(
        action === "status" ? { state: "idle" } : { state: "idle" }
      )
  )
  permission.check.mockReset().mockResolvedValue({
    kind: "accessibility",
    status: "granted",
    reason: "checked",
  })
})

afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  vi.clearAllMocks()
})

describe("Desktop Computer Use card eligibility", () => {
  it("renders nothing outside a macOS host and never reads the device", () => {
    host.mac = false
    createCardView()
    expect(screen.queryByTestId("desktop-computer-use-card")).toBeNull()
    expect(device.read).not.toHaveBeenCalled()
    expect(control.call).not.toHaveBeenCalled()
  })

  it("omits controls when the host has not negotiated computer use", async () => {
    device.read.mockResolvedValue({
      state: "online",
      deviceId,
      executionReady: true,
    })
    createCardView()
    await waitFor(() => expect(device.read).toHaveBeenCalledOnce())
    expect(screen.queryByTestId("desktop-computer-use-card")).toBeNull()
    expect(control.call).not.toHaveBeenCalled()
  })

  it("omits controls for a cloud conversation", () => {
    createCardView({ executionTarget: "cloud" })
    expect(screen.queryByTestId("desktop-computer-use-card")).toBeNull()
    expect(device.read).not.toHaveBeenCalled()
  })

  it("omits controls when the online Mac is not this conversation's device", async () => {
    createCardView({ deviceId: otherDeviceId })
    await waitFor(() => expect(device.read).toHaveBeenCalledOnce())
    expect(screen.queryByTestId("desktop-computer-use-card")).toBeNull()
    expect(control.call).not.toHaveBeenCalled()
  })

  it("requires the conversation's persisted device id", async () => {
    createCardView({ deviceId: null })
    await waitFor(() => expect(device.read).toHaveBeenCalledOnce())
    expect(screen.queryByTestId("desktop-computer-use-card")).toBeNull()
    expect(control.call).not.toHaveBeenCalled()
  })

  it("omits controls for a malformed persisted device id", async () => {
    createCardView({ deviceId: "this-mac" })
    await waitFor(() => expect(device.read).toHaveBeenCalledOnce())
    expect(screen.queryByTestId("desktop-computer-use-card")).toBeNull()
    expect(control.call).not.toHaveBeenCalled()
  })

  it("omits controls for an optimistic turn id", async () => {
    createCardView({ turnId: "pending-turn" })
    await waitFor(() => expect(device.read).toHaveBeenCalledOnce())
    expect(screen.queryByTestId("desktop-computer-use-card")).toBeNull()
    expect(control.call).not.toHaveBeenCalled()
  })
})

describe("Desktop Computer Use native approval presentation", () => {
  it("does not check permissions or start selection before an explicit click", async () => {
    createCardView()
    await waitForIdleCard()
    expect(statusText()).toHaveTextContent(messages.statusIdle)
    expect(permission.check).not.toHaveBeenCalled()
    expect(actionsOf("select")).toHaveLength(0)
    expect(
      screen.queryByRole("button", { name: messages.renewAction })
    ).toBeNull()
  })

  it("checks only Accessibility, then opens the native picker on grant", async () => {
    const interaction = userEvent.setup()
    createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    await waitFor(() =>
      expect(control.call).toHaveBeenCalledWith(conversationId, turnA, "select")
    )
    expect(permission.check).toHaveBeenCalledOnce()
    expect(permission.check).toHaveBeenCalledWith(
      "accessibility",
      expect.any(AbortSignal)
    )
    expect(screen.queryByTestId("permission-guide")).toBeNull()
    // No synthetic approval plane: the native picker owns Allow/Cancel, and
    // this chat never lists windows.
    expect(screen.queryByRole("button", { name: "Allow" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
  })

  it("rejects duplicate selection requests", async () => {
    const checked = deferred<{
      kind: "accessibility"
      status: "granted"
      reason: "checked"
    }>()
    permission.check.mockReturnValue(checked.promise)
    createCardView()
    await waitForIdleCard()
    const selectButton = screen.getByRole("button", {
      name: messages.selectAction,
    })
    fireEvent.click(selectButton)
    fireEvent.click(selectButton)
    await waitFor(() => expect(permission.check).toHaveBeenCalledOnce())
    await act(async () => {
      checked.resolve({
        kind: "accessibility",
        status: "granted",
        reason: "checked",
      })
    })
    await waitFor(() =>
      expect(control.call).toHaveBeenCalledWith(conversationId, turnA, "select")
    )
    expect(actionsOf("select")).toHaveLength(1)
  })

  it("opens the existing permission guide when Accessibility is missing", async () => {
    permission.check.mockResolvedValue({
      kind: "accessibility",
      status: "notGranted",
      reason: "checked",
    })
    const interaction = userEvent.setup()
    createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    const guide = await screen.findByTestId("permission-guide")
    expect(guide).toHaveAttribute("data-kind", "accessibility")
    expect(actionsOf("select")).toHaveLength(0)
    for (const call of permission.check.mock.calls) {
      expect(call[0]).toBe("accessibility")
    }
    expect(
      permission.check.mock.calls.some(([kind]) => kind === "screenRecording")
    ).toBe(false)
  })

  it("does not select from a permission check that outlived turn A", async () => {
    const checked = deferred<{
      kind: "accessibility"
      status: "granted"
      reason: "checked"
    }>()
    permission.check.mockReturnValue(checked.promise)
    const interaction = userEvent.setup()
    const view = createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    await waitFor(() => expect(permission.check).toHaveBeenCalledOnce())

    view.rerenderCard({ turnId: turnB })
    await waitFor(() => expect(statusCalls()).toBe(2))
    view.rerenderCard({ turnId: turnA })
    await waitFor(() => expect(statusCalls()).toBe(3))

    await act(async () => {
      checked.resolve({
        kind: "accessibility",
        status: "granted",
        reason: "checked",
      })
    })
    expect(actionsOf("select")).toHaveLength(0)
    expect(card()).toHaveAttribute("data-state", "idle")
  })
})

describe("Desktop Computer Use states and controls", () => {
  it("shows active with a countdown and waits for the native pause to clear", async () => {
    const expiresAt = futureExpiry()
    const paused = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status")
          return Promise.resolve({ state: "active", expiresAt })
        if (action === "pause") return paused.promise
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    expect(
      screen.getByTestId("desktop-computer-use-countdown")
    ).toHaveTextContent(/05:00|04:59|04:58/u)

    await interaction.click(
      screen.getByRole("button", { name: messages.pauseAction })
    )
    const pausing = screen.getByRole("button", {
      name: messages.pausing,
    })
    expect(pausing).toBeDisabled()
    expect(statusText()).toHaveTextContent(messages.statusActive)
    expect(control.call).toHaveBeenCalledWith(conversationId, turnA, "pause")

    await act(async () => {
      paused.resolve({ state: "paused", expiresAt })
    })
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusPaused)
    )
    expect(
      screen.getByRole("button", { name: messages.resumeAction })
    ).toBeEnabled()
  })

  it("resumes only after an explicit click", async () => {
    const expiresAt = futureExpiry()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "status"
          ? Promise.resolve({ state: "paused", expiresAt })
          : Promise.resolve({ state: "active", expiresAt })
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusPaused)
    )
    expect(actionsOf("resume")).toHaveLength(0)
    expect(
      screen.queryByRole("button", { name: messages.renewAction })
    ).toBeNull()

    await interaction.click(
      screen.getByRole("button", { name: messages.resumeAction })
    )
    await waitFor(() =>
      expect(control.call).toHaveBeenCalledWith(conversationId, turnA, "resume")
    )
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    expect(
      screen.getByRole("button", { name: messages.renewAction })
    ).toBeVisible()
    expect(actionsOf("renew")).toHaveLength(0)
  })

  it("stops and shows local GUI control stopped", async () => {
    const expiresAt = futureExpiry()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "status"
          ? Promise.resolve({ state: "active", expiresAt })
          : Promise.resolve({ state: "stopped" })
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    await interaction.click(
      screen.getByRole("button", { name: messages.stopAction })
    )
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusStopped)
    )
    expect(screen.getByText("GUI control stopped on this Mac.")).toBeVisible()
    expect(card()).not.toHaveTextContent(/revok|authorization/iu)
    expect(
      screen.getByRole("button", { name: messages.selectAction })
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: messages.resumeAction })
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: messages.renewAction })
    ).toBeNull()
  })

  it("treats an elapsed grant as expired and offers a new selection", async () => {
    control.call.mockImplementation(() =>
      Promise.resolve({
        state: "active",
        expiresAt: "2020-01-01T00:00:00.000Z",
      })
    )
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusExpired)
    )
    expect(
      screen.getByRole("button", { name: messages.selectAction })
    ).toBeVisible()
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: messages.renewAction })
    ).toBeNull()
  })

  it("rejects duplicate pause requests", async () => {
    const expiresAt = futureExpiry()
    const paused = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status")
          return Promise.resolve({ state: "active", expiresAt })
        if (action === "pause") return paused.promise
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    const pauseButton = screen.getByRole("button", {
      name: messages.pauseAction,
    })
    fireEvent.click(pauseButton)
    fireEvent.click(pauseButton)
    await waitFor(() => expect(actionsOf("pause")).toHaveLength(1))
    await act(async () => {
      paused.resolve({ state: "paused", expiresAt })
    })
  })

  it("fails closed when an active status has no expiry", async () => {
    control.call.mockImplementation(() => Promise.resolve({ state: "active" }))
    createCardView()
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorInvalidResponse)
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
    expect(statusText()).toHaveTextContent(messages.statusUnavailable)
  })

  it("reports an unconfirmed pause, refreshes status once, and never retries the pause", async () => {
    const expiresAt = futureExpiry()
    let statusReads = 0
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          statusReads += 1
          return Promise.resolve(
            statusReads === 1
              ? { state: "active", expiresAt }
              : { state: "paused", expiresAt }
          )
        }
        if (action === "pause") {
          return Promise.reject(new Error("COMPUTER_TIMEOUT"))
        }
        return Promise.resolve({ state: "idle" })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    await interaction.click(
      screen.getByRole("button", { name: messages.pauseAction })
    )
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorTimeout)
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusPaused)
    )
    expect(actionsOf("pause")).toHaveLength(1)
    expect(statusCalls()).toBe(2)
  })

  it("returns quietly when the native picker is canceled", async () => {
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "select"
          ? Promise.reject(new Error("COMPUTER_CANCELED"))
          : Promise.resolve({ state: "idle" })
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    await waitFor(() => expect(actionsOf("select")).toHaveLength(1))
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: messages.selectAction })
      ).toBeEnabled()
    )
    expect(screen.queryByTestId("desktop-computer-use-error")).toBeNull()
    expect(statusText()).toHaveTextContent(messages.statusIdle)
  })
})

describe("Desktop Computer Use offline WebView", () => {
  it("keeps status polling and Pause and Stop on IPC while the WebView is offline", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const expiresAt = futureExpiry()
      let nativeState: "active" | "paused" | "stopped" = "active"
      control.call.mockImplementation(
        (_conversation: string, _turn: string, action: string) => {
          if (action === "status") {
            return Promise.resolve(
              nativeState === "active"
                ? { state: "active", expiresAt }
                : nativeState === "paused"
                  ? { state: "paused", expiresAt }
                  : { state: "stopped" }
            )
          }
          if (action === "pause") {
            nativeState = "paused"
            return Promise.resolve({ state: "paused", expiresAt })
          }
          if (action === "stop") {
            nativeState = "stopped"
            return Promise.resolve({ state: "stopped" })
          }
          return Promise.resolve({ state: "active", expiresAt })
        }
      )
      createCardView()
      await waitFor(() =>
        expect(statusText()).toHaveTextContent(messages.statusActive)
      )
      expect(statusCalls()).toBe(1)

      // The WebView reports offline while Go still owns the local link; native
      // reads and actions must not wait for a WebView reconnect.
      act(() => {
        onlineManager.setOnline(false)
      })

      fireEvent.click(
        screen.getByRole("button", { name: messages.pauseAction })
      )
      await waitFor(() => expect(actionsOf("pause")).toHaveLength(1))
      await waitFor(() =>
        expect(statusText()).toHaveTextContent(messages.statusPaused)
      )

      // The 10 s poll is a native bridge read, not a server request, so it must
      // keep running while the WebView is offline.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(statusCalls()).toBe(2)
      expect(actionsOf("pause")).toHaveLength(1)

      fireEvent.click(screen.getByRole("button", { name: messages.stopAction }))
      await waitFor(() => expect(actionsOf("stop")).toHaveLength(1))
      await waitFor(() =>
        expect(statusText()).toHaveTextContent(messages.statusStopped)
      )

      // A reconnect must not replay any action: each one already reached IPC.
      await act(async () => {
        onlineManager.setOnline(true)
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(actionsOf("pause")).toHaveLength(1)
      expect(actionsOf("stop")).toHaveLength(1)
      expect(statusText()).toHaveTextContent(messages.statusStopped)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("Desktop Computer Use renewal", () => {
  it("renews the current active grant only after an explicit click", async () => {
    const firstExpiry = new Date(Date.now() + 2 * 60_000).toISOString()
    const renewedExpiry = new Date(Date.now() + 5 * 60_000).toISOString()
    const renewed = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status")
          return Promise.resolve({ state: "active", expiresAt: firstExpiry })
        if (action === "renew") return renewed.promise
        return Promise.resolve({ state: "active", expiresAt: firstExpiry })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    expect(permission.check).not.toHaveBeenCalled()
    expect(actionsOf("renew")).toHaveLength(0)
    expect(
      screen.getByTestId("desktop-computer-use-countdown")
    ).toHaveTextContent(/02:00|01:59|01:58/u)
    expect(
      screen.getByRole("button", { name: messages.stopAction })
    ).toBeVisible()

    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() =>
      expect(control.call).toHaveBeenCalledWith(conversationId, turnA, "renew")
    )
    expect(
      screen.getByRole("button", { name: messages.renewing })
    ).toBeDisabled()
    // Stop stays available: native cancels the exact-scope renewal wait and
    // closes input synchronously instead of making the user wait for its ack.
    expect(
      screen.getByRole("button", { name: messages.stopAction })
    ).toBeEnabled()
    expect(permission.check).not.toHaveBeenCalled()
    expect(
      screen.getByTestId("desktop-computer-use-countdown")
    ).toHaveTextContent(/02:00|01:59|01:58/u)

    await act(async () => {
      renewed.resolve({ state: "active", expiresAt: renewedExpiry })
    })
    await waitFor(() =>
      expect(
        screen.getByTestId("desktop-computer-use-countdown")
      ).toHaveTextContent(/05:00|04:59|04:58/u)
    )
    expect(statusText()).toHaveTextContent(messages.statusActive)
    expect(
      screen.getByRole("button", { name: messages.renewAction })
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: messages.stopAction })
    ).toBeEnabled()
    expect(actionsOf("renew")).toHaveLength(1)
  })

  it("keeps an acknowledged expiry when a poll started during renewal resolves later", async () => {
    vi.useFakeTimers()
    try {
      const oldExpiry = new Date(Date.now() + 2 * 60_000).toISOString()
      const newExpiry = new Date(Date.now() + 5 * 60_000).toISOString()
      const stalePoll = deferred<{ state: string; expiresAt: string }>()
      const renewed = deferred<{ state: string; expiresAt: string }>()
      let statusReads = 0
      control.call.mockImplementation(
        (_conversation: string, _turn: string, action: string) => {
          if (action === "status") {
            statusReads += 1
            return statusReads === 1
              ? Promise.resolve({ state: "active", expiresAt: oldExpiry })
              : stalePoll.promise
          }
          if (action === "renew") return renewed.promise
          return Promise.resolve({ state: "active", expiresAt: oldExpiry })
        }
      )
      async function settle() {
        // Each render may start the next query, whose observer notification is
        // scheduled as a zero-delay task; drain those turns explicitly.
        for (let turn = 0; turn < 4; turn += 1) {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1)
          })
        }
      }
      createCardView()
      await settle()
      expect(statusText()).toHaveTextContent(messages.statusActive)
      expect(
        screen.getByTestId("desktop-computer-use-countdown")
      ).toHaveAttribute("dateTime", oldExpiry)

      fireEvent.click(
        screen.getByRole("button", { name: messages.renewAction })
      )
      await settle()
      expect(actionsOf("renew")).toHaveLength(1)

      // The 10 s poll starts while the renewal still waits for its native
      // acknowledgement; the action-start cancellation cannot cover a read
      // that begins after it. Native may snapshot the old expiry for it.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(statusCalls()).toBe(2)
      expect(actionsOf("renew")).toHaveLength(1)

      await act(async () => {
        renewed.resolve({ state: "active", expiresAt: newExpiry })
      })
      await settle()
      expect(
        screen.getByTestId("desktop-computer-use-countdown")
      ).toHaveAttribute("dateTime", newExpiry)

      // The stale read resolves last with its older native snapshot. It must
      // not overwrite the acknowledged expiry or retry the action.
      await act(async () => {
        stalePoll.resolve({ state: "active", expiresAt: oldExpiry })
      })
      await settle()
      expect(
        screen.getByTestId("desktop-computer-use-countdown")
      ).toHaveAttribute("dateTime", newExpiry)
      expect(statusText()).toHaveTextContent(messages.statusActive)
      expect(actionsOf("renew")).toHaveLength(1)
      expect(statusCalls()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ["COMPUTER_BUSY", messages.errorBusy],
    ["FORBIDDEN", messages.errorForbidden],
  ])(
    "keeps the active grant unchanged without a refresh when renewal is refused with %s",
    async (nativeError, errorCopy) => {
      const expiresAt = futureExpiry()
      control.call.mockImplementation(
        (_conversation: string, _turn: string, action: string) =>
          action === "status"
            ? Promise.resolve({ state: "active", expiresAt })
            : Promise.reject(new Error(nativeError))
      )
      const interaction = userEvent.setup()
      createCardView()
      await waitFor(() =>
        expect(statusText()).toHaveTextContent(messages.statusActive)
      )

      await interaction.click(
        screen.getByRole("button", { name: messages.renewAction })
      )
      expect(
        await screen.findByTestId("desktop-computer-use-error")
      ).toHaveTextContent(errorCopy)
      expect(statusText()).toHaveTextContent(messages.statusActive)
      expect(
        screen.getByTestId("desktop-computer-use-countdown")
      ).toHaveTextContent(/05:00|04:59|04:58|04:57/u)
      expect(
        screen.getByRole("button", { name: messages.renewAction })
      ).toBeEnabled()
      expect(
        screen.getByRole("button", { name: messages.stopAction })
      ).toBeVisible()
      expect(actionsOf("renew")).toHaveLength(1)
      expect(statusCalls()).toBe(1)
    }
  )

  it("reconciles an uncertain renewal timeout with one immediate status read", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    let statusReads = 0
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          statusReads += 1
          return Promise.resolve(
            statusReads === 1
              ? { state: "active", expiresAt }
              : { state: "retiring" }
          )
        }
        if (action === "renew") {
          return Promise.reject(new Error("COMPUTER_TIMEOUT"))
        }
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    expect(
      screen.getByTestId("desktop-computer-use-countdown")
    ).toHaveTextContent(/02:00|01:59|01:58/u)

    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorTimeout)
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusRetiring)
    )

    // The second read is the reconciliation; the 10 s poll has not run yet.
    expect(statusCalls()).toBe(2)
    expect(actionsOf("renew")).toHaveLength(1)
    expect(card()).toHaveAttribute("data-state", "retiring")
    expect(screen.queryByTestId("desktop-computer-use-countdown")).toBeNull()
    for (const name of [
      messages.selectAction,
      messages.pauseAction,
      messages.resumeAction,
      messages.renewAction,
      messages.stopAction,
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull()
    }
  })

  it("reconciles a renewal reported unavailable with one immediate status read", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    let statusReads = 0
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          statusReads += 1
          return Promise.resolve(
            statusReads === 1
              ? { state: "active", expiresAt }
              : { state: "retiring" }
          )
        }
        if (action === "renew") {
          // The real adapter maps this native wire error to `unavailable`; Go
          // uses it for a malformed or ambiguous acknowledgement after it has
          // already retired the local selection.
          return Promise.reject(new Error("COMPUTER_UNAVAILABLE"))
        }
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    expect(
      screen.getByTestId("desktop-computer-use-countdown")
    ).toHaveTextContent(/02:00|01:59|01:58/u)

    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorUnavailable)
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusRetiring)
    )

    // The second read is the reconciliation; the 10 s poll has not run yet.
    expect(statusCalls()).toBe(2)
    expect(actionsOf("renew")).toHaveLength(1)
    expect(card()).toHaveAttribute("data-state", "retiring")
    expect(screen.queryByTestId("desktop-computer-use-countdown")).toBeNull()
  })

  it("ignores a renewal acknowledgement without a bounded expiry", async () => {
    const expiresAt = futureExpiry()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "status"
          ? Promise.resolve({ state: "active", expiresAt })
          : Promise.resolve({ state: "active" })
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorInvalidResponse)
    expect(statusText()).toHaveTextContent(messages.statusActive)
    expect(
      screen.getByTestId("desktop-computer-use-countdown")
    ).toHaveTextContent(/05:00|04:59|04:58|04:57/u)
    expect(
      screen.getByRole("button", { name: messages.renewAction })
    ).toBeEnabled()
  })

  it("never applies a renewal acknowledged for another turn", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    const renewed = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, turn: string, action: string) => {
        if (action === "status") {
          return Promise.resolve(
            turn === turnA ? { state: "active", expiresAt } : { state: "idle" }
          )
        }
        if (action === "renew" && turn === turnA) return renewed.promise
        return Promise.resolve({ state: "idle" })
      }
    )
    const interaction = userEvent.setup()
    const view = createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() => expect(actionsOf("renew")).toHaveLength(1))
    expect(control.call).toHaveBeenCalledWith(conversationId, turnA, "renew")

    view.rerenderCard({ turnId: turnB })
    await waitFor(() => expect(statusCalls()).toBe(2))
    await waitForIdleCard()

    await act(async () => {
      renewed.resolve({
        state: "active",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
    })
    expect(card()).toHaveAttribute("data-state", "idle")
    expect(statusText()).toHaveTextContent(messages.statusIdle)
    expect(screen.queryByTestId("desktop-computer-use-countdown")).toBeNull()
    expect(
      screen.queryByRole("button", { name: messages.renewAction })
    ).toBeNull()
  })
})

describe("Desktop Computer Use stop supersedes renewal", () => {
  function renewThenStop(expiresAt: string) {
    const renewed = deferred<{ state: string; expiresAt: string }>()
    const stopped = deferred<{ state: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status")
          return Promise.resolve({ state: "active", expiresAt })
        if (action === "renew") return renewed.promise
        if (action === "stop") return stopped.promise
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    return { renewed, stopped }
  }

  it("keeps Stop available, supersedes the renewal once, and ignores its late ack", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    const renewedExpiry = new Date(Date.now() + 5 * 60_000).toISOString()
    const { renewed, stopped } = renewThenStop(expiresAt)
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )

    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() => expect(actionsOf("renew")).toHaveLength(1))
    expect(
      screen.getByRole("button", { name: messages.renewing })
    ).toBeDisabled()
    const renewWithIndex = control.with.mock.calls.length - 1
    const renewSignal = signalAt(renewWithIndex)
    expect(renewSignal.aborted).toBe(false)

    const stopButton = screen.getByRole("button", {
      name: messages.stopAction,
    })
    expect(stopButton).toBeEnabled()
    const stopWithIndex = control.with.mock.calls.length
    fireEvent.click(stopButton)
    fireEvent.click(stopButton)
    await waitFor(() => expect(actionsOf("stop")).toHaveLength(1))

    // Web must not abort the dispatched renewal: MyGo turns an abort into a
    // separate bridge cancel that native can observe before Stop takes its
    // lock, retiring the selection without sending the stop revocation. Native
    // Stop owns the cancellation and ordering; request identity suppresses the
    // superseded reply.
    expect(renewSignal.aborted).toBe(false)
    expect(signalAt(stopWithIndex).aborted).toBe(false)
    expect(
      control.call.mock.calls.findIndex(([, , name]) => name === "renew")
    ).toBeLessThan(
      control.call.mock.calls.findIndex(([, , name]) => name === "stop")
    )
    expect(
      screen.getByRole("button", { name: messages.stopping })
    ).toBeDisabled()
    expect(actionsOf("stop")).toHaveLength(1)

    // The native renewal may acknowledge after its wait was canceled. That
    // reply belongs to the superseded request and must not rewrite the grant
    // while the one Stop is in flight.
    await act(async () => {
      renewed.resolve({ state: "active", expiresAt: renewedExpiry })
    })
    expect(card()).toHaveAttribute("data-state", "active")
    expect(
      screen.getByTestId("desktop-computer-use-countdown")
    ).toHaveTextContent(/02:00|01:59|01:58/u)
    expect(screen.queryByTestId("desktop-computer-use-error")).toBeNull()
    expect(actionsOf("stop")).toHaveLength(1)

    await act(async () => {
      stopped.resolve({ state: "stopped" })
    })
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusStopped)
    )
    expect(screen.queryByTestId("desktop-computer-use-countdown")).toBeNull()
    expect(
      screen.getByRole("button", { name: messages.selectAction })
    ).toBeVisible()
    expect(actionsOf("stop")).toHaveLength(1)
  })

  it("lets native Stop cancel the renewal so the stop still revokes", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    let renewalSignal: AbortSignal | undefined
    let revoked = false
    const renewed = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          return Promise.resolve({ state: "active", expiresAt })
        }
        if (action === "renew") {
          renewalSignal = signalAt(control.with.mock.calls.length - 1)
          return renewed.promise
        }
        if (action === "stop") {
          // MyGo sends a separate cancel when Web aborts a dispatched call.
          // If native observes that cancel before Stop acquires its lock, the
          // renewal handler retires the selection and Stop only waits; the
          // service revocation is never sent.
          if (renewalSignal?.aborted) {
            return Promise.resolve({ state: "retiring" })
          }
          revoked = true
          renewed.resolve({ state: "active", expiresAt })
          return Promise.resolve({ state: "stopped" })
        }
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() => expect(actionsOf("renew")).toHaveLength(1))
    await interaction.click(
      screen.getByRole("button", { name: messages.stopAction })
    )
    await waitFor(() => expect(actionsOf("stop")).toHaveLength(1))

    expect(revoked).toBe(true)
    expect(renewalSignal?.aborted).toBe(false)
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusStopped)
    )
    expect(actionsOf("renew")).toHaveLength(1)
    expect(actionsOf("stop")).toHaveLength(1)
  })

  it("does not dispatch a renewal that Stop supersedes before it starts", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          return Promise.resolve({ state: "active", expiresAt })
        }
        if (action === "stop") return Promise.resolve({ state: "stopped" })
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    const renewButton = screen.getByRole("button", {
      name: messages.renewAction,
    })
    const stopButton = screen.getByRole("button", {
      name: messages.stopAction,
    })
    fireEvent.click(renewButton)
    fireEvent.click(stopButton)

    // The renewal's mutationFn runs after its onMutate yields; by then Stop
    // owns the request identity, so the obsolete bridge call is never sent.
    await waitFor(() => expect(actionsOf("stop")).toHaveLength(1))
    expect(actionsOf("renew")).toHaveLength(0)
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusStopped)
    )
    expect(actionsOf("stop")).toHaveLength(1)
  })

  it("does not reconcile a superseded renewal failure after Stop takes over", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    const renewed = deferred<{ state: string; expiresAt: string }>()
    const stopped = deferred<{ state: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          return Promise.resolve({ state: "active", expiresAt })
        }
        if (action === "renew") return renewed.promise
        if (action === "stop") return stopped.promise
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )
    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() => expect(actionsOf("renew")).toHaveLength(1))
    await interaction.click(
      screen.getByRole("button", { name: messages.stopAction })
    )
    await waitFor(() => expect(actionsOf("stop")).toHaveLength(1))

    // Native reports a malformed or ambiguous renewal acknowledgement as
    // COMPUTER_UNAVAILABLE after retiring locally. The superseded renewal must
    // not trigger its reconciliation read or feedback once Stop owns the scope.
    await act(async () => {
      renewed.reject(new Error("COMPUTER_UNAVAILABLE"))
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(statusCalls()).toBe(1)
    expect(actionsOf("renew")).toHaveLength(1)
    expect(actionsOf("stop")).toHaveLength(1)
    expect(screen.queryByTestId("desktop-computer-use-error")).toBeNull()

    await act(async () => {
      stopped.resolve({ state: "stopped" })
    })
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusStopped)
    )
    expect(statusCalls()).toBe(1)
  })

  it("ignores a renewal acknowledged after the superseding Stop finished", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    const { renewed, stopped } = renewThenStop(expiresAt)
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )

    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() => expect(actionsOf("renew")).toHaveLength(1))
    await interaction.click(
      screen.getByRole("button", { name: messages.stopAction })
    )
    await waitFor(() => expect(actionsOf("stop")).toHaveLength(1))

    await act(async () => {
      stopped.resolve({ state: "stopped" })
    })
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusStopped)
    )

    await act(async () => {
      renewed.resolve({
        state: "active",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
    })
    expect(statusText()).toHaveTextContent(messages.statusStopped)
    expect(card()).toHaveAttribute("data-state", "stopped")
    expect(screen.queryByTestId("desktop-computer-use-countdown")).toBeNull()
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
    expect(actionsOf("stop")).toHaveLength(1)
  })

  it("reconciles a failed Stop through one read-only status refresh", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    const renewed = deferred<{ state: string; expiresAt: string }>()
    let statusReads = 0
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          statusReads += 1
          return Promise.resolve(
            statusReads === 1
              ? { state: "active", expiresAt }
              : { state: "paused", expiresAt }
          )
        }
        if (action === "renew") return renewed.promise
        if (action === "stop") {
          return Promise.reject(new Error("COMPUTER_TIMEOUT"))
        }
        return Promise.resolve({ state: "active", expiresAt })
      }
    )
    const interaction = userEvent.setup()
    createCardView()
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )

    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() => expect(actionsOf("renew")).toHaveLength(1))
    await interaction.click(
      screen.getByRole("button", { name: messages.stopAction })
    )
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorTimeout)
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusPaused)
    )
    expect(actionsOf("stop")).toHaveLength(1)
    expect(statusCalls()).toBe(2)

    await act(async () => {
      renewed.resolve({
        state: "active",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
    })
    expect(statusText()).toHaveTextContent(messages.statusPaused)
    expect(actionsOf("renew")).toHaveLength(1)
  })

  it("ignores late renewal and Stop replies after the card unmounts", async () => {
    const expiresAt = new Date(Date.now() + 2 * 60_000).toISOString()
    const renewed = deferred<{ state: string; expiresAt: string }>()
    const stopped = deferred<{ state: string }>()
    let statusReads = 0
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) => {
        if (action === "status") {
          statusReads += 1
          return Promise.resolve(
            statusReads === 1
              ? { state: "active", expiresAt }
              : { state: "idle" }
          )
        }
        if (action === "renew") return renewed.promise
        if (action === "stop") return stopped.promise
        return Promise.resolve({ state: "idle" })
      }
    )
    const client = newClient()
    const interaction = userEvent.setup()
    const first = createCardView({}, client)
    await waitFor(() =>
      expect(statusText()).toHaveTextContent(messages.statusActive)
    )

    await interaction.click(
      screen.getByRole("button", { name: messages.renewAction })
    )
    await waitFor(() => expect(actionsOf("renew")).toHaveLength(1))
    await interaction.click(
      screen.getByRole("button", { name: messages.stopAction })
    )
    await waitFor(() => expect(actionsOf("stop")).toHaveLength(1))
    first.unmount()

    await act(async () => {
      renewed.resolve({
        state: "active",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
      stopped.resolve({ state: "stopped" })
    })
    await act(async () => {
      await Promise.resolve()
    })

    createCardView({}, client)
    await waitForIdleCard()
    expect(card()).toHaveAttribute("data-state", "idle")
    expect(screen.queryByTestId("desktop-computer-use-error")).toBeNull()
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
    expect(actionsOf("stop")).toHaveLength(1)
  })
})

describe("Desktop Computer Use retirement status", () => {
  it("polls active → timeout → retiring → stopped without another action", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
      let statusReads = 0
      control.call.mockImplementation(
        (_conversation: string, _turn: string, action: string) => {
          if (action === "status") {
            statusReads += 1
            if (statusReads === 1) {
              return Promise.resolve({ state: "active", expiresAt })
            }
            if (statusReads === 2) {
              return Promise.resolve({ state: "retiring" })
            }
            return Promise.resolve({ state: "stopped" })
          }
          if (action === "stop") {
            return Promise.reject(new Error("COMPUTER_TIMEOUT"))
          }
          return Promise.resolve({ state: "active", expiresAt })
        }
      )
      createCardView()
      await waitFor(() =>
        expect(statusText()).toHaveTextContent(messages.statusActive)
      )
      // The hint distinguishes Pause from Stop without claiming a remote
      // revocation that a lost or unsent Stop wire reply never performs.
      expect(
        screen.getByText(
          "Pause stops GUI control only. Stop ends Computer Use for this task on this Mac."
        )
      ).toBeVisible()

      fireEvent.click(screen.getByRole("button", { name: messages.stopAction }))
      expect(
        await screen.findByTestId("desktop-computer-use-error")
      ).toHaveTextContent(messages.errorTimeout)
      await waitFor(() =>
        expect(statusText()).toHaveTextContent(messages.statusRetiring)
      )
      expect(statusCalls()).toBe(2)

      expect(card()).toHaveAttribute("data-state", "retiring")
      // Native publishes `stopped` locally once the exact executor is
      // terminal, even when the Stop reply timed out or no Stop frame was
      // sent, so the copy must describe local GUI control only.
      expect(
        screen.getByText(
          "Stopping GUI control on this Mac. The final state appears when it completes."
        )
      ).toBeVisible()
      expect(card()).not.toHaveTextContent(/revok|authorization/iu)
      expect(screen.queryByTestId("desktop-computer-use-countdown")).toBeNull()
      for (const name of [
        messages.selectAction,
        messages.pauseAction,
        messages.resumeAction,
        messages.renewAction,
        messages.stopAction,
      ]) {
        expect(screen.queryByRole("button", { name })).toBeNull()
      }
      expect(actionsOf("stop")).toHaveLength(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      await waitFor(() =>
        expect(statusText()).toHaveTextContent(messages.statusStopped)
      )
      expect(statusCalls()).toBe(3)
      expect(card()).toHaveAttribute("data-state", "stopped")
      expect(screen.getByText("GUI control stopped on this Mac.")).toBeVisible()
      expect(card()).not.toHaveTextContent(/revok|authorization/iu)
      // The unconfirmed Stop result stays visible after local retirement.
      expect(
        screen.getByTestId("desktop-computer-use-error")
      ).toHaveTextContent(
        "Couldn’t confirm the Computer Use result. The status shown may be out of date."
      )
      expect(
        screen.getByRole("button", { name: messages.selectAction })
      ).toBeVisible()
      expect(actionsOf("stop")).toHaveLength(1)
      expect(actionsOf("renew")).toHaveLength(0)
      expect(actionsOf("resume")).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("Desktop Computer Use errors and stale scope", () => {
  it("shows explicit localized forbidden and busy messages", async () => {
    const interaction = userEvent.setup()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "select"
          ? Promise.reject(new Error("FORBIDDEN"))
          : Promise.resolve({ state: "idle" })
    )
    createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorForbidden)
    expect(
      screen.getByRole("button", { name: messages.selectAction })
    ).toBeVisible()

    cleanup()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "status"
          ? Promise.reject(new Error("DEVICE_BUSY"))
          : Promise.resolve({ state: "idle" })
    )
    createCardView()
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorBusy)
    expect(screen.getByRole("button", { name: messages.retry })).toBeVisible()
  })

  it("reports an older host without the native method as an update error", async () => {
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "status"
          ? Promise.reject(
              new Error("method Desktop.ComputerControl is not bound")
            )
          : Promise.resolve({ state: "idle" })
    )
    createCardView()
    expect(
      await screen.findByTestId("desktop-computer-use-error")
    ).toHaveTextContent(messages.errorUnsupported)
    expect(screen.getByRole("button", { name: messages.retry })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: messages.selectAction })
    ).toBeNull()
  })

  it("never applies a finished request from another turn", async () => {
    const expiresAt = futureExpiry()
    const selected = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, turn: string, action: string) => {
        if (action === "status") return Promise.resolve({ state: "idle" })
        if (turn === turnA && action === "select") return selected.promise
        return Promise.resolve({ state: "idle" })
      }
    )
    const interaction = userEvent.setup()
    const view = createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    await screen.findByText(messages.selecting)

    view.rerenderCard({ turnId: turnB })
    await waitFor(() => expect(statusCalls()).toBe(2))
    await waitFor(() => expect(card()).toHaveAttribute("data-state", "idle"))
    expect(screen.queryByText(messages.selecting)).toBeNull()

    await act(async () => {
      selected.resolve({ state: "active", expiresAt })
    })
    expect(card()).toHaveAttribute("data-state", "idle")
    expect(statusText()).toHaveTextContent(messages.statusIdle)
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
  })

  it("never applies a finished request from another account", async () => {
    const expiresAt = futureExpiry()
    const selected = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "select"
          ? selected.promise
          : Promise.resolve({ state: "idle" })
    )
    const interaction = userEvent.setup()
    const view = createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    await screen.findByText(messages.selecting)

    view.rerenderCard({ ownerId: otherOwnerId })
    await waitFor(() => expect(device.read).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(statusCalls()).toBe(2))
    await waitFor(() => expect(card()).toHaveAttribute("data-state", "idle"))
    expect(screen.queryByText(messages.selecting)).toBeNull()

    await act(async () => {
      selected.resolve({ state: "active", expiresAt })
    })
    expect(card()).toHaveAttribute("data-state", "idle")
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
  })

  it("remounts for a new device and ignores the old pending selection", async () => {
    const expiresAt = futureExpiry()
    const selected = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "select"
          ? selected.promise
          : Promise.resolve({ state: "idle" })
    )
    const interaction = userEvent.setup()
    const view = createCardView()
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    await screen.findByText(messages.selecting)

    device.read.mockResolvedValue(readyDevice({ deviceId: otherDeviceId }))
    view.rerenderCard({ deviceId: otherDeviceId })
    await act(async () => {
      await view.client.invalidateQueries({
        queryKey: desktopDeviceStatusQueryKey(ownerId),
      })
    })
    await waitFor(() => expect(statusCalls()).toBe(2))
    await waitFor(() => expect(card()).toHaveAttribute("data-state", "idle"))

    await act(async () => {
      selected.resolve({ state: "active", expiresAt })
    })
    expect(card()).toHaveAttribute("data-state", "idle")
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
  })

  it("does not let a late active reply from an unmounted card overwrite status", async () => {
    const expiresAt = futureExpiry()
    const picked = deferred<{ state: string; expiresAt: string }>()
    control.call.mockImplementation(
      (_conversation: string, _turn: string, action: string) =>
        action === "select"
          ? picked.promise
          : Promise.resolve({ state: "idle" })
    )
    const client = newClient()
    const interaction = userEvent.setup()
    const first = createCardView({}, client)
    await waitForIdleCard()
    await interaction.click(
      screen.getByRole("button", { name: messages.selectAction })
    )
    await screen.findByText(messages.selecting)
    first.unmount()

    createCardView({}, client)
    await waitForIdleCard()
    const statusBefore = statusCalls()

    await act(async () => {
      picked.resolve({ state: "active", expiresAt })
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(card()).toHaveAttribute("data-state", "idle")
    expect(statusCalls()).toBe(statusBefore)
    expect(
      screen.queryByRole("button", { name: messages.pauseAction })
    ).toBeNull()
  })
})
