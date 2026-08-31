import type { ConversationFile } from "@/api/contracts"

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const codeExtensions = new Set([
  "bash",
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "css",
  "cxx",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "h",
  "hpp",
  "htm",
  "html",
  "java",
  "js",
  "json",
  "json5",
  "jsonl",
  "jsx",
  "less",
  "lock",
  "mjs",
  "patch",
  "php",
  "plist",
  "prisma",
  "properties",
  "proto",
  "py",
  "rb",
  "rs",
  "scala",
  "scss",
  "sh",
  "svelte",
  "sql",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
])

const textExtensions = new Set([
  "cfg",
  "cnf",
  "conf",
  "config",
  "env",
  "example",
  "ini",
  "list",
  "log",
  "pem",
  "service",
  "text",
  "timer",
  "txt",
])

const imageExtensions = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])
const audioExtensions = new Set([
  "aac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "weba",
  "aif",
  "aiff",
  "3ga",
])
const videoExtensions = new Set([
  "m4v",
  "mov",
  "mp4",
  "ogv",
  "webm",
  "mkv",
  "avi",
  "mpeg",
  "mpg",
  "3gp",
  "3g2",
])
const archiveExtensions = new Set([
  "zip",
  "7z",
  "rar",
  "gz",
  "tgz",
  "tar",
  "bz2",
  "xz",
  "zst",
])

const codeFilenames = new Set([
  "dockerfile",
  "gemfile",
  "justfile",
  "makefile",
  "procfile",
  "rakefile",
  "vagrantfile",
])

const markdownFilenames = new Set([
  "changelog",
  "contributing",
  "readme",
  "security",
])

const textFilenames = new Set([
  "authors",
  "codeowners",
  "copying",
  "credits",
  "license",
  "notice",
])

const textFilenamePrefixes = [
  ".babelrc",
  ".browserslistrc",
  ".dockerignore",
  ".editorconfig",
  ".eslintignore",
  ".eslintrc",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  ".prettierrc",
  ".stylelintrc",
  ".yarnrc",
] as const

const nonTextPreviewFallbackExtensions = new Set([
  "3g2",
  "3gp",
  "7z",
  "aif",
  "aiff",
  "apk",
  "ar",
  "avi",
  "avif",
  "azw",
  "azw3",
  "bin",
  "blend",
  "bmp",
  "bz2",
  "bzip2",
  "cab",
  "cbr",
  "cbz",
  "class",
  "cpio",
  "cr2",
  "db",
  "deb",
  "dll",
  "dmg",
  "dng",
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dotx",
  "dylib",
  "elf",
  "eot",
  "epub",
  "exe",
  "flac",
  "flv",
  "gif",
  "gz",
  "gzip",
  "heic",
  "ico",
  "iso",
  "jar",
  "jpeg",
  "jpg",
  "key",
  "lha",
  "lzh",
  "m4a",
  "m4v",
  "mid",
  "midi",
  "mkv",
  "mobi",
  "mov",
  "mp3",
  "mp4",
  "mpeg",
  "mpg",
  "msi",
  "nef",
  "numbers",
  "o",
  "odp",
  "ods",
  "odt",
  "oga",
  "ogg",
  "ogv",
  "opus",
  "otf",
  "pages",
  "pdf",
  "pkg",
  "png",
  "pot",
  "potm",
  "potx",
  "pps",
  "ppsm",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "psd",
  "rar",
  "rpm",
  "so",
  "sqlite",
  "svg",
  "tar",
  "tbz",
  "tbz2",
  "tif",
  "tiff",
  "tgz",
  "ttf",
  "txz",
  "vsdx",
  "wasm",
  "wav",
  "weba",
  "webm",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xlam",
  "xlt",
  "xltm",
  "xltx",
  "xz",
  "z",
  "zip",
  "zipx",
  "zst",
])

export type ConversationOfficeDocumentKind =
  "presentation" | "word" | "spreadsheet" | "html" | "archive"

export type ConversationFilePreviewKind =
  | ConversationOfficeDocumentKind
  | "pdf"
  | "code"
  | "text"
  | "markdown"
  | "csv"
  | "image"
  | "audio"
  | "video"

export type ConversationFilePreviewLoadMode = "content" | "source"

