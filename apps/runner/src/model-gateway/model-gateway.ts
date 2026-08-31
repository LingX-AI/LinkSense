import { randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";
import type { Logger } from "pino";
import { ProxyAgent } from "proxy-agent";
import { getProxyForUrl } from "proxy-from-env";
import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";
import WebSocket, {
  WebSocketServer,
  type ClientOptions as WebSocketClientOptions,
  type RawData,
} from "ws";

import type {
  MemoryGenerationOperation,
  ModelProviderProtocolMode,
  ModelTokenPricing,
  RunnerMemoryUsageCapture,
} from "@linksense/shared";

import {
  buildChatCompletionRequest,
  chatCompletionStreamToResponses,
  chatCompletionToResponse,
} from "./chat-completions-bridge.js";
import {
  beginSseResponse,
  parseSseStream,
  writeResponseChunk,
  writeSseEvent,
} from "./sse.js";
import {
  rewriteResponsesPayload,
  translateResponsesRequest,
  type ToolCompatibilityContext,
} from "./tool-compat.js";

const DEFAULT_REQUEST_BODY_LIMIT = 32 * 1024 * 1024;
const MODEL_TRANSITION_NONCE_METADATA_KEY = "linksense_transition_nonce";
const DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS = 30_000;
const DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS = 120_000;
const DEFAULT_UPSTREAM_WEBSOCKET_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_CLOSE_GRACE_MS = 5_000;
const DEFAULT_WEBSOCKET_QUEUE_MESSAGE_LIMIT = 1_024;
const UPSTREAM_ERROR_BODY_LIMIT = 64 * 1024;
const RESPONSES_WEBSOCKET_BETA = "responses_websockets=2026-02-06";
const MODEL_GATEWAY_ENV_KEY = "LINKSENSE_MODEL_GATEWAY_TOKEN";
const RESPONSE_PATHS = new Set(["/responses", "/v1/responses"]);
const SAFE_WEBSOCKET_RESPONSE_HEADERS = [
  "openai-model",
  "x-codex-turn-state",
  "x-models-etag",
  "x-reasoning-included",
  "x-request-id",
] as const;
const CONTEXT_LENGTH_EXCEEDED = "context_length_exceeded";
const CONTEXT_LENGTH_EXCEEDED_MESSAGE =
  "The request exceeded the model context window.";

type JsonObject = Record<string, unknown>;

export type ModelGatewayLeaseInput = {
  conversationId: string;
  ownerId: string;
  revision: number;
  upstreamBaseUrl: string;
  apiKey: string;
  protocolMode: ModelProviderProtocolMode;
  model: string;
  pricing: ModelTokenPricing;
};

export type ModelGatewayTransitionSource = Omit<
  ModelGatewayLeaseInput,
  "conversationId" | "ownerId"
>;

export type ModelGatewayTurnCorrelation = {
  turnId: string;
  codexTurnId: string | null;
  modelTransitionNonce: string | null;
};

export type ModelGatewayLease = {
  token: string;
  setTurnCorrelation: (correlation: ModelGatewayTurnCorrelation | null) => void;
  /**
   * Temporarily route Codex model-switch compaction to the exact source
   * provider. Ordinary requests remain primary-only.
   */
  setModelTransition: (
    source: ModelGatewayTransitionSource | null,
    transitionNonce: string | null,
  ) => void;
  /** Authorize the standalone native compaction initiated by LinkSense. */
  setManualModelTransitionCompaction: (enabled: boolean) => void;
  release: () => void;
};

export interface ModelGatewayRuntime {
  readonly baseUrl: string;
  issueLease(input: ModelGatewayLeaseInput): ModelGatewayLease;
}

export function modelGatewaySupportsWebSockets(
  protocolMode: ModelProviderProtocolMode,
): boolean {
  return protocolMode !== "chat_completions_bridge";
}

type StoredLease = Readonly<ModelGatewayLeaseInput> & {
  turnCorrelation: {
    current: Readonly<ModelGatewayTurnCorrelation> | null;
  };
  transitionSource: {
    current: Readonly<ModelGatewayTransitionSource> | null;
  };
  transitionNonce: { current: string | null };
  manualModelTransitionCompaction: { current: boolean };
};

type PendingWebSocketRequest = {
  body: JsonObject;
  compatibilityContext: ToolCompatibilityContext | null;
  context: ModelGatewayRequestContext;
  model: string;
};

type ModelGatewayWebSocketSession = {
  token: string;
  rawSocket: Duplex;
  downstream: WebSocket | null;
  upstream: WebSocket | null;
  closed: boolean;
  pendingRequest: PendingWebSocketRequest | null;
  downstreamQueuedBytes: number;
  upstreamQueuedBytes: number;
  downstreamQueuedMessages: number;
  upstreamQueuedMessages: number;
};

type BufferedUpstreamWebSocketEvent =
  | { type: "message"; data: RawData; isBinary: boolean }
  | { type: "error"; error: Error }
  | { type: "close"; code: number }
  | { type: "queue_overflow" };

type UpstreamWebSocketConnection = {
  socket: WebSocket;
  responseHeaders: ReadonlyMap<string, string>;
  releaseBufferedEvents: () => BufferedUpstreamWebSocketEvent[];
};

type ModelGatewayAbortSource =
  | "client_request_aborted"
  | "client_response_closed"
  | "upstream_header_timeout"
  | "upstream_idle_timeout"
  | "upstream_response_too_large"
  | "upstream_stream_cancelled";

type ModelGatewayRequestContext = {
  requestId: string;
  startedAt: number;
  conversationId: string | null;
  turnId: string | null;
  codexTurnId: string | null;
  leaseTurnCorrelation: StoredLease["turnCorrelation"] | null;
  memoryOperation: MemoryGenerationOperation | null;
  abortSource: ModelGatewayAbortSource | null;
};

type ModelGatewayRequestAbort = {
  controller: AbortController;
  abort: (source: ModelGatewayAbortSource) => void;
};

type ModelGatewayOptions = {
  logger: Logger;
  requestBodyLimit?: number;
  webSocketQueueLimit?: number;
  webSocketQueueMessageLimit?: number;
  upstreamHeaderTimeoutMs?: number;
  upstreamIdleTimeoutMs?: number;
  closeGraceMs?: number;
  fetch?: typeof fetch;
  onMemoryUsage?: (capture: RunnerMemoryUsageCapture) => Promise<void>;
};

class GatewayHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "GatewayHttpError";
  }
}

class UpstreamWebSocketHandshakeError extends Error {
  constructor(
    readonly statusCode: number | null,
    readonly errorClass: string,
  ) {
    super("model provider websocket handshake failed");
    this.name = "UpstreamWebSocketHandshakeError";
  }
}

class WebSocketBackpressureError extends Error {
  constructor() {
    super("model gateway websocket queue limit exceeded");
    this.name = "WebSocketBackpressureError";
  }
}

export class ModelGateway implements ModelGatewayRuntime {
  private readonly leases = new Map<string, StoredLease>();
  private readonly webSocketSessions = new Set<ModelGatewayWebSocketSession>();
  private readonly webSocketServer: WebSocketServer;
  private readonly webSocketResponseHeaders = new WeakMap<
    IncomingMessage,
    ReadonlyMap<string, string>
  >();
  private readonly httpProxyDispatcher: EnvHttpProxyAgent;
  private readonly webSocketProxyAgent: ProxyAgent;
  private readonly server: Server;
  private listeningBaseUrl: string | null = null;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  constructor(private readonly options: ModelGatewayOptions) {
    this.httpProxyDispatcher = new EnvHttpProxyAgent();
    this.webSocketProxyAgent = new ProxyAgent({
      getProxyForUrl: proxyUrlForWebSocket,
    });
    this.webSocketServer = new WebSocketServer({
      noServer: true,
      clientTracking: false,
      maxPayload: this.options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT,
      perMessageDeflate: false,
    });
    this.webSocketServer.on("headers", (headers, request) => {
      const responseHeaders = this.webSocketResponseHeaders.get(request);
      if (!responseHeaders) return;
      for (const [name, value] of responseHeaders) {
        headers.push(`${name}: ${value}`);
      }
    });
    this.server = createServer((request, response) => {
      const context = createRequestContext();
      void this.handleRequest(request, response, context).catch(
        (error: unknown) => {
          this.handleRequestFailure(response, error, context);
        },
      );
    });
    this.server.on("upgrade", (request, socket, head) => {
      void this.handleWebSocketUpgrade(request, socket, head).catch(
        (error: unknown) => {
          this.options.logger.error(
            {
              errorClass: error instanceof Error ? error.name : "unknown",
            },
            "model gateway websocket upgrade failed",
          );
          if (!socket.destroyed) socket.destroy();
        },
      );
    });
    this.server.headersTimeout = 10_000;
    this.server.requestTimeout = 130_000;
    this.server.keepAliveTimeout = 5_000;
  }

