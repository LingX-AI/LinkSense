import { useRef } from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { OfficeSelectionPrompt } from "@/components/media/office-preview/office-selection-prompt"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import i18n, { supportedLanguages } from "@/i18n"

const voiceInput = vi.hoisted(() => ({
  phase: "idle" as
    "idle" | "starting" | "recording" | "stopping" | "transcribing",
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  setWaveformTrackWidth: vi.fn(),
  onTranscriptPreview: null as ((transcript: string) => void) | null,
  onTranscript: null as ((transcript: string) => void) | null,
  onError: null as ((failure: unknown) => void) | null,
}))

vi.mock("@/features/conversations/use-voice-transcription", () => ({
  useVoiceTranscription: (options: {
    onTranscriptPreview: (transcript: string) => void
    onTranscript: (transcript: string) => void
    onError: (failure: unknown) => void
  }) => {
    voiceInput.onTranscriptPreview = options.onTranscriptPreview
    voiceInput.onTranscript = options.onTranscript
    voiceInput.onError = options.onError
    return {
      phase: voiceInput.phase,
      elapsedSeconds: 0,
      waveform: [],
      setWaveformTrackWidth: voiceInput.setWaveformTrackWidth,
      startRecording: voiceInput.startRecording,
      stopRecording: voiceInput.stopRecording,
    }
  },
}))

function PromptFixture({
  anchor = { left: 200, top: 100 },
  disabled = false,
  fileName = "selection.docx",
  fullScreen = false,
  mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  onSubmit = vi.fn().mockResolvedValue(undefined),
  voiceTranscriptionAvailability = "available",
  promptLabel = "Describe the requested change",
}: Readonly<{
  anchor?: Readonly<{ left: number; top: number }>
  disabled?: boolean
  fileName?: string
  fullScreen?: boolean
  mimeType?: string
  onSubmit?: (selection: { id: string }, description: string) => Promise<void>
  voiceTranscriptionAvailability?:
    "checking" | "available" | "not_configured" | "unavailable"
  promptLabel?: string
}>) {
  const scopeRef = useRef<HTMLElement>(null)
  const prompt = (
    <OfficeSelectionPrompt
      scopeRef={scopeRef}
      selection={{ id: "selection-1" }}
      anchor={anchor}
      voiceTranscriptionAvailability={voiceTranscriptionAvailability}
      action={{
        label: "Ask LinkSense",
        shortcutLabel: "⌘I",
        disabled,
        disabledReason: "Wait for the current task to finish.",
        promptLabel,
        placeholder: "Change the selection",
        submitLabel: "Send",
        errorMessage: "Unable to send",
        onSubmit,
      }}
    />
  )

  if (fullScreen) {
    return (
      <OfficePreviewShell
        ref={scopeRef}
        document={{ status: "ready", content: new Uint8Array([1]) }}
        fileName={fileName}
        mimeType={mimeType}
        onClose={vi.fn()}
      >
        {prompt}
      </OfficePreviewShell>
    )
  }

  return (
    <section ref={scopeRef} style={{ position: "relative" }}>
      {prompt}
    </section>
  )
}

