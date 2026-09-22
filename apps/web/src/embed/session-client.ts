import { z } from "zod"
import { isLocale } from "@linksense/shared"

import { parseSseFrame } from "@/api/sse"
import { sseEventSchema, type ConversationEvent } from "@/api/contracts"

const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string().optional(),
        message: z.string().optional(),
      })
      .optional(),
    error_code: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough()

const tokenPairSchema = z.strictObject({
  access_token: z.string().min(32),
  renewal_token: z.string().min(32),
  access_token_expires_at: z.iso.datetime(),
  renewal_token_expires_at: z.iso.datetime(),
  session_expires_at: z.iso.datetime(),
  session_id: z.string().uuid(),
})

const publicSessionSchema = z.strictObject({
  session_id: z.string().uuid(),
  session_expires_at: z.iso.datetime(),
})

const conversationSessionUpdateSchema = z.strictObject({
  session_id: z.string().uuid(),
  session_expires_at: z.iso.datetime(),
  conversation_id: z.string().uuid(),
  access_token: z.string().min(32).nullable(),
  renewal_token: z.string().min(32).nullable(),
  access_token_expires_at: z.iso.datetime().nullable(),
  renewal_token_expires_at: z.iso.datetime().nullable(),
})

type TokenPair = z.infer<typeof tokenPairSchema>
type PublicSession = z.infer<typeof publicSessionSchema>
type ConversationSessionUpdate = z.infer<typeof conversationSessionUpdateSchema>
type SessionMode = "token" | "public"

export class EmbedRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
    this.name = "EmbedRequestError"
  }
}

export type EmbedSessionClientEvents = Readonly<{
  onAuthenticationRequired: () => void
  onMaintenance?: () => void
  onConnectionStateChange: (state: "connected" | "retrying") => void
}>

export type EmbedSessionEventHandlers = Readonly<{
  onEvent: (event: ConversationEvent) => void
  onConnectionChange?: (state: "connected" | "retrying") => void
}>

export class EmbedSessionClient {
  #mode: SessionMode | null = null
  #accessToken: string | null = null
  #renewalToken: string | null = null
  #accessExpiresAt = 0
  #renewalExpiresAt = 0
  #sessionExpiresAt = 0
  #sessionId: string | null = null
  #appId: string | null = null
  #renewTimer: number | null = null
  #renewPromise: Promise<void> | null = null
  #destroyed = false
  readonly #origin: string
  readonly #events: EmbedSessionClientEvents

  constructor(origin: string, events: EmbedSessionClientEvents) {
    this.#origin = origin
    this.#events = events
  }

  get sessionId() {
    return this.#sessionId
  }

