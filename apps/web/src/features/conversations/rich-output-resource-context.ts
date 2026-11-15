import { createContext, useContext, useEffect } from "react"

import type { ConversationFile } from "@/api/contracts"
import type { LoadArtifactPreview } from "./assistant-markdown-image"

export type RichOutputResources = {
  filesById?: ReadonlyMap<string, ConversationFile>
  loadPreview?: LoadArtifactPreview
  onPreviewFile?: (file: ConversationFile) => void
  onDownload?: (file: ConversationFile) => void
  downloadingFileId?: string
}

export const RichOutputResourceContext = createContext<
  RichOutputResources & {
    renderedFileIds: ReadonlySet<string>
    register: (ids: string[]) => () => void
  }
>({ renderedFileIds: new Set(), register: () => () => {} })

export const RichOutputTurnContext = createContext<string | undefined>(
  undefined
)

export function useRichOutputResources() {
  return useContext(RichOutputResourceContext)
}

export function useRenderedRichOutputFiles(files: readonly ConversationFile[]) {
  const { register, onDownload } = useRichOutputResources()
  const turnId = useContext(RichOutputTurnContext)
  const ids =
    onDownload && turnId
      ? files
          .filter((file) => file.turn_id === turnId)
          .map((file) => file.id.toLowerCase())
          .join(",")
      : ""
  // Claim files only after the rich renderer mounts. A failed lazy load or
  // renderer error leaves the ordinary artifact cards available.
  useEffect(() => (ids ? register(ids.split(",")) : undefined), [ids, register])
}

export function resolveRichOutputArtifact(
  fileId: string,
  filesById: RichOutputResources["filesById"]
): ConversationFile | undefined {
  const file = filesById?.get(fileId.toLowerCase())
  return file?.kind === "artifact" && file.download_available ? file : undefined
}
