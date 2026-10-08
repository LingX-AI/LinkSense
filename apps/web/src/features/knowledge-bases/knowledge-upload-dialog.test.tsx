import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Link, MemoryRouter, Route, Routes, useParams } from "react-router-dom"

import { KnowledgeUploadDialog } from "@/features/knowledge-bases/knowledge-upload-dialog"
import { KnowledgeUploadBatchProgress } from "@/features/knowledge-bases/knowledge-upload-batch-progress"
import { useKnowledgeUploadBatchStatus } from "@/features/knowledge-bases/knowledge-upload-session"
import { KnowledgeUploadSessionProvider } from "@/features/knowledge-bases/knowledge-upload-session-provider"
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
      <KnowledgeUploadSessionProvider>
        <KnowledgeUploadDialog {...props} />
      </KnowledgeUploadSessionProvider>
    </QueryClientProvider>
  )
  return {
    ...rendered,
    rerenderWithDocuments(nextDocuments: ReturnType<typeof documentFixture>[]) {
      rendered.rerender(
        <QueryClientProvider client={queryClient}>
          <KnowledgeUploadSessionProvider>
            <KnowledgeUploadDialog {...props} documents={nextDocuments} />
          </KnowledgeUploadSessionProvider>
        </QueryClientProvider>
      )
    },
  }
}

function renderUploadExperience() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  const onUploaded = vi.fn()
  function UploadExperience({
    documents,
  }: {
    documents: ReturnType<typeof documentFixture>[]
  }) {
    const { knowledgeBaseId: currentKnowledgeBaseId = knowledgeBaseId } =
      useParams()
    const [open, setOpen] = useState(false)
    const batchStatus = useKnowledgeUploadBatchStatus(currentKnowledgeBaseId)
    return (
      <>
        <Link to="/knowledge-bases">返回知识库列表</Link>
        <button onClick={() => setOpen(true)}>上传文档</button>
        {batchStatus && (
          <KnowledgeUploadBatchProgress
            status={batchStatus}
            onViewDetails={() => setOpen(true)}
          />
        )}
        <KnowledgeUploadDialog
          open={open}
          onOpenChange={setOpen}
          knowledgeBaseId={currentKnowledgeBaseId}
          documents={documents}
          onUploaded={onUploaded}
          onLocateDocument={vi.fn()}
        />
      </>
    )
  }

  const view = (
    documents: ReturnType<typeof documentFixture>[],
    accountId = "owner"
  ) => (
    <QueryClientProvider client={queryClient}>
      <KnowledgeUploadSessionProvider key={accountId}>
        <MemoryRouter initialEntries={[`/knowledge-bases/${knowledgeBaseId}`]}>
          <Routes>
            <Route
              path="/knowledge-bases/:knowledgeBaseId"
              element={<UploadExperience documents={documents} />}
            />
            <Route
              path="/knowledge-bases"
              element={
                <>
                  <Link to={`/knowledge-bases/${knowledgeBaseId}`}>
                    重新进入知识库
                  </Link>
                  <Link to="/knowledge-bases/00000000-0000-4000-8000-000000000099">
                    进入其他知识库
                  </Link>
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </KnowledgeUploadSessionProvider>
    </QueryClientProvider>
  )
  const rendered = render(view([]))
  return {
    ...rendered,
    onUploaded,
    rerenderWithDocuments(documents: ReturnType<typeof documentFixture>[]) {
      rendered.rerender(view(documents))
    },
    switchAccount(accountId: string) {
      rendered.rerender(view([], accountId))
    },
  }
}

