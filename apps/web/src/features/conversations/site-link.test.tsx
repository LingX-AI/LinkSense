import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { downloadApiFile } from "@/api/client"
import { SiteLink } from "@/features/conversations/site-link"
import { getHttpsSiteIconOrigin } from "@/features/conversations/site-link-utils"

vi.mock("@/api/client", () => ({
  downloadApiFile: vi.fn(),
}))

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
)
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
)
const createObjectURL = vi.fn<(blob: Blob) => string>()
const revokeObjectURL = vi.fn<(url: string) => void>()

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(URL, name, descriptor)
  else Reflect.deleteProperty(URL, name)
}

describe("SiteLink", () => {
  beforeEach(() => {
    createObjectURL.mockReset().mockReturnValue("blob:site-icon")
    revokeObjectURL.mockReset()
    vi.mocked(downloadApiFile).mockReset()
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    restoreUrlMethod("createObjectURL", originalCreateObjectUrl)
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl)
  })

  it("loads an HTTPS favicon through the authenticated download client and releases its object URL", async () => {
    vi.mocked(downloadApiFile).mockResolvedValue(
      new Blob(["favicon"], { type: "image/png" })
    )
    const { unmount } = render(
      <SiteLink href="https://example.com/docs">查看文档</SiteLink>
    )

    const link = screen.getByRole("link", { name: "查看文档" })
    expect(link.querySelector('[data-slot="site-link-icon"]')).not.toBeNull()
    expect(downloadApiFile).toHaveBeenCalledWith("/site-icons", {
      origin: "https://example.com",
    })

    await waitFor(() => {
      expect(
        link.querySelector('[data-slot="site-link-icon"] img')
      ).toHaveAttribute("src", "blob:site-icon")
    })
    const image = link.querySelector('[data-slot="site-link-icon"] img')
    expect(image).toHaveAttribute("alt", "")
    expect(createObjectURL).toHaveBeenCalledOnce()

    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:site-icon")
  })

  it("keeps a generic link icon for HTTP links without requesting a site icon", () => {
    render(<SiteLink href="http://example.com/docs">查看文档</SiteLink>)

    expect(screen.getByRole("link", { name: "查看文档" })).toHaveTextContent(
      "查看文档"
    )
    expect(document.querySelector('[data-slot="site-link-icon"]')).not.toBeNull()
    expect(downloadApiFile).not.toHaveBeenCalled()
  })

  it("does not request an icon while streaming content is still changing", () => {
    render(
      <SiteLink href="https://streaming.example/docs" siteIconEnabled={false}>
        查看文档
      </SiteLink>
    )

    expect(document.querySelector('[data-slot="site-link-icon"]')).not.toBeNull()
    expect(downloadApiFile).not.toHaveBeenCalled()
  })

  it("normalizes only absolute HTTPS origins for site-icon requests", () => {
    expect(getHttpsSiteIconOrigin("https://example.com/path?q=1")).toBe(
      "https://example.com"
    )
    expect(getHttpsSiteIconOrigin("http://example.com/path")).toBeNull()
    expect(getHttpsSiteIconOrigin("/relative-path")).toBeNull()
    expect(getHttpsSiteIconOrigin("mailto:hello@example.com")).toBeNull()
  })

  it("memoizes an empty site-icon response instead of repeatedly spending the request budget", async () => {
    vi.mocked(downloadApiFile).mockResolvedValue(new Blob())
    const first = render(
      <SiteLink href="https://missing.example/docs">查看文档</SiteLink>
    )

    await waitFor(() => {
      expect(downloadApiFile).toHaveBeenCalledTimes(1)
    })
    first.unmount()

    render(
      <SiteLink href="https://missing.example/another-page">查看文档</SiteLink>
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(downloadApiFile).toHaveBeenCalledTimes(1)
  })

  it("retries after a transient site-icon request failure", async () => {
    vi.mocked(downloadApiFile)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(new Blob(["favicon"], { type: "image/png" }))
    const first = render(
      <SiteLink href="https://retry.example/docs">查看文档</SiteLink>
    )

    await waitFor(() => {
      expect(downloadApiFile).toHaveBeenCalledTimes(1)
    })
    first.unmount()

    const second = render(
      <SiteLink href="https://retry.example/another-page">查看文档</SiteLink>
    )
    await waitFor(() => {
      expect(downloadApiFile).toHaveBeenCalledTimes(2)
      expect(
        second.container.querySelector('[data-slot="site-link-icon"] img')
      ).toHaveAttribute("src", "blob:site-icon")
    })
  })
})
