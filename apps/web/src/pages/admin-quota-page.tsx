import { useId, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  quotaSettingsSchema,
  creditLimitSettingsSchema,
  quotaBatchResultSchema,
  applyOrganizationCreditLimitsResultSchema,
  type QuotaMemberScope,
  CREDIT_INPUT_PATTERN,
  type QuotaSettings,
  type CreditLimitSettings,
} from "@linksense/shared"
import { useTranslation } from "react-i18next"
import { ListChecksIcon, RotateCcwIcon } from "lucide-react"
import { z } from "zod"

import { useAuth } from "@/app/auth-state"
import { ConfirmDialog } from "@/components/feedback/confirm-dialog"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { PageLayout } from "@/components/shell/page-layout"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

const quotaSettingsQueryKey = ["admin", "quota-settings"] as const
const updateResultSchema = z.strictObject({
  code: z.literal("SYSTEM_SETTINGS_UPDATED"),
  settings: quotaSettingsSchema,
})
const quotaPeriods = [
  "weekly_credit_limit",
  "monthly_credit_limit",
  "total_credit_limit",
] as const
const memberGroups = ["organization_members", "self_registered_users"] as const

type QuotaAction =
  | { kind: "reset"; scope: QuotaMemberScope }
  | { kind: "apply"; limits: CreditLimitSettings }

type QuotaDraft = {
  credit_price_cny: string
  organization_members: Record<keyof CreditLimitSettings, string>
  self_registered_users: Record<keyof CreditLimitSettings, string>
}

