import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { userEnvironmentSettingsSchema } from "@linksense/shared"
import { useTranslation } from "react-i18next"

import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { Switch } from "@/components/ui/switch"

const queryKey = ["me", "environment"] as const

export function UserEnvironmentSettings() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey,
    queryFn: () =>
      apiRequest("/me/environment", { schema: userEnvironmentSettingsSchema }),
  })
  const mutation = useMutation({
    mutationFn: (keep_running: boolean) =>
      apiRequest("/me/environment", {
        method: "PUT",
        body: { keep_running },
        schema: userEnvironmentSettingsSchema,
      }),
    onSuccess: (settings) => queryClient.setQueryData(queryKey, settings),
  })
  const error = mutation.error ?? query.error
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-labelledby="user-environment-heading"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 id="user-environment-heading" className="font-medium">
            {t("settings.keepEnvironmentRunning")}
          </h3>
          <p
            id="user-environment-description"
            className="text-sm text-muted-foreground"
          >
            {t("settings.keepEnvironmentRunningDescription")}
          </p>
        </div>
        <Switch
          checked={query.data?.keep_running ?? false}
          disabled={!query.data || query.isFetching || mutation.isPending}
          aria-labelledby="user-environment-heading"
          aria-describedby="user-environment-description"
          onCheckedChange={(value) => mutation.mutate(value)}
        />
      </div>
      {query.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("common.loading")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {getErrorMessage(error, t)}
        </p>
      )}
    </section>
  )
}
