import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { supportedLocales } from "@linksense/shared"

import i18n from "@/i18n"
import { LocalWorkspaceClearedNotice } from "./local-workspace-notice"
import { localWorkspaceMessages } from "./messages"

const state = vi.hoisted(() => ({
  desktop: true,
  userId: "10000000-0000-4000-8000-000000000001" as string | null,
  notice: vi.fn(),
}))
vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => state.desktop,
  readDesktopWorkspaceNotice: state.notice,
}))
vi.mock("@/app/auth-state", () => ({
  useAuth: () => ({
    user: state.userId === null ? null : { id: state.userId },
  }),
}))

const conversationId = "40000000-0000-4000-8000-000000000001"

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(async () => {
  state.desktop = true
  state.userId = "10000000-0000-4000-8000-000000000001"
  state.notice.mockReset()
  await i18n.changeLanguage("zh-CN")
})
afterEach(cleanup)

describe("local workspace cleared notice", () => {
  it("makes no native call in a browser, signed-out, or new conversation", async () => {
    state.desktop = false
    render(<LocalWorkspaceClearedNotice conversationId={conversationId} />, {
      wrapper,
    })
    expect(state.notice).not.toHaveBeenCalled()

    state.desktop = true
    state.userId = null
    render(<LocalWorkspaceClearedNotice conversationId={conversationId} />, {
      wrapper,
    })
    render(<LocalWorkspaceClearedNotice conversationId="new" />, { wrapper })
    await Promise.resolve()
    expect(state.notice).not.toHaveBeenCalled()
  })

  it("shows only a confirmed clear and never a path or token", async () => {
    state.notice.mockResolvedValue({ cleared: true })
    render(<LocalWorkspaceClearedNotice conversationId={conversationId} />, {
      wrapper,
    })
    expect(
      await screen.findByText(localWorkspaceMessages["zh-CN"].clearedTitle)
    ).toBeVisible()
    expect(state.notice).toHaveBeenCalledWith(conversationId)
    expect(
      screen.getByText(localWorkspaceMessages["zh-CN"].clearedDescription)
    ).toBeVisible()
    expect(document.body.textContent).not.toMatch(/\/tmp|lsdr_|lsdm_/u)
  })

  it("stays silent when the host has no owned, current-origin clear", async () => {
    state.notice.mockResolvedValue({ cleared: false })
    render(<LocalWorkspaceClearedNotice conversationId={conversationId} />, {
      wrapper,
    })
    await waitFor(() => expect(state.notice).toHaveBeenCalledOnce())
    expect(
      screen.queryByText(localWorkspaceMessages["zh-CN"].clearedTitle)
    ).not.toBeInTheDocument()

    state.notice.mockReset()
    state.notice.mockRejectedValue(new Error("AUTH_REQUIRED"))
    render(<LocalWorkspaceClearedNotice conversationId={conversationId} />, {
      wrapper,
    })
    await waitFor(() => expect(state.notice).toHaveBeenCalledOnce())
    expect(
      screen.queryByText(localWorkspaceMessages["zh-CN"].clearedTitle)
    ).not.toBeInTheDocument()
  })

  it("refetches for another signed-in account instead of reusing the previous answer", async () => {
    state.notice.mockResolvedValueOnce({ cleared: true })
    const view = render(
      <LocalWorkspaceClearedNotice conversationId={conversationId} />,
      { wrapper }
    )
    await screen.findByText(localWorkspaceMessages["zh-CN"].clearedTitle)
    state.userId = "10000000-0000-4000-8000-000000000002"
    state.notice.mockResolvedValueOnce({ cleared: false })
    view.rerender(<LocalWorkspaceClearedNotice conversationId={conversationId} />)
    await waitFor(() =>
      expect(
        screen.queryByText(localWorkspaceMessages["zh-CN"].clearedTitle)
      ).not.toBeInTheDocument()
    )
    expect(state.notice).toHaveBeenCalledTimes(2)
  })

  it.each(supportedLocales)(
    "keeps the notice translated in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      state.notice.mockResolvedValue({ cleared: true })
      render(<LocalWorkspaceClearedNotice conversationId={conversationId} />, {
        wrapper,
      })
      expect(
        await screen.findByText(localWorkspaceMessages[locale].clearedTitle)
      ).toBeVisible()
      expect(
        screen.getByText(localWorkspaceMessages[locale].clearedDescription)
      ).toBeVisible()
    }
  )
})
