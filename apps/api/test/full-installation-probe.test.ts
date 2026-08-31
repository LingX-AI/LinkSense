import { Readable } from "node:stream"

import { describe, expect, it, vi } from "vitest"

import { runFullInstallationProbe } from "../src/release/full-installation-probe.js"

describe("runFullInstallationProbe", () => {
  it("runs contract, RapidOCR, result, and Hybrid Chunker probes", async () => {
    const client = probeClient("LinkSense OPEN SOURCE 中文测试")

    await runFullInstallationProbe(client, "/models/tokenizer", 768)

    expect(client.verifyContract).toHaveBeenCalledOnce()
    expect(client.submitConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "linksense-rapidocr-zh-en.png",
        contentType: "image/png",
      }),
      { documentTimeoutSeconds: 180, ocrEnabled: true },
    )
    expect(client.waitForSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "conversion-probe" }),
    )
    expect(client.verifyHybridChunker).toHaveBeenCalledWith({
      tokenizer: "/models/tokenizer",
      maxTokens: 768,
    })
  })

  it("fails before Hybrid Chunker when OCR loses either language", async () => {
    const client = probeClient("LinkSense OPEN SOURCE")

    await expect(
      runFullInstallationProbe(client, "/models/tokenizer", 768),
    ).rejects.toThrow(/English and Chinese/u)
    expect(client.verifyHybridChunker).not.toHaveBeenCalled()
  })
})

function probeClient(projectedText: string) {
  return {
    verifyContract: vi.fn(async () => undefined),
    submitConversion: vi.fn(async (file: { openStream: () => Promise<Readable> }) => {
      const stream = await file.openStream()
      let bytes = 0
      for await (const chunk of stream) bytes += Buffer.byteLength(chunk)
      expect(bytes).toBeGreaterThan(1_000)
      return {
        task_id: "conversion-probe",
        task_type: "convert" as const,
        task_status: "started" as const,
      }
    }),
    waitForSuccess: vi.fn(async () => ({
      task_id: "conversion-probe",
      task_type: "convert" as const,
      task_status: "success" as const,
    })),
    getConversionResult: vi.fn(async () => ({
      kind: "direct" as const,
      result: {
        document: {
          filename: "linksense-rapidocr-zh-en.png",
          md_content: projectedText,
          json_content: { text: projectedText },
        },
        status: "success" as const,
        errors: [],
        processing_time: 1,
        timings: {},
      },
    })),
    verifyHybridChunker: vi.fn(async () => undefined),
  }
}
