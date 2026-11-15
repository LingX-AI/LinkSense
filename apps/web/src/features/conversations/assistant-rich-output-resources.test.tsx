import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { conversationSchema, type ConversationFile } from "@/api/contracts"
import i18n, { supportedLanguages } from "@/i18n"
import { createIntersectionObserverMock } from "@/test/intersection-observer"
import AssistantRichOutput from "./assistant-rich-output"
import type { LoadArtifactPreview } from "./assistant-markdown-image"
import {
  ConversationContentPolicyProvider,
  ConversationThread,
} from "./conversation-thread"
import { RichOutputResourceProvider } from "./rich-output-resource-provider"
import { richOutputMessages } from "./rich-output-messages"

const image: ConversationFile = {
  id: "30000000-0000-4000-8000-0000000000ab",
  name: "private-landscape.png",
  kind: "artifact",
  turn_id: "turn-1",
  download_available: true,
  mime_type: "image/png",
  size: 2_048,
}
const report: ConversationFile = {
  ...image,
  id: "30000000-0000-4000-8000-0000000000ac",
  name: "private-report.docx",
  mime_type:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
const archive: ConversationFile = {
  ...image,
  id: "30000000-0000-4000-8000-0000000000ad",
  name: "private-results.zip",
  mime_type: "application/zip",
}
const fileMap = new Map([image, report, archive].map((file) => [file.id, file]))
const output = {
  version: 1,
  summary: "Delivered a design and analysis",
  spec: {
    root: "panel",
    elements: {
      panel: {
        type: "Panel",
        props: { title: "Deliverables" },
        children: ["gallery", "files"],
      },
      gallery: {
        type: "MediaGallery",
        props: {
          title: "Designs",
          items: [
            {
              fileId: image.id.toUpperCase(),
              alt: "Mountain landscape",
              caption: "Candidate A",
            },
          ],
        },
      },
      files: {
        type: "ResourceList",
        props: {
          title: "Reports",
          items: [
            {
              fileId: report.id,
              label: "Final analysis",
              detail: "Verified result",
            },
            { fileId: archive.id, label: "Supporting data" },
          ],
        },
      },
    },
  },
}
const source = JSON.stringify(output)
const markdown = `The work is ready.\n\n\`\`\`json-render\n${source}\n\`\`\``
let loadPreview = vi.fn<LoadArtifactPreview>()
const onDownload = vi.fn()
const originalDecode = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "decode"
)

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
  vi.clearAllMocks()
  loadPreview = vi.fn<LoadArtifactPreview>().mockResolvedValue({
    url: "https://files.example.test/authorized-image.png",
    expiresAt: "2999-01-01T00:00:00.000Z",
  })
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  vi.stubGlobal(
    "IntersectionObserver",
    createIntersectionObserverMock(true).Observer
  )
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalDecode)
    Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode)
  else Reflect.deleteProperty(HTMLImageElement.prototype, "decode")
})

