import { useId, useMemo, useState, type FormEvent } from "react"
import {
  BanIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
} from "lucide-react"
import ReactMarkdown, { type Components } from "react-markdown"
import { useTranslation } from "react-i18next"
import remarkGfm from "remark-gfm"

import type { ConversationUserInputResponse } from "@linksense/shared"

import type { ConversationUserInputRequest } from "@/api/contracts"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ConversationStructuredUserInputForm } from "@/features/conversations/conversation-structured-user-input-form"
import { ConversationUserInputRequestFooter } from "@/features/conversations/conversation-user-input-request-footer"
import {
  assistantMarkdownUrlTransform,
  getSafeAssistantMarkdownLinkUrl,
} from "@/features/conversations/assistant-markdown-image-utils"
import {
  getConversationUserInputDisplayStatus,
  isTerminalUserInputDisplayStatus,
  type ConversationUserInputDisplayStatus,
} from "@/features/conversations/conversation-user-input-request-status"
import { cn } from "@/lib/utils"

const otherChoice = "__linksense_other__"
const optionChoice = (index: number) => `option:${index}`

type ConversationUserInputRequestCardProps = Readonly<{
  request: ConversationUserInputRequest
  submitting: boolean
  onSubmit?: (response: ConversationUserInputResponse) => void
  onInteractionStart?: () => void
}>

export function ConversationUserInputRequestCard({
  request,
  submitting,
  onSubmit,
  onInteractionStart,
}: ConversationUserInputRequestCardProps) {
  const { t } = useTranslation()
  const formId = useId()
  const disabled =
    submitting ||
    (request.status !== "pending" &&
      !(request.kind === "async_questions" && request.status === "answering"))
  const displayStatus = submitting
    ? "submitting"
    : getConversationUserInputDisplayStatus(request)
  const terminal = isTerminalUserInputDisplayStatus(displayStatus)

  return (
    <Card
      size="sm"
      className={cn(
        "mr-auto w-full data-[size=sm]:[--card-spacing:--spacing(3)]",
        request.kind === "form" ? "max-w-none" : "max-w-2xl"
      )}
      role="region"
      tabIndex={-1}
      aria-labelledby={`${formId}-title`}
      data-testid="conversation-user-input-request"
      data-request-kind={request.kind}
      data-request-status={displayStatus}
      onPointerDownCapture={onInteractionStart}
    >
      <CardHeader className="shrink-0">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <CardTitle
            id={`${formId}-title`}
            role="heading"
            aria-level={3}
            className="flex min-w-0 items-center gap-2 text-sm"
          >
            <MessageCircleQuestionIcon
              className="size-4 shrink-0"
              aria-hidden="true"
            />
            {t(
              request.kind === "form"
                ? terminal
                  ? "conversation.userInput.formResultTitle"
                  : "conversation.userInput.formTitle"
                : "conversation.userInput.title"
            )}
          </CardTitle>
          <UserInputStatusBadge status={displayStatus} />
        </div>
        <CardDescription className="min-w-0 text-xs leading-4">
          {request.kind === "form" ? (
            <UserInputRequestMarkdownDescription content={request.message} />
          ) : (
            t(
              request.kind === "async_questions"
                ? "conversation.userInput.asyncDescription"
                : request.auto_resolve_at
                  ? "conversation.userInput.autoResolveDescription"
                  : "conversation.userInput.description"
            )
          )}
        </CardDescription>
      </CardHeader>
      {request.kind === "form" ? (
        <ConversationStructuredUserInputForm
          key={`${request.id}:${request.status}:${request.updated_at}`}
          request={request}
          formId={formId}
          disabled={disabled}
          submitting={submitting}
          terminal={terminal}
          onSubmit={(response) => onSubmit?.(response)}
        />
      ) : (
        <QuestionUserInputForm
          key={`${request.id}:${request.status}:${request.updated_at}`}
          request={request}
          formId={formId}
          disabled={disabled}
          submitting={submitting}
          onSubmit={(response) => onSubmit?.(response)}
        />
      )}
    </Card>
  )
}

