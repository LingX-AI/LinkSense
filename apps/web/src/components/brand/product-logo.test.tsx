import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { BootstrapContext } from "@/app/bootstrap-state"
import { ProductLogo } from "@/components/brand/product-logo"

describe("ProductLogo", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark")
    delete document.documentElement.dataset.theme
  })

  afterEach(() => cleanup())

  it("renders the LinkSense lockup with the product name as accessible text", () => {
    render(<ProductLogo productName="LinkSense" className="custom-logo" />)

    const logo = screen.getByRole("img", { name: "LinkSense" })

    expect(logo).toHaveClass("product-logo")
    expect(logo).toHaveClass("custom-logo")
    expect(logo).toHaveAttribute(
      "src",
      expect.stringContaining("linksense-lockup-primary.svg")
    )
  })

  it("uses the on-dark LinkSense lockup in dark mode", () => {
    document.documentElement.dataset.theme = "dark"
    document.documentElement.classList.add("dark")

    render(<ProductLogo productName="LinkSense" />)

    expect(screen.getByRole("img", { name: "LinkSense" })).toHaveAttribute(
      "src",
      expect.stringContaining("linksense-lockup-on-dark.svg")
    )
  })

  it("prefers an explicit custom logo url", () => {
    render(
      <ProductLogo
        productName="LinkSense"
        className="custom-logo"
        logoUrl="/api/v1/system/logo?v=custom"
      />
    )

    expect(screen.getByRole("img", { name: "LinkSense" })).toHaveAttribute(
      "src",
      "/api/v1/system/logo?v=custom"
    )
  })

  it("uses the configured bootstrap logo when no explicit logo url is provided", () => {
    render(
      <BootstrapContext.Provider
        value={{
          bootstrap: {
          initialized: true,
          initialization_credential_required: false,
            system_name: "LinkSense",
            default_language: "zh-CN",
            logo_url: "/api/v1/system/logo?v=bootstrap",
            logo_updated_at: "2026-08-05T00:00:00.000Z",
            oidc: undefined,
            teams_sso: undefined,
            password_email: undefined,
          },
          isLoading: false,
          error: null,
          refetch: () => undefined,
        }}
      >
        <ProductLogo productName="LinkSense" />
      </BootstrapContext.Provider>
    )

    expect(screen.getByRole("img", { name: "LinkSense" })).toHaveAttribute(
      "src",
      "/api/v1/system/logo?v=bootstrap"
    )
  })
})
