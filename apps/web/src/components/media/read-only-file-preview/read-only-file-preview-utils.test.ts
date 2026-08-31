import { describe, expect, it } from "vitest"

import {
  decodeFilePreviewText,
  getFilePreviewLanguageFilename,
} from "@/components/media/read-only-file-preview/read-only-file-preview-utils"

describe("read-only file preview utilities", () => {
  it("decodes UTF-8 content and marks a bounded preview as truncated", () => {
    const bytes = new TextEncoder().encode("hello LinkSense")

    expect(decodeFilePreviewText(bytes)).toEqual({
      text: "hello LinkSense",
      truncated: false,
    })
    expect(decodeFilePreviewText(bytes, 5)).toEqual({
      text: "hello",
      truncated: true,
    })
  })

  it("decodes UTF-16LE text with a byte-order mark", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x7d, 0x59])

    expect(decodeFilePreviewText(bytes)).toEqual({
      text: "你好",
      truncated: false,
    })
  })

  it("decodes UTF-16BE text with a byte-order mark", () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x4f, 0x60, 0x59, 0x7d])

    expect(decodeFilePreviewText(bytes)).toEqual({
      text: "你好",
      truncated: false,
    })
  })

  it("keeps a valid truncated UTF-8 preview when the boundary splits a character", () => {
    const bytes = new TextEncoder().encode("你好吗")

    expect(decodeFilePreviewText(bytes, 5)).toEqual({
      text: "你",
      truncated: true,
    })
  })

  it("rejects binary content by signature even when it contains no null byte", () => {
    const pdf = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37,
    ])

    expect(decodeFilePreviewText(pdf)).toBe(null)
    expect(decodeFilePreviewText(pdf, 2)).toBe(null)
    expect(
      decodeFilePreviewText(
        new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x31])
      )
    ).toBe(null)
  })

  it("rejects invalid UTF-8 and excessive non-text characters", () => {
    expect(decodeFilePreviewText(new Uint8Array([0xc3, 0x28]))).toBe(null)
    expect(
      decodeFilePreviewText(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x41]))
    ).toBe(null)
    expect(
      decodeFilePreviewText(new TextEncoder().encode("\ufffd".repeat(8)))
    ).toBe(null)
  })

  it("allows normal source whitespace", () => {
    expect(
      decodeFilePreviewText(
        new TextEncoder().encode("const answer = 42\n\t// source\r\n")
      )
    ).toEqual({
      text: "const answer = 42\n\t// source\r\n",
      truncated: false,
    })
  })

  it("normalizes special filenames for language lookup", () => {
    expect(getFilePreviewLanguageFilename("Dockerfile")).toBe("dockerfile")
    expect(getFilePreviewLanguageFilename(".env.local")).toBe("file.env")
    expect(getFilePreviewLanguageFilename("firecrawl-.env.example")).toBe(
      "file.env"
    )
    expect(getFilePreviewLanguageFilename("src/APP.TS")).toBe("app.ts")
  })
})
