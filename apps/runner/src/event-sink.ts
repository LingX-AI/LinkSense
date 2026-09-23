import type { Logger } from "pino";
import { relative } from "node:path";

import {
  RUNNER_EVENT_BATCH_MAX_COUNT,
  RUNNER_EVENT_BATCH_TARGET_BYTES,
  runnerEventBatchReceiptSchema,
  runnerStartSettledSchema,
  runnerStartSettledReceiptSchema,
  userWorkspacePathSchema,
  type RunnerStartSettled,
} from "@linksense/shared";
import type {
  ImageGenerationRequest,
  RunnerMemoryUsageCapture,
  RunnerHeartbeat,
} from "@linksense/shared";
import type {
  LinkSensePublishedEvent,
  LinkSenseRunnerEvent,
} from "./codex/event-mapper.js";
import { fileServiceErrorFromApi } from "./file-service-error.js";
import { imageGenerationErrorFromApi } from "./image-generation-error.js";
import { knowledgeSearchErrorFromApi } from "./knowledge-search-error.js";
import { knowledgeServiceErrorFromApi } from "./knowledge-service-error.js";
import { skillCreatorErrorFromApi } from "./skill-creator-error.js";
import { applicationBuilderErrorFromApi } from "./application-builder-error.js";
import { currentUserInfoErrorFromApi } from "./current-user-error.js";
import {
  DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  deriveKnowledgeSearchTimeouts,
} from "./knowledge-search-timeout.js";
import { RunnerEventOutboxStore, type RunnerEventOutboxEntry } from "./workspace/event-outbox.js";
import { MemoryUsageOutboxStore } from "./workspace/memory-usage-outbox.js";
import { WorkspaceManager } from "./workspace/workspace-manager.js";

