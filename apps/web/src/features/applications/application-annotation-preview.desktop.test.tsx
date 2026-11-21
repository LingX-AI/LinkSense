import { createRef, useState } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applicationDevelopmentSchema } from "@linksense/shared"
import i18n from "@/i18n"
import {
  htmlPreviewSelectionMessageType,
  type HtmlPreviewSelectionMessage,
} from "@/components/media/html-preview/html-preview-selection"
import { ApplicationAnnotationPreview } from "./application-annotation-preview"

const native = vi.hoisted(() => ({
  install: vi.fn(),
  runtime: {
    cleanup: vi.fn(),
    setMode: vi.fn(),
    setMarkers: vi.fn(),
    clearSelection: vi.fn(),
    focus: vi.fn(),
    confirmPage: vi.fn(),
  },
}))
const direct = vi.hoisted(() => vi.fn())

vi.mock("./application-annotation-native-runtime", () => ({
  installApplicationAnnotationNativeRuntime: native.install,
}))
vi.mock("./application-annotation-runtime", () => ({
  installApplicationAnnotationRuntime: direct,
}))
vi.mock("@/adapters/desktop/desktop-adapter", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/adapters/desktop/desktop-adapter")
  >()),
  isMacDesktopHost: () => true,
  getDesktopServerUrl: () => "https://example.test",
}))
vi.mock(
  "@/features/conversations/use-voice-transcription-availability",
  () => ({ useVoiceTranscriptionAvailability: () => "not_configured" })
)

const ticket = "a".repeat(43)
const source = `https://example.test/api/v1/interactive-app-runtime/${ticket}/index.html`
const project = applicationDevelopmentSchema.parse({
  id: "20000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000002",
  name: "调研",
  directory: "apps/research",
  application_id: null,
  preview_application_id: "20000000-0000-4000-8000-000000000003",
  preview_conversation_id: "20000000-0000-4000-8000-000000000004",
  preview_current: true,
  revision: 2,
  source_hash: "a".repeat(64),
  installed_source_hash: null,
  source_error: null,
  manifest: null,
  diagnostics: [],
  updated_at: "2026-09-18T00:00:00Z",
})
const packageId = "20000000-0000-4000-8000-000000000005"
const pageChangedText =
  "The page has changed. Clear the annotations and exit annotation mode, then select again after the preview updates."

function selectionMessage(): HtmlPreviewSelectionMessage {
  return {
    type: htmlPreviewSelectionMessageType,
    selection: {
      elements: [
        {
          selector: "#submit",
          domPath: [0],
          tagName: "button",
          classNames: [],
          attributes: {},
          text: "Submit",
          bounds: { x: 20, y: 30, width: 100, height: 40 },
        },
      ],
    },
    anchor: { right: 120, top: 30, bottom: 70 },
  }
}

function show() {
  const frameRef = createRef<HTMLIFrameElement>()
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  function Host() {
    const [controlsContainer, setControlsContainer] =
      useState<HTMLDivElement | null>(null)
    return (
      <main>
        <div ref={setControlsContainer} />
        <ApplicationAnnotationPreview
          source={source}
          title="Preview"
          packageId={packageId}
          frameRef={frameRef}
          options={{
            project,
            onSubmit,
            onActiveChange: vi.fn(),
            controlsContainer,
          }}
          onLoad={vi.fn()}
        />
      </main>
    )
  }
  render(<Host />)
  fireEvent.load(screen.getByTitle("Preview"))
  return { frameRef, onSubmit }
}

function nativeHandlers() {
  const call = vi.mocked(native.install).mock.calls[0]
  if (!call) throw new Error("missing native runtime")
  return call[3]
}

async function addDraft() {
  await userEvent.click(await screen.findByRole("button", { name: "Annotate" }))
  act(() => nativeHandlers().onMessage(selectionMessage()))
  await userEvent.click(
    await screen.findByRole("button", { name: /Ask LinkSense/u })
  )
  await userEvent.type(
    screen.getByRole("textbox", { name: /Ask LinkSense about/u }),
    "Make the button clearer"
  )
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Add annotation",
    })
  )
}

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
  native.runtime.confirmPage.mockResolvedValue("index.html")
  native.install.mockImplementation((_frame, _source, _options, handlers) => {
    handlers.onReady("index.html")
    return native.runtime
  })
})

afterEach(async () => {
  cleanup()
  vi.clearAllMocks()
  await i18n.changeLanguage("en-US")
})

