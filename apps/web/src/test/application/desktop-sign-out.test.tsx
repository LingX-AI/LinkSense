import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DESKTOP_PROTOCOL_HEADER,
  desktopProtocolVersion,
} from "@linksense/shared"

import * as desktopAdapter from "@/adapters/desktop/desktop-adapter"
import {
  Desktop,
  type DeviceConnectionStatus,
  type MacSignOutOptions,
} from "@/adapters/desktop/mygo"
import App from "@/App"
import { authSessionSchema } from "@/api/contracts"
import { getAccessToken } from "@/api/session"
import { useAuth } from "@/app/auth-state"
import { AppProviders } from "@/app/providers"
import {
  authenticationSession,
  installApiMock,
  json,
  setupApplicationTests,
} from "@/test/application/fixture"

const thisMac = "10000000-0000-4000-8000-000000000001"
const anotherMac = "10000000-0000-4000-8000-000000000002"
const checkboxLabel = "同时撤销这台 Mac 的授权"
const failedText =
  "无法确认已撤销这台 Mac 的授权。请重试，或取消勾选后只退出登录。"
const uncertainText = "之前的撤销结果尚未确认。退出登录不会再次尝试撤销。"
const changedText = "这台 Mac 的本机工具状态已变更。请重新选择，或只退出登录。"
const userOverride = {
  role: "user",
  id: "00000000-0000-4000-8000-000000000001",
}
const replacement = authSessionSchema.parse(
  authenticationSession(
    "replacement-access-token-that-is-long-enough",
    "zh-CN",
    userOverride
  )
)

function SessionControls() {
  const { acceptSession } = useAuth()
  return (
    <button type="button" onClick={() => void acceptSession(replacement)}>
      Accept another login for this account
    </button>
  )
}

async function renderSignOut(
  platform: "darwin" | "windows" | "web" = "darwin",
  advertised = true
) {
  const { fetchMock } = installApiMock({ userOverride })
  const readStatus = vi
    .fn<() => Promise<DeviceConnectionStatus>>()
    .mockResolvedValue({
      deviceId: thisMac,
      state: "offline",
    })
  const writeOrder: string[] = []
  const clearMacSession = vi.fn<(options: MacSignOutOptions) => Promise<void>>(
    async () => {
      writeOrder.push("clear-mac")
    }
  )
  if (platform !== "web") {
    vi.stubGlobal("mygo", {
      platform,
      on: vi.fn(() => () => undefined),
      callWith: (method: string, args: unknown[]) => {
        if (method === "Desktop.DeviceStatus") return readStatus()
        if (method === "Desktop.ClearMacSession") {
          return clearMacSession(
            args[0] as Parameters<typeof clearMacSession>[0]
          )
        }
        throw new Error(`Unexpected native method: ${method}`)
      },
    })
    vi.spyOn(Desktop, "info").mockResolvedValue({
      bridgeVersion: 1,
      serverUrl: window.location.origin,
      platform,
      version: "0.1.0",
      ...(platform === "darwin" && advertised ? { macSignOut: true } : {}),
    })
    vi.spyOn(Desktop, "notificationsSupported").mockResolvedValue(false)
    await desktopAdapter.initializeDesktopHost()
  }
  vi.spyOn(Desktop, "resumeDevice").mockResolvedValue({ state: "unpaired" })
  vi.spyOn(Desktop, "cancelSignIn").mockResolvedValue(undefined)
  const clearSession = vi
    .spyOn(Desktop, "clearSession")
    .mockImplementation(async () => {
      writeOrder.push("clear")
    })
  const revoke = vi.fn<
    (id: string, authorization: string | null) => Promise<Response>
  >(async () => json({ success: true, data: { revoked: true } }))
  const logout = vi.fn(async () => json({ success: true, data: null }))
  const refresh = vi.fn(async () =>
    json({
      success: true,
      data: authenticationSession(
        "test-access-token-that-is-long-enough",
        "zh-CN",
        userOverride
      ),
    })
  )
  vi.spyOn(desktopAdapter, "hostFetch").mockImplementation(
    async (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname
      let response: Response
      if (
        path.startsWith("/api/v1/desktop/devices/") &&
        init?.method === "DELETE"
      ) {
        const id = path.split("/").at(-1) ?? ""
        writeOrder.push(`revoke:${id}`)
        response = await revoke(
          id,
          new Headers(init.headers).get("Authorization")
        )
      } else if (path === "/api/v1/auth/logout" && init?.method === "POST") {
        writeOrder.push("logout")
        response = await logout()
      } else if (path === "/api/v1/auth/refresh") {
        response = await refresh()
      } else {
        response = await fetchMock(input, init)
      }
      if (platform !== "web") {
        response.headers.set(
          DESKTOP_PROTOCOL_HEADER,
          String(desktopProtocolVersion)
        )
      }
      return response
    }
  )
  render(
    <MemoryRouter initialEntries={["/conversations/c1"]}>
      <AppProviders>
        <SessionControls />
        <App />
      </AppProviders>
    </MemoryRouter>
  )
  return {
    clearMacSession,
    clearSession,
    logout,
    readStatus,
    refresh,
    revoke,
    writeOrder,
  }
}

