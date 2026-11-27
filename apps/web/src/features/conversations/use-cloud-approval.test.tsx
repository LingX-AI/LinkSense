import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DesktopCloudApproval } from "@/adapters/desktop/desktop-device-adapter"

const native = vi.hoisted(() => ({
  mac: true,
  list: vi.fn(),
  answer: vi.fn(),
  approvalListener: undefined as
    | ((approval: DesktopCloudApproval) => void)
    | undefined,
  settledListener: undefined as ((id: string) => void) | undefined,
}))

vi.mock("@/adapters/desktop/desktop-adapter", () => ({
  isMacDesktopHost: () => native.mac,
}))

vi.mock("@/adapters/desktop/desktop-device-adapter", () => ({
  listDesktopCloudApprovals: native.list,
  answerDesktopCloudApproval: native.answer,
  subscribeDesktopCloudApproval: (
    listener: (approval: DesktopCloudApproval) => void
  ) => {
    native.approvalListener = listener
    return () => {
      native.approvalListener = undefined
    }
  },
  subscribeDesktopCloudApprovalSettled: (listener: (id: string) => void) => {
    native.settledListener = listener
    return () => {
      native.settledListener = undefined
    }
  },
}))

import { useCloudApproval } from "./use-cloud-approval"

const conversationA = "71000000-0000-4000-8000-000000000001"
const conversationB = "71000000-0000-4000-8000-000000000002"
const requestA = "72000000-0000-4000-8000-000000000001"
const requestB = "72000000-0000-4000-8000-000000000002"

function approval(
  id: string,
  conversationId: string,
  overrides: Partial<DesktopCloudApproval> = {}
): DesktopCloudApproval {
  return {
    id,
    conversationId,
    kind: "command",
    operation: "local_shell.exec",
    command: "pnpm test",
    cwd: "apps/web",
    rootName: "project",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  }
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  native.mac = true
  native.list.mockReset().mockResolvedValue([])
  native.answer.mockReset().mockResolvedValue(undefined)
  native.approvalListener = undefined
  native.settledListener = undefined
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useCloudApproval", () => {
  it("shows only the mounted conversation's live approval", async () => {
    native.list.mockResolvedValue([
      approval(requestA, conversationA),
      approval(requestB, conversationB),
    ])
    const { result } = renderHook(() => useCloudApproval(conversationA), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.approval?.id).toBe(requestA))
    expect(result.current.approval?.command).toBe("pnpm test")
  })

  it("adds and settles approvals from native events", async () => {
    const { result } = renderHook(() => useCloudApproval(conversationA), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(native.list).toHaveBeenCalledOnce())
    act(() => native.approvalListener?.(approval(requestA, conversationA)))
    await waitFor(() => expect(result.current.approval?.id).toBe(requestA))
    act(() => native.settledListener?.(requestA))
    await waitFor(() => expect(result.current.approval).toBeNull())
  })

  it("answers once and drops the card", async () => {
    native.list.mockResolvedValue([approval(requestA, conversationA)])
    const { result } = renderHook(() => useCloudApproval(conversationA), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.approval?.id).toBe(requestA))
    await act(() => result.current.answer("allow"))
    expect(native.answer).toHaveBeenCalledWith(requestA, "allow")
    await waitFor(() => expect(result.current.approval).toBeNull())
  })

  it("keeps the card with an unconfirmed warning when the native answer fails", async () => {
    native.list.mockResolvedValue([approval(requestA, conversationA)])
    native.answer.mockRejectedValue(new Error("DESKTOP_APPROVAL_UNKNOWN"))
    const { result } = renderHook(() => useCloudApproval(conversationA), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.approval?.id).toBe(requestA))
    await act(() => result.current.answer("deny"))
    expect(result.current.failed).toBe(true)
    expect(result.current.approval?.id).toBe(requestA)
    act(() => native.settledListener?.(requestA))
    await waitFor(() => expect(result.current.approval).toBeNull())
  })

  it("removes an approval when its native deadline passes", async () => {
    native.list.mockResolvedValue([
      approval(requestA, conversationA, {
        expiresAt: new Date(Date.now() + 50).toISOString(),
      }),
    ])
    const { result } = renderHook(() => useCloudApproval(conversationA), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.approval?.id).toBe(requestA))
    await waitFor(() => expect(result.current.approval).toBeNull(), {
      timeout: 2_000,
    })
  })

  it("stays empty outside a macOS host", async () => {
    native.mac = false
    const { result } = renderHook(() => useCloudApproval(conversationA), {
      wrapper: createWrapper(),
    })
    expect(result.current.approval).toBeNull()
    expect(native.list).not.toHaveBeenCalled()
  })
})