describe("desktop application annotation preview", () => {
  it("uses the native bridge for the Mac packaged API origin", async () => {
    const { frameRef } = show()
    expect(native.install).toHaveBeenCalledWith(
      frameRef.current,
      source,
      {
        frameOrigin: "https://example.test",
        parentOrigin: window.location.origin,
      },
      expect.objectContaining({
        onReady: expect.any(Function),
        onError: expect.any(Function),
        onMessage: expect.any(Function),
      })
    )
    expect(direct).not.toHaveBeenCalled()
    const button = await screen.findByRole("button", { name: "Annotate" })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(native.runtime.setMode).toHaveBeenCalledWith(true)
  })

  it("keeps the native runtime and the pending annotation across language updates", async () => {
    show()
    await addDraft()
    expect(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    ).toBeVisible()

    await act(() => i18n.changeLanguage("zh-CN"))

    expect(native.install).toHaveBeenCalledOnce()
    expect(native.runtime.cleanup).not.toHaveBeenCalled()
    expect(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole("button", { name: "查看 1 条待发送标注" })
    )
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "发送" })
    ).toBeEnabled()
  })

  it("keeps drafts but disables submit when the runtime reports another page", async () => {
    show()
    await addDraft()
    act(() => nativeHandlers().onReady("details.html"))

    expect(await screen.findByText(pageChangedText)).toBeVisible()
    expect(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    ).toBeVisible()
    await userEvent.click(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    )
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Send" })
    ).toBeDisabled()
    expect(native.runtime.setMode).toHaveBeenLastCalledWith(false)
  })

  it("keeps a pending draft across a same-document page change and its return", async () => {
    show()
    await addDraft()
    await userEvent.click(
      screen.getByRole("button", { name: "Exit annotation" })
    )
    expect(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    ).toBeVisible()

    // The child reports the route change over its port. No focus, selection,
    // reload, or cleanup is involved.
    act(() => nativeHandlers().onLocation("details.html"))
    expect(await screen.findByText(pageChangedText)).toBeVisible()
    expect(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    ).toBeVisible()
    expect(native.install).toHaveBeenCalledOnce()
    expect(native.runtime.cleanup).not.toHaveBeenCalled()
    expect(native.runtime.setMode).toHaveBeenLastCalledWith(false)
    await userEvent.click(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    )
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Send" })
    ).toBeDisabled()

    act(() => nativeHandlers().onLocation("index.html"))
    await waitFor(() =>
      expect(screen.queryByText(pageChangedText)).not.toBeInTheDocument()
    )
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Send" })
    ).toBeEnabled()
  })

  it("disables Locate while the draft page is unavailable and accepts a send after the History return", async () => {
    const { onSubmit } = show()
    await addDraft()
    await userEvent.click(
      screen.getByRole("button", { name: "Exit annotation" })
    )
    act(() => nativeHandlers().onLocation("details.html"))
    expect(await screen.findByText(pageChangedText)).toBeVisible()

    await userEvent.click(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    )
    const dialog = screen.getByRole("dialog")
    const locate = within(dialog).getByRole("button", {
      name: "Go to annotation 1",
    })
    expect(locate).toBeDisabled()
    expect(
      within(dialog).getByRole("button", { name: "Remove annotation 1" })
    ).toBeEnabled()
    expect(
      within(dialog).getByRole("button", { name: "Clear" })
    ).toBeEnabled()

    act(() => nativeHandlers().onLocation("index.html"))
    await waitFor(() => expect(locate).toBeEnabled())
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Send" })
    )

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    const submitted = onSubmit.mock.calls[0]?.[0] as {
      annotation: { page_path: string; annotations: { request: string }[] }
    }
    expect(submitted.annotation.page_path).toBe("index.html")
    expect(submitted.annotation.annotations).toHaveLength(1)
    expect(submitted.annotation.annotations[0]?.request).toBe(
      "Make the button clearer"
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /pending annotations/u })
      ).not.toBeInTheDocument()
    )
  })

  it("rejects a send when the child confirms another live page", async () => {
    const { onSubmit } = show()
    await addDraft()
    await userEvent.click(
      screen.getByRole("button", { name: "Exit annotation" })
    )
    native.runtime.confirmPage.mockImplementationOnce(async () => {
      // The real runtime reports the response route before resolving.
      act(() => nativeHandlers().onLocation("details.html"))
      return "details.html"
    })

    await userEvent.click(
      screen.getByRole("button", { name: "View 1 pending annotations" })
    )
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Send" })
    )

    expect(await screen.findByText(pageChangedText)).toBeVisible()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(native.runtime.confirmPage).toHaveBeenCalledOnce()
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Send" })
    ).toBeDisabled()
  })
})
