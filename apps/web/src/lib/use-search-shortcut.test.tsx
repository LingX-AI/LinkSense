import { cleanup, fireEvent, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useSearchShortcut } from "./use-search-shortcut"

afterEach(cleanup)

describe("search keyboard shortcut", () => {
  it.each(["ctrlKey", "metaKey"])(
    "opens once for %s+K and uses the latest callback",
    (modifier) => {
      const first = vi.fn()
      const next = vi.fn()
      const { rerender, unmount } = renderHook(
        ({ onSearch }) => useSearchShortcut(onSearch),
        { initialProps: { onSearch: first } }
      )
      expect(fireEvent.keyDown(window, { key: "k", [modifier]: true })).toBe(
        false
      )
      expect(first).toHaveBeenCalledOnce()
      rerender({ onSearch: next })
      fireEvent.keyDown(window, { key: "K", [modifier]: true })
      expect(next).toHaveBeenCalledOnce()
      unmount()
      fireEvent.keyDown(window, { key: "k", [modifier]: true })
      expect(next).toHaveBeenCalledOnce()
    }
  )

  it("leaves ordinary typing, browser shortcuts, repeated keys and consumed events alone", () => {
    const onSearch = vi.fn()
    renderHook(() => useSearchShortcut(onSearch))
    for (const options of [
      { key: "k" },
      { key: "l", ctrlKey: true },
      { key: "k", ctrlKey: true, shiftKey: true },
      { key: "k", metaKey: true, altKey: true },
      { key: "k", metaKey: true, repeat: true },
    ]) {
      expect(fireEvent.keyDown(window, options)).toBe(true)
    }
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      cancelable: true,
    })
    event.preventDefault()
    window.dispatchEvent(event)
    expect(onSearch).not.toHaveBeenCalled()
  })
})
