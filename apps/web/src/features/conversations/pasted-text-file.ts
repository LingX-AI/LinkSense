export const PASTED_TEXT_ATTACHMENT_CHARACTER_THRESHOLD = 2_000
export const PASTED_TEXT_ATTACHMENT_LINE_THRESHOLD = 40

const lineBreakPattern = /\r\n|[\n\r\u2028\u2029]/u
const defaultFilenamePrefix = "pasted-text"

export type CreatePastedTextAttachmentOptions = {
  /** Use a fixed product-level prefix; pasted content must never be used here. */
  filenamePrefix?: string
  now?: Date | (() => Date)
}

export type PastedTextAttachment = {
  file: File
  characterCount: number
  lineCount: number
}

/** Counts Unicode code points so a surrogate-pair emoji is counted once. */
export function countPastedTextCharacters(text: string): number {
  return Array.from(text).length
}

export function countPastedTextLines(text: string): number {
  return text.split(lineBreakPattern).length
}

export function shouldConvertPastedTextToAttachment(text: string): boolean {
  if (!text.trim()) return false

  return (
    countPastedTextCharacters(text) >=
      PASTED_TEXT_ATTACHMENT_CHARACTER_THRESHOLD ||
    countPastedTextLines(text) >= PASTED_TEXT_ATTACHMENT_LINE_THRESHOLD
  )
}

function getSafeFilenamePrefix(filenamePrefix: string | undefined): string {
  const normalizedPrefix = filenamePrefix
    ?.trim()
    .normalize("NFC")
    .replace(/\s*[\\/:*?"<>|\p{Cc}]+\s*/gu, "-")
    .replace(/^-+|-+$/gu, "")

  return (
    Array.from(normalizedPrefix ?? "")
      .slice(0, 120)
      .join("") || defaultFilenamePrefix
  )
}

function getCurrentDate(now: CreatePastedTextAttachmentOptions["now"]): Date {
  const createdAt = typeof now === "function" ? now() : (now ?? new Date())
  const timestamp = createdAt.getTime()
  if (Number.isNaN(timestamp)) {
    throw new RangeError("now must resolve to a valid Date")
  }

  return createdAt
}

export function formatPastedTextAttachmentFileName(
  now: Date,
  filenamePrefix?: string
): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("now must be a valid Date")
  }

  return `${getSafeFilenamePrefix(filenamePrefix)}-${now
    .toISOString()
    .replace(/\D/gu, "")}.txt`
}

export function createPastedTextAttachment(
  text: string,
  { filenamePrefix, now }: CreatePastedTextAttachmentOptions = {}
): PastedTextAttachment {
  const createdAt = getCurrentDate(now)
  const characterCount = countPastedTextCharacters(text)
  const lineCount = countPastedTextLines(text)

  return {
    file: new File(
      [text],
      formatPastedTextAttachmentFileName(createdAt, filenamePrefix),
      {
        type: "text/plain",
        lastModified: createdAt.getTime(),
      }
    ),
    characterCount,
    lineCount,
  }
}
