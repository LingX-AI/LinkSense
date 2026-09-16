import { fireEvent, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import source from "../../../../../examples/interactive-research-brief/app.js?raw"
import markup from "../../../../../examples/interactive-research-brief/index.html?raw"
const file = {
  id: "30000000-0000-4000-8000-000000000001",
  filename: "notes.txt",
  status: "staged",
}

async function setup(language = "zh-CN", items: (typeof file)[] = []) {
  document.body.innerHTML = markup
  const sdk = {
    ready: vi.fn(async () => undefined),
    context: {
      getCurrentUser: vi.fn(async () => ({ name: "User", language })),
    },
    resources: {
      listCapabilities: vi.fn(async () => ({ items: [] })),
      listKnowledgeBases: vi.fn(async () => ({ items: [] })),
      listMcpServers: vi.fn(async () => ({ items: [] })),
    },
    files: {
      list: vi.fn(async () => ({ items })),
      upload: vi.fn(async () => file),
      remove: vi.fn(async () => ({ removed: true })),
    },
    tasks: { run: vi.fn(async () => ({ turn_id: "turn-1" })) },
    chat: { show: vi.fn(async () => undefined) },
    events: { on: vi.fn(() => () => undefined) },
  }
  new Function("window", "document", source)(
    { LinkSense: sdk, addEventListener: vi.fn(), clearTimeout, setTimeout },
    document
  )
  const picker = document.querySelector<HTMLInputElement>("#research-files")!
  await waitFor(() => expect(picker).not.toBeDisabled())
  return {
    sdk,
    picker,
    submit: document.querySelector<HTMLButtonElement>("#run-task")!,
  }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("interactive research file example", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "restores staged files and localizes file actions in %s with fallback",
    async (language) => {
      const { sdk, submit } = await setup(language, [
        file,
        { ...file, id: "bound-file", status: "bound" },
      ])
      const list = document.querySelector("#research-file-list")!
      expect(list.children).toHaveLength(1)
      expect(list.textContent).toContain(
        language === "en-US" ? "Remove" : "移除"
      )
      fireEvent.change(document.querySelector("#topic")!, {
        target: { value: "Research" },
      })
      fireEvent.click(submit)
      await waitFor(() =>
        expect(sdk.tasks.run).toHaveBeenCalledWith(
          expect.objectContaining({ file_ids: [file.id] })
        )
      )
      await waitFor(() => expect(list.children).toHaveLength(0))
    }
  )

  it("blocks submission during upload and after failure, then supports retry and removal", async () => {
    const { sdk, picker, submit } = await setup()
    let fail: (reason: Error) => void = () => undefined
    sdk.files.upload.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject
        })
    )
    fireEvent.change(picker, {
      target: { files: [new File(["notes"], "notes.txt")] },
    })
    expect(submit).toBeDisabled()
    fail(new Error("failed"))
    await waitFor(() =>
      expect(
        document.querySelector("#research-file-list")?.textContent
      ).toContain("上传失败")
    )
    expect(submit).toBeDisabled()
    const retry = Array.from(
      document.querySelectorAll<HTMLButtonElement>("#research-file-list button")
    ).find((button) => button.textContent === "重试")!
    fireEvent.click(retry)
    await waitFor(() => expect(submit).not.toBeDisabled())
    fireEvent.click(document.querySelector("#research-file-list button")!)
    await waitFor(() => expect(sdk.files.remove).toHaveBeenCalledWith(file.id))
    await waitFor(() =>
      expect(
        document.querySelector("#research-file-list")?.children
      ).toHaveLength(0)
    )
  })
})
