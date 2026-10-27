import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { browserExtensionRequest } from "@/features/local-browser/bridge"
import { installApiMock, renderApp, setupApplicationTests } from "./fixture"

vi.mock("@/features/local-browser/bridge", () => ({
  browserExtensionRequest: vi.fn(),
}))
vi.mock("@/features/local-browser/browser-support", () => ({
  browserUseBrowser: () => "chrome",
}))
setupApplicationTests()

it("opens Browser Use settings from a browser request, focuses and scrolls to the section, then returns to the same chat", async () => {
  vi.mocked(browserExtensionRequest).mockResolvedValue({ detected: false })
  const { requests } = installApiMock({
    browserUseIntent: true,
    conversationOverride: {
      messages: [
        { id: "browser-request", role: "user", content: "帮我打开一个网页" },
      ],
    },
  })
  renderApp("/conversations/c1")
  const link = await screen.findByRole("link", { name: "前往安装" })
  await userEvent.click(link)
  const section = await screen.findByRole("region", {
    name: "Browser Use",
  })
  expect(section).toHaveFocus()
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
    block: "start",
    behavior: "instant",
  })
  expect(screen.getByRole("link", { name: "返回 LinkSense" })).toHaveAttribute(
    "href",
    "/conversations/c1"
  )
  await userEvent.click(screen.getByRole("link", { name: "返回 LinkSense" }))
  await screen.findByRole("heading", { name: "活动风险评估" })
  await waitFor(() =>
    expect(
      screen.queryByRole("link", { name: "前往安装" })
    ).not.toBeInTheDocument()
  )
  expect(
    requests.some(
      (request) => request.method === "POST" && request.path.endsWith("/turns")
    )
  ).toBe(false)
})
