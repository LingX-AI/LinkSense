import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import {
  SystemUpdateNotice,
  SystemUpdateSettings,
} from "@/features/admin/system-update"
import i18n from "@/i18n"

const authState = vi.hoisted(() => ({
  user: {
    id: "01900000-0000-7000-8000-000000000099",
    role: "admin",
    status: "active",
  } as { id: string; role: "admin" | "user"; status: "active" },
}))

vi.mock("@/app/auth-state", () => ({
  useAuth: () => authState,
}))

const updateAvailable = {
  status: "update_available",
  current_version: "v0.1.1",
  latest_release: {
    version: "v0.2.0",
    name: "LinkSense v0.2.0",
    published_at: "2026-09-01T08:00:00.000Z",
    url: "https://github.com/LingX-AI/linksense/releases/tag/v0.2.0",
    release_notes: "Administrator update notifications.",
  },
  checked_at: "2026-09-01T09:00:00.000Z",
  error_code: null,
} as const

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function renderUpdateUi(component: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe("administrator system updates", () => {
  beforeEach(async () => {
    authState.user = {
      id: "01900000-0000-7000-8000-000000000099",
      role: "admin",
      status: "active",
    }
    window.localStorage.clear()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("shows a dismissible update notice only to an active administrator", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(envelope(updateAvailable))
    const interaction = userEvent.setup()

    renderUpdateUi(<SystemUpdateNotice />)

    expect(await screen.findByText("LinkSense v0.2.0 已发布")).toBeVisible()
    expect(screen.getByRole("link", { name: "查看更新" })).toHaveAttribute(
      "href",
      "/admin/system-update"
    )
    await interaction.click(
      screen.getByRole("button", { name: "暂时关闭此版本的更新提示" })
    )
    expect(
      screen.queryByText("LinkSense v0.2.0 已发布")
    ).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("does not request administrator update data for a regular user", async () => {
    authState.user = {
      id: "01900000-0000-7000-8000-000000000100",
      role: "user",
      status: "active",
    }
    const fetch = vi.spyOn(globalThis, "fetch")

    renderUpdateUi(<SystemUpdateNotice />)

    await waitFor(() => expect(fetch).not.toHaveBeenCalled())
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("shows update guidance for a newer release and hides it after becoming current", async () => {
    const upToDate = {
      ...updateAvailable,
      status: "up_to_date",
      current_version: "v0.2.0",
    } as const
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(envelope(updateAvailable))
      .mockResolvedValueOnce(envelope(upToDate))
    const interaction = userEvent.setup()

    renderUpdateUi(<SystemUpdateSettings />)

    expect(await screen.findByText("版本状态")).toBeVisible()
    expect(
      screen.getByText("Administrator update notifications.")
    ).toBeVisible()
    expect(
      screen.getByText(
        "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh"
      )
    ).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "立即检查" }))

    expect(await screen.findByText("已是最新版")).toBeVisible()
    await waitFor(() => {
      expect(screen.queryByText("更新教程")).not.toBeInTheDocument()
    })
    expect(
      screen.queryByText(
        "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh"
      )
    ).not.toBeInTheDocument()
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/admin/system-update/check",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("does not show update guidance when the release check fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({
        status: "check_failed",
        current_version: "v0.1.1",
        latest_release: null,
        checked_at: "2026-09-01T09:00:00.000Z",
        error_code: "GITHUB_UNAVAILABLE",
      })
    )

    renderUpdateUi(<SystemUpdateSettings />)

    expect(await screen.findByText("暂时无法获取最新版本")).toBeVisible()
    expect(screen.queryByText("更新教程")).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh"
      )
    ).not.toBeInTheDocument()
  })
})
