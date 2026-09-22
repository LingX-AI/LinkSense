import { BotChannelCards } from "@/features/bot-channels/bot-channel-cards"
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CheckCircle2Icon,
  Clock3Icon,
  LinkIcon,
  QrCodeIcon,
  RefreshCwIcon,
  ScanQrCodeIcon,
  TriangleAlertIcon,
  Unlink2Icon,
} from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { useTranslation } from "react-i18next"
import { SiWechat } from "react-icons/si"

import { apiRequest } from "@/api/client"
import {
  feishuConnectionListSchema,
  feishuConnectionSchema,
  feishuRegistrationSessionSchema,
  type FeishuRegistrationSession,
  weixinConnectionListSchema,
  weixinConnectionSchema,
  weixinLoginSessionSchema,
  type WeixinConnection,
  type WeixinLoginSession,
} from "@/api/contracts"
import { getErrorMessage } from "@/api/error-message"
import { ErrorState, LoadingState } from "@/components/feedback/page-state"
import { notify } from "@/components/feedback/notification"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ChannelAccessActionButtonProps = ComponentProps<typeof Button> & {
  label: string
}

function ChannelAccessActionButton({
  label,
  children,
  ...props
}: ChannelAccessActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="channel-access-action-trigger" />}
      >
        <Button {...props} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function FeishuLogo() {
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <path
        d="M135.84 130.96c16.83-18.44 30.78-29.72 44.86-34.12-4.04-15.88-11.41-30.68-21.66-43.45a10.42 10.42 0 0 0-8.14-3.89H67.22a1.58 1.58 0 0 0-.93 2.84c28.55 20.94 52.24 47.84 69.36 78.83z"
        fill="#00d6b9"
      />
      <path
        d="M102.58 204.61c43.21 0 80.86-23.85 100.49-59.09-18.12 28.39-47.78 21.62-95.98 2.13-25.69-12.82-48.87-30.82-69.95-51.78a1.57 1.57 0 0 0-2.72 1.07l.05 79.83a10.4 10.4 0 0 0 4.61 8.67c18.79 12.56 40.89 19.22 63.5 19.17z"
        fill="#3370ff"
      />
      <path
        d="M229.57 100.52c-14.59-7.14-31.28-8.67-46.92-4.27-18.62 5.24-29.24 14.58-46.79 34.68-7.89 7.89-16.44 14-25.4 18.34 47.52 21.95 77.05 25.32 94.59-7.43l11.22-22.35c3.29-7.1 7.78-13.51 13.3-18.97z"
        fill="#133c9a"
      />
    </svg>
  )
}

