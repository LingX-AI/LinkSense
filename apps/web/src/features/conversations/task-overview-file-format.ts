import { resolveFileIconKind } from "@/lib/file-icons"

const formatsByMimeType: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.oasis.opendocument.spreadsheet": "ODS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "text/csv": "CSV",
}

export function getTaskOverviewFileFormat(
  filename: string,
  mimeType?: string | null
): string | undefined {
  const extension = filename
    .trim()
    .match(/\.([a-z0-9]+)$/iu)?.[1]
    ?.toUpperCase()
  if (extension && resolveFileIconKind(filename) !== "unknown") return extension
  return (
    formatsByMimeType[mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? ""] ??
    extension
  )
}
