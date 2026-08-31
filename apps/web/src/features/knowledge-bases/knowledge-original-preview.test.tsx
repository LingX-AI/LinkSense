import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { FileViewerProps } from "@file-viewer/react"

import { knowledgeDocumentSchema } from "@/features/knowledge-bases/knowledge-base-contracts"
import { KNOWLEDGE_FILE_VIEWER_THEME_ATTRIBUTE } from "@/features/knowledge-bases/knowledge-file-viewer-theme"
import {
  KnowledgeCitationOriginalPreview,
  KnowledgeDownloadButton,
  KnowledgeOriginalPreview,
} from "@/features/knowledge-bases/knowledge-original-preview"
import i18n from "@/i18n"

const downloadKnowledgeDocument = vi.hoisted(() => vi.fn())
const loadKnowledgeCitationOriginal = vi.hoisted(() => vi.fn())
const loadKnowledgeDocumentPreview = vi.hoisted(() => vi.fn())
const previewProps = vi.hoisted(() => vi.fn<(props: FileViewerProps) => void>())

vi.mock(
  "@/features/knowledge-bases/knowledge-base-api",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/knowledge-bases/knowledge-base-api")
    >()),
    downloadKnowledgeDocument,
    loadKnowledgeCitationOriginal,
    loadKnowledgeDocumentPreview,
  })
)

vi.mock("@/app/theme-state", () => ({
  useTheme: () => ({ theme: "light" }),
}))

vi.mock("virtual:file-viewer-renderers", () => ({
  configuredFileViewerRenderers: [],
}))

vi.mock("@file-viewer/react", async () => {
  const React = await import("react")
  return {
    default: React.forwardRef<Record<string, unknown>, FileViewerProps>(
      (props, ref) => {
        const containerRef = React.useRef<HTMLDivElement | null>(null)
        const { onStateChange } = props
        previewProps(props)
        React.useImperativeHandle(
          ref,
          () => ({
            getController: () =>
              containerRef.current ? { container: containerRef.current } : null,
          }),
          []
        )
        React.useEffect(() => {
          onStateChange?.({
            loading: false,
            ready: true,
            error: null,
            lastEvent: null,
            lifecycle: null,
            availability: null,
            search: null,
            zoom: null,
            location: null,
            viewState: null,
          })
        }, [onStateChange])
        return (
          <div
            ref={(node) => {
              containerRef.current = node
              if (node && !node.shadowRoot) {
                node.attachShadow({ mode: "open" })
              }
            }}
            aria-label={props["aria-label"]}
          >
            {props.filename}
          </div>
        )
      }
    ),
  }
})

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000011"

function documentFixture() {
  return knowledgeDocumentSchema.parse({
    id: documentId,
    knowledge_base_id: knowledgeBaseId,
    display_name: "policy.docx",
    canonical_extension: "docx",
    mime_type:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size_bytes: 4_096,
    status: "ready",
    current_version_id: "00000000-0000-4000-8000-000000000031",
    searchable: true,
    rebuild_required: false,
    processing: null,
    candidate_failure: null,
    preview: {
      parsed: true,
      original_supported: true,
      renderer: "file",
    },
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
  })
}

