import { describe, expect, it } from "vitest"

import { createContentSecurityPolicy } from "../src/app.js"

describe("createContentSecurityPolicy", () => {
  it("keeps executable and framed content on the LinkSense origin", () => {
    const policy = createContentSecurityPolicy()

    expect(policy).toContain("script-src 'self'")
    expect(policy).toContain("frame-src 'self'")
    expect(policy).not.toContain("office.example.test")
    expect(policy).toContain(
      "frame-ancestors 'self' https://teams.microsoft.com https://*.teams.microsoft.com",
    )
  })
})
