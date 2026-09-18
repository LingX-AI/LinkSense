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
    tasks: {
      run: vi.fn(async () => ({ turn_id: "turn-1" })),
      interrupt: vi.fn(async () => undefined),
      onStateChange: vi.fn<
        (
          handler: (state: {
            status: string
            turn_id: string | null
            file_ids: string[]
            can_submit: boolean
            interrupt_requested: boolean
          }) => void,
          onError?: () => void
        ) => () => void
      >(() => () => undefined),
      getState: vi.fn(async () => {
        const state = {
          status: "idle",
          turn_id: null,
          file_ids: [],
          can_submit: true,
          interrupt_requested: false,
        }
        sdk.tasks.onStateChange.mock.calls.at(-1)?.[0](state)
        return state
      }),
    },
    chat: { show: vi.fn(async () => undefined) },
    events: {
      on: vi.fn<
        (
          name: string,
          handler: (event: {
            id: string
            turn_id: string
            payload: Record<string, string>
          }) => void
        ) => () => void
      >(() => () => undefined),
    },
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

describe("interactive example task restoration", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "restores busy controls and preserves stop requests in %s",
    async (language) => {
      const { sdk, submit, picker } = await setup(language, [file])
      const update = sdk.tasks.onStateChange.mock.calls.at(-1)?.[0]
      const state = {
        status: "starting",
        turn_id: "turn-1",
        file_ids: [file.id],
        can_submit: false,
        interrupt_requested: false,
      }
      update?.(state)
      expect(submit).toBeDisabled()
      expect(picker).toBeDisabled()
      expect(document.querySelector("#run-status-title")?.textContent).toBe(
        language === "en-US" ? "Accepted, starting" : "已受理，正在启动"
      )
      expect(
        document.querySelector("#research-file-list button")
      ).toBeDisabled()
      fireEvent.submit(document.querySelector("#brief-form")!)
      expect(sdk.tasks.run).not.toHaveBeenCalled()
      update?.({ ...state, status: "running", interrupt_requested: true })
      expect(document.querySelector("#interrupt-task")).toBeDisabled()
      update?.({ ...state, status: "completed", can_submit: true })
      expect(submit).not.toBeDisabled()
      sdk.tasks.onStateChange.mock.calls.at(-1)?.[1]?.()
      expect(submit).toBeDisabled()
      update?.({ ...state, status: "interrupted", can_submit: true })
      expect(submit).not.toBeDisabled()
    }
  )
})

it("keeps replayed results after completion, deduplicates them and groups separate turns", async () => {
  const { sdk } = await setup()
  sdk.tasks.onStateChange.mock.calls.at(-1)?.[0]({
    status: "completed",
    turn_id: "turn-2",
    file_ids: [],
    can_submit: true,
    interrupt_requested: false,
  })
  const receive = sdk.events.on.mock.calls.find(
    ([name]) => name === "brief.insight_ready"
  )?.[1]
  const event = {
    id: "event-1",
    turn_id: "turn-1",
    payload: { title: "First", finding: "Finding", evidence: "Evidence" },
  }
  receive?.(event)
  receive?.(event)
  receive?.({ ...event, id: "event-2", turn_id: "turn-2" })
  expect(document.querySelectorAll("#event-feed [data-turn-id]")).toHaveLength(
    2
  )
  expect(document.querySelectorAll("#event-feed .event-card")).toHaveLength(2)
  expect(document.querySelector("#event-count")?.textContent).toBe("2")
})