export type ConversationFilePreviewSource = Readonly<{
  url: string
  expiresAt: string
  release?: () => void
}>

export type LoadConversationFilePreviewSource = (
  file: ConversationFile,
  signal: AbortSignal
) => Promise<ConversationFilePreviewSource>

function normalizedMimeType(mimeType: string | null | undefined) {
  return mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function normalizedFilename(filename: string) {
  return filename.trim().split(/[\\/]/).at(-1)?.toLowerCase() ?? ""
}

function isEnvironmentFilename(basename: string) {
  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename.endsWith(".env") ||
    basename.includes(".env.")
  )
}

export function getConversationFileExtension(filename: string) {
  const basename = normalizedFilename(filename)
  if (!basename) return ""
  if (isEnvironmentFilename(basename)) return "env"
  const separator = basename.lastIndexOf(".")
  return separator > -1 ? basename.slice(separator + 1) : ""
}

export function isKnownNonTextPreviewExtension(extension: string) {
  return nonTextPreviewFallbackExtensions.has(extension.trim().toLowerCase())
}

function isCodeMimeType(mimeType: string) {
  return (
    mimeType === "application/javascript" ||
    mimeType === "application/json" ||
    mimeType === "application/ld+json" ||
    mimeType === "application/xml" ||
    mimeType === "application/x-javascript" ||
    mimeType === "application/x-sh" ||
    mimeType === "application/x-shellscript" ||
    mimeType === "application/x-toml" ||
    mimeType === "application/x-yaml" ||
    mimeType === "application/yaml" ||
    mimeType === "text/css" ||
    mimeType === "text/ecmascript" ||
    mimeType === "text/javascript"
  )
}

function isTextMimeType(mimeType: string) {
  return mimeType.startsWith("text/")
}

function isSupportedImageMimeType(mimeType: string) {
  return (
    mimeType === "image/avif" ||
    mimeType === "image/gif" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/png" ||
    mimeType === "image/svg+xml" ||
    mimeType === "image/webp"
  )
}

function isSupportedAudioMimeType(mimeType: string) {
  return (
    mimeType === "audio/aac" ||
    mimeType === "audio/flac" ||
    mimeType === "audio/mp4" ||
    mimeType === "audio/mpeg" ||
    mimeType === "audio/ogg" ||
    mimeType === "audio/opus" ||
    mimeType === "audio/wav" ||
    mimeType === "audio/webm" ||
    mimeType === "audio/x-m4a" ||
    mimeType === "audio/x-wav" ||
    mimeType === "audio/vnd.wave" ||
    mimeType === "audio/x-aac" ||
    mimeType === "audio/x-flac" ||
    mimeType === "audio/aiff" ||
    mimeType === "audio/3gpp" ||
    mimeType === "audio/3gpp2"
  )
}

function isSupportedVideoMimeType(mimeType: string) {
  return (
    mimeType === "video/mp4" ||
    mimeType === "video/ogg" ||
    mimeType === "video/quicktime" ||
    mimeType === "video/webm" ||
    mimeType === "video/x-m4v" ||
    mimeType === "video/x-matroska" ||
    mimeType === "video/x-msvideo" ||
    mimeType === "video/mpeg" ||
    mimeType === "video/3gpp" ||
    mimeType === "video/3gpp2"
  )
}

function isSupportedArchiveMimeType(mimeType: string) {
  return (
    mimeType === "application/zip" ||
    mimeType === "application/x-zip-compressed" ||
    mimeType === "application/zip-compressed" ||
    mimeType === "application/x-7z-compressed" ||
    mimeType === "application/vnd.rar" ||
    mimeType === "application/x-rar-compressed" ||
    mimeType === "application/gzip" ||
    mimeType === "application/x-gzip" ||
    mimeType === "application/x-tar" ||
    mimeType === "application/x-bzip2" ||
    mimeType === "application/x-xz" ||
    mimeType === "application/zstd"
  )
}

function isMarkdownFilename(filename: string, extension: string) {
  return (
    extension === "md" ||
    extension === "markdown" ||
    markdownFilenames.has(filename)
  )
}

function isCodeFilename(filename: string, extension: string) {
  return codeFilenames.has(filename) || codeExtensions.has(extension)
}

