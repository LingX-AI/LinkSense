import appStyles from "@/index.css?raw"
import prototypeComposerSource from "@/components/prototype/composer.tsx?raw"
import supportMenuSource from "@/components/shell/support-menu.tsx?raw"
import avatarSource from "@/components/ui/avatar.tsx?raw"
import adminFeedbackPageSource from "@/pages/admin-feedback-page.tsx?raw"
import { describe, expect, it } from "vitest"

describe("image display containment", () => {
  it("keeps image previews complete while allowing avatars to crop", () => {
    expect(appStyles).not.toMatch(/object-fit:\s*cover;/u)

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
