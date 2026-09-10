import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { KnowledgeUploadDialog } from "@/features/knowledge-bases/knowledge-upload-dialog"
import {
  KnowledgeUploadBatchProgress,
  type KnowledgeUploadBatchStatus,
} from "@/features/knowledge-bases/knowledge-upload-batch-progress"
import i18n from "@/i18n"

const uploadKnowledgeDocument = vi.hoisted(() => vi.fn())
const getKnowledgeUploadLimits = vi.hoisted(() => vi.fn())

vi.mock(
  "@/features/knowledge-bases/knowledge-base-api",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/knowledge-bases/knowledge-base-api")
    >()),
    uploadKnowledgeDocument,
    getKnowledgeUploadLimits,
  })
)

const knowledgeBaseId = "00000000-0000-4000-8000-000000000001"
const documentId = "00000000-0000-4000-8000-000000000011"
const existingDocumentId = "00000000-0000-4000-8000-000000000012"
const versionId = "00000000-0000-4000-8000-000000000031"
const generationId = "00000000-0000-4000-8000-000000000021"

function documentFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: documentId,
    knowledge_base_id: knowledgeBaseId,
    display_name: "制度.pdf",
    canonical_extension: "pdf" as const,
    mime_type: "application/pdf",
    size_bytes: 7,
    status: "processing" as const,
    current_version_id: null,
    searchable: false,
    rebuild_required: false,
    processing: {
      operation: "upload" as const,
      processing_generation: generationId,
      stage: "parsing" as const,
      progress_percent: 40,
      revision: 2,
      stable_error_code: null,
      retry_at: null,
      retry_attempt: 0,
      cancellable: true,
    },
    candidate_failure: null,
    preview: {
      parsed: true as const,
      original_supported: true,
      renderer: "file" as const,
    },
    created_at: "2026-07-22T01:00:00.000Z",
    updated_at: "2026-07-22T01:01:00.000Z",
    ...overrides,
  }
}

const readyDocument = documentFixture({
  status: "ready",
  current_version_id: versionId,
  searchable: true,
  processing: null,
  updated_at: "2026-07-22T01:02:00.000Z",
})

function renderDialog(documents: ReturnType<typeof documentFixture>[] = []) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    knowledgeBaseId,
    documents,
    onUploaded: vi.fn(),
    onLocateDocument: vi.fn(),
  }
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeUploadDialog {...props} />
    </QueryClientProvider>
  )
  return {
    ...rendered,
    rerenderWithDocuments(nextDocuments: ReturnType<typeof documentFixture>[]) {
      rendered.rerender(
        <QueryClientProvider client={queryClient}>
          <KnowledgeUploadDialog {...props} documents={nextDocuments} />
        </QueryClientProvider>
      )
    },
  }
}

function renderUploadExperience() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  function UploadExperience() {
    const [open, setOpen] = useState(true)
    const [batchStatus, setBatchStatus] =
      useState<KnowledgeUploadBatchStatus | null>(null)
    return (
      <>
        {batchStatus && (
          <KnowledgeUploadBatchProgress
            status={batchStatus}
            onViewDetails={() => setOpen(true)}
          />
        )}
        <KnowledgeUploadDialog
          open={open}
          onOpenChange={setOpen}
          knowledgeBaseId={knowledgeBaseId}
          documents={[]}
          onUploaded={vi.fn()}
          onLocateDocument={vi.fn()}
          onBatchStatusChange={setBatchStatus}
        />
      </>
    )
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <UploadExperience />
    </QueryClientProvider>
  )
}

