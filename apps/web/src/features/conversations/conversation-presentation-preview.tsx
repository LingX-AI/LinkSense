import type { ConversationFile } from "@/api/contracts"
import type { PresentationSelection } from "@/components/media/presentation-preview/presentation-preview.types"
import {
  ConversationOfficePreview,
  type LoadConversationOfficeDocument,
} from "@/features/conversations/conversation-office-preview"

export type LoadConversationPresentation = LoadConversationOfficeDocument

/**
 * Backward-compatible PPTX entry point. New conversation surfaces should use
 * ConversationOfficePreview so every Office format shares one loading shell.
 */
export function ConversationPresentationPreview({
  file,
  loadContent,
  onAskSelection,
  onDownload,
  onClose,
}: Readonly<{
  file: ConversationFile
  loadContent: LoadConversationPresentation
  onAskSelection: (
    file: ConversationFile,
    requests: ReadonlyArray<
      Readonly<{ selection: PresentationSelection; description: string }>
    >
  ) => Promise<void>
  onDownload?: (file: ConversationFile) => void
  onClose: () => void
}>) {
  return (
    <ConversationOfficePreview
      file={file}
      loadContent={loadContent}
      onAskSelection={(selectedFile, requests) => {
        const presentationRequests = requests.map(
          ({ officeSelection, request }) => {
            if (officeSelection.kind !== "presentation") {
              throw new Error("presentation_selection_required")
            }
            return {
              selection: officeSelection.selection,
              description: request,
            }
          }
        )
        return onAskSelection(selectedFile, presentationRequests)
      }}
      onDownload={onDownload}
      onClose={onClose}
    />
  )
}
