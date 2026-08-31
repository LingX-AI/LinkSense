const ignoredUploadPathSegments = new Set([
  "__macosx",
  ".fseventsd",
  ".spotlight-v100",
  ".temporaryitems",
  ".trashes",
])

const ignoredUploadFilenames = new Set([
  ".ds_store",
  "desktop.ini",
  "ehthumbs.db",
  "thumbs.db",
])

const temporaryUploadExtensions = new Set([
  "crdownload",
  "download",
  "part",
  "partial",
  "swp",
  "swo",
  "swn",
  "temp",
  "tmp",
])

export function isMeaninglessTemporaryUploadPath(path: string): boolean {
  const segments = normalizedUploadPathSegments(path)
  if (segments.length === 0) return true
  return (
    segments
      .slice(0, -1)
      .some((segment) => ignoredUploadPathSegments.has(segment)) ||
    isMeaninglessTemporaryUploadFilename(segments[segments.length - 1] ?? "")
  )
}

export function isMeaninglessTemporaryUploadFilename(filename: string): boolean {
  const normalized = normalizeUploadPathText(filename)
  const basename = normalized.split(/[\\/]/u).filter(Boolean).at(-1) ?? ""
  if (!basename) return true

  const lowerName = basename.toLocaleLowerCase("en-US")
  if (ignoredUploadFilenames.has(lowerName)) return true
  if (lowerName === "icon\r") return true
  if (lowerName.startsWith("._")) return true
  if (lowerName.startsWith("~$")) return true
  if (lowerName.startsWith(".~lock.") && lowerName.endsWith("#")) return true
  if (basename.startsWith("#") && basename.endsWith("#")) return true
  if (basename.endsWith("~")) return true

  const extensionSeparator = lowerName.lastIndexOf(".")
  if (
    extensionSeparator > 0 &&
    temporaryUploadExtensions.has(lowerName.slice(extensionSeparator + 1))
  ) {
    return true
  }

  return false
}

function normalizedUploadPathSegments(path: string) {
  return normalizeUploadPathText(path)
    .split(/[\\/]/u)
    .map((segment) => segment.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean)
}

function normalizeUploadPathText(value: string) {
  return value.normalize("NFC").trim()
}