describe("knowledge original file preview", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    previewProps.mockReset()
    downloadKnowledgeDocument.mockReset()
    loadKnowledgeCitationOriginal.mockReset()
    loadKnowledgeDocumentPreview.mockReset()
  })

  afterEach(cleanup)

  it("shows only the document skeleton while fetching the original", () => {
    loadKnowledgeDocumentPreview.mockReturnValue(new Promise<Blob>(() => {}))

    render(
      <KnowledgeOriginalPreview
        knowledgeBaseId={knowledgeBaseId}
        document={documentFixture()}
      />
    )

    const loadingLabel = i18n.t("knowledge.preview.loadingOriginal")
    const loadingStatus = screen.getByRole("status")
    expect(loadingStatus).toHaveClass("knowledge-file-viewer-loading")
    expect(loadingStatus).toHaveTextContent(loadingLabel)
    expect(loadingStatus).toHaveTextContent("policy.docx")
    expect(
      loadingStatus.querySelector(".knowledge-file-viewer-loading-stage")
    ).toBeInTheDocument()
    expect(
      loadingStatus.querySelector(".knowledge-file-viewer-loading-status")
    ).not.toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })

  it("lets Flyfish detect the extension from the authenticated file name", async () => {
    loadKnowledgeDocumentPreview.mockResolvedValue(
      new Blob(["docx"], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    )

    render(
      <KnowledgeOriginalPreview
        knowledgeBaseId={knowledgeBaseId}
        document={documentFixture()}
      />
    )

    const viewer = await screen.findByLabelText("预览文档 policy.docx")
    expect(viewer).toBeVisible()
    expect(loadKnowledgeDocumentPreview).toHaveBeenCalledWith(
      knowledgeBaseId,
      documentId,
      undefined,
      expect.any(AbortSignal)
    )
    const props = previewProps.mock.lastCall?.[0]
    expect(props).toBeDefined()
    const previewFile = props?.file
    expect(previewFile).toBeInstanceOf(File)
    if (!(previewFile instanceof File)) {
      throw new Error("Expected the Flyfish preview source to be a File")
    }
    expect(previewFile.name).toBe("policy.docx")
    expect(previewFile.type).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    expect(props?.type).toBeUndefined()
    expect(props?.options).toMatchObject({
      autoRenderers: false,
      locale: "zh-CN",
      preset: ["lite", "office"],
      rendererMode: "replace",
      styleIsolation: "shadow",
      theme: "light",
      ui: {
        density: "compact",
        surfaceBackground: "var(--office-viewer-canvas)",
      },
      toolbar: {
        download: false,
        exportHtml: false,
        permissions: {
          download: false,
          "export-html": false,
          print: false,
        },
      },
    })
    await waitFor(() =>
      expect(
        viewer.shadowRoot?.querySelector(
          `style[${KNOWLEDGE_FILE_VIEWER_THEME_ATTRIBUTE}]`
        )
      ).not.toBeNull()
    )
  })

  it("uses the same knowledge-only viewer for exact citation originals", async () => {
    loadKnowledgeCitationOriginal.mockResolvedValue(
      new Blob(["tiff"], { type: "image/tiff" })
    )

    render(
      <KnowledgeCitationOriginalPreview
        citationId="00000000-0000-4000-8000-000000000099"
        renderer="file"
        documentName="scan.tiff"
      />
    )

    expect(await screen.findByLabelText("预览文档 scan.tiff")).toBeVisible()
    expect(loadKnowledgeCitationOriginal).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000099",
      expect.any(AbortSignal)
    )
    expect(previewProps.mock.lastCall?.[0].filename).toBe("scan.tiff")
  })

  it("offers a manual retry when the authenticated preview request fails", async () => {
    const user = userEvent.setup()
    loadKnowledgeDocumentPreview
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce(new Blob(["docx"]))

    render(
      <KnowledgeOriginalPreview
        knowledgeBaseId={knowledgeBaseId}
        document={documentFixture()}
      />
    )

    await user.click(await screen.findByRole("button", { name: "重试" }))
    expect(await screen.findByLabelText("预览文档 policy.docx")).toBeVisible()
    expect(loadKnowledgeDocumentPreview).toHaveBeenCalledTimes(2)
  })

  it("reports a localized error when an original download fails", async () => {
    const user = userEvent.setup()
    const onDownloadErrorChange = vi.fn()
    downloadKnowledgeDocument.mockRejectedValue(new Error("network failed"))

    render(
      <KnowledgeDownloadButton
        knowledgeBaseId={knowledgeBaseId}
        document={documentFixture()}
        onDownloadErrorChange={onDownloadErrorChange}
      />
    )

    await user.click(screen.getByRole("button", { name: "下载原文件" }))

    await waitFor(() =>
      expect(onDownloadErrorChange).toHaveBeenLastCalledWith(
        i18n.t("errors.unknown")
      )
    )
    expect(onDownloadErrorChange).toHaveBeenNthCalledWith(1, null)
    expect(screen.getByRole("button", { name: "下载原文件" })).toBeEnabled()
  })
})
