import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  applyUiFontSize,
  clampUiFontSize,
  DEFAULT_UI_FONT_SIZE,
  initializeUiFontSize,
  MAX_UI_FONT_SIZE,
  MIN_UI_FONT_SIZE,
  normalizeUiFontSize,
  persistUiFontSize,
  readStoredUiFontSize,
  UI_FONT_SIZE_STORAGE_KEY,
} from "@/app/ui-font-size"

describe("UI font-size preferences", () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.style.removeProperty("--app-ui-font-size")
    delete document.documentElement.dataset.uiFontSize
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.documentElement.style.removeProperty("--app-ui-font-size")
    delete document.documentElement.dataset.uiFontSize
  })

  it("normalizes only supported integer values", () => {
    expect(normalizeUiFontSize(MIN_UI_FONT_SIZE)).toBe(MIN_UI_FONT_SIZE)
    expect(normalizeUiFontSize(String(DEFAULT_UI_FONT_SIZE))).toBe(
      DEFAULT_UI_FONT_SIZE
    )
    expect(normalizeUiFontSize(MAX_UI_FONT_SIZE)).toBe(MAX_UI_FONT_SIZE)
    expect(normalizeUiFontSize(11)).toBeNull()
    expect(normalizeUiFontSize(19)).toBeNull()
    expect(normalizeUiFontSize(12.5)).toBeNull()
    expect(normalizeUiFontSize("")).toBeNull()
    expect(normalizeUiFontSize("font-size")).toBeNull()
    expect(normalizeUiFontSize(Number.POSITIVE_INFINITY)).toBeNull()
    expect(normalizeUiFontSize(null)).toBeNull()
  })

  it("rounds and clamps editable values to the supported range", () => {
    expect(clampUiFontSize(11)).toBe(MIN_UI_FONT_SIZE)
    expect(clampUiFontSize(12.6)).toBe(13)
    expect(clampUiFontSize(99)).toBe(MAX_UI_FONT_SIZE)
    expect(clampUiFontSize(Number.NaN)).toBe(DEFAULT_UI_FONT_SIZE)
  })

  it("reads a valid saved value and falls back for invalid or blocked storage", () => {
    expect(readStoredUiFontSize()).toBe(DEFAULT_UI_FONT_SIZE)
    window.localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, "12")
    expect(readStoredUiFontSize()).toBe(12)
    window.localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, "99")
    expect(readStoredUiFontSize()).toBe(DEFAULT_UI_FONT_SIZE)

    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })
    expect(readStoredUiFontSize()).toBe(DEFAULT_UI_FONT_SIZE)
  })

  it("initializes and applies the saved value to the document root", () => {
    window.localStorage.setItem(UI_FONT_SIZE_STORAGE_KEY, "18")

    expect(initializeUiFontSize()).toBe(18)
    expect(
      document.documentElement.style.getPropertyValue("--app-ui-font-size")
    ).toBe("18px")
    expect(document.documentElement.dataset.uiFontSize).toBe("18")

    applyUiFontSize(8)
    expect(
      document.documentElement.style.getPropertyValue("--app-ui-font-size")
    ).toBe("12px")
    expect(document.documentElement.dataset.uiFontSize).toBe("12")
  })

  it("persists a clamped value and tolerates unavailable storage", () => {
    persistUiFontSize(20)
    expect(window.localStorage.getItem(UI_FONT_SIZE_STORAGE_KEY)).toBe("18")

    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })
    expect(() => persistUiFontSize(14)).not.toThrow()
  })
})
