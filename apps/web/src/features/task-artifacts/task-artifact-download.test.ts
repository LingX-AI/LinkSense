import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  downloadApiFile: vi.fn(),
  downloadBlob: vi.fn(),
}))

vi.mock("@/api/client", () => ({ downloadApiFile: mocks.downloadApiFile }))
vi.mock("@/lib/download-blob", () => ({
  downloadBlob: mocks.downloadBlob,
}))

import type { TaskArtifact } from "./task-artifact-api"

const artifact: TaskArtifact = {
  id: "30000000-0000-4000-8000-000000000001",
  conversation_id: "20000000-0000-4000-8000-000000000001",
  turn_id: null,
  kind: "artifact",
  source: "agent_generated",
  status: "registered",
  filename: "report.txt",
  mime_type: "text/plain",
  size_bytes: 18,
  storage_backend: "minio",
  downloadable: true,
  created_at: "2026-07-11T08:00:00Z",
  updated_at: "2026-07-11T08:00:00Z",
  task: {
    id: "20000000-0000-4000-8000-000000000001",
    title: "Task",
    archive_status: "active",
  },
  name: "report.txt",
  size: 18,
  download_available: true,
}

async function loadHelper() {
  vi.resetModules()
  const download = await import("./task-artifact-download")
  return download
}

describe("task artifact download", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.downloadApiFile.mockResolvedValue(new Blob(["authenticated bytes"]))
  })

  it("saves a downloaded artifact through the blob pipeline", async () => {
    const { downloadTaskArtifact } = await loadHelper()
    await downloadTaskArtifact(artifact)

    expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "report.txt")
  })

  it("loads preview bytes and saves them through the blob pipeline", async () => {
    const { loadTaskArtifactContent, saveTaskArtifactBlob } = await loadHelper()
    const content = await loadTaskArtifactContent(artifact)

    await saveTaskArtifactBlob(
      new Blob([new Uint8Array(content)]),
      "browser-preview.txt"
    )
    expect(mocks.downloadApiFile).toHaveBeenCalledOnce()
    expect(mocks.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "browser-preview.txt"
    )
  })
})
