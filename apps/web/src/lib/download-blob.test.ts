import { afterEach, describe, expect, it, vi } from "vitest"

import { downloadBlob } from "@/lib/download-blob"

const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "createObjectURL"
)
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(
  URL,
  "revokeObjectURL"
)

function restoreUrlMethod(
  name: "createObjectURL" | "revokeObjectURL",
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor) Object.defineProperty(URL, name, descriptor)
  else Reflect.deleteProperty(URL, name)
}

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    restoreUrlMethod("createObjectURL", originalCreateObjectUrl)
    restoreUrlMethod("revokeObjectURL", originalRevokeObjectUrl)
  })

  it("triggers a native download without navigating or opening another tab", () => {
    vi.useFakeTimers()
    const createObjectURL = vi.fn(() => "blob:office-preview")
    const revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined)
    const open = vi.fn()
    vi.stubGlobal("open", open)
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    })

    downloadBlob(new Blob(["office document"]), "AI 简介.docx")

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.href).toBe("blob:office-preview")
    expect(anchor.download).toBe("AI 简介.docx")
    expect(anchor.target).toBe("")
    expect(anchor.isConnected).toBe(false)
    expect(open).not.toHaveBeenCalled()

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:office-preview")
  })
})