describe("rich resource output", () => {
  it("uses authorized metadata and existing preview/download handlers for files", async () => {
    const user = userEvent.setup()
    const onPreviewFile = vi.fn()
    render(
      <RichOutputResourceProvider
        filesById={fileMap}
        loadPreview={loadPreview}
        onDownload={onDownload}
        onPreviewFile={onPreviewFile}
      >
        <AssistantRichOutput source={source} />
      </RichOutputResourceProvider>
    )
    const files = await screen.findByRole("region", { name: "Reports" })
    await user.click(
      within(files).getByRole("button", {
        name: /Preview.*private-report.docx/i,
      })
    )
    expect(onPreviewFile).toHaveBeenCalledWith(report)
    await user.click(
      within(files).getByRole("button", {
        name: /Download.*private-results.zip/i,
      })
    )
    expect(onDownload).toHaveBeenCalledWith(archive)
    expect(within(files).getByText("Verified result")).toBeVisible()
  })

  it("lazy-loads thumbnails and opens the existing image dialog from the keyboard", async () => {
    const visibility = createIntersectionObserverMock()
    vi.stubGlobal("IntersectionObserver", visibility.Observer)
    const user = userEvent.setup()
    const view = render(
      <RichOutputResourceProvider
        filesById={fileMap}
        loadPreview={loadPreview}
        onDownload={onDownload}
      >
        <AssistantRichOutput source={source} />
      </RichOutputResourceProvider>
    )
    await screen.findByRole("region", { name: "Designs" })
    expect(loadPreview).not.toHaveBeenCalled()
    const surface = view.container.querySelector(
      '[data-slot="assistant-image-surface"]'
    )
    if (!surface) throw new Error("Missing gallery thumbnail")
    await act(async () => visibility.intersect(surface))
    const preview = await screen.findByRole("button", {
      name: "Preview image Mountain landscape",
    })
    await waitFor(() => expect(preview).toBeEnabled())
    expect(loadPreview).toHaveBeenCalledWith(image, expect.any(AbortSignal))
    expect(
      screen.getByRole("img", { name: "Mountain landscape" })
    ).toHaveAttribute("loading", "lazy")
    preview.focus()
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("dialog")).toBeVisible()
    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() => expect(preview).toHaveFocus())
    await user.click(
      screen.getByRole("button", { name: "Download private-landscape.png" })
    )
    expect(onDownload).toHaveBeenCalledWith(image)
  })

  it.each([
    ["missing", undefined],
    ["not downloadable", { ...image, download_available: false }],
    ["attachment", { ...image, kind: "attachment" as const }],
    ["private preview", { ...image, kind: "image_preview" as const }],
    [
      "unsupported image",
      { ...image, mime_type: "image/gif", name: "private.gif" },
    ],
  ])("does not load or expose a %s resource", async (_reason, file) => {
    render(
      <RichOutputResourceProvider
        filesById={file ? new Map([[image.id, file]]) : new Map()}
        loadPreview={loadPreview}
        onDownload={onDownload}
      >
        <AssistantRichOutput source={source} />
      </RichOutputResourceProvider>
    )
    const gallery = await screen.findByRole("region", { name: "Designs" })
    expect(
      within(gallery).getByText(richOutputMessages["en-US"].resourceUnavailable)
    ).toBeVisible()
    expect(within(gallery).queryByRole("button")).not.toBeInTheDocument()
    expect(loadPreview).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain("private-")
    expect(onDownload).not.toHaveBeenCalled()
  })

  it("keeps download access when image preview authorization fails", async () => {
    loadPreview.mockRejectedValue(new Error("forbidden"))
    const user = userEvent.setup()
    render(
      <RichOutputResourceProvider
        filesById={fileMap}
        loadPreview={loadPreview}
        onDownload={onDownload}
      >
        <AssistantRichOutput source={source} />
      </RichOutputResourceProvider>
    )
    expect(
      await screen.findByText(
        i18n.t("conversation.previewLoadFailed", { name: "Mountain landscape" })
      )
    ).toBeVisible()
    expect(
      screen.queryByRole("img", { name: "Mountain landscape" })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Download private-landscape.png" })
    )
    expect(onDownload).toHaveBeenCalledWith(image)
  })

  it("updates an already mounted output when files arrive or availability is revoked", async () => {
    const view = (filesById: ReadonlyMap<string, ConversationFile>) => (
      <RichOutputResourceProvider
        filesById={filesById}
        loadPreview={loadPreview}
        onDownload={onDownload}
      >
        <AssistantRichOutput source={source} />
      </RichOutputResourceProvider>
    )
    const { rerender } = render(view(new Map()))
    await screen.findByRole("region", { name: "Designs" })
    expect(loadPreview).not.toHaveBeenCalled()
    rerender(view(fileMap))
    expect(
      await screen.findByRole("button", {
        name: "Download private-landscape.png",
      })
    ).toBeEnabled()
    rerender(view(new Map()))
    expect(
      screen.queryByRole("button", { name: "Download private-landscape.png" })
    ).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain("private-")
  })

  it.each(supportedLanguages)(
    "keeps text-only sharing descriptive and resource-free in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      render(
        <RichOutputResourceProvider
          filesById={fileMap}
          loadPreview={loadPreview}
          onDownload={onDownload}
        >
          <ConversationContentPolicyProvider richOutputTextOnly>
            <ConversationThread
              conversation={conversationSchema.parse({
                id: "conversation-1",
                title: "Files",
                project_id: null,
                updated_at: "2026-11-15T00:00:00Z",
                messages: [
                  {
                    id: "answer",
                    role: "assistant",
                    content: markdown,
                    created_at: "2026-11-15T00:00:00Z",
                  },
                ],
              })}
              onDownload={onDownload}
            />
          </ConversationContentPolicyProvider>
        </RichOutputResourceProvider>,
        { wrapper: MemoryRouter }
      )
      expect(screen.getByText(/Mountain landscape/u)).toBeVisible()
      expect(document.body.textContent).toContain("Verified result")
      expect(document.body.textContent).not.toMatch(
        /private-|30000000-|authorized-image/u
      )
      expect(loadPreview).not.toHaveBeenCalled()
    }
  )

  it("removes duplicate automatic cards only while rich resource cards are mounted", async () => {
    const conversation = conversationSchema.parse({
      id: "conversation-1",
      title: "Files",
      project_id: null,
      updated_at: "2026-11-15T00:00:00Z",
      files: [image, report, archive],
      turns: [{ id: "turn-1", status: "completed" }],
      messages: [
        {
          id: "answer",
          role: "assistant",
          turn_id: "turn-1",
          phase: "final_answer",
          content: markdown,
          created_at: "2026-11-15T00:00:00Z",
        },
      ],
    })
    const view = (content: string) => (
      <ConversationThread
        conversation={{
          ...conversation,
          messages: conversation.messages?.map((message) => ({
            ...message,
            content,
          })),
        }}
        loadArtifactPreview={loadPreview}
        onDownload={onDownload}
      />
    )
    const { rerender } = render(view(markdown), { wrapper: MemoryRouter })
    await screen.findByTestId("assistant-rich-output")
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Download private-results.zip" })
      ).toHaveLength(1)
    )
    rerender(view("Finished."))
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "Download private-results.zip" })
      ).toHaveLength(1)
    )
    expect(
      screen.queryByTestId("assistant-rich-output")
    ).not.toBeInTheDocument()
    expect(screen.getByText("private-results.zip")).toBeVisible()
  })
})
