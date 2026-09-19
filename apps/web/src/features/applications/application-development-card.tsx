import { useOpenApplicationDevelopment } from "./application-opening"
import { defaultApplicationIcon } from "./application-icon-default"
import type {
  ApplicationDevelopment,
  ApplicationDevelopmentSummary,
} from "@linksense/shared"
import {
  CodeXmlIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ApplicationCard } from "./application-card"
import { ApplicationMetadataDialog } from "./application-metadata-dialog"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { dialogBodyStyles } from "@/components/ui/dialog-layout"
import type { ApplicationDetailsTarget } from "./application-details-dialog"
import { ApplicationDevelopmentSummaryContent } from "./application-development-summary"
import {
  useDeleteApplicationDevelopment,
  syncApplicationDevelopment,
  updateApplicationDevelopmentMetadata,
} from "./application-development-api"

export function ApplicationDevelopmentCard({
  development,
}: {
  development: ApplicationDevelopmentSummary
}) {
  const { t } = useTranslation()
  const open = useOpenApplicationDevelopment()
  const remove = useDeleteApplicationDevelopment()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editing, setEditing] = useState<ApplicationDevelopment | null>(null)
  const [detailsTarget, setDetailsTarget] =
    useState<ApplicationDetailsTarget | null>(null)
  const client = useQueryClient()
  const edit = useMutation({
    mutationFn: () => syncApplicationDevelopment(development.id),
    onSuccess: setEditing,
  })
  const error = open.error ?? remove.error ?? edit.error
  return (
    <>
      <ApplicationCard
        id={development.id}
        name={development.name}
        kind="interactive"
        developing
        onOpenDetails={setDetailsTarget}
        icon={development.icon ?? defaultApplicationIcon}
        description={
          development.description ??
          t("applicationDevelopment.catalog.draftDescription")
        }
        footer={t("applications.createdByMe")}
        headerActions={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={
                    open.isPending || remove.isPending || edit.isPending
                  }
                  aria-label={t("common.moreActionsNamed", {
                    name: development.name,
                  })}
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-max whitespace-nowrap"
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  disabled={open.isPending || remove.isPending}
                  onClick={() => open.mutate({ developmentId: development.id })}
                >
                  <CodeXmlIcon aria-hidden="true" />
                  {t("applicationDevelopment.catalog.continueDevelopment")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => edit.mutate()}>
                  <PencilIcon aria-hidden="true" />
                  {t("applications.editMetadata")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setConfirmDelete(true)}>
                  <Trash2Icon aria-hidden="true" />
                  {t("applicationDevelopment.catalog.deleteDraft")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        actions={
          <div className="flex min-w-0 flex-col items-start gap-2">
            {error && (
              <StatusBanner variant="error">
                {getErrorMessage(error, t)}
              </StatusBanner>
            )}
          </div>
        }
      />
      {detailsTarget && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDetailsTarget(null)
          }}
        >
          <DialogContent
            finalFocus={() => detailsTarget.trigger}
            closeLabel={t("common.close")}
            className="flex max-h-[calc(100dvh-2rem)] flex-col"
          >
            <DialogHeader>
              <DialogTitle>{t("applications.details.title")}</DialogTitle>
              <DialogDescription>
                {t("applicationDevelopment.catalog.draftDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className={dialogBodyStyles()}>
              <ApplicationDevelopmentSummaryContent development={development} />
            </div>
          </DialogContent>
        </Dialog>
      )}
      {editing && (
        <ApplicationMetadataDialog
          draft
          initial={{
            name: editing.name,
            icon: editing.icon,
            description: editing.manifest?.description ?? null,
          }}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            await updateApplicationDevelopmentMetadata(editing.id, {
              ...input,
              source_hash: editing.source_hash!,
            })
            await client.invalidateQueries({ queryKey: ["applications"] })
            await client.invalidateQueries({
              queryKey: ["application-development"],
            })
          }}
        />
      )}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t("applicationDevelopment.catalog.deleteDraft")}
        description={t("applicationDevelopment.catalog.deleteDraftDescription")}
        confirmLabel={t("common.delete")}
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(development.id, {
            onSuccess: () => setConfirmDelete(false),
            onError: () => setConfirmDelete(false),
          })
        }
      />
    </>
  )
}
