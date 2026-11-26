import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nextProvider } from "react-i18next"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const native = vi.hoisted(() => ({
  mac: true,
  read: vi.fn(),
  setEnabled: vi.fn(),
  addRoot: vi.fn(),
  removeRoot: vi.fn(),
}))
const rootsApi = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
}))

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
  setDesktopLocalToolsEnabled: native.setEnabled,
  addDesktopFileRoot: native.addRoot,
  removeDesktopFileRoot: native.removeRoot,
}))

vi.mock("./desktop-file-root-api", () => ({
  listDesktopFileRoots: rootsApi.list,
  updateDesktopFileRoot: rootsApi.update,
}))

import i18n from "@/i18n"
import { DesktopDevicesSettings } from "./desktop-devices-settings"
import { desktopDevicesMessages } from "./messages"

const ownerId = "9f4e6a1a-5d1c-4d25-8d63-2a0f0e1c7b11"

function renderSettings(id: string = ownerId) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <DesktopDevicesSettings ownerId={id} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  native.mac = true
  native.read.mockResolvedValue({ state: "online" })
  native.setEnabled.mockImplementation(async (enabled: boolean) => ({
    state: enabled ? "online" : "offline",
    ...(enabled ? {} : { localToolsDisabled: true }),
  }))
  native.read.mockResolvedValue({ state: "online", deviceId: "20000000-0000-4000-8000-000000000001" })
  native.addRoot.mockResolvedValue("50000000-0000-4000-8000-000000000001")
  rootsApi.list.mockResolvedValue({ items: [] })
  rootsApi.update.mockImplementation(async (id: string, patch: { mode: string }) => ({
    id, device_id: "20000000-0000-4000-8000-000000000001",
    name: "Documents", mode: patch.mode,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }))
  await i18n.changeLanguage("zh-CN")
})

afterEach(() => {
  cleanup()
})

describe("local tools settings", () => {
  it("shows the automatic connection and disables local tools from the switch", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    const interaction = userEvent.setup()
    renderSettings()

    expect(await screen.findByText(messages.statusOnline)).toBeVisible()
    const toggle = screen.getByRole("switch", { name: messages.toggleLabel })
    expect(toggle).toBeChecked()

    await interaction.click(toggle)

    await waitFor(() => expect(native.setEnabled).toHaveBeenCalledExactlyOnceWith(false))
    expect(await screen.findByText(messages.statusDisabled)).toBeVisible()
    expect(toggle).not.toBeChecked()
  })

  it("re-enables a disabled Mac with an explicit user action", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.read.mockResolvedValue({
      state: "offline",
      localToolsDisabled: true,
    })
    const interaction = userEvent.setup()
    renderSettings()

    expect(await screen.findByText(messages.statusDisabled)).toBeVisible()
    const toggle = screen.getByRole("switch", { name: messages.toggleLabel })
    expect(toggle).not.toBeChecked()

    await interaction.click(toggle)

    await waitFor(() => expect(native.setEnabled).toHaveBeenCalledExactlyOnceWith(true))
    expect(await screen.findByText(messages.statusOnline)).toBeVisible()
    expect(toggle).toBeChecked()
  })

  it("adds, changes, and removes a shared folder through the native owner", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    rootsApi.list.mockResolvedValue({
      items: [{
        id: "50000000-0000-4000-8000-000000000001",
        device_id: "20000000-0000-4000-8000-000000000001",
        name: "Documents", mode: "read",
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }],
    })
    const interaction = userEvent.setup()
    renderSettings()

    expect(await screen.findByText("Documents")).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: messages.addFolder }))
    await waitFor(() => expect(native.addRoot).toHaveBeenCalledWith(
      "20000000-0000-4000-8000-000000000001", "read"
    ))

    await interaction.click(screen.getByRole("button", { name: messages.removeFolder }))
    expect(await screen.findByText(messages.removeFolderTitle)).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: messages.removeFolderConfirm }))
    await waitFor(() => expect(native.removeRoot).toHaveBeenCalledWith(
      "50000000-0000-4000-8000-000000000001"
    ))
  })

  it("shows an unavailable status with a retry when the native read fails", async () => {
    const messages = desktopDevicesMessages["zh-CN"]
    native.read.mockRejectedValue(new Error("native unavailable"))
    renderSettings()

    expect(await screen.findByText(messages.statusUnavailable)).toBeVisible()
    expect(screen.getByRole("button", { name: /重试/u })).toBeVisible()
  })

  it("renders nothing outside a macOS host or without an owner", () => {
    native.mac = false
    const { container } = renderSettings()
    expect(container).toBeEmptyDOMElement()
  })
})
