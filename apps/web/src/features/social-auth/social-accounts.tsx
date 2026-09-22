import { useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { socialAccountsSchema, type SocialProvider } from "@linksense/shared"
import { z } from "zod"
import { Link, useNavigate } from "react-router-dom"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { useAuth } from "@/app/auth-state"
import { SettingsFieldGroup } from "@/components/forms/form-field"
import { SettingsSectionHeader } from "@/components/settings/settings-section-header"
import { SettingsCard } from "@/components/settings/settings-card"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { StatusBanner } from "@/components/feedback/status-banner"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"
import { socialKeys, useSocialProviders, useSocialStart } from "./api"

export function SocialAccounts() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const providers = useSocialProviders()
  const accounts = useQuery({
    queryKey: socialKeys.accounts,
    queryFn: () =>
      apiRequest("/me/social-accounts", { schema: socialAccountsSchema }),
  })
  const start = useSocialStart(true)
  const [removing, setRemoving] = useState<SocialProvider | null>(null)
  const unlink = useMutation({
    mutationFn: (provider: SocialProvider) =>
      apiRequest(`/me/social-accounts/${provider}`, {
        method: "DELETE",
        schema: z.unknown(),
      }),
    onSuccess: async () => {
      await signOut()
      navigate("/login", { replace: true })
    },
  })
  const error = accounts.error ?? providers.error ?? start.error
  const all = [
    ...new Set([
      ...(providers.data ?? []),
      ...(accounts.data ?? []).map((account) => account.provider),
    ]),
  ]
  return (
    <SettingsCard
      aria-labelledby="social-accounts-title"
      header={
        <SettingsSectionHeader
          id="social-accounts-title"
          title={t("social.bindings")}
          description={t("social.bindingsHelp")}
        />
      }
    >
      <Link
        className="text-sm underline underline-offset-4"
        to="/forgot-password"
      >
        {t("social.setupPassword")}
      </Link>
      {accounts.isPending || providers.isPending ? <Spinner /> : null}
      {error && (
        <StatusBanner variant="error">
          {getErrorMessage(error, t)}{" "}
          <Button
            variant="ghost"
            onClick={() => {
              void accounts.refetch()
              void providers.refetch()
            }}
          >
            {t("common.retry")}
          </Button>
        </StatusBanner>
      )}
      {!error && !accounts.isPending && !providers.isPending && !all.length && (
        <p className="text-sm text-muted-foreground">
          {t("social.unavailable")}
        </p>
      )}
      <SettingsFieldGroup>
        {all.map((provider) => {
          const linked = accounts.data?.some(
            (account) => account.provider === provider
          )
          return (
            <div
              className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
              key={provider}
            >
              <span>
                {t(`social.providers.${provider}`)}
                {linked && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    {t("social.linked")}
                  </span>
                )}
              </span>
              <Button
                variant="outline"
                disabled={start.isPending || unlink.isPending}
                onClick={() =>
                  linked ? setRemoving(provider) : start.mutate(provider)
                }
              >
                {linked
                  ? t("social.unlink")
                  : t("social.link", {
                      provider: t(`social.providers.${provider}`),
                    })}
              </Button>
            </div>
          )
        })}
      </SettingsFieldGroup>
      <AlertDialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open && !unlink.isPending) {
            setRemoving(null)
            unlink.reset()
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("social.unlinkTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("social.unlinkDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {unlink.error && (
            <StatusBanner variant="error">
              {getErrorMessage(unlink.error, t)}
            </StatusBanner>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlink.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={unlink.isPending}
              onClick={() => {
                if (removing) unlink.mutate(removing)
              }}
            >
              {unlink.isPending && <Spinner data-icon="inline-start" />}
              {t("social.unlink")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}
