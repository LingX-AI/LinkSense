import { describe, expect, it, vi } from "vitest"
import {
  installHtmlResourceDiagnostics,
  resourceErrorMessageType,
} from "./html-preview-resource-errors"

describe("HTML resource diagnostics", () => {
  it("reports a failed resource once without its private session or query credentials", () => {
    const frame = document.createElement("iframe")
    document.body.append(frame)
    const target = frame.contentWindow!
    const post = vi.spyOn(target.parent, "postMessage")
    installHtmlResourceDiagnostics(target, resourceErrorMessageType)
    const link = target.document.createElement("link")
    link.href = `/html-preview/${"a".repeat(64)}/assets/missing.css?token=secret`
    target.document.head.append(link)
    link.dispatchEvent(new Event("error"))
    link.dispatchEvent(new Event("error"))
    expect(post).toHaveBeenCalledExactlyOnceWith(
      { type: resourceErrorMessageType, resource: "assets/missing.css" },
      "*"
    )
    post.mockRestore()
    frame.remove()
  })
})
