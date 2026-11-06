import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import {
  ChartNoAxesCombinedIcon,
  CodeXmlIcon,
  MessagesSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PowerIcon,
  Trash2Icon,
} from "lucide-react"
import type { Application } from "@linksense/shared"
import {
  ApplicationCard,
  ApplicationCardModel,
  ApplicationCardResources,
} from "@/features/applications/application-card"
import { getErrorMessage } from "@/api/error-message"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { setPublicKnowledgeEnabled, publicKnowledgeKeys } from "./api"
import { PublicKnowledgeEditDialog } from "./edit-dialog"

export function PublicKnowledgeApplicationCard({
  application,
  onDelete,
  onFeedback,
}: {
  application: Application
  onDelete: (application: Application) => void
  onFeedback: (message: string, isError?: boolean) => void
}) {
  const { t } = useTranslation(),
    queryClient = useQueryClient(),
    [editing, setEditing] = useState(false)
  const status = useMutation({
    mutationFn: () =>
      setPublicKnowledgeEnabled(
        application.id,
        application.status !== "active"
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        publicKnowledgeKeys.management(application.id),
        result
      )
      await queryClient.invalidateQueries({ queryKey: ["applications"] })
    },
    onError: (error) => onFeedback(getErrorMessage(error, t), true),
  })
  const path = `/capabilities/applications/${application.id}/public-knowledge`
  return (
    <>
      <ApplicationCard
        id={application.id}
        name={application.name}
        kind={application.kind}
        status={application.status}
        icon={application.icon}
        description={application.description}
        footer={t("publicKnowledge.description")}
        actions={null}
        headerActions={
          application.is_owner && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("common.moreActionsNamed", {
                      name: application.name,
                    })}
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-max min-w-32">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <PencilIcon aria-hidden="true" />
                    {t("common.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={status.isPending}
                    onClick={() => status.mutate()}
                  >
                    <PowerIcon aria-hidden="true" />
                    {t(
                      application.status === "active"
                        ? "common.disable"
                        : "common.enable"
                    )}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link to={path} />}>
                    <MessagesSquareIcon aria-hidden="true" />
                    {t("publicKnowledge.logs")}
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link to={`${path}/usage`} />}>
                    <ChartNoAxesCombinedIcon aria-hidden="true" />
                    {t("applications.usage.action")}
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link to={`${path}/embed`} />}>
                    <CodeXmlIcon aria-hidden="true" />
                    {t("publicKnowledge.embedAction")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onDelete(application)}
                  >
                    <Trash2Icon aria-hidden="true" />
                    {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      >
        <ApplicationCardResources
          capability_count={application.capability_count}
          knowledge_base_count={application.knowledge_base_count}
          mcp_server_count={0}
        />
        <ApplicationCardModel model={application.model} />
      </ApplicationCard>
      {editing && (
        <PublicKnowledgeEditDialog
          applicationId={application.id}
          onClose={() => setEditing(false)}
          onSaved={() => onFeedback(t("publicKnowledge.published"))}
        />
      )}
    </>
  )
}
