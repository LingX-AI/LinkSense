import { afterEach, expect, it, vi } from "vitest"
import {
  nearestPreviewCorner,
  previewCornerPosition,
  previewPositionWithoutOverlap,
  readPreviewCorner,
} from "./preview-position"

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
it.each([
  ["top-left", 0, 0],
  ["top-right", 712, 0],
  ["bottom-left", 0, 480],
  ["bottom-right", 712, 480],
] as const)("snaps %s to container-relative coordinates", (corner, x, y) => {
  const bounds = { width: 1000, height: 700 }
  const panel = { width: 288, height: 220 }
  expect(previewCornerPosition(corner, bounds, panel)).toEqual({ x, y })
  expect(
    nearestPreviewCorner(
      { x: x + (x ? -30 : 30), y: y + (y ? -30 : 30) },
      bounds,
      panel
    )
  ).toBe(corner)
})
it("keeps the preview reachable after its container becomes smaller", () => {
  expect(
    previewCornerPosition(
      "bottom-right",
      { width: 160, height: 100 },
      { width: 288, height: 220 }
    )
  ).toEqual({ x: 0, y: 0 })
  expect(
    nearestPreviewCorner(
      { x: -100, y: -100 },
      { width: 600, height: 500 },
      { width: 288, height: 220 }
    )
  ).toBe("top-left")
})
it("validates the saved corner and works without local storage", () => {
  expect(readPreviewCorner("position")).toBe("bottom-right")
  localStorage.setItem("position", "top-right")
  expect(readPreviewCorner("position")).toBe("top-right")
  localStorage.setItem("position", "invalid")
  expect(readPreviewCorner("position")).toBe("bottom-right")
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("unavailable")
  })
  expect(readPreviewCorner("position")).toBe("bottom-right")
})

it("keeps a preferred corner that is already clear of the overview", () => {
  expect(
    previewPositionWithoutOverlap(
      "bottom-right",
      { width: 1000, height: 700 },
      { width: 288, height: 220 },
      { x: 700, y: 0, width: 300, height: 300 }
    )
  ).toEqual({ x: 712, y: 480 })
})

it("uses the nearest clear corner instead of placing the preview under the overview", () => {
  expect(
    previewPositionWithoutOverlap(
      "top-right",
      { width: 1000, height: 700 },
      { width: 288, height: 220 },
      { x: 700, y: 0, width: 300, height: 300 }
    )
  ).toEqual({ x: 712, y: 480 })
})

it("moves left when the right side has no clear vertical space", () => {
  expect(
    previewPositionWithoutOverlap(
      "top-right",
      { width: 640, height: 400 },
      { width: 288, height: 220 },
      { x: 340, y: 0, width: 300, height: 400 }
    )
  ).toEqual({ x: 0, y: 0 })
})

it("requests a compact preview when every corner would overlap", () => {
  expect(
    previewPositionWithoutOverlap(
      "bottom-right",
      { width: 320, height: 260 },
      { width: 288, height: 220 },
      { x: 12, y: 16, width: 296, height: 200 }
    )
  ).toBeNull()
})

it("restores the preferred position when the overview closes", () => {
  expect(
    previewPositionWithoutOverlap(
      "top-right",
      { width: 320, height: 260 },
      { width: 288, height: 220 }
    )
  ).toEqual({ x: 32, y: 0 })
})
