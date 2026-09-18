import { useCallback, useRef } from "react"
import type { ApplicationAnnotationSubmit } from "@/features/applications/application-annotation-submission"
import { useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { applicationDevelopmentSchema } from "@linksense/shared"
import { useAuth } from "@/app/auth-state"
import { apiRequest } from "@/api/client"
import { ConversationPage } from "./conversation-pages"
import { ApplicationDevelopmentLayout } from "@/features/applications/application-development-layout"
import { ApplicationDevelopmentPanel } from "@/features/applications/application-development-panel"
import { applicationDevelopmentKeys } from "@/features/applications/application-development-api"

export function ConversationWorkspace() {
  const { conversationId } = useParams()
  const annotationSubmitRef = useRef<ApplicationAnnotationSubmit | null>(null)
  const submitAnnotations = useCallback<ApplicationAnnotationSubmit>(
    async (input) => {
      if (!annotationSubmitRef.current)
        throw new Error("development_conversation_unavailable")
      await annotationSubmitRef.current(input)
    },
    []
  )
  const { user } = useAuth()
  const development = useQuery({
    queryKey: applicationDevelopmentKeys.conversation(user?.id, conversationId),
    queryFn: ({ signal }) =>
      apiRequest(
        `/application-developments/by-conversation/${conversationId}`,
        { schema: applicationDevelopmentSchema.nullable(), signal }
      ),
    enabled: Boolean(user && conversationId && conversationId !== "new"),
    refetchInterval: (query) => (query.state.data ? false : 3000),
    retry: false,
  })
  return (
    <ApplicationDevelopmentLayout
      preview={
        development.data ? (
          <ApplicationDevelopmentPanel
            key={development.data.id}
            initial={development.data}
            onSubmitAnnotations={submitAnnotations}
          />
        ) : undefined
      }
    >
      <ConversationPage
        development={Boolean(development.data)}
        annotationSubmitRef={annotationSubmitRef}
      />
    </ApplicationDevelopmentLayout>
  )
}
