import { useCallback, useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import {
  applicationDevelopmentMetadataUpdateSchema,
  type ApplicationDevelopment,
} from "@linksense/shared"
import { ApiError } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { RequiredIndicator } from "@/components/forms/required-indicator"
import { StatusBanner } from "@/components/feedback/status-banner"
import { updateApplicationDevelopmentMetadata } from "./application-development-api"

type EditingMetadata = {
  field: "name" | "description"
  value: string
  sourceHash: string
  name: string
  description: string | null
}

export function ApplicationDevelopmentMetadata({
  project,
  disabled,
  published,
  onUpdated,
  onEditingChange,
  onReload,
}: {
  project: ApplicationDevelopment
  disabled: boolean
  published: boolean
  onUpdated: (project: ApplicationDevelopment) => void
  onEditingChange: (editing: boolean) => void
  onReload: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<EditingMetadata | null>(null)
  const latest = useRef<EditingMetadata | null>(null)
  const inFlight = useRef(false)
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  function updateEditing(value: EditingMetadata | null) {
    latest.current = value
    setEditing(value)
  }
  const save = useMutation({
    mutationFn: (
      input: Parameters<typeof updateApplicationDevelopmentMetadata>[1]
    ) => updateApplicationDevelopmentMetadata(project.id, input),
    onSuccess: (next, input) => {
      onUpdated(next)
      const current = latest.current
      if (!current || !next.source_hash) return
      // Advance the revision without replacing text typed during the request.
      const submitted = input[current.field] ?? ""
      const value =
        current.value.trim() === submitted
          ? current.field === "name"
            ? next.name
            : (next.manifest?.description ?? "")
          : current.value
      updateEditing({
        ...current,
        value,
        name: next.name,
        description: next.manifest?.description ?? null,
        sourceHash: next.source_hash,
      })
    },
    onSettled: () => {
      inFlight.current = false
    },
  })
  const { mutate, isPending, error } = save
  const parsed = editing
    ? applicationDevelopmentMetadataUpdateSchema.safeParse({
        source_hash: editing.sourceHash,
        name: editing.field === "name" ? editing.value : editing.name,
        description:
          editing.field === "description"
            ? editing.value.trim() || null
            : editing.description,
      })
    : null
  const validationError =
    parsed && !parsed.success && !composing
      ? t(
          editing?.field === "name"
            ? "applicationDevelopment.metadata.invalidName"
            : "applicationDevelopment.metadata.invalidDescription"
        )
      : null
  const finish = useCallback(() => {
    latest.current = null
    setEditing(null)
    onEditingChange(false)
  }, [onEditingChange])
  useEffect(() => {
    if (!editing || isPending || error || composing) return
    // Debounce typing; blur flushes immediately. Requests never overlap, and a
    // later draft waits for the previous response's source hash before saving.
    const timer = setTimeout(
      () => {
        if (inFlight.current) return
        const input = applicationDevelopmentMetadataUpdateSchema.safeParse({
          source_hash: editing.sourceHash,
          name: editing.field === "name" ? editing.value : editing.name,
          description:
            editing.field === "description"
              ? editing.value.trim() || null
              : editing.description,
        })
        if (!input.success) return
        if (
          input.data.name === editing.name &&
          input.data.description === editing.description
        ) {
          if (!focused) finish()
          return
        }
        inFlight.current = true
        mutate(input.data)
      },
      focused ? 700 : 0
    )
    return () => clearTimeout(timer)
  }, [editing, focused, composing, isPending, error, mutate, finish])

  function begin(field: EditingMetadata["field"]) {
    if (disabled || isPending || !project.source_hash) return
    const description = project.manifest?.description ?? null
    save.reset()
    setFocused(true)
    updateEditing({
      field,
      value: field === "name" ? project.name : (description ?? ""),
      sourceHash: project.source_hash,
      name: project.name,
      description,
    })
    onEditingChange(true)
  }
  const conflict =
    error instanceof ApiError &&
    error.errorCode === "APPLICATION_DEVELOPMENT_SOURCE_CHANGED"
  const editor = editing && (
    <div className="max-w-full min-w-0">
      <Field data-invalid={Boolean(validationError)}>
        <FieldLabel
          htmlFor={`application-${project.id}-${editing.field}`}
          className="sr-only"
        >
          {t(
            editing.field === "name"
              ? "applicationDevelopment.metadata.name"
              : "applicationDevelopment.metadata.description"
          )}
        </FieldLabel>
        {(() => {
          const props = {
            id: `application-${project.id}-${editing.field}`,
            autoFocus: true,
            value: editing.value,
            "aria-invalid": Boolean(validationError),
            onChange: (
              event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
            ) => {
              if (!conflict && !isPending) save.reset()
              updateEditing({ ...editing, value: event.target.value })
            },
            onFocus: () => {
              setFocused(true)
              if (!conflict && error) save.reset()
            },
            onBlur: () => setFocused(false),
            onCompositionStart: () => setComposing(true),
            onCompositionEnd: () => setComposing(false),
            onKeyDown: (
              event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
            ) => {
              if (event.nativeEvent.isComposing || composing) return
              if (
                event.key === "Escape" ||
                (event.key === "Enter" &&
                  (editing.field === "name" || event.metaKey || event.ctrlKey))
              ) {
                event.preventDefault()
                event.currentTarget.blur()
              }
            },
          }
          return editing.field === "name" ? (
            <FieldContent className="flex-row items-center gap-2">
              <Input
                {...props}
                aria-required="true"
                className="h-auto w-full max-w-72 min-w-0 border-[color:var(--app-border)] px-2 py-1 text-sm leading-5 font-semibold md:text-sm"
              />
              <RequiredIndicator />
            </FieldContent>
          ) : (
            <Textarea
              {...props}
              className="min-h-0 w-full max-w-lg min-w-0 resize-none border-[color:var(--app-border)] px-2 py-1 text-xs leading-4 font-normal md:text-xs"
              rows={2}
            />
          )
        })()}
        {validationError && <FieldError>{validationError}</FieldError>}
      </Field>
      {isPending && (
        <span role="status" className="sr-only">
          {t("common.saving")}
        </span>
      )}
      {error && (
        <StatusBanner variant="error">
          {conflict
            ? t("applicationDevelopment.metadata.changed")
            : getErrorMessage(error, t)}
          {conflict && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                finish()
                save.reset()
                onReload()
              }}
            >
              {t("applicationDevelopment.metadata.reload")}
            </Button>
          )}
        </StatusBanner>
      )}
    </div>
  )
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1">
        {editing?.field === "name" ? (
          editor
        ) : (
          <h2 className="min-w-0 text-sm font-semibold">
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("applicationDevelopment.metadata.editName")}
              disabled={
                disabled ||
                Boolean(editing) ||
                !project.source_hash ||
                Boolean(project.source_error)
              }
              onClick={() => begin("name")}
              className="h-auto max-w-full justify-start px-1 py-0.5 text-left text-sm leading-5 font-semibold"
            >
              <span className="truncate">{project.name}</span>
            </Button>
          </h2>
        )}
        <Badge variant="secondary" size="sm" role="status">
          {t(
            published
              ? "applicationDevelopment.publish.done"
              : "applicationDevelopment.publish.draft"
          )}
        </Badge>
      </div>
      {editing?.field === "description" ? (
        editor
      ) : (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("applicationDevelopment.metadata.editDescription")}
          disabled={
            disabled ||
            Boolean(editing) ||
            !project.source_hash ||
            Boolean(project.source_error)
          }
          onClick={() => begin("description")}
          className="h-auto max-w-full min-w-0 justify-start px-1 py-0.5 text-left text-xs leading-4 font-normal"
        >
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {project.manifest?.description ||
              t("applicationDevelopment.metadata.addDescription")}
          </span>
        </Button>
      )}
    </div>
  )
}
