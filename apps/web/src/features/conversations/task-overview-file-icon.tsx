import type { ReactElement } from "react"
import pdfShape from "@/assets/figma/task-overview/pdf-shape.svg"
import spreadsheetShape from "@/assets/figma/task-overview/spreadsheet-shape.svg"
import { FileTypeIcon } from "@/components/media/file-type-icon"
import { resolveFileIconKind } from "@/lib/file-icons"
import { cn } from "@/lib/utils"
import { getTaskOverviewFileFormat } from "./task-overview-file-format"

export function TaskOverviewFileIcon({
  filename,
  mimeType,
}: {
  filename: string
  mimeType?: string | null
}): ReactElement {
  const kind = resolveFileIconKind(filename, mimeType)
  const format = getTaskOverviewFileFormat(filename, mimeType)
  const spreadsheet =
    kind === "excel" &&
    ["XLS", "XLSX", "XLSM", "XLSB", "CSV"].includes(format ?? "")
  if (kind !== "pdf" && !spreadsheet) {
    return (
      <FileTypeIcon
        filename={filename}
        mimeType={mimeType}
        className="size-5"
      />
    )
  }
  const csv = format === "CSV"
  let label = kind === "pdf" ? "PDF" : "XLS"
  if (kind === "excel" && csv) label = "CSV"
  return (
    <span
      className="relative block size-5 shrink-0"
      data-file-icon-kind={kind}
      aria-hidden="true"
    >
      <img
        src={kind === "pdf" ? pdfShape : spreadsheetShape}
        alt=""
        className="block size-full"
      />
      <span
        className={cn(
          "absolute top-[11px] text-[5.3333px] leading-[6.6667px] font-bold tracking-normal text-white",
          csv ? "left-[4.1667px]" : "left-[4.5833px]"
        )}
      >
        {label}
      </span>
    </span>
  )
}
