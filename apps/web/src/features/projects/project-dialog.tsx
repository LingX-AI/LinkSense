import { useId, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { projectInputSchema, type Project } from "@linksense/shared"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
import type { Conversation } from "@/api/contracts"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell } from "@/components/forms/form-field"
import { FieldGroup } from "@/components/ui/field"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import { cn } from "@/lib/utils"
import {
  deleteProject,
  moveTaskToProject,
  refreshProjects,
  saveProject,
} from "./project-api"
import { ProjectPicker } from "./project-picker"

export type ProjectAction =
  | { mode: "create" }
  | { mode: "rename" | "delete"; project: Project }
  | {
      mode: "move"
      conversation: Pick<Conversation, "id" | "title" | "project_id">
    }

export function ProjectDialog({
  action,
  onClose,
  onCreated,
}: {
  action: ProjectAction
  onClose: () => void
  onCreated?: (project: Project) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const inputId = useId()
  const [name, setName] = useState(
    "project" in action ? action.project.name : ""
  )
  const [projectId, setProjectId] = useState(
    action.mode === "move" ? action.conversation.project_id : null
  )
  const nameRequired = action.mode === "create" || action.mode === "rename"
  const validName = projectInputSchema.safeParse({ name })
  const mutation = useMutation({
    mutationFn: async () => {
      if (action.mode === "delete") return deleteProject(action.project.id)
      if (action.mode === "move")
        return moveTaskToProject(action.conversation.id, projectId)
      const input = projectInputSchema.parse({ name })
      return saveProject(
        input,
        action.mode === "rename" ? action.project.id : undefined
      )
    },
    onSuccess: async (result) => {
      await refreshProjects(client)
      if (action.mode === "create" && result && "name" in result)
        onCreated?.(result)
      onClose()
    },
  })
  const title = t(`projects.${action.mode}`)
  const error = mutation.isError
    ? getErrorMessage(mutation.error, t)
    : undefined
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent
        closeLabel={t("common.close")}
        showCloseButton={!mutation.isPending}
        className={cn(
          action.mode === "move" &&
            "max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-sm"
        )}
      >
        <DialogHeader className={cn(action.mode === "move" && "min-w-0 pr-8")}>
          <DialogTitle>{title}</DialogTitle>
          {action.mode === "create" && (
            <DialogDescription>
              {t("projects.createDescription")}
            </DialogDescription>
          )}
          {action.mode === "delete" && (
            <DialogDescription>
              {t("projects.deleteDescription", {
                name: action.project.name,
              })}
            </DialogDescription>
          )}
          {action.mode === "move" && (
            <DialogDescription className="[overflow-wrap:anywhere]">
              {t("projects.moveDescription", {
                title: action.conversation.title,
              })}
            </DialogDescription>
          )}
        </DialogHeader>
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!mutation.isPending && (!nameRequired || validName.success))
              mutation.mutate()
          }}
        >
          {error && <StatusBanner variant="error">{error}</StatusBanner>}
          <FieldGroup>
            {nameRequired && (
              <FieldShell id={inputId} label={t("projects.name")}>
                <Input
                  id={inputId}
                  value={name}
                  maxLength={80}
                  disabled={mutation.isPending}
                  autoFocus={shouldAutoFocusOnDesktop()}
                  placeholder={t("projects.namePlaceholder")}
                  onChange={(event) => {
                    setName(event.target.value)
                    mutation.reset()
                  }}
                />
              </FieldShell>
            )}
            {action.mode === "move" && (
              <FieldShell id={inputId} label={t("projects.choose")}>
                <ProjectPicker
                  id={inputId}
                  value={projectId}
                  disabled={mutation.isPending}
                  onChange={(id) => {
                    setProjectId(id)
                    mutation.reset()
                  }}
                />
              </FieldShell>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant={action.mode === "delete" ? "destructive" : "default"}
              disabled={
                mutation.isPending || (nameRequired && !validName.success)
              }
              aria-busy={mutation.isPending || undefined}
            >
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              {action.mode === "delete"
                ? t("projects.delete")
                : action.mode === "create"
                  ? t("common.create")
                  : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