export interface RunnerEventSink {
  reportStartSettled?(input: RunnerStartSettled): Promise<void>;
  /** Atomically persists the event before returning. */
  publish(conversationId: string, event: LinkSensePublishedEvent): Promise<void>;
  /** Persists every original event, in order, before returning. */
  publishBatch(conversationId: string, events: readonly LinkSensePublishedEvent[]): Promise<void>;
  reportProcessExit(input: ProcessExitReport): Promise<void>;
  registerArtifact(input: {
    conversationId: string;
    turnId: string;
    workspaceRelativePath: string;
    displayName: string;
    mimeType?: string;
    artifactKind?: string;
    webRootRelativePath?: string;
  }): Promise<unknown>;
  generateImage?(input: {
    conversationId: string;
    turnId: string;
    request: ImageGenerationRequest;
    signal?: AbortSignal;
  }): Promise<unknown>;
  previewSkillZip?(input: {
    conversationId: string;
    turnId: string;
    workspaceRelativePath: string;
  }): Promise<unknown>;
  applicationBuilder?(input: { conversationId: string; turnId: string; request: import("@linksense/shared").ApplicationBuilderRequest }): Promise<unknown>;
  confirmSkillInstall?(input: {
    conversationId: string;
    turnId: string;
    installToken: string;
  }): Promise<unknown>;
  searchKnowledge?(input: {
    conversationId: string;
    turnId: string;
    query: string;
    finalTopK: number;
    candidateMultiplier: number;
    numCandidates?: number;
    minScore: number;
    signal?: AbortSignal;
  }): Promise<unknown>;
  listKnowledgeDocuments?(input: {
    conversationId: string;
    turnId: string;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  getKnowledgeDocumentMarkdown?(input: {
    conversationId: string;
    turnId: string;
    documentRef: string;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  getCurrentUserInfo?(input: {
    conversationId: string;
    turnId: string;
  }): Promise<unknown>;
  emitInteractiveApplicationEvent?(input: {
    conversationId: string;
    codexTurnId: string;
    name: string;
    payload: unknown;
  }): Promise<unknown>;
  resumeConversation?(conversationId: string): Promise<void>;
  flushConversation?(conversationId: string, timeoutMs?: number): Promise<void>;
  alignConversationThread?(
    conversationId: string,
    codexThreadId: string,
  ): Promise<void>;
  recordMemoryUsage?(capture: RunnerMemoryUsageCapture): Promise<void>;
}

export type ProcessExitReport = {
  conversationId: string;
  projectionTurnId: string;
  capabilityGeneration: string;
};

type HttpRunnerEventSinkOptions = {
  serviceSessionId?: string;
  logger?: Pick<Logger, "warn" | "error">;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  processExitTimeoutMs?: number;
  knowledgeSearchTimeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  shutdownGraceMs?: number;
};

/**
 * HTTP-backed event sink with a per-conversation durable outbox.
 *
 * `publish` never waits for the API. It first commits a sanitized event to the
 * supervisor-only task control directory and then wakes a background, ordered
 * delivery worker.
 */
export class HttpRunnerEventSink implements RunnerEventSink {
  private readonly outbox: RunnerEventOutboxStore;
  private readonly memoryUsageOutbox: MemoryUsageOutboxStore;
  private readonly workers = new Map<string, Promise<void>>();
  private readonly deliveryWakeVersions = new Map<string, number>();
  private readonly deliveryWaiters = new Map<string, AbortController>();
  private readonly memoryUsageWorkers = new Map<string, Promise<void>>();
  private readonly conversationThreads = new Map<string, string>();
  private readonly stopController = new AbortController();
  private accepting = true;

  constructor(
    private readonly apiUrl: string,
    private readonly sharedSecret: string,
    private readonly workspaceManager: WorkspaceManager,
    private readonly options: HttpRunnerEventSinkOptions = {},
  ) {
    this.outbox = new RunnerEventOutboxStore(workspaceManager);
    this.memoryUsageOutbox = new MemoryUsageOutboxStore(workspaceManager);
  }

  async publish(
    conversationId: string,
    event: LinkSensePublishedEvent,
  ): Promise<void> {
    await this.publishBatch(conversationId, [event]);
  }

  async publishBatch(
    conversationId: string,
    events: readonly LinkSensePublishedEvent[],
  ): Promise<void> {
    if (!this.accepting) {
      throw new Error("runner event sink is closing");
    }
    const activeThreadId = this.conversationThreads.get(conversationId);
    const currentEvents = events.filter(event => {
      const eventThreadId = runnerEventThreadId(event);
      return !activeThreadId || !eventThreadId || eventThreadId === activeThreadId;
    });
    if (currentEvents.length === 0) return;
    await this.outbox.appendBatch(conversationId, currentEvents);
    this.startWorker(conversationId);
  }

  async alignConversationThread(
    conversationId: string,
    codexThreadId: string,
  ): Promise<void> {
    this.conversationThreads.set(conversationId, codexThreadId);
    const removed = await this.outbox.removeForeignThreadEntries(
      conversationId,
      codexThreadId,
    );
    if (removed > 0) {
      this.options.logger?.warn(
        { conversationId, removedEventCount: removed },
        "discarded runner events from non-conversation Codex threads",
      );
    }
    this.startWorker(conversationId);
  }

  async restore(): Promise<void> {
    const [conversationIds, ownerIds] = await Promise.all([
      this.workspaceManager.listConversationIds(),
      this.workspaceManager.listOwnerIds(),
    ]);
    await Promise.all([
      ...conversationIds.map((conversationId) =>
        this.resumeConversation(conversationId),
      ),
      ...ownerIds.map(async (ownerId) => {
        const entry = await this.memoryUsageOutbox.peek(ownerId);
        if (entry) this.startMemoryUsageWorker(ownerId);
      }),
    ]);
  }

  async recordMemoryUsage(
    capture: RunnerMemoryUsageCapture,
  ): Promise<void> {
    if (!this.accepting) {
      throw new Error("runner event sink is closing");
    }
    const entry = await this.memoryUsageOutbox.append(capture);
    this.startMemoryUsageWorker(entry.ownerId);
  }

  async resumeConversation(conversationId: string): Promise<void> {
    const entry = await this.outbox.peek(conversationId);
    if (entry) this.startWorker(conversationId);
  }

  async reportStartSettled(input: RunnerStartSettled): Promise<void> {
    const body = runnerStartSettledSchema.parse(input);
    // This control request must bypass events waiting for that very projection.
    const response = await this.post("/internal/runner/start-settled", body,
      this.workspaceManager.ownerFor(body.conversationId));
    const receipt = runnerStartSettledReceiptSchema.parse(asRecord(response).data);
    if (!receipt.settled) throw new Error("start operation projection is pending");
    if (this.workers.has(body.conversationId)) {
      this.deliveryWakeVersions.set(body.conversationId,
        (this.deliveryWakeVersions.get(body.conversationId) ?? 0) + 1);
      this.deliveryWaiters.get(body.conversationId)?.abort();
    }
    await this.resumeConversation(body.conversationId);
  }

  async flushConversation(
    conversationId: string,
    timeoutMs = 250,
  ): Promise<void> {
    await this.resumeConversation(conversationId);
    const worker = this.workers.get(conversationId);
    if (!worker) return;
    await Promise.race([worker, delay(timeoutMs)]);
  }

  async close(graceMs = this.options.shutdownGraceMs ?? 500): Promise<void> {
    this.accepting = false;
    await Promise.race([
      Promise.allSettled([
        ...this.workers.values(),
        ...this.memoryUsageWorkers.values(),
      ]).then(() => undefined),
      delay(graceMs),
    ]);
    this.stopController.abort();
    await Promise.allSettled([
      ...this.workers.values(),
      ...this.memoryUsageWorkers.values(),
    ]);
  }

  async reportHeartbeat(ownerId: string, input: RunnerHeartbeat): Promise<void> {
    const response = await this.post("/internal/runner/heartbeat", input, ownerId);
    if (asRecord(asRecord(response).data).confirmed !== true) {
      throw new Error("LinkSense worker heartbeat was not confirmed");
    }
  }

  async reportProcessExit(input: ProcessExitReport): Promise<void> {
    await this.drainConversationOutbox(
      input.conversationId,
      this.options.processExitTimeoutMs ?? 150_000,
    );
    const response = await this.post(
      "/internal/runner/process-exit",
      input,
      this.workspaceManager.ownerFor(input.conversationId),
    );
    const data = asRecord(asRecord(response).data);
    if (
      data.confirmed !== true ||
      (data.outcome !== "succeeded" && data.outcome !== "not_applicable")
    ) {
      throw new Error("LinkSense process-exit recovery was not confirmed");
    }
  }

  private async drainConversationOutbox(
    conversationId: string,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    await this.resumeConversation(conversationId);
    while (await this.outbox.peek(conversationId)) {
      if (this.stopController.signal.aborted) {
        throw new Error("runner event sink is closing");
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "runner event outbox was not drained before process-exit recovery",
        );
      }
      const worker = this.workers.get(conversationId);
      if (!worker) {
        this.startWorker(conversationId);
        continue;
      }
      await Promise.race([
        worker,
        abortableDelay(
          Math.min(250, Math.max(1, deadline - Date.now())),
          this.stopController.signal,
        ),
      ]);
    }
  }

  registerArtifact(input: {
    conversationId: string;
    turnId: string;
    workspaceRelativePath: string;
    displayName: string;
    mimeType?: string;
    artifactKind?: string;
    webRootRelativePath?: string;
  }): Promise<unknown> {
    return this.postArtifact(
      input,
      this.workspaceManager.ownerFor(input.conversationId),
    );
  }

  generateImage(input: {
    conversationId: string;
    turnId: string;
    request: ImageGenerationRequest;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const { signal, ...body } = input;
    return this.postImageGeneration(
      body,
      this.workspaceManager.ownerFor(input.conversationId),
      signal,
    );
  }

  previewSkillZip(input: {
    conversationId: string;
    turnId: string;
    workspaceRelativePath: string;
  }): Promise<unknown> {
    return this.postSkillCreator(
      "/internal/skill-creator/preview",
      input,
      this.workspaceManager.ownerFor(input.conversationId),
    );
  }

  async applicationBuilder(input: { conversationId: string; turnId: string; request: import("@linksense/shared").ApplicationBuilderRequest }): Promise<unknown> {
    const paths = this.workspaceManager.pathsFor(input.conversationId);
    const workspacePath = userWorkspacePathSchema.parse(relative(paths.home, paths.workspace));
    const response = await this.request("/internal/application-builder", { ...input, workspacePath }, this.workspaceManager.ownerFor(input.conversationId));
    const body = await parseResponseBody(response);
    if (!response.ok) throw applicationBuilderErrorFromApi(response.status, body);
    return body;
  }

  confirmSkillInstall(input: {
    conversationId: string;
    turnId: string;
    installToken: string;
  }): Promise<unknown> {
    return this.postSkillCreator(
      "/internal/skill-creator/confirm",
      input,
      this.workspaceManager.ownerFor(input.conversationId),
    );
  }

  searchKnowledge(input: {
    conversationId: string;
    turnId: string;
    query: string;
    finalTopK: number;
    candidateMultiplier: number;
    numCandidates?: number;
    minScore: number;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const { signal, ...body } = input;
    return this.postKnowledgeSearch(
      body,
      this.workspaceManager.ownerFor(input.conversationId),
      signal,
    );
  }

  listKnowledgeDocuments(input: {
    conversationId: string;
    turnId: string;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const { signal, ...body } = input;
    return this.postKnowledgeService(
      "/internal/knowledge/documents",
      "list",
      body,
      this.workspaceManager.ownerFor(input.conversationId),
      signal,
    );
  }

  getKnowledgeDocumentMarkdown(input: {
    conversationId: string;
    turnId: string;
    documentRef: string;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    const { signal, ...body } = input;
    return this.postKnowledgeService(
      "/internal/knowledge/document-markdown",
      "markdown",
      body,
      this.workspaceManager.ownerFor(input.conversationId),
      signal,
    );
  }

  getCurrentUserInfo(input: {
    conversationId: string;
    turnId: string;
  }): Promise<unknown> {
    return this.postCurrentUserInfo(
      input,
      this.workspaceManager.ownerFor(input.conversationId),
    );
  }

  async emitInteractiveApplicationEvent(input: {
    conversationId: string;
    codexTurnId: string;
    name: string;
    payload: unknown;
  }): Promise<unknown> {
    const response = await this.request(
      "/internal/application-events/emit",
      input,
      this.workspaceManager.ownerFor(input.conversationId),
    );
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error("interactive application event rejected");
    }
    return responseBody;
  }

  private async postArtifact(body: unknown, ownerId: string): Promise<unknown> {
    const response = await this.request(
      "/internal/file-service/register-artifact",
      body,
      ownerId,
    );
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw fileServiceErrorFromApi(response.status, responseBody);
    }
    return responseBody;
  }

  private async postImageGeneration(
    body: unknown,
    ownerId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.request(
      "/internal/image-generation/generate",
      body,
      ownerId,
      signal,
    );
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw imageGenerationErrorFromApi(response.status, responseBody);
    }
    return responseBody;
  }

  private async postSkillCreator(
    pathname:
      "/internal/skill-creator/preview" | "/internal/skill-creator/confirm",
    body: unknown,
    ownerId: string,
  ): Promise<unknown> {
    const response = await this.request(pathname, body, ownerId);
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw skillCreatorErrorFromApi(response.status, responseBody);
    }
    return responseBody;
  }

  private async postKnowledgeSearch(
    body: unknown,
    ownerId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.request(
      "/internal/knowledge/search",
      body,
      ownerId,
      signal,
    );
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw knowledgeSearchErrorFromApi(response.status, responseBody);
    }
    return responseBody;
  }

  private async postKnowledgeService(
    pathname:
      "/internal/knowledge/documents" | "/internal/knowledge/document-markdown",
    operation: "list" | "markdown",
    body: unknown,
    ownerId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await this.request(pathname, body, ownerId, signal);
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw knowledgeServiceErrorFromApi(
        operation,
        response.status,
        responseBody,
      );
    }
    return responseBody;
  }

  private async postCurrentUserInfo(
    body: unknown,
    ownerId: string,
  ): Promise<unknown> {
    const response = await this.request("/internal/current-user/info", body, ownerId);
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw currentUserInfoErrorFromApi(response.status, responseBody);
    }
    return responseBody;
  }

