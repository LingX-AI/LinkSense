import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  desktopExecutionAckSchema,
  readConversationReferenceInputSchema,
  type DesktopNegotiatedOperation,
  type DesktopToolRequest,
  type ReadConversationReferenceResult,
} from "@linksense/shared";
import pino from "pino";
import { afterEach, expect, it, vi } from "vitest";

import { parseRunnerConfig } from "../src/config.js";
import { desktopWorkerSecret } from "../src/controller/desktop-worker-provider.js";
import type { WorkerOwnerPaths } from "../src/controller/worker-provider.js";
import { HttpRunnerEventSink } from "../src/event-sink.js";
import { AppServerProcessPool } from "../src/process-pool.js";
import { buildRunnerServer } from "../src/server.js";
import { DesktopLink } from "../src/desktop/link.js";
import { DesktopTurns, type DesktopRuntimeRun } from "../src/desktop/turns.js";
import { desktopWorkerCallbacks } from "../src/desktop/worker-callbacks.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

const logger = pino({ enabled: false });
const localSecret = "c".repeat(64);
const roots: string[] = [];

type ReadToolRequest = Extract<DesktopToolRequest, { operation: "conversation_reference.read" }>;

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function createProvider(root: string): ConstructorParameters<typeof DesktopTurns>[0] {
  return {
    pathsFor(ownerId: string, conversationId: string): WorkerOwnerPaths {
      const owner = path.join(root, ownerId, "services", conversationId);
      const home = path.join(owner, "home");
      const managed = path.join(owner, "managed");
      const managedAgents = path.join(managed, "agents");
      return {
        root, owner, home, homeAgentsMountpoint: path.join(home, ".agents"), managed, managedAgents,
        managedSkills: path.join(managedAgents, "skills"),
        managedPluginSources: path.join(managedAgents, "plugin-sources"),
        managedPlugins: path.join(managedAgents, "plugins"),
        control: path.join(owner, "control"),
        workspaces: path.join(home, "projects"),
      };
    },
    prepareOwnerFilesystem: async () => {},
    assertSessionOrigin: async () => {},
    isMaintenanceActive: () => false,
    acquire: async () => { throw new Error("conversation-reference fixture must not acquire a worker") },
    inspect: async () => "running" as const,
    request: async () => { throw new Error("conversation-reference fixture must not reach a worker") },
    release: async () => {},
    stopWorkers: async () => {},
  };
}

function result(): ReadConversationReferenceResult {
  return {
    conversation_id: "10000000-0000-4000-8000-000000000020",
    title: "Fixture source",
    messages: [{ id: "10000000-0000-4000-8000-000000000021", role: "assistant", text: "Fixture answer" }],
    next_cursor: null,
    next_offset: 0,
  };
}

