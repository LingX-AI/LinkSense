import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { parseRunnerConfig } from "../src/config.js";
import { ConversationOwnerRegistry } from "../src/owner-binding.js";
import {
  ConversationRuntimeActiveError,
  SubAgentDetailNotFoundError,
  UserInputRequestUnavailableError,
  type AppServerProcessPool,
} from "../src/process-pool.js";
import { buildRunnerServer } from "../src/server.js";
import { WorkspaceManager } from "../src/workspace/workspace-manager.js";

const roots: string[] = [];
const ownerId = "01900000-0000-7000-8000-000000000002";
const otherOwnerId = "01900000-0000-7000-8000-000000000003";
const workerSecret = "worker-555555555555555555555555555555";

function createWorkerConfig(root: string) {
  return parseRunnerConfig({
    LINKSENSE_RUNNER_MODE: "worker",
    LINKSENSE_WORKER_OWNER_ID: ownerId,
    LINKSENSE_USER_DATA_ROOT: path.join(root, "home"),
    LINKSENSE_RUNNER_SHARED_SECRET: workerSecret,
    LINKSENSE_API_INTERNAL_URL: "http://controller:4010",
  });
}

function createWorkspaceManager(
  config: ReturnType<typeof createWorkerConfig>,
  root: string,
) {
  return new WorkspaceManager(config.LINKSENSE_USER_DATA_ROOT, undefined, {
    fixedOwnerId: ownerId,
    fixedHomeRoot: config.LINKSENSE_USER_DATA_ROOT,
    fixedControlRoot: path.join(root, "control"),
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runtime cleanup isolation", () => {
  it("protects an active target task without touching its workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-active-cleanup-"));
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const conversationId = "01900000-0000-7000-8000-000000000001";
    workspaceManager.bindOwner(conversationId, ownerId);
    const runtime = await workspaceManager.ensureConversation(
      conversationId,
    );
    const pool = {
      closeConversation: vi.fn(async () => {
        throw new ConversationRuntimeActiveError();
      }),
    } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);

    const response = await server.inject({
      method: "DELETE",
      url: `/conversations/${conversationId}/runtime`,
      headers: {
        authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
        "x-linksense-owner-id": ownerId,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error_code: "CLEANUP_RUNTIME_ACTIVE",
      cleanup_stage: "stop_runtime",
    });
    expect((await lstat(runtime.workspace)).isDirectory()).toBe(true);
    expect((await lstat(runtime.taskControl)).isDirectory()).toBe(true);
    await server.close();
  });
});