  get authenticated() {
    return (
      this.#sessionId !== null &&
      ((this.#mode === "token" && this.#accessToken !== null) ||
        (this.#mode === "public" && this.#appId !== null))
    )
  }

  async acceptTicket(ticket: string): Promise<void> {
    const tokens = await this.#publicRequest(
      "/api/v1/embed/sessions/exchange",
      tokenPairSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticket, origin: this.#origin }),
      }
    )
    this.#applyTokens(tokens)
  }

  async updateExternalApplicationSession(
    externalApplicationSessionId: string | null
  ): Promise<void> {
    await this.request(
      "/api/v1/embed/session/external-application-session",
      z.undefined(),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          external_application_session_id: externalApplicationSessionId,
        }),
      }
    )
  }

  async startPublicSession(appId: string): Promise<void> {
    const session = await this.#requestPublicSession(appId)
    this.#applyPublicSession(appId, session)
  }

  async request<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    init: RequestInit = {}
  ): Promise<z.infer<TSchema>> {
    const response = await this.#requestResponse(path, init)
    return parseResponse(response, schema)
  }

  async requestBlob(path: string, init: RequestInit = {}): Promise<Blob> {
    const response = await this.#requestResponse(path, init)
    if (!response.ok) throw await responseError(response)
    return response.blob()
  }

  async requestStream(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.#requestResponse(path, init)
    if (!response.ok) throw await responseError(response)
    return response
  }

  async #requestResponse(path: string, init: RequestInit): Promise<Response> {
    if (!this.authenticated) {
      throw new EmbedRequestError(
        401,
        "APPLICATION_EMBED_SESSION_EXPIRED",
        "External session is not authenticated"
      )
    }
    if (this.#mode === "public" && Date.now() >= this.#sessionExpiresAt) {
      this.#requireReauthentication()
      throw new EmbedRequestError(
        401,
        "APPLICATION_EMBED_SESSION_EXPIRED",
        "External session expired"
      )
    }
    if (this.#mode === "token" && Date.now() >= this.#accessExpiresAt - 5_000) {
      await this.#renew()
    }
    let response = await this.#sessionFetch(path, init)
    if (this.#mode === "token" && response.status === 401) {
      await this.#renew()
      response = await this.#sessionFetch(path, init)
    } else if (
      this.#mode === "public" &&
      (response.status === 401 || response.status === 403)
    ) {
      this.#requireReauthentication()
    }
    return response
  }

  async upload(path: string, file: File, schema: z.ZodType) {
    const body = new FormData()
    body.set("file", file, file.name)
    return this.request(path, schema, { method: "POST", body })
  }

  async changeConversation(
    path: string,
    init: RequestInit = { method: "POST" }
  ): Promise<ConversationSessionUpdate> {
    const update = await this.request(
      path,
      conversationSessionUpdateSchema,
      init
    )
    this.#applyConversationSessionUpdate(update)
    return update
  }

  connectEvents(
    path: string,
    handlers: EmbedSessionEventHandlers,
    options: { initialEventId?: string } = {}
  ) {
    const controller = new AbortController()
    let lastEventId = options.initialEventId ?? ""
    let reconnectDelay = 1_000

    const dispatch = (frame: ReturnType<typeof parseSseFrame>) => {
      if (!frame?.data) return
      try {
        const payload: unknown = JSON.parse(frame.data)
        const parsed = sseEventSchema.safeParse(payload)
        if (!parsed.success) return
        if (frame.id !== undefined && frame.id !== parsed.data.id) return
        if (
          frame.event !== undefined &&
          frame.event !== "message" &&
          frame.event !== parsed.data.type
        ) {
          return
        }
        lastEventId = parsed.data.id
        handlers.onEvent(parsed.data)
      } catch {
        // Ignore malformed stream frames from an untrusted network boundary.
      }
    }

    const connect = async () => {
      while (!controller.signal.aborted) {
        if (!this.authenticated) {
          this.#requireReauthentication()
          return
        }
        try {
          if (
            this.#mode === "token" &&
            Date.now() >= this.#accessExpiresAt - 5_000
          ) {
            await this.#renew()
          }
          const headers = new Headers({
            accept: "text/event-stream",
          })
          if (lastEventId) headers.set("last-event-id", lastEventId)

          let response = await this.#sessionFetch(path, {
            headers,
            signal: controller.signal,
          })
          if (this.#mode === "token" && response.status === 401) {
            await this.#renew()
            response = await this.#sessionFetch(path, {
              headers,
              signal: controller.signal,
            })
          } else if (
            this.#mode === "public" &&
            (response.status === 401 || response.status === 403)
          ) {
            this.#requireReauthentication()
            return
          }

          if (!response.ok || !response.body)
            throw new Error("EMBED_EVENT_STREAM_FAILED")
          reconnectDelay = 1_000
          handlers.onConnectionChange?.("connected")
          this.#events.onConnectionStateChange("connected")

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          while (!controller.signal.aborted) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            const frames = buffer.split(/\r?\n\r?\n/u)
            buffer = frames.pop() ?? ""
            for (const rawFrame of frames) {
              const frame = parseSseFrame(rawFrame)
              if (!frame) continue
              if (frame.retry !== undefined) {
                reconnectDelay = Math.min(Math.max(frame.retry, 500), 30_000)
              }
              dispatch(frame)
            }
          }
        } catch (error) {
          if (controller.signal.aborted) return
          if (error instanceof DOMException && error.name === "AbortError") {
            return
          }
          if (
            error instanceof EmbedRequestError &&
            (error.status === 401 || error.status === 403)
          ) {
            this.#requireReauthentication()
            return
          }
        }

        if (!controller.signal.aborted) {
          handlers.onConnectionChange?.("retrying")
          this.#events.onConnectionStateChange("retrying")
          await wait(reconnectDelay)
          reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
        }
      }
    }

    void connect()
    return () => controller.abort()
  }

  destroy() {
    this.#destroyed = true
    if (this.#renewTimer !== null) window.clearTimeout(this.#renewTimer)
    this.#clearSession()
  }

  async #sessionFetch(path: string, init: RequestInit) {
    const headers = new Headers(init.headers)
    if (this.#mode === "token") {
      headers.set("authorization", `Bearer ${this.#accessToken}`)
    } else if (this.#mode === "public" && this.#appId && this.#sessionId) {
      headers.set("x-linksense-embed-app-id", this.#appId)
      headers.set("x-linksense-embed-session-id", this.#sessionId)
      headers.set("x-linksense-embed-origin", this.#origin)
    }
    headers.set("accept", headers.get("accept") ?? "application/json")
    const language = document.documentElement.lang
    if (isLocale(language)) {
      headers.set("accept-language", language)
    }
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: "omit",
      cache: "no-store",
    })
    if (response.status === 503) {
      const error = await responseError(response.clone())
      if (error.code === "SYSTEM_MAINTENANCE_ACTIVE")
        this.#events.onMaintenance?.()
    }
    return response
  }

  async #publicRequest<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
    init: RequestInit
  ): Promise<z.infer<TSchema>> {
    try {
      return await embedPublicRequest(path, schema, init)
    } catch (error) {
      if (
        error instanceof EmbedRequestError &&
        error.code === "SYSTEM_MAINTENANCE_ACTIVE"
      ) {
        this.#events.onMaintenance?.()
      }
      throw error
    }
  }

  #requestPublicSession(appId: string) {
    return this.#publicRequest(
      "/api/v1/embed/public-sessions",
      publicSessionSchema,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          origin: this.#origin,
        }),
      }
    )
  }

  #renew() {
    if (this.#mode !== "token") {
      this.#requireReauthentication()
      return Promise.reject(
        new EmbedRequestError(
          401,
          "APPLICATION_EMBED_SESSION_EXPIRED",
          "External session renewal is unavailable"
        )
      )
    }
    if (this.#renewPromise) return this.#renewPromise
    this.#renewPromise = this.#performRenewal().finally(() => {
      this.#renewPromise = null
    })
    return this.#renewPromise
  }

  async #performRenewal(): Promise<void> {
    if (
      !this.#renewalToken ||
      Date.now() >= this.#renewalExpiresAt ||
      Date.now() >= this.#sessionExpiresAt
    ) {
      this.#requireReauthentication()
      throw new EmbedRequestError(
        401,
        "APPLICATION_EMBED_SESSION_EXPIRED",
        "External session renewal expired"
      )
    }
    const renewalRequestId = crypto.randomUUID()
    const retryDelays = [0, 1_000, 3_000, 8_000]
    let lastError: unknown
    for (const delay of retryDelays) {
      if (delay > 0) {
        this.#events.onConnectionStateChange("retrying")
        await wait(delay)
      }
      try {
        const tokens = await this.#publicRequest(
          "/api/v1/embed/sessions/renew",
          tokenPairSchema,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              renewal_token: this.#renewalToken,
              renewal_request_id: renewalRequestId,
              origin: this.#origin,
            }),
          }
        )
        this.#applyTokens(tokens)
        this.#events.onConnectionStateChange("connected")
        return
      } catch (error) {
        lastError = error
        if (
          error instanceof EmbedRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          this.#requireReauthentication()
          throw error
        }
      }
    }
    if (Date.now() >= this.#accessExpiresAt) this.#requireReauthentication()
    throw lastError
  }

  #applyTokens(tokens: TokenPair) {
    if (this.#destroyed) return
    if (this.#renewTimer !== null) window.clearTimeout(this.#renewTimer)
    this.#mode = "token"
    this.#appId = null
    this.#accessToken = tokens.access_token
    this.#renewalToken = tokens.renewal_token
    this.#accessExpiresAt = Date.parse(tokens.access_token_expires_at)
    this.#renewalExpiresAt = Date.parse(tokens.renewal_token_expires_at)
    this.#sessionExpiresAt = Date.parse(tokens.session_expires_at)
    this.#sessionId = tokens.session_id
    this.#scheduleRenewal()
  }

  #applyPublicSession(appId: string, session: PublicSession) {
    if (this.#destroyed) return
    if (this.#renewTimer !== null) window.clearTimeout(this.#renewTimer)
    this.#mode = "public"
    this.#appId = appId
    this.#accessToken = null
    this.#renewalToken = null
    this.#accessExpiresAt = 0
    this.#renewalExpiresAt = 0
    this.#sessionExpiresAt = Date.parse(session.session_expires_at)
    this.#sessionId = session.session_id
    this.#renewTimer = null
  }

  #applyConversationSessionUpdate(update: ConversationSessionUpdate) {
    if (
      update.access_token &&
      update.renewal_token &&
      update.access_token_expires_at &&
      update.renewal_token_expires_at
    ) {
      this.#applyTokens({
        access_token: update.access_token,
        renewal_token: update.renewal_token,
        access_token_expires_at: update.access_token_expires_at,
        renewal_token_expires_at: update.renewal_token_expires_at,
        session_expires_at: update.session_expires_at,
        session_id: update.session_id,
      })
      return
    }
    if (this.#mode === "public" && this.#appId) {
      this.#applyPublicSession(this.#appId, {
        session_id: update.session_id,
        session_expires_at: update.session_expires_at,
      })
      return
    }
    this.#requireReauthentication()
  }

  #scheduleRenewal() {
    if (this.#renewTimer !== null) window.clearTimeout(this.#renewTimer)
    const delay = Math.max(5_000, this.#accessExpiresAt - Date.now() - 120_000)
    this.#renewTimer = window.setTimeout(() => {
      void this.#renew().catch(() => undefined)
    }, delay)
  }

  #requireReauthentication() {
    this.#clearSession()
    this.#events.onAuthenticationRequired()
  }

  #clearSession() {
    this.#mode = null
    this.#appId = null
    this.#accessToken = null
    this.#renewalToken = null
    this.#accessExpiresAt = 0
    this.#renewalExpiresAt = 0
    this.#sessionExpiresAt = 0
    this.#sessionId = null
    if (this.#renewTimer !== null) window.clearTimeout(this.#renewTimer)
    this.#renewTimer = null
  }
}

export async function embedPublicRequest<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  init: RequestInit
): Promise<z.infer<TSchema>> {
  const response = await fetch(path, {
    ...init,
    credentials: "omit",
    cache: "no-store",
    headers: new Headers(init.headers),
  })
  return parseResponse(response, schema)
}

async function parseResponse<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema
): Promise<z.infer<TSchema>> {
  if (!response.ok) throw await responseError(response)
  if (response.status === 204) return schema.parse(undefined)
  const envelope = z
    .object({ success: z.literal(true), data: z.unknown() })
    .passthrough()
    .parse(await response.json())
  return schema.parse(envelope.data)
}

async function responseError(response: Response) {
  let payload: z.infer<typeof errorEnvelopeSchema> = {}
  try {
    payload = errorEnvelopeSchema.parse(await response.json())
  } catch {
    // Cross-system callers only receive the stable fallback below.
  }
  return new EmbedRequestError(
    response.status,
    payload.error?.code ?? payload.error_code ?? "EMBED_REQUEST_FAILED",
    payload.error?.message ?? payload.message ?? response.statusText
  )
}

function wait(delay: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay))
}
