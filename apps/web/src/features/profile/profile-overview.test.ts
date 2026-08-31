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

  it("uses low-contrast profile controls and model progress indicators", () => {
    const profileAvatarTokens = appStyles.match(
      /--app-profile-avatar:\s*color-mix\(\s*in srgb,\s*var\(--app-avatar\) 58%,\s*var\(--app-canvas\)\s*\);/gu
    )
    const avatarRule = appStyles.match(
      /\.profile-hero-avatar\s*\{([^}]*)\}/u
    )?.[1]
    const avatarFallbackRule = appStyles.match(
      /\.profile-hero-avatar-fallback\s*\{([^}]*)\}/u
    )?.[1]
    const editButtonRule = appStyles.match(
      /\.profile-name-edit-button\s*\{([^}]*)\}/u
    )?.[1]
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

    expect(profileAvatarTokens).toHaveLength(2)
    expect(avatarRule).toMatch(/background:\s*var\(--app-profile-avatar\);/u)
    expect(avatarFallbackRule).toMatch(
      /background:\s*var\(--app-profile-avatar\);/u
    )
    expect(editButtonRule).toMatch(
      /color:\s*color-mix\(in srgb, var\(--app-muted\) 55%, var\(--app-canvas\)\);/u
    )
    expect(progressIndicatorRule).toMatch(
      /background:\s*color-mix\(in srgb, var\(--app-text\) 68%, var\(--app-muted\)\);/u
    )
    expect(insightRowRule).toMatch(/padding:\s*6px 0;/u)
    expect(insightValueRule).toMatch(/text-align:\s*right;/u)
    expect(insightColumnRule).toMatch(/display:\s*grid;/u)
    expect(insightColumnRule).toMatch(/align-content:\s*start;/u)
  })
})