  private startWorker(conversationId: string): void {
    if (
      this.stopController.signal.aborted ||
      this.workers.has(conversationId)
    ) {
      return;
    }
    const worker = this.runWorker(conversationId).finally(() => {
      if (this.workers.get(conversationId) === worker) {
        this.workers.delete(conversationId);
        this.deliveryWakeVersions.delete(conversationId);
        this.deliveryWaiters.delete(conversationId);
      }
      if (!this.stopController.signal.aborted) {
        void this.resumeConversation(conversationId).catch(() =>
          this.options.logger?.error(
            { conversationId },
            "failed to resume runner event outbox",
          ),
        );
      }
    });
    this.workers.set(conversationId, worker);
  }

  private async runWorker(conversationId: string): Promise<void> {
    let attempt = 0;
    while (!this.stopController.signal.aborted) {
      const wakeVersion = this.deliveryWakeVersions.get(conversationId) ?? 0;
      try {
        const entries = await this.outbox.peekBatch(
          conversationId,
          RUNNER_EVENT_BATCH_MAX_COUNT,
          RUNNER_EVENT_BATCH_TARGET_BYTES,
        );
        if (entries.length === 0) return;
        const acceptedCount = await this.deliver(conversationId, entries);
        await this.outbox.removeBatch(entries.slice(0, acceptedCount));
        if (acceptedCount > 0) attempt = 0;
        if (acceptedCount === entries.length) continue;
      } catch {
        if (attempt === 0 || isPowerOfTwo(attempt + 1)) {
          this.options.logger?.warn(
            {
              conversationId,
              attempt: attempt + 1,
            },
            "sanitized runner event delivery deferred",
          );
        }
      }

      attempt += 1;
      const retryBaseMs = this.options.retryBaseMs ?? 100;
      const retryMaxMs = this.options.retryMaxMs ?? 5_000;
      const backoff = Math.min(
        retryMaxMs,
        retryBaseMs * 2 ** Math.min(attempt - 1, 16),
      );
      if (wakeVersion !== (this.deliveryWakeVersions.get(conversationId) ?? 0)) continue;
      const wake = new AbortController();
      this.deliveryWaiters.set(conversationId, wake);
      try {
        await abortableDelay(backoff, AbortSignal.any([this.stopController.signal, wake.signal]));
      } finally {
        if (this.deliveryWaiters.get(conversationId) === wake) this.deliveryWaiters.delete(conversationId);
      }
    }
  }

