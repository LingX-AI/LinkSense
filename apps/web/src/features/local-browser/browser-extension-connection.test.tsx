import { cleanup, render, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import { browserExtensionRequest } from "./bridge"
import { BrowserExtensionConnection } from "./browser-extension-connection"
import { browserUseBrowser } from "./browser-support"

const auth = vi.hoisted(() => ({
  status: "authenticated",
  user: { id: "10000000-0000-4000-8000-000000000001" },
}))
vi.mock("@/app/auth-state", () => ({ useAuth: () => auth }))
vi.mock("@/api/client", () => ({ apiRequest: vi.fn() }))
vi.mock("./bridge", () => ({ browserExtensionRequest: vi.fn() }))
vi.mock("./browser-support", () => ({
  browserUseBrowser: vi.fn(() => "chrome"),
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(browserUseBrowser).mockReturnValue("chrome")
  auth.status = "authenticated"
  vi.mocked(browserExtensionRequest).mockResolvedValue({ detected: false })
})
afterEach(cleanup)
it("does not detect or pair an extension in an unsupported browser", () => {
  vi.mocked(browserUseBrowser).mockReturnValue(null)
  show()
  expect(browserExtensionRequest).not.toHaveBeenCalled()
  expect(apiRequest).not.toHaveBeenCalled()
})
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <BrowserExtensionConnection />
    </QueryClientProvider>
  )
}
it("does not pair before login or when the extension is missing", async () => {
  auth.status = "anonymous"
  const page = show()
  expect(browserExtensionRequest).not.toHaveBeenCalled()
  page.unmount()
  auth.status = "authenticated"
  show()
  await waitFor(() => expect(browserExtensionRequest).toHaveBeenCalled())
  expect(apiRequest).not.toHaveBeenCalled()
})
it.each(["connected", "reconnecting", "blocked", "pending"] as const)(
  "does not issue another pairing for %s",
  async (pairing_mode) => {
    vi.mocked(browserExtensionRequest).mockResolvedValue({
      detected: true,
      pairing_mode,
    })
    show()
    await waitFor(() => expect(browserExtensionRequest).toHaveBeenCalled())
    expect(apiRequest).not.toHaveBeenCalled()
  }
)
it.each(["automatic", "confirmation"] as const)(
  "starts %s pairing from any authenticated page",
  async (pairing_mode) => {
    const pairing = {
      code: "p".repeat(43),
      endpoint: "https://linksense.example/api/v1/local-browser",
    }
    vi.mocked(browserExtensionRequest)
      .mockResolvedValueOnce({ detected: true, pairing_mode })
      .mockResolvedValue({ ok: true })
    vi.mocked(apiRequest).mockResolvedValue(pairing)
    show()
    await waitFor(() =>
      expect(browserExtensionRequest).toHaveBeenCalledWith("pair", pairing, {
        owner_id: auth.user.id,
        automatic: true,
      })
    )
    expect(apiRequest).toHaveBeenCalledExactlyOnceWith(
      "/local-browser/pairing",
      expect.objectContaining({ method: "POST", body: {} })
    )
  }
)
