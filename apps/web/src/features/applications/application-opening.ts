import { createRandomUuid } from "@/lib/random-uuid"
import { useRef } from "react"
import {
  useMutation,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { z } from "zod"
import {
  applicationConversationSchema,
  applicationDevelopmentSchema,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { useAuth } from "@/app/auth-state"
import { projectKeys } from "@/features/projects/project-api"
import { applicationDevelopmentKeys } from "./application-development-api"
import { preloadApplicationDestination } from "./application-page-loaders"

const developmentInputSchema = z.union([
  z.object({ developmentId: z.string() }),
  z.object({ applicationId: z.string() }),
  z.object({ name: z.string() }),
])
export type DevelopmentOpeningInput = z.infer<typeof developmentInputSchema>
const openingInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("development"), input: developmentInputSchema }),
  z.object({
    type: z.literal("use"),
    applicationId: z.string(),
    kind: z.enum(["standard", "interactive"]),
    channel: z.enum(["direct", "center"]),
  }),
])
type OpeningInput = z.infer<typeof openingInputSchema>
const requestSchema = z.object({
  id: z.string(),
  userId: z.string(),
  input: openingInputSchema,
})
const resultSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("development"),
    project: applicationDevelopmentSchema.extend({ conversation_id: z.uuid() }),
  }),
  z.object({ type: z.literal("use"), conversation_id: z.uuid() }),
])
type OpeningResult = z.infer<typeof resultSchema>
const openingKey = (userId: string | undefined) =>
  ["application-opening", userId] as const

async function prepareApplication(input: OpeningInput): Promise<OpeningResult> {
  if (input.type === "use") {
    const result = await apiRequest(
      `/applications/${input.applicationId}/conversations`,
      {
        method: "POST",
        body: { channel: input.channel },
        schema: applicationConversationSchema,
      }
    )
    return { type: "use", conversation_id: result.conversation_id }
  }
  const source = input.input
  const path =
    "developmentId" in source
      ? `/application-developments/${source.developmentId}/resume`
      : "applicationId" in source
        ? `/application-developments/by-application/${source.applicationId}`
        : "/application-developments"
  const project = await apiRequest(path, {
    method: "POST",
    ...("name" in source ? { body: source } : {}),
    schema: applicationDevelopmentSchema.extend({ conversation_id: z.uuid() }),
  })
  return { type: "development", project }
}

export function useStartApplicationOpening() {
  const { user } = useAuth()
  const client = useQueryClient()
  const navigate = useNavigate()
  const pending = useRef(false)
  const mutation = useMutation({
    mutationKey: openingKey(user?.id),
    retry: false,
    mutationFn: (request: z.infer<typeof requestSchema>) =>
      prepareApplication(request.input),
    onSuccess: (result, request) => {
      if (result.type === "development") {
        client.setQueryData(
          applicationDevelopmentKeys.conversation(
            request.userId,
            result.project.conversation_id
          ),
          result.project
        )
        void client.invalidateQueries({ queryKey: ["applications"] })
        void client.invalidateQueries({ queryKey: projectKeys.all })
      }
      void client.invalidateQueries({ queryKey: ["conversations"] })
    },
    onSettled: () => {
      pending.current = false
    },
  })
  return {
    error: mutation.error,
    isPending: mutation.isPending,
    variables: mutation.variables?.input,
    mutate: (input: OpeningInput) => {
      if (!user || pending.current) return
      pending.current = true
      const id = createRandomUuid()
      // Start only from user actions; loading-page remounts must not create tasks.
      mutation.mutate({ id, userId: user.id, input })
      void navigate(`/applications/open/${id}`)
      preloadApplicationDestination(
        input.type === "use" && input.kind === "interactive"
      )
    },
  }
}

export function useOpenApplicationDevelopment() {
  const opening = useStartApplicationOpening()
  return {
    ...opening,
    mutate: (input: DevelopmentOpeningInput) =>
      opening.mutate({ type: "development", input }),
  }
}

export function useOpenApplicationConversation(
  channel: "direct" | "center" = "direct"
) {
  const opening = useStartApplicationOpening()
  return {
    ...opening,
    variables:
      opening.variables?.type === "use" ? opening.variables : undefined,
    mutate: (application: { id: string; kind: "standard" | "interactive" }) =>
      opening.mutate({
        type: "use",
        applicationId: application.id,
        kind: application.kind,
        channel,
      }),
  }
}

export function useApplicationOpening(id: string | undefined) {
  const { user } = useAuth()
  const states = useMutationState({
    filters: { mutationKey: openingKey(user?.id), exact: true },
    select: (mutation) => {
      const request = requestSchema.safeParse(mutation.state.variables)
      if (!request.success || request.data.id !== id) return null
      return {
        input: request.data.input,
        status: mutation.state.status,
        error: mutation.state.error,
        result: resultSchema.safeParse(mutation.state.data).data,
      }
    },
  })
  return states.find((state) => state !== null)
}