async function startUploadExperience(
  interaction: ReturnType<typeof userEvent.setup>,
  fileCount = 1
) {
  await interaction.click(screen.getByRole("button", { name: "上传文档" }))
  const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
  await waitFor(() => expect(fileInput).toBeEnabled())
  await interaction.upload(
    fileInput,
    Array.from(
      { length: fileCount },
      (_, index) =>
        new File(["content"], index === 0 ? "制度.pdf" : `制度 ${index}.pdf`, {
          type: "application/pdf",
        })
    )
  )
  await interaction.click(
    screen.getByRole("button", { name: `开始上传（${fileCount}）` })
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
    await interaction.click(screen.getByRole("button", { name: "上传文档" }))
    expect(
      document.querySelector(
        "label[for='knowledge-upload-files'] span.text-destructive[aria-hidden='true']"
      )
    ).toHaveTextContent("*")
    expect(
      document.querySelector(
        "label[for='knowledge-upload-ocr'] span.text-destructive"
      )
    ).not.toBeInTheDocument()
    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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
    expect(screen.getByLabelText(/^选择文档\s*\*?$/)).toBeDisabled()
  })

  it("restores an in-flight upload and its details after returning from the knowledge-base list", async () => {
    let finishUpload: (result: {
      status: string
      document: ReturnType<typeof documentFixture>
    }) => void = () => undefined
    uploadKnowledgeDocument.mockImplementation(
      ({ onProgress }: { onProgress: (progress: number) => void }) => {
        onProgress(4)
        return new Promise((resolve) => {
          finishUpload = resolve
        })
      }
    )
    const interaction = userEvent.setup()
    renderUploadExperience()
    await startUploadExperience(interaction)

    const progress = () =>
      screen.getByRole("progressbar", { name: "正在上传和处理文档" })
    await waitFor(() =>
      expect(progress()).toHaveAttribute("aria-valuenow", "4")
    )
    await interaction.click(
      screen.getByRole("link", { name: "返回知识库列表" })
    )
    await interaction.click(
      screen.getByRole("link", { name: "重新进入知识库" })
    )

    expect(progress()).toHaveAttribute("aria-valuenow", "4")
    await interaction.click(screen.getByRole("button", { name: "查看详情" }))
    const dialog = screen.getByRole("dialog", { name: "上传文档" })
    expect(
      within(dialog).getByText("制度.pdf", { selector: ".truncate" })
    ).toBeVisible()
    expect(within(dialog).getByText("正在上传")).toBeVisible()
    expect(within(dialog).getByLabelText(/^选择文档\s*\*?$/)).toBeDisabled()
    await interaction.keyboard("{Escape}")
    await act(async () => {
      finishUpload({ status: "accepted", document: documentFixture() })
    })
    await waitFor(() =>
      expect(progress()).toHaveAttribute("aria-valuenow", "40")
    )
    expect(uploadKnowledgeDocument).toHaveBeenCalledOnce()
  })

  it("restores parsing progress, synchronizes document updates, and keeps knowledge-base batches separate", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    const rendered = renderUploadExperience()
    await startUploadExperience(interaction)
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "正在上传和处理文档" })
      ).toHaveAttribute("aria-valuenow", "40")
    )
    await interaction.click(
      screen.getByRole("link", { name: "返回知识库列表" })
    )
    await interaction.click(
      screen.getByRole("link", { name: "进入其他知识库" })
    )
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    await interaction.click(
      screen.getByRole("link", { name: "返回知识库列表" })
    )
    rendered.rerenderWithDocuments([
      documentFixture({
        processing: {
          ...documentFixture().processing,
          stage: "parenting",
          progress_percent: 70,
          revision: 3,
        },
      }),
    ])
    await interaction.click(
      screen.getByRole("link", { name: "重新进入知识库" })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "正在上传和处理文档" })
      ).toHaveAttribute("aria-valuenow", "70")
    )
    expect(screen.getByText("已处理 0 / 1 个文档")).toBeVisible()
    await interaction.click(screen.getByRole("button", { name: "查看详情" }))
    const dialog = screen.getByRole("dialog", { name: "上传文档" })
    expect(
      within(dialog).getByText("制度.pdf", { selector: ".truncate" })
    ).toBeVisible()
    expect(within(dialog).getByText("正在构建父切片")).toBeVisible()
    await interaction.keyboard("{Escape}")

    rendered.rerenderWithDocuments([readyDocument])
    await waitFor(() =>
      expect(screen.getByText("已处理 1 / 1 个文档")).toBeVisible()
    )
    expect(
      screen.getByRole("progressbar", { name: "本批文档处理已结束" })
    ).toHaveAttribute("aria-valuenow", "100")
    expect(uploadKnowledgeDocument).toHaveBeenCalledOnce()
  })

  it("continues waiting uploads while the detail page is unmounted without replaying completed uploads", async () => {
    const pendingUploads: Array<() => void> = []
    uploadKnowledgeDocument.mockImplementation(
      ({
        file,
        onProgress,
      }: {
        file: File
        onProgress: (progress: number) => void
      }) => {
        onProgress(4)
        return new Promise((resolve) => {
          pendingUploads.push(() =>
            resolve({
              status: "accepted",
              document: documentFixture({ display_name: file.name }),
            })
          )
        })
      }
    )
    const interaction = userEvent.setup()
    renderUploadExperience()
    await startUploadExperience(interaction, 4)
    expect(uploadKnowledgeDocument).toHaveBeenCalledTimes(3)
    await interaction.click(
      screen.getByRole("link", { name: "返回知识库列表" })
    )

    await act(async () => {
      for (const finishUpload of pendingUploads.slice(0, 3)) finishUpload()
    })
    expect(uploadKnowledgeDocument).toHaveBeenCalledTimes(4)
    await interaction.click(
      screen.getByRole("link", { name: "重新进入知识库" })
    )
    expect(
      screen.getByRole("progressbar", { name: "正在上传和处理文档" })
    ).toHaveAttribute("aria-valuenow", "31")
    await act(async () => pendingUploads[3]?.())
    await waitFor(() =>
      expect(
        screen.getByRole("progressbar", { name: "正在上传和处理文档" })
      ).toHaveAttribute("aria-valuenow", "40")
    )
    expect(uploadKnowledgeDocument).toHaveBeenCalledTimes(4)
  })

  it("clears the previous account's batch and ignores late upload results after the account changes", async () => {
    let finishUpload: () => void = () => undefined
    let uploadSignal: AbortSignal | undefined
    uploadKnowledgeDocument.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        uploadSignal = signal
        return new Promise((resolve) => {
          finishUpload = () =>
            resolve({ status: "accepted", document: documentFixture() })
        })
      }
    )
    const interaction = userEvent.setup()
    const rendered = renderUploadExperience()
    await startUploadExperience(interaction)

    rendered.switchAccount("another-account")
    expect(uploadSignal?.aborted).toBe(true)
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    await act(async () => finishUpload())
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(rendered.onUploaded).not.toHaveBeenCalled()
  })

  it("cancels outstanding requests and stops waiting uploads when the upload session is disposed", async () => {
    const signals: AbortSignal[] = []
    uploadKnowledgeDocument.mockImplementation(
      ({ signal }: { signal: AbortSignal }) => {
        signals.push(signal)
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Cancelled", "AbortError"))
          )
        })
      }
    )
    const interaction = userEvent.setup()
    const rendered = renderUploadExperience()
    await startUploadExperience(interaction, 4)
    expect(uploadKnowledgeDocument).toHaveBeenCalledTimes(3)

    await act(async () => rendered.unmount())

    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(uploadKnowledgeDocument).toHaveBeenCalledTimes(3)
  })

  it("uploads a selected directory with relative paths and lists unsupported files", async () => {
    uploadKnowledgeDocument.mockResolvedValue({
      status: "accepted",
      document: documentFixture(),
    })
    const interaction = userEvent.setup()
    renderDialog()
    await waitFor(() =>
      expect(screen.getByLabelText(/^选择文档\s*\*?$/)).toBeEnabled()
    )
    await interaction.click(screen.getByRole("button", { name: "目录" }))
    const directoryInput = screen.getByLabelText(/^选择本地目录\s*\*?$/)
    expect(
      document.querySelector(
        "label[for='knowledge-upload-files'] span.text-destructive[aria-hidden='true']"
      )
    ).toHaveTextContent("*")
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

    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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
    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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
    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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
    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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
    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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

    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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

    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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

    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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
      expect(screen.getByLabelText(/^选择文档\s*\*?$/)).toBeDisabled()
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
    expect(screen.getByLabelText(/^选择文档\s*\*?$/)).toBeEnabled()
  })

  it("uses the deployment batch limit instead of assuming 100 files", async () => {
    getKnowledgeUploadLimits.mockResolvedValue({
      max_file_size_bytes: 5 * 1024 * 1024,
      max_files_per_batch: 2,
      storage_quota_bytes: 50 * 1024 * 1024,
    })
    const interaction = userEvent.setup()
    renderDialog()
    const fileInput = screen.getByLabelText(/^选择文档\s*\*?$/)
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