  private async deliver(
    conversationId: string,
    entries: readonly RunnerEventOutboxEntry[],
  ): Promise<number> {
    const response = await this.post(
      "/internal/runner/events",
      { conversationId, events: entries.map(({ deliveryId, event }) => ({ deliveryId, event })) },
      this.workspaceManager.ownerFor(conversationId),
    );
    const envelope = asRecord(response);
    const receipt = runnerEventBatchReceiptSchema.parse(envelope.data);
    // Only an exact prefix is removable. Reject gaps, reordered ids, unknown
    // ids and oversized receipts without deleting any durable entry.
    if (receipt.accepted_delivery_ids.some((id, index) => entries[index]?.deliveryId !== id)) {
      throw new Error("runner event batch acknowledgement is not an ordered prefix");
    }
    return receipt.accepted_delivery_ids.length;
  }

  private startMemoryUsageWorker(ownerId: string): void {
    if (
      this.stopController.signal.aborted ||
      this.memoryUsageWorkers.has(ownerId)
    ) {
      return;
    }
    const worker = this.runMemoryUsageWorker(ownerId).finally(() => {
      if (this.memoryUsageWorkers.get(ownerId) === worker) {
        this.memoryUsageWorkers.delete(ownerId);
      }
      if (!this.stopController.signal.aborted) {
        void this.memoryUsageOutbox
          .peek(ownerId)
          .then((entry) => {
            if (entry) this.startMemoryUsageWorker(ownerId);
          })
          .catch(() =>
            this.options.logger?.error(
              { ownerId },
              "failed to resume memory usage outbox",
            ),
          );
      }
    });
    this.memoryUsageWorkers.set(ownerId, worker);
  }

