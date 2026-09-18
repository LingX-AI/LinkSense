import { useQuery } from "@tanstack/react-query"
import { SparklesIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { Conversation } from "@/api/contracts"
import { useProductName } from "@/app/product-branding"
import { conversationDetailQueryOptions } from "@/features/conversations/conversation-detail-query"
import "./application-development-glow.css"

function isDevelopmentExecuting(conversation: Conversation): boolean {
  if (
    conversation.execution_status !== "running" ||
    conversation.running_turn?.status !== "running"
  )
    return false
  const awaitingInput = conversation.user_input_requests?.some(
    (request) =>
      request.kind !== "async_questions" &&
      (request.status === "pending" || request.status === "answering")
  )
  const awaitingPlan = conversation.plan_reviews?.some(
    (review) => review.status === "pending"
  )
  return !awaitingInput && !awaitingPlan
}

export function ApplicationDevelopmentGlow({
  conversationId,
  visible,
}: {
  conversationId: string | null
  visible: boolean
}) {
  const { t } = useTranslation()
  const productName = useProductName()
  // Observe the development chat's existing cache. Preview/debug runs and
  // optimistic submissions must not imply that the developer agent is running.
  const { data: executing } = useQuery({
    ...conversationDetailQueryOptions(conversationId ?? undefined),
    enabled: false,
    select: isDevelopmentExecuting,
  })
  const active = Boolean(conversationId && visible && executing)
  return (
    <>
      <div
        aria-hidden="true"
        data-active={active}
        className="application-development-glow pointer-events-none absolute inset-0 z-40"
      />
      <span
        role="status"
        aria-hidden={!active}
        className="application-development-takeover pointer-events-none absolute bottom-6 left-1/2 isolate z-40 inline-flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2.5 overflow-hidden rounded-full px-5 py-3 text-sm font-medium whitespace-nowrap shadow-(--app-selection)/20 shadow-lg"
      >
        <SparklesIcon
          aria-hidden="true"
          className="application-development-takeover-icon relative size-5 shrink-0"
        />
        <span className="relative min-w-0 truncate">
          {active ? t("applicationDevelopment.aiWorking", { productName }) : ""}
        </span>
      </span>
    </>
  )
}