function quotaDraft(settings: QuotaSettings): QuotaDraft {
  const limits = (value: CreditLimitSettings) => ({
    total_credit_limit: value.total_credit_limit ?? "",
    weekly_credit_limit: value.weekly_credit_limit ?? "",
    monthly_credit_limit: value.monthly_credit_limit ?? "",
  })
  return {
    credit_price_cny: settings.credit_price_cny,
    organization_members: limits(settings.organization_members),
    self_registered_users: limits(settings.self_registered_users),
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
    mutationFn: (input: QuotaSettings) =>
      apiRequest("/admin/quota-settings", {
        method: "PUT",
        body: input,
        schema: updateResultSchema,
      }),
    onSuccess: async (result) => {
      setDraft(quotaDraft(result.settings))
      queryClient.setQueryData(quotaSettingsQueryKey, result.settings)
      notify.success(t("quotaManagement.saved"))
      await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
    },
    onError: (cause) => setError(getErrorMessage(cause, t)),
  })

  const batchMutation = useMutation({
    mutationFn: async (input: QuotaAction) => {
      if (input.kind === "reset") {
        const result = await apiRequest("/admin/quota-settings/reset", {
          method: "POST",
          body: { scope: input.scope },
          schema: quotaBatchResultSchema,
        })
        return { kind: input.kind, ...result }
      }
      const result = await apiRequest(
        "/admin/quota-settings/apply-organization-limits",
        {
          method: "POST",
          body: { limits: input.limits },
          schema: applyOrganizationCreditLimitsResultSchema,
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
          organization_members: quotaDraft(result.settings)
            .organization_members,
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

  function draftLimits(value: QuotaDraft["organization_members"]) {
    return {
      total_credit_limit: value.total_credit_limit.trim() || null,
      weekly_credit_limit: value.weekly_credit_limit.trim() || null,
      monthly_credit_limit: value.monthly_credit_limit.trim() || null,
    }
  }

  function stageApply() {
    const parsed = creditLimitSettingsSchema.safeParse(
      draftLimits(draft.organization_members)
    )
    setError(null)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            `organization_members.${issue.path.join(".")}`,
            t("quotaManagement.invalidAmount"),
          ])
        )
      )
      return
    }
    setErrors({})
    setAction({ kind: "apply", limits: parsed.data })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    const parsed = quotaSettingsSchema.safeParse({
      credit_price_cny: draft.credit_price_cny.trim(),
      organization_members: draftLimits(draft.organization_members),
      self_registered_users: draftLimits(draft.self_registered_users),
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
    mutation.mutate(parsed.data)
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-5">
      {error && <StatusBanner variant="error">{error}</StatusBanner>}
      <Card>
        <CardHeader>
          <CardTitle>{t("quotaManagement.conversionTitle")}</CardTitle>
          <CardDescription>
            {t("quotaManagement.conversionDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field
              data-invalid={Boolean(errors.credit_price_cny)}
              data-disabled={pending}
            >
              <FieldLabel htmlFor={`${prefix}-price`}>
                {t("quotaManagement.creditPrice")}
              </FieldLabel>
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
              <FieldDescription id={`${prefix}-price-hint`}>
                {t("quotaManagement.conversionExample")}
              </FieldDescription>
              <FieldError id={`${prefix}-price-error`}>
                {errors.credit_price_cny}
              </FieldError>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      {memberGroups.map((group) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle>{t(`quotaManagement.${group}.title`)}</CardTitle>
            <CardDescription>
              {t(`quotaManagement.${group}.description`)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid grid-cols-1 gap-5 md:grid-cols-3">
              {quotaPeriods.map((period) => {
                const key = `${group}.${period}`
                const id = `${prefix}-${group}-${period}`
                return (
                  <Field
                    key={period}
                    data-invalid={Boolean(errors[key])}
                    data-disabled={pending}
                  >
                    <FieldLabel htmlFor={id}>
                      {t(`quotaManagement.${period}`)}
                    </FieldLabel>
                    <Input
                      id={id}
                      name={key}
                      inputMode="decimal"
                      pattern={CREDIT_INPUT_PATTERN}
                      value={draft[group][period]}
                      disabled={pending}
                      aria-invalid={Boolean(errors[key])}
                      aria-describedby={`${id}-hint ${id}-error`}
                      placeholder={t("quotaManagement.unlimited")}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          [group]: {
                            ...draft[group],
                            [period]: event.target.value,
                          },
                        })
                      }
                    />
                    <FieldDescription id={`${id}-hint`}>
                      {t(`quotaManagement.${period}_hint`)}
                    </FieldDescription>
                    <FieldError id={`${id}-error`}>{errors[key]}</FieldError>
                  </Field>
                )
              })}
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              {t("quotaManagement.resetHint")}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setError(null)
                  setAction({ kind: "reset", scope: group })
                }}
              >
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                {t(`quotaManagement.${group}.reset`)}
              </Button>
              {group === "organization_members" && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={stageApply}
                >
                  <ListChecksIcon data-icon="inline-start" aria-hidden="true" />
                  {t("quotaManagement.applyOrganization")}
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>
      ))}
      <p className="text-sm text-muted-foreground">
        {t("quotaManagement.enforcementHint")}
      </p>
      <Button
        className="self-start"
        type="submit"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending && <Spinner data-icon="inline-start" />}
        {t("common.save")}
      </Button>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null)
        }}
        title={
          action?.kind === "reset"
            ? t(`quotaManagement.${action.scope}.reset`)
            : t("quotaManagement.applyOrganization")
        }
        description={
          action?.kind === "reset"
            ? t(`quotaManagement.${action.scope}.resetDescription`)
            : t("quotaManagement.applyDescription", {
                weekly:
                  action?.limits.weekly_credit_limit ??
                  t("quotaManagement.unlimited"),
                monthly:
                  action?.limits.monthly_credit_limit ??
                  t("quotaManagement.unlimited"),
                total:
                  action?.limits.total_credit_limit ??
                  t("quotaManagement.unlimited"),
              })
        }
        confirmLabel={t(
          action?.kind === "reset"
            ? "quotaManagement.confirmReset"
            : "quotaManagement.confirmApply"
        )}
        pending={batchMutation.isPending}
        onConfirm={() => {
          if (action && !pending) batchMutation.mutate(action)
        }}
      />
    </form>
  )
}