  get baseUrl(): string {
    if (!this.listeningBaseUrl) {
      throw new Error("model gateway has not started");
    }
    return this.listeningBaseUrl;
  }

  private get webSocketQueueLimit(): number {
    return (
      this.options.webSocketQueueLimit ??
      this.options.requestBodyLimit ??
      DEFAULT_REQUEST_BODY_LIMIT
    );
  }

  private get webSocketQueueMessageLimit(): number {
    return (
      this.options.webSocketQueueMessageLimit ??
      DEFAULT_WEBSOCKET_QUEUE_MESSAGE_LIMIT
    );
  }

  async start(): Promise<void> {
    if (this.listeningBaseUrl) throw new Error("model gateway already started");
    if (this.closing) throw new Error("model gateway is closing");
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(0, "127.0.0.1");
    });
    const address = this.server.address();
    if (!address || typeof address === "string") {
      throw new Error("model gateway returned an invalid listen address");
    }
    this.listeningBaseUrl = `http://127.0.0.1:${address.port}/v1`;
  }

  issueLease(input: ModelGatewayLeaseInput): ModelGatewayLease {
    if (!this.listeningBaseUrl || this.closing) {
      throw new Error("model gateway is unavailable");
    }
    const token = randomBytes(32).toString("base64url");
    const turnCorrelation: StoredLease["turnCorrelation"] = { current: null };
    const transitionSource: StoredLease["transitionSource"] = {
      current: null,
    };
    const transitionNonce: StoredLease["transitionNonce"] = { current: null };
    const manualModelTransitionCompaction: StoredLease["manualModelTransitionCompaction"] =
      { current: false };
    this.leases.set(
      token,
      Object.freeze({
        ...input,
        turnCorrelation,
        transitionSource,
        transitionNonce,
        manualModelTransitionCompaction,
      }),
    );
    let released = false;
    return {
      token,
      setTurnCorrelation: (correlation) => {
        if (released) return;
        turnCorrelation.current = correlation
          ? Object.freeze({ ...correlation })
          : null;
      },
      setModelTransition: (source, nonce) => {
        if (released) return;
        transitionSource.current = null;
        transitionNonce.current = null;
        manualModelTransitionCompaction.current = false;
        const normalizedNonce = nonce?.trim() ?? "";
        const normalizedModel = source?.model.trim() ?? "";
        if (
          !source ||
          !normalizedNonce ||
          !normalizedModel ||
          normalizedModel === input.model
        ) {
          return;
        }
        transitionSource.current = Object.freeze({
          ...source,
          model: normalizedModel,
          pricing: Object.freeze({ ...source.pricing }),
        });
        transitionNonce.current = normalizedNonce;
      },
      setManualModelTransitionCompaction: (enabled) => {
        if (released) return;
        manualModelTransitionCompaction.current =
          enabled && transitionSource.current !== null;
      },
      release: () => {
        if (released) return;
        released = true;
        this.leases.delete(token);
        this.terminateWebSocketSessionsForToken(token);
      },
    };
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.leases.clear();
    this.terminateAllWebSocketSessions();
    this.server.closeIdleConnections();
    const serverClosePromise = new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    const forceTimer = setTimeout(
      () => this.server.closeAllConnections(),
      this.options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
    );
    forceTimer.unref();
    this.closePromise = (async () => {
      try {
        await serverClosePromise;
      } finally {
        clearTimeout(forceTimer);
        this.listeningBaseUrl = null;
        this.webSocketProxyAgent.destroy();
        await this.httpProxyDispatcher.close();
      }
    })();
    return this.closePromise;
  }

  private async handleWebSocketUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    const context = createRequestContext();
    if (this.closing) {
      rejectWebSocketUpgrade(socket, 503, "gateway_unavailable");
      return;
    }
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (!RESPONSE_PATHS.has(requestUrl.pathname) || requestUrl.search !== "") {
      rejectWebSocketUpgrade(socket, 404, "not_found");
      return;
    }
    if (!isValidWebSocketUpgradeRequest(request)) {
      rejectWebSocketUpgrade(socket, 400, "invalid_websocket_upgrade");
      return;
    }
    const token = bearerToken(request.headers.authorization);
    const lease = token ? this.leases.get(token) : undefined;
    if (!token || !lease) {
      rejectWebSocketUpgrade(socket, 401, "invalid_gateway_token");
      return;
    }
    context.conversationId = lease.conversationId;
    context.leaseTurnCorrelation = lease.turnCorrelation;
    applyTurnCorrelation(context, lease.turnCorrelation.current);
    context.memoryOperation = memoryOperationFromHeaders(request.headers);

    if (!modelGatewaySupportsWebSockets(lease.protocolMode)) {
      rejectWebSocketUpgrade(socket, 426, "websocket_transport_unavailable");
      return;
    }

    const session: ModelGatewayWebSocketSession = {
      token,
      rawSocket: socket,
      downstream: null,
      upstream: null,
      closed: false,
      pendingRequest: null,
      downstreamQueuedBytes: 0,
      upstreamQueuedBytes: 0,
      downstreamQueuedMessages: 0,
      upstreamQueuedMessages: 0,
    };
    this.webSocketSessions.add(session);
    const handshakeAbort = new AbortController();
    const abortHandshake = () => handshakeAbort.abort();
    socket.once("close", abortHandshake);
    socket.once("error", abortHandshake);

    let connection: UpstreamWebSocketConnection;
    try {
      connection = await this.connectUpstreamWebSocket(
        lease,
        request,
        context,
        handshakeAbort.signal,
      );
    } catch (error) {
      this.webSocketSessions.delete(session);
      if (socket.destroyed || handshakeAbort.signal.aborted) return;
      const handshakeError =
        error instanceof UpstreamWebSocketHandshakeError ? error : null;
      const downstreamStatus = websocketHandshakeStatusForClient(
        handshakeError?.statusCode ?? null,
      );
      this.options.logger.warn(
        {
          ...requestLogFields(context),
          providerRevision: lease.revision,
          protocolMode: lease.protocolMode,
          upstreamStatus: handshakeError?.statusCode ?? undefined,
          errorClass:
            handshakeError?.errorClass ??
            (error instanceof Error ? error.name : "unknown"),
          fallbackToHttp: downstreamStatus === 426,
        },
        "model provider websocket handshake failed",
      );
      rejectWebSocketUpgrade(
        socket,
        downstreamStatus,
        downstreamStatus === 426
          ? "websocket_transport_unavailable"
          : "model_provider_error",
      );
      return;
    } finally {
      socket.off("close", abortHandshake);
      socket.off("error", abortHandshake);
    }

    session.upstream = connection.socket;
    if (
      session.closed ||
      socket.destroyed ||
      connection.socket.readyState !== WebSocket.OPEN
    ) {
      this.terminateWebSocketSession(session);
      return;
    }

    this.webSocketResponseHeaders.set(request, connection.responseHeaders);
    let downstreamAccepted = false;
    try {
      this.webSocketServer.handleUpgrade(
        request,
        socket,
        head,
        (downstream) => {
          downstreamAccepted = true;
          this.webSocketResponseHeaders.delete(request);
          if (
            session.closed ||
            connection.socket.readyState !== WebSocket.OPEN
          ) {
            downstream.terminate();
            this.terminateWebSocketSession(session);
            return;
          }
          session.downstream = downstream;
          this.bridgeWebSocketSession(session, lease, context, connection);
        },
      );
      // ws rejects malformed Upgrade requests synchronously without invoking
      // the callback or throwing. The upstream socket was opened first so its
      // response headers can be forwarded; explicitly release it in that path.
      if (!downstreamAccepted) {
        this.webSocketResponseHeaders.delete(request);
        session.closed = true;
        this.webSocketSessions.delete(session);
        terminateWebSocket(connection.socket);
      }
    } catch (error) {
      this.webSocketResponseHeaders.delete(request);
      this.terminateWebSocketSession(session);
      throw error;
    }
  }

  private connectUpstreamWebSocket(
    lease: StoredLease,
    request: IncomingMessage,
    context: ModelGatewayRequestContext,
    signal: AbortSignal,
  ): Promise<UpstreamWebSocketConnection> {
    const url = endpointWebSocketUrl(lease.upstreamBaseUrl, "responses");
    const headers: Record<string, string> = {
      authorization: `Bearer ${lease.apiKey}`,
      "openai-beta":
        singleHeaderValue(request.headers["openai-beta"]) ??
        RESPONSES_WEBSOCKET_BETA,
      "user-agent": "LinkSense-Model-Gateway/1.0",
      "x-linksense-request-id": context.requestId,
    };
    for (const name of [
      "session-id",
      "thread-id",
      "x-client-request-id",
    ] as const) {
      const value = singleHeaderValue(request.headers[name]);
      if (value) headers[name] = value;
    }
    const clientOptions: WebSocketClientOptions = {
      followRedirects: false,
      handshakeTimeout: Math.min(
        this.options.upstreamHeaderTimeoutMs ??
          DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS,
        DEFAULT_UPSTREAM_WEBSOCKET_HANDSHAKE_TIMEOUT_MS,
      ),
      headers,
      agent: this.webSocketProxyAgent,
      maxPayload: this.options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT,
      perMessageDeflate: false,
    };

    return new Promise<UpstreamWebSocketConnection>((resolve, reject) => {
      const upstream = new WebSocket(url, clientOptions);
      let responseHeaders = new Map<string, string>();
      let settled = false;
      const bufferedEvents: BufferedUpstreamWebSocketEvent[] = [];
      let bufferedMessageBytes = 0;
      let bufferedMessageCount = 0;
      let bufferingReleased = false;
      const onBufferedMessage = (data: RawData, isBinary: boolean) => {
        const messageBytes = rawWebSocketDataByteLength(data);
        bufferedMessageBytes += messageBytes;
        bufferedMessageCount += 1;
        if (
          bufferedMessageBytes > this.webSocketQueueLimit ||
          bufferedMessageCount > this.webSocketQueueMessageLimit
        ) {
          if (
            !bufferedEvents.some((event) => event.type === "queue_overflow")
          ) {
            bufferedEvents.push({ type: "queue_overflow" });
          }
          upstream.terminate();
          return;
        }
        bufferedEvents.push({ type: "message", data, isBinary });
      };
      const onBufferedError = (error: Error) => {
        bufferedEvents.push({ type: "error", error });
      };
      const onBufferedClose = (code: number) => {
        bufferedEvents.push({ type: "close", code });
      };
      const releaseBufferedEvents = () => {
        if (!bufferingReleased) {
          bufferingReleased = true;
          upstream.off("message", onBufferedMessage);
          upstream.off("error", onBufferedError);
          upstream.off("close", onBufferedClose);
        }
        return bufferedEvents.splice(0);
      };
      const removeHandshakeListeners = () => {
        signal.removeEventListener("abort", onAbort);
        upstream.off("open", onOpen);
        upstream.off("upgrade", onUpgrade);
        upstream.off("unexpected-response", onUnexpectedResponse);
        upstream.off("error", onError);
      };
      const fail = (error: UpstreamWebSocketHandshakeError) => {
        if (settled) return;
        settled = true;
        removeHandshakeListeners();
        upstream.on("error", () => undefined);
        if (
          upstream.readyState === WebSocket.CONNECTING ||
          upstream.readyState === WebSocket.OPEN
        ) {
          upstream.terminate();
        }
        reject(error);
      };
      const onAbort = () => {
        fail(new UpstreamWebSocketHandshakeError(null, "AbortError"));
      };
      const onUpgrade = (response: IncomingMessage) => {
        const safeHeaders = new Map<string, string>();
        for (const name of SAFE_WEBSOCKET_RESPONSE_HEADERS) {
          const value = singleHeaderValue(response.headers[name]);
          if (value) safeHeaders.set(name, value);
        }
        responseHeaders = safeHeaders;
      };
      const onUnexpectedResponse = (
        _webSocket: WebSocket,
        response: IncomingMessage,
      ) => {
        response.resume();
        fail(
          new UpstreamWebSocketHandshakeError(
            response.statusCode ?? null,
            "UnexpectedResponse",
          ),
        );
      };
      const onError = (error: Error) => {
        fail(
          new UpstreamWebSocketHandshakeError(
            null,
            error.name || "WebSocketError",
          ),
        );
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        // The provider can deliver a frame in the same network read as its 101
        // response. Buffer transition events before dropping the handshake
        // listeners so no message is lost and no unhandled error can escape.
        upstream.on("message", onBufferedMessage);
        upstream.on("error", onBufferedError);
        upstream.on("close", onBufferedClose);
        removeHandshakeListeners();
        resolve({ socket: upstream, responseHeaders, releaseBufferedEvents });
      };

      signal.addEventListener("abort", onAbort, { once: true });
      upstream.once("upgrade", onUpgrade);
      upstream.once("unexpected-response", onUnexpectedResponse);
      upstream.once("error", onError);
      upstream.once("open", onOpen);
      if (signal.aborted) onAbort();
    });
  }

  private bridgeWebSocketSession(
    session: ModelGatewayWebSocketSession,
    lease: StoredLease,
    connectionContext: ModelGatewayRequestContext,
    connection: UpstreamWebSocketConnection,
  ): void {
    const downstream = session.downstream;
    const upstream = session.upstream;
    if (!downstream || !upstream) {
      this.terminateWebSocketSession(session);
      return;
    }
    let downstreamChain = Promise.resolve();
    let upstreamChain = Promise.resolve();
    const closeDownstreamAfterUpstreamDrain = (code: number) => {
      void upstreamChain.then(() => {
        if (!session.closed) {
          this.closeWebSocketSessionFromPeer(session, downstream, code);
        }
      });
    };
    const enqueueMessage = (
      direction: "downstream" | "upstream",
      data: RawData,
      isBinary: boolean,
    ) => {
      const messageBytes = rawWebSocketDataByteLength(data);
      const target = direction === "downstream" ? upstream : downstream;
      if (
        !this.reserveWebSocketQueue(
          session,
          lease,
          connectionContext,
          direction,
          messageBytes,
          target,
        )
      ) {
        return;
      }
      if (direction === "downstream") {
        downstreamChain = downstreamChain
          .then(async () => {
            if (session.closed) return;
            await this.forwardDownstreamWebSocketMessage(
              session,
              lease,
              data,
              isBinary,
            );
          })
          .catch((error: unknown) => {
            this.logWebSocketBridgeFailure(
              connectionContext,
              lease,
              "downstream_message",
              error,
            );
            this.terminateWebSocketSession(session);
          })
          .finally(() => {
            this.releaseWebSocketQueue(session, direction, messageBytes);
          });
        return;
      }
      upstreamChain = upstreamChain
        .then(async () => {
          if (session.closed) return;
          await this.forwardUpstreamWebSocketMessage(
            session,
            lease,
            data,
            isBinary,
          );
        })
        .catch((error: unknown) => {
          this.logWebSocketBridgeFailure(
            connectionContext,
            lease,
            "upstream_message",
            error,
          );
          this.terminateWebSocketSession(session);
        })
        .finally(() => {
          this.releaseWebSocketQueue(session, direction, messageBytes);
        });
    };

    downstream.on("message", (data, isBinary) => {
      enqueueMessage("downstream", data, isBinary);
    });
    upstream.on("message", (data, isBinary) => {
      enqueueMessage("upstream", data, isBinary);
    });
    downstream.on("close", (code) => {
      this.closeWebSocketSessionFromPeer(session, upstream, code);
    });
    upstream.on("close", (code) => {
      closeDownstreamAfterUpstreamDrain(code);
    });
    downstream.on("error", (error) => {
      this.logWebSocketBridgeFailure(
        connectionContext,
        lease,
        "downstream_socket",
        error,
      );
      this.terminateWebSocketSession(session);
    });
    upstream.on("error", (error) => {
      this.logWebSocketBridgeFailure(
        connectionContext,
        lease,
        "upstream_socket",
        error,
      );
      this.terminateWebSocketSession(session);
    });

    for (const event of connection.releaseBufferedEvents()) {
      if (session.closed) break;
      if (event.type === "message") {
        enqueueMessage("upstream", event.data, event.isBinary);
      } else if (event.type === "close") {
        closeDownstreamAfterUpstreamDrain(event.code);
        break;
      } else {
        const error =
          event.type === "error"
            ? event.error
            : new WebSocketBackpressureError();
        this.logWebSocketBridgeFailure(
          connectionContext,
          lease,
          "upstream_transition",
          error,
        );
        this.terminateWebSocketSession(session);
      }
    }
  }

  private reserveWebSocketQueue(
    session: ModelGatewayWebSocketSession,
    lease: StoredLease,
    connectionContext: ModelGatewayRequestContext,
    direction: "downstream" | "upstream",
    messageBytes: number,
    target: WebSocket,
  ): boolean {
    if (session.closed) return false;
    const queuedBytes =
      direction === "downstream"
        ? session.downstreamQueuedBytes
        : session.upstreamQueuedBytes;
    const queuedMessages =
      direction === "downstream"
        ? session.downstreamQueuedMessages
        : session.upstreamQueuedMessages;
    const nextQueuedBytes = queuedBytes + messageBytes;
    const nextQueuedMessages = queuedMessages + 1;
    const bufferedBytes = target.bufferedAmount;
    if (
      messageBytes > this.webSocketQueueLimit ||
      nextQueuedBytes + bufferedBytes > this.webSocketQueueLimit ||
      nextQueuedMessages > this.webSocketQueueMessageLimit
    ) {
      this.options.logger.warn(
        {
          ...requestLogFields(connectionContext),
          providerRevision: lease.revision,
          protocolMode: lease.protocolMode,
          direction,
          messageBytes,
          queuedBytes,
          queuedMessages,
          bufferedBytes,
          queueLimit: this.webSocketQueueLimit,
          messageLimit: this.webSocketQueueMessageLimit,
        },
        "model gateway websocket queue limit exceeded",
      );
      this.terminateWebSocketSession(session);
      return false;
    }
    if (direction === "downstream") {
      session.downstreamQueuedBytes = nextQueuedBytes;
      session.downstreamQueuedMessages = nextQueuedMessages;
    } else {
      session.upstreamQueuedBytes = nextQueuedBytes;
      session.upstreamQueuedMessages = nextQueuedMessages;
    }
    return true;
  }

  private releaseWebSocketQueue(
    session: ModelGatewayWebSocketSession,
    direction: "downstream" | "upstream",
    messageBytes: number,
  ): void {
    if (direction === "downstream") {
      session.downstreamQueuedBytes = Math.max(
        0,
        session.downstreamQueuedBytes - messageBytes,
      );
      session.downstreamQueuedMessages = Math.max(
        0,
        session.downstreamQueuedMessages - 1,
      );
    } else {
      session.upstreamQueuedBytes = Math.max(
        0,
        session.upstreamQueuedBytes - messageBytes,
      );
      session.upstreamQueuedMessages = Math.max(
        0,
        session.upstreamQueuedMessages - 1,
      );
    }
  }

  private async forwardDownstreamWebSocketMessage(
    session: ModelGatewayWebSocketSession,
    lease: StoredLease,
    data: RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) throw new Error("binary websocket frames are unsupported");
    const downstream = requiredOpenWebSocket(session.downstream);
    if (session.pendingRequest) {
      await sendWebSocketError(
        downstream,
        409,
        "websocket_request_in_progress",
        "A response is already in progress on this connection.",
        this.webSocketQueueLimit,
      );
      return;
    }
    let source: JsonObject;
    try {
      source = normalizeResponsesRequest(parseJsonObject(data.toString()));
    } catch {
      await sendWebSocketError(
        downstream,
        400,
        "invalid_json",
        "The WebSocket event is invalid.",
        this.webSocketQueueLimit,
      );
      return;
    }
    if (source.type !== "response.create") {
      await sendWebSocketError(
        downstream,
        400,
        "invalid_websocket_event",
        "Only response.create events are supported.",
        this.webSocketQueueLimit,
      );
      return;
    }
    const requestedModel = stringValue(source.model);
    const authorizedLease = requestedModel
      ? authorizeModelRequest(
          lease,
          requestedModel,
          modelTransitionCompactionFromClientMetadata(source.client_metadata),
        )
      : null;
    if (!authorizedLease) {
      await sendWebSocketError(
        downstream,
        403,
        "model_not_authorized",
        "The model is not authorized.",
        this.webSocketQueueLimit,
      );
      return;
    }
    if (authorizedLease !== lease) {
      await sendWebSocketError(
        downstream,
        403,
        "model_transition_requires_http",
        "Model transition compaction requires HTTP transport.",
        this.webSocketQueueLimit,
      );
      return;
    }
    const context = createRequestContext();
    context.conversationId = lease.conversationId;
    context.leaseTurnCorrelation = lease.turnCorrelation;
    applyTurnCorrelation(context, lease.turnCorrelation.current);
    // Codex reuses a Responses WebSocket across turns. Handshake headers only
    // describe the request that opened the connection, while client_metadata
    // is rebuilt for every response.create. Never carry a handshake memory
    // marker into later ordinary requests on the same socket.
    context.memoryOperation = memoryOperationFromClientMetadata(
      source.client_metadata,
    );
    let body = source;
    let compatibilityContext: ToolCompatibilityContext | null = null;
    if (lease.protocolMode === "responses_tool_compat") {
      const translated = translateResponsesRequest(source);
      body = translated.body;
      compatibilityContext = translated.context;
      if (!Object.hasOwn(source, "tools")) delete body.tools;
    }
    session.pendingRequest = {
      body: source,
      compatibilityContext,
      context,
      model: authorizedLease.model,
    };
    try {
      await sendWebSocketJson(
        requiredOpenWebSocket(session.upstream),
        body,
        this.webSocketQueueLimit,
      );
    } catch (error) {
      session.pendingRequest = null;
      throw error;
    }
  }

  private async forwardUpstreamWebSocketMessage(
    session: ModelGatewayWebSocketSession,
    lease: StoredLease,
    data: RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) throw new Error("model provider returned a binary frame");
    const source = parseJsonObject(data.toString());
    const pending = session.pendingRequest;
    const rewritten = pending?.compatibilityContext
      ? rewriteResponsesPayload(source, pending.compatibilityContext)
      : source;
    const terminal = isTerminalWebSocketEvent(source);
    if (terminal) session.pendingRequest = null;
    if (rewritten !== null) {
      await sendWebSocketJson(
        requiredOpenWebSocket(session.downstream),
        rewritten,
        this.webSocketQueueLimit,
      );
    }
    const completed = isRecord(rewritten)
      ? completedResponseFromEvent(rewritten)
      : null;
    if (
      completed &&
      pending?.context.memoryOperation &&
      pending.body.generate !== false
    ) {
      await this.captureMemoryUsage(
        lease,
        pending.context.memoryOperation,
        pending.body,
        completed,
        pending.context,
      );
    }
  }

  private closeWebSocketSessionFromPeer(
    session: ModelGatewayWebSocketSession,
    peer: WebSocket,
    closeCode: number,
  ): void {
    if (session.closed) return;
    session.closed = true;
    this.webSocketSessions.delete(session);
    if (peer.readyState === WebSocket.CONNECTING) {
      peer.terminate();
      return;
    }
    if (
      peer.readyState === WebSocket.OPEN ||
      peer.readyState === WebSocket.CLOSING
    ) {
      if (peer.readyState === WebSocket.OPEN) {
        peer.close(safeWebSocketCloseCode(closeCode));
      }
      const forceTimer = setTimeout(
        () => terminateWebSocket(peer),
        this.options.closeGraceMs ?? DEFAULT_CLOSE_GRACE_MS,
      );
      forceTimer.unref();
      peer.once("close", () => clearTimeout(forceTimer));
    }
  }

  private terminateWebSocketSession(
    session: ModelGatewayWebSocketSession,
  ): void {
    if (session.closed) return;
    session.closed = true;
    this.webSocketSessions.delete(session);
    if (!session.rawSocket.destroyed) session.rawSocket.destroy();
    terminateWebSocket(session.downstream);
    terminateWebSocket(session.upstream);
  }

  private terminateWebSocketSessionsForToken(token: string): void {
    for (const session of [...this.webSocketSessions]) {
      if (session.token === token) this.terminateWebSocketSession(session);
    }
  }

  private terminateAllWebSocketSessions(): void {
    for (const session of [...this.webSocketSessions]) {
      this.terminateWebSocketSession(session);
    }
  }

  private logWebSocketBridgeFailure(
    context: ModelGatewayRequestContext,
    lease: StoredLease,
    stage: string,
    error: unknown,
  ): void {
    this.options.logger.warn(
      {
        ...requestLogFields(context),
        providerRevision: lease.revision,
        protocolMode: lease.protocolMode,
        stage,
        errorClass: error instanceof Error ? error.name : "unknown",
      },
      "model gateway websocket bridge failed",
    );
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
    context: ModelGatewayRequestContext,
  ): Promise<void> {
    if (this.closing) {
      throw new GatewayHttpError(503, "gateway_unavailable");
    }
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (
      request.method !== "POST" ||
      !RESPONSE_PATHS.has(requestUrl.pathname) ||
      requestUrl.search !== ""
    ) {
      throw new GatewayHttpError(404, "not_found");
    }
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      throw new GatewayHttpError(415, "unsupported_media_type");
    }
    const token = bearerToken(request.headers.authorization);
    const lease = token ? this.leases.get(token) : undefined;
    if (!lease) throw new GatewayHttpError(401, "invalid_gateway_token");
    context.conversationId = lease.conversationId;
    context.leaseTurnCorrelation = lease.turnCorrelation;
    applyTurnCorrelation(context, lease.turnCorrelation.current);
    context.memoryOperation = memoryOperationFromHeaders(request.headers);

    const upstreamAbort = createRequestAbort(context);
    const abortOnRequest = () => {
      upstreamAbort.abort("client_request_aborted");
    };
    const abortOnResponse = () => {
      if (!response.writableFinished) {
        upstreamAbort.abort("client_response_closed");
      }
    };
    request.once("aborted", abortOnRequest);
    response.once("close", abortOnResponse);
    try {
      const body = normalizeResponsesRequest(
        await readJsonRequest(
          request,
          this.options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT,
        ),
      );
      const requestedModel = stringValue(body.model);
      const authorizedLease = requestedModel
        ? authorizeModelRequest(
            lease,
            requestedModel,
            modelTransitionCompactionFromHttpRequest(request.headers, body),
          )
        : null;
      if (!authorizedLease) {
        throw new GatewayHttpError(403, "model_not_authorized");
      }
      if (authorizedLease.protocolMode === "native_responses") {
        await this.forwardNativeResponses(
          authorizedLease,
          body,
          response,
          upstreamAbort,
          context,
        );
        return;
      }
      const translated = translateResponsesRequest(body);
      if (authorizedLease.protocolMode === "responses_tool_compat") {
        await this.forwardCompatibleResponses(
          authorizedLease,
          translated.body,
          translated.context,
          response,
          upstreamAbort,
          context,
          body,
        );
        return;
      }
      await this.forwardChatCompletions(
        authorizedLease,
        translated.body,
        translated.context,
        response,
        upstreamAbort,
        context,
        body,
      );
    } finally {
      request.off("aborted", abortOnRequest);
      response.off("close", abortOnResponse);
    }
  }

  private async forwardNativeResponses(
    lease: StoredLease,
    body: JsonObject,
    response: ServerResponse,
    abort: ModelGatewayRequestAbort,
    context: ModelGatewayRequestContext,
  ): Promise<void> {
    const upstream = await this.callUpstream(
      endpointUrl(lease.upstreamBaseUrl, "responses"),
      lease.apiKey,
      body,
      abort,
      context,
    );
    if (
      await this.handleUnsuccessfulUpstream(
        upstream,
        lease,
        body.stream === true,
        response,
        abort,
        context,
      )
    ) {
      return;
    }
    copySafeUpstreamHeaders(upstream, response);
    response.writeHead(upstream.status);
    if (!upstream.body) {
      response.end();
      return;
    }
    const stream = withIdleTimeout(
      upstream.body,
      this.options.upstreamIdleTimeoutMs ?? DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS,
      abort,
    );
    if (
      context.memoryOperation &&
      isEventStream(upstream.headers.get("content-type"))
    ) {
      const [forwarded, inspected] = stream.tee();
      const inspection = this.inspectMemoryStream(
        lease,
        context.memoryOperation,
        body,
        inspected,
        context,
      );
      try {
        await pipeBody(forwarded, response);
      } finally {
        await inspection;
      }
      return;
    }
    if (context.memoryOperation) {
      const payload = await readJsonStream(
        stream,
        this.options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT,
        abort,
      );
      await this.captureMemoryUsage(
        lease,
        context.memoryOperation,
        body,
        payload,
        context,
      );
      response.end(JSON.stringify(payload));
      return;
    }
    await pipeBody(stream, response);
  }

  private async forwardCompatibleResponses(
    lease: StoredLease,
    body: JsonObject,
    context: ToolCompatibilityContext,
    response: ServerResponse,
    abort: ModelGatewayRequestAbort,
    requestContext: ModelGatewayRequestContext,
    meteredRequestBody: JsonObject,
  ): Promise<void> {
    let memoryOperation = requestContext.memoryOperation;
    const upstream = await this.callUpstream(
      endpointUrl(lease.upstreamBaseUrl, "responses"),
      lease.apiKey,
      body,
      abort,
      requestContext,
    );
    if (
      await this.handleUnsuccessfulUpstream(
        upstream,
        lease,
        body.stream === true,
        response,
        abort,
        requestContext,
      )
    ) {
      return;
    }
    const streamRequested = body.stream === true;
    if (
      streamRequested &&
      upstream.body &&
      isEventStream(upstream.headers.get("content-type"))
    ) {
      beginSseResponse(response);
      const stream = withIdleTimeout(
        upstream.body,
        this.options.upstreamIdleTimeoutMs ?? DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS,
        abort,
      );
      for await (const event of parseSseStream(stream)) {
        if (event.data.trim() === "[DONE]") continue;
        const payload = parseJsonObject(event.data);
        const rewritten = rewriteResponsesPayload(payload, context);
        if (!isRecord(rewritten)) continue;
        const completed = completedResponseFromEvent(rewritten);
        if (completed && memoryOperation) {
          await this.captureMemoryUsage(
            lease,
            memoryOperation,
            meteredRequestBody,
            completed,
            requestContext,
          );
          memoryOperation = null;
        }
        await writeSseEvent(
          response,
          event.event ?? stringValue(rewritten.type) ?? "message",
          rewritten,
        );
      }
      response.end();
      return;
    }
    const payload = await readJsonResponse(
      upstream,
      this.options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT,
      this.options.upstreamIdleTimeoutMs ?? DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS,
      abort,
    );
    const rewritten = rewriteResponsesPayload(payload, context);
    if (!isRecord(rewritten)) {
      throw new Error("model provider returned an invalid response");
    }
    if (memoryOperation) {
      await this.captureMemoryUsage(
        lease,
        memoryOperation,
        meteredRequestBody,
        rewritten,
        requestContext,
      );
    }
    if (streamRequested) {
      await writeCompletedResponseAsSse(response, rewritten);
      return;
    }
    writeJson(response, 200, rewritten);
  }

  private async forwardChatCompletions(
    lease: StoredLease,
    body: JsonObject,
    context: ToolCompatibilityContext,
    response: ServerResponse,
    abort: ModelGatewayRequestAbort,
    requestContext: ModelGatewayRequestContext,
    meteredRequestBody: JsonObject,
  ): Promise<void> {
    const streamRequested = body.stream === true;
    let memoryOperation = requestContext.memoryOperation;
    const upstream = await this.callUpstream(
      endpointUrl(lease.upstreamBaseUrl, "chat/completions"),
      lease.apiKey,
      buildChatCompletionRequest(body, streamRequested),
      abort,
      requestContext,
    );
    if (
      await this.handleUnsuccessfulUpstream(
        upstream,
        lease,
        streamRequested,
        response,
        abort,
        requestContext,
      )
    ) {
      return;
    }
    if (
      streamRequested &&
      upstream.body &&
      isEventStream(upstream.headers.get("content-type"))
    ) {
      beginSseResponse(response);
      const timedResponse = new Response(
        withIdleTimeout(
          upstream.body,
          this.options.upstreamIdleTimeoutMs ??
            DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS,
          abort,
        ),
        { headers: upstream.headers, status: upstream.status },
      );
      for await (const event of chatCompletionStreamToResponses(
        timedResponse,
        lease.model,
      )) {
        const rewritten = rewriteResponsesPayload(event.data, context);
        if (!isRecord(rewritten)) continue;
        const completed = completedResponseFromEvent(rewritten);
        if (completed && memoryOperation) {
          await this.captureMemoryUsage(
            lease,
            memoryOperation,
            meteredRequestBody,
            completed,
            requestContext,
          );
          memoryOperation = null;
        }
        await writeSseEvent(response, event.event, rewritten);
      }
      response.end();
      return;
    }
    const completion = await readJsonResponse(
      upstream,
      this.options.requestBodyLimit ?? DEFAULT_REQUEST_BODY_LIMIT,
      this.options.upstreamIdleTimeoutMs ?? DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS,
      abort,
    );
    const bridged = chatCompletionToResponse(completion, lease.model);
    const rewritten = rewriteResponsesPayload(bridged, context);
    if (!isRecord(rewritten)) {
      throw new Error("model provider returned an invalid response");
    }
    if (memoryOperation) {
      await this.captureMemoryUsage(
        lease,
        memoryOperation,
        meteredRequestBody,
        rewritten,
        requestContext,
      );
    }
    if (streamRequested) {
      await writeCompletedResponseAsSse(response, rewritten);
      return;
    }
    writeJson(response, 200, rewritten);
  }

  private async callUpstream(
    url: URL,
    apiKey: string,
    body: JsonObject,
    abort: ModelGatewayRequestAbort,
    context: ModelGatewayRequestContext,
  ): Promise<Response> {
    const timer = setTimeout(
      () => abort.abort("upstream_header_timeout"),
      this.options.upstreamHeaderTimeoutMs ??
        DEFAULT_UPSTREAM_HEADER_TIMEOUT_MS,
    );
    timer.unref();
    try {
      const requestInit = {
        method: "POST",
        headers: {
          accept:
            body.stream === true ? "text/event-stream" : "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "x-linksense-request-id": context.requestId,
          "user-agent": "LinkSense-Model-Gateway/1.0",
        },
        body: JSON.stringify(body),
        redirect: "manual" as const,
        signal: abort.controller.signal,
      };
      if (this.options.fetch) return await this.options.fetch(url, requestInit);
      return (await undiciFetch(url, {
        ...requestInit,
        dispatcher: this.httpProxyDispatcher,
      })) as unknown as Response;
    } finally {
      clearTimeout(timer);
    }
  }

  private async handleUnsuccessfulUpstream(
    upstream: Response,
    lease: StoredLease,
    streamRequested: boolean,
    response: ServerResponse,
    abort: ModelGatewayRequestAbort,
    context: ModelGatewayRequestContext,
  ): Promise<boolean> {
    if (upstream.ok) return false;
    let payload: JsonObject | null = null;
    if (upstream.body) {
      try {
        payload = await readJsonStream(
          withIdleTimeout(
            upstream.body,
            this.options.upstreamIdleTimeoutMs ??
              DEFAULT_UPSTREAM_IDLE_TIMEOUT_MS,
            abort,
          ),
          UPSTREAM_ERROR_BODY_LIMIT,
          abort,
        );
      } catch {
        payload = null;
      }
    }
    const statusCode =
      upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
    const contextLengthExceeded = isContextLengthExceededError(
      payload,
      upstream.status,
    );
    this.options.logger.warn(
      {
        ...requestLogFields(context),
        providerRevision: lease.revision,
        protocolMode: lease.protocolMode,
        upstreamStatus: upstream.status,
        upstreamRequestId:
          upstream.headers.get("x-request-id") ??
          upstream.headers.get("request-id"),
        upstreamErrorCode: contextLengthExceeded
          ? CONTEXT_LENGTH_EXCEEDED
          : undefined,
      },
      "model provider request failed",
    );
    if (contextLengthExceeded) {
      if (streamRequested) {
        beginSseResponse(response);
        await writeSseEvent(response, "response.failed", {
          type: "response.failed",
          sequence_number: 0,
          response: {
            status: "failed",
            error: {
              type: "invalid_request_error",
              code: CONTEXT_LENGTH_EXCEEDED,
              message: CONTEXT_LENGTH_EXCEEDED_MESSAGE,
            },
          },
        });
        response.end();
      } else {
        writeJson(response, 400, {
          error: {
            type: "invalid_request_error",
            code: CONTEXT_LENGTH_EXCEEDED,
            message: CONTEXT_LENGTH_EXCEEDED_MESSAGE,
          },
        });
      }
      return true;
    }
    throw new GatewayHttpError(statusCode, "model_provider_error");
  }

  private async inspectMemoryStream(
    lease: StoredLease,
    operation: MemoryGenerationOperation,
    requestBody: JsonObject,
    stream: ReadableStream<Uint8Array>,
    context: ModelGatewayRequestContext,
  ): Promise<void> {
    try {
      for await (const event of parseSseStream(stream)) {
        if (event.data.trim() === "[DONE]") continue;
        const completed = completedResponseFromEvent(
          parseJsonObject(event.data),
        );
        if (!completed) continue;
        await this.captureMemoryUsage(
          lease,
          operation,
          requestBody,
          completed,
          context,
        );
        return;
      }
    } catch (error) {
      this.options.logger.warn(
        {
          ...requestLogFields(context),
          operation,
          errorClass: error instanceof Error ? error.name : "unknown",
        },
        "failed to inspect memory generation stream usage",
      );
    }
  }

  private async captureMemoryUsage(
    lease: StoredLease,
    operation: MemoryGenerationOperation,
    requestBody: JsonObject,
    completedResponse: JsonObject,
    context: ModelGatewayRequestContext,
  ): Promise<void> {
    if (!this.options.onMemoryUsage) return;
    const providerUsage = readProviderTokenUsage(completedResponse);
    const tokenUsage =
      providerUsage ?? estimateTokenUsage(requestBody, completedResponse);
    try {
      await this.options.onMemoryUsage({
        request_id: randomUUID(),
        owner_id: lease.ownerId,
        conversation_id: lease.conversationId,
        operation,
        model: lease.model,
        measurement_method: providerUsage ? "provider" : "estimated",
        token_usage: tokenUsage,
        pricing: lease.pricing,
        observed_at: new Date().toISOString(),
      });
    } catch (error) {
      this.options.logger.error(
        {
          ...requestLogFields(context),
          operation,
          errorClass: error instanceof Error ? error.name : "unknown",
        },
        "failed to persist memory generation usage",
      );
    }
  }

  private handleRequestFailure(
    response: ServerResponse,
    error: unknown,
    context: ModelGatewayRequestContext,
  ): void {
    const known = error instanceof GatewayHttpError;
    const statusCode = known ? error.statusCode : 502;
    const code = known ? error.code : "model_gateway_error";
    if (!known) {
      this.options.logger.error(
        {
          ...requestLogFields(context),
          errorClass: error instanceof Error ? error.name : "unknown",
        },
        "model gateway request failed",
      );
    }
    if (response.headersSent) {
      if (
        !response.writableEnded &&
        response.getHeader("content-type") ===
          "text/event-stream; charset=utf-8"
      ) {
        void writeSseEvent(response, "response.failed", {
          type: "response.failed",
          response: {
            status: "failed",
            error: {
              code: "model_provider_error",
              message: "The model provider request failed.",
            },
          },
        })
          .catch(() => undefined)
          .finally(() => response.end());
      } else if (!response.writableEnded) {
        response.destroy();
      }
      return;
    }
    writeJson(response, statusCode, {
      error: {
        type: "model_gateway_error",
        code,
        message: publicErrorMessage(code),
      },
    });
  }
}

