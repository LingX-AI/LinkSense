import {
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
import type { DesktopDevice } from "@linksense/shared"

const api = vi.hoisted(() => ({ request: vi.fn() }))
const native = vi.hoisted(() => ({
  mac: true,
  read: vi.fn(),
  pair: vi.fn(),
  resume: vi.fn(),
}))

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>()
  return { ...actual, apiRequest: api.request }
})

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => native.mac,
  isDesktopHost: () => false,
  getDesktopServerUrl: () => null,
  hostFetch: vi.fn(),
  requireDesktopUpdate: vi.fn(),
  clearDesktopSession: vi.fn(),
}))

vi.mock("@/adapters/desktop/desktop-device-adapter", () => ({
  readDesktopDeviceStatus: native.read,
  pairDesktopDevice: native.pair,
  resumeDesktopDeviceForAuthRestore: native.resume,
}))

import i18n from "@/i18n"
import { ApiError } from "@/api/client"
import { DesktopDevicesSettings } from "./desktop-devices-settings"
import { desktopDevicesMessages } from "./messages"

const ownerA = "9f4e6a1a-5d1c-4d25-8d63-2a0f0e1c7b11"
const ownerB = "c5b7a0d4-2f6e-4f8a-9a3c-7d1e2b4c6a90"
const deviceId = "2b8f4c3a-7d1e-4a9b-8c2d-5e6f7a8b9c0d"
const otherDeviceId = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d"
const pairingCode = "a".repeat(32)

function makeDevice(overrides: Partial<DesktopDevice> = {}): DesktopDevice {
  return {
    id: deviceId,
    name: "Work Mac",
    platform: "darwin",
    arch: "arm64",
    app_version: "1.4.0",
    capabilities: {
      local_execution: true,
      browser_extension: false,
      computer_use: false,
    },
    online: true,
    last_seen_at: "2026-11-21T10:00:00.000Z",
    revoked_at: null,
    created_at: "2026-11-20T09:00:00.000Z",
    updated_at: "2026-11-21T10:00:00.000Z",
    ...overrides,
  }
}

let listItems: DesktopDevice[] = []