async function fixture(
  operations: readonly DesktopNegotiatedOperation[] = ["conversation_reference.read"],
  respond: (frame: ReadToolRequest) => ReadConversationReferenceResult | undefined = () => result(),
) {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-desktop-conversation-reference-"));
  roots.push(root);
  const provider = createProvider(root);
  const turns = new DesktopTurns(provider, root, "https://server.example.test", vi.fn(), logger, operations);
  const scope = {
    owner_id: randomUUID(), conversation_id: randomUUID(),
    runtime_generation: randomUUID(), turn_id: randomUUID(),
  };
  const timer = setTimeout(() => {}, 60_000);
  timer.unref();
  const run: DesktopRuntimeRun = {
    scope, token: `lsdr_${"a".repeat(43)}`, expiresAt: Date.now() + 60_000, timer,
  };
  vi.spyOn(turns, "scopedRun").mockReturnValue(run);
  const requests: ReadToolRequest[] = [];
  const cancels: unknown[] = [];
  const fail = vi.fn();
  const link: DesktopLink = new DesktopLink(
    randomUUID(), scope.owner_id, turns,
    async output => {
      const frame = output.frame;
      if (frame.type === "tool.cancel") {
        cancels.push(frame);
        return;
      }
      if (frame.type !== "tool.request" || frame.operation !== "conversation_reference.read") return;
      requests.push(frame);
      const data = respond(frame);
      if (data === undefined) return;
      link.receive(desktopExecutionAckSchema.parse({
        type: "tool.result", id: frame.id, operation: "conversation_reference.read", ok: true, data,
      }));
    },
    fail, operations,
  );
  const workspaceManager = new WorkspaceManager(root, undefined, { fixedOwnerId: scope.owner_id });
  const callbacks = desktopWorkerCallbacks(localSecret, () => ({ link, turns }), "https://server.example.test");
  const origin = new URL(await callbacks.listen({ host: "127.0.0.1", port: 0 })).origin;
  const authorization = `Bearer ${desktopWorkerSecret(scope.owner_id, localSecret, scope.conversation_id, {
    turnId: scope.turn_id, runtimeGeneration: scope.runtime_generation,
  })}`;
  const fetchCalls = vi.fn<typeof fetch>((input, init) => fetch(input, init));
  const sink = new HttpRunnerEventSink(origin, authorization.slice("Bearer ".length), workspaceManager, {
    serviceSessionId: scope.conversation_id,
    desktopOutboxScope: { turnId: scope.turn_id, generation: scope.runtime_generation },
    fetch: fetchCalls,
  });
  return {
    scope, run, link, requests, cancels, fail, origin, authorization, sink, fetchCalls, root,
    async post(body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
      return fetch(`${origin}/internal/conversation-references/read`, {
        method: "POST",
        headers: {
          authorization, "x-linksense-owner-id": scope.owner_id,
          "x-linksense-service-session": scope.conversation_id, "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    },
    close: async () => {
      clearTimeout(timer);
      await sink.close();
      await callbacks.close();
      await link.close();
    },
  };
}

it("relays the trusted read through the worker secret and the negotiated desktop operation once", async () => {
  const state = await fixture();
  try {
    const read = readConversationReferenceInputSchema.parse({ conversation_id: result().conversation_id });
    await expect(state.sink.readConversationReference({
      conversationId: state.scope.conversation_id,
      turnId: state.scope.turn_id,
      input: read,
    })).resolves.toEqual(result());
    expect(state.fetchCalls).toHaveBeenCalledOnce();
    expect(new URL(String(state.fetchCalls.mock.calls[0]?.[0])).pathname)
      .toBe("/internal/conversation-references/read");
    expect(JSON.parse(String(state.fetchCalls.mock.calls[0]?.[1]?.body))).toEqual({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input: read,
    });
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toMatchObject({
      type: "tool.request", operation: "conversation_reference.read",
      conversation_id: state.scope.conversation_id, turn_id: state.scope.turn_id,
      runtime_generation: state.scope.runtime_generation, body: read,
    });
    expect(state.requests[0]?.body).not.toHaveProperty("owner_id");
    expect(state.fail).not.toHaveBeenCalled();
  } finally {
    await state.close();
  }
});

it("does not dispatch when the operation was not negotiated", async () => {
  const state = await fixture([]);
  try {
    await expect(state.sink.readConversationReference({
      conversationId: state.scope.conversation_id,
      turnId: state.scope.turn_id,
      input: readConversationReferenceInputSchema.parse({ conversation_id: result().conversation_id }),
    })).rejects.toMatchObject({ statusCode: 503 });
    expect(state.requests).toHaveLength(0);
  } finally {
    await state.close();
  }
});

it("rejects model identity or path overrides at the worker callback boundary", async () => {
  const state = await fixture();
  try {
    for (const input of [
      { conversation_id: result().conversation_id, owner_id: state.scope.owner_id },
      { conversation_id: result().conversation_id, path: "/tmp/foreign-history" },
      { conversation_id: result().conversation_id, turn_id: state.scope.turn_id },
    ]) {
      const response = await state.post({
        conversationId: state.scope.conversation_id, turnId: state.scope.turn_id, input,
      });
      expect(response.status).toBe(400);
    }
    expect(state.requests).toHaveLength(0);
  } finally {
    await state.close();
  }
});

it("cancels the pending link request when the worker read is aborted and never retries it", async () => {
  const state = await fixture(["conversation_reference.read"], () => undefined);
  try {
    const controller = new AbortController();
    const pending = state.post({
      conversationId: state.scope.conversation_id, turnId: state.scope.turn_id,
      input: readConversationReferenceInputSchema.parse({ conversation_id: result().conversation_id }),
    }, {}, controller.signal);
    await vi.waitFor(() => expect(state.requests).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(state.cancels).toHaveLength(1));
    expect(state.cancels[0]).toMatchObject({ type: "tool.cancel", operation: "conversation_reference.read" });
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(state.requests).toHaveLength(1);
  } finally {
    await state.close();
  }
});

it("propagates an MCP client abort to the supervisor/API link in one tool.cancel and never replays", async () => {
  const state = await fixture(["conversation_reference.read"], () => undefined);
  const workspaceManager = new WorkspaceManager(state.root, undefined, { fixedOwnerId: state.scope.owner_id });
  const pool = {
    processes: new Map([[state.scope.conversation_id, {
      activeTurnId: state.scope.turn_id,
      activeProjectionTurnId: state.scope.turn_id,
      currentUserToken: state.authorization.slice("Bearer ".length),
    }]]),
    options: { eventSink: state.sink },
    readConversationReference: AppServerProcessPool.prototype.readConversationReference,
  } as unknown as AppServerProcessPool;
  const server = buildRunnerServer(parseRunnerConfig({
    NODE_ENV: "test",
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_USER_DATA_ROOT: state.root,
    LINKSENSE_RUNNER_SHARED_SECRET: `runner-test-${"x".repeat(32)}`,
    LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000",
  }), pool, workspaceManager);
  try {
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address();
    if (!address || typeof address === "string") throw new Error("runner fixture is not listening");
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${address.port}/mcp-current-user/${state.scope.conversation_id}/referenced-conversation`, {
      method: "POST",
      headers: { authorization: state.authorization, "content-type": "application/json" },
      body: JSON.stringify({ conversation_id: result().conversation_id }),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(state.requests).toHaveLength(1));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(state.cancels).toHaveLength(1));
    expect(state.cancels[0]).toMatchObject({
      type: "tool.cancel", id: state.requests[0]?.id, operation: "conversation_reference.read",
      conversation_id: state.scope.conversation_id, turn_id: state.scope.turn_id,
      runtime_generation: state.scope.runtime_generation,
    });
    // A late API result after the abort is ignored; there is no replay or
    // second delivery attempt.
    state.link.receive(desktopExecutionAckSchema.parse({
      type: "tool.result", id: state.requests[0]!.id, operation: "conversation_reference.read", ok: true, data: result(),
    }));
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(state.requests).toHaveLength(1);
    expect(state.cancels).toHaveLength(1);
  } finally {
    await server.close();
    await state.close();
  }
});

it("reports a dropped or deadline read as an unavailable read, never mutation uncertainty", async () => {
  const state = await fixture(["conversation_reference.read"], () => undefined);
  try {
    const read = readConversationReferenceInputSchema.parse({ conversation_id: result().conversation_id });
    const resultFrame = await state.link.requestTool(
      state.run, { operation: "conversation_reference.read", body: read }, AbortSignal.timeout(20),
    );
    expect(resultFrame).toMatchObject({
      ok: false, operation: "conversation_reference.read", error_code: "RUNNER_UNAVAILABLE",
    });
    expect(resultFrame.ok ? undefined : resultFrame.error_code).not.toBe("RUNNER_OPERATION_UNCERTAIN");
    expect(state.requests).toHaveLength(1);
    expect(state.cancels).toHaveLength(1);
  } finally {
    await state.close();
  }
});

it("keeps an unnegotiated read bounded without dispatch or cancel", async () => {
  const state = await fixture([]);
  try {
    const read = readConversationReferenceInputSchema.parse({ conversation_id: result().conversation_id });
    await expect(state.link.requestTool(
      state.run, { operation: "conversation_reference.read", body: read }, AbortSignal.timeout(20),
    )).resolves.toMatchObject({
      ok: false, operation: "conversation_reference.read", error_code: "RUNNER_UNAVAILABLE",
    });
    expect(state.requests).toHaveLength(0);
    expect(state.cancels).toHaveLength(0);
  } finally {
    await state.close();
  }
});