export const modelGatewayEnvironmentKey = MODEL_GATEWAY_ENV_KEY;

function createRequestContext(): ModelGatewayRequestContext {
  return {
    requestId: randomUUID(),
    startedAt: Date.now(),
    conversationId: null,
    turnId: null,
    codexTurnId: null,
    leaseTurnCorrelation: null,
    memoryOperation: null,
    abortSource: null,
  };
}

function createRequestAbort(
  context: ModelGatewayRequestContext,
): ModelGatewayRequestAbort {
  const controller = new AbortController();
  return {
    controller,
    abort: (source) => {
      if (controller.signal.aborted) return;
      context.abortSource = source;
      controller.abort();
    },
  };
}

function applyTurnCorrelation(
  context: ModelGatewayRequestContext,
  correlation: Readonly<ModelGatewayTurnCorrelation> | null,
): void {
  if (!correlation) return;
  context.turnId = correlation.turnId;
  context.codexTurnId = correlation.codexTurnId;
}

function requestLogFields(context: ModelGatewayRequestContext): JsonObject {
  const latestCorrelation = context.leaseTurnCorrelation?.current ?? null;
  const latestMatchesRequest =
    latestCorrelation !== null &&
    (context.turnId === null || latestCorrelation.turnId === context.turnId);
  return {
    requestId: context.requestId,
    conversationId: context.conversationId,
    turnId: context.turnId ?? latestCorrelation?.turnId ?? null,
    codexTurnId:
      context.codexTurnId ??
      (latestMatchesRequest ? latestCorrelation.codexTurnId : null),
    memoryOperation: context.memoryOperation,
    abortSource: context.abortSource,
    durationMs: Math.max(0, Date.now() - context.startedAt),
  };
}

