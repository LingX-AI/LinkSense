import { describe, expect, it } from "vitest"

import embedStyles from "./embed.css?raw"

describe("embedded application motion", () => {
  it("stops decorative gate animation when reduced motion is requested", () => {
    expect(embedStyles).toContain("@media (prefers-reduced-motion: reduce)")
    expect(embedStyles).toMatch(
      /\.embed-gate-indicator\s*\{[^}]*animation:\s*none/gu
    )
  })
})
