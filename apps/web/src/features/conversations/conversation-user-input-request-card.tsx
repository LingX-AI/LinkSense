import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react"
import {
  BanIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  Clock3Icon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
  ShieldAlertIcon,
} from "lucide-react"
import { fromMarkdown } from "mdast-util-from-markdown"
import { toString } from "mdast-util-to-string"
import ReactMarkdown, { type Components } from "react-markdown"
import { useTranslation } from "react-i18next"
import remarkGfm from "remark-gfm"

import {
  computerActToolName,
  type BrowserUseApproval,
  type ConversationUserInputResponse,
  type DesktopApprovalRequest,
} from "@linksense/shared"

import type {
  ConversationUserInputRequest,
  ConversationUserInputRequestView,
} from "@/api/contracts"
import { RequiredIndicator } from "@/components/forms/required-indicator"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  RadioGroup,
  RadioGroupItem,
  RadioGroupOption,
} from "@/components/ui/radio-group"
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
const computerActApprovalQuestionIdPrefix = "mcp_tool_call_approval_"

type ComputerActApprovalQuestionKey =
  | "desktopComputerUse.approvalQuestion"
  | "desktopComputerUse.approvalClickQuestion"
  | "desktopComputerUse.approvalTypeQuestion"

type DesktopApprovalDecision = NonNullable<
  DesktopApprovalRequest["resolved_action"]
>

type ConversationUserInputRequestCardProps = Readonly<{
  request: ConversationUserInputRequestView
  browserApproval?: BrowserUseApproval
  submitting: boolean
  onSubmit?: (response: ConversationUserInputResponse) => void
  onApprovalDecision?: (
    request: DesktopApprovalRequest,
    decision: DesktopApprovalDecision
  ) => void
  onInteractionStart?: () => void
}>

export function ConversationUserInputRequestCard({
  request,
  browserApproval,
  submitting,
  onSubmit,
  onApprovalDecision,
  onInteractionStart,
}: ConversationUserInputRequestCardProps) {
  const { t } = useTranslation()
  const formId = useId()
  const disabled =
    submitting ||
    (request.status !== "pending" &&
      !(
        (request.kind === "async_questions" || request.kind === "form") &&
        request.status === "answering"
      ))
  const displayStatus = submitting
    ? "submitting"
    : getConversationUserInputDisplayStatus(request)
  const terminal = isTerminalUserInputDisplayStatus(displayStatus)

  const card = (
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
            {request.kind === "desktop_approval" ? (
              <ShieldAlertIcon
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            ) : (
              <MessageCircleQuestionIcon
                className="size-3.5 shrink-0"
                aria-hidden="true"
              />
            )}
            {t(
              request.kind === "form"
                ? terminal
                  ? "conversation.userInput.formResultTitle"
                  : "conversation.userInput.formTitle"
                : request.kind === "desktop_approval"
                  ? request.approval.method ===
                    "item/commandExecution/requestApproval"
                    ? "desktopApproval.titleCommand"
                    : "desktopApproval.titleFileChange"
                  : "conversation.userInput.title"
            )}
          </CardTitle>
          <UserInputStatusBadge status={displayStatus} />
        </div>
        <CardDescription className="min-w-0 text-xs leading-4">
          {browserApproval && request.kind === "questions" ? (
            <>
              <span className="block font-medium text-foreground">
                {t("browserUse.approval.title", {
                  action: t(`browserUse.approval.actions.${browserApproval.action}`),
                })}
              </span>
              {browserApproval.tab_id !== undefined && (
                <span className="block">
                  {t("browserUse.approval.targetTab", { tab: browserApproval.tab_id })}
                </span>
              )}
              {browserApproval.destination_host && (
                <span className="block wrap-anywhere">
                  {t("browserUse.approval.destination", { host: browserApproval.destination_host })}
                </span>
              )}
            </>
          ) : request.kind === "desktop_approval" ? (
            t(
              request.status === "unconfirmed"
                ? "desktopApproval.unconfirmedDescription"
                : request.approval.method === "item/commandExecution/requestApproval"
                  ? "desktopApproval.descriptionCommand"
                  : "desktopApproval.descriptionFileChange"
            )
          ) : request.kind === "form" ? (
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
      ) : request.kind === "desktop_approval" ? (
        <DesktopApprovalDetails
          key={`${request.id}:${request.status}:${request.updated_at}`}
          request={request}
          disabled={disabled}
          submitting={submitting}
          onDecision={
            onApprovalDecision
              ? (decision) => onApprovalDecision(request, decision)
              : undefined
          }
        />
      ) : (
        <QuestionUserInputForm
          key={`${request.id}:${request.status}:${request.updated_at}`}
          request={request}
          browserApproval={browserApproval}
          formId={formId}
          disabled={disabled}
          submitting={submitting}
          onSubmit={(response) => onSubmit?.(response)}
        />
      )}
    </Card>
  )

  return request.kind === "form" &&
    request.status === "answered" &&
    terminal ? (
    <AnsweredFormDetails
      key={request.id}
      message={request.message}
      recommended={displayStatus === "recommended"}
      onInteractionStart={onInteractionStart}
    >
      {card}
    </AnsweredFormDetails>
  ) : (
    card
  )
}