function isNamedTextFile(filename: string) {
  return (
    textFilenames.has(filename) ||
    textFilenamePrefixes.some(
      (prefix) => filename === prefix || filename.startsWith(`${prefix}.`)
    )
  )
}

function isGenericTextFilenameCandidate(filename: string, extension: string) {
  if (!filename) return false
  if (isKnownNonTextPreviewExtension(extension)) return false
  return true
}

export function getConversationFilePreviewKind(
  file: Pick<ConversationFile, "name" | "mime_type">
): ConversationFilePreviewKind | null {
  const mimeType = normalizedMimeType(file.mime_type)
  const filename = normalizedFilename(file.name)
  const extension = getConversationFileExtension(file.name)

  if (mimeType === PPTX_MIME_TYPE || filename.endsWith(".pptx")) {
    return "presentation"
  }
  if (mimeType === DOCX_MIME_TYPE || filename.endsWith(".docx")) {
    return "word"
  }
  if (mimeType === XLSX_MIME_TYPE || filename.endsWith(".xlsx")) {
    return "spreadsheet"
  }
  if (
    mimeType === "text/html" ||
    filename.endsWith(".html") ||
    filename.endsWith(".htm")
  ) {
    return "html"
  }
  if (
    isSupportedArchiveMimeType(mimeType) ||
    archiveExtensions.has(extension)
  ) {
    return "archive"
  }
  if (mimeType === "application/pdf" || extension === "pdf") return "pdf"
  if (
    mimeType === "text/csv" ||
    mimeType === "text/tab-separated-values" ||
    extension === "csv" ||
    extension === "tsv"
  ) {
    return "csv"
  }
  if (mimeType === "text/markdown" || isMarkdownFilename(filename, extension)) {
    return "markdown"
  }
  if (isSupportedAudioMimeType(mimeType) || audioExtensions.has(extension)) {
    return "audio"
  }
  if (isSupportedVideoMimeType(mimeType) || videoExtensions.has(extension)) {
    return "video"
  }
  if (isSupportedImageMimeType(mimeType) || imageExtensions.has(extension)) {
    return "image"
  }
  if (isKnownNonTextPreviewExtension(extension)) {
    return null
  }
  if (isCodeMimeType(mimeType) || isCodeFilename(filename, extension)) {
    return "code"
  }
  if (
    isTextMimeType(mimeType) ||
    textExtensions.has(extension) ||
    isNamedTextFile(filename) ||
    isGenericTextFilenameCandidate(filename, extension)
  ) {
    return "text"
  }
  return null
}

export function getConversationFilePreviewLabelKey(
  file: Pick<ConversationFile, "name" | "mime_type">
) {
  const kind = getConversationFilePreviewKind(file)
  if (kind === "presentation") return "conversation.previewPresentation"
  if (kind === "html") return "conversation.previewHtml"
  if (kind === "archive") return "conversation.previewArchive"
  if (kind === "word" || kind === "spreadsheet") {
    return "conversation.previewDocument"
  }
  return "conversation.previewFile"
}

export function getConversationOfficeDocumentKind(
  file: Pick<ConversationFile, "name" | "mime_type">
): ConversationOfficeDocumentKind | null {
  const kind = getConversationFilePreviewKind(file)
  return kind === "presentation" ||
    kind === "word" ||
    kind === "spreadsheet" ||
    kind === "html" ||
    kind === "archive"
    ? kind
    : null
}

export function isPreviewableConversationFile(
  file: Pick<ConversationFile, "name" | "mime_type">
) {
  return getConversationFilePreviewKind(file) !== null
}

export function isPreviewableConversationOfficeDocument(
  file: Pick<ConversationFile, "name" | "mime_type">
) {
  return getConversationOfficeDocumentKind(file) !== null
}

export function isConversationFileSelectionEnabled(
  kind: ConversationFilePreviewKind
) {
  return (
    kind === "presentation" ||
    kind === "word" ||
    kind === "spreadsheet" ||
    kind === "html"
  )
}

export function getConversationFilePreviewLoadMode(
  kind: ConversationFilePreviewKind
): ConversationFilePreviewLoadMode {
  return kind === "image" || kind === "audio" || kind === "video"
    ? "source"
    : "content"
}
