// @vitest-environment node

import fileIconStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("file type icon layout", () => {
  it("uses a transparent container and slightly larger file icons", () => {
    const containerRule = fileIconStyles.match(
      /\.file-icon\s*\{([^}]*)\}/u
    )?.[1]
    const cardIconRule = fileIconStyles.match(
      /\.file-icon \.file-type-icon\s*\{([^}]*)\}/u
    )?.[1]
    const composerIconRule = fileIconStyles.match(
      /\.attachment-chip > \.file-type-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(containerRule).toMatch(/width:\s*36px;/u)
    expect(containerRule).toMatch(/height:\s*36px;/u)
    expect(containerRule).toMatch(/background:\s*transparent;/u)
    expect(containerRule).not.toMatch(/border-radius:/u)
    expect(cardIconRule).toMatch(/width:\s*32px;/u)
    expect(cardIconRule).toMatch(/height:\s*32px;/u)
    expect(composerIconRule).toMatch(/width:\s*18px;/u)
    expect(composerIconRule).toMatch(/height:\s*18px;/u)
  })

  it("matches the file name to message text and keeps metadata one size smaller", () => {
    const fileNameRule = fileIconStyles.match(
      /\.file-tile-name\s*\{([^}]*)\}/u
    )?.[1]
    const fileMetaRule = fileIconStyles.match(
      /\.file-tile-meta\s*\{([^}]*)\}/u
    )?.[1]

    expect(fileNameRule).toMatch(/font-size:\s*var\(--app-ui-font-size\);/u)
    expect(fileNameRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(fileMetaRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
    expect(fileMetaRule).toMatch(/font-weight:\s*400;/u)
    expect(fileMetaRule).toMatch(/line-height:\s*var\(--app-line-19\);/u)
  })
})