function AnsweredFormDetails({
  message,
  recommended,
  onInteractionStart,
  children,
}: {
  message: string
  recommended: boolean
  onInteractionStart?: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  // Form requests have no business title; field titles label individual inputs.
  const summary =
    fromMarkdown(message)
      .children.map((block) => toString(block, { includeHtml: false }))
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim() || t("conversation.userInput.formResultTitle")

  return (
    <Collapsible className="w-full min-w-0">
      <CollapsibleTrigger
        className="group flex w-full min-w-0 items-center gap-2 rounded-lg border border-[color:var(--app-border)] px-3 py-2 text-left text-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        onPointerDownCapture={onInteractionStart}
      >
        <MessageCircleQuestionIcon
          className="size-3.5 shrink-0"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{summary}</span>
        {recommended && <UserInputStatusBadge status="recommended" />}
        <ChevronRightIcon
          className="size-3.5 shrink-0 transition-transform group-data-panel-open:rotate-90"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">{children}</CollapsibleContent>
    </Collapsible>
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
    status === "pending" || status === "unconfirmed"
      ? MessageCircleQuestionIcon
      : status === "submitting"
        ? LoaderCircleIcon
        : status === "submitted" ||
            status === "approved" ||
            status === "recommended"
          ? CircleCheckIcon
          : status === "rejected"
            ? CircleXIcon
            : status === "expired"
              ? Clock3Icon
              : BanIcon
  return (
    <Badge
      variant={status === "rejected" ? "destructive" : "secondary"}
      className={cn(
        "shrink-0 rounded-full",
        status === "recommended" &&
          "h-auto max-w-[60%] text-left whitespace-normal"
      )}
      role="status"
    >
      <Icon
        data-icon="inline-start"
        className={status === "submitting" ? "animate-spin" : undefined}
        aria-hidden="true"
      />
      {t(status === "unconfirmed"
        ? "desktopApproval.unconfirmed"
        : `conversation.userInput.status.${status}`)}
    </Badge>
  )
}

function DesktopApprovalDetails({
  request,
  disabled,
  submitting,
  onDecision,
}: {
  request: DesktopApprovalRequest
  disabled: boolean
  submitting: boolean
  onDecision?: (decision: DesktopApprovalDecision) => void
}) {
  const { t } = useTranslation()
  const { approval } = request
  const decisions =
    request.status === "pending" && onDecision ? approval.decisions : []
  const decisionLabel = (decision: DesktopApprovalDecision) =>
    t(
      decision === "accept"
        ? "desktopApproval.allowOnce"
        : decision === "decline"
          ? "desktopApproval.decline"
          : "desktopApproval.cancel"
    )

  return (
    <>
      <CardContent className="pb-(--card-spacing)">
        <dl className="grid gap-3 text-sm">
          {approval.method === "item/commandExecution/requestApproval" ? (
            <>
              <div className="grid gap-1">
                <dt className="text-xs font-semibold text-[var(--app-muted)]">
                  {t("desktopApproval.commandLabel")}
                </dt>
                <dd className="min-w-0">
                  <code className="block rounded-lg border border-[color:var(--app-border)] bg-[var(--app-user-surface)] px-3 py-2 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap text-[var(--app-text)]">
                    {approval.command.replace(/^\$SYSTEM_BIN\//u, "/bin/")}
                  </code>
                </dd>
              </div>
              {approval.cwd && (
                <div className="grid gap-1">
                  <dt className="text-xs font-semibold text-[var(--app-muted)]">
                    {t("desktopApproval.cwdLabel")}
                  </dt>
                  <dd className="min-w-0">
                    <code className="block rounded-lg border border-[color:var(--app-border)] bg-[var(--app-user-surface)] px-3 py-2 font-mono text-xs leading-5 wrap-anywhere whitespace-pre-wrap text-[var(--app-text)]">
                      {approval.cwd}
                    </code>
                  </dd>
                </div>
              )}
            </>
          ) : (
            <div className="grid gap-1">
              <dt className="text-xs font-semibold text-[var(--app-muted)]">
                {t("desktopApproval.pathsLabel")}
              </dt>
              <dd className="min-w-0">
                <ul role="list" className="grid gap-1">
                  {approval.changes.map(({ path, kind }) => {
                    const destination = kind.type === "update" ? kind.move_path : null
                    return (
                      <li key={path} className="min-w-0 rounded-lg border border-[color:var(--app-border)] bg-[var(--app-user-surface)] px-3 py-2 text-xs">
                        <span className="font-semibold text-foreground">
                          {t(`desktopApproval.fileOperations.${destination ? "move" : kind.type}`)}
                        </span>
                        <code className="block font-mono leading-5 wrap-anywhere whitespace-pre-wrap">{path}</code>
                        {destination && (
                          <>
                            <span>{t("desktopApproval.moveTo")}</span>
                            <code className="block font-mono leading-5 wrap-anywhere whitespace-pre-wrap">{destination}</code>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </dd>
            </div>
          )}
        </dl>
      </CardContent>
      {decisions.length > 0 && (
        <CardFooter
          className="shrink-0 flex-wrap justify-end gap-1.5 border-t pb-2 [.border-t]:pt-2"
          aria-busy={submitting || undefined}
        >
          {decisions.map((decision) => (
            <Button
              key={decision}
              type="button"
              size="sm"
              variant={
                decision === "accept"
                  ? "default"
                  : decision === "decline"
                    ? "outline"
                    : "ghost"
              }
              disabled={disabled}
              onClick={() => onDecision?.(decision)}
            >
              {decisionLabel(decision)}
            </Button>
          ))}
        </CardFooter>
      )}
    </>
  )
}

/**
 * Matches only the exact projection the Runner makes for a native computer_act
 * approval: one blocking question correlated to the item, the tool name as
 * header and summary (or summary with the projected click/type action), and the
 * exact Allow/Cancel options with no free text. Any other question keeps its
 * native text.
 */
function getComputerActApprovalQuestionKey(
  request: Extract<
    ConversationUserInputRequest,
    { kind: "questions" | "async_questions" }
  >,
  browserApproval: BrowserUseApproval | undefined
): ComputerActApprovalQuestionKey | null {
  if (
    request.kind !== "questions" ||
    browserApproval ||
    request.questions.length !== 1 ||
    request.auto_resolve_at !== null
  ) {
    return null
  }
  const [question] = request.questions
  if (!question) return null
  const options = question.options
  if (options?.length !== 2) return null
  const [allow, cancel] = options
  if (
    question.id !==
      `${computerActApprovalQuestionIdPrefix}${request.item_id}` ||
    question.header !== computerActToolName ||
    question.is_other !== false ||
    question.is_secret !== false ||
    allow?.label !== "Allow" ||
    allow?.description !== "" ||
    cancel?.label !== "Cancel" ||
    cancel?.description !== ""
  ) {
    return null
  }
  if (question.question === computerActToolName) {
    return "desktopComputerUse.approvalQuestion"
  }
  if (question.question === `${computerActToolName}: click`) {
    return "desktopComputerUse.approvalClickQuestion"
  }
  if (question.question === `${computerActToolName}: type`) {
    return "desktopComputerUse.approvalTypeQuestion"
  }
  return null
}

function QuestionUserInputForm({
  request,
  browserApproval,
  formId,
  disabled,
  submitting,
  onSubmit,
}: {
  request: Extract<
    ConversationUserInputRequest,
    { kind: "questions" | "async_questions" }
  >
  browserApproval?: BrowserUseApproval
  formId: string
  disabled: boolean
  submitting: boolean
  onSubmit: (response: ConversationUserInputResponse) => void
}) {
  const { t } = useTranslation()
  const computerActApprovalQuestionKey = getComputerActApprovalQuestionKey(
    request,
    browserApproval
  )
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
                      {computerActApprovalQuestionKey
                        ? t("desktopComputerUse.title")
                        : question.header}
                    </span>
                  )}
                  <span className="mt-0.5 flex items-start gap-2 text-sm leading-5 text-[var(--app-text)]">
                    {computerActApprovalQuestionKey
                      ? t(computerActApprovalQuestionKey)
                      : question.question}
                    <RequiredIndicator />
                  </span>
                </FieldLegend>

                {options.length > 0 && (
                  <RadioGroup
                    aria-required="true"
                    disabled={fieldsDisabled}
                    value={selection ?? ""}
                    onValueChange={(value) =>
                      setSelections((current) => ({
                        ...current,
                        [question.id]: value,
                      }))
                    }
                  >
                    {options.map((option, optionIndex) => {
                      const optionId = `${inputId}-option-${optionIndex}`
                      const optionLabel =
                        computerActApprovalQuestionKey === null
                          ? option.label
                          : t(
                              optionIndex === 0
                                ? "desktopApproval.allowOnce"
                                : "conversation.userInput.cancel"
                            )
                      return (
                        <RadioGroupOption
                          key={`${option.label}:${optionIndex}`}
                          htmlFor={optionId}
                          className="items-start"
                        >
                          <RadioGroupItem
                            id={optionId}
                            value={optionChoice(optionIndex)}
                            disabled={fieldsDisabled}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--app-text)]">
                              {optionLabel}
                            </span>
                            {option.description && (
                              <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                                {option.description}
                              </span>
                            )}
                          </span>
                        </RadioGroupOption>
                      )
                    })}
                    {question.is_other && (
                      <RadioGroupOption htmlFor={`${inputId}-other`}>
                        <RadioGroupItem
                          id={`${inputId}-other`}
                          value={otherChoice}
                          disabled={fieldsDisabled}
                        />
                        <span className="text-sm font-medium text-[var(--app-text)]">
                          {t("conversation.userInput.other")}
                        </span>
                      </RadioGroupOption>
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
                      aria-required="true"
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
        cancelLabel={
          request.kind === "questions"
            ? t("conversation.userInput.dismissRequest")
            : undefined
        }
        complete={complete}
        submitting={submitting}
        onCancel={() => onSubmit({ action: "cancel" })}
      />
    </form>
  )
}
