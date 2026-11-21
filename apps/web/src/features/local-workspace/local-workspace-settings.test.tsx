import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supportedLocales } from "@linksense/shared"

import i18n from "@/i18n"
import { formatResourceBytes } from "@/features/admin/resource-format"
import { LocalWorkspaceSettings } from "./local-workspace-settings"
import { localWorkspaceMessages } from "./messages"

const host = vi.hoisted(() => ({
  desktop: true,
  usage: vi.fn(),
  cleanup: vi.fn(),
}))
vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => host.desktop,
  readDesktopWorkspaceUsage: host.usage,
  cleanupDesktopWorkspaces: host.cleanup,
}))

const usage = {
  bytes: 1536,
  files: 12,
  sessions: 2,
  retentionDays: 14,
  budgetBytes: 10 * 1024 * 1024 * 1024,
}
// Intl unit output contains a non-breaking space; Testing Library normalizes
// the rendered text before matching.
const display = (value: string) => value.replace(/\s+/gu, " ")
const size = display(formatResourceBytes(usage.bytes, "zh-CN"))

beforeEach(async () => {
  host.desktop = true
  host.usage.mockReset().mockResolvedValue(usage)
  host.cleanup.mockReset()
  await i18n.changeLanguage("zh-CN")
})
afterEach(cleanup)

describe("local workspace settings", () => {
  it("stays hidden and makes no native call in a browser", () => {
    host.desktop = false
    render(<LocalWorkspaceSettings />)
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(host.usage).not.toHaveBeenCalled()
  })

  it("shows the account-scoped size, files, workspaces and retention rule", async () => {
    render(<LocalWorkspaceSettings />)
    expect(await screen.findByText(size)).toBeVisible()
    expect(screen.getByText("12")).toBeVisible()
    expect(screen.getByText("2")).toBeVisible()
    const policy = screen.getByText(/超过 14 天/u)
    expect(policy).toHaveTextContent(
      display(formatResourceBytes(usage.budgetBytes, "zh-CN"))
    )
    expect(screen.getByText(localWorkspaceMessages["zh-CN"].description))
      .toBeVisible()
  })

  it("applies one cleanup and refreshes the scoped usage", async () => {
    host.cleanup.mockResolvedValue({
      status: "completed",
      deletedSessions: 1,
      freedBytes: 2048,
      retainedBytes: 0,
    })
    render(<LocalWorkspaceSettings />)
    await screen.findByText(size)
    await userEvent.click(
      screen.getByRole("button", { name: "立即清理" })
    )
    expect(host.cleanup).toHaveBeenCalledWith()
    expect(
      await screen.findByText(
        display(
          localWorkspaceMessages["zh-CN"].completed.replace(
            "{{size}}",
            formatResourceBytes(2048, "zh-CN")
          )
        )
      )
    ).toBeVisible()
    await waitFor(() => expect(host.usage).toHaveBeenCalledTimes(2))
  })

  it.each([
    [
      { status: "busy", deletedSessions: 0, freedBytes: 0, retainedBytes: 0 },
      localWorkspaceMessages["zh-CN"].busy,
    ],
    [
      { status: "completed", deletedSessions: 0, freedBytes: 0, retainedBytes: 0 },
      localWorkspaceMessages["zh-CN"].nothingEligible,
    ],
  ])("explains a %j cleanup result", async (result, message) => {
    host.cleanup.mockResolvedValue(result)
    render(<LocalWorkspaceSettings />)
    await screen.findByText(size)
    await userEvent.click(
      screen.getByRole("button", { name: "立即清理" })
    )
    expect(await screen.findByText(message)).toBeVisible()
  })

  it("keeps a failed cleanup separate from a failed usage read", async () => {
    host.cleanup.mockRejectedValue(new Error("cleanup failed"))
    render(<LocalWorkspaceSettings />)
    await screen.findByText(size)
    await userEvent.click(
      screen.getByRole("button", { name: "立即清理" })
    )
    expect(
      await screen.findByText(localWorkspaceMessages["zh-CN"].failed)
    ).toBeVisible()
  })

  it("refreshes usage after a lost cleanup result instead of implying nothing was removed", async () => {
    host.cleanup.mockRejectedValue(new Error("runtime stopped"))
    host.usage.mockResolvedValueOnce(usage).mockResolvedValueOnce({
      ...usage,
      bytes: 0,
      files: 0,
      sessions: 0,
    })
    render(<LocalWorkspaceSettings />)
    await screen.findByText(size)
    await userEvent.click(
      screen.getByRole("button", { name: "立即清理" })
    )
    expect(
      await screen.findByText(localWorkspaceMessages["zh-CN"].failed)
    ).toBeVisible()
    await waitFor(() => expect(host.usage).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(size)).not.toBeInTheDocument()
  })

  it("retries an unavailable usage read", async () => {
    host.usage.mockRejectedValueOnce(new Error("runtime stopped"))
    render(<LocalWorkspaceSettings />)
    expect(
      await screen.findByText(localWorkspaceMessages["zh-CN"].unavailable)
    ).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(await screen.findByText(size)).toBeVisible()
  })

  it("ignores a duplicate cleanup activation", async () => {
    let finish: (value: object) => void = () => {
      throw new Error("cleanup did not start")
    }
    host.cleanup.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    render(<LocalWorkspaceSettings />)
    await screen.findByText(size)
    const button = screen.getByRole("button", { name: "立即清理" })
    const user = userEvent.setup()
    await user.click(button)
    await user.click(button)
    expect(host.cleanup).toHaveBeenCalledOnce()
    finish({
      status: "completed",
      deletedSessions: 1,
      freedBytes: 1024,
      retainedBytes: 0,
    })
    await waitFor(() => expect(host.cleanup).toHaveBeenCalledOnce())
  })

  it.each(supportedLocales)(
    "keeps translated controls, policy and messages for %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(<LocalWorkspaceSettings />)
      expect(
        screen.getByRole("button", {
          name: localWorkspaceMessages[locale].cleanup,
        })
      ).toBeVisible()
      expect(i18n.getResource(locale, "translation", "localWorkspace")).toEqual(
        localWorkspaceMessages[locale]
      )
      expect(
        i18n.t("localWorkspace.policy", { days: 14, budget: size })
      ).toContain("14")
    }
  )
})
