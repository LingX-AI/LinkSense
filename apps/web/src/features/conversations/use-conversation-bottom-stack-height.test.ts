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

  it("anchors the message fade to the composer top as the editor and surrounding controls resize", () => {
    const workspace = document.createElement("div")
    const bottomStack = document.createElement("div")
    const composer = document.createElement("form")
    composer.className = "composer-shell"
    bottomStack.append(composer)
    workspace.append(bottomStack)
    let composerTop = 700
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ height: 900 })
    )
    vi.spyOn(bottomStack, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ y: 640, height: 242 })
    )
    vi.spyOn(composer, "getBoundingClientRect").mockImplementation(() =>
      DOMRect.fromRect({ y: composerTop, height: 146 })
    )

    const stopObserving = observeConversationBottomStackHeight(bottomStack)
    const composerOffset = () =>
      workspace.style.getPropertyValue("--conversation-composer-top-offset")

    expect(composerOffset()).toBe("200px")

    composerTop = 552
    ResizeObserverStub.instances[0]?.callback(
      [],
      ResizeObserverStub.instances[0]
    )
    expect(composerOffset()).toBe("348px")

    composer.remove()
    ResizeObserverStub.instances[0]?.callback(
      [],
      ResizeObserverStub.instances[0]
    )
    expect(composerOffset()).toBe("")

    bottomStack.append(composer)
    ResizeObserverStub.instances[0]?.callback(
      [],
      ResizeObserverStub.instances[0]
    )
    expect(composerOffset()).toBe("348px")

    stopObserving()
    expect(composerOffset()).toBe("")
  })
})
