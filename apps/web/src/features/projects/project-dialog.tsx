import { useId, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  APPLICATION_DEVELOPMENT_PROJECT_NAME,
  projectInputSchema,
  type Project,
  type ProjectAppearance,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"

import { getErrorMessage } from "@/api/error-message"
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { shouldAutoFocusOnDesktop } from "@/lib/responsive"
import { deleteProject, refreshProjects, saveProject } from "./project-api"
import { ProjectAppearancePicker } from "./project-appearance-picker"

export type ProjectAction =
  { mode: "create" } | { mode: "edit" | "delete"; project: Project }

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
  const [appearance, setAppearance] = useState<ProjectAppearance>(() =>
    "project" in action
      ? { icon: action.project.icon, color: action.project.color }
      : { icon: "folder", color: "default" }
  )
  const nameRequired = action.mode !== "delete"
  const fixedName =
    action.mode === "edit" &&
    action.project.name === APPLICATION_DEVELOPMENT_PROJECT_NAME
  const validName = projectInputSchema.safeParse({ name, ...appearance })
  const mutation = useMutation({
    mutationFn: async () => {
      if (action.mode === "delete") return deleteProject(action.project.id)
      const input = projectInputSchema.parse({ name, ...appearance })
      return saveProject(
        input,
        action.mode === "edit" ? action.project.id : undefined
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
      >
        <DialogHeader>
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
              <FieldShell
                id={inputId}
                label={t("projects.name")}
                required
                hint={
                  fixedName
                    ? t("errors.applicationDevelopment.projectNameFixed")
                    : undefined
                }
              >
                <InputGroup className="h-12 rounded-xl">
                  <InputGroupInput
                    id={inputId}
                    aria-required="true"
                    value={name}
                    maxLength={80}
                    disabled={mutation.isPending}
                    readOnly={fixedName}
                    autoFocus={shouldAutoFocusOnDesktop()}
                    placeholder={t("projects.namePlaceholder")}
                    onChange={(event) => {
                      setName(event.target.value)
                      mutation.reset()
                    }}
                  />
                  <InputGroupAddon
                    align="inline-start"
                    className="self-stretch border-r border-border pr-2"
                  >
                    <ProjectAppearancePicker
                      value={appearance}
                      disabled={mutation.isPending}
                      onChange={(next) => {
                        setAppearance(next)
                        mutation.reset()
                      }}
                    />
                  </InputGroupAddon>
                </InputGroup>
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