function endpointUrl(baseUrl: string, endpoint: string): URL {
  return new URL(`${baseUrl.replace(/\/+$/u, "")}/${endpoint}`);
}

function endpointWebSocketUrl(baseUrl: string, endpoint: string): URL {
  const url = endpointUrl(baseUrl, endpoint);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else throw new Error("model provider websocket URL is unsupported");
  return url;
}

function proxyUrlForWebSocket(target: string): string {
  const url = new URL(target);
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  return getProxyForUrl(url.toString());
}

function bearerToken(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice("Bearer ".length);
  return token === "" || /\s/u.test(token) ? null : token;
}

function isValidWebSocketUpgradeRequest(request: IncomingMessage): boolean {
  if (request.method !== "GET") return false;
  if (request.headers.upgrade?.toLowerCase() !== "websocket") return false;
  const key = singleHeaderValue(request.headers["sec-websocket-key"]);
  const version = singleHeaderValue(request.headers["sec-websocket-version"]);
  if (request.headers["sec-websocket-protocol"] !== undefined) return false;
  if (!key || (version !== "8" && version !== "13")) return false;
  const decoded = Buffer.from(key, "base64");
  return decoded.byteLength === 16 && decoded.toString("base64") === key;
}

function rejectWebSocketUpgrade(
  socket: Duplex,
  statusCode: number,
  code: string,
): void {
  if (socket.destroyed) return;
  const reason =
    statusCode === 400
      ? "Bad Request"
      : statusCode === 401
        ? "Unauthorized"
        : statusCode === 403
          ? "Forbidden"
          : statusCode === 404
            ? "Not Found"
            : statusCode === 426
              ? "Upgrade Required"
              : statusCode === 429
                ? "Too Many Requests"
                : statusCode === 503
                  ? "Service Unavailable"
                  : "Bad Gateway";
  const body = JSON.stringify({
    error: {
      type: "model_gateway_error",
      code,
      message: publicErrorMessage(code),
    },
  });
  const headers = [
    `HTTP/1.1 ${statusCode} ${reason}`,
    "Connection: close",
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Cache-Control: no-store",
    "X-Content-Type-Options: nosniff",
    ...(statusCode === 426 ? ["Upgrade: websocket"] : []),
    "",
    body,
  ].join("\r\n");
  socket.end(headers);
}