export function WeixinChannelPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginSessionId, setLoginSessionId] = useState<string | null>(null)
  const [initialLogin, setInitialLogin] = useState<WeixinLoginSession | null>(
    null
  )
  const [verifyCode, setVerifyCode] = useState("")
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const connectedNoticeRef = useRef<string | null>(null)
  const [feishuRegistrationOpen, setFeishuRegistrationOpen] = useState(false)
  const [feishuRegistrationId, setFeishuRegistrationId] = useState<
    string | null
  >(null)
  const [initialFeishuRegistration, setInitialFeishuRegistration] =
    useState<FeishuRegistrationSession | null>(null)
  const [feishuDisconnectOpen, setFeishuDisconnectOpen] = useState(false)
  const feishuConnectedNoticeRef = useRef<string | null>(null)

  const connectionsQuery = useQuery({
    queryKey: ["weixin", "connections"],
    queryFn: ({ signal }) =>
      apiRequest("/weixin", {
        schema: weixinConnectionListSchema,
        signal,
      }),
  })
  const connection = connectionsQuery.data?.items[0] ?? null

  const feishuConnectionsQuery = useQuery({
    queryKey: ["feishu", "connections"],
    queryFn: ({ signal }) =>
      apiRequest("/feishu", {
        schema: feishuConnectionListSchema,
        signal,
      }),
    refetchInterval: (query) => {
      const status = query.state.data?.items[0]?.runtime_status
      if (status === "connecting") return 1_000
      if (status === "pending_approval") return 5_000
      return false
    },
  })
  const feishuConnection = feishuConnectionsQuery.data?.items[0] ?? null

  const startLoginMutation = useMutation({
    mutationFn: () =>
      apiRequest("/weixin/login-sessions", {
        method: "POST",
        body: {},
        schema: weixinLoginSessionSchema,
      }),
    onSuccess: (session) => {
      setInitialLogin(session)
      setLoginSessionId(session.id)
      setVerifyCode("")
    },
  })

  const loginQuery = useQuery({
    queryKey: ["weixin", "login", loginSessionId],
    queryFn: ({ signal }) =>
      apiRequest(`/weixin/login-sessions/${loginSessionId}`, {
        schema: weixinLoginSessionSchema,
        signal,
      }),
    enabled: loginOpen && loginSessionId !== null,
    refetchInterval: (query) =>
      shouldPollLogin(query.state.data?.status) ? 1_000 : false,
    retry: false,
  })
  const loginSession = loginQuery.data ?? initialLogin

  const startFeishuRegistrationMutation = useMutation({
    mutationFn: (input: { reuseExisting?: boolean; forceCreate?: boolean }) =>
      apiRequest("/feishu/registration-sessions", {
        method: "POST",
        body: {
          ...(input.reuseExisting ? { reuse_existing: true } : {}),
          ...(input.forceCreate ? { force_create: true } : {}),
        },
        schema: feishuRegistrationSessionSchema,
      }),
    onSuccess: (session) => {
      setInitialFeishuRegistration(session)
      setFeishuRegistrationId(session.id)
    },
  })

  const feishuRegistrationQuery = useQuery({
    queryKey: ["feishu", "registration", feishuRegistrationId],
    queryFn: ({ signal }) =>
      apiRequest(`/feishu/registration-sessions/${feishuRegistrationId}`, {
        schema: feishuRegistrationSessionSchema,
        signal,
      }),
    enabled: feishuRegistrationOpen && feishuRegistrationId !== null,
    refetchInterval: (query) =>
      shouldPollFeishuRegistration(query.state.data?.status) ? 1_000 : false,
    retry: false,
  })
  const feishuRegistration =
    feishuRegistrationQuery.data ?? initialFeishuRegistration

  useEffect(() => {
    if (
      loginSession?.status !== "connected" ||
      connectedNoticeRef.current === loginSession.id
    ) {
      return
    }
    connectedNoticeRef.current = loginSession.id
    if (loginSession.connection) {
      queryClient.setQueryData(["weixin", "connections"], {
        items: [markLoginConnectionOnline(loginSession.connection)],
      })
    }
    notify.success(t("channelAccess.weixin.connectedNotice"), {
      id: "weixin-connected",
    })
  }, [loginSession, queryClient, t])

  useEffect(() => {
    if (
      (feishuRegistration?.status !== "connected" &&
        feishuRegistration?.status !== "pending_approval") ||
      feishuConnectedNoticeRef.current === feishuRegistration.id
    ) {
      return
    }
    feishuConnectedNoticeRef.current = feishuRegistration.id
    if (feishuRegistration.connection) {
      queryClient.setQueryData(["feishu", "connections"], {
        items: [feishuRegistration.connection],
      })
    }
    void queryClient.invalidateQueries({
      queryKey: ["feishu", "connections"],
    })
    if (feishuRegistration.status === "pending_approval") {
      notify.info(
        t(
          feishuRegistration.operation === "update"
            ? "channelAccess.feishu.pendingApprovalUpdatedNotice"
            : "channelAccess.feishu.pendingApprovalNotice"
        ),
        { id: "feishu-pending-approval" }
      )
    } else {
      notify.success(
        t(
          feishuRegistration.operation === "update"
            ? "channelAccess.feishu.updatedNotice"
            : "channelAccess.feishu.connectedNotice"
        ),
        { id: "feishu-connected" }
      )
    }
  }, [feishuRegistration, queryClient, t])

  const verificationMutation = useMutation({
    mutationFn: () =>
      apiRequest(`/weixin/login-sessions/${loginSessionId}/verification`, {
        method: "POST",
        body: { verify_code: verifyCode.trim() },
        schema: weixinLoginSessionSchema,
      }),
    onSuccess: (session) => {
      setVerifyCode("")
      queryClient.setQueryData(["weixin", "login", loginSessionId], session)
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error("WEIXIN_CONNECTION_NOT_FOUND")
      await apiRequest(`/weixin/${connection.id}`, {
        method: "DELETE",
        schema: weixinConnectionSchema.nullable(),
      })
    },
    onSuccess: async () => {
      setDisconnectOpen(false)
      await queryClient.invalidateQueries({
        queryKey: ["weixin", "connections"],
      })
      notify.success(t("channelAccess.weixin.disconnectedNotice"), {
        id: "weixin-disconnected",
      })
    },
  })

  const disconnectFeishuMutation = useMutation({
    mutationFn: async () => {
      if (!feishuConnection) throw new Error("FEISHU_CONNECTION_NOT_FOUND")
      await apiRequest(`/feishu/${feishuConnection.id}`, {
        method: "DELETE",
        schema: feishuConnectionSchema.nullable(),
      })
    },
    onSuccess: async () => {
      setFeishuDisconnectOpen(false)
      await queryClient.invalidateQueries({
        queryKey: ["feishu", "connections"],
      })
      notify.success(t("channelAccess.feishu.disconnectedNotice"), {
        id: "feishu-disconnected",
      })
    },
  })

  const openLogin = () => {
    setLoginOpen(true)
    setLoginSessionId(null)
    setInitialLogin(null)
    connectedNoticeRef.current = null
    startLoginMutation.reset()
    verificationMutation.reset()
    startLoginMutation.mutate()
  }

  const openFeishuRegistration = () => {
    setFeishuRegistrationOpen(true)
    setFeishuRegistrationId(null)
    setInitialFeishuRegistration(null)
    feishuConnectedNoticeRef.current = null
    startFeishuRegistrationMutation.reset()
    startFeishuRegistrationMutation.mutate({})
  }

  const pageError =
    disconnectMutation.error ?? disconnectFeishuMutation.error ?? null
  const canRestartLogin =
    (startLoginMutation.isError && !loginSession) ||
    loginQuery.isError ||
    loginSession?.status === "expired" ||
    loginSession?.status === "failed"
  const loginConnected = loginSession?.status === "connected"
  const canRestartFeishuRegistration =
    (startFeishuRegistrationMutation.isError && !feishuRegistration) ||
    feishuRegistrationQuery.isError ||
    feishuRegistration?.status === "expired" ||
    feishuRegistration?.status === "failed"
  const feishuRegistrationCompleted =
    feishuRegistration?.status === "connected" ||
    feishuRegistration?.status === "pending_approval"
  const feishuRegistrationIsUpdate =
    feishuRegistration?.operation === "update" ||
    (feishuRegistration === null && feishuConnection !== null)
  const canCreateNewFeishuApp =
    feishuRegistration?.operation === "update" && !feishuRegistrationCompleted

  return (
    <div className="settings-page channel-access-page">
      <header className="settings-page-header">
        <h1 className="text-pretty">{t("channelAccess.title")}</h1>
        <p className="text-pretty">{t("channelAccess.description")}</p>
      </header>

      {pageError && (
        <StatusBanner variant="error">
          {getErrorMessage(pageError, t)}
        </StatusBanner>
      )}

      {connectionsQuery.isPending || feishuConnectionsQuery.isPending ? (
        <LoadingState />
      ) : connectionsQuery.isError || feishuConnectionsQuery.isError ? (
        <ErrorState
          message={getErrorMessage(
            connectionsQuery.error ?? feishuConnectionsQuery.error,
            t
          )}
          onRetry={() => {
            void connectionsQuery.refetch()
            void feishuConnectionsQuery.refetch()
          }}
        />
      ) : (
        <Card
          className="channel-access-list"
          role="region"
          aria-label={t("channelAccess.channelsLabel")}
        >
          <CardContent className="px-4">
            <article className="channel-access-card channel-access-card-manageable">
              <div className="channel-access-card-header">
                <div className="channel-access-heading">
                  <span
                    className="channel-access-icon channel-access-icon-weixin"
                    aria-label={t("channelAccess.weixin.iconLabel")}
                    data-testid="weixin-channel-brand-icon"
                    role="img"
                  >
                    <SiWechat aria-hidden="true" />
                  </span>
                  <div>
                    <div className="channel-access-title-row">
                      <h2>{t("channelAccess.weixin.name")}</h2>
                      {connection ? (
                        <ConnectionStatusBadge
                          status={connection.runtime_status}
                        />
                      ) : (
                        <Badge variant="outline">
                          {t("channelAccess.status.available")}
                        </Badge>
                      )}
                    </div>
                    {!connection && (
                      <p>{t("channelAccess.weixin.notConnected")}</p>
                    )}
                  </div>
                </div>
                <p className="channel-access-description">
                  {t("channelAccess.weixin.description")}
                </p>
              </div>

              <div className="channel-access-actions">
                {connection ? (
                  <>
                    <ChannelAccessActionButton
                      type="button"
                      size="icon"
                      variant="ghost"
                      label={t("channelAccess.weixin.reconnect")}
                      onClick={openLogin}
                      disabled={startLoginMutation.isPending}
                    >
                      <ScanQrCodeIcon aria-hidden="true" />
                    </ChannelAccessActionButton>
                    <ChannelAccessActionButton
                      type="button"
                      size="icon"
                      variant="destructive-ghost"
                      className="channel-access-action-destructive"
                      label={t("channelAccess.weixin.disconnect")}
                      onClick={() => setDisconnectOpen(true)}
                    >
                      <Unlink2Icon aria-hidden="true" />
                    </ChannelAccessActionButton>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={openLogin}
                    disabled={startLoginMutation.isPending}
                  >
                    {startLoginMutation.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <LinkIcon data-icon="inline-start" aria-hidden="true" />
                    )}
                    {t("channelAccess.weixin.connect")}
                  </Button>
                )}
              </div>
            </article>

            <Separator />
            <article className="channel-access-card channel-access-card-manageable">
              <div className="channel-access-card-header">
                <div className="channel-access-heading">
                  <span
                    className="channel-access-icon channel-access-icon-feishu"
                    aria-label={t("channelAccess.feishu.iconLabel")}
                    data-testid="feishu-channel-brand-icon"
                    role="img"
                  >
                    <FeishuLogo />
                  </span>
                  <div>
                    <div className="channel-access-title-row">
                      <h2>{t("channelAccess.feishu.name")}</h2>
                      {feishuConnection ? (
                        <ConnectionStatusBadge
                          status={feishuConnection.runtime_status}
                        />
                      ) : (
                        <Badge variant="outline">
                          {t("channelAccess.status.available")}
                        </Badge>
                      )}
                    </div>
                    {!feishuConnection && (
                      <p>{t("channelAccess.feishu.notConnected")}</p>
                    )}
                  </div>
                </div>
                <p className="channel-access-description">
                  {t("channelAccess.feishu.description")}
                </p>
              </div>

              <div className="channel-access-actions">
                {feishuConnection ? (
                  <>
                    <ChannelAccessActionButton
                      type="button"
                      size="icon"
                      variant="ghost"
                      label={t("channelAccess.feishu.reconnect")}
                      onClick={openFeishuRegistration}
                      disabled={startFeishuRegistrationMutation.isPending}
                    >
                      <ScanQrCodeIcon aria-hidden="true" />
                    </ChannelAccessActionButton>
                    <ChannelAccessActionButton
                      type="button"
                      size="icon"
                      variant="destructive-ghost"
                      className="channel-access-action-destructive"
                      label={t("channelAccess.feishu.disconnect")}
                      onClick={() => setFeishuDisconnectOpen(true)}
                    >
                      <Unlink2Icon aria-hidden="true" />
                    </ChannelAccessActionButton>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={openFeishuRegistration}
                    disabled={startFeishuRegistrationMutation.isPending}
                  >
                    {startFeishuRegistrationMutation.isPending ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <LinkIcon data-icon="inline-start" aria-hidden="true" />
                    )}
                    {t("channelAccess.feishu.connect")}
                  </Button>
                )}
              </div>
            </article>

            <Separator />
            <BotChannelCards />
          </CardContent>
        </Card>
      )}

      <Dialog
        open={loginOpen}
        onOpenChange={(open) => {
          setLoginOpen(open)
          if (!open) {
            setLoginSessionId(null)
            setInitialLogin(null)
            setVerifyCode("")
          }
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>{t("channelAccess.weixin.loginTitle")}</DialogTitle>
            <DialogDescription>
              {t("channelAccess.weixin.loginDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="weixin-login-body">
            {startLoginMutation.isPending && (
              <div className="weixin-login-wait" role="status">
                <Spinner aria-hidden="true" />
                <span>{t("channelAccess.weixin.generatingQr")}</span>
              </div>
            )}
            {(startLoginMutation.error || loginQuery.error) && (
              <StatusBanner variant="error">
                {getErrorMessage(
                  startLoginMutation.error ?? loginQuery.error,
                  t
                )}
              </StatusBanner>
            )}
            {loginSession?.qrcode_url &&
              !isTerminalLogin(loginSession.status) && (
                <div
                  className="weixin-qr-code"
                  role="img"
                  aria-label={t("channelAccess.weixin.qrCodeLabel")}
                >
                  <QRCodeSVG
                    value={loginSession.qrcode_url}
                    size={220}
                    level="M"
                    marginSize={2}
                    aria-hidden="true"
                  />
                </div>
              )}
            {loginSession && (
              <LoginStatus
                status={loginSession.status}
                accountHint={loginSession.connection?.account_hint ?? null}
              />
            )}
            {loginSession?.status === "verification_required" && (
              <form
                className="weixin-verification-form"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault()
                  verificationMutation.mutate()
                }}
              >
                <Label htmlFor="weixin-verification-code">
                  {t("channelAccess.weixin.verificationLabel")}
                </Label>
                <div>
                  <Input
                    id="weixin-verification-code"
                    name="weixin-verification-code"
                    value={verifyCode}
                    onChange={(event) =>
                      setVerifyCode(
                        event.target.value.replace(/\D/gu, "").slice(0, 8)
                      )
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{4,8}"
                    required
                  />
                  <Button
                    type="submit"
                    aria-busy={verificationMutation.isPending || undefined}
                    disabled={
                      verificationMutation.isPending ||
                      !/^\d{4,8}$/u.test(verifyCode)
                    }
                  >
                    {verificationMutation.isPending && (
                      <Spinner data-icon="inline-start" />
                    )}
                    {t("channelAccess.weixin.submitVerification")}
                  </Button>
                </div>
                {verificationMutation.error && (
                  <StatusBanner variant="error">
                    {getErrorMessage(verificationMutation.error, t)}
                  </StatusBanner>
                )}
              </form>
            )}
          </div>

          {(canRestartLogin || loginConnected) && (
            <DialogFooter>
              {canRestartLogin ? (
                <Button
                  type="button"
                  onClick={() => {
                    setLoginSessionId(null)
                    setInitialLogin(null)
                    startLoginMutation.reset()
                    startLoginMutation.mutate()
                  }}
                >
                  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                  {t("channelAccess.weixin.generateAgain")}
                </Button>
              ) : (
                <Button type="button" onClick={() => setLoginOpen(false)}>
                  {t("channelAccess.weixin.finish")}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={feishuRegistrationOpen}
        onOpenChange={(open) => {
          setFeishuRegistrationOpen(open)
          if (!open) {
            setFeishuRegistrationId(null)
            setInitialFeishuRegistration(null)
          }
        }}
      >
        <DialogContent closeLabel={t("common.close")}>
          <DialogHeader>
            <DialogTitle>
              {t(
                feishuRegistrationIsUpdate
                  ? "channelAccess.feishu.reauthorizationTitle"
                  : "channelAccess.feishu.registrationTitle"
              )}
            </DialogTitle>
            <DialogDescription>
              {t(
                feishuRegistrationIsUpdate
                  ? "channelAccess.feishu.reauthorizationDescription"
                  : "channelAccess.feishu.registrationDescription"
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="weixin-login-body">
            {startFeishuRegistrationMutation.isPending && (
              <div className="weixin-login-wait" role="status">
                <Spinner aria-hidden="true" />
                <span>{t("channelAccess.feishu.generatingQr")}</span>
              </div>
            )}
            {(startFeishuRegistrationMutation.error ||
              feishuRegistrationQuery.error) && (
              <StatusBanner variant="error">
                {getErrorMessage(
                  startFeishuRegistrationMutation.error ??
                    feishuRegistrationQuery.error,
                  t
                )}
              </StatusBanner>
            )}
            {feishuRegistration?.qrcode_url &&
              !isTerminalFeishuRegistration(feishuRegistration.status) && (
                <div
                  className="weixin-qr-code"
                  role="img"
                  aria-label={t("channelAccess.feishu.qrCodeLabel")}
                >
                  <QRCodeSVG
                    value={feishuRegistration.qrcode_url}
                    size={220}
                    level="M"
                    marginSize={2}
                    aria-hidden="true"
                  />
                </div>
              )}
            {feishuRegistration && (
              <FeishuRegistrationStatus session={feishuRegistration} />
            )}
          </div>

          {(canRestartFeishuRegistration ||
            feishuRegistrationCompleted ||
            canCreateNewFeishuApp) && (
            <DialogFooter>
              {canCreateNewFeishuApp && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setFeishuRegistrationId(null)
                    setInitialFeishuRegistration(null)
                    startFeishuRegistrationMutation.reset()
                    startFeishuRegistrationMutation.mutate({
                      forceCreate: true,
                    })
                  }}
                >
                  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                  {t("channelAccess.feishu.createWhenMissing")}
                </Button>
              )}
              {canRestartFeishuRegistration ? (
                <Button
                  type="button"
                  onClick={() => {
                    setFeishuRegistrationId(null)
                    setInitialFeishuRegistration(null)
                    startFeishuRegistrationMutation.reset()
                    startFeishuRegistrationMutation.mutate({
                      reuseExisting:
                        feishuRegistration?.status === "failed" &&
                        feishuRegistration.operation === "create",
                    })
                  }}
                >
                  <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                  {t(
                    feishuRegistration?.status === "failed" &&
                      feishuRegistration.operation === "create"
                      ? "channelAccess.feishu.recoverExisting"
                      : "channelAccess.feishu.generateAgain"
                  )}
                </Button>
              ) : feishuRegistrationCompleted ? (
                <Button
                  type="button"
                  onClick={() => setFeishuRegistrationOpen(false)}
                >
                  {t("channelAccess.feishu.finish")}
                </Button>
              ) : null}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("channelAccess.weixin.disconnectTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("channelAccess.weixin.disconnectDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate()}
            >
              {disconnectMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Unlink2Icon data-icon="inline-start" aria-hidden="true" />
              )}
              {t("channelAccess.weixin.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={feishuDisconnectOpen}
        onOpenChange={setFeishuDisconnectOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("channelAccess.feishu.disconnectTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("channelAccess.feishu.disconnectDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disconnectFeishuMutation.isPending}
              onClick={() => disconnectFeishuMutation.mutate()}
            >
              {disconnectFeishuMutation.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Unlink2Icon data-icon="inline-start" aria-hidden="true" />
              )}
              {t("channelAccess.feishu.disconnect")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ConnectionStatusBadge({
  status,
}: {
  status:
    | "online"
    | "connecting"
    | "pending_approval"
    | "error"
    | "reauthorization_required"
}) {
  const { t } = useTranslation()
  const variant =
    status === "error" || status === "reauthorization_required"
      ? "destructive"
      : status === "online"
        ? "default"
        : "secondary"
  return (
    <Badge variant={variant}>
      {status === "online" && (
        <CheckCircle2Icon data-icon="inline-start" aria-hidden="true" />
      )}
      {t(`channelAccess.status.${status}`)}
    </Badge>
  )
}

function LoginStatus({
  status,
  accountHint,
}: {
  status: WeixinLoginSession["status"]
  accountHint?: string | null
}) {
  const { t } = useTranslation()
  if (status === "connected") {
    return (
      <div className="weixin-login-success" role="status" aria-live="polite">
        <div className="weixin-login-success-mark" aria-hidden="true">
          <SiWechat />
        </div>
        <div className="weixin-login-success-copy">
          <h3>{t("channelAccess.loginStatus.connected")}</h3>
          <p>
            {accountHint
              ? t("channelAccess.weixin.accountConnected", {
                  account: accountHint,
                })
              : t("channelAccess.weixin.successDescription")}
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="weixin-login-status" role="status" aria-live="polite">
      <QrCodeIcon aria-hidden="true" />
      <span>{t(`channelAccess.loginStatus.${status}`)}</span>
    </div>
  )
}

function FeishuRegistrationStatus({
  session,
}: {
  session: FeishuRegistrationSession
}) {
  const { t } = useTranslation()
  if (session.status === "pending_approval") {
    return (
      <Alert
        appearance="borderless"
        className="w-fit max-w-md items-start justify-self-center"
        role="status"
        aria-live="polite"
      >
        <Clock3Icon aria-hidden="true" />
        <AlertTitle>
          {t(
            session.operation === "update"
              ? "channelAccess.feishu.registrationStatus.pending_approval_update"
              : "channelAccess.feishu.registrationStatus.pending_approval"
          )}
        </AlertTitle>
        <AlertDescription>
          {t("channelAccess.feishu.pendingApprovalDescription")}
        </AlertDescription>
      </Alert>
    )
  }
  if (session.status === "connected") {
    return (
      <div className="weixin-login-success" role="status" aria-live="polite">
        <div className="weixin-login-success-mark feishu-success-mark">
          <FeishuLogo />
        </div>
        <div className="weixin-login-success-copy">
          <h3>
            {t(
              session.operation === "update"
                ? "channelAccess.feishu.registrationStatus.updated"
                : "channelAccess.feishu.registrationStatus.connected"
            )}
          </h3>
          <p>
            {session.operation === "update"
              ? t("channelAccess.feishu.appUpdated")
              : session.connection?.bot_name
                ? t("channelAccess.feishu.botCreated", {
                    bot: session.connection.bot_name,
                  })
                : t("channelAccess.feishu.successDescription")}
          </p>
        </div>
      </div>
    )
  }
  const registrationFailed =
    session.status === "failed" || session.status === "expired"
  const StatusIcon = registrationFailed ? TriangleAlertIcon : QrCodeIcon
  return (
    <Alert
      variant={registrationFailed ? "destructive" : "default"}
      appearance="borderless"
      className="w-fit max-w-md items-start justify-self-center"
      role="status"
      aria-live="polite"
    >
      <StatusIcon aria-hidden="true" />
      <AlertDescription>
        {t(
          session.operation === "update" && session.status === "failed"
            ? "channelAccess.feishu.registrationStatus.update_failed"
            : `channelAccess.feishu.registrationStatus.${session.status}`
        )}
      </AlertDescription>
    </Alert>
  )
}

function isTerminalLogin(status?: WeixinLoginSession["status"]): boolean {
  return status === "connected" || status === "expired" || status === "failed"
}

function shouldPollLogin(status?: WeixinLoginSession["status"]): boolean {
  return !isTerminalLogin(status) && status !== "verification_required"
}

function isTerminalFeishuRegistration(
  status?: FeishuRegistrationSession["status"]
): boolean {
  return (
    status === "pending_approval" ||
    status === "connected" ||
    status === "expired" ||
    status === "failed"
  )
}

function shouldPollFeishuRegistration(
  status?: FeishuRegistrationSession["status"]
): boolean {
  return !isTerminalFeishuRegistration(status)
}

function markLoginConnectionOnline(
  connection: WeixinConnection
): WeixinConnection {
  return {
    ...connection,
    runtime_status: "online",
    last_poll_at: connection.last_poll_at ?? new Date().toISOString(),
  }
}
