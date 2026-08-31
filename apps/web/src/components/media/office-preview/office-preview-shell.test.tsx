import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import i18n from "@/i18n"

describe("OfficePreviewShell", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("shows one shared floating update action above a ready document", async () => {
    const onUpdate = vi.fn()
    const onDismiss = vi.fn()
    render(
      <OfficePreviewShell
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName="proposal.docx"
        mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        updateAction={{
          statusLabel: "文件已有新版本",
          actionLabel: "更新",
          onUpdate,
          dismissLabel: "关闭更新提示",
          onDismiss,
        }}
        onClose={vi.fn()}
      >
        <div>document</div>
      </OfficePreviewShell>
    )

    expect(screen.getByText("文件已有新版本")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "更新" }))
    expect(onUpdate).toHaveBeenCalledOnce()
    await userEvent.click(
      screen.getByRole("button", { name: "关闭更新提示" })
    )
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it("does not show an update action while the document is loading", () => {
    render(
      <OfficePreviewShell
        document={{ status: "loading" }}
        fileName="proposal.docx"
        mimeType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        updateAction={{
          statusLabel: "文件已有新版本",
          actionLabel: "更新",
          onUpdate: vi.fn(),
        }}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByRole("button", { name: "更新" })).toBeNull()
  })
})
