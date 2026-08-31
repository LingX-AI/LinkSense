import { describe, expect, it } from "vitest"

import {
  PASTED_TEXT_ATTACHMENT_CHARACTER_THRESHOLD,
  PASTED_TEXT_ATTACHMENT_LINE_THRESHOLD,
  countPastedTextCharacters,
  countPastedTextLines,
  createPastedTextAttachment,
  formatPastedTextAttachmentFileName,
  shouldConvertPastedTextToAttachment,
} from "@/features/conversations/pasted-text-file"

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => reject(reader.error))
    reader.addEventListener("load", () => resolve(String(reader.result)))
    reader.readAsText(file, "utf-8")
  })
}

describe("pasted text file utilities", () => {
  it("counts Unicode code points instead of UTF-16 code units", () => {
    expect(countPastedTextCharacters("中文😀")).toBe(3)
    expect(
      shouldConvertPastedTextToAttachment(
        "😀".repeat(PASTED_TEXT_ATTACHMENT_CHARACTER_THRESHOLD - 1)
      )
    ).toBe(false)
    expect(
      shouldConvertPastedTextToAttachment(
        "😀".repeat(PASTED_TEXT_ATTACHMENT_CHARACTER_THRESHOLD)
      )
    ).toBe(true)
  })

  it("converts at the character threshold but not below it", () => {
    expect(
      shouldConvertPastedTextToAttachment(
        "a".repeat(PASTED_TEXT_ATTACHMENT_CHARACTER_THRESHOLD - 1)
      )
    ).toBe(false)
    expect(
      shouldConvertPastedTextToAttachment(
        "a".repeat(PASTED_TEXT_ATTACHMENT_CHARACTER_THRESHOLD)
      )
    ).toBe(true)
  })

  it("converts at the line threshold and supports CRLF line breaks", () => {
    const underThreshold = Array.from(
      { length: PASTED_TEXT_ATTACHMENT_LINE_THRESHOLD - 1 },
      () => "x"
    ).join("\r\n")
    const atThreshold = `${underThreshold}\r\nx`

    expect(countPastedTextLines(underThreshold)).toBe(
      PASTED_TEXT_ATTACHMENT_LINE_THRESHOLD - 1
    )
    expect(countPastedTextLines(atThreshold)).toBe(
      PASTED_TEXT_ATTACHMENT_LINE_THRESHOLD
    )
    expect(shouldConvertPastedTextToAttachment(underThreshold)).toBe(false)
    expect(shouldConvertPastedTextToAttachment(atThreshold)).toBe(true)
  })

  it("does not convert whitespace-only text regardless of its line count", () => {
    expect(shouldConvertPastedTextToAttachment(" \t\n\u3000")).toBe(false)
    expect(
      shouldConvertPastedTextToAttachment(
        Array.from(
          { length: PASTED_TEXT_ATTACHMENT_LINE_THRESHOLD },
          () => " "
        ).join("\n")
      )
    ).toBe(false)
  })

  it("creates a UTF-8 plain-text file with a safe, content-independent name", async () => {
    const createdAt = new Date("2026-07-17T04:12:23.456Z")
    const content = "请分析以下日志：😀\n秘密内容"
    const { file, characterCount, lineCount } = createPastedTextAttachment(
      content,
      { now: () => createdAt }
    )

    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe("pasted-text-20260717041223456.txt")
    expect(file.name).not.toContain("秘密内容")
    expect(file.type).toBe("text/plain")
    expect(file.lastModified).toBe(createdAt.getTime())
    expect(characterCount).toBe(countPastedTextCharacters(content))
    expect(lineCount).toBe(2)
    await expect(readFileAsText(file)).resolves.toBe(content)
  })

  it("sanitizes custom filename prefixes and rejects invalid timestamps", () => {
    expect(
      formatPastedTextAttachmentFileName(
        new Date("2026-07-17T04:12:23.456Z"),
        " 日志 / 输出 "
      )
    ).toBe("日志-输出-20260717041223456.txt")
    expect(() =>
      formatPastedTextAttachmentFileName(new Date("invalid"))
    ).toThrow(RangeError)
  })
})