describe("OfficeSelectionPrompt", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    voiceInput.phase = "idle"
    voiceInput.startRecording.mockReset()
    voiceInput.stopRecording.mockReset()
    voiceInput.setWaveformTrackWidth.mockReset()
    voiceInput.onTranscriptPreview = null
    voiceInput.onTranscript = null
    voiceInput.onError = null
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(supportedLanguages)(
    "shows a visible required selection description label in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const promptLabel = i18n.t("officePreview.selectionPromptLabel", {
        productName: "LinkSense",
      })
      const user = userEvent.setup()
      render(<PromptFixture promptLabel={promptLabel} />)
      await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))
      const input = screen.getByRole("textbox", { name: promptLabel })
      const label = document.querySelector(`label[for="${input.id}"]`)
      expect(label).toBeVisible()
      expect(label).not.toHaveClass("sr-only")
      const indicator = label?.querySelector(
        "span.text-destructive[aria-hidden='true']"
      )
      expect(indicator).toBeVisible()
      expect(indicator).toHaveTextContent("*")
      expect(input).toHaveAttribute("aria-required", "true")
      expect(input).not.toHaveAttribute("required")
      const send = screen.getByRole("button", { name: "Send" })
      expect(send).toBeDisabled()
      await user.type(input, "Update the selection")
      expect(send).toBeEnabled()
      expect(indicator).toBeVisible()
    }
  )

  it("submits the reusable selection payload and trimmed request", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<PromptFixture onSubmit={onSubmit} />)

    await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))
    await user.type(
      screen.getByRole("textbox", { name: "Describe the requested change" }),
      "  Make it yellow  "
    )
    const submitButton = screen.getByRole("button", { name: "Send" })
    expect(submitButton.querySelector(".lucide-list-plus")).not.toBeNull()
    expect(submitButton.querySelector(".lucide-arrow-up")).toBeNull()
    await user.click(submitButton)

    expect(onSubmit).toHaveBeenCalledWith(
      { id: "selection-1" },
      "Make it yellow"
    )
  })

  it("closes immediately while submission admission continues in the background", async () => {
    let resolveSubmission: (() => void) | undefined
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmission = resolve
        })
    )
    const user = userEvent.setup()
    render(<PromptFixture onSubmit={onSubmit} />)

    await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))
    await user.type(
      screen.getByRole("textbox", { name: "Describe the requested change" }),
      "Send without waiting"
    )
    await user.click(screen.getByRole("button", { name: "Send" }))

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole("textbox", {
        name: "Describe the requested change",
      })
    ).not.toBeInTheDocument()

    act(() => resolveSubmission?.())
  })

  it("layers its prompt over the selection frame and provides inline voice input", async () => {
    const user = userEvent.setup()
    render(<PromptFixture />)

    await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))

    const input = screen.getByRole("textbox", {
      name: "Describe the requested change",
    })
    expect(
      document.querySelector(".office-selection-prompt-positioner")
    ).toContainElement(input)

    const send = screen.getByRole("button", { name: "Send" })
    expect(send).toHaveClass("send-button")
    expect(send.querySelector(".lucide-list-plus")).toHaveClass("size-3.5")
    expect(send.querySelector(".lucide-check")).not.toBeInTheDocument()

    const voiceButton = screen.getByRole("button", { name: "语音输入" })
    expect(voiceButton.querySelector(".lucide-mic")).toHaveClass("size-4")
    expect(document.querySelector(".lucide-languages")).not.toBeInTheDocument()
    expect(input).toBeInstanceOf(HTMLTextAreaElement)
    expect(input).toHaveClass(
      "font-medium",
      "leading-6",
      "max-h-[7.5rem]",
      "overflow-y-auto"
    )
    expect(input.parentElement).toHaveClass(
      "bg-transparent",
      "has-[[data-slot=input-group-control]:focus-visible]:bg-transparent"
    )
    expect(screen.getByTestId("office-selection-prompt-actions")).toHaveClass(
      "top-1/2",
      "-translate-y-1/2"
    )

    await user.click(voiceButton)
    expect(voiceInput.startRecording).toHaveBeenCalledOnce()

    act(() => voiceInput.onTranscriptPreview?.("  将标题改为中文  "))
    expect(input).toHaveValue("将标题改为中文")
  })

  it("disables the inline microphone and explains when speech to text is not configured", async () => {
    const user = userEvent.setup()
    render(<PromptFixture voiceTranscriptionAvailability="not_configured" />)

    await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))
    const voiceButton = screen.getByRole("button", { name: "语音输入" })
    expect(voiceButton).toBeDisabled()
    expect(voiceButton).toHaveClass("opacity-50")

    await user.hover(voiceButton.parentElement!)
    expect(
      await screen.findByRole("tooltip", {
        name: "语音转文字服务尚未配置",
      })
    ).toBeVisible()
    expect(voiceInput.startRecording).not.toHaveBeenCalled()
  })

  it("expands to a maximum of three text lines and moves actions to the lower-right", async () => {
    const user = userEvent.setup()
    render(<PromptFixture />)

    await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))

    const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: "Describe the requested change",
    })
    let scrollHeight = 64
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    })

    await user.type(input, "第一行{Shift>}{Enter}{/Shift}第二行")
    expect(input).toHaveValue("第一行\n第二行")

    const actions = screen.getByTestId("office-selection-prompt-actions")
    await waitFor(() => {
      expect(actions).toHaveClass("bottom-1")
      expect(actions).not.toHaveClass("top-1/2", "-translate-y-1/2")
    })
    expect(input).toHaveClass("pb-10", "max-h-[7.5rem]", "overflow-y-auto")

    scrollHeight = 24
    await user.clear(input)

    await waitFor(() => {
      expect(actions).toHaveClass("top-1/2", "-translate-y-1/2")
      expect(actions).not.toHaveClass("bottom-1")
    })
  })

  it("shows a stop control while voice input is recording", async () => {
    const user = userEvent.setup()
    voiceInput.phase = "recording"
    render(<PromptFixture />)

    await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))

    const stop = screen.getByRole("button", { name: "停止语音输入" })
    expect(stop.querySelector(".lucide-square")).toHaveClass("size-3.5")
    await user.click(stop)
    expect(voiceInput.stopRecording).toHaveBeenCalledOnce()
  })

  it("keeps the action visible but disabled with an accessible reason", () => {
    render(<PromptFixture disabled />)

    const action = screen.getByRole("button", { name: /Ask LinkSense/u })
    expect(action).toHaveClass("h-7", "px-3", "text-sm")
    expect(action).toBeDisabled()
    expect(action).toHaveAccessibleDescription(
      "Wait for the current task to finish."
    )
  })

  it.each([
    [
      "below the selection's right edge",
      { left: 720, top: 360 },
      "translate(326px, 318px)",
    ],
    [
      "inside the preview's left edge",
      { left: 254, top: 160 },
      "translate(8px, 118px)",
    ],
    [
      "inside the preview's bottom-right edge",
      { left: 1050, top: 650 },
      "translate(648px, 564px)",
    ],
  ])(
    "positions the action %s using viewport coordinates",
    async (_name, anchor, transform) => {
      vi.spyOn(
        HTMLElement.prototype,
        "getBoundingClientRect"
      ).mockImplementation(function (this: HTMLElement) {
        if (this.tagName === "SECTION") return new DOMRect(250, 50, 800, 600)
        if (this.classList.contains("office-selection-action"))
          return new DOMRect(0, 0, 144, 28)
        return new DOMRect(0, 0, 1280, 960)
      })
      for (const [property, dimension] of [
        ["offsetWidth", "width"],
        ["clientWidth", "width"],
        ["offsetHeight", "height"],
        ["clientHeight", "height"],
      ] as const) {
        vi.spyOn(HTMLElement.prototype, property, "get").mockImplementation(
          function (this: HTMLElement) {
            return this.getBoundingClientRect()[dimension]
          }
        )
      }
      vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
        function (this: HTMLElement) {
          return this.classList.contains("office-selection-action")
            ? this.closest("section")
            : null
        }
      )
      render(<PromptFixture anchor={anchor} />)

      const action = screen.getByRole("button", { name: /Ask LinkSense/u })
      await waitFor(() => expect(action.style.transform).toBe(transform))
    }
  )

  it.each([
    [
      "PowerPoint",
      "selection.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    [
      "Excel",
      "selection.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    [
      "Word",
      "selection.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ])(
    "keeps the %s prompt inside its full-screen preview stacking context",
    async (_documentKind, fileName, mimeType) => {
      const user = userEvent.setup()
      render(
        <PromptFixture fileName={fileName} fullScreen mimeType={mimeType} />
      )

      await user.click(screen.getByRole("button", { name: "全屏预览文档" }))
      await user.click(screen.getByRole("button", { name: /Ask LinkSense/u }))

      expect(
        document.querySelector(".office-preview-pane-expanded")
      ).toContainElement(
        screen.getByRole("textbox", {
          name: "Describe the requested change",
        })
      )
    }
  )
})
