import { useId, useState, useSyncExternalStore } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  auditTranslationKey,
  desktopActivityListSchema,
  type DesktopActivityComputerAction,
  type DesktopActivityComputerRequest,
  type DesktopActivityResult,
  type DesktopApprovalDecision,
} from "@linksense/shared"

import { ApiError, apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import {
  getLoginSessionBoundary,
  subscribeToLoginSession,
  type LoginSessionBoundary,
} from "@/api/session"
import { isMacDesktopHost } from "@/adapters/desktop/desktop-adapter"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { normalizeLanguage } from "@/i18n"
import { formatDateTime } from "@/i18n/date"

const decisionKeys: Record<DesktopApprovalDecision, string> = {
  accept: "desktopActivity.decisionAccept",
  decline: "desktopActivity.decisionDecline",
  cancel: "desktopActivity.decisionCancel",
}

const requestKeys: Record<DesktopActivityComputerRequest, string> = {
  status: "desktopActivity.requestStatus",
  observe: "desktopActivity.requestObserve",
  act: "desktopActivity.requestAct",
  wait: "desktopActivity.requestWait",
}

const actionKeys: Record<DesktopActivityComputerAction, string> = {
  click: "desktopActivity.actionClick",
  type: "desktopActivity.actionType",
}

const resultKey = (result: DesktopActivityResult) =>
  auditTranslationKey("results", result)

/**
 * Account-scoped recent desktop activity inside This Mac settings. The section
 * stays mounted, while the disclosure resets whenever the owner or login
 * generation changes so an open panel cannot read with the previous session.
 */
export function DesktopActivityDisclosure({
  ownerId,
}: Readonly<{ ownerId?: string }>) {
  const mac = isMacDesktopHost()
  const headingId = useId()
  const loginSessionBoundary = useSyncExternalStore(
    subscribeToLoginSession,
    getLoginSessionBoundary,
    getLoginSessionBoundary
  )

  if (!mac || !ownerId) return null

  return (
    <section
      aria-labelledby={headingId}
      className="grid min-w-0 gap-3 border-t border-border pt-5"
    >
      <DesktopActivityCollapsible
        key={`${ownerId}:${loginSessionBoundary}`}
        headingId={headingId}
        ownerId={ownerId}
        loginSessionBoundary={loginSessionBoundary}
      />
    </section>
  )
}

function DesktopActivityCollapsible({
  headingId,
  ownerId,
  loginSessionBoundary,
}: Readonly<{
  headingId: string
  ownerId: string
  loginSessionBoundary: LoginSessionBoundary
}>) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <h3
        id={headingId}
        className="text-sm leading-5 font-semibold text-foreground"
      >
        <CollapsibleTrigger
          type="button"
          className="group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none"
          />
          <span className="min-w-0">{t("desktopActivity.title")}</span>
        </CollapsibleTrigger>
      </h3>
      <p className="form-hint max-w-3xl text-pretty">
        {t("desktopActivity.description")}
      </p>
      <CollapsibleContent>
        <DesktopActivityList
          ownerId={ownerId}
          loginSessionBoundary={loginSessionBoundary}
        />
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * The query exists only while the panel is expanded. Removing this component
 * removes its observer, so TanStack aborts the in-flight read through the
 * signal passed to `apiRequest`; an explicit reopen starts a new read.
 */
function DesktopActivityList({
  ownerId,
  loginSessionBoundary,
}: Readonly<{
  ownerId: string
  loginSessionBoundary: LoginSessionBoundary
}>) {
  const { t, i18n } = useTranslation()
  const query = useQuery({
    queryKey: ["desktop-activity", ownerId, loginSessionBoundary],
    queryFn: ({ signal }) =>
      apiRequest("/desktop/activity", {
        schema: desktopActivityListSchema,
        signal,
        loginSessionBoundary,
      }),
    retry: false,
    staleTime: 0,
  })
  const language = normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"
  const items = query.data?.items ?? []
  const unavailable =
    query.error instanceof ApiError && query.error.status === 404

  return (
    <div className="mt-3 grid min-w-0 gap-3">
      {query.isPending ? (
        <span role="status" className="inline-flex items-center">
          <Spinner />
          <span className="sr-only">{t("common.loading")}</span>
        </span>
      ) : unavailable ? (
        <p className="form-hint" role="status">
          {t("desktopActivity.unavailable")}
        </p>
      ) : query.error ? (
        <Alert variant="destructive">
          <AlertDescription className="grid justify-items-start gap-2">
            <p>
              {query.error instanceof ApiError
                ? getErrorMessage(query.error, t)
                : t("desktopActivity.loadFailed")}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void query.refetch()}
            >
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t("desktopActivity.emptyTitle")}</EmptyTitle>
            <EmptyDescription>
              {t("desktopActivity.emptyDescription")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y divide-[color:var(--app-divider)]">
          {items.map((item) => {
            const attempt = item.action === "desktop_tool_requested"
            const approval = item.action === "desktop_approval_responded"
            // A read attempt's stored success is the internal check before the
            // final delivery gate, so an unconfirmed success is not displayed
            // as a result. A recorded rejection or failure stays visible.
            const attemptOutcome =
              attempt &&
              !(item.delivery === "unconfirmed" && item.result === "success")
            return (
              <li
                key={item.id}
                className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm leading-5 font-medium text-foreground">
                    {t(auditTranslationKey("actions", item.action))}
                  </span>
                  {attempt ? (
                    <Badge variant="outline">
                      {t("desktopActivity.attempt")}
                    </Badge>
                  ) : null}
                  {item.delivery ? (
                    <Badge
                      variant={
                        item.delivery === "confirmed" ? "secondary" : "outline"
                      }
                    >
                      {t(
                        item.delivery === "confirmed"
                          ? "desktopActivity.deliveryConfirmed"
                          : "desktopActivity.deliveryUnconfirmed"
                      )}
                    </Badge>
                  ) : null}
                </div>
                <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-5 text-muted-foreground">
                  <time dateTime={item.created_at}>
                    {formatDateTime(item.created_at, language)}
                  </time>
                  {attempt && item.computer_request ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("desktopActivity.request", {
                          request: t(requestKeys[item.computer_request]),
                        })}
                      </span>
                    </>
                  ) : null}
                  {attempt && item.computer_action ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("desktopActivity.action", {
                          action: t(actionKeys[item.computer_action]),
                        })}
                      </span>
                    </>
                  ) : null}
                  {attemptOutcome ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("desktopActivity.attemptOutcome", {
                          result: t(resultKey(item.result)),
                        })}
                      </span>
                    </>
                  ) : null}
                  {approval && item.approval_decision ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t("desktopActivity.decision", {
                          decision: t(decisionKeys[item.approval_decision]),
                        })}
                      </span>
                    </>
                  ) : null}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
