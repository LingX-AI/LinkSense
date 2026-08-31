import imagePreviewStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("image preview overlay theme styles", () => {
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
    expect(rootRule).toMatch(/--app-media-control:\s*rgb\(32 32 32 \/ 8%\);/u)
    expect(rootRule).toMatch(
      /--app-media-control-hover:\s*rgb\(32 32 32 \/ 10%\);/u
    )
    expect(rootRule).toMatch(/--app-media-foreground:\s*#242424;/u)

    expect(darkRule).toMatch(/--app-media-backdrop:\s*rgb\(0 0 0 \/ 92%\);/u)
    expect(darkRule).toMatch(/--app-media-backdrop-filter:\s*none;/u)
    expect(darkRule).toMatch(
      /--app-media-control:\s*rgb\(255 255 255 \/ 12%\);/u
    )
    expect(darkRule).toMatch(
      /--app-media-control-hover:\s*rgb\(255 255 255 \/ 16%\);/u
    )
    expect(darkRule).toMatch(/--app-media-foreground:\s*#ffffff;/u)

    expect(overlayRule).toMatch(/background:\s*transparent;/u)
    expect(overlayRule).toMatch(/(?:^|\s)backdrop-filter:\s*none;/u)

    expect(dialogRule).toMatch(/background:\s*var\(--app-media-backdrop\);/u)
    expect(dialogRule).toMatch(
      /(?:^|\s)backdrop-filter:\s*var\(--app-media-backdrop-filter\);/u
    )
  })
})
