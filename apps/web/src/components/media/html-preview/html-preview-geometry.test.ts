import { describe, expect, it } from "vitest"

import { getHtmlPreviewBoundingRect } from "./html-preview-geometry"

describe("HTML preview bounding rectangle", () => {
  it("encloses separated and overlapping elements independently of their order", () => {
    const rects = [
      { left: 100, top: 40, width: 200, height: 60 },
      { left: -20, top: 80, width: 180, height: 200 },
      { left: 50, top: 350, width: 150, height: 20 },
    ]
    const expected = { left: -20, top: 40, width: 320, height: 330 }
    expect(getHtmlPreviewBoundingRect(rects)).toEqual(expected)
    expect(getHtmlPreviewBoundingRect(rects.toReversed())).toEqual(expected)
  })

  it("ignores empty and invalid bounds without expanding the selection", () => {
    const valid = { left: 10.5, top: 20.5, width: 30.5, height: 40.5 }
    const invalid = [
      { left: 0, top: 0, width: 0, height: 10 },
      { left: 0, top: 0, width: 10, height: -1 },
      { left: NaN, top: 0, width: 10, height: 10 },
      { left: 0, top: Infinity, width: 10, height: 10 },
    ]
    expect(getHtmlPreviewBoundingRect([valid, ...invalid])).toEqual(valid)
    expect(getHtmlPreviewBoundingRect(invalid)).toBeNull()
    expect(getHtmlPreviewBoundingRect([])).toBeNull()
  })
})