const userInputRequestMarkdownComponents: Components = {
  a: ({ node, href, children, ...props }) => {
    void node
    const safeHref = getSafeAssistantMarkdownLinkUrl(href)
    if (!safeHref) return <span>{children}</span>
    return (
      <a {...props} href={safeHref} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    )
  },
  img: ({ node, alt }) => {
    void node
    return alt ? <span>{alt}</span> : null
  },
}

const userInputRequestRemarkPlugins = [remarkGfm]

function UserInputRequestMarkdownDescription({ content }: { content: string }) {
  return (
    <div className="assistant-markdown conversation-user-input-request-description-markdown">
      <ReactMarkdown
        remarkPlugins={userInputRequestRemarkPlugins}
        components={userInputRequestMarkdownComponents}
        skipHtml
        urlTransform={assistantMarkdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function UserInputStatusBadge({
  status,
}: {
  status: ConversationUserInputDisplayStatus
}) {
  const { t } = useTranslation()
  const Icon =
    status === "pending"
      ? MessageCircleQuestionIcon
      : status === "submitting"
        ? LoaderCircleIcon
        : status === "submitted" || status === "approved"
          ? CircleCheckIcon
          : status === "rejected"
            ? CircleXIcon
            : status === "expired"
              ? Clock3Icon
              : BanIcon
  return (
    <Badge
      variant={status === "rejected" ? "destructive" : "secondary"}
      className="shrink-0 rounded-full"
      role="status"
    >
      <Icon
        data-icon="inline-start"
        className={status === "submitting" ? "animate-spin" : undefined}
        aria-hidden="true"
      />
      {t(`conversation.userInput.status.${status}`)}
    </Badge>
  )
}

function QuestionUserInputForm({
  request,
  formId,
  disabled,
  submitting,
  onSubmit,
}: {
  request: Extract<
    ConversationUserInputRequest,
    { kind: "questions" | "async_questions" }
  >
  formId: string
  disabled: boolean
  submitting: boolean
  onSubmit: (response: ConversationUserInputResponse) => void
}) {
  const { t } = useTranslation()
  const savedAnswers =
    request.kind === "async_questions" ? request.response_content : null
  const fieldsDisabled = disabled || savedAnswers !== null
  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      request.questions.flatMap((question) => {
        const saved = savedAnswers?.[question.id]
        if (typeof saved === "string") {
          const index =
            question.options?.findIndex((option) => option.label === saved) ??
            -1
          return [[question.id, index >= 0 ? optionChoice(index) : otherChoice]]
        }
        return request.kind === "async_questions" && question.options?.length
          ? [[question.id, optionChoice(0)]]
          : []
      })
    )
  )
  const [freeformAnswers, setFreeformAnswers] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      Object.entries(savedAnswers ?? {}).flatMap(([id, value]) =>
        typeof value === "string" ? [[id, value]] : []
      )
    )
  )

  const answers = useMemo(
    () =>
      Object.fromEntries(
        request.questions.flatMap((question) => {
          const options = question.options ?? []
          const selection = selections[question.id]
          const selectedOptionIndex = selection?.startsWith("option:")
            ? Number.parseInt(selection.slice("option:".length), 10)
            : -1
          const selectedOption = Number.isInteger(selectedOptionIndex)
            ? options[selectedOptionIndex]
            : undefined
          const answer =
            options.length === 0 || selection === otherChoice
              ? freeformAnswers[question.id]
              : selectedOption?.label
          return answer?.trim() ? [[question.id, answer]] : []
        })
      ),
    [freeformAnswers, request.questions, selections]
  )
  const complete = request.questions.every(
    (question) => typeof answers[question.id] === "string"
  )

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!disabled && complete) {
      onSubmit({ action: "accept", content: answers })
    }
  }

  return (
    <form
      className="-mb-(--card-spacing) flex min-h-0 flex-1 flex-col gap-0"
      onSubmit={handleSubmit}
    >
      <CardContent className="pb-(--card-spacing)">
        <FieldGroup className="gap-4">
          {request.questions.map((question, questionIndex) => {
            const options = question.options ?? []
            const selection = selections[question.id]
            const inputId = `${formId}-question-${questionIndex}`
            const needsFreeform =
              options.length === 0 || selection === otherChoice

            return (
              <FieldSet
                key={question.id}
                className="min-w-0 gap-2.5"
                disabled={fieldsDisabled}
              >
                <FieldLegend variant="label" className="mb-1.5 w-full">
                  {request.kind !== "async_questions" && (
                    <span className="block text-xs font-semibold text-[var(--app-muted)]">
                      {question.header}
                    </span>
                  )}
                  <span className="mt-0.5 block text-sm leading-5 text-[var(--app-text)]">
                    {question.question}
                  </span>
                </FieldLegend>

                {options.length > 0 && (
                  <RadioGroup
                    disabled={fieldsDisabled}
                    value={selection ?? ""}
                    onValueChange={(value) =>
                      setSelections((current) => ({
                        ...current,
                        [question.id]: value,
                      }))
                    }
                    className="gap-2"
                  >
                    {options.map((option, optionIndex) => {
                      const optionId = `${inputId}-option-${optionIndex}`
                      return (
                        <Label
                          key={`${option.label}:${optionIndex}`}
                          htmlFor={optionId}
                          className="flex cursor-pointer items-start gap-3 rounded-xl bg-background/30 px-3 py-2.5 transition-colors has-data-[checked]:bg-muted/50"
                        >
                          <RadioGroupItem
                            id={optionId}
                            value={optionChoice(optionIndex)}
                            disabled={fieldsDisabled}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--app-text)]">
                              {option.label}
                            </span>
                            {option.description && (
                              <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                                {option.description}
                              </span>
                            )}
                          </span>
                        </Label>
                      )
                    })}
                    {question.is_other && (
                      <Label
                        htmlFor={`${inputId}-other`}
                        className="flex cursor-pointer items-center gap-3 rounded-xl bg-background/30 px-3 py-2.5 transition-colors has-data-[checked]:bg-muted/50"
                      >
                        <RadioGroupItem
                          id={`${inputId}-other`}
                          value={otherChoice}
                          disabled={fieldsDisabled}
                        />
                        <span className="text-sm font-medium text-[var(--app-text)]">
                          {t("conversation.userInput.other")}
                        </span>
                      </Label>
                    )}
                  </RadioGroup>
                )}

                {needsFreeform && (
                  <Field
                    className="gap-1.5"
                    data-disabled={fieldsDisabled || undefined}
                  >
                    <FieldLabel
                      htmlFor={`${inputId}-answer`}
                      className="sr-only"
                    >
                      {question.question}
                    </FieldLabel>
                    <Input
                      id={`${inputId}-answer`}
                      type={question.is_secret ? "password" : "text"}
                      autoComplete="off"
                      disabled={fieldsDisabled}
                      value={freeformAnswers[question.id] ?? ""}
                      onChange={(event) =>
                        setFreeformAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))
                      }
                      maxLength={4_000}
                      placeholder={t(
                        "conversation.userInput.answerPlaceholder"
                      )}
                    />
                    {question.is_secret && (
                      <FieldDescription className="text-xs leading-5">
                        {t("conversation.userInput.secretDescription")}
                      </FieldDescription>
                    )}
                  </Field>
                )}
              </FieldSet>
            )
          })}
        </FieldGroup>
      </CardContent>
      <ConversationUserInputRequestFooter
        disabled={disabled}
        cancelDisabled={fieldsDisabled}
        complete={complete}
        submitting={submitting}
        onCancel={() => onSubmit({ action: "cancel" })}
      />
    </form>
  )
}
