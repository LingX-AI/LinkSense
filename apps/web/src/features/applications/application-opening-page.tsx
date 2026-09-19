import { Navigate, useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { Button } from "@/components/ui/button"
import {
  useApplicationOpening,
  useStartApplicationOpening,
} from "./application-opening"

export function ApplicationOpeningPage() {
  const { openingId } = useParams()
  const state = useApplicationOpening(openingId)
  const retry = useStartApplicationOpening()
  const navigate = useNavigate()
  const { t } = useTranslation()
  if (state?.status === "success" && state.result) {
    const target =
      state.result.type === "development"
        ? `/conversations/${state.result.project.conversation_id}`
        : state.input.type === "use" && state.input.kind === "interactive"
          ? `/applications/${state.input.applicationId}/run/${state.result.conversation_id}`
          : `/conversations/${state.result.conversation_id}`
    return <Navigate to={target} replace />
  }
  if (!state || state.status === "error" || state.status === "success") {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-6">
        <ErrorState
          message={
            state?.error
              ? getErrorMessage(state.error, t)
              : t("applications.opening.expired")
          }
          onRetry={
            state?.status === "error"
              ? () => retry.mutate(state.input)
              : undefined
          }
        />
        <Button
          variant="outline"
          onClick={() =>
            void navigate("/capabilities?section=application&scope=personal", {
              replace: true,
            })
          }
        >
          {t("applications.opening.back")}
        </Button>
      </div>
    )
  }
  return <LoadingState fill />
}
