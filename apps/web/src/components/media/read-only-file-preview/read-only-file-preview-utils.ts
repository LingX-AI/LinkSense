const DEFAULT_MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const TEXT_INSPECTION_SAMPLE_BYTES = 8_192
const MAX_CONTROL_CHARACTER_RATIO = 0.05
const MAX_REPLACEMENT_CHARACTER_RATIO = 0.02

type TextEncoding = "utf-8" | "utf-16le" | "utf-16be"

export type DecodedFilePreviewText = Readonly<{
  text: string
  truncated: boolean
}>

function startsWithByteOrderMark(bytes: Uint8Array, mark: readonly number[]) {
  return mark.every((value, index) => bytes[index] === value)
}

function startsWithBytes(
  bytes: Uint8Array,
  prefix: readonly number[],
  offset = 0
) {
  return prefix.every((value, index) => bytes[offset + index] === value)
}

function hasNullByte(bytes: Uint8Array) {
  const sampleLength = Math.min(bytes.byteLength, TEXT_INSPECTION_SAMPLE_BYTES)
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) return true
  }
  return false
}

const binaryMagicNumbers = [
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  [0xff, 0xd8, 0xff], // JPEG
  [0x47, 0x49, 0x46, 0x38], // GIF
  [0x25, 0x50, 0x44, 0x46, 0x2d], // PDF
  [0x50, 0x4b, 0x03, 0x04], // ZIP
  [0x50, 0x4b, 0x05, 0x06], // Empty ZIP
  [0x50, 0x4b, 0x07, 0x08], // Spanned ZIP
  [0x1f, 0x8b], // GZIP
  [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], // 7z
  [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07], // RAR
  [0x42, 0x5a, 0x68], // BZIP2
  [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], // XZ
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x4d, 0x5a], // PE executable
  [0xca, 0xfe, 0xba, 0xbe], // Java class
  [0x66, 0x4c, 0x61, 0x43], // FLAC
  [0x4f, 0x67, 0x67, 0x53], // Ogg
  [0x49, 0x44, 0x33], // MP3 with ID3 metadata
  [0x77, 0x4f, 0x46, 0x46], // WOFF
  [0x77, 0x4f, 0x46, 0x32], // WOFF2
] as const

function hasBinaryMagicNumber(bytes: Uint8Array) {
  const sample = bytes.slice(0, TEXT_INSPECTION_SAMPLE_BYTES)
  if (binaryMagicNumbers.some((magic) => startsWithBytes(sample, magic))) {
    return true
  }

  const isRiffContainer = startsWithBytes(sample, [0x52, 0x49, 0x46, 0x46])
  const isKnownRiffPayload = [
    [0x57, 0x45, 0x42, 0x50], // WEBP
    [0x57, 0x41, 0x56, 0x45], // WAVE
    [0x41, 0x56, 0x49, 0x20], // AVI
  ].some((magic) => startsWithBytes(sample, magic, 8))
  if (isRiffContainer && isKnownRiffPayload) return true

  return startsWithBytes(sample, [0x66, 0x74, 0x79, 0x70], 4) // ISO media
}

function getTextEncoding(bytes: Uint8Array): TextEncoding {
  if (startsWithByteOrderMark(bytes, [0xff, 0xfe])) return "utf-16le"
  if (startsWithByteOrderMark(bytes, [0xfe, 0xff])) return "utf-16be"
  return "utf-8"
}

function stripByteOrderMark(bytes: Uint8Array, encoding: TextEncoding) {
  if (
    encoding === "utf-8" &&
    startsWithByteOrderMark(bytes, [0xef, 0xbb, 0xbf])
  ) {
    return bytes.slice(3)
  }
  return encoding === "utf-8" ? bytes : bytes.slice(2)
}

function isAllowedControlCharacter(character: string) {
  return (
    character === "\t" ||
    character === "\n" ||
    character === "\v" ||
    character === "\f" ||
    character === "\r"
  )
}

function hasExcessiveNonTextCharacters(text: string) {
  let inspectedCharacters = 0
  let controlCharacters = 0
  let replacementCharacters = 0

  for (const character of text) {
    if (inspectedCharacters >= TEXT_INSPECTION_SAMPLE_BYTES) break
    inspectedCharacters += 1

    if (character === "\ufffd") {
      replacementCharacters += 1
      continue
    }

    const codePoint = character.codePointAt(0) ?? 0
    const isControlCharacter =
      (codePoint <= 0x1f && !isAllowedControlCharacter(character)) ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    if (isControlCharacter) controlCharacters += 1
  }

  if (inspectedCharacters === 0) return false

  return (
    controlCharacters / inspectedCharacters > MAX_CONTROL_CHARACTER_RATIO ||
    replacementCharacters / inspectedCharacters >
      MAX_REPLACEMENT_CHARACTER_RATIO
  )
}

function decodeText(
  bytes: Uint8Array,
  encoding: TextEncoding,
  isTruncated: boolean
) {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes, {
    // Do not reject a final partial code unit when the caller deliberately
    // capped the preview in the middle of a valid source file.
    stream: isTruncated,
  })
}

export function decodeFilePreviewText(
  bytes: Uint8Array,
  maximumBytes = DEFAULT_MAX_PREVIEW_BYTES
): DecodedFilePreviewText | null {
  const visibleBytes = bytes.slice(0, Math.max(0, maximumBytes))
  const isTruncated = bytes.byteLength > visibleBytes.byteLength
  const encoding = getTextEncoding(visibleBytes)
  if (hasBinaryMagicNumber(bytes)) return null
  if (encoding === "utf-8" && hasNullByte(bytes)) return null

  const withoutByteOrderMark = stripByteOrderMark(visibleBytes, encoding)

  try {
    const text = decodeText(withoutByteOrderMark, encoding, isTruncated)
    if (hasExcessiveNonTextCharacters(text)) return null

    return {
      text,
      truncated: isTruncated,
    }
  } catch {
    return null
  }
}

export function getFilePreviewLanguageFilename(filename: string) {
  const normalized = filename.trim().split(/[\\/]/).at(-1)?.toLowerCase() ?? ""
  if (normalized === "dockerfile") return "dockerfile"
  if (normalized === "makefile") return "makefile"
  if (
    normalized === ".env" ||
    normalized.startsWith(".env.") ||
    normalized.endsWith(".env") ||
    normalized.includes(".env.")
  ) {
    return "file.env"
  }
  return normalized
}
