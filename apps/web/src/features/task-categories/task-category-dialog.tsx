import { useId, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { taskCategoryInputSchema, type TaskCategory } from "@linksense/shared"
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
  deleteTaskCategory,
  moveTaskToCategory,
  refreshTaskCategories,
  saveTaskCategory,
} from "./task-category-api"
import { TaskCategoryPicker } from "./task-category-picker"

export type TaskCategoryAction =
  | { mode: "create" }
  | { mode: "rename" | "delete"; category: TaskCategory }
  | {
      mode: "move"
      conversation: Pick<Conversation, "id" | "title" | "category_id">
    }

export function TaskCategoryDialog({
  action,
  onClose,
  onCreated,
}: {
  action: TaskCategoryAction
  onClose: () => void
  onCreated?: (category: TaskCategory) => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const inputId = useId()
  const [name, setName] = useState(
    "category" in action ? action.category.name : ""
  )
  const [categoryId, setCategoryId] = useState(
    action.mode === "move" ? action.conversation.category_id : null
  )
  const nameRequired = action.mode === "create" || action.mode === "rename"
  const validName = taskCategoryInputSchema.safeParse({ name })
  const mutation = useMutation({
    mutationFn: async () => {
      if (action.mode === "delete")
        return deleteTaskCategory(action.category.id)
      if (action.mode === "move")
        return moveTaskToCategory(action.conversation.id, categoryId)
      const input = taskCategoryInputSchema.parse({ name })
      return saveTaskCategory(
        input,
        action.mode === "rename" ? action.category.id : undefined
      )
    },
    onSuccess: async (result) => {
      await refreshTaskCategories(client)
      if (action.mode === "create" && result && "name" in result)
        onCreated?.(result)
      onClose()
    },
  })
  const title = t(`taskCategories.${action.mode}`)
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
          {action.mode === "delete" && (
            <DialogDescription>
              {t("taskCategories.deleteDescription", {
                name: action.category.name,
              })}
            </DialogDescription>
          )}
          {action.mode === "move" && (
            <DialogDescription className="[overflow-wrap:anywhere]">
              {t("taskCategories.moveDescription", {
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
              <FieldShell id={inputId} label={t("taskCategories.name")}>
                <Input
                  id={inputId}
                  value={name}
                  maxLength={80}
                  disabled={mutation.isPending}
                  autoFocus={shouldAutoFocusOnDesktop()}
                  placeholder={t("taskCategories.namePlaceholder")}
                  onChange={(event) => {
                    setName(event.target.value)
                    mutation.reset()
                  }}
                />
              </FieldShell>
            )}
            {action.mode === "move" && (
              <FieldShell id={inputId} label={t("taskCategories.choose")}>
                <TaskCategoryPicker
                  id={inputId}
                  value={categoryId}
                  disabled={mutation.isPending}
                  onChange={(id) => {
                    setCategoryId(id)
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
                ? t("common.delete")
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
