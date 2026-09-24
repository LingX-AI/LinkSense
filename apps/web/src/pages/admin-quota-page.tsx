import { useId, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  quotaSettingsSchema,
  creditLimitSettingsSchema,
  quotaBatchResultSchema,
  applyMemberCreditLimitsResultSchema,
  CREDIT_INPUT_PATTERN,
  type QuotaSettings,
  type CreditLimitSettings,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { ListChecksIcon, MoreHorizontalIcon, RotateCcwIcon } from "lucide-react"
import { z } from "zod"

import { useAuth } from "@/app/auth-state"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { FieldShell, SettingsFieldGroup } from "@/components/forms/form-field"
import { PageLayout } from "@/components/shell/page-layout"
import { SettingsCard } from "@/components/settings/settings-card"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"

const quotaSettingsQueryKey = ["admin", "quota-settings"] as const
const updateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: quotaSettingsSchema,
})

type QuotaAction =
  { kind: "reset" } | { kind: "apply"; limits: CreditLimitSettings }

type QuotaDraft = {
  credit_price_cny: string
  weekly_credit_limit: string
}

function quotaDraft(settings: QuotaSettings): QuotaDraft {
  return {
    credit_price_cny: settings.credit_price_cny,
    weekly_credit_limit: settings.weekly_credit_limit ?? "",
  }
}

export function AdminQuotaPage() {
  const { t } = useTranslation()
  const { refreshUser } = useAuth()
  const query = useQuery({
    queryKey: quotaSettingsQueryKey,
    queryFn: ({ signal }) =>
      apiRequest("/admin/quota-settings", {
        schema: quotaSettingsSchema,
        signal,
      }),
  })
  return (
    <PageLayout
      title={t("quotaManagement.title")}
      description={t("quotaManagement.description")}
    >
      {query.isLoading && <LoadingState />}
      {query.error && (
        <ErrorState
          message={getErrorMessage(query.error, t)}
          onRetry={() => {
            void query.refetch()
          }}
        />
      )}
      {!query.error && query.data && (
        <QuotaSettingsForm settings={query.data} onUsersChanged={refreshUser} />
      )}
    </PageLayout>
  )
}

