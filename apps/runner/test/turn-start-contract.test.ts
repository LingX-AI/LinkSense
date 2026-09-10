import { describe, expect, it } from "vitest";

import {
  forkThreadBodySchema,
  goalSetBodySchema,
  reconcileBodySchema,
  startTurnBodySchema,
} from "../src/server.js";
import { sanitizeZodIssues } from "../src/turn-start-contract.js";

describe("turn-start contract diagnostics", () => {
  it("accepts only a complete thread-fork boundary", () => {
    const body = {
      ownerId: "01900000-0000-7000-8000-000000000002",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      sourceConversationId: "01900000-0000-7000-8000-000000000003",
      sourceCodexThreadId: "thread-source-1",
      throughCodexTurnId: "turn-native-2",
      model: "test-model",
      reasoningEffort: "medium" as const,
      modelProvider: {
        revision: 1,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses" as const,
        apiKey: "test-provider-key",
      },
    };

    expect(forkThreadBodySchema.safeParse(body).success).toBe(true);
    expect(forkThreadBodySchema.safeParse({ ...body, sourceConversationId: undefined }).success).toBe(false);
    expect(
      forkThreadBodySchema.safeParse({
        ...body,
        throughCodexTurnId: "",
      }).success,
    ).toBe(false);
    expect(
      forkThreadBodySchema.safeParse({ ...body, unknown: true }).success,
    ).toBe(false);
  });

  it("accepts only empty, existing-thread context compaction starts", () => {
    const body = {
      ownerId: "01900000-0000-7000-8000-000000000002",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      appServerProcessLimit: 20,
      operationKind: "compact" as const,
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      capabilityGeneration: "a".repeat(64),
      codexThreadId: "thread-native-1",
      context: {
        userInput: "",
        selectedKnowledgeBases: [],
        attachments: [],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: [],
      environment: {},
      model: "test-model",
      reasoningEffort: "medium" as const,
      modelProvider: {
        revision: 1,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses" as const,
        apiKey: "test-provider-key",
      },
    };

    expect(startTurnBodySchema.safeParse(body).success).toBe(true);
    for (const candidate of [
      { ...body, codexThreadId: undefined },
      { ...body, context: { ...body.context, userInput: "/压缩" } },
      { ...body, goal: { objective: "compact" } },
      { ...body, forkFromCodexTurnId: "turn-native-0" },
    ]) {
      expect(startTurnBodySchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("accepts the native active status at the Goal control boundary", () => {
    expect(
      goalSetBodySchema.safeParse({
        ownerId: "01900000-0000-7000-8000-000000000002",
        expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
        capabilityGeneration: "a".repeat(64),
        codexThreadId: "thread-native-1",
        projectionTurnId: "01900000-0000-7000-8000-000000000004",
        capabilities: [],
        environment: {},
        model: "test-model",
        reasoningEffort: "medium",
        modelProvider: {
          revision: 1,
          baseUrl: "https://models.example.test/v1",
          protocolMode: "native_responses",
          apiKey: "test-provider-key",
        },
        status: "active",
      }).success,
    ).toBe(true);
  });

  it.each(["max", "ultra"] as const)(
    "accepts the native %s reasoning effort at the controller-to-worker boundary",
    (reasoningEffort) => {
      expect(
        startTurnBodySchema.safeParse({
          ownerId: "01900000-0000-7000-8000-000000000002",
          projectionTurnId: "01900000-0000-7000-8000-000000000004",
          appServerProcessLimit: 20,
          eventProjectionTurnId: "01900000-0000-7000-8000-000000000005",
          expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
          capabilityGeneration: "a".repeat(64),
          context: {
            userInput: "identify the configured model",
            requireFinalResponse: true,
            attachments: [],
            priorityPlugins: [],
            prioritySkills: [],
          },
          capabilities: [],
          environment: {},
          model: "gpt-5.6-sol",
          reasoningEffort,
          modelProvider: {
            revision: 1,
            baseUrl: "https://models.example.test/v1",
            protocolMode: "native_responses",
            apiKey: "test-provider-key",
          },
        }).success,
      ).toBe(true);
    },
  );

  it("accepts a bounded model context window at the runner boundary", () => {
    const body = {
      ownerId: "01900000-0000-7000-8000-000000000002",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      appServerProcessLimit: 20,
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      capabilityGeneration: "a".repeat(64),
      context: {
        userInput: "continue",
        attachments: [],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: [],
      environment: {},
      model: "qwen3.8-27b",
      reasoningEffort: "medium" as const,
      modelProvider: {
        revision: 1,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses" as const,
        apiKey: "test-provider-key",
        modelContextWindow: 150_000,
        modelAutoCompactTokenLimit: 127_500,
      },
    };

    expect(startTurnBodySchema.safeParse(body).success).toBe(true);
    const invalid = startTurnBodySchema.safeParse({
      ...body,
      modelProvider: { ...body.modelProvider, modelContextWindow: 0 },
    });
    expect(invalid.success).toBe(false);
    if (invalid.success) return;
    expect(sanitizeZodIssues(invalid.error)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["modelProvider", "modelContextWindow"],
        }),
      ]),
    );

    const invalidAutoCompactLimit = startTurnBodySchema.safeParse({
      ...body,
      modelProvider: {
        ...body.modelProvider,
        modelAutoCompactTokenLimit: 0,
      },
    });
    expect(invalidAutoCompactLimit.success).toBe(false);
    if (invalidAutoCompactLimit.success) return;
    expect(sanitizeZodIssues(invalidAutoCompactLimit.error)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["modelProvider", "modelAutoCompactTokenLimit"],
        }),
      ]),
    );
  });

  it("accepts only an exact, distinct source runtime for model transition compaction", () => {
    const body = {
      ownerId: "01900000-0000-7000-8000-000000000002",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      appServerProcessLimit: 20,
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      capabilityGeneration: "a".repeat(64),
      context: {
        userInput: "continue after switching models",
        attachments: [],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: [],
      environment: {},
      model: "model-c",
      reasoningEffort: "medium" as const,
      modelProvider: {
        revision: 1,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses" as const,
        apiKey: "test-provider-key",
      },
    };

    const modelTransitionSource = {
      model: "model-a",
      provider: {
        revision: 2,
        baseUrl: "https://source-models.example.test/v1",
        protocolMode: "native_responses" as const,
        apiKey: "source-provider-key",
      },
    };

    expect(
      startTurnBodySchema.safeParse({ ...body, modelTransitionSource }).success,
    ).toBe(false);
    expect(
      startTurnBodySchema.safeParse({
        ...body,
        codexThreadId: "thread-native-1",
        modelTransitionSource,
      }).success,
    ).toBe(true);
    expect(
      startTurnBodySchema.safeParse({
        ...body,
        modelTransitionSource: { ...modelTransitionSource, model: "model-c" },
      }).success,
    ).toBe(false);
    expect(
      startTurnBodySchema.safeParse({
        ...body,
        modelTransitionSource: {
          ...modelTransitionSource,
          provider: { ...modelTransitionSource.provider, unknown: true },
        },
      }).success,
    ).toBe(false);
    expect(
      startTurnBodySchema.safeParse({
        ...body,
        operationKind: "compact",
        codexThreadId: "thread-native-1",
        context: { ...body.context, userInput: "" },
        modelTransitionSource,
      }).success,
    ).toBe(false);

    const reconcileBody = {
      ownerId: body.ownerId,
      projectionTurnId: body.projectionTurnId,
      expectedRuntimeGeneration: body.expectedRuntimeGeneration,
      capabilityGeneration: body.capabilityGeneration,
      codexThreadId: "thread-native-1",
      codexTurnId: "turn-native-1",
      taskKind: "turn" as const,
      collaborationMode: "default" as const,
      capabilities: body.capabilities,
      environment: body.environment,
      model: body.model,
      modelTransitionSource,
      reasoningEffort: body.reasoningEffort,
      modelProvider: body.modelProvider,
    };
    expect(reconcileBodySchema.safeParse(reconcileBody).success).toBe(true);
    expect(
      reconcileBodySchema.safeParse({
        ...reconcileBody,
        modelTransitionSource: {
          ...modelTransitionSource,
          model: reconcileBody.model,
        },
      }).success,
    ).toBe(false);
  });

  it("accepts the approved-plan marker only for the canonical Default execution handoff", () => {
    const body = {
      ownerId: "01900000-0000-7000-8000-000000000002",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      appServerProcessLimit: 20,
      expectedRuntimeGeneration: "01900000-0000-7000-8000-000000000010",
      capabilityGeneration: "a".repeat(64),
      codexThreadId: "thread-native-1",
      collaborationMode: "default" as const,
      context: {
        userInput: "Implement the plan.",
        approvedPlanImplementation: true as const,
        attachments: [],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: [],
      environment: {},
      model: "gpt-5.6-sol",
      reasoningEffort: "medium" as const,
      modelProvider: {
        revision: 1,
        baseUrl: "https://models.example.test/v1",
        protocolMode: "native_responses" as const,
        apiKey: "test-provider-key",
      },
    };
    const contractMessages = (candidate: unknown): string[] => {
      const parsed = startTurnBodySchema.safeParse(candidate);
      expect(parsed.success).toBe(false);
      return parsed.success
        ? []
        : sanitizeZodIssues(parsed.error).map((issue) => issue.message);
    };

    expect(startTurnBodySchema.safeParse(body).success).toBe(true);
    expect(
      contractMessages({
        ...body,
        collaborationMode: "plan",
      }),
    ).toContain("approved_plan_implementation_requires_default_mode");
    expect(
      contractMessages({
        ...body,
        context: { ...body.context, userInput: "Please continue." },
      }),
    ).toContain("approved_plan_implementation_requires_canonical_input");
    expect(
      contractMessages({ ...body, codexThreadId: undefined }),
    ).toContain("approved_plan_implementation_requires_codex_thread");
    expect(
      contractMessages({
        ...body,
        goal: { objective: "Execute the plan" },
      }),
    ).toContain("approved_plan_implementation_cannot_start_goal");
  });

  it("projects fixed schema paths while redacting payload data and dynamic keys", () => {
    const messageBody = "private-message-body";
    const filename = "private-filename.pdf";
    const credentialSource =
      "LINKSENSE_CREDENTIAL_0123456789ABCDEF0123456789ABCDEF";
    const unknownField = "private-unknown-field";
    const parsed = startTurnBodySchema.safeParse({
      ownerId: "01900000-0000-7000-8000-000000000002",
      projectionTurnId: "01900000-0000-7000-8000-000000000004",
      context: {
        userInput: messageBody,
        attachments: [
          {
            filename,
            relativePath: "",
          },
        ],
        priorityPlugins: [],
        prioritySkills: [],
      },
      capabilities: [],
      environment: {
        [credentialSource]: "x".repeat(64 * 1024 + 1),
      },
      [unknownField]: true,
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const issues = sanitizeZodIssues(parsed.error);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["context", "attachments", "[]", "relativePath"],
          code: "too_small",
        }),
        expect.objectContaining({
          path: ["environment", "<dynamic>"],
          code: "too_big",
        }),
      ]),
    );
    expect(
      issues.every((issue) =>
        Object.keys(issue).every((key) =>
          ["path", "code", "message"].includes(key),
        ),
      ),
    ).toBe(true);
    const serializedIssues = JSON.stringify(issues);
    expect(serializedIssues).not.toContain(messageBody);
    expect(serializedIssues).not.toContain(filename);
    expect(serializedIssues).not.toContain(credentialSource);
    expect(serializedIssues).not.toContain(unknownField);
    expect(serializedIssues).not.toContain("x".repeat(128));
  });
});
