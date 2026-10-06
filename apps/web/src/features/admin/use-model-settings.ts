import type { ModelSettingsDraft } from "./model-settings-draft"
import { useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { updateModelProviderSettingsSchema } from "@linksense/shared"
import { apiRequest } from "@/api/client"
import {
  modelProviderSettingsUpdateResultSchema,
  type ModelProviderSettings,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { notify } from "@/components/feedback/notification"

type ModelSettingsAction =
  | { kind: "save"; draft: ModelSettingsDraft; onSaved?: () => void }
  | { kind: "availability"; modelId: string; enabled: boolean }
  | { kind: "deleteModel"; modelId: string; onSaved: () => void }
  | { kind: "deleteChannel"; channelId: string; onSaved: () => void }

export function useModelSettings(initial: ModelProviderSettings) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState(initial)
  const savedRef = useRef(initial)
  const lockedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (action: ModelSettingsAction) => {
      const revision = savedRef.current.revision
      const request =
        action.kind === "save"
          ? {
              path: "",
              method: "PUT" as const,
              body: updateModelProviderSettingsSchema.parse({
                ...action.draft,
                expected_revision: revision,
              }),
            }
          : action.kind === "availability"
            ? {
                path: "/models/availability",
                method: "PATCH" as const,
                body: {
                  expected_revision: revision,
                  model_id: action.modelId,
                  enabled: action.enabled,
                },
              }
            : action.kind === "deleteModel"
              ? {
                  path: "/models",
                  method: "DELETE" as const,
                  body: {
                    expected_revision: revision,
                    model_id: action.modelId,
                  },
                }
              : {
                  path: "/providers",
                  method: "DELETE" as const,
                  body: {
                    expected_revision: revision,
                    provider_id: action.channelId,
                  },
                }
      return apiRequest(`/admin/model-provider-settings${request.path}`, {
        method: request.method,
        body: request.body,
        schema: modelProviderSettingsUpdateResultSchema,
      })
    },
    onSuccess: async (result, action) => {
      const next = {
        ...result.settings,
        management_enabled: initial.management_enabled,
      }
      savedRef.current = next
      setSettings(next)
      queryClient.setQueryData(["admin", "model-provider-settings"], next)
      setError(null)
      if (action.kind !== "availability") {
        action.onSaved?.()
        notify.success(
          t(
            action.kind === "deleteModel"
              ? "admin.modelProvider.modelDeleted"
              : action.kind === "deleteChannel"
                ? "admin.modelProvider.providerDeleted"
                : "admin.modelProvider.saved"
          ),
          { id: "model-provider-settings-saved" }
        )
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["admin", "model-provider-settings"],
          refetchType: "none",
        }),
        queryClient.invalidateQueries({ queryKey: ["me", "model-preference"] }),
      ])
    },
    onError: (error) => setError(getErrorMessage(error, t)),
    onSettled: () => {
      lockedRef.current = false
    },
  })
  function execute(action: ModelSettingsAction): void {
    if (initial.management_enabled === false || lockedRef.current) return
    lockedRef.current = true
    setError(null)
    mutation.mutate(action)
  }
  return {
    settings,
    pending: mutation.isPending,
    error,
    execute,
    clearError: () => setError(null),
  }
}
