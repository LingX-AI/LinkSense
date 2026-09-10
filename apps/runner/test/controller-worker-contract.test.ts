import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRunnerConfig } from "../src/config.js";
import { buildControllerServer } from "../src/controller/server.js";
import { ownerWorkerSecret } from "../src/controller/storage-key.js";
import { FetchWorkerTransport } from "../src/controller/worker-http-client.js";
import type { WorkerManager } from "../src/controller/worker-manager.js";
import type {
  AppServerProcessPool,
  StartTurnInput,
} from "../src/process-pool.js";
import { buildRunnerServer } from "../src/server.js";
import type { WorkspaceManager } from "../src/workspace/workspace-manager.js";

const ownerId = "01900000-0000-7000-8000-000000000002";
const conversationId = "01900000-0000-7000-8000-000000000003";
const projectionTurnId = "01900000-0000-7000-8000-000000000004";
const capabilityId = "01900000-0000-7000-8000-000000000005";
const globalSecret = "runner-contract-probe-secret-000000000000";

describe("controller to dynamic worker turn-start contract", () => {
  let root: string;

  beforeEach(async () => {
    vi.stubEnv("LOG_LEVEL", "silent");
    root = await mkdtemp(
      path.join(tmpdir(), "linksense-controller-worker-contract-"),
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  });

  it("uses a request-specific worker transport timeout when provided", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const transport = new FetchWorkerTransport(60_000);

    await transport.request(
      "http://127.0.0.1:4000",
      "/conversations/test/reconcile",
      "POST",
      { "content-type": "application/json" },
      Buffer.from("{}"),
      110_000,
    );

    expect(timeoutSpy).toHaveBeenCalledWith(110_000);
  });

  it("preserves the metadata-only capability contract over Fetch", async () => {
    const controllerConfig = parseRunnerConfig({
      LINKSENSE_RUNNER_MODE: "controller",
      LINKSENSE_USER_DATA_ROOT: path.join(root, "users"),
      LINKSENSE_RUNNER_SHARED_SECRET: globalSecret,
      LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:1",
    });
    const scopedSecret = ownerWorkerSecret(ownerId, globalSecret);
    const workerConfig = parseRunnerConfig({
      LINKSENSE_RUNNER_MODE: "worker",
      LINKSENSE_WORKER_OWNER_ID: ownerId,
      LINKSENSE_USER_DATA_ROOT: "/home/linksense",
      LINKSENSE_RUNNER_SHARED_SECRET: scopedSecret,
      LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:1",
    });

    let workerInput: StartTurnInput | undefined;
    let workerHeaders:
      | {
          authorization: string | undefined;
          ownerId: string | string[] | undefined;
          contentType: string | undefined;
        }
      | undefined;
    const pool = {
      runningCount: 0,
      size: 0,
      beginStartOperation: vi.fn(async (input: StartTurnInput) => {
        workerInput = input;
        const now = new Date().toISOString();
        return {
          conversationId: input.conversationId,
          projectionTurnId: input.projectionTurnId,
          ownerId: input.ownerId,
          status: "starting" as const,
          createdAt: now,
          updatedAt: now,
        };
      }),
    } as unknown as AppServerProcessPool;
    const workspaceManager = {
      bindOwner: vi.fn(),
    } as unknown as WorkspaceManager;
    const workerServer = buildRunnerServer(
      workerConfig,
      pool,
      workspaceManager,
    );
    workerServer.addHook("onRequest", async (request) => {
      if (!request.url.endsWith("/turns/start")) return;
      workerHeaders = {
        authorization: request.headers.authorization,
        ownerId: request.headers["x-linksense-owner-id"],
        contentType: request.headers["content-type"],
      };
    });
    await workerServer.listen({ host: "127.0.0.1", port: 0 });

    try {
      const address = workerServer.server.address();
      if (!address || typeof address === "string") {
        throw new Error("temporary worker address unavailable");
      }
      const transport = new FetchWorkerTransport(10_000);
      let forwardedBody: Record<string, unknown> | undefined;
      const workers = {
        health: vi.fn(),
        stopAllWorkers: vi.fn(),
        request: vi.fn(
          async (
            forwardedOwnerId: string,
            requestPath: string,
            method: string,
            body?: Buffer,
          ) => {
            expect(forwardedOwnerId).toBe(ownerId);
            forwardedBody = body
              ? (JSON.parse(body.toString("utf8")) as Record<string, unknown>)
              : undefined;
            return transport.request(
              `http://127.0.0.1:${address.port}`,
              requestPath,
              method,
              {
                authorization: `Bearer ${scopedSecret}`,
                "x-linksense-owner-id": ownerId,
                ...(body ? { "content-type": "application/json" } : {}),
              },
              body,
            );
          },
        ),
      } as unknown as WorkerManager;
      const controllerServer = buildControllerServer(controllerConfig, workers);
      try {
        const response = await controllerServer.inject({
          method: "POST",
          url: `/conversations/${conversationId}/turns/start`,
          headers: {
            authorization: `Bearer ${globalSecret}`,
            "x-linksense-owner-id": ownerId,
          },
          payload: {
            ownerId,
            projectionTurnId,
            appServerProcessLimit: 20,
            model: "test-model",
            reasoningEffort: "medium",
            modelProvider: {
              revision: 1,
              baseUrl: "https://models.example.test/v1",
              protocolMode: "native_responses",
              apiKey: "test-provider-key",
            },
            expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
            capabilityGeneration: "a".repeat(64),
            codexThreadId: null,
            context: {
              userInput: "Use the selected PDF plugin.",
              requireFinalResponse: true,
              selectedKnowledgeBases: [{ id: "10000000-0000-4000-8000-000000000001", name: "Knowledge base" }],
              attachments: [],
              priorityPlugins: [
                {
                  id: capabilityId,
                  name: "pdf",
                  description: null,
                },
              ],
              prioritySkills: [],
            },
            capabilities: [
              {
                id: capabilityId,
                name: "pdf",
                type: "plugin",
                revision: "2026-07-19T00:00:00.000Z",
              },
            ],
          },
        });

        expect(response.statusCode).toBe(202);
        expect(workerHeaders).toEqual({
          authorization: `Bearer ${scopedSecret}`,
          ownerId,
          contentType: "application/json",
        });
        expect(forwardedBody?.environment).toEqual({});
        expect(forwardedBody?.context).toMatchObject({
          requireFinalResponse: true,
          selectedKnowledgeBases: [{ id: "10000000-0000-4000-8000-000000000001", name: "Knowledge base" }],
        });
        expect(workerInput).toMatchObject({
          ownerId,
          conversationId,
          projectionTurnId,
          expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
          capabilityGeneration: "a".repeat(64),
          codexThreadId: null,
          environment: {},
          context: {
            requireFinalResponse: true,
            selectedKnowledgeBases: [{ id: "10000000-0000-4000-8000-000000000001", name: "Knowledge base" }],
            priorityPlugins: [
              {
                id: capabilityId,
                name: "pdf",
                description: null,
              },
            ],
          },
          capabilities: [
            {
              id: capabilityId,
              name: "pdf",
              type: "plugin",
              revision: "2026-07-19T00:00:00.000Z",
            },
          ],
        });
        expect(forwardedBody).not.toHaveProperty("capabilities.0.sourcePath");
      } finally {
        await controllerServer.close();
      }
    } finally {
      await workerServer.close();
    }
  });
});