async function openSignOut(interaction: ReturnType<typeof userEvent.setup>) {
  const account = await screen.findByRole("button", { name: "林晓" })
  await interaction.click(account)
  await interaction.click(
    await screen.findByRole("menuitem", { name: "退出登录" })
  )
  return within(await screen.findByRole("dialog", { name: "退出登录？" }))
}

function resolveOnDemand<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe("account-menu sign-out and this Mac's pairing", () => {
  setupApplicationTests()

  afterEach(() => {
    delete document.documentElement.dataset.desktopPlatform
  })

  it("offers an unchecked choice even for a paired Mac whose runtime is offline and keeps its pairing", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const dialog = await openSignOut(interaction)
    const option = await dialog.findByRole("checkbox", { name: checkboxLabel })
    expect(option).not.toBeChecked()
    await interaction.click(dialog.getByRole("button", { name: "退出登录" }))
    await waitFor(() =>
      expect(session.writeOrder).toEqual(["logout", "clear-mac"])
    )
    expect(session.clearSession).not.toHaveBeenCalled()
    expect(session.clearMacSession).toHaveBeenCalledWith({})
    expect(session.revoke).not.toHaveBeenCalled()
    expect(
      await screen.findByRole("button", { name: "在浏览器中登录" })
    ).toBeVisible()
  })

  it.each([
    ["web", true],
    ["windows", true],
    ["darwin", false],
  ] as const)(
    "preserves %s sign-out (Mac capability advertised: %s) without probing or revoking a device",
    async (platform, advertised) => {
      const session = await renderSignOut(platform, advertised)
      const interaction = userEvent.setup()
      const dialog = await openSignOut(interaction)
      expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument()
      await interaction.click(dialog.getByRole("button", { name: "退出登录" }))
      await waitFor(() => {
        expect(session.logout).toHaveBeenCalledOnce()
        expect(session.clearSession).toHaveBeenCalledTimes(
          platform === "web" ? 0 : 1
        )
      })
      expect(session.clearMacSession).not.toHaveBeenCalled()
      expect(session.readStatus).not.toHaveBeenCalled()
      expect(session.revoke).not.toHaveBeenCalled()
    }
  )

  it("does not fall back to legacy pairing deletion when native Mac cleanup fails", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const dialog = await openSignOut(interaction)
    session.clearMacSession.mockRejectedValueOnce(
      new Error("private credential-store error")
    )
    await interaction.click(dialog.getByRole("button", { name: "退出登录" }))
    expect(
      await screen.findByRole("button", { name: "在浏览器中登录" })
    ).toBeVisible()
    expect(session.clearMacSession).toHaveBeenCalledWith({})
    expect(session.clearSession).not.toHaveBeenCalled()
    expect(session.revoke).not.toHaveBeenCalled()
    expect(
      screen.queryByText("private credential-store error")
    ).not.toBeInTheDocument()
  })

  it("discards consent when Escape closes the dialog and reads the Mac again on reopen", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const firstDialog = await openSignOut(interaction)
    const option = await firstDialog.findByRole("checkbox", {
      name: checkboxLabel,
    })
    option.focus()
    await interaction.keyboard(" ")
    expect(option).toBeChecked()
    await interaction.keyboard("{Escape}")
    expect(
      screen.queryByRole("dialog", { name: "退出登录？" })
    ).not.toBeInTheDocument()
    expect(session.writeOrder).toEqual([])
    const secondDialog = await openSignOut(interaction)
    expect(
      await secondDialog.findByRole("checkbox", { name: checkboxLabel })
    ).not.toBeChecked()
    expect(session.readStatus).toHaveBeenCalledTimes(2)
  })

  it("ignores a canceled dialog's status response while reopening for a different pairing", async () => {
    const session = await renderSignOut()
    const firstStatus = resolveOnDemand<DeviceConnectionStatus>()
    const secondStatus = resolveOnDemand<DeviceConnectionStatus>()
    session.readStatus
      .mockReturnValueOnce(firstStatus.promise)
      .mockReturnValueOnce(secondStatus.promise)
      .mockResolvedValue({ state: "online", deviceId: anotherMac })
    const interaction = userEvent.setup()
    const firstDialog = await openSignOut(interaction)
    await interaction.click(firstDialog.getByRole("button", { name: "取消" }))
    const secondDialog = await openSignOut(interaction)
    expect(session.readStatus).toHaveBeenCalledTimes(2)
    await act(async () =>
      firstStatus.resolve({ state: "online", deviceId: thisMac })
    )
    expect(secondDialog.queryByRole("checkbox")).not.toBeInTheDocument()
    await act(async () =>
      secondStatus.resolve({ state: "online", deviceId: anotherMac })
    )
    const option = await secondDialog.findByRole("checkbox", {
      name: checkboxLabel,
    })
    expect(option).not.toBeChecked()
    await interaction.click(option)
    await interaction.click(
      secondDialog.getByRole("button", { name: "退出登录" })
    )
    await waitFor(() =>
      expect(session.writeOrder).toEqual([
        `revoke:${anotherMac}`,
        "logout",
        "clear-mac",
      ])
    )
  })

  it.each(["unavailable", "unpaired", "revoked", "no-id"] as const)(
    "keeps ordinary sign-out available for a Mac with %s status",
    async (state) => {
      const session = await renderSignOut()
      if (state === "unavailable") {
        session.readStatus.mockRejectedValue(new Error("private bridge error"))
      } else if (state === "no-id") {
        session.readStatus.mockResolvedValue({ state: "offline" })
      } else {
        session.readStatus.mockResolvedValue({ state, deviceId: thisMac })
      }
      const interaction = userEvent.setup()
      const dialog = await openSignOut(interaction)
      await waitFor(() => expect(session.readStatus).toHaveBeenCalledOnce())
      expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument()
      await interaction.click(dialog.getByRole("button", { name: "退出登录" }))
      await waitFor(() =>
        expect(session.writeOrder).toEqual(["logout", "clear-mac"])
      )
      expect(session.clearMacSession).toHaveBeenCalledWith({})
    }
  )

  it("revokes only the opted-in device once, then logs out and clears native credentials", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const dialog = await openSignOut(interaction)
    await interaction.click(
      await dialog.findByRole("checkbox", { name: checkboxLabel })
    )
    const pending = resolveOnDemand<Response>()
    session.revoke.mockReturnValueOnce(pending.promise)
    const confirm = dialog.getByRole("button", { name: "退出登录" })
    // Both events reach the handler in one render, before pending can disable it.
    act(() => {
      confirm.click()
      confirm.click()
    })
    await waitFor(() =>
      expect(session.revoke).toHaveBeenCalledWith(
        thisMac,
        "Bearer test-access-token-that-is-long-enough"
      )
    )
    expect(session.revoke).toHaveBeenCalledOnce()
    expect(session.writeOrder).toEqual([`revoke:${thisMac}`])
    expect(confirm).toBeDisabled()
    await act(async () =>
      pending.resolve(json({ success: true, data: { revoked: true } }))
    )
    await waitFor(() =>
      expect(session.writeOrder).toEqual([
        `revoke:${thisMac}`,
        "logout",
        "clear-mac",
      ])
    )
    expect(session.clearMacSession).toHaveBeenCalledWith({
      revokedDevice: { deviceId: thisMac, ownerId: userOverride.id },
    })
  })

  it.each(["retry", "ordinary"] as const)(
    "keeps an unconfirmed revoke actionable: %s",
    async (recovery) => {
      const session = await renderSignOut()
      // A successful HTTP status is not a confirmation if the body disagrees.
      session.revoke.mockResolvedValueOnce(
        json({ success: true, data: { revoked: false } })
      )
      const interaction = userEvent.setup()
      const dialog = await openSignOut(interaction)
      const option = await dialog.findByRole("checkbox", {
        name: checkboxLabel,
      })
      await interaction.click(option)
      const confirm = dialog.getByRole("button", { name: "退出登录" })
      await interaction.click(confirm)
      expect(await dialog.findByRole("alert")).toHaveTextContent(failedText)
      expect(session.writeOrder).toEqual([`revoke:${thisMac}`])
      expect(option).toBeChecked()
      if (recovery === "ordinary") {
        await interaction.click(option)
        expect(dialog.getByRole("alert")).toHaveTextContent(uncertainText)
      }
      await interaction.click(confirm)
      await waitFor(() =>
        expect(session.writeOrder).toEqual([
          `revoke:${thisMac}`,
          ...(recovery === "retry" ? [`revoke:${thisMac}`] : []),
          "logout",
          "clear-mac",
        ])
      )
      expect(session.clearMacSession).toHaveBeenCalledWith(
        recovery === "retry"
          ? { revokedDevice: { deviceId: thisMac, ownerId: userOverride.id } }
          : {}
      )
    }
  )

  it("rechecks the device on explicit retry after refresh and does not replay the DELETE", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const dialog = await openSignOut(interaction)
    await interaction.click(
      await dialog.findByRole("checkbox", { name: checkboxLabel })
    )
    const confirm = dialog.getByRole("button", { name: "退出登录" })
    const statusReads = session.readStatus.mock.calls.length
    const originalToken = getAccessToken()
    const rotatedToken = "rotated-access-token-that-is-long-enough"
    session.revoke.mockResolvedValueOnce(
      json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
    )
    session.refresh.mockResolvedValueOnce(
      json({
        success: true,
        data: authenticationSession(rotatedToken, "zh-CN", userOverride),
      })
    )
    await interaction.click(confirm)
    expect(await dialog.findByRole("alert")).toHaveTextContent(failedText)
    expect(getAccessToken()).toBe(rotatedToken)
    expect(session.revoke.mock.calls).toEqual([
      [thisMac, `Bearer ${originalToken}`],
    ])
    expect(session.writeOrder).toEqual([`revoke:${thisMac}`])

    // Hold the second read to prove the rotated bearer is not used before it.
    const retryStatus = resolveOnDemand<DeviceConnectionStatus>()
    session.readStatus.mockReturnValueOnce(retryStatus.promise)
    await interaction.click(confirm)
    await waitFor(() =>
      expect(session.readStatus).toHaveBeenCalledTimes(statusReads + 2)
    )
    expect(session.revoke).toHaveBeenCalledOnce()
    await act(async () =>
      retryStatus.resolve({ state: "online", deviceId: thisMac })
    )
    await waitFor(() =>
      expect(session.writeOrder).toEqual([
        `revoke:${thisMac}`,
        `revoke:${thisMac}`,
        "logout",
        "clear-mac",
      ])
    )
    expect(session.revoke).toHaveBeenLastCalledWith(
      thisMac,
      `Bearer ${rotatedToken}`
    )
  })

  it("retries only the confirmed device after a lost acknowledgment leaves it revoked", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const dialog = await openSignOut(interaction)
    await interaction.click(
      await dialog.findByRole("checkbox", { name: checkboxLabel })
    )
    const confirm = dialog.getByRole("button", { name: "退出登录" })
    session.revoke.mockImplementationOnce(async () => {
      session.readStatus.mockResolvedValue({
        state: "revoked",
        deviceId: thisMac,
      })
      throw new TypeError("Connection interrupted before the response")
    })
    await interaction.click(confirm)
    expect(await dialog.findByRole("alert")).toHaveTextContent(failedText)
    expect(session.writeOrder).toEqual([`revoke:${thisMac}`])
    await interaction.click(confirm)
    await waitFor(() =>
      expect(session.writeOrder).toEqual([
        `revoke:${thisMac}`,
        `revoke:${thisMac}`,
        "logout",
        "clear-mac",
      ])
    )
  })

  it("requires a fresh choice after the native device is replaced", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const dialog = await openSignOut(interaction)
    await interaction.click(
      await dialog.findByRole("checkbox", { name: checkboxLabel })
    )
    session.readStatus.mockResolvedValue({
      state: "connecting",
      deviceId: anotherMac,
    })
    const confirm = dialog.getByRole("button", { name: "退出登录" })
    await interaction.click(confirm)
    expect(await dialog.findByRole("alert")).toHaveTextContent(changedText)
    expect(session.writeOrder).toEqual([])
    const option = dialog.getByRole("checkbox", { name: checkboxLabel })
    expect(option).not.toBeChecked()
    await interaction.click(option)
    await interaction.click(confirm)
    await waitFor(() =>
      expect(session.writeOrder).toEqual([
        `revoke:${anotherMac}`,
        "logout",
        "clear-mac",
      ])
    )
    expect(session.clearMacSession).toHaveBeenCalledWith({
      revokedDevice: { deviceId: anotherMac, ownerId: userOverride.id },
    })
  })

  it.each(["status", "response", "refresh"] as const)(
    "ignores old %s after the same account gets a new login",
    async (stage) => {
      const session = await renderSignOut()
      const interaction = userEvent.setup()
      // Capture the real provider callback before Base UI makes the rest of the page inert.
      const accept = screen.getByRole("button", {
        name: "Accept another login for this account",
      })
      const dialog = await openSignOut(interaction)
      await interaction.click(
        await dialog.findByRole("checkbox", { name: checkboxLabel })
      )
      const status = resolveOnDemand<DeviceConnectionStatus>()
      const response = resolveOnDemand<Response>()
      const refresh = resolveOnDemand<Response>()
      const openedRefreshes = session.refresh.mock.calls.length
      if (stage === "status")
        session.readStatus.mockReturnValueOnce(status.promise)
      else if (stage === "response")
        session.revoke.mockReturnValueOnce(response.promise)
      else {
        session.revoke.mockResolvedValueOnce(
          json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
        )
        session.refresh.mockReturnValueOnce(refresh.promise)
      }
      const openedReads = session.readStatus.mock.calls.length
      await interaction.click(dialog.getByRole("button", { name: "退出登录" }))
      await waitFor(() => {
        if (stage === "status")
          expect(session.readStatus).toHaveBeenCalledTimes(openedReads + 1)
        else expect(session.revoke).toHaveBeenCalledOnce()
        if (stage === "refresh")
          expect(session.refresh).toHaveBeenCalledTimes(openedRefreshes + 1)
      })
      fireEvent.click(accept)
      await waitFor(() =>
        expect(getAccessToken()).toBe(replacement.access_token)
      )
      await act(async () => {
        status.resolve({ state: "online", deviceId: thisMac })
        response.resolve(json({ success: true, data: { revoked: true } }))
        refresh.resolve(
          json({
            success: true,
            data: authenticationSession(
              "old-rotated-access-token",
              "zh-CN",
              userOverride
            ),
          })
        )
      })
      expect(session.writeOrder).toEqual(
        stage === "status" ? [] : [`revoke:${thisMac}`]
      )
      expect(
        screen.queryByRole("dialog", { name: "退出登录？" })
      ).not.toBeInTheDocument()
      expect(getAccessToken()).toBe(replacement.access_token)
      expect(await screen.findByRole("button", { name: "林晓" })).toBeVisible()
    }
  )

  it("uses the existing authentication expiration path when refresh is rejected", async () => {
    const session = await renderSignOut()
    const interaction = userEvent.setup()
    const dialog = await openSignOut(interaction)
    await interaction.click(
      await dialog.findByRole("checkbox", { name: checkboxLabel })
    )
    session.revoke.mockResolvedValueOnce(
      json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
    )
    session.refresh.mockResolvedValueOnce(
      json({ success: false, error_code: "AUTH_SESSION_EXPIRED" }, 401)
    )
    await interaction.click(dialog.getByRole("button", { name: "退出登录" }))
    expect(
      await screen.findByRole("button", { name: "在浏览器中登录" })
    ).toBeVisible()
    expect(session.writeOrder).toEqual([`revoke:${thisMac}`])
    expect(getAccessToken()).toBeNull()
  })
})
