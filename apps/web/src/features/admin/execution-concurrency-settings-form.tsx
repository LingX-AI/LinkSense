import { SettingsCard } from "@/components/settings/settings-card"
import { FieldShell, SettingsFieldGroup } from "@/components/forms/form-field"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRef, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import {
  executionConcurrencySettingsUpdateResultSchema,
  type ExecutionConcurrencySettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { NotificationToast } from "@/components/feedback/notification-toast"
import { StatusBanner } from "@/components/feedback/status-banner"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Button } from "@/components/ui/button"
import { FieldDescription, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"

type LimitField =
  "max_concurrent_conversations" | "runner_app_server_process_limit"

type FieldErrors = Partial<Record<LimitField, string>>

export function ExecutionConcurrencySettingsForm({
  settings,
}: {
  settings: ExecutionConcurrencySettings
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const globalLimitRef = useRef<HTMLInputElement>(null)
  const processLimitRef = useRef<HTMLInputElement>(null)
  const [globalLimit, setGlobalLimit] = useState(
    settings.max_concurrent_conversations?.toString() ?? ""
  )
  const [processLimit, setProcessLimit] = useState(
    settings.runner_app_server_process_limit?.toString() ?? ""
  )
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (body: {
      max_concurrent_conversations: number | null
      runner_app_server_process_limit: number | null
    }) =>
      apiRequest("/admin/execution-concurrency-settings", {
        method: "PUT",
        body,
        schema: executionConcurrencySettingsUpdateResultSchema,
      }),
    onSuccess: ({ settings: updatedSettings }) => {
      setMessage(t("admin.concurrency.saved"))
      setError(null)
      queryClient.setQueryData(
        ["admin", "execution-concurrency-settings"],
        updatedSettings
      )
    },
    onError: (nextError) => {
      setMessage(null)
      setError(getErrorMessage(nextError, t))
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)
    setError(null)
    const global = parseOptionalPositiveInteger(globalLimit)
    const process = parseOptionalPositiveInteger(processLimit)
    const nextErrors: FieldErrors = {
      ...(global === undefined
        ? {
            max_concurrent_conversations: t(
              "admin.concurrency.errors.positiveInteger"
            ),
          }
        : {}),
      ...(process === undefined
        ? {
            runner_app_server_process_limit: t(
              "admin.concurrency.errors.positiveInteger"
            ),
          }
        : {}),
    }
    setFieldErrors(nextErrors)
    if (global === undefined) {
      globalLimitRef.current?.focus()
      return
    }
    if (process === undefined) {
      processLimitRef.current?.focus()
      return
    }
    mutation.mutate({
      max_concurrent_conversations: global,
      runner_app_server_process_limit: process,
    })
  }

  return (
    <SettingsCard
      aria-labelledby="execution-concurrency-settings-title"
      header={
        <SettingsSectionHeader
          id="execution-concurrency-settings-title"
          title={t("admin.concurrency.title")}
          description={t("admin.concurrency.description")}
        />
      }
    >
      <NotificationToast id="concurrency-settings-saved" message={message} />
      {error && <StatusBanner variant="error">{error}</StatusBanner>}

      <form onSubmit={submit} noValidate>
        <SettingsFieldGroup>
          <FieldShell
            id="max-concurrent-conversations"
            label={t("admin.concurrency.globalLimit")}
            hint={t("admin.concurrency.globalLimitDescription", {
              defaultValue:
                settings.environment_defaults.max_concurrent_conversations,
              effectiveValue: settings.effective.max_concurrent_conversations,
            })}
            error={fieldErrors.max_concurrent_conversations}
            layout="settings"
            controlWidth="compact"
          >
            <Input
              ref={globalLimitRef}
              id="max-concurrent-conversations"
              name="max_concurrent_conversations"
              className="max-w-sm"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={globalLimit}
              disabled={mutation.isPending}
              aria-invalid={
                fieldErrors.max_concurrent_conversations ? true : undefined
              }
              aria-describedby="max-concurrent-conversations-hint max-concurrent-conversations-error"
              placeholder={String(
                settings.environment_defaults.max_concurrent_conversations
              )}
              onChange={(event) => {
                setGlobalLimit(event.target.value)
                setFieldErrors((current) => ({
                  ...current,
                  max_concurrent_conversations: undefined,
                }))
              }}
            />
          </FieldShell>

          <FieldShell
            id="runner-app-server-process-limit"
            label={t("admin.concurrency.processLimit")}
            hint={t("admin.concurrency.processLimitDescription", {
              defaultValue:
                settings.environment_defaults.runner_app_server_process_limit,
              effectiveValue:
                settings.effective.runner_app_server_process_limit,
            })}
            error={fieldErrors.runner_app_server_process_limit}
            layout="settings"
            controlWidth="compact"
          >
            <Input
              ref={processLimitRef}
              id="runner-app-server-process-limit"
              name="runner_app_server_process_limit"
              className="max-w-sm"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={processLimit}
              disabled={mutation.isPending}
              aria-invalid={
                fieldErrors.runner_app_server_process_limit ? true : undefined
              }
              aria-describedby="runner-app-server-process-limit-hint runner-app-server-process-limit-error"
              placeholder={String(
                settings.environment_defaults.runner_app_server_process_limit
              )}
              onChange={(event) => {
                setProcessLimit(event.target.value)
                setFieldErrors((current) => ({
                  ...current,
                  runner_app_server_process_limit: undefined,
                }))
              }}
            />
          </FieldShell>
        </SettingsFieldGroup>

        <FieldGroup>
          <FieldDescription>
            {t("admin.concurrency.loweringBehavior")}
          </FieldDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              size="default"
              disabled={mutation.isPending}
              aria-busy={mutation.isPending || undefined}
            >
              {mutation.isPending && <Spinner data-icon="inline-start" />}
              {t("common.save")}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </SettingsCard>
  )
}

function parseOptionalPositiveInteger(
  value: string
): number | null | undefined {
  const normalized = value.trim()
  if (!normalized) return null
  if (!/^[1-9]\d*$/u.test(normalized)) return undefined
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}
