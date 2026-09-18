import { createRef, useState } from "react"
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MAX_VOICE_AUDIO_BYTES } from "@linksense/shared"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ConversationComposer,
  type ConversationComposerHandle,
} from "@/features/conversations/conversation-composer"
import type { CapabilitySummary } from "@/api/contracts"
import {
  MAX_VOICE_RECORDING_DURATION_MS,
  VOICE_TRANSCRIPTION_TIMEOUT_MS,
} from "@/features/conversations/use-voice-transcription"
import i18n from "@/i18n"

const editorRender = vi.hoisted(() => vi.fn())
vi.mock("@/components/ui/textarea", async (importOriginal) => {
  const { Textarea } =
    await importOriginal<typeof import("@/components/ui/textarea")>()
  return {
    Textarea: (props: React.ComponentProps<typeof Textarea>) => {
      editorRender()
      return <Textarea {...props} />
    },
  }
})

class MediaRecorderMock {
  static instances: MediaRecorderMock[] = []
  static nextBlob = new Blob(["recorded voice"], { type: "audio/webm" })
  static isTypeSupported = vi.fn((mimeType: string) =>
    mimeType.startsWith("audio/webm")
  )

  readonly stream: MediaStream
  readonly mimeType: string
  state: RecordingState = "inactive"
  ondataavailable: ((event: BlobEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onstop: ((event: Event) => void) | null = null

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream
    this.mimeType = options?.mimeType ?? "audio/webm"
    MediaRecorderMock.instances.push(this)
  }

  start = vi.fn(() => {
    this.state = "recording"
  })

  stop = vi.fn(() => {
    if (this.state === "inactive") return
    this.state = "inactive"
    this.ondataavailable?.(
      Object.assign(new Event("dataavailable"), {
        data: MediaRecorderMock.nextBlob,
      }) as BlobEvent
    )
    this.onstop?.(new Event("stop"))
  })
}

function voiceStreamResponse(
  events: readonly Record<string, unknown>[] = [
    { type: "delta", text: "整理会议" },
    { type: "done", text: "整理会议纪要" },
  ]
) {
  return new Response(
    `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
    {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    }
  )
}

function installMediaRecorder(options?: {
  getUserMedia?: () => Promise<MediaStream>
}) {
  const track = { stop: vi.fn(), kind: "audio" }
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream
  const getUserMedia = vi.fn(
    options?.getUserMedia ?? (() => Promise.resolve(stream))
  )
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
  vi.stubGlobal("MediaRecorder", MediaRecorderMock)
  return { getUserMedia, stream, track }
}

function installAudioAnalysis(
  frames: readonly {
    amplitude: number
    frequencyMagnitude: number
  }[]
) {
  let frameIndex = -1
  const analyser = {
    fftSize: 1024,
    frequencyBinCount: 512,
    smoothingTimeConstant: 0,
    getByteTimeDomainData: vi.fn((samples: Uint8Array) => {
      frameIndex = Math.min(frameIndex + 1, Math.max(0, frames.length - 1))
      const amplitude = frames[frameIndex]?.amplitude ?? 0
      samples.forEach((_, index) => {
        samples[index] = 128 + (index % 2 === 0 ? amplitude : -amplitude)
      })
    }),
    getByteFrequencyData: vi.fn((samples: Uint8Array) => {
      samples.fill(frames[frameIndex]?.frequencyMagnitude ?? 0)
    }),
    disconnect: vi.fn(),
  } as unknown as AnalyserNode
  const source = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as MediaStreamAudioSourceNode
  const close = vi.fn().mockResolvedValue(undefined)
  const resume = vi.fn().mockResolvedValue(undefined)

  class AudioContextMock {
    readonly state = "running"
    readonly sampleRate = 48_000

    createAnalyser() {
      return analyser
    }

    createMediaStreamSource() {
      return source
    }

    close() {
      return close()
    }

    resume() {
      return resume()
    }
  }

  vi.stubGlobal("AudioContext", AudioContextMock)
  return { analyser, close, source }
}

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof ConversationComposer>> = {}
) {
  const props: React.ComponentProps<typeof ConversationComposer> = {
    value: "Existing text",
    onValueChange: vi.fn(),
    capabilities: [],
    selectedIds: [],
    onSelectedIdsChange: vi.fn(),
    attachments: [],
    isRunning: false,
    interrupting: false,
    submitting: false,
    uploading: false,
    onSubmit: vi.fn(),
    onStartNewTask: vi.fn(),
    onStartApplication: vi.fn(),
    onInterrupt: vi.fn(),
    onAttach: vi.fn(),
    loadAttachmentPreview: vi.fn(
      async () => new Blob(["image"], { type: "image/png" })
    ),
    onRemoveAttachment: vi.fn(),
    onClearAttachments: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<ConversationComposer {...props} />) }
}

function renderStatefulComposer(
  overrides: Partial<React.ComponentProps<typeof ConversationComposer>> = {}
) {
  const onSelectedIdsChange = vi.fn()
  const onSelectedKnowledgeBaseIdsChange = vi.fn()
  const props: React.ComponentProps<typeof ConversationComposer> = {
    value: "",
    onValueChange: vi.fn(),
    capabilities: [],
    selectedIds: [],
    onSelectedIdsChange,
    attachments: [],
    isRunning: false,
    interrupting: false,
    submitting: false,
    uploading: false,
    onSubmit: vi.fn(),
    onStartNewTask: vi.fn(),
    onStartApplication: vi.fn(),
    onInterrupt: vi.fn(),
    onAttach: vi.fn(),
    loadAttachmentPreview: vi.fn(
      async () => new Blob(["image"], { type: "image/png" })
    ),
    onRemoveAttachment: vi.fn(),
    onClearAttachments: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }

  function Harness() {
    const [value, setValue] = useState(props.value)
    const [selectedIds, setSelectedIds] = useState(props.selectedIds)
    const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState(
      props.selectedKnowledgeBaseIds ?? []
    )
    return (
      <ConversationComposer
        {...props}
        value={value}
        selectedIds={selectedIds}
        selectedKnowledgeBaseIds={selectedKnowledgeBaseIds}
        onValueChange={(nextValue) => {
          props.onValueChange(nextValue)
          setValue(nextValue)
        }}
        onSelectedIdsChange={(nextIds) => {
          onSelectedIdsChange(nextIds)
          setSelectedIds(nextIds)
        }}
        onSelectedKnowledgeBaseIdsChange={(nextIds) => {
          onSelectedKnowledgeBaseIdsChange(nextIds)
          setSelectedKnowledgeBaseIds(nextIds)
        }}
      />
    )
  }

  return {
    props,
    onSelectedIdsChange,
    onSelectedKnowledgeBaseIdsChange,
    ...render(<Harness />),
  }
}

function capabilityFixture(
  overrides: Partial<CapabilitySummary> = {}
): CapabilitySummary {
  return {
    id: "skill-1",
    name: "Skill",
    slug: "skill",
    type: "skill",
    description: null,
    status: "active",
    source_type: "local",
    builtin_key: null,
    is_builtin: false,
    marketplace_listing_id: null,
    marketplace_release_id: null,
    logo_url: null,
    is_owner: true,
    can_manage: true,
    can_govern: true,
    can_select: true,
    can_delete: true,
    has_logo: false,
    preference_status: "enabled",
    manifest: {},
    risk_summary: {
      contains_mcp_server: false,
      contains_scripts: false,
      contains_external_connections: false,
      requires_environment_variables: false,
      requires_credentials: false,
      contains_dependency_download_commands: false,
      declared_environment_keys: [],
      mcp_environment_references: [],
      dependency_commands: [],
    },
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
    personally_disabled: false,
    ...overrides,
  }
}

function createTextPasteEvent(input: HTMLElement, text: string) {
  const pasteEvent = createEvent.paste(input)
  Object.defineProperty(pasteEvent, "clipboardData", {
    configurable: true,
    value: {
      files: [],
      items: [
        {
          kind: "string",
          type: "text/plain",
          getAsFile: () => null,
        },
      ],
      getData: (format: string) => (format === "text/plain" ? text : ""),
    },
  })
  return pasteEvent
}

function createFileTransfer(files: File[]) {
  return {
    files,
    items: files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    })),
    types: ["Files"],
    dropEffect: "none",
  }
}

function createTextTransfer(text = "拖拽文本") {
  return {
    files: [],
    items: [
      {
        kind: "string",
        type: "text/plain",
        getAsFile: () => null,
      },
    ],
    types: ["text/plain"],
    getData: (format: string) => (format === "text/plain" ? text : ""),
    dropEffect: "none",
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe("conversation voice input", () => {
  beforeEach(async () => {
    MediaRecorderMock.instances = []
    MediaRecorderMock.nextBlob = new Blob(["recorded voice"], {
      type: "audio/webm",
    })
    MediaRecorderMock.isTypeSupported.mockClear()
    await i18n.changeLanguage("zh-CN")
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    })
    vi.stubGlobal("MediaRecorder", undefined)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    })
  })

  it("keeps the conversation input transparent while focused", () => {
    renderComposer()

    expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveClass(
      "bg-transparent",
      "focus-visible:bg-transparent"
    )
  })

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "shows the unavailable notice once and restores the placeholder after recovery in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const unavailableMessage = i18n.t("errors.application.notFound")
      const { props, rerender } = renderComposer({
        interactionBlocked: true,
        unavailableMessage,
      })
      const input = screen.getByRole("textbox", {
        name: i18n.t("conversation.messageInput"),
      })

      expect(screen.getAllByText(unavailableMessage)).toHaveLength(1)
      expect(screen.getByRole("status")).toHaveTextContent(unavailableMessage)
      expect(input).not.toHaveAttribute("placeholder")
      expect(input).toBeDisabled()
      expect(
        screen.getByRole("button", { name: i18n.t("conversation.send") })
      ).toBeDisabled()

      rerender(
        <ConversationComposer
          {...props}
          interactionBlocked={false}
          unavailableMessage={undefined}
        />
      )

      expect(screen.queryByText(unavailableMessage)).not.toBeInTheDocument()
      expect(input).toBeEnabled()
      expect(input).toHaveAttribute(
        "placeholder",
        i18n.t("conversation.placeholder", { productName: "LinkSense" })
      )
    }
  )

  it("highlights a pasted URL without absorbing following Chinese prose", async () => {
    const interaction = userEvent.setup()
    const { props } = renderStatefulComposer()
    const input = screen.getByRole("textbox", {
      name: "任务输入框",
    }) as HTMLTextAreaElement
    const value = "https://www.infocare.org.cn/后续说明"

    await interaction.click(input)
    await interaction.paste(value)

    expect(input).toHaveValue(value)
    expect(props.onValueChange).toHaveBeenLastCalledWith(value)

    const highlights = screen.getByTestId("composer-url-highlights")
    const url = highlights.querySelector("[data-url-highlight]")
    expect(url).toHaveAttribute(
      "data-url-highlight",
      "https://www.infocare.org.cn/"
    )
    expect(url).toHaveTextContent("https://www.infocare.org.cn/")
    expect(highlights).toHaveTextContent(value)
    expect(
      highlights.querySelector(".composer-url-highlight-icon")
    ).toBeInTheDocument()
    expect(input).toHaveClass(
      "composer-input-has-url",
      "composer-input-has-leading-url"
    )

    Object.defineProperty(input, "scrollTop", {
      configurable: true,
      value: 36,
      writable: true,
    })
    fireEvent.scroll(input)
    expect(highlights.scrollTop).toBe(36)
  })

  it("opens the screenshot-style action menu after a slash", async () => {
    const interaction = userEvent.setup()
    renderStatefulComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "/")

    expect(input).toHaveAttribute(
      "aria-controls",
      "conversation-slash-command-menu"
    )
    expect(input).not.toHaveAttribute("aria-expanded")
    expect(input).not.toHaveAttribute("aria-haspopup")
    expect(screen.getByLabelText("功能菜单")).toBeVisible()
    expect(screen.getByRole("option", { name: /新建任务/ })).toBeVisible()
    expect(screen.getByRole("option", { name: /插件列表/ })).toBeVisible()
    expect(screen.getByRole("option", { name: /Skill 列表/ })).toBeVisible()
    expect(screen.getByRole("option", { name: /应用列表/ })).toBeVisible()
    expect(screen.getByRole("option", { name: /知识库列表/ })).toBeVisible()
    expect(screen.getByRole("option", { name: /MCP 状态/ })).toBeVisible()
  })

  it("opens the Add menu when @ is entered after a text boundary", async () => {
    const interaction = userEvent.setup()
    const onRetryCapabilities = vi.fn()
    const { props } = renderStatefulComposer({ onRetryCapabilities })
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "请添加 @")

    expect(input).toHaveValue("请添加 ")
    expect(props.onValueChange).toHaveBeenLastCalledWith("请添加 ")
    expect(screen.getByRole("option", { name: "文件" })).toBeVisible()
    expect(screen.getByRole("option", { name: "文件夹" })).toBeVisible()
    expect(onRetryCapabilities).toHaveBeenCalledTimes(1)
  })

  it("uses compact hover corners across Add actions, plugins, and Skills", async () => {
    const interaction = userEvent.setup()
    renderStatefulComposer({
      capabilities: [
        capabilityFixture({ id: "plugin-1", name: "Office", type: "plugin" }),
        capabilityFixture({ name: "Code Review" }),
      ],
    })

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(6)
    for (const option of options) {
      expect(option.closest('[data-slot="command-list"]')).toHaveClass(
        "[&_[data-slot=command-item]]:rounded-md"
      )
      await interaction.hover(option)
      expect(option).toHaveAttribute("data-selected", "true")
    }
  })

  it("keeps @ as ordinary text when it is entered inside a word", async () => {
    const interaction = userEvent.setup()
    renderStatefulComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "user@example.com")

    expect(input).toHaveValue("user@example.com")
    expect(screen.queryByRole("option", { name: "文件" })).toBeNull()
  })

  it("enables native Goal mode from the add menu and exposes the mode chip", async () => {
    const interaction = userEvent.setup()
    const onGoalModeChange = vi.fn()
    const { unmount } = renderStatefulComposer({ onGoalModeChange })

    expect(
      screen.queryByRole("button", { name: "退出目标模式" })
    ).not.toBeInTheDocument()
    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /目标/ }))

    expect(onGoalModeChange).toHaveBeenCalledWith(true)
    unmount()

    renderStatefulComposer({
      goalMode: true,
      onGoalModeChange,
    })
    const goalChip = screen.getByRole("button", { name: "退出目标模式" })
    expect(goalChip).toBeVisible()
    expect(goalChip).toHaveTextContent("目标")
    expect(
      screen.queryByRole("button", { name: "添加附件" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "添加" })).toBeEnabled()
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveAttribute(
      "placeholder",
      "描述你的目标，定义可衡量的成果，以获得最佳结果。"
    )

    await interaction.click(
      screen.getByRole("button", { name: "退出目标模式" })
    )
    expect(onGoalModeChange).toHaveBeenLastCalledWith(false)
  })

  it("enables native Plan mode from Add and exposes its removable mode chip", async () => {
    const interaction = userEvent.setup()
    const onPlanModeChange = vi.fn()
    const { unmount } = renderStatefulComposer({ onPlanModeChange })

    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /计划模式/ }))

    expect(onPlanModeChange).toHaveBeenCalledWith(true)
    unmount()

    renderStatefulComposer({ planMode: true, onPlanModeChange })
    const planChip = screen.getByRole("button", { name: "退出计划模式" })
    expect(planChip).toBeVisible()
    expect(planChip).toHaveTextContent("计划")
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveAttribute(
      "placeholder",
      "描述需要分析和规划的任务，LinkSense 会先提出问题并形成计划。"
    )

    await interaction.click(planChip)
    expect(onPlanModeChange).toHaveBeenLastCalledWith(false)
  })

  it("can remove Plan mode from the add menu for restricted surfaces", async () => {
    const interaction = userEvent.setup()
    renderStatefulComposer({ planModeAvailable: false })

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    expect(
      screen.queryByRole("option", { name: /计划模式/ })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: "文件" })).toBeVisible()
    expect(screen.getByRole("option", { name: "文件夹" })).toBeVisible()
  })

  it("renders the native Goal option description inline with Skill-style typography", async () => {
    const interaction = userEvent.setup()
    renderStatefulComposer()

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    const goalOption = screen.getByRole("option", { name: /目标/ })
    const description =
      within(goalOption).getByText("持续执行，直到完成或需要你处理")
    const labels = description.closest("[data-goal-labels]")

    expect(labels).not.toBeNull()
    expect(labels).toHaveClass("flex", "items-center", "gap-2")
    expect(within(labels as HTMLElement).getByText("目标")).toBeVisible()
    expect(description).toHaveClass("text-[length:var(--app-font-12)]")
  })

  it("keeps native Goal mode selectable while a turn is running", async () => {
    const interaction = userEvent.setup()
    const onGoalModeChange = vi.fn()
    renderStatefulComposer({ isRunning: true, onGoalModeChange })

    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /目标/ }))

    expect(onGoalModeChange).toHaveBeenCalledWith(true)
  })

  it("opens native file and folder pickers from separate Add options and keeps Goal in that group", async () => {
    const interaction = userEvent.setup()
    const clickedInputs: string[] = []
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(function (this: HTMLInputElement) {
        clickedInputs.push(this.getAttribute("aria-label") ?? "")
      })
    renderStatefulComposer()

    expect(
      screen.queryByRole("button", { name: "添加附件" })
    ).not.toBeInTheDocument()
    await interaction.click(screen.getByRole("button", { name: "添加" }))

    const fileOption = screen.getByRole("option", { name: "文件" })
    const folderOption = screen.getByRole("option", { name: "文件夹" })
    const goalOption = screen.getByRole("option", { name: /目标/ })
    expect(fileOption).toBeVisible()
    expect(folderOption).toBeVisible()
    expect(
      screen.queryByRole("option", { name: "文件和文件夹" })
    ).not.toBeInTheDocument()
    expect(goalOption.closest('[data-slot="command-group"]')).toBe(
      fileOption.closest('[data-slot="command-group"]')
    )
    expect(goalOption.closest('[data-slot="command-group"]')).toBe(
      folderOption.closest('[data-slot="command-group"]')
    )

    await interaction.click(fileOption)

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(clickedInputs).toEqual(["添加附件"])

    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: "文件夹" }))

    expect(clickSpy).toHaveBeenCalledTimes(2)
    expect(clickedInputs).toEqual(["添加附件", "添加文件夹"])
  })

  it("queues files and directory files from separate native inputs", async () => {
    const interaction = userEvent.setup()
    const { props } = renderStatefulComposer()
    const fileInput = screen.getByLabelText("添加附件")
    const directoryInput = screen.getByLabelText("添加文件夹")
    const singleFile = new File(["plain"], "brief.pdf", {
      type: "application/pdf",
    })
    const readme = new File(["docs"], "README.md", { type: "text/markdown" })
    const guide = new File(["guide"], "guide.pdf", {
      type: "application/pdf",
    })
    Object.defineProperty(readme, "webkitRelativePath", {
      configurable: true,
      value: "project/README.md",
    })
    Object.defineProperty(guide, "webkitRelativePath", {
      configurable: true,
      value: "project/docs/guide.pdf",
    })

    expect(fileInput).not.toHaveAttribute("webkitdirectory")
    expect(directoryInput).toHaveAttribute("webkitdirectory")

    await interaction.upload(fileInput, singleFile)
    await interaction.upload(directoryInput, [readme, guide])

    expect(props.onAttach).toHaveBeenCalledTimes(2)
    expect(props.onAttach).toHaveBeenNthCalledWith(1, [singleFile])
    expect(props.onAttach).toHaveBeenNthCalledWith(2, [readme, guide])
  })

  it("uploads dropped files through the attachment flow", () => {
    const { props } = renderComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const document = new File(["pdf"], "drop-brief.pdf", {
      type: "application/pdf",
    })
    const transfer = createFileTransfer([document])
    const dragEnterEvent = createEvent.dragEnter(input)
    const dropEvent = createEvent.drop(input)

    Object.defineProperty(dragEnterEvent, "dataTransfer", {
      configurable: true,
      value: transfer,
    })
    Object.defineProperty(dropEvent, "dataTransfer", {
      configurable: true,
      value: transfer,
    })

    fireEvent(input, dragEnterEvent)

    expect(dragEnterEvent.defaultPrevented).toBe(true)
    expect(screen.getByTestId("composer-drop-target")).toHaveTextContent(
      "松开以上传文件"
    )

    fireEvent(input, dropEvent)

    expect(dropEvent.defaultPrevented).toBe(true)
    expect(props.onAttach).toHaveBeenCalledOnce()
    expect(props.onAttach).toHaveBeenCalledWith([document])
    expect(screen.queryByTestId("composer-drop-target")).not.toBeInTheDocument()
  })

  it("leaves ordinary text drops under the browser default behavior", () => {
    const { props } = renderComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const dragOverEvent = createEvent.dragOver(input)
    const dropEvent = createEvent.drop(input)

    Object.defineProperty(dragOverEvent, "dataTransfer", {
      configurable: true,
      value: createTextTransfer(),
    })
    Object.defineProperty(dropEvent, "dataTransfer", {
      configurable: true,
      value: createTextTransfer(),
    })

    fireEvent(input, dragOverEvent)
    fireEvent(input, dropEvent)

    expect(dragOverEvent.defaultPrevented).toBe(false)
    expect(dropEvent.defaultPrevented).toBe(false)
    expect(props.onAttach).not.toHaveBeenCalled()
  })

  it("prevents dropped files from navigating away while attachments are disabled", () => {
    const { props } = renderComposer({ uploading: true })
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const document = new File(["pdf"], "busy-drop.pdf", {
      type: "application/pdf",
    })
    const dragEnterEvent = createEvent.dragEnter(input)
    const dropEvent = createEvent.drop(input)

    Object.defineProperty(dragEnterEvent, "dataTransfer", {
      configurable: true,
      value: createFileTransfer([document]),
    })
    Object.defineProperty(dropEvent, "dataTransfer", {
      configurable: true,
      value: createFileTransfer([document]),
    })

    fireEvent(input, dragEnterEvent)
    fireEvent(input, dropEvent)

    expect(dragEnterEvent.defaultPrevented).toBe(true)
    expect(dropEvent.defaultPrevented).toBe(true)
    expect(screen.queryByTestId("composer-drop-target")).not.toBeInTheDocument()
    expect(props.onAttach).not.toHaveBeenCalled()
  })

  it("consumes the slash token before starting a new task", async () => {
    const interaction = userEvent.setup()
    const onStartNewTask = vi.fn()
    renderStatefulComposer({ onStartNewTask })
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "/new")
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })

    expect(onStartNewTask).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue("")
    expect(screen.queryByLabelText("功能菜单")).not.toBeInTheDocument()
  })

  it("dismisses the slash menu with Escape without submitting the draft", async () => {
    const interaction = userEvent.setup()
    const { props } = renderStatefulComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "/")
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" })

    expect(input).toHaveValue("/")
    expect(input).not.toHaveAttribute("aria-expanded")
    expect(input).not.toHaveAttribute("aria-controls")
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("opens the Skill picker with $, filters the available Skills, and selects from the keyboard", async () => {
    const interaction = userEvent.setup()
    const { onSelectedIdsChange, props } = renderStatefulComposer({
      capabilities: [
        capabilityFixture({
          id: "skill-review",
          name: "Code Review",
          slug: "code-review",
          description: "检查代码质量",
        }),
        capabilityFixture({
          id: "skill-writing",
          name: "Writing Assistant",
          slug: "writing-assistant",
          description: "优化文案",
        }),
        capabilityFixture({
          id: "plugin-code",
          name: "Code Plugin",
          slug: "code-plugin",
          type: "plugin",
        }),
        capabilityFixture({
          id: "skill-disabled",
          name: "Disabled Skill",
          personally_disabled: true,
        }),
        capabilityFixture({
          id: "skill-unselectable",
          name: "Unavailable Skill",
          can_select: false,
        }),
      ],
    })
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "$")

    expect(screen.getByLabelText("Skill 选择菜单")).toBeVisible()
    expect(screen.getByRole("option", { name: /Code Review/ })).toBeVisible()
    expect(
      screen.getByRole("option", { name: /Writing Assistant/ })
    ).toBeVisible()
    expect(screen.queryByRole("option", { name: /Code Plugin/ })).toBeNull()
    expect(screen.queryByRole("option", { name: /Disabled Skill/ })).toBeNull()
    expect(
      screen.queryByRole("option", { name: /Unavailable Skill/ })
    ).toBeNull()

    await interaction.type(input, "code")

    expect(screen.getByRole("option", { name: /Code Review/ })).toBeVisible()
    expect(
      screen.queryByRole("option", { name: /Writing Assistant/ })
    ).toBeNull()

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })

    expect(onSelectedIdsChange).toHaveBeenCalledWith(["skill-review"])
    expect(input).toHaveValue("")
    expect(screen.queryByLabelText("Skill 选择菜单")).not.toBeInTheDocument()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("dismisses the $ Skill picker with Escape without changing the draft", async () => {
    const interaction = userEvent.setup()
    const { props } = renderStatefulComposer({
      capabilities: [capabilityFixture({ name: "Code Review" })],
    })
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "$")
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" })

    expect(input).toHaveValue("$")
    expect(input).not.toHaveAttribute("aria-expanded")
    expect(input).not.toHaveAttribute("aria-controls")
    expect(screen.queryByLabelText("Skill 选择菜单")).not.toBeInTheDocument()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("expands the Skill list inline and selects a Skill entirely from the keyboard", async () => {
    const interaction = userEvent.setup()
    const { onSelectedIdsChange, props } = renderStatefulComposer({
      capabilities: [
        capabilityFixture({
          id: "skill-review",
          name: "Code Review",
          type: "skill",
          description: "检查代码质量",
        }),
      ],
    })
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "/skill")
    const skillCommand = screen.getByRole("option", { name: /Skill 列表/ })
    expect(skillCommand).toBeVisible()
    expect(screen.queryByRole("option", { name: /插件列表/ })).toBeNull()

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
    const skill = screen.getByRole("option", { name: /Code Review/ })
    const inlinePanel = document.getElementById(
      "conversation-slash-panel-skills"
    )
    if (!inlinePanel) throw new Error("Expected the inline Skill panel")
    expect(skillCommand).toHaveAttribute("aria-expanded", "true")
    expect(skillCommand).toHaveAttribute(
      "aria-controls",
      "conversation-slash-panel-skills"
    )
    expect(inlinePanel).toContainElement(skill)
    expect(skill.querySelector(".composer-slash-item-icon")).toBeNull()
    expect(
      skillCommand.compareDocumentPosition(inlinePanel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Skill" })).toBeNull()
    expect(input).toHaveValue("/skill")

    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" })
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
    expect(onSelectedIdsChange).toHaveBeenCalledWith(["skill-review"])
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(screen.queryByLabelText("功能菜单")).not.toBeInTheDocument()
  })

  it("selects a concrete plugin directly from a slash query", async () => {
    const interaction = userEvent.setup()
    const { onSelectedIdsChange, props } = renderStatefulComposer({
      capabilities: [
        capabilityFixture({
          id: "plugin-web",
          name: "网页抓取插件",
          slug: "web-fetch-plugin",
          type: "plugin",
          description: "抓取网页内容并整理摘要",
        }),
      ],
    })
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    await interaction.type(input, "/web")
    const plugin = screen.getByRole("option", { name: /网页抓取插件/ })
    expect(plugin).toBeVisible()
    expect(screen.queryByText("没有匹配的功能")).not.toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /插件列表/ })).toBeNull()

    await interaction.click(plugin)
    expect(onSelectedIdsChange).toHaveBeenCalledWith(["plugin-web"])
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(input).toHaveValue("")
    expect(screen.queryByLabelText("功能菜单")).not.toBeInTheDocument()
  })

  it("reports an unavailable browser and leaves keyboard input usable", async () => {
    const interaction = userEvent.setup()
    const { props } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))

    expect(props.onError).toHaveBeenCalledWith(
      "当前浏览器不支持录音，请使用支持麦克风录音的浏览器。"
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeEnabled()
    expect(props.onAttach).not.toHaveBeenCalled()
  })

  it("disables and grays the microphone with guidance when speech to text is not configured", async () => {
    const interaction = userEvent.setup()
    renderComposer({ voiceTranscriptionAvailability: "not_configured" })

    const voiceButton = screen.getByRole("button", { name: "语音输入" })
    expect(voiceButton).toBeDisabled()
    expect(voiceButton).toHaveClass("text-muted-foreground", "opacity-50")

    const trigger = voiceButton.parentElement
    expect(trigger).not.toBeNull()
    await interaction.hover(trigger!)
    expect(
      await screen.findByRole("tooltip", {
        name: "语音转文字服务尚未配置",
      })
    ).toBeVisible()
  })

  it("hides model, capability, and knowledge controls for an application-managed conversation", async () => {
    const interaction = userEvent.setup()
    renderComposer({
      managedApplicationName: "财务制度助手",
      capabilities: [capabilityFixture()],
      modelPreference: {
        configured: true,
        default_model: "gpt-5.6-terra",
        selected_model: "gpt-5.6-terra",
        selected_reasoning_effort: "medium",
        models: [
          {
            id: "gpt-5.6-terra",
            display_name: "GPT-5.6-Terra",
            enabled: true,
            context_window: null,
            supported_reasoning_efforts: ["medium", "high"],
            default_reasoning_effort: "medium",
          },
        ],
      },
      onModelPreferenceChange: vi.fn(),
    })

    const addMenu = screen.getByRole("button", { name: "添加" })
    expect(addMenu).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "添加知识库" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "选择模型与推理强度" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "添加附件" })
    ).not.toBeInTheDocument()

    await interaction.click(addMenu)

    expect(screen.getByRole("option", { name: "文件" })).toBeVisible()
    expect(screen.getByRole("option", { name: "文件夹" })).toBeVisible()
    expect(
      screen.queryByRole("option", { name: "文件和文件夹" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("option", { name: /目标/ })
    ).not.toBeInTheDocument()
    expect(screen.queryByText("插件")).not.toBeInTheDocument()
    expect(screen.queryByText("Skill")).not.toBeInTheDocument()
  })

  it("shows only the model control when an application delegates model selection", () => {
    renderComposer({
      managedApplicationName: "财务制度助手",
      allowManagedApplicationModelSelection: true,
      capabilities: [capabilityFixture()],
      modelPreference: {
        configured: true,
        default_model: "gpt-5.6-terra",
        selected_model: "gpt-5.6-terra",
        selected_reasoning_effort: "medium",
        models: [
          {
            id: "gpt-5.6-terra",
            display_name: "GPT-5.6-Terra",
            enabled: true,
            context_window: null,
            supported_reasoning_efforts: ["medium", "high"],
            default_reasoning_effort: "medium",
          },
        ],
      },
      onModelPreferenceChange: vi.fn(),
    })

    expect(
      screen.getByRole("button", { name: "选择模型与推理强度" })
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "添加" })).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "添加知识库" })
    ).not.toBeInTheDocument()
  })

  it("renders knowledge base descriptions inline like capability entries", async () => {
    const interaction = userEvent.setup()
    renderComposer({
      knowledgeBases: [
        {
          id: "knowledge-1",
          name: "多目录知识库",
          description: null,
          source_type: "local",
          source_sync: null,
          lifecycle_status: "active",
          availability_status: "enabled",
          owner: { id: "owner-1", name: "管理员" },
          is_owner: true,
          access_sources: [{ type: "owner" as const }],
          document_count: 1,
          ready_document_count: 1,
          storage_used_bytes: 100,
          storage_reserved_bytes: 0,
          storage_quota_bytes: 1_000,
          permissions: {
            view_content: true,
            update: true,
            manage_documents: true,
            manage_grants: true,
            create_grants: true,
            revoke_grants: true,
            archive: true,
            restore: false,
            delete: false,
            remove_direct_share: false,
          },
          archived_at: null,
          disabled_reason: null,
          created_at: "2026-07-22T00:00:00.000Z",
          updated_at: "2026-07-22T00:00:00.000Z",
        },
        {
          id: "knowledge-2",
          name: "AISG Policy",
          description: "AISG的政策文件",
          source_type: "local",
          source_sync: null,
          lifecycle_status: "active",
          availability_status: "enabled",
          owner: { id: "owner-1", name: "管理员" },
          is_owner: true,
          access_sources: [{ type: "owner" as const }],
          document_count: 1,
          ready_document_count: 1,
          storage_used_bytes: 100,
          storage_reserved_bytes: 0,
          storage_quota_bytes: 1_000,
          permissions: {
            view_content: true,
            update: true,
            manage_documents: true,
            manage_grants: true,
            create_grants: true,
            revoke_grants: true,
            archive: true,
            restore: false,
            delete: false,
            remove_direct_share: false,
          },
          archived_at: null,
          disabled_reason: null,
          created_at: "2026-07-22T00:00:00.000Z",
          updated_at: "2026-07-22T00:00:00.000Z",
        },
      ],
    })

    await interaction.click(screen.getByRole("button", { name: "添加知识库" }))

    const option = screen.getByRole("option", { name: /AISG Policy/ })
    const labels = option.querySelector("[data-knowledge-base-labels]")
    expect(labels).toHaveClass("flex", "items-center", "gap-2")
    expect(
      labels?.querySelector("[data-knowledge-base-name]")
    ).toHaveTextContent("AISG Policy")
    expect(labels?.querySelector("[data-knowledge-base-name]")).toHaveClass(
      "max-w-[48%]",
      "shrink-0",
      "truncate"
    )
    expect(
      labels?.querySelector("[data-knowledge-base-description]")
    ).toHaveTextContent("AISG的政策文件")
    expect(
      labels?.querySelector("[data-knowledge-base-description]")
    ).toHaveClass("text-[length:var(--app-font-12)]", "truncate")
  })

  it("selects multiple knowledge bases and keeps removable persistent chips", async () => {
    const interaction = userEvent.setup()
    const knowledgeBases = ["产品手册", "售后知识"].map((name, index) => ({
      id: `knowledge-${index + 1}`,
      name,
      description: `${name}说明`,
      source_type: "local" as const,
      source_sync: null,
      lifecycle_status: "active" as const,
      availability_status: "enabled" as const,
      owner: { id: "owner-1", name: "管理员" },
      is_owner: true,
      access_sources: [{ type: "owner" as const }],
      document_count: 1,
      ready_document_count: 1,
      storage_used_bytes: 100,
      storage_reserved_bytes: 0,
      storage_quota_bytes: 1_000,
      permissions: {
        view_content: true,
        update: true,
        manage_documents: true,
        manage_grants: true,
        create_grants: true,
        revoke_grants: true,
        archive: true,
        restore: false,
        delete: false,
        remove_direct_share: false,
      },
      archived_at: null,
      disabled_reason: null,
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    }))

    function KnowledgeComposerHarness() {
      const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<
        string[]
      >([])
      return (
        <ConversationComposer
          {...renderComposerDefaults}
          knowledgeBases={knowledgeBases}
          selectedKnowledgeBaseIds={selectedKnowledgeBaseIds}
          onSelectedKnowledgeBaseIdsChange={setSelectedKnowledgeBaseIds}
        />
      )
    }

    const renderComposerDefaults: React.ComponentProps<
      typeof ConversationComposer
    > = {
      value: "查询保修条件",
      onValueChange: vi.fn(),
      capabilities: [],
      selectedIds: [],
      onSelectedIdsChange: vi.fn(),
      attachments: [],
      isRunning: false,
      interrupting: false,
      submitting: false,
      uploading: false,
      onSubmit: vi.fn(),
      onStartNewTask: vi.fn(),
      onStartApplication: vi.fn(),
      onInterrupt: vi.fn(),
      onAttach: vi.fn(),
      loadAttachmentPreview: vi.fn(async () => new Blob()),
      onRemoveAttachment: vi.fn(),
      onClearAttachments: vi.fn(),
      onError: vi.fn(),
    }

    render(<KnowledgeComposerHarness />)
    expect(
      screen.queryByRole("button", { name: "移除知识库 产品手册" })
    ).not.toBeInTheDocument()

    await interaction.click(screen.getByRole("button", { name: "添加知识库" }))
    await interaction.click(screen.getByText("产品手册"))
    await interaction.click(screen.getByText("售后知识"))

    const selectedMenuItems = document.body.querySelectorAll(
      '[data-slot="command-item"][data-checked="true"]'
    )
    expect(selectedMenuItems).toHaveLength(2)
    selectedMenuItems.forEach((item) => {
      expect(item.querySelectorAll("svg.lucide-check")).toHaveLength(1)
    })

    expect(
      screen.getByRole("button", { name: "移除知识库 产品手册" })
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "移除知识库 售后知识" })
    ).toBeVisible()
    expect(
      screen
        .getByRole("button", { name: "移除知识库 产品手册" })
        .closest(".knowledge-base-chip")
        ?.querySelector(".knowledge-base-chip-icon")
    ).toHaveClass("capability-chip-icon", "knowledge-base-chip-icon")
    expect(
      screen
        .getByRole("button", { name: "移除知识库 产品手册" })
        .closest(".knowledge-base-chip")
    ).toHaveClass("composer-context-chip")

    await interaction.click(
      screen.getByRole("button", { name: "移除知识库 产品手册" })
    )
    expect(
      screen.queryByRole("button", { name: "移除知识库 产品手册" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "移除知识库 售后知识" })
    ).toBeVisible()
  })

  it("marks archived, disabled, and inaccessible selected knowledge bases as unavailable", () => {
    const baseKnowledgeBase = {
      id: "knowledge-active",
      name: "有效知识库",
      description: null,
      source_type: "local" as const,
      source_sync: null,
      lifecycle_status: "active" as const,
      availability_status: "enabled" as const,
      owner: { id: "owner-1", name: "管理员" },
      is_owner: true,
      access_sources: [{ type: "owner" as const }],
      document_count: 1,
      ready_document_count: 1,
      storage_used_bytes: 100,
      storage_reserved_bytes: 0,
      storage_quota_bytes: 1_000,
      permissions: {
        view_content: true,
        update: true,
        manage_documents: true,
        manage_grants: true,
        create_grants: true,
        revoke_grants: true,
        archive: true,
        restore: false,
        delete: false,
        remove_direct_share: false,
      },
      archived_at: null,
      disabled_reason: null,
      created_at: "2026-07-22T00:00:00.000Z",
      updated_at: "2026-07-22T00:00:00.000Z",
    }
    const archived = {
      ...baseKnowledgeBase,
      id: "knowledge-archived",
      name: "已归档库",
      lifecycle_status: "archived" as const,
      archived_at: "2026-07-22T01:00:00.000Z",
    }
    const disabled = {
      ...baseKnowledgeBase,
      id: "knowledge-disabled",
      name: "已停用库",
      availability_status: "disabled" as const,
      disabled_reason: "治理停用",
    }

    const { container } = renderComposer({
      knowledgeBases: [baseKnowledgeBase, archived, disabled],
      selectedKnowledgeBaseIds: [
        baseKnowledgeBase.id,
        archived.id,
        disabled.id,
        "knowledge-revoked",
      ],
      knowledgeBasesLoading: false,
    })

    expect(
      screen
        .getByRole("button", { name: "移除知识库 已归档库" })
        .closest(".knowledge-base-chip")
    ).toHaveTextContent("已归档库 · 知识库已不可用")
    expect(
      screen
        .getByRole("button", { name: "移除知识库 已停用库" })
        .closest(".knowledge-base-chip")
    ).toHaveTextContent("已停用库 · 知识库已不可用")
    expect(
      screen
        .getByRole("button", { name: "移除知识库 知识库已不可用" })
        .closest(".knowledge-base-chip")
    ).toHaveAttribute("data-unavailable", "true")
    expect(
      container.querySelectorAll('[data-unavailable="true"]')
    ).toHaveLength(3)
  })

  it("keeps a transiently unverifiable knowledge base selected and blocks submission", () => {
    renderComposer({
      selectedKnowledgeBaseIds: ["knowledge-transient"],
      knowledgeBaseSelectionStatusById: {
        "knowledge-transient": "verification_failed",
      },
      knowledgeBasesError: true,
    })

    expect(
      screen.getByRole("button", {
        name: "移除知识库 暂时无法确认知识库状态，请重试。",
      })
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
  })

  it("exposes a narrow focus handle for external media selection actions", () => {
    const ref = createRef<ConversationComposerHandle>()
    const props: React.ComponentProps<typeof ConversationComposer> = {
      value: "Existing text",
      onValueChange: vi.fn(),
      capabilities: [],
      selectedIds: [],
      onSelectedIdsChange: vi.fn(),
      attachments: [],
      isRunning: false,
      interrupting: false,
      submitting: false,
      uploading: false,
      onSubmit: vi.fn(),
      onStartNewTask: vi.fn(),
      onStartApplication: vi.fn(),
      onInterrupt: vi.fn(),
      onAttach: vi.fn(),
      loadAttachmentPreview: vi.fn(async () => new Blob()),
      onRemoveAttachment: vi.fn(),
      onClearAttachments: vi.fn(),
      onError: vi.fn(),
    }
    render(<ConversationComposer ref={ref} {...props} />)
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    input.blur()

    ref.current?.focus()

    expect(input).toHaveFocus()
  })

  it("keeps the text input visible without a microphone connection prompt while permission is pending", async () => {
    installMediaRecorder({
      getUserMedia: () => new Promise<MediaStream>(() => undefined),
    })
    const interaction = userEvent.setup()
    renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))

    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeVisible()
    expect(screen.queryByText("正在连接麦克风…")).not.toBeInTheDocument()
  })

  it("does not request microphone access when token quota is exhausted", async () => {
    const { getUserMedia } = installMediaRecorder()
    const interaction = userEvent.setup()
    renderComposer({ taskStartDisabled: true })

    const voiceButton = screen.getByRole("button", { name: "语音输入" })
    expect(voiceButton).toBeDisabled()

    await interaction.click(voiceButton)

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(
      screen.queryByTestId("voice-recording-panel")
    ).not.toBeInTheDocument()
  })

  it("places the recording controls immediately before Send in the primary action row", async () => {
    installMediaRecorder()
    const interaction = userEvent.setup()
    renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))

    const actions = await screen.findByTestId("composer-primary-actions")
    const recordingPanel = screen.getByTestId("voice-recording-panel")
    const send = screen.getByRole("button", { name: "发送" })
    expect(recordingPanel.parentElement).toBe(actions)
    expect(actions.firstElementChild).toBe(recordingPanel)
    expect(actions.lastElementChild).toBe(send)
    expect(actions).toHaveClass("min-w-0", "flex-1")
    expect(recordingPanel).toHaveClass("min-w-0", "flex-1")
    expect(screen.getByTestId("voice-waveform")).toHaveClass(
      "min-w-12",
      "flex-1"
    )
    expect(screen.getByRole("button", { name: "停止语音输入" })).toHaveClass(
      "size-8"
    )
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeVisible()
  })

  it("records through MediaRecorder, streams previews, and keeps the final text editable", async () => {
    const { track } = installMediaRecorder()
    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const fetchMock = vi.fn().mockResolvedValue(voiceStreamResponse())
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    const { props } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    expect(await screen.findByTestId("voice-recording-panel")).toBeVisible()
    const recorder = MediaRecorderMock.instances[0]!
    expect(recorder.start).toHaveBeenCalledWith(250)
    expect(fetchMock).not.toHaveBeenCalled()

    now = 2_500
    await interaction.click(
      screen.getByRole("button", { name: "停止语音输入" })
    )

    await waitFor(() =>
      expect(props.onValueChange).toHaveBeenLastCalledWith(
        "Existing text 整理会议纪要"
      )
    )
    expect(props.onValueChange).toHaveBeenCalledWith("Existing text 整理会议")
    expect(props.onSubmit).not.toHaveBeenCalled()
    expect(props.onAttach).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(requestUrl).toBe("/api/v1/voice/transcriptions")
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      audio_data_url: expect.stringMatching(/^data:audio\/webm;base64,/u),
      language: "zh-CN",
      stream: true,
    })
  })

  it("uses an injected embedded-session requester for voice transcription", async () => {
    installMediaRecorder()
    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const requestVoiceTranscription = vi.fn(async () => voiceStreamResponse())
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    const { props } = renderComposer({ requestVoiceTranscription })

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    await screen.findByTestId("voice-recording-panel")
    now = 2_500
    await interaction.click(
      screen.getByRole("button", { name: "停止语音输入" })
    )

    await waitFor(() =>
      expect(props.onValueChange).toHaveBeenLastCalledWith(
        "Existing text 整理会议纪要"
      )
    )
    expect(requestVoiceTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        audio_data_url: expect.stringMatching(/^data:audio\/webm;base64,/u),
        language: "zh-CN",
        stream: true,
      }),
      expect.any(AbortSignal)
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("does not overwrite text the user edits while transcription is streaming", async () => {
    installMediaRecorder()
    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const encoder = new TextEncoder()
    let responseController!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              responseController = controller
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          }
        )
      )
    )
    const interaction = userEvent.setup()
    const { props } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    await screen.findByTestId("voice-recording-panel")
    now = 2_500
    await interaction.click(
      screen.getByRole("button", { name: "停止语音输入" })
    )
    const input = await screen.findByRole("textbox", { name: "任务输入框" })
    expect(screen.queryByText("正在转写语音…")).not.toBeInTheDocument()
    const transcriptionButton = screen.getByRole("button", {
      name: "正在转写语音…",
    })
    expect(transcriptionButton).toBeDisabled()
    expect(transcriptionButton).toHaveAttribute("aria-busy", "true")
    expect(
      within(transcriptionButton).getByTestId("voice-transcription-spinner")
    ).toHaveAttribute("data-slot", "spinner")
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
    fireEvent.change(input, { target: { value: "用户手动修改的内容" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(props.onSubmit).not.toHaveBeenCalled()

    await act(async () => {
      responseController.enqueue(
        encoder.encode(
          `${JSON.stringify({ type: "delta", text: "不应覆盖" })}\n` +
            `${JSON.stringify({ type: "done", text: "不应覆盖用户内容" })}\n`
        )
      )
      responseController.close()
    })
    await screen.findByRole("button", { name: "语音输入" })

    expect(props.onValueChange).toHaveBeenCalledTimes(1)
    expect(props.onValueChange).toHaveBeenLastCalledWith("用户手动修改的内容")
  })

  it("shows the PC recording strip and rejects recordings shorter than one second", async () => {
    const { track } = installMediaRecorder()
    let now = 2_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    const { props } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    expect(await screen.findByText("正在录音")).toBeInTheDocument()
    expect(screen.getByLabelText("录音时长")).toHaveTextContent("0:00")
    now = 2_500
    await interaction.click(
      screen.getByRole("button", { name: "停止语音输入" })
    )

    expect(props.onError).toHaveBeenLastCalledWith(
      "录音时间太短，请至少录制 1 秒。"
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("adds one temporal waveform sample per analyser frame with the newest sample on the right", async () => {
    vi.useFakeTimers()
    installMediaRecorder()
    installAudioAnalysis([
      { amplitude: 0, frequencyMagnitude: 0 },
      { amplitude: 16, frequencyMagnitude: 220 },
    ])
    renderComposer()

    fireEvent.click(screen.getByRole("button", { name: "语音输入" }))
    await act(async () => Promise.resolve())

    const waveform = screen.getByTestId("voice-waveform")
    expect(waveform.querySelectorAll("[data-waveform-sample]")).toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80)
    })
    let samples = waveform.querySelectorAll<HTMLElement>(
      "[data-waveform-sample]"
    )
    expect(samples).toHaveLength(1)
    const firstSampleId = samples[0]?.dataset.waveformSample
    const quietLevel = Number(samples[0]?.dataset.waveformLevel)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(80)
    })
    samples = waveform.querySelectorAll<HTMLElement>("[data-waveform-sample]")
    expect(samples).toHaveLength(2)
    expect(samples[0]?.dataset.waveformSample).toBe(firstSampleId)
    expect(Number(samples[1]?.dataset.waveformSample)).toBeGreaterThan(
      Number(firstSampleId)
    )
    expect(Number(samples[1]?.dataset.waveformLevel)).toBeGreaterThan(
      quietLevel
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(71 * 80)
    })
    samples = waveform.querySelectorAll<HTMLElement>("[data-waveform-sample]")
    expect(samples).toHaveLength(72)
    expect(samples[0]?.dataset.waveformSample).toBe("2")
    expect(samples[71]?.dataset.waveformSample).toBe("73")
  })

  it("rejects a raw recording that would exceed the encoded API limit", async () => {
    installMediaRecorder()
    MediaRecorderMock.nextBlob = new Blob([
      new Uint8Array(MAX_VOICE_AUDIO_BYTES + 1),
    ])
    let now = 2_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const interaction = userEvent.setup()
    const { props } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    await screen.findByTestId("voice-recording-panel")
    now = 3_500
    await interaction.click(
      screen.getByRole("button", { name: "停止语音输入" })
    )

    expect(props.onError).toHaveBeenLastCalledWith(
      "录音文件过大，请缩短录音后重试。"
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("surfaces a structured streaming service failure and keeps the draft", async () => {
    installMediaRecorder()
    let now = 2_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        voiceStreamResponse([
          {
            type: "error",
            error_code: "VOICE_TRANSCRIPTION_FAILED",
            message_key: "errors.composer.voiceTranscriptionFailed",
            message: "语音转文字失败，请重试或手动输入。",
          },
        ])
      )
    )
    const interaction = userEvent.setup()
    const { props } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    await screen.findByTestId("voice-recording-panel")
    now = 3_500
    await interaction.click(
      screen.getByRole("button", { name: "停止语音输入" })
    )

    await waitFor(() =>
      expect(props.onError).toHaveBeenLastCalledWith(
        "语音转文字失败，请重试或手动输入。"
      )
    )
    expect(props.onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toHaveValue(
      "Existing text"
    )
  })

  it("shows the per-user voice request limit returned before streaming", async () => {
    installMediaRecorder()
    let now = 2_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            success: false,
            error_code: "VOICE_TRANSCRIPTION_RATE_LIMITED",
            message_key: "errors.composer.voiceTranscriptionRateLimited",
            message: "语音输入每分钟最多使用 20 次，请稍后再试。",
            params: { retry_after_seconds: 45 },
          },
          { status: 429 }
        )
      )
    )
    const interaction = userEvent.setup()
    const { props } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    await screen.findByTestId("voice-recording-panel")
    now = 3_500
    await interaction.click(
      screen.getByRole("button", { name: "停止语音输入" })
    )

    await waitFor(() =>
      expect(props.onError).toHaveBeenLastCalledWith(
        "语音输入每分钟最多使用 20 次，请稍后再试。"
      )
    )
    expect(props.onValueChange).not.toHaveBeenCalled()
  })

  it.each([
    ["NotAllowedError", "麦克风权限未开启，请允许当前页面使用麦克风后重试。"],
    ["NotFoundError", "未检测到可用麦克风，请检查设备后重试。"],
    [
      "NotReadableError",
      "麦克风暂时无法使用，请检查系统权限或设备占用后重试。",
    ],
  ])(
    "maps the %s microphone failure to an actionable message",
    async (name, message) => {
      installMediaRecorder({
        getUserMedia: () => Promise.reject(new DOMException("failed", name)),
      })
      const interaction = userEvent.setup()
      const { props } = renderComposer()

      await interaction.click(screen.getByRole("button", { name: "语音输入" }))

      await waitFor(() =>
        expect(props.onError).toHaveBeenLastCalledWith(message)
      )
      expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeEnabled()
    }
  )

  it("stops MediaRecorder and every microphone track when the composer unmounts", async () => {
    const { track } = installMediaRecorder()
    const interaction = userEvent.setup()
    const { unmount } = renderComposer()

    await interaction.click(screen.getByRole("button", { name: "语音输入" }))
    await screen.findByTestId("voice-recording-panel")
    const recorder = MediaRecorderMock.instances[0]!
    unmount()

    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("automatically stops recording after five minutes", async () => {
    vi.useFakeTimers()
    installMediaRecorder()
    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(voiceStreamResponse()))
    const { props } = renderComposer()

    fireEvent.click(screen.getByRole("button", { name: "语音输入" }))
    await act(async () => Promise.resolve())
    expect(MediaRecorderMock.instances).toHaveLength(1)
    now += MAX_VOICE_RECORDING_DURATION_MS
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_VOICE_RECORDING_DURATION_MS)
    })

    expect(MediaRecorderMock.instances[0]!.stop).toHaveBeenCalledOnce()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("aborts a stalled transcription after 30 seconds and restores text input", async () => {
    vi.useFakeTimers()
    installMediaRecorder()
    vi.stubGlobal(
      "FileReader",
      class {
        result: string | ArrayBuffer | null = null
        error: DOMException | null = null
        private loadListener: EventListenerOrEventListenerObject | null = null

        addEventListener(
          type: string,
          listener: EventListenerOrEventListenerObject
        ) {
          if (type === "load") this.loadListener = listener
        }

        readAsDataURL() {
          this.result = "data:audio/webm;base64,AAAA"
          queueMicrotask(() => {
            const event = new Event("load")
            if (typeof this.loadListener === "function") {
              this.loadListener(event)
            } else {
              this.loadListener?.handleEvent(event)
            }
          })
        }
      }
    )
    let now = 1_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("timed out", "AbortError"))
          })
        })
    )
    vi.stubGlobal("fetch", fetchMock)
    const { props } = renderComposer()

    fireEvent.click(screen.getByRole("button", { name: "语音输入" }))
    await act(async () => Promise.resolve())
    now = 2_500
    fireEvent.click(screen.getByRole("button", { name: "停止语音输入" }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByText("正在转写语音…")).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("button", { name: "正在转写语音…" })).getByTestId(
        "voice-transcription-spinner"
      )
    ).toBeVisible()
    expect(fetchMock).toHaveBeenCalledOnce()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VOICE_TRANSCRIPTION_TIMEOUT_MS)
    })

    expect(props.onError).toHaveBeenLastCalledWith("语音识别超时，请重试。")
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBeEnabled()
  })

  it("switches the running action between Stop and Send with the draft", async () => {
    const interaction = userEvent.setup()
    const { props } = renderStatefulComposer({ isRunning: true, value: "" })

    const stop = screen.getByRole("button", { name: "停止" })
    expect(stop).toBeVisible()
    expect(stop).toHaveClass("send-button", "rounded-full", "size-8")
    expect(stop.textContent).toBe("")
    expect(
      screen.queryByRole("button", { name: "发送" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "提交补充要求" })
    ).not.toBeInTheDocument()

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    await interaction.type(input, "运行中的补充内容")

    const send = screen.getByRole("button", { name: "发送" })
    expect(send).toBeEnabled()
    expect(screen.queryByRole("button", { name: "停止" })).toBeNull()
    await interaction.click(send)
    expect(props.onSubmit).toHaveBeenCalledOnce()

    await interaction.clear(input)
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
    expect(screen.queryByRole("button", { name: "发送" })).toBeNull()
  })

  it("keeps Send visible while idle and reflects whether the draft can be sent", async () => {
    const interaction = userEvent.setup()
    renderStatefulComposer({ value: "" })

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const send = screen.getByRole("button", { name: "发送" })
    expect(send).toBeVisible()
    expect(send).toHaveAttribute("aria-disabled", "true")

    await interaction.type(input, "   ")
    expect(screen.getByRole("button", { name: "发送" })).toBe(send)
    expect(send).toHaveAttribute("aria-disabled", "true")

    await interaction.type(input, "请根据资料回答")
    expect(screen.getByRole("button", { name: "发送" })).toBe(send)
    expect(send).toHaveAttribute("aria-disabled", "false")

    await interaction.clear(input)
    expect(screen.getByRole("button", { name: "发送" })).toBe(send)
    expect(send).toHaveAttribute("aria-disabled", "true")
  })

  it("submits the latest textarea value before the parent value prop catches up on click", async () => {
    const interaction = userEvent.setup()
    const { props } = renderComposer({ value: "已有内容" })

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const send = screen.getByRole("button", { name: "发送" })
    expect(send).not.toBeDisabled()
    expect(send).toHaveAttribute("aria-disabled", "false")

    fireEvent.change(input, { target: { value: "快速发送的新内容" } })
    expect(send).toHaveAttribute("aria-disabled", "false")

    await interaction.click(send)

    expect(props.onValueChange).toHaveBeenLastCalledWith("快速发送的新内容")
    expect(props.onSubmit).toHaveBeenCalledWith("快速发送的新内容")
  })

  it("submits the latest textarea value before the parent value prop catches up on Enter", () => {
    const { props } = renderComposer({ value: "" })

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    fireEvent.change(input, { target: { value: "回车快速发送" } })
    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      shiftKey: false,
    })

    expect(props.onValueChange).toHaveBeenLastCalledWith("回车快速发送")
    expect(props.onSubmit).toHaveBeenCalledWith("回车快速发送")
  })

  it("runs /压缩 as a local command without submitting it to the model", async () => {
    const onCompact = vi.fn()
    const { props } = renderComposer({
      value: "/压缩",
      compactAvailable: true,
      onCompact,
    })

    fireEvent.keyDown(screen.getByRole("textbox", { name: "任务输入框" }), {
      key: "Enter",
      code: "Enter",
      shiftKey: false,
    })

    await waitFor(() => expect(onCompact).toHaveBeenCalledOnce())
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("does not run /压缩 while the current task is unavailable", async () => {
    const onCompact = vi.fn()
    const { props } = renderComposer({
      value: "/压缩",
      compactAvailable: false,
      onCompact,
    })

    fireEvent.keyDown(screen.getByRole("textbox", { name: "任务输入框" }), {
      key: "Escape",
      code: "Escape",
    })
    fireEvent.keyDown(screen.getByRole("textbox", { name: "任务输入框" }), {
      key: "Enter",
      code: "Enter",
      shiftKey: false,
    })

    await act(async () => Promise.resolve())
    expect(onCompact).not.toHaveBeenCalled()
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("keeps Stop visible during a run when only an uploaded attachment is selected", () => {
    renderComposer({
      value: "",
      isRunning: true,
      attachments: [
        {
          id: "attachment-1",
          name: "brief.pdf",
          size: 1024,
          kind: "attachment",
          download_available: false,
        },
      ],
    })

    expect(screen.queryByRole("button", { name: "发送" })).toBeNull()
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
    expect(document.querySelector('[data-file-icon-kind="pdf"]')).toBeVisible()
  })

  it("keeps Stop visible during a run while an attachment uploads without text", () => {
    renderComposer({
      value: "",
      isRunning: true,
      pendingAttachmentUploads: [
        {
          id: "pending-running-upload",
          name: "brief.pdf",
          size: 1024,
          mimeType: "application/pdf",
        },
      ],
    })

    expect(screen.queryByRole("button", { name: "发送" })).toBeNull()
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
  })

  it("keeps Stop visible during a run when only a capability is selected", () => {
    renderComposer({
      value: "",
      isRunning: true,
      capabilities: [capabilityFixture()],
      selectedIds: ["skill-1"],
    })

    expect(screen.queryByRole("button", { name: "发送" })).toBeNull()
    expect(screen.getByRole("button", { name: "停止" })).toBeVisible()
  })

  it("adds every pasted image and file when clipboard items expose only one selection", () => {
    const image = new File(["image"], "screenshot.png", { type: "image/png" })
    const document = new File(["pdf"], "brief.pdf", {
      type: "application/pdf",
    })
    const { props } = renderComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const pasteEvent = createEvent.paste(input)

    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [image, document],
        items: [
          {
            kind: "file",
            type: image.type,
            getAsFile: () => image,
          },
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
          },
        ],
        getData: () => "",
      },
    })

    fireEvent(input, pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(props.onAttach).toHaveBeenCalledOnce()
    expect(props.onAttach).toHaveBeenCalledWith([image, document])
    expect(props.onValueChange).not.toHaveBeenCalled()
  })

  it("keeps mixed clipboard text paste while adding its files", () => {
    const image = new File(["image"], "screenshot.png", { type: "image/png" })
    const { props } = renderComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const pasteEvent = createEvent.paste(input)

    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [image],
        items: [
          {
            kind: "string",
            type: "text/plain",
            getAsFile: () => null,
          },
          {
            kind: "file",
            type: image.type,
            getAsFile: () => image,
          },
        ],
        getData: (format: string) =>
          format === "text/plain" ? "请参考截图" : "",
      },
    })

    fireEvent(input, pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(false)
    expect(props.onAttach).toHaveBeenCalledWith([image])
  })

  it("allows pasted files while native Goal mode is enabled", () => {
    const document = new File(["pdf"], "goal-brief.pdf", {
      type: "application/pdf",
    })
    const { props } = renderComposer({ goalMode: true })
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const pasteEvent = createEvent.paste(input)

    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [document],
        items: [
          {
            kind: "file",
            type: document.type,
            getAsFile: () => document,
          },
        ],
      },
    })

    fireEvent(input, pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(props.onAttach).toHaveBeenCalledWith([document])
    expect(props.onError).not.toHaveBeenCalled()
  })

  it("falls back to clipboard files when file items cannot provide a File", () => {
    const document = new File(["pdf"], "copied-file.pdf", {
      type: "application/pdf",
    })
    const { props } = renderComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const pasteEvent = createEvent.paste(input)

    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [document],
        items: [
          {
            kind: "file",
            type: document.type,
            getAsFile: () => null,
          },
        ],
      },
    })

    fireEvent(input, pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(props.onAttach).toHaveBeenCalledWith([document])
  })

  it("keeps ordinary text paste under the browser default behavior", () => {
    const { props } = renderComposer()
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const pasteEvent = createTextPasteEvent(input, "普通文本")

    fireEvent(input, pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(false)
    expect(props.onAttach).not.toHaveBeenCalled()
  })

  it("converts a large plain-text paste into a pending TXT attachment and preserves the task instruction", async () => {
    const deferred = createDeferred<void>()
    const onAttach = vi
      .fn<(files: File[]) => Promise<void>>()
      .mockImplementation(() => deferred.promise)
    const { props } = renderComposer({
      value: "请排查以下启动失败原因",
      onAttach,
    })
    const input = screen.getByRole("textbox", {
      name: "任务输入框",
    }) as HTMLTextAreaElement
    const pastedText = Array.from(
      { length: 40 },
      (_, index) => `第 ${index + 1} 行日志`
    ).join("\n")
    input.setSelectionRange(input.value.length, input.value.length)
    const pasteEvent = createTextPasteEvent(input, pastedText)

    fireEvent(input, pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(onAttach).toHaveBeenCalledOnce()
    const [files] = onAttach.mock.calls[0]!
    const attachment = files[0]!
    expect(attachment).toBeInstanceOf(File)
    expect(attachment.name).toMatch(/^粘贴内容-\d+\.txt$/u)
    expect(attachment.type).toBe("text/plain")
    expect(props.onValueChange).not.toHaveBeenCalled()
    expect(input).toHaveValue("请排查以下启动失败原因")
    expect(input).toBeEnabled()
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
    expect(
      screen.getByTestId("pasted-text-attachment-pending")
    ).toHaveTextContent(attachment.name)

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    expect(input).toBeEnabled()
  })

  it("does not render a duplicate generic pending chip for pasted text uploads", () => {
    const deferred = createDeferred<void>()
    const onAttach = vi
      .fn<(files: File[]) => Promise<void>>()
      .mockImplementation(() => deferred.promise)
    const { props, rerender } = renderComposer({ value: "", onAttach })
    const input = screen.getByRole("textbox", {
      name: "任务输入框",
    }) as HTMLTextAreaElement
    const pastedText = Array.from(
      { length: 40 },
      (_, index) => `第 ${index + 1} 行日志`
    ).join("\n")

    fireEvent(input, createTextPasteEvent(input, pastedText))

    expect(input).toBeEnabled()

    const [[files]] = onAttach.mock.calls
    const attachment = files[0]!
    rerender(
      <ConversationComposer
        {...props}
        pendingAttachmentUploads={[
          {
            id: "pending-pasted-text-upload",
            name: attachment.name,
            size: attachment.size,
            mimeType: attachment.type,
          },
        ]}
      />
    )

    expect(
      screen.getByTestId("pasted-text-attachment-pending")
    ).toHaveTextContent(attachment.name)
    expect(document.querySelector(".attachment-chip-pending")).toBeNull()
    expect(
      screen.queryByRole("status", {
        name: `正在上传附件 ${attachment.name}`,
      })
    ).not.toBeInTheDocument()
  })

  it("does not render the pasted text pending chip once the uploaded attachment is visible", () => {
    const deferred = createDeferred<void>()
    const onAttach = vi
      .fn<(files: File[]) => Promise<void>>()
      .mockImplementation(() => deferred.promise)
    const { props, rerender } = renderComposer({ value: "", onAttach })
    const input = screen.getByRole("textbox", {
      name: "任务输入框",
    }) as HTMLTextAreaElement
    const pastedText = Array.from(
      { length: 40 },
      (_, index) => `第 ${index + 1} 行日志`
    ).join("\n")

    fireEvent(input, createTextPasteEvent(input, pastedText))

    const [[files]] = onAttach.mock.calls
    const attachment = files[0]!
    rerender(
      <ConversationComposer
        {...props}
        attachments={[
          {
            id: "pasted-text-attachment",
            name: attachment.name,
            mime_type: attachment.type,
            size: attachment.size,
            kind: "attachment",
            download_available: false,
          },
        ]}
        pendingAttachmentUploads={[
          {
            id: "pending-pasted-text-upload",
            name: attachment.name,
            size: attachment.size,
            mimeType: attachment.type,
          },
        ]}
      />
    )

    expect(
      screen.queryByTestId("pasted-text-attachment-pending")
    ).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("button", {
        name: `预览粘贴内容 ${attachment.name}`,
      })
    ).toHaveLength(1)
    expect(screen.getAllByText(attachment.name)).toHaveLength(1)
  })

  it("shows the full pasted text on hover before and after the attachment upload completes", async () => {
    const interaction = userEvent.setup()
    const deferred = createDeferred<void>()
    const onAttach = vi
      .fn<(files: File[]) => Promise<void>>()
      .mockImplementation(() => deferred.promise)
    const { props, rerender } = renderComposer({ value: "", onAttach })
    const input = screen.getByRole("textbox", {
      name: "任务输入框",
    }) as HTMLTextAreaElement
    const pastedText = Array.from(
      { length: 40 },
      (_, index) => `第 ${index + 1} 行日志`
    ).join("\n")

    fireEvent(input, createTextPasteEvent(input, pastedText))

    const [[files]] = onAttach.mock.calls
    const attachment = files[0]!
    const previewLabel = `预览粘贴内容 ${attachment.name}`
    const pendingPreviewTrigger = screen.getByRole("button", {
      name: previewLabel,
    })
    await interaction.hover(pendingPreviewTrigger)

    expect(
      await screen.findByText("第 40 行日志", { exact: false })
    ).toBeInTheDocument()
    await interaction.unhover(pendingPreviewTrigger)

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })

    rerender(
      <ConversationComposer
        {...props}
        attachments={[
          {
            id: "pasted-text-attachment",
            name: attachment.name,
            mime_type: attachment.type,
            size: attachment.size,
            kind: "attachment",
            download_available: false,
          },
        ]}
      />
    )

    await interaction.hover(screen.getByRole("button", { name: previewLabel }))

    expect(
      await screen.findByText("第 1 行日志", { exact: false })
    ).toBeInTheDocument()
  })

  it("restores a large pasted text at the original selection when attachment upload fails", async () => {
    const pastedText = Array.from({ length: 40 }, () => "启动错误日志").join(
      "\n"
    )
    const originalValue = "请分析旧文本并给出修复建议"
    const onAttach = vi.fn(() =>
      Promise.reject(new Error("attachment upload failed"))
    )
    const { props } = renderComposer({ value: originalValue, onAttach })
    const input = screen.getByRole("textbox", {
      name: "任务输入框",
    }) as HTMLTextAreaElement
    const start = originalValue.indexOf("旧文本")
    input.setSelectionRange(start, start + "旧文本".length)

    fireEvent(input, createTextPasteEvent(input, pastedText))

    await waitFor(() =>
      expect(props.onValueChange).toHaveBeenLastCalledWith(
        `请分析${pastedText}并给出修复建议`
      )
    )
    expect(input).toBeEnabled()
    expect(
      screen.queryByTestId("pasted-text-attachment-pending")
    ).not.toBeInTheDocument()
  })

  it("uses localized guidance after converting pasted text to an attachment", async () => {
    const deferred = createDeferred<void>()
    const onAttach = vi
      .fn<(files: File[]) => Promise<void>>()
      .mockImplementation(() => deferred.promise)
    renderComposer({ value: "", onAttach })
    const input = screen.getByRole("textbox", {
      name: "任务输入框",
    }) as HTMLTextAreaElement
    const pastedText = Array.from({ length: 40 }, () => "日志").join("\n")

    fireEvent(input, createTextPasteEvent(input, pastedText))

    expect(input).toHaveAttribute("placeholder", "请说明希望如何处理此附件…")
    await act(async () => {
      await i18n.changeLanguage("en-US")
    })
    expect(input).toHaveAttribute(
      "placeholder",
      "Describe how you want this attachment handled…"
    )

    await act(async () => {
      deferred.resolve()
      await deferred.promise
    })
  })

  it("keeps text input editable but prevents submission while an attachment upload is in progress", async () => {
    const interaction = userEvent.setup()
    const { props } = renderStatefulComposer({ uploading: true, value: "" })
    const input = screen.getByRole("textbox", { name: "任务输入框" })

    expect(input).toBeEnabled()

    await interaction.type(input, "上传时补充说明")

    expect(props.onValueChange).toHaveBeenLastCalledWith("上传时补充说明")
    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()

    await interaction.keyboard("{Enter}")

    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("blocks send, upload, and removal while an attachment mutation is pending", () => {
    const { props } = renderComposer({
      attachmentOperationPending: true,
      attachments: [
        {
          id: "attachment-busy",
          name: "处理中.pdf",
          mime_type: "application/pdf",
          size: 1_024,
          kind: "attachment",
          download_available: false,
        },
      ],
    })

    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled()
    expect(screen.getByLabelText("添加附件")).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "移除附件 处理中.pdf" })
    ).toBeDisabled()

    fireEvent.keyDown(screen.getByRole("textbox", { name: "任务输入框" }), {
      key: "Enter",
      code: "Enter",
    })
    expect(props.onSubmit).not.toHaveBeenCalled()
  })

  it("blocks send and attachment actions while a model preference update is pending", () => {
    const { props, rerender } = renderComposer({
      modelPreferencePending: false,
      modelPreference: {
        configured: true,
        default_model: "gpt-5.6-terra",
        selected_model: "gpt-5.6-terra",
        selected_reasoning_effort: "medium",
        models: [
          {
            id: "gpt-5.6-terra",
            display_name: "GPT-5.6-Terra",
            enabled: true,
            context_window: null,
            supported_reasoning_efforts: ["medium", "high"],
            default_reasoning_effort: "medium",
          },
        ],
      },
    })

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "任务输入框",
    })
    input.focus()
    input.setSelectionRange(1, 4)
    const renders = editorRender.mock.calls.length
    rerender(<ConversationComposer {...props} modelPreferencePending />)
    expect(editorRender).toHaveBeenCalledTimes(renders)
    expect(screen.getByRole("textbox", { name: "任务输入框" })).toBe(input)
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(1)
    expect(input.selectionEnd).toBe(4)
    expect(screen.getByRole("button", { name: "添加" })).toHaveClass(
      "disabled:opacity-100"
    )

    expect(screen.getByRole("button", { name: "发送" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled()
    expect(screen.getByLabelText("添加附件")).toBeDisabled()

    fireEvent.keyDown(screen.getByRole("textbox", { name: "任务输入框" }), {
      key: "Enter",
      code: "Enter",
    })
    expect(props.onSubmit).not.toHaveBeenCalled()

    rerender(
      <ConversationComposer
        {...props}
        modelPreference={
          props.modelPreference && {
            ...props.modelPreference,
            selected_reasoning_effort: "high",
          }
        }
      />
    )
    expect(editorRender).toHaveBeenCalledTimes(renders)
    expect(screen.getByRole("button", { name: "添加" })).toBeEnabled()
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("Existing text")
  })

  it("does not consume a pasted file when attachment operations are busy", () => {
    const file = new File(["pdf"], "等待上传.pdf", {
      type: "application/pdf",
    })
    const { props } = renderComposer({ attachmentOperationPending: true })
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const pasteEvent = createEvent.paste(input)
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [file],
        items: [
          {
            kind: "file",
            type: file.type,
            getAsFile: () => file,
          },
        ],
        getData: () => "",
      },
    })

    fireEvent(input, pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(false)
    expect(props.onAttach).not.toHaveBeenCalled()
  })

  it("keeps native file paste behavior when the parent rejects the operation synchronously", () => {
    const file = new File(["pdf"], "稍后上传.pdf", {
      type: "application/pdf",
    })
    const onAttach = vi.fn(() => false)
    renderComposer({ onAttach })
    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const pasteEvent = createEvent.paste(input)
    Object.defineProperty(pasteEvent, "clipboardData", {
      configurable: true,
      value: {
        files: [file],
        items: [
          {
            kind: "file",
            type: file.type,
            getAsFile: () => file,
          },
        ],
        getData: () => "",
      },
    })

    fireEvent(input, pasteEvent)

    expect(onAttach).toHaveBeenCalledWith([file])
    expect(pasteEvent.defaultPrevented).toBe(false)
  })

  it("gives the composer actions darker icons with a visually balanced plus", () => {
    renderComposer()

    const addCapability = screen.getByRole("button", {
      name: "添加",
    })

    expect(addCapability.querySelector("svg")).toHaveClass(
      "size-[18px]",
      "text-[var(--app-text)]"
    )
    expect(
      screen.queryByRole("button", { name: "添加附件" })
    ).not.toBeInTheDocument()
  })

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "hides the knowledge button when disabled and restores it by default in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const { props, rerender } = renderComposer({
        showKnowledgeBaseButton: false,
      })
      const buttonName = i18n.t("conversation.addKnowledgeBase")
      expect(
        screen.queryByRole("button", { name: buttonName })
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: i18n.t("conversation.addMenu") })
      ).toBeVisible()
      rerender(
        <ConversationComposer {...props} showKnowledgeBaseButton={undefined} />
      )
      expect(screen.getByRole("button", { name: buttonName })).toBeVisible()
      await i18n.changeLanguage("zh-CN")
    }
  )

  it("also hides the unavailable knowledge search button when disabled", () => {
    renderComposer({
      showKnowledgeBaseButton: false,
      knowledgeSearchCapability: {
        status: "unavailable",
        reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
        checked_at: "2026-07-22T08:00:00.000Z",
      },
    })
    expect(
      screen.queryByRole("button", { name: "添加知识库" })
    ).not.toBeInTheDocument()
  })

  it("shows the knowledge search warning in a white hover card instead of a persistent banner", async () => {
    const interaction = userEvent.setup()
    renderComposer({
      knowledgeSearchCapability: {
        status: "unavailable",
        reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
        checked_at: "2026-07-22T08:00:00.000Z",
      },
    })

    expect(screen.getByRole("button", { name: "添加" })).toBeEnabled()
    const knowledgeTrigger = screen.getByRole("button", {
      name: "添加知识库",
    })
    expect(knowledgeTrigger).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.queryByRole("button", { name: "添加附件" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发送" })).toBeEnabled()
    expect(screen.queryByText("知识库检索暂不可用")).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        "当前无法使用知识库检索。你仍可继续使用插件、Skill、附件并正常提交任务，请稍后重试。"
      )
    ).not.toBeInTheDocument()

    await interaction.hover(knowledgeTrigger)

    const title = await screen.findByText("知识库检索暂不可用")
    const hoverCard = title.closest('[data-slot="hover-card-content"]')
    if (!(hoverCard instanceof HTMLElement)) {
      throw new Error("Missing knowledge search hover card")
    }
    expect(hoverCard).toHaveClass(
      "bg-[var(--app-popover)]",
      "border",
      "shadow-md"
    )
    expect(hoverCard).toHaveAccessibleName("知识库检索暂不可用")
    expect(
      screen.getByText(
        "当前无法使用知识库检索。你仍可继续使用插件、Skill、附件并正常提交任务，请稍后重试。"
      )
    ).toBeVisible()
    expect(screen.queryByText("选择知识库")).not.toBeInTheDocument()
  })

  it.each(["meeting-notes", "会议纪要助手"])(
    "finds a custom Skill by %s and selects its stable identifier",
    async (query) => {
      const interaction = userEvent.setup()
      const { onSelectedIdsChange } = renderStatefulComposer({
        capabilities: [
          capabilityFixture({
            id: "skill-notes",
            name: "meeting-notes",
            display_name: "会议纪要助手",
          }),
        ],
        selectedIds: [],
      })
      await interaction.click(screen.getByRole("button", { name: "添加" }))
      await interaction.type(screen.getByRole("combobox"), query)
      const option = screen.getByRole("option", { name: /会议纪要助手/u })
      expect(option).not.toHaveTextContent("meeting-notes")
      await interaction.click(option)
      expect(onSelectedIdsChange).toHaveBeenCalledWith(["skill-notes"])
      expect(
        screen.getByText("会议纪要助手").closest(".capability-chip")
      ).toBeVisible()
    }
  )

  it("uses a compact capability title and renders one check for a selected capability", async () => {
    const interaction = userEvent.setup()
    renderComposer({
      capabilities: [
        capabilityFixture({
          id: "skill-pptx",
          name: "pptx",
          type: "skill",
          description: "Create presentation files",
        }),
      ],
      selectedIds: ["skill-pptx"],
    })

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    const selectedItem = screen.getByRole("option", { name: /Pptx/ })
    expect(selectedItem.closest('[data-slot="popover-content"]')).toHaveClass(
      "capability-picker-popover",
      "gap-2"
    )
    expect(
      screen.queryByText(
        "选择后，该插件或 Skill 会加载到本轮 Codex，并作为显式调用附加到消息。"
      )
    ).not.toBeInTheDocument()
    expect(screen.getByText("Skill")).toBeVisible()
    expect(screen.queryByText("插件")).not.toBeInTheDocument()
    expect(selectedItem).toHaveAttribute("data-checked", "true")
    expect(selectedItem.querySelectorAll("svg.lucide-check")).toHaveLength(1)
    const labels = selectedItem.querySelector("[data-capability-labels]")
    expect(labels).toHaveClass("flex", "items-center")
    expect(labels?.querySelector("[data-capability-name]")).toHaveTextContent(
      "Pptx"
    )
    const description = labels?.querySelector("[data-capability-description]")
    expect(description).toHaveTextContent("Create presentation files")
    expect(description).toHaveClass("text-[length:var(--app-font-12)]")
  })

  it("selects the required development Skill automatically and prevents removal while other Skills remain editable", async () => {
    const interaction = userEvent.setup()
    const id = "builtin:capability:linksense-interactive-app-builder"
    const { props, rerender } = renderComposer({
      capabilities: [
        capabilityFixture({
          id,
          name: "linksense-interactive-app-builder",
          slug: "linksense-interactive-app-builder",
          source_type: "builtin",
          builtin_key: "linksense-interactive-app-builder",
          is_builtin: true,
        }),
        capabilityFixture({ name: "Optional Skill" }),
      ],
      selectedIds: ["skill-1"],
      requiredIds: [id],
    })
    expect(screen.getByText("LinkSense 交互式应用开发")).toBeVisible()
    expect(
      screen.queryByRole("img", { name: "此任务必需" })
    ).not.toBeInTheDocument()
    expect(screen.getByText("此任务必需")).toHaveClass("sr-only")
    expect(
      screen.queryByRole("button", { name: "移除 LinkSense 交互式应用开发" })
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "移除 Optional Skill" })
    )
    expect(props.onSelectedIdsChange).toHaveBeenCalledWith([id])
    await interaction.click(screen.getByRole("button", { name: "添加" }))
    const requiredOption = screen.getByRole("option", {
      name: /LinkSense 交互式应用开发/,
    })
    expect(requiredOption).toHaveAttribute("aria-disabled", "true")
    expect(requiredOption).toHaveAttribute("data-checked", "true")
    await interaction.keyboard("{Escape}")
    rerender(<ConversationComposer {...props} selectedIds={[]} />)
    expect(screen.getByText("LinkSense 交互式应用开发")).toBeVisible()
    expect(screen.queryByText("Optional Skill")).not.toBeInTheDocument()
  })

  it("keeps required Skills selected when selected again with the keyboard shortcut", async () => {
    const interaction = userEvent.setup()
    const id = "builtin:capability:linksense-interactive-app-builder"
    const { onSelectedIdsChange } = renderStatefulComposer({
      capabilities: [
        capabilityFixture({
          id,
          name: "linksense-interactive-app-builder",
          slug: "linksense-interactive-app-builder",
          source_type: "builtin",
          builtin_key: "linksense-interactive-app-builder",
          is_builtin: true,
        }),
      ],
      requiredIds: [id],
    })
    await interaction.type(
      screen.getByRole("textbox", { name: "任务输入框" }),
      "$"
    )
    await interaction.keyboard("{Enter}")
    expect(onSelectedIdsChange).not.toHaveBeenCalled()
    expect(screen.getByText("LinkSense 交互式应用开发")).toBeVisible()
  })

  it("sorts non-built-in Skills alphabetically and places built-in Skills last", async () => {
    const interaction = userEvent.setup()
    renderComposer({
      capabilities: [
        capabilityFixture({
          id: "builtin:capability:linksense-browser",
          name: "linksense-browser",
          slug: "linksense-browser",
          source_type: "builtin",
          builtin_key: "linksense-browser",
          is_builtin: true,
        }),
        capabilityFixture({ id: "skill-b", name: "Zulu Skill" }),
        capabilityFixture({
          id: "builtin:capability:linksense-file-service",
          name: "linksense-file-service",
          slug: "linksense-file-service",
          source_type: "builtin",
          builtin_key: "linksense-file-service",
          is_builtin: true,
        }),
        capabilityFixture({ id: "skill-a", name: "alpha Skill" }),
      ],
    })

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    expect(
      screen
        .getAllByRole("option")
        .map(
          (option) =>
            option.querySelector("[data-capability-name]")?.textContent
        )
        .filter((name): name is string => name !== undefined)
    ).toEqual([
      "Alpha Skill",
      "Zulu Skill",
      "LinkSense 浏览器",
      "LinkSense 文件服务",
    ])
  })

  it("selects and deselects a built-in Skill from the capability picker", async () => {
    const builtInId = "builtin:capability:linksense-browser"
    const { onSelectedIdsChange } = renderStatefulComposer({
      capabilities: [
        capabilityFixture({
          id: builtInId,
          name: "linksense-browser",
          slug: "linksense-browser",
          source_type: "builtin",
          builtin_key: "linksense-browser",
          is_builtin: true,
          is_owner: false,
          can_manage: false,
          can_select: false,
          can_delete: false,
        }),
      ],
    })
    const interaction = userEvent.setup()
    await interaction.click(screen.getByRole("button", { name: "添加" }))

    const option = await screen.findByRole("option", {
      name: /LinkSense 浏览器/,
    })
    expect(option).not.toHaveAttribute("data-disabled", "true")
    expect(option).toHaveTextContent("内置")
    await interaction.click(option)
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith([builtInId])

    await interaction.click(screen.getByRole("button", { name: "添加" }))
    const selectedOption = await screen.findByRole("option", {
      name: /LinkSense 浏览器/,
    })
    expect(selectedOption).toHaveAttribute("data-checked", "true")
    await interaction.click(selectedOption)
    expect(onSelectedIdsChange).toHaveBeenLastCalledWith([])
  })

  it("hides both capability group headings when no capabilities are available", async () => {
    const interaction = userEvent.setup()
    renderComposer()

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    expect(screen.getByText("没有可用插件或 Skill")).toBeVisible()
    expect(screen.queryByText("插件")).not.toBeInTheDocument()
    expect(screen.queryByText("Skill")).not.toBeInTheDocument()
  })

  it("shows only the plugin heading when the Skill group is empty", async () => {
    const interaction = userEvent.setup()
    renderComposer({
      capabilities: [
        capabilityFixture({
          id: "plugin-search",
          name: "search",
          type: "plugin",
          description: "Search the web",
        }),
      ],
    })

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    expect(screen.getByText("插件")).toBeVisible()
    expect(screen.queryByText("Skill")).not.toBeInTheDocument()
    expect(screen.getByRole("option", { name: /search/ })).toBeVisible()
  })

  it("closes the capability picker after selecting a capability", async () => {
    const interaction = userEvent.setup()
    const { props } = renderComposer({
      capabilities: [
        capabilityFixture({
          id: "skill-pptx",
          name: "pptx",
          type: "skill",
          description: "Create presentation files",
        }),
      ],
    })

    await interaction.click(screen.getByRole("button", { name: "添加" }))
    await interaction.click(screen.getByRole("option", { name: /Pptx/ }))

    expect(props.onSelectedIdsChange).toHaveBeenCalledWith(["skill-pptx"])
    await waitFor(() =>
      expect(
        screen.queryByRole("option", { name: /Pptx/ })
      ).not.toBeInTheDocument()
    )
  })

  it("refreshes expiring capability logo links when the picker opens", async () => {
    const interaction = userEvent.setup()
    const onRetryCapabilities = vi.fn()
    renderComposer({ onRetryCapabilities })

    await interaction.click(screen.getByRole("button", { name: "添加" }))

    expect(onRetryCapabilities).toHaveBeenCalledTimes(1)
  })

  it("shows selected capabilities with an icon and no priority prefix", () => {
    renderComposer({
      capabilities: [
        capabilityFixture({
          id: "skill-pptx",
          name: "ppt-generation",
          type: "skill",
          description: "Create presentation files",
        }),
      ],
      selectedIds: ["skill-pptx"],
    })

    const chip = screen.getByText("Ppt Generation").closest(".capability-chip")
    expect(chip).toHaveTextContent("Ppt Generation")
    expect(chip).not.toHaveTextContent("本轮优先")
    expect(chip).toHaveClass("composer-context-chip")
    expect(chip?.querySelector("img.capability-chip-icon")).toBeTruthy()
    expect(screen.getByText("Ppt Generation")).toHaveClass(
      "composer-chip-label"
    )
  })

  it("uses the same label class for attached file names", () => {
    renderComposer({
      attachments: [
        {
          id: "attachment-1",
          name: "brief.pdf",
          size: 1024,
          kind: "attachment",
          download_available: false,
        },
      ],
    })

    const label = screen.getByText("brief.pdf")
    expect(label).toHaveClass("composer-chip-label")
    expect(label.closest(".attachment-chip")).toHaveClass(
      "composer-context-chip"
    )
  })

  it("can render image attachments as plain chips when previews are disabled", () => {
    renderComposer({
      attachmentPreviewEnabled: false,
      attachments: [
        {
          id: "image-attachment-1",
          name: "campus.png",
          mime_type: "image/png",
          size: 1024,
          kind: "attachment",
          download_available: false,
        },
      ],
    })

    expect(screen.getByText("campus.png")).toHaveClass("composer-chip-label")
    expect(
      screen.queryByRole("status", { name: "正在加载图片 campus.png" })
    ).not.toBeInTheDocument()
  })

  it("shows pending uploaded files as attachment chips with a loading indicator", () => {
    renderComposer({
      pendingAttachmentUploads: [
        {
          id: "pending-upload-1",
          name: "ui-ux-pro-max.zip",
          size: 5_242_880,
          mimeType: "application/zip",
        },
      ],
    })

    const pendingChip = screen.getByRole("status", {
      name: "正在上传附件 ui-ux-pro-max.zip",
    })
    expect(within(pendingChip).getByText("ui-ux-pro-max.zip")).toHaveClass(
      "composer-chip-label"
    )
    expect(pendingChip.querySelector(".attachment-chip-spinner")).not.toBeNull()
    expect(
      screen.queryByRole("button", { name: "移除附件 ui-ux-pro-max.zip" })
    ).not.toBeInTheDocument()
  })

  it("shows uploading images in the same thumbnail layout as completed images", () => {
    const previewFile = new File(["image"], "upload-preview.png", {
      type: "image/png",
    })
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:pending-image")
        static revokeObjectURL = vi.fn()
      }
    )
    const pendingAttachmentUploads = [
      {
        id: "pending-image",
        name: previewFile.name,
        size: previewFile.size,
        mimeType: previewFile.type,
        previewFile,
      },
    ]
    const { props, rerender } = renderComposer({ pendingAttachmentUploads })
    const loading = screen.getByRole("status", {
      name: "正在上传附件 upload-preview.png",
    })
    expect(loading.closest(".image-preview-thumbnail")).not.toBeNull()
    expect(loading.querySelector("img")).toHaveAttribute(
      "src",
      "blob:pending-image"
    )
    expect(loading.querySelector('[data-slot="spinner"]')).not.toBeNull()
    expect(loading.closest(".composer-context-row")).not.toHaveClass(
      "composer-context-row-with-files"
    )
    expect(document.querySelector(".attachment-chip-pending")).toBeNull()

    rerender(
      <ConversationComposer
        {...props}
        pendingAttachmentUploads={pendingAttachmentUploads}
        attachments={[
          {
            id: "mixed-file",
            name: "brief.pdf",
            size: 1_024,
            kind: "attachment",
            download_available: false,
          },
        ]}
      />
    )
    expect(
      screen
        .getByRole("status", { name: "正在上传附件 upload-preview.png" })
        .closest(".composer-context-row")
    ).toHaveClass("composer-context-row-with-files")

    rerender(
      <ConversationComposer
        {...props}
        pendingAttachmentUploads={pendingAttachmentUploads}
        attachmentPreviewEnabled={false}
      />
    )
    const pendingChip = screen.getByRole("status", {
      name: "正在上传附件 upload-preview.png",
    })
    expect(pendingChip).toHaveClass("attachment-chip-pending")
    expect(document.querySelector(".image-preview-thumbnail")).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:pending-image"
    )
  })

  it("collapses uploaded attachments after the first two and reveals the complete list on hover", async () => {
    const interaction = userEvent.setup()
    const attachments = ["一.pdf", "二.pdf", "三.pdf", "四.pdf"].map(
      (name, index) => ({
        id: `attachment-${index + 1}`,
        name,
        mime_type: "application/pdf",
        size: 1_024 + index,
        kind: "attachment" as const,
        download_available: false,
      })
    )

    const { props } = renderComposer({ attachments })

    expect(screen.getByText("一.pdf")).toBeVisible()
    expect(screen.getByText("二.pdf")).toBeVisible()
    expect(screen.queryByText("三.pdf")).not.toBeInTheDocument()
    expect(screen.queryByText("四.pdf")).not.toBeInTheDocument()

    const overflowTrigger = screen.getByRole("button", {
      name: "查看全部 4 个附件",
    })
    expect(overflowTrigger).toHaveTextContent("+2")

    await interaction.hover(overflowTrigger)
    const completeList = await screen.findByLabelText("全部附件（4）")
    for (const attachment of attachments) {
      expect(within(completeList).getByText(attachment.name)).toBeVisible()
    }

    await interaction.click(
      within(completeList).getByRole("button", { name: "清除全部" })
    )
    expect(props.onClearAttachments).toHaveBeenCalledOnce()
    expect(props.onClearAttachments).toHaveBeenCalledWith(attachments)
    expect(props.onRemoveAttachment).not.toHaveBeenCalled()
  })

  it("keeps exactly two attachments visible without an overflow trigger", () => {
    renderComposer({
      attachments: ["一.pdf", "二.pdf"].map((name, index) => ({
        id: `attachment-${index + 1}`,
        name,
        mime_type: "application/pdf",
        size: 1_024 + index,
        kind: "attachment" as const,
        download_available: false,
      })),
    })

    expect(screen.getByText("一.pdf")).toBeVisible()
    expect(screen.getByText("二.pdf")).toBeVisible()
    expect(
      screen.queryByRole("button", { name: /查看全部 \d+ 个附件/u })
    ).not.toBeInTheDocument()
  })

  it("counts pending uploads in the attachment overflow and blocks every send path until they finish", async () => {
    const interaction = userEvent.setup()
    const pendingAttachmentUploads = [
      {
        id: "pending-upload-1",
        name: "上传一.pdf",
        size: 1_024,
        mimeType: "application/pdf",
      },
      {
        id: "pending-upload-2",
        name: "上传二.pdf",
        size: 2_048,
        mimeType: "application/pdf",
      },
      {
        id: "pending-upload-3",
        name: "上传三.pdf",
        size: 3_072,
        mimeType: "application/pdf",
      },
    ]
    const { props } = renderComposer({
      value: "文件上传完成后发送",
      pendingAttachmentUploads,
    })

    const input = screen.getByRole("textbox", { name: "任务输入框" })
    const sendButton = screen.getByRole("button", { name: "发送" })
    const overflowTrigger = screen.getByRole("button", {
      name: "查看全部 3 个附件",
    })

    expect(input).toBeEnabled()
    expect(sendButton).toBeDisabled()
    expect(overflowTrigger).toHaveTextContent("+1")
    expect(screen.queryByText("上传三.pdf")).not.toBeInTheDocument()

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" })
    expect(props.onSubmit).not.toHaveBeenCalled()

    await interaction.hover(overflowTrigger)
    const completeList = await screen.findByLabelText("全部附件（3）")
    expect(within(completeList).getByText("上传三.pdf")).toBeVisible()
    expect(
      completeList.querySelectorAll(".attachment-overflow-loading")
    ).toHaveLength(3)
    expect(within(completeList).queryByText("已上传")).not.toBeInTheDocument()
    expect(
      within(completeList).getByRole("button", { name: "清除全部" })
    ).toBeDisabled()
  })

  it("hides the pending upload chip once the same attachment is already visible", () => {
    renderComposer({
      attachments: [
        {
          id: "attachment-uploaded",
          name: "AI发展-10页-金色指数风.zip",
          mime_type: "application/zip",
          size: 5_242_880,
          kind: "attachment",
          download_available: false,
        },
      ],
      pendingAttachmentUploads: [
        {
          id: "pending-upload-1",
          name: "AI发展-10页-金色指数风.zip",
          size: 5_242_880,
          mimeType: "application/zip",
        },
      ],
    })

    expect(
      screen.queryByRole("status", {
        name: "正在上传附件 AI发展-10页-金色指数风.zip",
      })
    ).not.toBeInTheDocument()
    expect(screen.getAllByText("AI发展-10页-金色指数风.zip")).toHaveLength(1)
    expect(
      screen.getByRole("button", {
        name: "移除附件 AI发展-10页-金色指数风.zip",
      })
    ).toBeVisible()
  })

  it("uses the compact image layout only when image and non-image attachments coexist", () => {
    const { props, rerender } = renderComposer({
      attachments: [
        {
          id: "image-1",
          name: "reference.png",
          mime_type: "image/png",
          size: 1024,
          kind: "attachment",
          download_available: false,
        },
      ],
      loadAttachmentPreview: vi.fn(async () => new Blob()),
    })

    const imageOnlyRow = screen
      .getByRole("status", { name: "正在加载图片 reference.png" })
      .closest(".composer-context-row")
    expect(imageOnlyRow).not.toHaveClass("composer-context-row-with-files")

    rerender(
      <ConversationComposer
        {...props}
        attachments={[
          {
            id: "image-1",
            name: "reference.png",
            mime_type: "image/png",
            size: 1024,
            kind: "attachment",
            download_available: false,
          },
          {
            id: "file-1",
            name: "brief.pdf",
            mime_type: "application/pdf",
            size: 1024,
            kind: "attachment",
            download_available: false,
          },
        ]}
      />
    )

    expect(
      screen.getByText("brief.pdf").closest(".composer-context-row")
    ).toHaveClass("composer-context-row-with-files")
  })
})
