import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { AppWindowIcon, RefreshCwIcon, XIcon } from "lucide-react"
import {
  browserPanelInputSchema,
  browserPanelStateSchema,
  type BrowserPanelInput,
  type BrowserPanelRequest,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import { getErrorMessage } from "@/api/error-message"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBanner } from "@/components/feedback/status-banner"
import { Spinner } from "@/components/ui/spinner"
import { createRandomUuid } from "@/lib/random-uuid"

export function BrowserPanel({
  conversationId,
  readOnly,
  running,
  onClose,
  onContinue,
}: {
  conversationId: string
  readOnly: boolean
  running: boolean
  onClose: () => void
  onContinue: () => void
}) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [token] = useState(createRandomUuid)
  const [text, setText] = useState("")
  const focusToolbarAfterReleaseRef = useRef(false)
  const releaseSourceRef = useRef<HTMLButtonElement | null>(null)
  const toolbarRef = useRef<HTMLButtonElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)
  const ownsControlRef = useRef(false)
  const mountedRef = useRef(false)
  // A release can resolve after this panel instance unmounted. Keep the last
  // committed callback here so a later page render is what runs, never the
  // closure captured when the panel first opened.
  const onContinueRef = useRef(onContinue)
  useLayoutEffect(() => {
    onContinueRef.current = onContinue
  })
  const queryKey = [
    "conversation",
    conversationId,
    "browser-panel",
    token,
  ] as const
  const request = (body: BrowserPanelRequest, signal?: AbortSignal) =>
    apiRequest(`/conversations/${conversationId}/browser`, {
      method: "POST",
      body,
      schema: browserPanelStateSchema,
      signal,
    })
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => request({ action: "frame", token }, signal),
    retry: false,
    gcTime: 0,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 1_500 : false,
  })
  const mutation = useMutation({
    mutationFn: (body: BrowserPanelRequest) => request(body),
    onMutate: async () => {
      await client.cancelQueries({ queryKey })
    },
    onSuccess: (state) => {
      ownsControlRef.current = state.has_control
      if (!mountedRef.current && state.has_control) {
        ownsControlRef.current = false
        void apiRequest(`/conversations/${conversationId}/browser`, {
          method: "POST",
          body: { action: "release", token },
          schema: browserPanelStateSchema,
        }).catch(() => undefined)
        return
      }
      client.setQueryData(queryKey, state)
    },
  })
  const { mutate, isPending } = mutation
  const data = query.data
  useEffect(() => {
    ownsControlRef.current = data?.has_control ?? false
  }, [data?.has_control])
  // Layout cleanup runs synchronously with the commit that removes this panel,
  // so a release resolving afterwards can observe that it is unmounted. The
  // owner token is still released exactly once.
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (!ownsControlRef.current) return
      ownsControlRef.current = false
      void apiRequest(`/conversations/${conversationId}/browser`, {
        method: "POST",
        body: { action: "release", token },
        schema: browserPanelStateSchema,
      }).catch(() => undefined)
    }
  }, [conversationId, token])
  useEffect(() => {
    toolbarRef.current?.focus()
  }, [])
  // Once this panel's release settles without control, the buttons that
  // invoked it are gone. Move focus to the refresh button only when that
  // removal lost the focus (activeElement falls back to <body>) or the
  // initiating button still holds it; never take focus from a control the
  // user has chosen since.
  useLayoutEffect(() => {
    if (
      !focusToolbarAfterReleaseRef.current ||
      mutation.isPending ||
      data?.has_control !== false
    )
      return
    focusToolbarAfterReleaseRef.current = false
    const active = document.activeElement
    if (
      active !== null &&
      active !== document.body &&
      active !== releaseSourceRef.current
    )
      return
    toolbarRef.current?.focus()
  }, [data?.has_control, mutation.isPending])
  useEffect(() => {
    if (!data?.has_control || readOnly) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !isPending)
        mutate({ action: "claim", token })
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [data?.has_control, readOnly, mutate, isPending, token])
  const controlled = Boolean(
    data?.has_control && !readOnly && !mutation.isPending
  )
  const send = (input: BrowserPanelInput) => {
    if (controlled) mutation.mutate({ action: "input", token, input })
  }
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !controlled) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      mutate({
        action: "input",
        token,
        input: {
          type: "wheel",
          delta_x: Math.max(-2_000, Math.min(2_000, event.deltaX)),
          delta_y: Math.max(-2_000, Math.min(2_000, event.deltaY)),
        },
      })
    }
    viewport.addEventListener("wheel", wheel, { passive: false })
    return () => viewport.removeEventListener("wheel", wheel)
  }, [controlled, mutate, token])
  // Closing never waits on the server. The unmount cleanup releases this
  // token's control and the server lease is the bounded fallback when that
  // release is rejected.
  const returnControl = async (
    continueTask: boolean,
    source: HTMLButtonElement
  ) => {
    releaseSourceRef.current = source
    focusToolbarAfterReleaseRef.current = true
    const state = await mutation
      .mutateAsync({ action: "release", token })
      .catch((error: unknown) => {
        focusToolbarAfterReleaseRef.current = false
        throw error
      })
    if (state.has_control || !mountedRef.current) {
      focusToolbarAfterReleaseRef.current = false
      return
    }
    if (continueTask) onContinueRef.current()
  }
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!controlled || event.nativeEvent.isComposing || event.keyCode === 229)
      return
    if (event.key === "Escape") {
      event.preventDefault()
      toolbarRef.current?.focus()
      return
    }
    const key =
      event.shiftKey && event.key === "Tab"
        ? "Shift+Tab"
        : (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a"
          ? "ControlOrMeta+A"
          : event.key
    const parsed = browserPanelInputSchema.safeParse({ type: "key", key })
    if (parsed.success) {
      event.preventDefault()
      send(parsed.data)
    }
  }
  const error = mutation.error ?? query.error
  return (
    <section
      className="office-preview-pane"
      aria-label={t("browserPanel.title")}
    >
      <header className="flex flex-wrap items-center gap-2 border-b p-3">
        <AppWindowIcon
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <strong className="min-w-0 flex-1 text-sm">
          {t("browserPanel.title")}
        </strong>
        <Button
          ref={toolbarRef}
          variant="ghost"
          size="icon-sm"
          aria-label={t("browserPanel.refresh")}
          disabled={mutation.isPending}
          onClick={() => {
            mutation.reset()
            void query.refetch()
          }}
        >
          <RefreshCwIcon aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("browserPanel.close")}
          onClick={onClose}
        >
          <XIcon aria-hidden="true" />
        </Button>
        {!readOnly && (
          <p className="basis-full text-xs text-muted-foreground">
            {t("browserPanel.hint")}
          </p>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {error && (
          <StatusBanner variant="error">
            {getErrorMessage(error, t)}
          </StatusBanner>
        )}
        {query.isLoading && <Spinner aria-label={t("browserPanel.refresh")} />}
        {data && (
          <>
            <p
              className="truncate text-xs text-muted-foreground"
              title={data.frame.url}
            >
              {data.frame.url}
            </p>
            {!readOnly && (
              <p className="text-xs" role="status">
                {t(
                  data.has_control
                    ? "browserPanel.youControl"
                    : data.mode === "human"
                      ? "browserPanel.otherWindow"
                      : "browserPanel.agentControls"
                )}
              </p>
            )}
            <div
              ref={viewportRef}
              role={readOnly ? undefined : "application"}
              aria-label={readOnly ? undefined : t("browserPanel.viewport")}
              tabIndex={readOnly ? undefined : controlled ? 0 : -1}
              className="min-w-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              onKeyDown={readOnly ? undefined : keyboard}
            >
              <img
                src={`data:image/jpeg;base64,${data.frame.image}`}
                alt={data.frame.title || t("browserPanel.title")}
                draggable={false}
                className="block h-auto w-full select-none"
                onClick={(event) => {
                  if (!controlled) return
                  const rect = event.currentTarget.getBoundingClientRect()
                  send({
                    type: "click",
                    x: Math.max(
                      0,
                      Math.min(1, (event.clientX - rect.left) / rect.width)
                    ),
                    y: Math.max(
                      0,
                      Math.min(1, (event.clientY - rect.top) / rect.height)
                    ),
                  })
                  event.currentTarget.parentElement?.focus()
                }}
              />
            </div>
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                {data.has_control ? (
                  <>
                    <Button
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={(event) => {
                        void returnControl(false, event.currentTarget).catch(
                          () => undefined
                        )
                      }}
                    >
                      {t("browserPanel.returnControl")}
                    </Button>
                    {!running && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={(event) => {
                          void returnControl(true, event.currentTarget).catch(
                            () => undefined
                          )
                        }}
                      >
                        {t("browserPanel.continueTask")}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    size="sm"
                    disabled={mutation.isPending || data.mode === "human"}
                    onClick={() => mutation.mutate({ action: "claim", token })}
                  >
                    {t("browserPanel.takeControl")}
                  </Button>
                )}
              </div>
            )}
            {data.has_control && !readOnly && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!controlled || !text) return
                  mutation.mutate(
                    { action: "input", token, input: { type: "text", text } },
                    {
                      onSuccess: () => {
                        setText("")
                        textInputRef.current?.focus()
                      },
                    }
                  )
                }}
              >
                <Label
                  htmlFor={`browser-text-${conversationId}`}
                  className="text-xs"
                >
                  {t("browserPanel.inputLabel")}
                </Label>
                <Input
                  ref={textInputRef}
                  id={`browser-text-${conversationId}`}
                  name="browser_text"
                  value={text}
                  maxLength={4_096}
                  autoComplete="off"
                  readOnly={isPending}
                  disabled={!data.has_control || readOnly}
                  onChange={(event) => setText(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("browserPanel.keyboardHint")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={!controlled || !text}
                  >
                    {t("browserPanel.sendText")}
                  </Button>
                  {(["Enter", "Tab", "Escape"] as const).map((key) => (
                    <Button
                      key={key}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!controlled}
                      aria-label={t("browserPanel.sendKey", { key })}
                      onClick={() => send({ type: "key", key })}
                    >
                      {key}
                    </Button>
                  ))}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  )
}
