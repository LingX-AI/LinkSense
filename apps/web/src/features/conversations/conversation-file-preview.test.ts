import { describe, expect, it } from "vitest"

import {
  getConversationFilePreviewKind,
  getConversationFilePreviewLoadMode,
  isConversationFileSelectionEnabled,
  isPreviewableConversationFile,
} from "@/features/conversations/conversation-file-preview"

describe("conversation file preview registry", () => {
  it.each([
    ["slides.pptx", null, "presentation"],
    ["brief.docx", null, "word"],
    ["budget.xlsx", null, "spreadsheet"],
    ["landing.html", null, "html"],
    ["bundle.zip", null, "archive"],
    ["report.pdf", "application/pdf", "pdf"],
    ["server.ts", "text/plain", "code"],
    ["compose.yml", "application/yaml", "code"],
    ["Dockerfile", null, "code"],
    ["pnpm-lock.yaml", null, "code"],
    ["events.jsonl", null, "code"],
    ["firecrawl-.env.example", null, "text"],
    [".env.local", null, "text"],
    [".gitignore", null, "text"],
    ["LICENSE", null, "text"],
    ["templates/page.fragment", null, "text"],
    ["notes.txt", "text/plain", "text"],
    ["readme.md", "text/markdown", "markdown"],
    ["records.csv", "text/csv", "csv"],
    ["records.tsv", "text/tab-separated-values", "csv"],
    ["cover.png", "image/png", "image"],
    ["mark.svg", "image/svg+xml", "image"],
    ["mark.svg", null, "image"],
    ["voice.mp3", "audio/mpeg", "audio"],
    ["voice.wav", "audio/x-wav", "audio"],
    ["meeting.weba", "audio/webm", "audio"],
    ["demo.mp4", "video/mp4", "video"],
    ["clip.mkv", "video/x-matroska", "video"],
    ["recording.3gp", "video/3gpp", "video"],
    ["bundle.zip", "application/x-zip-compressed", "archive"],
    ["archive.7z", "application/x-7z-compressed", "archive"],
    ["bundle.rar", "application/x-rar-compressed", "archive"],
    ["logs.tar.gz", "application/gzip", "archive"],
  ] as const)("detects %s as %s", (name, mimeType, expected) => {
    expect(getConversationFilePreviewKind({ name, mime_type: mimeType })).toBe(
      expected
    )
  })

  it("does not offer formats outside the API preview allowlist", () => {
    expect(
      getConversationFilePreviewKind({
        name: "script.bin",
        mime_type: "application/javascript",
      })
    ).toBeNull()
    expect(
      getConversationFilePreviewKind({
        name: "voice.bin",
        mime_type: "audio/midi",
      })
    ).toBeNull()
  })

  it("routes only media and raster images through a short-lived source URL", () => {
    expect(getConversationFilePreviewLoadMode("image")).toBe("source")
    expect(getConversationFilePreviewLoadMode("audio")).toBe("source")
    expect(getConversationFilePreviewLoadMode("video")).toBe("source")
    expect(getConversationFilePreviewLoadMode("pdf")).toBe("content")
    expect(getConversationFilePreviewLoadMode("code")).toBe("content")
  })

  it("keeps selection disabled for all generic preview formats", () => {
    expect(isConversationFileSelectionEnabled("presentation")).toBe(true)
    expect(isConversationFileSelectionEnabled("html")).toBe(true)
    expect(isConversationFileSelectionEnabled("pdf")).toBe(false)
    expect(isConversationFileSelectionEnabled("csv")).toBe(false)
    expect(isConversationFileSelectionEnabled("audio")).toBe(false)
  })

  it("does not claim unsupported binary formats are previewable", () => {
    expect(
      isPreviewableConversationFile({
        name: "archive.bin",
        mime_type: "application/octet-stream",
      })
    ).toBe(false)
    expect(
      isPreviewableConversationFile({
        name: "font.woff2",
        mime_type: "text/plain",
      })
    ).toBe(false)
  })
})