describe("knowledge document upload queue", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
    uploadKnowledgeDocument.mockReset()
    getKnowledgeUploadLimits.mockReset().mockResolvedValue({
      max_file_size_bytes: 200 * 1024 * 1024,
      max_files_per_batch: 7,
      storage_quota_bytes: 10 * 1024 * 1024 * 1024,
    })
  })

  afterEach(() => cleanup())

  it("uses the updated OCR guidance in both supported languages", () => {
    expect(i18n.t("knowledge.upload.ocrDescription", { lng: "zh-CN" })).toBe(
      "识别扫描件和图片中的文字，启用后会增加文档处理时间。"
    )
    expect(i18n.t("knowledge.upload.ocrDescription", { lng: "en-US" })).toBe(
      "Recognize text in scans and images. Enabling OCR increases document processing time."
    )
    expect(
      i18n.t("knowledge.upload.batch.runningTitle", { lng: "zh-CN" })
    ).toBe("正在上传和处理文档")
    expect(
      i18n.t("knowledge.upload.batch.runningTitle", { lng: "en-US" })
    ).toBe("Uploading and processing documents")
  })

  it("closes the upload dialog and exposes the overall batch progress after upload starts", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    renderUploadExperience()
    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())
    await interaction.upload(
      fileInput,
      new File(["content"], "制度.pdf", { type: "application/pdf" })
    )

    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )

    expect(
      screen.queryByRole("dialog", { name: "上传文档" })
    ).not.toBeInTheDocument()
    const batchProgress = await screen.findByRole("status")
    expect(
      within(batchProgress).getAllByText("正在上传和处理文档")[0]
    ).toBeVisible()
    expect(within(batchProgress).getByText("已处理 0 / 1 个文档")).toBeVisible()
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "正在上传和处理文档" })
      ).toHaveAttribute("aria-valuenow", "40")
    )

    await interaction.click(screen.getByRole("button", { name: "查看详情" }))
    expect(screen.getByRole("dialog", { name: "上传文档" })).toBeVisible()
    expect(screen.getByLabelText("选择文档")).toBeDisabled()
  })

  it("uploads a selected directory with relative paths and lists unsupported files", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    renderDialog()
    await waitFor(() => expect(screen.getByLabelText("选择文档")).toBeEnabled())
    await interaction.click(screen.getByRole("button", { name: "目录" }))
    const directoryInput = screen.getByLabelText("选择本地目录")
    expect(directoryInput).toHaveAttribute("webkitdirectory")
    const supported = new File(["content"], "制度.pdf", {
      type: "application/pdf",
    })
    const unsupported = new File(["binary"], "tool.exe", {
      type: "application/octet-stream",
    })
    Object.defineProperty(supported, "webkitRelativePath", {
      value: "政策库/人事/制度.pdf",
    })
    Object.defineProperty(unsupported, "webkitRelativePath", {
      value: "政策库/工具/tool.exe",
    })

    await interaction.upload(directoryInput, [supported, unsupported])

    expect(screen.getByText("政策库/人事/制度.pdf")).toBeVisible()
    expect(screen.getByText("政策库/工具/tool.exe")).toBeVisible()
    const skippedReason = screen.getByText("不支持此文件格式。")
    const skippedStatus = screen.getByText("已跳过").closest('[role="status"]')
    expect(skippedStatus).not.toBeNull()
    expect(skippedStatus?.parentElement).toContainElement(skippedReason)
    expect(skippedStatus?.nextElementSibling).toBe(skippedReason)
    expect(skippedReason).toHaveAttribute("role", "alert")
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )
    expect(uploadKnowledgeDocument).toHaveBeenCalledTimes(1)
    expect(uploadKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        file: supported,
        relativePath: "政策库/人事/制度.pdf",
        conflictResolution: "replace_path",
      })
    )
  })

  it("continues from the accepted response through REST or SSE document updates", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    const rendered = renderDialog()
    const file = new File(["content"], "制度.pdf", {
      type: "application/pdf",
    })

    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())
    const ocrSwitch = screen.getByRole("switch", { name: "启用 OCR" })
    expect(ocrSwitch).not.toBeChecked()
    expect(
      screen.getByText("识别扫描件和图片中的文字，启用后会增加文档处理时间。")
    ).toBeVisible()
    expect(
      screen.queryByText(
        "文件将逐个上传，最多同时上传 3 个；每个文件独立处理。"
      )
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/不承诺理解没有文字或标题的纯图表、流程图/u)
    ).not.toBeInTheDocument()
    await interaction.upload(fileInput, file)
    expect(ocrSwitch).toHaveAttribute("aria-disabled", "true")
    expect(ocrSwitch).toHaveAttribute("tabindex", "-1")
    expect(document.querySelector('[data-file-icon-kind="pdf"]')).toHaveClass(
      "size-6"
    )
    const waitingStatus = screen.getByText("等待上传")
    const waitingProgress = screen.getByRole("progressbar", {
      name: "制度.pdf",
    })
    const waitingProgressValue = screen.getByText("0%")
    const progressRow = waitingStatus.closest(
      ".knowledge-upload-item-progress-row"
    )
    const progressTrack = waitingProgress.querySelector(
      '[data-slot="progress-track"]'
    )
    expect(progressRow).toContainElement(waitingStatus)
    expect(progressRow).toContainElement(waitingProgress)
    expect(progressRow).toContainElement(waitingProgressValue)
    expect(
      waitingStatus.compareDocumentPosition(waitingProgress) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    if (!progressTrack) {
      throw new Error("Expected the inline progress track to be rendered")
    }
    expect(
      progressTrack.compareDocumentPosition(waitingProgressValue) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )

    expect(uploadKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({ ocrEnabled: false })
    )
    expect(await screen.findByText("正在解析")).toBeVisible()
    const parsingProgress = screen.getByRole("progressbar", {
      name: "制度.pdf",
    })
    expect(parsingProgress).toHaveAttribute("data-indeterminate")
    expect(parsingProgress).not.toHaveAttribute("aria-valuenow")
    expect(screen.queryByText("40%")).not.toBeInTheDocument()
    rendered.rerenderWithDocuments([readyDocument])
    expect(await screen.findByText("处理完成")).toBeVisible()
    expect(screen.getByText("100%")).toBeVisible()
  })

  it("captures an enabled OCR choice for every file in the upload batch", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    renderDialog()
    const fileInput = screen.getByLabelText("选择文档")
    const ocrSwitch = screen.getByRole("switch", { name: "启用 OCR" })
    await waitFor(() => expect(fileInput).toBeEnabled())

    await interaction.click(ocrSwitch)
    expect(ocrSwitch).toBeChecked()
    await interaction.upload(
      fileInput,
      new File(["content"], "制度.pdf", { type: "application/pdf" })
    )
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )

    expect(uploadKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({ ocrEnabled: true })
    )
  })

  it("recommends and enables OCR when the selected batch includes an image", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    renderDialog()
    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())

    await interaction.upload(
      fileInput,
      new File(["image"], "页面截图.JPEG", { type: "image/jpeg" })
    )

    expect(
      screen.getByText(
        "所选文件中包含图片，建议为本批次启用 OCR，以识别图片中的文字。"
      )
    ).toBeVisible()
    const ocrSwitch = screen.getByRole("switch", { name: "启用 OCR" })
    expect(ocrSwitch).not.toBeChecked()

    await interaction.click(
      screen.getByRole("button", { name: "为本批次启用 OCR" })
    )

    expect(ocrSwitch).toBeChecked()
    expect(
      screen.queryByText(
        "所选文件中包含图片，建议为本批次启用 OCR，以识别图片中的文字。"
      )
    ).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )
    expect(uploadKnowledgeDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ name: "页面截图.JPEG" }),
        ocrEnabled: true,
      })
    )
  })

  it("does not recommend OCR when the selected batch has no image files", async () => {
    const interaction = userEvent.setup()
    renderDialog()
    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())

    await interaction.upload(
      fileInput,
      new File(["content"], "制度.pdf", { type: "application/pdf" })
    )

    expect(
      screen.queryByRole("button", { name: "为本批次启用 OCR" })
    ).not.toBeInTheDocument()
  })

  it("shows the server-provided automatic retry attempt and retry time in the upload queue", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    const rendered = renderDialog()
    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())
    await interaction.upload(
      fileInput,
      new File(["content"], "制度.pdf", { type: "application/pdf" })
    )
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )

    rendered.rerenderWithDocuments([
      documentFixture({
        processing: {
          ...documentFixture().processing,
          retry_attempt: 1,
          retry_at: "2026-07-22T01:02:00.000Z",
        },
      }),
    ])
    expect(await screen.findByText(/第一次自动重试，将于.+继续/u)).toBeVisible()

    rendered.rerenderWithDocuments([
      documentFixture({
        processing: {
          ...documentFixture().processing,
          revision: 3,
          retry_attempt: 2,
          retry_at: "2026-07-22T01:03:00.000Z",
        },
      }),
    ])
    expect(await screen.findByText(/第二次自动重试，将于.+继续/u)).toBeVisible()
  })

  it("keeps a ready current version in processing while its replacement candidate is active", async () => {
    const replacingDocument = documentFixture({
      status: "ready",
      current_version_id: versionId,
      searchable: true,
      processing: {
        ...documentFixture().processing,
        operation: "replace",
      },
    })
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: replacingDocument,
    })
    const interaction = userEvent.setup()
    const rendered = renderDialog()

    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())
    await interaction.upload(
      fileInput,
      new File(["replacement"], "制度.pdf", { type: "application/pdf" })
    )
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )

    expect(await screen.findByText("正在解析")).toBeVisible()
    expect(screen.queryByText("处理完成")).not.toBeInTheDocument()
    expect(screen.queryByText("100%")).not.toBeInTheDocument()

    rendered.rerenderWithDocuments([readyDocument])
    expect(await screen.findByText("处理完成")).toBeVisible()
  })

  it("requires an explicit conflict decision and displays the server-confirmed name", async () => {
    const existingDocument = documentFixture({
      id: existingDocumentId,
      status: "ready",
      current_version_id: versionId,
      searchable: true,
      processing: null,
    })
    const renamedDocument = documentFixture({
      display_name: "制度 (1).pdf",
    })
    uploadKnowledgeDocument
      .mockResolvedValueOnce({
        status: "name_conflict",
        existing_document: existingDocument,
      })
      .mockResolvedValueOnce({
        status: "accepted",
        document: renamedDocument,
      })
    const interaction = userEvent.setup()
    renderDialog()
    const file = new File(["content"], "制度.pdf", {
      type: "application/pdf",
    })

    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())
    await interaction.upload(fileInput, file)
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )

    expect(
      await screen.findByRole("heading", { name: "处理文档名称冲突" })
    ).toBeVisible()
    expect(screen.getByText(/与已有文档“制度.pdf”同名/u)).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "两者都保留" }))

    await waitFor(() =>
      expect(uploadKnowledgeDocument).toHaveBeenCalledTimes(2)
    )
    expect(uploadKnowledgeDocument.mock.calls[1]?.[0]).toMatchObject({
      knowledgeBaseId,
      conflictResolution: "keep_both",
    })
    expect(uploadKnowledgeDocument.mock.calls[1]?.[0]).not.toHaveProperty(
      "replaceDocumentId"
    )
    expect(
      await screen.findByText("服务端确认名称：制度 (1).pdf")
    ).toBeVisible()
  })

  it("keeps the conflict-resolution request busy until its feedback is available", async () => {
    const existingDocument = documentFixture({
      id: existingDocumentId,
      status: "ready",
      current_version_id: versionId,
      searchable: true,
      processing: null,
    })
    let resolveReplacement:
      | ((value: {
          status: "accepted"
          document: typeof readyDocument
        }) => void)
      | undefined
    uploadKnowledgeDocument
      .mockResolvedValueOnce({
        status: "name_conflict",
        existing_document: existingDocument,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveReplacement = resolve
          })
      )
    const interaction = userEvent.setup()
    renderDialog()

    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())
    await interaction.upload(
      fileInput,
      new File(["replacement"], "制度.pdf", { type: "application/pdf" })
    )
    await interaction.click(
      screen.getByRole("button", { name: "开始上传（1）" })
    )
    await interaction.click(
      await screen.findByRole("button", { name: "替换已有文档" })
    )

    await waitFor(() =>
      expect(screen.getByLabelText("选择文档")).toBeDisabled()
    )
    expect(uploadKnowledgeDocument.mock.calls[1]?.[0]).toMatchObject({
      knowledgeBaseId,
      conflictResolution: "replace",
      replaceDocumentId: existingDocumentId,
    })
    expect(
      screen.getByText("正在上传").closest('[role="status"]')
    ).toHaveTextContent("正在上传")

    resolveReplacement?.({ status: "accepted", document: readyDocument })
    expect(await screen.findByText("处理完成")).toBeVisible()
    expect(screen.getByLabelText("选择文档")).toBeEnabled()
  })

  it("uses the deployment batch limit instead of assuming 100 files", async () => {
    getKnowledgeUploadLimits.mockResolvedValue({
      max_file_size_bytes: 5 * 1024 * 1024,
      max_files_per_batch: 2,
      storage_quota_bytes: 50 * 1024 * 1024,
    })
    const interaction = userEvent.setup()
    renderDialog()
    const fileInput = screen.getByLabelText("选择文档")
    await waitFor(() => expect(fileInput).toBeEnabled())

    await interaction.upload(fileInput, [
      new File(["a"], "a.pdf", { type: "application/pdf" }),
      new File(["b"], "b.pdf", { type: "application/pdf" }),
      new File(["c"], "c.pdf", { type: "application/pdf" }),
    ])

    expect(screen.getByText("单次最多选择 2 个文件。")).toBeVisible()
    expect(screen.queryByText("上传队列")).not.toBeInTheDocument()
    expect(getKnowledgeUploadLimits).toHaveBeenCalledOnce()
  })
})
