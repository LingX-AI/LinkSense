// @vitest-environment node

import appStyles from "@/index.css?raw"
import prototypeComposerSource from "@/components/prototype/composer.tsx?raw"
import supportMenuSource from "@/components/shell/support-menu.tsx?raw"
import avatarSource from "@/components/ui/avatar.tsx?raw"
import adminFeedbackPageSource from "@/pages/admin-feedback-page.tsx?raw"
import { describe, expect, it } from "vitest"

describe("image display containment", () => {
  it("keeps full image previews complete while allowing thumbnails and avatars to crop", () => {
    expect(appStyles).toMatch(
      /\.image-preview-image\s*\{[^}]*object-fit:\s*contain;/u
    )
    expect(appStyles).toMatch(
      /\.assistant-markdown\s+img:not\(\.conversation-image-thumbnail-image\):not\(\.image-preview-image\):not\(\s*\[data-diagram-image\]\s*\)\s*\{[^}]*object-fit:\s*contain;/u
    )
    expect(appStyles).toMatch(
      /\.conversation-image-thumbnail-image,\s*\.native-activity-image-preview-image\s*\{[^}]*object-fit:\s*cover;/u
    )

    const previewSources = [
      adminFeedbackPageSource,
      supportMenuSource,
      prototypeComposerSource,
    ]

    for (const source of previewSources) {
      expect(source).not.toContain("object-cover")
    }

    expect(avatarSource).toContain("object-cover")
  })
})