function renderSettings(ownerId: string, client?: QueryClient) {
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
        <DesktopDevicesSettings ownerId={ownerId} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function storedValues() {
  return Array.from({ length: window.localStorage.length }, (_, index) => {
    const key = window.localStorage.key(index)
    return key ? window.localStorage.getItem(key) : null
  }).join(" ")
}

beforeEach(async () => {
  vi.clearAllMocks()
  native.mac = true
  native.read.mockResolvedValue({ state: "unpaired" })
  native.pair.mockResolvedValue({
    state: "online",
    deviceId,
    executionReady: true,
  })
  listItems = []
  api.request.mockImplementation(async (path: string) => {
    if (path === "/desktop/devices") return { items: listItems }
    if (path === "/desktop/devices/pairing") {
      return { code: pairingCode, expires_at: "2026-11-21T12:02:00.000Z" }
    }
    return {}
  })
  window.localStorage.clear()
  await i18n.changeLanguage("zh-CN")
})

afterEach(cleanup)

describe("desktop device settings", () => {
  it("stays absent in a plain browser or Windows host", () => {
    native.mac = false
    const { container } = renderSettings(ownerA)
    expect(container).toBeEmptyDOMElement()
    expect(native.read).not.toHaveBeenCalled()
    expect(api.request).not.toHaveBeenCalled()
  })

  it("pairs only after an explicit submit and never renders the code", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    renderSettings(ownerA)

    const pairButton = await screen.findByRole("button", {
      name: messages.pairAction,
    })
    expect(api.request).not.toHaveBeenCalledWith(
      "/desktop/devices/pairing",
      expect.anything()
    )

    await userEvent.type(
      screen.getByRole("textbox", { name: messages.pairNameLabel }),
      "Work Mac"
    )
    await userEvent.click(pairButton)

    await waitFor(() =>
      expect(native.pair).toHaveBeenCalledExactlyOnceWith(
        pairingCode,
        "Work Mac"
      )
    )
    expect(api.request).toHaveBeenCalledWith(
      "/desktop/devices/pairing",
      expect.objectContaining({ method: "POST", body: {} })
    )
    expect(document.body.textContent).not.toContain(pairingCode)
    expect(storedValues()).not.toContain(pairingCode)
    expect(
      screen.queryByRole("button", { name: messages.pairAction })
    ).not.toBeInTheDocument()
  })

  it("does not retry a failed native pairing", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.pair.mockRejectedValueOnce(new Error("AUTH_REQUIRED"))
    renderSettings(ownerA)

    await userEvent.type(
      await screen.findByRole("textbox", { name: messages.pairNameLabel }),
      "Work Mac"
    )
    await userEvent.click(
      screen.getByRole("button", { name: messages.pairAction })
    )

    expect(await screen.findByText(messages.pairFailed)).toBeVisible()
    expect(native.pair).toHaveBeenCalledOnce()
    expect(
      api.request.mock.calls.filter(
        ([path]) => path === "/desktop/devices/pairing"
      )
    ).toHaveLength(1)
  })

  it("does not show a ready execution link when an older host omits it", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.read.mockResolvedValue({ state: "online", deviceId })
    renderSettings(ownerA)

    expect(await screen.findByText(messages.executionNotReady)).toBeVisible()
    expect(screen.queryByText(messages.executionReady)).not.toBeInTheDocument()
  })

  it("shows a ready execution link when the host reports it", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.read.mockResolvedValue({
      state: "online",
      deviceId,
      executionReady: true,
    })
    renderSettings(ownerA)

    expect(await screen.findByText(messages.executionReady)).toBeVisible()
    expect(
      screen.queryByText(messages.executionNotReady)
    ).not.toBeInTheDocument()
  })

  it("shows the owner's devices, marks this Mac, and renames one", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    listItems = [
      makeDevice(),
      makeDevice({ id: otherDeviceId, name: "Office Mac" }),
    ]
    native.read.mockResolvedValue({ state: "online", deviceId })
    api.request.mockImplementation(
      async (
        path: string,
        options?: { method?: string; body?: { name?: string } }
      ) => {
        if (path === "/desktop/devices") return { items: listItems }
        if (
          path === `/desktop/devices/${otherDeviceId}` &&
          options?.method === "PATCH"
        ) {
          return { id: otherDeviceId, name: options.body?.name }
        }
        return {}
      }
    )
    renderSettings(ownerA)

    expect(await screen.findByText("Office Mac")).toBeVisible()
    expect(screen.getByText(messages.thisMac)).toBeVisible()

    const row = screen.getByText("Office Mac").closest("li")
    expect(row).not.toBeNull()
    await userEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: messages.rename,
      })
    )
    const input = screen.getByRole("textbox", {
      name: messages.renameNameLabel,
    })
    await userEvent.clear(input)
    await userEvent.type(input, "Studio Mac")
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.save") })
    )

    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        `/desktop/devices/${otherDeviceId}`,
        expect.objectContaining({
          method: "PATCH",
          body: { name: "Studio Mac" },
        })
      )
    )
  })

  it("confirms before revoking access", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    listItems = [makeDevice({ id: otherDeviceId, name: "Office Mac" })]
    native.read.mockResolvedValue({ state: "unpaired" })
    api.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path === "/desktop/devices") return { items: listItems }
        if (
          path === `/desktop/devices/${otherDeviceId}` &&
          options?.method === "DELETE"
        ) {
          return { revoked: true }
        }
        return {}
      }
    )
    renderSettings(ownerA)

    const row = (await screen.findByText("Office Mac")).closest("li")
    expect(row).not.toBeNull()
    await userEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: messages.revoke,
      })
    )
    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(messages.revokeTitle)).toBeVisible()
    expect(api.request).not.toHaveBeenCalledWith(
      `/desktop/devices/${otherDeviceId}`,
      expect.objectContaining({ method: "DELETE" })
    )

    await userEvent.click(
      within(dialog).getByRole("button", { name: messages.revokeConfirm })
    )
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        `/desktop/devices/${otherDeviceId}`,
        expect.objectContaining({ method: "DELETE" })
      )
    )
  })

  it("shows an empty owner list instead of a fake device", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.read.mockResolvedValue({ state: "online", deviceId })
    renderSettings(ownerA)

    expect(await screen.findByText(messages.devicesEmptyTitle)).toBeVisible()
    expect(screen.getByText(messages.devicesEmptyDescription)).toBeVisible()
  })

  it("shows an unavailable status and retries the native read", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.read
      .mockRejectedValueOnce(new Error("native unavailable"))
      .mockResolvedValueOnce({
        state: "online",
        deviceId,
        executionReady: true,
      })
    renderSettings(ownerA)

    expect(await screen.findByText(messages.statusUnavailable)).toBeVisible()
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.retry") })
    )
    expect(await screen.findByText(messages.executionReady)).toBeVisible()
    expect(native.read).toHaveBeenCalledTimes(2)
  })

  it("shows an unavailable device list and retries it", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.read.mockResolvedValue({ state: "unpaired" })
    api.request.mockRejectedValueOnce(new Error("network unavailable"))
    api.request.mockImplementation(async (path: string) => {
      if (path === "/desktop/devices") return { items: [] }
      return {}
    })
    renderSettings(ownerA)

    expect(await screen.findByText(messages.devicesLoadFailed)).toBeVisible()
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.retry") })
    )
    expect(await screen.findByText(messages.devicesEmptyTitle)).toBeVisible()
  })

  it("shows the localized forbidden error when rename is rejected", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    listItems = [makeDevice({ id: otherDeviceId, name: "Office Mac" })]
    native.read.mockResolvedValue({ state: "online", deviceId })
    api.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (path === "/desktop/devices") return { items: listItems }
        if (
          path === `/desktop/devices/${otherDeviceId}` &&
          options?.method === "PATCH"
        ) {
          throw new ApiError({ status: 403, errorCode: "FORBIDDEN" })
        }
        return {}
      }
    )
    renderSettings(ownerA)

    const row = (await screen.findByText("Office Mac")).closest("li")
    expect(row).not.toBeNull()
    await userEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: messages.rename,
      })
    )
    const input = screen.getByRole("textbox", {
      name: messages.renameNameLabel,
    })
    await userEvent.clear(input)
    await userEvent.type(input, "Studio Mac")
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.save") })
    )

    expect(await screen.findByText(i18n.t("errors.forbidden"))).toBeVisible()
  })

  it("does not reuse one account's device list for another account", async () => {
    listItems = [makeDevice({ name: "Account A Mac" })]
    native.read.mockResolvedValue({ state: "online", deviceId })
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const view = renderSettings(ownerA, client)

    expect(await screen.findByText("Account A Mac")).toBeVisible()

    listItems = [
      makeDevice({
        id: otherDeviceId,
        name: "Account B Mac",
        online: false,
        last_seen_at: null,
      }),
    ]
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <DesktopDevicesSettings ownerId={ownerB} />
        </QueryClientProvider>
      </I18nextProvider>
    )

    expect(await screen.findByText("Account B Mac")).toBeVisible()
    expect(screen.queryByText("Account A Mac")).not.toBeInTheDocument()
  })
})
