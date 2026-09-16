// @vitest-environment node

import imagePreviewStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("image preview overlay theme styles", () => {
  it("extends full-screen previews to the top and bottom on desktop and mobile", () => {
    const stages = [
      ...imagePreviewStyles.matchAll(
        /^\s*\.image-preview-stage\s*\{([^}]*)\}/gmu
      ),
    ].map((match) => match[1])
    expect(stages).toHaveLength(2)
    expect(stages[0]).toMatch(/inset:\s*0 64px;/u)
    expect(stages[1]).toMatch(/inset:\s*0 42px;/u)
    for (const stage of stages) {
      expect(stage).not.toMatch(/(?:padding|margin)(?:-block|-top|-bottom)?:/u)
    }
  })
  it("lets images fill the conversation and file preview panes without reserving space for controls", () => {
    const stageRule = imagePreviewStyles.match(
      /\.conversation-image-preview-viewer \.image-preview-stage,\s*\.read-only-file-preview-image-viewer \.image-preview-stage\s*\{([^}]*)\}/u
    )?.[1]

    expect(stageRule).toMatch(/@apply\s+inset-0;/u)
    expect(stageRule).not.toMatch(/(?:padding|margin):/u)
  })

  it("keeps image and diagram toolbars opaque and above transformed images", () => {
    const sharedControlsRule = imagePreviewStyles.match(
      /\.image-preview-zoom-controls\s*\{([^}]*)\}/u
    )?.[1]
    const paneControlsRule = imagePreviewStyles.match(
      /\.conversation-image-preview-viewer \.image-preview-zoom-controls,\s*\.read-only-file-preview-image-viewer \.image-preview-zoom-controls\s*\{([^}]*)\}/u
    )?.[1]

    expect(sharedControlsRule).toMatch(/position:\s*absolute;/u)
    expect(sharedControlsRule).toMatch(/left:\s*50%;/u)
    expect(paneControlsRule).toMatch(/bottom:\s*18px;/u)
    expect(paneControlsRule).toMatch(/transform:\s*translateX\(-50%\);/u)
    expect(sharedControlsRule).toMatch(
      /background:\s*var\(--app-media-control\);/u
    )
    expect(sharedControlsRule).toMatch(/z-index:\s*2;/u)
    expect(paneControlsRule).not.toMatch(
      /bg-background\/|backdrop-blur|opacity:/u
    )
    const stageRule = imagePreviewStyles.match(
      /\.image-preview-stage\s*\{([^}]*)\}/u
    )?.[1]
    const viewerRule = imagePreviewStyles.match(
      /\.image-preview-viewer\s*\{([^}]*)\}/u
    )?.[1]
    expect(stageRule).toMatch(/z-index:\s*0;/u)
    expect(viewerRule).toMatch(/isolation:\s*isolate;/u)
    expect(paneControlsRule).not.toMatch(/(?:^|\s)background:/u)
  })

  it("uses a white blurred backdrop in light mode and keeps the dark backdrop unchanged", () => {
    const rootRule = imagePreviewStyles.match(/:root\s*\{([\s\S]*?)\n\}/u)?.[1]
    const darkRule = imagePreviewStyles.match(/\.dark\s*\{([\s\S]*?)\n\}/u)?.[1]
    const overlayRule = imagePreviewStyles.match(
      /\.image-preview-overlay\s*\{([^}]*)\}/u
    )?.[1]
    const dialogRule = imagePreviewStyles.match(
      /\.image-preview-dialog\s*\{([^}]*)\}/u
    )?.[1]

    expect(rootRule).toMatch(
      /--app-media-backdrop:\s*rgb\(255 255 255 \/ 48%\);/u
    )
    expect(rootRule).toMatch(
      /--app-media-backdrop-filter:\s*blur\(32px\) saturate\(1\.12\);/u
    )
    expect(rootRule).toMatch(/--app-media-control:\s*#ededed;/u)
    expect(rootRule).toMatch(/--app-media-control-hover:\s*#e9e9e9;/u)
    expect(rootRule).toMatch(/--app-media-foreground:\s*#242424;/u)

    expect(darkRule).toMatch(/--app-media-backdrop:\s*rgb\(0 0 0 \/ 92%\);/u)
    expect(darkRule).toMatch(/--app-media-backdrop-filter:\s*none;/u)
    expect(darkRule).toMatch(/--app-media-control:\s*#303030;/u)
    expect(darkRule).toMatch(/--app-media-control-hover:\s*#393939;/u)
    expect(darkRule).toMatch(/--app-media-foreground:\s*#ffffff;/u)

    expect(overlayRule).toMatch(/background:\s*transparent;/u)
    expect(overlayRule).toMatch(/(?:^|\s)backdrop-filter:\s*none;/u)

    expect(dialogRule).toMatch(/background:\s*var\(--app-media-backdrop\);/u)
    expect(dialogRule).toMatch(
      /(?:^|\s)backdrop-filter:\s*var\(--app-media-backdrop-filter\);/u
    )
  })
})

describe("images embedded in Markdown", () => {
  it("keeps viewer sizing and transforms separate from static Markdown image styling", () => {
    expect(imagePreviewStyles).toMatch(
      /img:not\(\.conversation-image-thumbnail-image\):not\(\.image-preview-image\):not\(\[data-diagram-image\]\)/u
    )
  })
})