  private async runMemoryUsageWorker(ownerId: string): Promise<void> {
    let attempt = 0;
    while (!this.stopController.signal.aborted) {
      const entry = await this.memoryUsageOutbox.peek(ownerId);
      if (!entry) return;
      try {
        const response = asRecord(
          await this.post(
            "/internal/runner/memory-usage",
            entry.capture,
            ownerId,
          ),
        );
        const data = asRecord(response.data);
        if (typeof data.recorded !== "boolean") {
          throw new Error("memory usage acknowledgement is invalid");
        }
        await this.memoryUsageOutbox.remove(entry);
        attempt = 0;
        continue;
      } catch {
        attempt += 1;
        if (attempt === 1 || isPowerOfTwo(attempt)) {
          this.options.logger?.warn(
            {
              ownerId,
              operation: entry.capture.operation,
              attempt,
            },
            "memory usage delivery deferred",
          );
        }
      }
      const retryBaseMs = this.options.retryBaseMs ?? 100;
      const retryMaxMs = this.options.retryMaxMs ?? 5_000;
      await abortableDelay(
        Math.min(
          retryMaxMs,
          retryBaseMs * 2 ** Math.min(attempt - 1, 16),
        ),
        this.stopController.signal,
      );
    }
  }

  private async post(
    pathname: string,
    body: unknown,
    ownerId: string,
  ): Promise<unknown> {
    const response = await this.request(pathname, body, ownerId);
    const responseBody = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(
        `LinkSense internal API request failed (${response.status})`,
      );
    }
    return responseBody;
  }

  private request(
    pathname: string,
    body: unknown,
    ownerId: string,
    callerSignal?: AbortSignal,
  ): Promise<Response> {
    const timeoutMs = pathname === "/internal/runner/heartbeat" || pathname === "/internal/runner/start-settled"
      ? 5_000
      : pathname.startsWith("/internal/knowledge/")
      ? deriveKnowledgeSearchTimeouts(
          this.options.knowledgeSearchTimeoutMs ??
            DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
        ).workerRelayMs
      : pathname.startsWith("/internal/image-generation/")
        ? 180_000
      : pathname === "/internal/application-builder" ? 60_000
      : pathname === "/internal/runner/process-exit"
        ? (this.options.processExitTimeoutMs ?? 150_000)
        : (this.options.requestTimeoutMs ?? 15_000);
    const requestSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([
      requestSignal,
      this.stopController.signal,
      ...(callerSignal ? [callerSignal] : []),
    ]);
    return (this.options.fetch ?? globalThis.fetch)(
      new URL(pathname, this.apiUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.sharedSecret}`,
          "content-type": "application/json",
          "x-linksense-owner-id": ownerId,
          ...(this.options.serviceSessionId ? { "x-linksense-service-session": this.options.serviceSessionId } : {}),
        },
        body: JSON.stringify(body),
        signal,
      },
    );
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function runnerEventThreadId(event: LinkSenseRunnerEvent): string | null {
  // Preparation belongs to the local request and survives its native fork.
  if ("preparation" in event && event.preparation) return null;
  if ("method" in event) {
    const threadId = event.params.threadId;
    return typeof threadId === "string" && threadId.length > 0
      ? threadId
      : null;
  }
  return event.threadId;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}
