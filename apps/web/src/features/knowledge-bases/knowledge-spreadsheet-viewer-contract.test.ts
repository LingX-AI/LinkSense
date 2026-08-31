import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

import { describe, expect, it } from "vitest"

const loadSpreadsheetRendererSource = () => {
  const require = createRequire(import.meta.url)
  const officePresetEntry = require.resolve("@file-viewer/preset-office")
  const officePresetRequire = createRequire(officePresetEntry)
  const spreadsheetRendererEntry = officePresetRequire.resolve(
    "@file-viewer/renderer-spreadsheet"
  )

  return readFileSync(
    join(dirname(spreadsheetRendererEntry), "spreadsheet", "view.js"),
    "utf8"
  )
}

describe("knowledge spreadsheet viewer dependency contract", () => {
  it("keeps grid lines without reserving framed outer scrollbar tracks", () => {
    const rendererSource = loadSpreadsheetRendererSource()

    expect(rendererSource).toMatch(/BORDER:\s*['"]inner['"]/u)
    expect(rendererSource).toMatch(/scrollbarMode:\s*['"]inner['"]/u)
  })
})