describe("worker owner isolation", () => {
  it("persists personalization and delegates memory state changes to the native process pool", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-personalization-route-"),
    );
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const refreshOwnerPersonalization = vi.fn(async () => undefined);
    const resetOwnerMemories = vi.fn(async () => undefined);
    const pool = {
      refreshOwnerPersonalization,
      resetOwnerMemories,
    } as unknown as AppServerProcessPool;
    const ensureUserRuntime = vi.fn(async () => undefined);
    const server = buildRunnerServer(
      config,
      pool,
      workspaceManager,
      undefined,
      ensureUserRuntime,
    );
    const headers = {
      authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
      "x-linksense-owner-id": ownerId,
    };

    const defaults = await server.inject({
      method: "GET",
      url: "/personalization",
      headers,
    });
    const updated = await server.inject({
      method: "PATCH",
      url: "/personalization",
      headers,
      payload: {
        custom_instructions: "请优先运行相关单元测试。",
        memories_enabled: false,
        task_auto_naming: "every_message",
      },
    });
    const reset = await server.inject({
      method: "POST",
      url: "/personalization/memories/reset",
      headers,
      payload: {},
    });

    expect(defaults.statusCode).toBe(200);
    expect(defaults.json()).toEqual({
      custom_instructions: "",
      memories_enabled: true,
      task_auto_naming: "first_message",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({
      custom_instructions: "请优先运行相关单元测试。",
      memories_enabled: false,
      task_auto_naming: "every_message",
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({ reset: true });
    expect(refreshOwnerPersonalization).toHaveBeenCalledWith(ownerId, false);
    expect(resetOwnerMemories).toHaveBeenCalledWith(ownerId);
    expect(ensureUserRuntime).toHaveBeenCalledTimes(3);
    refreshOwnerPersonalization.mockClear();
    const namingOnly = await server.inject({
      method: "PATCH",
      url: "/personalization",
      headers,
      payload: { task_auto_naming: "first_message" },
    });
    expect(namingOnly.statusCode).toBe(200);
    expect(namingOnly.json()).toEqual({
      custom_instructions: "请优先运行相关单元测试。",
      memories_enabled: false,
      task_auto_naming: "first_message",
    });
    expect(refreshOwnerPersonalization).not.toHaveBeenCalled();
    const invalid = await server.inject({
      method: "PATCH",
      url: "/personalization",
      headers,
      payload: { task_auto_naming: "invalid" },
    });
    expect(invalid.statusCode).toBe(400);
    await server.close();
  });

  it("maps active and already-terminal interrupt outcomes without treating the race as an error", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-interrupt-route-"),
    );
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const interrupt = vi
      .fn()
      .mockResolvedValueOnce("requested")
      .mockResolvedValueOnce("not_active")
      .mockResolvedValueOnce("requested")
      .mockRejectedValueOnce(new Error("native request failed"));
    const pool = { interrupt } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);
    const conversationId = "01900000-0000-7000-8000-000000000001";
    const request = {
      method: "POST" as const,
      url: `/conversations/${conversationId}/turns/interrupt`,
      headers: {
        authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: { turnId: "turn-native-1" },
    };

    const invalidGoal = await server.inject({
      ...request,
      payload: { ...request.payload, goalProjectionTurnId: "invalid" },
    });
    expect(invalidGoal.statusCode).toBe(400);
    expect(interrupt).not.toHaveBeenCalled();
    const active = await server.inject(request);
    expect(active.statusCode).toBe(200);
    expect(active.json()).toEqual({ code: "TURN_INTERRUPT_REQUESTED" });

    const terminal = await server.inject(request);
    expect(terminal.statusCode).toBe(200);
    expect(terminal.json()).toEqual({ code: "TURN_INTERRUPT_NOT_ACTIVE" });
    expect(interrupt).toHaveBeenNthCalledWith(
      1,
      conversationId,
      "turn-native-1",
    );
    expect(interrupt).toHaveBeenNthCalledWith(
      2,
      conversationId,
      "turn-native-1",
    );

    const goalProjectionTurnId = "01900000-0000-7000-8000-000000000010";
    const goal = await server.inject({ ...request, payload: { ...request.payload, goalProjectionTurnId } });
    expect(goal.json()).toEqual({ code: "TURN_INTERRUPT_REQUESTED" });
    expect(interrupt).toHaveBeenNthCalledWith(3, conversationId, "turn-native-1", goalProjectionTurnId);
    const failed = await server.inject(request);
    expect(failed.statusCode).toBe(409);
    expect(failed.json()).toEqual({
      error_code: "TURN_INTERRUPT_REQUEST_FAILED",
    });
    await server.close();
  });

  it("validates and owner-scopes startup interruption and redacts failures", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-start-interrupt-route-"));
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const interruptStartOperation = vi.fn()
      .mockResolvedValueOnce("requested")
      .mockResolvedValueOnce("not_active")
      .mockRejectedValueOnce(new Error("private native failure"));
    const pool = { interruptStartOperation } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);
    const conversationId = "01900000-0000-7000-8000-000000000001";
    const projectionTurnId = "01900000-0000-7000-8000-000000000010";
    const expectedRuntimeGeneration = "01900000-0000-7000-8000-000000000011";
    const request = {
      method: "POST" as const,
      url: `/conversations/${conversationId}/turns/start/${projectionTurnId}/interrupt`,
      headers: {
        authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: { ownerId, expectedRuntimeGeneration },
    };
    const unauthorized = await server.inject({ ...request, headers: {} });
    expect(unauthorized.statusCode).toBe(401);
    const forbidden = await server.inject({ ...request, payload: { ...request.payload, ownerId: otherOwnerId } });
    expect(forbidden.statusCode).toBe(403);
    const invalid = await server.inject({ ...request, payload: { ownerId, expectedRuntimeGeneration: "invalid" } });
    expect(invalid.statusCode).toBe(400);
    expect(interruptStartOperation).not.toHaveBeenCalled();
    const accepted = await server.inject(request);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ code: "TURN_INTERRUPT_REQUESTED" });
    expect(interruptStartOperation).toHaveBeenCalledWith({ conversationId, projectionTurnId, ownerId, expectedRuntimeGeneration });
    const inactive = await server.inject(request);
    expect(inactive.json()).toEqual({ code: "TURN_INTERRUPT_NOT_ACTIVE" });
    const failed = await server.inject(request);
    expect(failed.statusCode).toBe(409);
    expect(failed.json()).toEqual({ error_code: "TURN_INTERRUPT_REQUEST_FAILED" });
    expect(failed.body).not.toContain("private native failure");
    await server.close();
  });

  it("validates and owner-scopes native user input responses while preserving transient failures", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-user-input-route-"),
    );
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const respondUserInputRequest = vi
      .fn()
      .mockResolvedValueOnce({ accepted: true })
      .mockRejectedValueOnce(new UserInputRequestUnavailableError())
      .mockRejectedValueOnce(new Error("transient runner failure"));
    const pool = { respondUserInputRequest } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);
    const conversationId = "01900000-0000-7000-8000-000000000001";
    const request = {
      method: "POST" as const,
      url: `/conversations/${conversationId}/user-input/respond`,
      headers: {
        authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
        "x-linksense-owner-id": ownerId,
      },
      payload: {
        ownerId,
        requestId: 17,
        codexThreadId: "thread-native-1",
        codexTurnId: "turn-native-1",
        itemId: "request-user-input-1",
        response: {
          action: "accept",
          content: { scope: "完整实现（推荐）" },
        },
      },
    };

    const accepted = await server.inject(request);
    const stale = await server.inject(request);
    const unavailable = await server.inject(request);

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ accepted: true });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      error_code: "RUNNER_USER_INPUT_REQUEST_UNAVAILABLE",
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({
      error_code: "RUNNER_USER_INPUT_RESPONSE_UNAVAILABLE",
    });
    expect(respondUserInputRequest).toHaveBeenNthCalledWith(1, {
      conversationId,
      ...request.payload,
    });
    await server.close();
  });

  it("rejects missing and cross-owner headers before touching a fixed-owner runtime", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-owner-worker-"));
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const closeConversation = vi.fn(async () => undefined);
    const pool = {
      closeConversation,
    } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);
    const url = "/conversations/01900000-0000-7000-8000-000000000001/runtime";
    const authorization = `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`;

    for (const method of ["GET", "PUT", "DELETE"] as const) {
      expect(
        (await server.inject({ method, url, headers: { authorization } }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await server.inject({
            method,
            url,
            headers: {
              authorization,
              "x-linksense-owner-id": otherOwnerId,
            },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(closeConversation).not.toHaveBeenCalled();
    await expect(
      lstat(
        path.join(
          config.LINKSENSE_USER_DATA_ROOT,
          "workspaces",
          "01900000-0000-7000-8000-000000000001",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await server.close();
  });

  it("initializes the user runtime only for explicit runtime preparation", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-runtime-prepare-"),
    );
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const ensureUserRuntime = vi.fn(async () => undefined);
    const closeConversation = vi.fn(async () => undefined);
    const pool = {
      getStartOperation: vi.fn(async () => null),
      closeConversation,
      prepareRuntime: vi.fn((conversationId: string) =>
        workspaceManager.ensureConversation(
          conversationId,
        ),
      ),
    } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(
      config,
      pool,
      workspaceManager,
      new ConversationOwnerRegistry(ownerId),
      ensureUserRuntime,
    );
    const conversationId = "01900000-0000-7000-8000-000000000001";
    const headers = {
      authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
      "x-linksense-owner-id": ownerId,
    };

    const inspectMissing = await server.inject({
      method: "GET",
      url: `/conversations/${conversationId}/runtime`,
      headers,
    });
    expect(inspectMissing.statusCode).toBe(404);
    expect(inspectMissing.json()).toEqual({
      error_code: "RUNNER_RUNTIME_NOT_FOUND",
    });
    await expect(
      lstat(path.join(config.LINKSENSE_USER_DATA_ROOT, ".codex")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(ensureUserRuntime).not.toHaveBeenCalled();

    const get = await server.inject({
      method: "GET",
      url: `/conversations/${conversationId}/turns/start/01900000-0000-7000-8000-000000000004`,
      headers,
    });
    expect(get.statusCode).toBe(404);
    expect(ensureUserRuntime).not.toHaveBeenCalled();

    const prepare = await server.inject({
      method: "PUT",
      url: `/conversations/${conversationId}/runtime`,
      headers,
    });
    expect(prepare.statusCode).toBe(200);
    expect(prepare.json()).toEqual({
      agentsTemplateVersion: config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
      runtimeGeneration: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
    });
    expect(ensureUserRuntime).toHaveBeenCalledOnce();

    const inspect = await server.inject({
      method: "GET",
      url: `/conversations/${conversationId}/runtime`,
      headers,
    });
    expect(inspect.statusCode).toBe(200);
    expect(inspect.json()).toEqual(prepare.json());
    expect(ensureUserRuntime).toHaveBeenCalledOnce();
    const closeProcess = await server.inject({
      method: "POST",
      url: `/conversations/${conversationId}/runtime/close`,
      headers,
      payload: {},
    });
    expect(closeProcess.statusCode).toBe(200);
    expect(closeProcess.json()).toEqual({ success: true });
    expect(closeConversation).toHaveBeenCalledWith(conversationId);
    const inspectAfterClose = await server.inject({
      method: "GET",
      url: `/conversations/${conversationId}/runtime`,
      headers,
    });
    expect(inspectAfterClose.statusCode).toBe(200);
    expect(inspectAfterClose.json()).toEqual(prepare.json());
    const crossOwnerInspect = await server.inject({
      method: "GET",
      url: `/conversations/${conversationId}/runtime`,
      headers: {
        authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
        "x-linksense-owner-id": otherOwnerId,
      },
    });
    expect(crossOwnerInspect.statusCode).toBe(403);

    await server.close();
    const restartedWorkspaceManager = createWorkspaceManager(config, root);
    const restartedServer = buildRunnerServer(
      config,
      pool,
      restartedWorkspaceManager,
      new ConversationOwnerRegistry(ownerId),
      ensureUserRuntime,
    );
    const inspectAfterRestart = await restartedServer.inject({
      method: "GET",
      url: `/conversations/${conversationId}/runtime`,
      headers,
    });
    expect(inspectAfterRestart.statusCode).toBe(200);
    expect(inspectAfterRestart.json()).toEqual(prepare.json());
    expect(ensureUserRuntime).toHaveBeenCalledOnce();

    const remove = await restartedServer.inject({
      method: "DELETE",
      url: `/conversations/${conversationId}/runtime`,
      headers,
    });
    expect(remove.statusCode).toBe(200);
    expect(ensureUserRuntime).toHaveBeenCalledOnce();
    const inspectRemoved = await restartedServer.inject({
      method: "GET",
      url: `/conversations/${conversationId}/runtime`,
      headers,
    });
    expect(inspectRemoved.statusCode).toBe(404);
    expect(inspectRemoved.json()).toEqual({
      error_code: "RUNNER_RUNTIME_NOT_FOUND",
    });
    await restartedServer.close();
  });

  it("returns the stable not-found contract for an invalid protected generation", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-runtime-invalid-"),
    );
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const pool = {
      closeConversation: vi.fn(async () => undefined),
      prepareRuntime: vi.fn((conversationId: string) =>
        workspaceManager.ensureConversation(
          conversationId,
        ),
      ),
    } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);
    const conversationId = "01900000-0000-7000-8000-000000000001";
    const url = `/conversations/${conversationId}/runtime`;
    const headers = {
      authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
      "x-linksense-owner-id": ownerId,
    };

    expect(
      (await server.inject({ method: "PUT", url, headers })).statusCode,
    ).toBe(200);
    await writeFile(
      path.join(
        workspaceManager.pathsFor(conversationId).taskControl,
        "runtime-generation",
      ),
      "invalid\n",
    );
    const inspect = await server.inject({ method: "GET", url, headers });
    expect(inspect.statusCode).toBe(404);
    expect(inspect.json()).toEqual({
      error_code: "RUNNER_RUNTIME_NOT_FOUND",
    });
    await server.close();
  });

  it("keeps subagent detail reads owner-bound and maps the internal contract", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "linksense-subagent-read-"));
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const agentKey = `agent_${"a".repeat(24)}`;
    const readSubAgentDetail = vi
      .fn()
      .mockResolvedValueOnce({
        agentKey,
        status: "completed",
        turns: [],
      })
      .mockRejectedValueOnce(new SubAgentDetailNotFoundError());
    const pool = { readSubAgentDetail } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);
    const conversationId = "01900000-0000-7000-8000-000000000001";
    const url = `/conversations/${conversationId}/subagents/read`;
    const headers = {
      authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
      "x-linksense-owner-id": ownerId,
    };
    const body = {
      ownerId,
      codexThreadId: "thread-parent",
      codexTurnId: "turn-parent",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      model: "test-model",
      reasoningEffort: "medium",
      modelProvider: {
        revision: 1,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses",
        apiKey: "test-provider-key",
      },
      authorizedAgentKeys: [agentKey],
      agentKey,
    };

    const success = await server.inject({
      method: "POST",
      url,
      headers,
      payload: body,
    });
    expect(success.statusCode).toBe(200);
    expect(success.json()).toEqual({
      agentKey,
      status: "completed",
      turns: [],
    });
    expect(readSubAgentDetail).toHaveBeenCalledWith({
      conversationId,
      ...body,
    });

    const crossOwner = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { ...body, ownerId: otherOwnerId },
    });
    expect(crossOwner.statusCode).toBe(403);
    expect(readSubAgentDetail).toHaveBeenCalledOnce();

    const notFound = await server.inject({
      method: "POST",
      url,
      headers,
      payload: body,
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({
      error_code: "RUNNER_SUBAGENT_DETAIL_NOT_FOUND",
    });

    await server.close();
  });

  it("keeps subagent summary reads owner-bound and maps the internal contract", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "linksense-subagent-summaries-"),
    );
    roots.push(root);
    const config = createWorkerConfig(root);
    const workspaceManager = createWorkspaceManager(config, root);
    const agentKey = `agent_${"b".repeat(24)}`;
    const readSubAgentSummaries = vi.fn(async () => ({
      agents: [
        {
          agentKey,
          agentLabel: "New york overview",
          status: "completed" as const,
        },
      ],
    }));
    const pool = { readSubAgentSummaries } as unknown as AppServerProcessPool;
    const server = buildRunnerServer(config, pool, workspaceManager);
    const conversationId = "01900000-0000-7000-8000-000000000001";
    const url = `/conversations/${conversationId}/subagents/summaries`;
    const headers = {
      authorization: `Bearer ${config.LINKSENSE_RUNNER_SHARED_SECRET}`,
      "x-linksense-owner-id": ownerId,
    };
    const body = {
      ownerId,
      codexThreadId: "thread-parent",
      codexTurnId: "turn-parent",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      model: "test-model",
      reasoningEffort: "medium",
      modelProvider: {
        revision: 1,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses",
        apiKey: "test-provider-key",
      },
      authorizedAgentKeys: [agentKey],
    };

    const success = await server.inject({
      method: "POST",
      url,
      headers,
      payload: body,
    });
    expect(success.statusCode).toBe(200);
    expect(success.json()).toEqual({
      agents: [
        {
          agentKey,
          agentLabel: "New york overview",
          status: "completed",
        },
      ],
    });
    expect(readSubAgentSummaries).toHaveBeenCalledWith({
      conversationId,
      ...body,
    });

    const crossOwner = await server.inject({
      method: "POST",
      url,
      headers,
      payload: { ...body, ownerId: otherOwnerId },
    });
    expect(crossOwner.statusCode).toBe(403);
    expect(readSubAgentSummaries).toHaveBeenCalledOnce();

    await server.close();
  });
});
