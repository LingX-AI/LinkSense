import { useQueryClient } from "@tanstack/react-query"
import { ArchiveIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { apiRequest } from "@/api/client"
import { conversationSchema, type Conversation } from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"
import { Button } from "@/components/ui/button"

export function useConversationArchiveNotification(): (
  conversation: Pick<Conversation, "id" | "pinned_at">
) => void {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (conversation) => {
    const id = `conversation-archived-${conversation.id}`
    let restoring = false
    const settledOptions = {
      id,
      action: null,
      cancel: null,
      icon: undefined,
      closeButton: true,
    }
    const undo = async (): Promise<void> => {
      if (restoring) return
      restoring = true
      notify.loading(t("conversation.undoingArchive"), {
        ...settledOptions,
        closeButton: false,
      })
      try {
        const restored = await apiRequest(`/conversations/${conversation.id}`, {
          method: "PATCH",
          body: {
            archive_status: "active",
            ...(conversation.pinned_at ? { pinned: true } : {}),
          },
          schema: conversationSchema,
        })
        queryClient.setQueryData<Conversation>(
          ["conversation", restored.id],
          (current) => (current ? { ...current, ...restored } : undefined)
        )
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["conversations"] }),
          queryClient.invalidateQueries({
            queryKey: ["conversation", restored.id],
            exact: true,
          }),
        ])
        notify.success(t("conversation.archiveUndone"), settledOptions)
      } catch (error) {
        notify.error(getErrorMessage(error, t), settledOptions)
      }
    }
    notify.success(t("conversation.archivedNotification"), {
      id,
      icon: <ArchiveIcon className="size-4" aria-hidden="true" />,
      closeButton: true,
      cancel: (
        <Button
          variant="secondary"
          size="xs"
          onClick={() => {
            notify.dismiss(id)
            navigate("/archived")
          }}
        >
          {t("common.view")}
        </Button>
      ),
      action: (
        <Button
          size="xs"
          onClick={() => {
            void undo()
          }}
        >
          {t("conversation.undoArchive")}
        </Button>
      ),
    })
  }
}