function requiredOpenWebSocket(socket: WebSocket | null): WebSocket {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    throw new Error("model gateway websocket is not open");
  }
  return socket;
}

function rawWebSocketDataByteLength(data: RawData): number {
  return Array.isArray(data)
    ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
    : data.byteLength;
}

function sendWebSocketJson(
  socket: WebSocket,
  value: unknown,
  bufferLimit: number,
): Promise<void> {
  const serialized = JSON.stringify(value);
  if (socket.bufferedAmount + Buffer.byteLength(serialized) > bufferLimit) {
    return Promise.reject(new WebSocketBackpressureError());
  }
  return new Promise<void>((resolve, reject) => {
    socket.send(serialized, { binary: false }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function sendWebSocketError(
  socket: WebSocket,
  status: number,
  code: string,
  message: string,
  bufferLimit: number,
): Promise<void> {
  return sendWebSocketJson(
    socket,
    {
      type: "error",
      status,
      error: {
        type: "invalid_request_error",
        code,
        message,
      },
    },
    bufferLimit,
  );
}

function terminateWebSocket(socket: WebSocket | null): void {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  socket.terminate();
}

function safeWebSocketCloseCode(code: number): number {
  return code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011;
}

function isTerminalWebSocketEvent(payload: JsonObject): boolean {
  return (
    payload.type === "response.completed" ||
    payload.type === "response.failed" ||
    payload.type === "response.incomplete" ||
    payload.type === "error"
  );
}

function websocketHandshakeStatusForClient(
  upstreamStatus: number | null,
): number {
  if (
    upstreamStatus === null ||
    [404, 405, 426, 501].includes(upstreamStatus) ||
    upstreamStatus >= 500
  ) {
    return 426;
  }
  return upstreamStatus >= 400 && upstreamStatus <= 499 ? upstreamStatus : 426;
}

async function readJsonRequest(
  request: IncomingMessage,
  limit: number,
): Promise<JsonObject> {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    request.resume();
    throw new GatewayHttpError(413, "request_body_too_large");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > limit) {
      request.resume();
      throw new GatewayHttpError(413, "request_body_too_large");
    }
    chunks.push(buffer);
  }
  try {
    return parseJsonObject(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GatewayHttpError(400, "invalid_json");
  }
}

async function readJsonResponse(
  response: Response,
  limit: number,
  idleTimeoutMs: number,
  abort: ModelGatewayRequestAbort,
): Promise<JsonObject> {
  if (!response.body) {
    throw new Error("model provider returned an empty response");
  }
  return readJsonStream(
    withIdleTimeout(response.body, idleTimeoutMs, abort),
    limit,
    abort,
  );
}

async function readJsonStream(
  body: ReadableStream<Uint8Array>,
  limit: number,
  abort: ModelGatewayRequestAbort,
): Promise<JsonObject> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    length += chunk.byteLength;
    if (length > limit) {
      abort.abort("upstream_response_too_large");
      throw new Error("model provider response exceeded the size limit");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
  ).toString("utf8");
  return parseJsonObject(text);
}

function parseJsonObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error("JSON value must be an object");
  return parsed;
}

function copySafeUpstreamHeaders(
  upstream: Response,
  response: ServerResponse,
): void {
  for (const name of ["content-type", "cache-control", "x-request-id"]) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.setHeader("x-content-type-options", "nosniff");
}

async function pipeBody(
  body: ReadableStream<Uint8Array>,
  response: ServerResponse,
): Promise<void> {
  for await (const chunk of body) {
    await writeResponseChunk(response, chunk);
  }
  response.end();
}

function withIdleTimeout(
  source: ReadableStream<Uint8Array>,
  timeoutMs: number,
  abort: ModelGatewayRequestAbort,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const timer = setTimeout(
        () => abort.abort("upstream_idle_timeout"),
        timeoutMs,
      );
      timer.unref();
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      } finally {
        clearTimeout(timer);
      }
    },
    async cancel(reason) {
      abort.abort("upstream_stream_cancelled");
      await reader.cancel(reason).catch(() => undefined);
    },
  });
}

