// @vitest-environment node

import appStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

import {
  averageTokensPerTurn,
  usageSharePercentage,
} from "@/features/profile/profile-usage"

describe("profile usage presentation helpers", () => {
  it("rounds average tokens per turn without losing integer precision", () => {
    expect(averageTokensPerTurn("100", 3)).toBe("33")
    expect(averageTokensPerTurn("101", 3)).toBe("34")
    expect(averageTokensPerTurn("9007199254740993", 3)).toBe("3002399751580331")
    expect(averageTokensPerTurn("100", 0)).toBe("0")
  })

  it("calculates a bounded one-decimal model usage percentage", () => {
    expect(usageSharePercentage("1", "3")).toBe(33.3)
    expect(usageSharePercentage("3", "3")).toBe(100)
    expect(usageSharePercentage("4", "3")).toBe(100)
    expect(usageSharePercentage("0", "0")).toBe(0)
  })

  it("uses a readable themed avatar and a horizontal profile card while keeping model progress indicators", () => {
    const avatarRule = appStyles.match(
      /\.profile-hero-avatar,\s*\.profile-hero-avatar-fallback\s*\{([^}]*)\}/u
    )?.[1]
    const heroRule = appStyles.match(/\.profile-hero\s*\{([^}]*)\}/u)?.[1]
    const progressIndicatorRule = appStyles.match(
      /\.profile-model-progress\s+\[data-slot="progress-indicator"\]\s*\{([^}]*)\}/u
    )?.[1]
    const insightRowRule = appStyles.match(
      /\.profile-insight-list > div\s*\{([^}]*)\}/u
    )?.[1]
    const insightValueRule = appStyles.match(
      /\.profile-insight-list dd\s*\{([^}]*)\}/u
    )?.[1]
    const insightColumnRule = appStyles.match(
      /\.profile-insight-column\s*\{([^}]*)\}/u
    )?.[1]

    expect(avatarRule).toMatch(/background:\s*var\(--primary-action\);/u)
    expect(heroRule).toMatch(/display:\s*flex;/u)
    expect(heroRule).toMatch(/border-radius:\s*var\(--app-card-radius\);/u)
    expect(heroRule).not.toMatch(/flex-direction:\s*column;/u)
    expect(progressIndicatorRule).toMatch(
      /background:\s*color-mix\(in srgb, var\(--app-text\) 68%, var\(--app-muted\)\);/u
    )
    expect(insightRowRule).toMatch(/padding:\s*6px 0;/u)
    expect(insightValueRule).toMatch(/text-align:\s*right;/u)
    expect(insightColumnRule).toMatch(/display:\s*grid;/u)
    expect(insightColumnRule).toMatch(/align-content:\s*start;/u)
  })
})
