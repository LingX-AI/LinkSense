import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { observeConversationBottomStackHeight } from "@/features/conversations/use-conversation-bottom-stack-height"

class ResizeObserverStub implements ResizeObserver {
  static instances: ResizeObserverStub[] = []

  readonly callback: ResizeObserverCallback
  readonly observe = vi.fn()
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverStub.instances.push(this)
  }
}

describe("conversation bottom stack height", () => {
  const originalResizeObserver = globalThis.ResizeObserver

  beforeEach(() => {
    ResizeObserverStub.instances = []
    globalThis.ResizeObserver = ResizeObserverStub
  })

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver
  })

  it("keeps the workspace reserved height synchronized with the full bottom stack", () => {
    const workspace = document.createElement("div")
    const bottomStack = document.createElement("div")
    workspace.append(bottomStack)
    let measuredHeight = 183.2
    vi.spyOn(bottomStack, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          height: measuredHeight,
        }) as DOMRect
    )

    const stopObserving = observeConversationBottomStackHeight(bottomStack)

    expect(
      workspace.style.getPropertyValue("--conversation-bottom-stack-height")
    ).toBe("184px")
    expect(ResizeObserverStub.instances[0]?.observe).toHaveBeenCalledWith(
      bottomStack
    )

    measuredHeight = 241.1
    ResizeObserverStub.instances[0]?.callback(
      [],
      ResizeObserverStub.instances[0]
    )

    expect(
      workspace.style.getPropertyValue("--conversation-bottom-stack-height")
    ).toBe("242px")

    stopObserving()
    expect(ResizeObserverStub.instances[0]?.disconnect).toHaveBeenCalledOnce()
    expect(
      workspace.style.getPropertyValue("--conversation-bottom-stack-height")
    ).toBe("")
  })
})