function isEventStream(contentType: string | null): boolean {
  return contentType?.toLowerCase().startsWith("text/event-stream") ?? false;
}

async function writeCompletedResponseAsSse(
  response: ServerResponse,
  completed: JsonObject,
): Promise<void> {
  beginSseResponse(response);
  let sequence = 0;
  const output = Array.isArray(completed.output) ? completed.output : [];
  const inProgress = {
    ...completed,
    status: "in_progress",
    output: [],
    output_text: "",
  };
  await writeSseEvent(response, "response.created", {
    type: "response.created",
    sequence_number: sequence++,
    response: inProgress,
  });
  await writeSseEvent(response, "response.in_progress", {
    type: "response.in_progress",
    sequence_number: sequence++,
    response: inProgress,
  });
  for (const [outputIndex, item] of output.entries()) {
    await writeSseEvent(response, "response.output_item.added", {
      type: "response.output_item.added",
      output_index: outputIndex,
      sequence_number: sequence++,
      item: isRecord(item) ? { ...item, status: "in_progress" } : item,
    });
    await writeSseEvent(response, "response.output_item.done", {
      type: "response.output_item.done",
      output_index: outputIndex,
      sequence_number: sequence++,
      item,
    });
  }
  await writeSseEvent(response, "response.completed", {
    type: "response.completed",
    sequence_number: sequence,
    response: completed,
  });
  response.end();
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function publicErrorMessage(code: string): string {
  if (code === "invalid_gateway_token") return "Invalid gateway credentials.";
  if (code === "model_not_authorized") return "The model is not authorized.";
  if (code === "request_body_too_large")
    return "The request body is too large.";
  if (code === "invalid_json") return "The request body is invalid.";
  if (code === "unsupported_media_type") {
    return "The request content type is unsupported.";
  }
  if (code === "not_found") return "Not found.";
  if (code === "gateway_unavailable")
    return "The model gateway is unavailable.";
  if (code === "model_provider_error") {
    return "The model provider request failed.";
  }
  if (code === "websocket_transport_unavailable") {
    return "The WebSocket transport is unavailable.";
  }
  return "The model gateway request failed.";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isContextLengthExceededError(
  payload: JsonObject | null,
  statusCode?: number,
): boolean {
  if (!payload) return false;
  const directError = isRecord(payload.error) ? payload.error : null;
  const response = isRecord(payload.response) ? payload.response : null;
  const responseError =
    response && isRecord(response.error) ? response.error : null;
  const candidates = [directError, responseError, payload].filter(
    (candidate): candidate is JsonObject => candidate !== null,
  );
  if (
    candidates.some((error) => error.code === CONTEXT_LENGTH_EXCEEDED)
  ) {
    return true;
  }
  return (
    statusCode === 400 &&
    candidates.some((error) => isVllmContextLengthExceededError(error))
  );
}

function isVllmContextLengthExceededError(error: JsonObject): boolean {
  const message = stringValue(error.message)?.toLowerCase() ?? "";
  if (!message) return false;
  const type = stringValue(error.type)?.toLowerCase() ?? "";
  const parameter =
    stringValue(error.parameter)?.toLowerCase() ??
    stringValue(error.param)?.toLowerCase() ??
    "";
  const code = error.code;
  const codeMatches = code === 400 || code === "400";
  const typeMatches =
    type.includes("badrequest") || type.includes("invalid_request");
  const parameterMatches = [
    "input_tokens",
    "prompt_tokens",
    "prompt",
    "messages",
    "input",
  ].includes(parameter);
  const messageMatches =
    message.includes("maximum context length") ||
    (message.includes("max_model_len") &&
      (message.includes("exceed") || message.includes("larger than"))) ||
    (message.includes("input tokens") &&
      message.includes("reduce the length of the input prompt"));
  return messageMatches && (codeMatches || typeMatches || parameterMatches);
}

function normalizeResponsesRequest(source: JsonObject): JsonObject {
  if (!Array.isArray(source.input)) return source;
  const input = source.input.filter(
    (item) =>
      !isRecord(item) ||
      item.type !== "reasoning" ||
      stringValue(item.encrypted_content) !== null,
  );
  return input.length === source.input.length ? source : { ...source, input };
}

function authorizeModelRequest(
  lease: StoredLease,
  requestedModel: string,
  compactionAuthorization: ModelTransitionCompactionAuthorization | null,
): StoredLease | null {
  if (requestedModel === lease.model) {
    return lease;
  }
  const source = lease.transitionSource.current;
  if (
    source === null ||
    source.model !== requestedModel ||
    compactionAuthorization === null
  ) {
    return null;
  }
  if (
    compactionAuthorization.kind === "manual" &&
    lease.manualModelTransitionCompaction.current
  ) {
    return leaseForTransitionSource(lease, source);
  }
  const presentedTransitionNonce =
    compactionAuthorization.kind === "auto"
      ? compactionAuthorization.nonce
      : null;
  if (
    presentedTransitionNonce === null ||
    lease.turnCorrelation.current === null ||
    lease.transitionNonce.current === null ||
    lease.turnCorrelation.current.modelTransitionNonce === null ||
    presentedTransitionNonce !== lease.transitionNonce.current ||
    presentedTransitionNonce !==
      lease.turnCorrelation.current.modelTransitionNonce
  ) {
    return null;
  }
  return leaseForTransitionSource(lease, source);
}

function leaseForTransitionSource(
  lease: StoredLease,
  source: Readonly<ModelGatewayTransitionSource>,
): StoredLease {
  return Object.freeze({ ...lease, ...source });
}

type ModelTransitionCompactionAuthorization =
  | { kind: "manual" }
  | { kind: "auto"; nonce: string };

function modelTransitionCompactionFromHttpRequest(
  headers: IncomingMessage["headers"],
  body: JsonObject,
): ModelTransitionCompactionAuthorization | null {
  const bodyMetadata = turnMetadataFromClientMetadata(body.client_metadata);
  if (!bodyMetadata) return null;
  const headerMetadata = singleHeaderValue(
    headers["x-codex-turn-metadata"],
  );
  if (headerMetadata !== null && headerMetadata !== bodyMetadata) return null;
  return modelTransitionCompactionFromMetadata(bodyMetadata);
}

function modelTransitionCompactionFromClientMetadata(
  value: unknown,
): ModelTransitionCompactionAuthorization | null {
  return modelTransitionCompactionFromMetadata(
    turnMetadataFromClientMetadata(value),
  );
}

function turnMetadataFromClientMetadata(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return stringValue(value["x-codex-turn-metadata"]);
}

function modelTransitionCompactionFromMetadata(
  value: string | null,
): ModelTransitionCompactionAuthorization | null {
  if (!value) return null;
  try {
    const metadata: unknown = JSON.parse(value);
    if (
      !isRecord(metadata) ||
      metadata.request_kind !== "compaction" ||
      !isRecord(metadata.compaction) ||
      metadata.compaction.implementation !== "responses" ||
      metadata.compaction.strategy !== "memento"
    ) {
      return null;
    }
    if (
      metadata.compaction.trigger === "manual" &&
      metadata.compaction.reason === "user_requested" &&
      metadata.compaction.phase === "standalone_turn"
    ) {
      return { kind: "manual" };
    }
    if (
      metadata.compaction.trigger === "auto" &&
      (metadata.compaction.reason === "comp_hash_changed" ||
        metadata.compaction.reason === "model_downshift") &&
      metadata.compaction.phase === "pre_turn"
    ) {
      const nonce = stringValue(metadata[MODEL_TRANSITION_NONCE_METADATA_KEY]);
      return nonce ? { kind: "auto", nonce } : null;
    }
    return null;
  } catch {
    return null;
  }
}

function memoryOperationFromHeaders(
  headers: IncomingMessage["headers"],
): MemoryGenerationOperation | null {
  return memoryOperationFromValues(
    singleHeaderValue(headers["x-openai-subagent"]),
    singleHeaderValue(headers["x-openai-memgen-request"]),
    singleHeaderValue(headers["x-codex-turn-metadata"]),
  );
}

function memoryOperationFromClientMetadata(
  value: unknown,
): MemoryGenerationOperation | null {
  if (!isRecord(value)) return null;
  return memoryOperationFromValues(
    stringValue(value["x-openai-subagent"]),
    stringValue(value["x-openai-memgen-request"]),
    stringValue(value["x-codex-turn-metadata"]),
  );
}

function memoryOperationFromValues(
  subagent: string | null,
  memgen: string | null,
  metadata: string | null,
): MemoryGenerationOperation | null {
  if (subagent === "memory_consolidation" || memgen === "true") {
    return "consolidate";
  }
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    return isRecord(parsed) && parsed.request_kind === "memory"
      ? "extract"
      : null;
  } catch {
    return null;
  }
}

function singleHeaderValue(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value))
    return value.length === 1 ? (value[0] ?? null) : null;
  return value ?? null;
}