export function QuotaSettingsForm({
  settings,
  onUsersChanged,
}: {
  settings: QuotaSettings
  onUsersChanged?: () => Promise<void>
}) {
  const { t } = useTranslation()
  const prefix = useId()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(() => quotaDraft(settings))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<QuotaAction | null>(null)
  const mutation = useMutation({
    mutationFn: (input: {
      scope: keyof QuotaSettings
      settings: QuotaSettings
    }) =>
      apiRequest("/admin/quota-settings", {
        method: "PUT",
        body: input.settings,
        schema: updateResultSchema,
      }),
    onSuccess: (result, input) => {
      setDraft((current) => ({
        ...current,
        [input.scope]: quotaDraft(result.settings)[input.scope],
      }))
      queryClient.setQueryData(quotaSettingsQueryKey, result.settings)
      notify.success(t("quotaManagement.saved"))
    },
    onError: (cause) => setError(getErrorMessage(cause, t)),
  })

  const batchMutation = useMutation({
    mutationFn: async (input: QuotaAction) => {
      if (input.kind === "reset") {
        const result = await apiRequest("/admin/quota-settings/reset", {
          method: "POST",
          body: {},
          schema: quotaBatchResultSchema,
        })
        return { kind: input.kind, ...result }
      }
      const result = await apiRequest(
        "/admin/quota-settings/apply-member-limits",
        {
          method: "POST",
          body: { limits: input.limits },
          schema: applyMemberCreditLimitsResultSchema,
        }
      )
      return { kind: input.kind, ...result }
    },
    onSuccess: async (result) => {
      setAction(null)
      setError(null)
      if (result.kind === "apply") {
        queryClient.setQueryData(quotaSettingsQueryKey, result.settings)
        setDraft((current) => ({
          ...current,
          weekly_credit_limit: result.settings.weekly_credit_limit ?? "",
        }))
      }
      notify.success(
        t(
          result.kind === "reset"
            ? "quotaManagement.resetSuccess"
            : "quotaManagement.applySuccess",
          { count: result.updated_user_count }
        )
      )
      const refreshed = await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
        onUsersChanged?.(),
      ])
      if (refreshed.some((result) => result.status === "rejected"))
        setError(t("quotaManagement.refreshFailed"))
    },
    onError: (cause) => {
      setAction(null)
      setError(getErrorMessage(cause, t))
    },
  })
  const pending = mutation.isPending || batchMutation.isPending

  function draftLimits(): CreditLimitSettings {
    return {
      weekly_credit_limit: draft.weekly_credit_limit.trim() || null,
    }
  }

  function stageApply() {
    const parsed = creditLimitSettingsSchema.safeParse(draftLimits())
    setError(null)
    if (!parsed.success) {
      setErrors({ weekly_credit_limit: t("quotaManagement.invalidAmount") })
      return
    }
    setErrors({})
    setAction({ kind: "apply", limits: parsed.data })
  }

  function submit(
    event: FormEvent<HTMLFormElement>,
    scope: keyof QuotaSettings
  ) {
    event.preventDefault()
    if (pending) return
    setError(null)
    const parsed = quotaSettingsSchema.safeParse({
      ...(queryClient.getQueryData<QuotaSettings>(quotaSettingsQueryKey) ??
        settings),
      [scope]:
        scope === "credit_price_cny"
          ? draft.credit_price_cny.trim()
          : draft.weekly_credit_limit.trim() || null,
    })
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join("."),
            t("quotaManagement.invalidAmount"),
          ])
        )
      )
      return
    }
    setErrors({})
    mutation.mutate({ scope, settings: parsed.data })
  }

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <form
        onSubmit={(event) => submit(event, "credit_price_cny")}
        noValidate
        aria-label={t("quotaManagement.conversionTitle")}
      >
        <SettingsCard
          header={
            <SettingsSectionHeader
              id={`${prefix}-conversion-title`}
              title={t("quotaManagement.conversionTitle")}
              description={t("quotaManagement.conversionDescription")}
            />
          }
        >
          <SettingsFieldGroup>
            <FieldShell
              id={`${prefix}-price`}
              label={t("quotaManagement.creditPrice")}
              hint={t("quotaManagement.conversionExample")}
              error={errors.credit_price_cny}
              layout="settings"
              controlWidth="compact"
            >
              <Input
                id={`${prefix}-price`}
                name="credit_price_cny"
                className="max-w-sm"
                inputMode="decimal"
                pattern={CREDIT_INPUT_PATTERN}
                value={draft.credit_price_cny}
                disabled={pending}
                aria-invalid={Boolean(errors.credit_price_cny)}
                aria-describedby={`${prefix}-price-hint ${prefix}-price-error`}
                onChange={(event) =>
                  setDraft({ ...draft, credit_price_cny: event.target.value })
                }
              />
            </FieldShell>
          </SettingsFieldGroup>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={pending}
              aria-busy={
                (mutation.isPending &&
                  mutation.variables?.scope === "credit_price_cny") ||
                undefined
              }
            >
              {mutation.isPending &&
                mutation.variables?.scope === "credit_price_cny" && (
                  <Spinner data-icon="inline-start" />
                )}
              {t("quotaManagement.save")}
            </Button>
          </div>
        </SettingsCard>
      </form>
      <form
        onSubmit={(event) => submit(event, "weekly_credit_limit")}
        noValidate
        aria-label={t("quotaManagement.members.title")}
      >
        <SettingsCard
          header={
            <SettingsSectionHeader
              id={`${prefix}-members-title`}
              title={t("quotaManagement.members.title")}
              description={t("quotaManagement.members.description")}
              action={
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("quotaManagement.members.actions")}
                        disabled={pending}
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
                        onClick={() => {
                          setError(null)
                          setAction({ kind: "reset" })
                        }}
                      >
                        <RotateCcwIcon aria-hidden="true" />
                        {t("quotaManagement.members.reset")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={stageApply}>
                        <ListChecksIcon aria-hidden="true" />
                        {t("quotaManagement.applyMembers")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          }
        >
          <SettingsFieldGroup>
            <FieldShell
              id={`${prefix}-weekly-credit-limit`}
              label={t("quotaManagement.weekly_credit_limit")}
              hint={t("quotaManagement.weekly_credit_limit_hint")}
              error={errors.weekly_credit_limit}
              layout="settings"
              controlWidth="compact"
            >
              <Input
                id={`${prefix}-weekly-credit-limit`}
                name="weekly_credit_limit"
                className="max-w-sm"
                inputMode="decimal"
                pattern={CREDIT_INPUT_PATTERN}
                value={draft.weekly_credit_limit}
                disabled={pending}
                aria-invalid={Boolean(errors.weekly_credit_limit)}
                aria-describedby={`${prefix}-weekly-credit-limit-hint ${prefix}-weekly-credit-limit-error`}
                placeholder={t("quotaManagement.unlimited")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    weekly_credit_limit: event.target.value,
                  })
                }
              />
            </FieldShell>
          </SettingsFieldGroup>
          <div className="flex flex-col items-stretch gap-3">
            <p className="text-sm text-muted-foreground">
              {t("quotaManagement.resetHint")}
            </p>
            <Button
              type="submit"
              className="self-end"
              disabled={pending}
              aria-busy={
                (mutation.isPending &&
                  mutation.variables?.scope === "weekly_credit_limit") ||
                undefined
              }
            >
              {mutation.isPending &&
                mutation.variables?.scope === "weekly_credit_limit" && (
                  <Spinner data-icon="inline-start" />
                )}
              {t("quotaManagement.save")}
            </Button>
          </div>
        </SettingsCard>
      </form>
      <p className="text-sm text-muted-foreground">
        {t("quotaManagement.enforcementHint")}
      </p>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
        title={
          action?.kind === "reset"
            ? t("quotaManagement.members.reset")
            : t("quotaManagement.applyMembers")
        }
        description={
          action?.kind === "reset"
            ? t("quotaManagement.members.resetDescription")
            : t("quotaManagement.applyDescription", {
                weekly:
                  action?.limits.weekly_credit_limit ??
                  t("quotaManagement.unlimited"),
              })
        }
        confirmLabel={t(
          action?.kind === "reset"
            ? "quotaManagement.confirmReset"
            : "quotaManagement.confirmApply"
        )}
        destructive={action?.kind === "reset"}
        pending={batchMutation.isPending}
        onConfirm={() => {
          if (action && !pending) batchMutation.mutate(action)
        }}
      />
    </div>
  )
}