function completedResponseFromEvent(payload: JsonObject): JsonObject | null {
  return payload.type === "response.completed" && isRecord(payload.response)
    ? payload.response
    : null;
}

function readProviderTokenUsage(
  response: JsonObject,
): RunnerMemoryUsageCapture["token_usage"] | null {
  if (!isRecord(response.usage)) return null;
  const inputTokens = tokenCount(response.usage.input_tokens);
  const outputTokens = tokenCount(response.usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const totalTokens =
    tokenCount(response.usage.total_tokens) ?? inputTokens + outputTokens;
  const inputDetails = isRecord(response.usage.input_tokens_details)
    ? response.usage.input_tokens_details
    : {};
  const outputDetails = isRecord(response.usage.output_tokens_details)
    ? response.usage.output_tokens_details
    : {};
  const cachedInputTokens = tokenCount(inputDetails.cached_tokens) ?? 0;
  const reasoningOutputTokens = tokenCount(outputDetails.reasoning_tokens) ?? 0;
  if (cachedInputTokens > inputTokens || reasoningOutputTokens > outputTokens) {
    return null;
  }
  return {
    total_tokens: totalTokens,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
  };
}

function estimateTokenUsage(
  requestBody: JsonObject,
  response: JsonObject,
): RunnerMemoryUsageCapture["token_usage"] {
  const inputTokens = estimateSerializedTokens(requestBody);
  const outputTokens = estimateSerializedTokens(
    response.output ?? response.output_text ?? "",
  );
  return {
    total_tokens: inputTokens + outputTokens,
    input_tokens: inputTokens,
    cached_input_tokens: 0,
    output_tokens: outputTokens,
    reasoning_output_tokens: 0,
  };
}

function estimateSerializedTokens(value: unknown): number {
  const serialized = JSON.stringify(value) ?? "";
  try {
    return countTokens(serialized);
  } catch {
    return Math.ceil(serialized.length / 4);
  }
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
