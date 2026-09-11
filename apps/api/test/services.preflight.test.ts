import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRunningTurnCapabilityPublicationGuard,
  DatabaseConversationPreflight,
} from "../src/services.js";
import { encryptJson } from "../src/lib/crypto.js";
import {
  type CapabilityRuntimeVerification,
  type UserHomeCapabilityMaterializer,
  UserHomeCapabilityPublicationDeferredError,
} from "../src/modules/capabilities/user-home-materializer.js";
import { hashMarketplacePackage } from "../src/modules/marketplace/package.js";
import { scanCapabilitySupplyChain } from "../src/modules/capabilities/supply-chain-scanner.js";

const TASK_ID = "01900000-0000-7000-8000-000000000011";
const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "10000000-0000-4000-8000-000000000004";
const APPLICATION_OWNER_ID = "10000000-0000-4000-8000-000000000002";
const APPLICATION_ID = "10000000-0000-4000-8000-000000000003";
const PRIMARY_PLUGIN_ID = "20000000-0000-4000-8000-000000000001";
const SECONDARY_PLUGIN_ID = "20000000-0000-4000-8000-000000000002";
const APPLICATION_MCP_SERVER_ID = "20000000-0000-4000-8000-000000000003";
const EXTERNAL_SESSION_ID = "50000000-0000-4000-8000-000000000001";
const EXTERNAL_APPLICATION_SESSION_ID_MASTER_KEY =
  "external-application-session-master-key-for-tests-1234567890";
const MARKETPLACE_LISTING_ID = "30000000-0000-4000-8000-000000000001";
const MARKETPLACE_RELEASE_ID = "30000000-0000-4000-8000-000000000002";
const CAPABILITY_GENERATION = "b".repeat(64);
const CAPABILITY_CONTENT_DIGEST = "c".repeat(64);
const CAPABILITY_SOURCE_DIGEST = "d".repeat(64);
const BUILT_IN_BROWSER_ID = "builtin:capability:linksense-browser";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("DatabaseConversationPreflight credential isolation", () => {
  it("accepts a known built-in Skill priority without materializing it as a personal capability", async () => {
    const root = await capabilityRoot();
    const reconcile = vi.fn(async () => ({
      generation: CAPABILITY_GENERATION,
    }));
    const credentials = {
      resolveForCapability: vi.fn(),
      commitUsage: vi.fn(async () => undefined),
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([]) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );

    await expect(
      preflight.resolve({
        userId: USER_ID, conversationId: TASK_ID,
        priorityCapabilityIds: [BUILT_IN_BROWSER_ID],
      }),
    ).resolves.toMatchObject({ capabilities: [] });
    expect(reconcile).toHaveBeenCalledWith({
      ownerId: USER_ID,
      conversationId: TASK_ID,
      capabilities: [],
    });
    expect(credentials.resolveForCapability).not.toHaveBeenCalled();
  });

  it("keeps built-in Skill priorities out of application-managed tasks", async () => {
    const root = await capabilityRoot();
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([]) as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({
        userId: USER_ID, conversationId: TASK_ID,
        priorityCapabilityIds: [BUILT_IN_BROWSER_ID],
        capabilityScope: {
          sourceOwnerId: APPLICATION_OWNER_ID,
          capabilityIds: [],
          mcpServerIds: [],
        },
      }),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
  });

  it("projects the application owner's live capability into the recipient runtime without resolving owner credentials", async () => {
    const root = await capabilityRoot();
    const applicationSkill = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      ownerId: APPLICATION_OWNER_ID,
      type: "skill",
      name: "application-research",
      riskSummaryJson: null,
    };
    const prisma = prismaFixture([applicationSkill]);
    const credentials = {
      resolveForCapability: vi.fn(),
      commitUsage: vi.fn(async () => undefined),
    };
    const reconcile = vi.fn(async () => ({
      generation: CAPABILITY_GENERATION,
    }));
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );

    const result = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
      capabilityScope: {
        sourceOwnerId: APPLICATION_OWNER_ID,
        capabilityIds: [PRIMARY_PLUGIN_ID],
        mcpServerIds: [],
      },
    });

    expect(result.capabilities).toEqual([
      expect.objectContaining({
        id: PRIMARY_PLUGIN_ID,
        sourceOwnerId: APPLICATION_OWNER_ID,
        revision: "2026-07-19T00:00:00.000Z",
      }),
    ]);
    expect(reconcile).toHaveBeenCalledWith({
      ownerId: USER_ID,
      conversationId: TASK_ID,
      capabilities: [
        expect.objectContaining({
          id: PRIMARY_PLUGIN_ID,
          sourcePath: join(root, "primary"),
        }),
      ],
    });
    expect(credentials.resolveForCapability).not.toHaveBeenCalled();
  });

  it("projects only the application owner's explicitly selected MCP runtime", async () => {
    const root = await capabilityRoot();
    const applicationMcpRuntime = {
      id: APPLICATION_MCP_SERVER_ID,
      serverKey: "user_20000000000040008000000000000003",
      name: "Partner operations",
      transport: "streamable_http" as const,
      url: "https://partner-mcp.example.test/mcp",
      credential: {
        type: "bearer" as const,
        source: "LINKSENSE_MCP_CREDENTIAL_TEST",
      },
      revision: "a".repeat(64),
      startupTimeoutSeconds: 60,
      toolTimeoutSeconds: 600,
    };
    const mcpServers = {
      resolveRuntime: vi.fn(),
      resolveRecovery: vi.fn(),
      resolveApplicationRuntime: vi.fn(async () => ({
        servers: [applicationMcpRuntime],
        generation: "f".repeat(64),
        environment: {
          LINKSENSE_MCP_CREDENTIAL_TEST: "application-mcp-secret",
        },
        credentialUsageReceipts: [
          { serverId: APPLICATION_MCP_SERVER_ID },
        ],
      })),
      resolveApplicationRecovery: vi.fn(),
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([]) as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
      mcpServers,
    );

    const result = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [],
      capabilityScope: {
        sourceOwnerId: APPLICATION_OWNER_ID,
        capabilityIds: [],
        mcpServerIds: [APPLICATION_MCP_SERVER_ID],
      },
    });

    expect(mcpServers.resolveApplicationRuntime).toHaveBeenCalledWith(
      APPLICATION_OWNER_ID,
      [APPLICATION_MCP_SERVER_ID],
      [],
    );
    expect(result).toMatchObject({
      mcpServers: [applicationMcpRuntime],
      mcpGeneration: "f".repeat(64),
      environment: {
        LINKSENSE_MCP_CREDENTIAL_TEST: "application-mcp-secret",
      },
      mcpCredentialUsageReceipts: [
        { serverId: APPLICATION_MCP_SERVER_ID },
      ],
    });
  });

  it("injects an external session id only into that user's application MCP runtime", async () => {
    const root = await capabilityRoot();
    const prisma = {
      ...prismaFixture([]),
      applicationExternalSession: {
        findUnique: vi.fn(
          async ({ where }: { where: { runtimePrincipalId: string } }) => {
            if (where.runtimePrincipalId === OTHER_USER_ID) return null;
            return {
              id: EXTERNAL_SESSION_ID,
              applicationId: APPLICATION_ID,
              status: "active",
              absoluteExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
              externalApplicationSessionIdEncrypted: encryptJson(
                { value: "business-session-a" },
                EXTERNAL_APPLICATION_SESSION_ID_MASTER_KEY,
                "external-session-test-key",
                `linksense:external-application-session-id:v1:${EXTERNAL_SESSION_ID}`,
              ),
              externalApplicationSessionIdEncryptionKeyId:
                "external-session-test-key",
            };
          },
        ),
      },
    };
    const mcpServers = {
      resolveRuntime: vi.fn(),
      resolveRecovery: vi.fn(),
      resolveApplicationRuntime: vi.fn(async () => ({
        servers: [],
        generation:
          "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        environment: {},
        credentialUsageReceipts: [],
      })),
      resolveApplicationRecovery: vi.fn(),
    };
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
      mcpServers,
      EXTERNAL_APPLICATION_SESSION_ID_MASTER_KEY,
    );
    const capabilityScope = {
      applicationId: APPLICATION_ID,
      sourceOwnerId: APPLICATION_OWNER_ID,
      capabilityIds: [],
      mcpServerIds: [APPLICATION_MCP_SERVER_ID],
    };

    await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [],
      capabilityScope,
    });
    await preflight.resolve({
      userId: OTHER_USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [],
      capabilityScope,
    });
    expect(mcpServers.resolveApplicationRuntime).toHaveBeenNthCalledWith(
      1,
      APPLICATION_OWNER_ID,
      [APPLICATION_MCP_SERVER_ID],
      [{ headerName: "X-Session-Id", value: "business-session-a" }],
    );
    expect(mcpServers.resolveApplicationRuntime).toHaveBeenNthCalledWith(
      2,
      APPLICATION_OWNER_ID,
      [APPLICATION_MCP_SERVER_ID],
      [],
    );
  });

  it("injects the application owner's plugin credential for a recipient", async () => {
    const root = await capabilityRoot();
    const applicationPlugin = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), true),
      ownerId: APPLICATION_OWNER_ID,
      riskSummaryJson: {
        requires_credentials: true,
        declared_environment_keys: ["API_KEY"],
      },
    };
    const credentials = {
      resolveForCapability: vi.fn(async () => ({
        ok: true as const,
        environment: { API_KEY: "owner-plugin-secret" },
        usageReceipt: {
          userId: APPLICATION_OWNER_ID,
          capabilityId: PRIMARY_PLUGIN_ID,
          credentialIds: ["40000000-0000-4000-8000-000000000001"],
        },
      })),
      commitUsage: vi.fn(async () => undefined),
    };
    const prisma = prismaFixture([applicationPlugin]);
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    const result = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
      capabilityScope: {
        sourceOwnerId: APPLICATION_OWNER_ID,
        capabilityIds: [PRIMARY_PLUGIN_ID],
        mcpServerIds: [],
      },
    });

    expect(Object.values(result.environment)).toContain("owner-plugin-secret");
    expect(result.capabilities).toEqual([
      expect.objectContaining({
        id: PRIMARY_PLUGIN_ID,
        credentialEnvironment: expect.objectContaining({
          API_KEY: expect.any(String),
        }),
      }),
    ]);
    expect(credentials.resolveForCapability).toHaveBeenCalledWith(
      APPLICATION_OWNER_ID,
      PRIMARY_PLUGIN_ID,
      ["API_KEY"],
    );
    expect(result.credentialUsageReceipts).toEqual([
      {
        userId: USER_ID,
        capabilityId: PRIMARY_PLUGIN_ID,
        credentialIds: ["40000000-0000-4000-8000-000000000001"],
      },
    ]);

    credentials.resolveForCapability.mockClear();
    const recovered = await preflight.resolveRecovery({
      userId: USER_ID,
      applicationId: APPLICATION_ID,
      capabilities: result.capabilities.map((capability) => ({
        id: capability.id,
        type: capability.type,
        name: capability.name,
        revision: capability.revision,
        description: capability.description,
        sourceType: "local" as const,
        credentialEnvironment: capability.credentialEnvironment,
      })),
    });
    expect(Object.values(recovered.environment)).toContain(
      "owner-plugin-secret",
    );
    expect(credentials.resolveForCapability).toHaveBeenCalledWith(
      APPLICATION_OWNER_ID,
      PRIMARY_PLUGIN_ID,
      ["API_KEY"],
    );
  });

  it("blocks an application turn when the owner's plugin binding is unavailable", async () => {
    const root = await capabilityRoot();
    const applicationPlugin = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), true),
      ownerId: APPLICATION_OWNER_ID,
      riskSummaryJson: {
        requires_credentials: true,
        declared_environment_keys: ["API_KEY"],
      },
    };
    const credentials = {
      resolveForCapability: vi.fn(async () => ({
        ok: false as const,
        blockCode: "required_credential_unavailable" as const,
      })),
      commitUsage: vi.fn(async () => undefined),
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([applicationPlugin]) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({
        userId: USER_ID, conversationId: TASK_ID,
        priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
        capabilityScope: {
          sourceOwnerId: APPLICATION_OWNER_ID,
          capabilityIds: [PRIMARY_PLUGIN_ID],
          mcpServerIds: [],
        },
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_BINDING_REQUIRED" });
    expect(credentials.resolveForCapability).toHaveBeenCalledWith(
      APPLICATION_OWNER_ID,
      PRIMARY_PLUGIN_ID,
      ["API_KEY"],
    );
  });

  it("rejects a legacy capability path outside the configured root", async () => {
    const root = await capabilityRoot();
    const legacyPath = join(
      tmpdir(),
      "legacy-linksense-capabilities",
      PRIMARY_PLUGIN_ID,
      "current",
    );
    const primarySkill = {
      ...capability(PRIMARY_PLUGIN_ID, legacyPath, false),
      type: "skill",
      name: "frontend-slides",
    };
    const prisma = prismaFixture([primarySkill]);
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({ userId: USER_ID, conversationId: TASK_ID, priorityCapabilityIds: [] }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(prisma.capability.updateMany).not.toHaveBeenCalled();
  });

  it("still rejects an unrelated capability path outside the configured root", async () => {
    const root = await capabilityRoot();
    const primarySkill = {
      ...capability(
        PRIMARY_PLUGIN_ID,
        join(
          tmpdir(),
          "legacy-linksense-capabilities",
          SECONDARY_PLUGIN_ID,
          "current",
        ),
        false,
      ),
      type: "skill",
      name: "frontend-slides",
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([primarySkill]) as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({ userId: USER_ID, conversationId: TASK_ID, priorityCapabilityIds: [] }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
  });

  it("rejects an invalid persisted Skill name before contacting the runner", async () => {
    const root = await capabilityRoot();
    const invalidSkill = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      type: "skill",
      name: "Presentations",
    };
    const credentials = {
      resolveForCapability: vi.fn(),
      commitUsage: vi.fn(async () => undefined),
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([invalidSkill]) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({ userId: USER_ID, conversationId: TASK_ID, priorityCapabilityIds: [] }),
    ).rejects.toMatchObject({ code: "INVALID_PACKAGE" });
    expect(credentials.resolveForCapability).not.toHaveBeenCalled();
  });

  it("rejects duplicate names in the user's effective skill catalog", async () => {
    const root = await capabilityRoot();
    const duplicateSkills = [
      capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      capability(SECONDARY_PLUGIN_ID, join(root, "secondary"), false),
    ].map((entry) => ({
      ...entry,
      type: "skill",
      name: "presentation-builder",
    }));
    const credentials = {
      resolveForCapability: vi.fn(),
      commitUsage: vi.fn(async () => undefined),
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture(duplicateSkills) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({ userId: USER_ID, conversationId: TASK_ID, priorityCapabilityIds: [] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(credentials.resolveForCapability).not.toHaveBeenCalled();
  });

  it("uses capability-scoped source variables when two plugins declare the same key", async () => {
    const root = await capabilityRoot();
    const capabilities = [
      capability(PRIMARY_PLUGIN_ID, join(root, "primary"), true),
      capability(SECONDARY_PLUGIN_ID, join(root, "secondary"), true),
    ];
    const credentials = {
      resolveForCapability: vi.fn(
        async (_userId: string, capabilityId: string) => ({
          ok: true as const,
          environment: {
            API_KEY:
              capabilityId === PRIMARY_PLUGIN_ID
                ? "primary-secret-value"
                : "secondary-secret-value",
          },
          usageReceipt: {
            userId: USER_ID,
            capabilityId,
            credentialIds: [capabilityId],
          },
        }),
      ),
      commitUsage: vi.fn(async () => undefined),
    };
    const reconcile = vi.fn(
      async (input: {
        ownerId: string;
        capabilities: Array<{
          credentialFingerprint?: string;
          name: string;
          type: string;
        }>;
      }) => {
        void input;
        return { generation: CAPABILITY_GENERATION };
      },
    );
    const preflight = new DatabaseConversationPreflight(
      prismaFixture(capabilities) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );
    const result = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [],
    });
    const repeated = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [],
    });

    const primaryCapability = result.capabilities.find(
      (entry) => entry.id === PRIMARY_PLUGIN_ID,
    );
    const secondaryCapability = result.capabilities.find(
      (entry) => entry.id === SECONDARY_PLUGIN_ID,
    );
    const primarySource = primaryCapability?.credentialEnvironment?.API_KEY;
    const secondarySource = secondaryCapability?.credentialEnvironment?.API_KEY;
    expect(primarySource).toMatch(/^LINKSENSE_CREDENTIAL_[A-F0-9]{32}$/u);
    expect(secondarySource).toMatch(/^LINKSENSE_CREDENTIAL_[A-F0-9]{32}$/u);
    expect(secondarySource).not.toBe(primarySource);
    expect(result.environment[primarySource!]).toBe("primary-secret-value");
    expect(result.environment[secondarySource!]).toBe("secondary-secret-value");
    expect(result.environment).not.toHaveProperty("API_KEY");
    expect(repeated.capabilities).toEqual(result.capabilities);
    expect(repeated.environment).toEqual(result.environment);
    expect(
      JSON.stringify(primaryCapability?.credentialEnvironment),
    ).not.toContain("primary-secret-value");
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(reconcile).toHaveBeenLastCalledWith({
      ownerId: USER_ID,
      conversationId: TASK_ID,
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          id: PRIMARY_PLUGIN_ID,
          sourcePath: join(root, "primary"),
          credentialEnvironment: {
            API_KEY: primarySource,
          },
        }),
      ]),
    });
    expect(JSON.stringify(reconcile.mock.calls)).not.toContain(
      "primary-secret-value",
    );
    expect(
      (
        reconcile.mock.calls[0]?.[0] as {
          capabilities: Array<{ credentialFingerprint?: string }>;
        }
      ).capabilities[0]?.credentialFingerprint,
    ).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("excludes a plugin with missing credentials from both publication and runner targets", async () => {
    const root = await capabilityRoot();
    const plugin = capability(PRIMARY_PLUGIN_ID, join(root, "primary"), true);
    const reconcile = vi.fn(async () => ({
      generation: CAPABILITY_GENERATION,
    }));
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([plugin]) as never,
      {
        resolveForCapability: vi.fn(async () => ({
          ok: false as const,
          blockCode: "required_credential_unavailable" as const,
        })),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );

    const result = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [],
    });

    expect(result.capabilities).toEqual([]);
    expect(result.environment).toEqual({});
    expect(reconcile).toHaveBeenCalledWith({
      ownerId: USER_ID,
      conversationId: TASK_ID,
      capabilities: [],
    });
  });

  it("rejects credentials for a script-only plugin instead of exposing them ambiently", async () => {
    const root = await capabilityRoot();
    const plugin = capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false);
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([plugin]) as never,
      {
        resolveForCapability: vi.fn(async () => ({
          ok: true as const,
          environment: { PUBLIC_API_KEY: "primary-secret-value" },
          usageReceipt: {
            userId: USER_ID,
            capabilityId: PRIMARY_PLUGIN_ID,
            credentialIds: [PRIMARY_PLUGIN_ID],
          },
        })),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({ userId: USER_ID, conversationId: TASK_ID, priorityCapabilityIds: [] }),
    ).rejects.toMatchObject({ code: "EXECUTION_ENVIRONMENT_INVALID" });
  });

  it("rejects a plugin credential that targets the managed Bash bootstrap", async () => {
    const root = await capabilityRoot();
    const plugin = capability(PRIMARY_PLUGIN_ID, join(root, "primary"), true);
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([plugin]) as never,
      {
        resolveForCapability: vi.fn(async () => ({
          ok: true as const,
          environment: { BASH_ENV: "untrusted-bootstrap" },
          usageReceipt: {
            userId: USER_ID,
            capabilityId: PRIMARY_PLUGIN_ID,
            credentialIds: [PRIMARY_PLUGIN_ID],
          },
        })),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolve({ userId: USER_ID, conversationId: TASK_ID, priorityCapabilityIds: [] }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_BINDING_CONFLICT" });
  });

  it("recovers credential values from the persisted mapping without materializing HOME or reading the current capability catalog", async () => {
    const root = await capabilityRoot();
    const plugin = capability(PRIMARY_PLUGIN_ID, join(root, "primary"), true);
    const prisma = prismaFixture([plugin]);
    const credentials = {
      resolveForCapability: vi.fn(async () => ({
        ok: true as const,
        environment: { API_KEY: "recovered-secret-value" },
        usageReceipt: {
          userId: USER_ID,
          capabilityId: PRIMARY_PLUGIN_ID,
          credentialIds: [PRIMARY_PLUGIN_ID],
        },
      })),
      commitUsage: vi.fn(async () => undefined),
    };
    const reconcile = vi.fn(async () => ({
      generation: CAPABILITY_GENERATION,
    }));
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );
    const started = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [],
    });
    const credentialEnvironment =
      started.capabilities[0]?.credentialEnvironment;
    expect(credentialEnvironment).toBeDefined();
    reconcile.mockClear();
    prisma.capability.findMany.mockClear();
    credentials.resolveForCapability.mockClear();

    plugin.name = "updated-after-turn-start";
    plugin.updatedAt = new Date("2026-07-24T12:00:00.000Z");
    const recovered = await preflight.resolveRecovery({
      userId: USER_ID,
      capabilities: [
        {
          id: PRIMARY_PLUGIN_ID,
          type: "plugin",
          name: "primary-plugin",
          revision: "2026-07-19T00:00:00.000Z",
          credentialEnvironment,
          description: null,
          sourceType: "local",
        },
      ],
    });

    expect(recovered.environment).toEqual({
      [credentialEnvironment!.API_KEY!]: "recovered-secret-value",
    });
    expect(credentials.resolveForCapability).toHaveBeenCalledWith(
      USER_ID,
      PRIMARY_PLUGIN_ID,
      ["API_KEY"],
    );
    expect(reconcile).not.toHaveBeenCalled();
    expect(prisma.capability.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when a recovery credential mapping does not match the persisted snapshot", async () => {
    const root = await capabilityRoot();
    const credentials = {
      resolveForCapability: vi.fn(async () => ({
        ok: true as const,
        environment: { API_KEY: "recovered-secret-value" },
        usageReceipt: {
          userId: USER_ID,
          capabilityId: PRIMARY_PLUGIN_ID,
          credentialIds: [PRIMARY_PLUGIN_ID],
        },
      })),
      commitUsage: vi.fn(async () => undefined),
    };
    const reconcile = vi.fn(async () => ({
      generation: CAPABILITY_GENERATION,
    }));
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([]) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );

    await expect(
      preflight.resolveRecovery({
        userId: USER_ID,
        capabilities: [
          {
            id: PRIMARY_PLUGIN_ID,
            type: "plugin",
            name: "primary-plugin",
            revision: "2026-07-19T00:00:00.000Z",
            credentialEnvironment: {
              API_KEY: "LINKSENSE_CREDENTIAL_00000000000000000000000000000000",
            },
            description: null,
            sourceType: "local",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_BINDING_CONFLICT" });
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("fails closed when a credential used by the running-turn snapshot was revoked", async () => {
    const root = await capabilityRoot();
    const credentials = {
      resolveForCapability: vi.fn(async () => ({
        ok: false as const,
        blockCode: "required_credential_unavailable" as const,
      })),
      commitUsage: vi.fn(async () => undefined),
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([]) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );

    await expect(
      preflight.resolveRecovery({
        userId: USER_ID,
        capabilities: [
          {
            id: PRIMARY_PLUGIN_ID,
            type: "plugin",
            name: "primary-plugin",
            revision: "2026-07-19T00:00:00.000Z",
            credentialEnvironment: {
              API_KEY: "LINKSENSE_CREDENTIAL_00000000000000000000000000000000",
            },
            description: null,
            sourceType: "local",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CREDENTIAL_BINDING_REQUIRED" });
  });

  it("does not resolve credentials or materialize HOME for a persisted Skill snapshot", async () => {
    const root = await capabilityRoot();
    const credentials = {
      resolveForCapability: vi.fn(),
      commitUsage: vi.fn(async () => undefined),
    };
    const reconcile = vi.fn(async () => ({
      generation: CAPABILITY_GENERATION,
    }));
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([]) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );

    await expect(
      preflight.resolveRecovery({
        userId: USER_ID,
        capabilities: [
          {
            id: PRIMARY_PLUGIN_ID,
            type: "skill",
            name: "presentation-builder",
            revision: "2026-07-19T00:00:00.000Z",
            description: null,
            sourceType: "local",
          },
        ],
      }),
    ).resolves.toEqual({ environment: {} });
    expect(credentials.resolveForCapability).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("does not read the current capability or credential state for a persisted plugin without credentials", async () => {
    const root = await capabilityRoot();
    const credentials = {
      resolveForCapability: vi.fn(),
      commitUsage: vi.fn(async () => undefined),
    };
    const reconcile = vi.fn(async () => ({
      generation: CAPABILITY_GENERATION,
    }));
    const prisma = prismaFixture([]);
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(reconcile),
    );

    await expect(
      preflight.resolveRecovery({
        userId: USER_ID,
        capabilities: [
          {
            id: PRIMARY_PLUGIN_ID,
            type: "plugin",
            name: "removed-after-turn-start",
            revision: "2026-07-19T00:00:00.000Z",
            description: null,
            sourceType: "local",
          },
        ],
      }),
    ).resolves.toEqual({ environment: {} });
    expect(credentials.resolveForCapability).not.toHaveBeenCalled();
    expect(prisma.capability.findMany).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("maps a blocked HOME publication to a stable preflight error", async () => {
    const root = await capabilityRoot();
    const skill = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      type: "skill",
      name: "presentation-builder",
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([skill]) as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(
        vi.fn(async () => {
          throw new Error("publication blocked");
        }),
      ),
    );

    await expect(
      preflight.resolve({ userId: USER_ID, conversationId: TASK_ID, priorityCapabilityIds: [] }),
    ).rejects.toMatchObject({ code: "CAPABILITY_HOME_SYNC_FAILED" });
  });

  it("initializes the owner mount without publishing capabilities or consulting an active task", async () => {
    const root = await capabilityRoot();
    const skill = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      type: "skill",
      name: "presentation-builder",
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([skill]) as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(
        vi.fn(async () => {
          throw new UserHomeCapabilityPublicationDeferredError();
        }),
      ),
    );

    await expect(preflight.ensureUserHome(USER_ID)).resolves.toBeUndefined();
  });

  it("reuses the resolve verification snapshot at the final start barrier", async () => {
    const root = await capabilityRoot();
    const skill = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      type: "skill",
      name: "presentation-builder",
    };
    const verification = capabilityVerification();
    const withPublishedRuntime = vi.fn(
      async (_input: unknown, action: () => Promise<unknown>) => action(),
    );
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([skill]) as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializerWithReconcile(
        vi.fn(async () => ({
          generation: CAPABILITY_GENERATION,
          verification,
        })),
        withPublishedRuntime,
      ),
    );
    const resolved = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
    });
    const action = vi.fn(async () => "created");

    expect(resolved.capabilityVerification).toBe(verification);
    await expect(
      preflight.withCapabilityStartBarrier(
        {
          userId: USER_ID, conversationId: TASK_ID,
          priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
          ...resolved,
          environment: resolved.environment ?? {},
          credentialUsageReceipts: resolved.credentialUsageReceipts ?? [],
        },
        action,
      ),
    ).resolves.toBe("created");
    expect(withPublishedRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ verification }),
      expect.any(Function),
    );
    expect(action).toHaveBeenCalledOnce();
  });

  it("fails the final start barrier when a committed authorization change makes the resolved snapshot stale", async () => {
    const root = await capabilityRoot();
    const skill = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      type: "skill",
      name: "presentation-builder",
    };
    const prisma = prismaFixture([skill]);
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );
    const resolved = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
    });
    prisma.capability.findMany.mockResolvedValueOnce([]);
    const action = vi.fn(async () => "created");

    await expect(
      preflight.withCapabilityStartBarrier(
        {
          userId: USER_ID, conversationId: TASK_ID,
          priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
          ...resolved,
          environment: resolved.environment ?? {},
          credentialUsageReceipts: resolved.credentialUsageReceipts ?? [],
        },
        action,
      ),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(action).not.toHaveBeenCalled();
  });

  it("fails the final start barrier when credential values changed after preflight", async () => {
    const root = await capabilityRoot();
    const plugin = capability(PRIMARY_PLUGIN_ID, join(root, "primary"), true);
    const credentials = {
      resolveForCapability: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          environment: { API_KEY: "old-secret" },
          usageReceipt: {
            userId: USER_ID,
            capabilityId: PRIMARY_PLUGIN_ID,
            credentialIds: [SECONDARY_PLUGIN_ID],
          },
        })
        .mockResolvedValueOnce({
          ok: true as const,
          environment: { API_KEY: "new-secret" },
          usageReceipt: {
            userId: USER_ID,
            capabilityId: PRIMARY_PLUGIN_ID,
            credentialIds: [SECONDARY_PLUGIN_ID],
          },
        }),
      commitUsage: vi.fn(async () => undefined),
    };
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([plugin]) as never,
      credentials as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      materializer(),
    );
    const resolved = await preflight.resolve({
      userId: USER_ID, conversationId: TASK_ID,
      priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
    });
    const action = vi.fn(async () => "created");

    await expect(
      preflight.withCapabilityStartBarrier(
        {
          userId: USER_ID, conversationId: TASK_ID,
          priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
          ...resolved,
          environment: resolved.environment ?? {},
          credentialUsageReceipts: resolved.credentialUsageReceipts ?? [],
        },
        action,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(action).not.toHaveBeenCalled();
  });

  it("rejects a recovery snapshot when its capability no longer exists without materializing HOME", async () => {
    const root = await capabilityRoot();
    const prisma = prismaFixture([]);
    const home = materializer();
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      home,
    );

    await expect(
      preflight.resolveStartIntentRecovery({
        userId: USER_ID,
        capabilities: [
          {
            id: PRIMARY_PLUGIN_ID,
            type: "skill",
            name: "presentation-builder",
            revision: "persisted",
            description: null,
            sourceType: "local",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(home.reconcile).not.toHaveBeenCalled();
  });

  it("fails closed before materialization when an installed marketplace listing is suspended", async () => {
    const root = await capabilityRoot();
    const installedSkill = {
      ...capability(PRIMARY_PLUGIN_ID, join(root, "primary"), false),
      type: "skill",
      name: "presentation-builder",
      sourceType: "marketplace",
      marketplaceListingId: MARKETPLACE_LISTING_ID,
      marketplaceReleaseId: MARKETPLACE_RELEASE_ID,
    };
    const prisma = prismaFixture([installedSkill]);
    prisma.marketplaceListing.findMany.mockResolvedValue([
      { id: MARKETPLACE_LISTING_ID, status: "suspended" },
    ]);
    prisma.marketplaceRelease.findMany.mockResolvedValue([
      {
        id: MARKETPLACE_RELEASE_ID,
        listingId: MARKETPLACE_LISTING_ID,
        status: "approved",
        contentSha256: "a".repeat(64),
      },
    ]);
    const home = materializer();
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      home,
    );

    await expect(
      preflight.resolve({
        userId: USER_ID, conversationId: TASK_ID,
        priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(home.reconcile).not.toHaveBeenCalled();
  });

  it("revalidates an approved capability content hash at task admission", async () => {
    const root = await capabilityRoot();
    const storagePath = join(root, "primary");
    await writeFile(join(storagePath, "SKILL.md"), "# Approved skill\n");
    const approved = {
      ...capability(PRIMARY_PLUGIN_ID, storagePath, false),
      type: "skill",
      name: "approved-skill",
      riskSummaryJson: {
        supply_chain_review: await scanCapabilitySupplyChain(storagePath),
      },
    };
    const home = materializer();
    const preflight = new DatabaseConversationPreflight(
      prismaFixture([approved]) as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      home,
    );

    await expect(
      preflight.resolve({
        userId: USER_ID,
        conversationId: TASK_ID,
        priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
      }),
    ).resolves.toMatchObject({
      capabilities: [{ id: PRIMARY_PLUGIN_ID, type: "skill" }],
    });

    await writeFile(join(storagePath, "SKILL.md"), "# Changed after approval\n");
    await expect(
      preflight.resolve({
        userId: USER_ID,
        conversationId: TASK_ID,
        priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_PACKAGE",
      params: { reason_code: "security_review_stale" },
    });
    expect(home.reconcile).toHaveBeenCalledTimes(1);
  });

  it("accepts an intact marketplace package and fails closed after it is modified", async () => {
    const root = await capabilityRoot();
    const storagePath = join(root, "primary");
    await writeFile(join(storagePath, "SKILL.md"), "# Presentation builder\n");
    const approvedSha256 = await hashMarketplacePackage(storagePath);
    const installedSkill = {
      ...capability(PRIMARY_PLUGIN_ID, storagePath, false),
      type: "skill",
      name: "presentation-builder",
      sourceType: "marketplace",
      marketplaceListingId: MARKETPLACE_LISTING_ID,
      marketplaceReleaseId: MARKETPLACE_RELEASE_ID,
    };
    const prisma = prismaFixture([installedSkill]);
    prisma.marketplaceListing.findMany.mockResolvedValue([
      { id: MARKETPLACE_LISTING_ID, status: "published" },
    ]);
    prisma.marketplaceRelease.findMany.mockResolvedValue([
      {
        id: MARKETPLACE_RELEASE_ID,
        listingId: MARKETPLACE_LISTING_ID,
        status: "approved",
        contentSha256: approvedSha256,
      },
    ]);
    const home = materializer();
    const preflight = new DatabaseConversationPreflight(
      prisma as never,
      {
        resolveForCapability: vi.fn(),
        commitUsage: vi.fn(async () => undefined),
      } as never,
      root,
      "credential-source-secret-for-tests-1234567890",
      home,
    );

    await expect(
      preflight.resolve({
        userId: USER_ID, conversationId: TASK_ID,
        priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
      }),
    ).resolves.toMatchObject({
      capabilities: [{ id: PRIMARY_PLUGIN_ID, type: "skill" }],
    });

    await writeFile(
      join(storagePath, "SKILL.md"),
      "# Modified after install\n",
    );
    await expect(
      preflight.resolve({
        userId: USER_ID, conversationId: TASK_ID,
        priorityCapabilityIds: [PRIMARY_PLUGIN_ID],
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_FOUND" });
    expect(home.reconcile).toHaveBeenCalledTimes(1);
  });
});

describe("running-turn capability publication guard", () => {
  it.each([
    {
      name: "running turn",
      runningTurn: { id: "40000000-0000-4000-8000-000000000001" },
      startIntent: null,
      allowed: false,
    },
    {
      name: "unprojected start intent",
      runningTurn: null,
      startIntent: {
        projectionTurnId: "40000000-0000-4000-8000-000000000002",
      },
      allowed: false,
    },
    {
      name: "no active or starting turn",
      runningTurn: null,
      startIntent: null,
      allowed: true,
    },
  ])(
    "returns $allowed for $name",
    async ({ runningTurn, startIntent, allowed }) => {
      const conversationTurnFindFirst = vi.fn(async () => runningTurn);
      const startIntentFindFirst = vi.fn(async () => startIntent);
      const guard = createRunningTurnCapabilityPublicationGuard({
        conversationTurn: { findFirst: conversationTurnFindFirst },
        conversationTurnStartIntent: { findFirst: startIntentFindFirst },
      } as never);

      await expect(
        guard({
          ownerId: USER_ID,
      conversationId: TASK_ID,
          currentGeneration: CAPABILITY_GENERATION,
          nextGeneration: "c".repeat(64),
        }),
      ).resolves.toBe(allowed);
      expect(conversationTurnFindFirst).toHaveBeenCalledWith({
        where: { submittedBy: USER_ID, conversationId: TASK_ID, status: "running" },
        select: { id: true },
      });
      expect(startIntentFindFirst).toHaveBeenCalledWith({
        where: { ownerId: USER_ID, conversationId: TASK_ID },
        select: { projectionTurnId: true },
      });
    },
  );
});

async function capabilityRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "linksense-preflight-"));
  roots.push(root);
  await Promise.all([
    mkdir(join(root, "primary"), { recursive: true }),
    mkdir(join(root, "secondary"), { recursive: true }),
  ]);
  return root;
}

function materializer() {
  return materializerWithReconcile(
    vi.fn(async () => ({ generation: CAPABILITY_GENERATION })),
  );
}

function capabilityVerification(
  capabilities: Array<{ name: string; type: string }> = [],
): CapabilityRuntimeVerification {
  return {
    generation: CAPABILITY_GENERATION,
    contentDigest: CAPABILITY_CONTENT_DIGEST,
    sourceDigest: CAPABILITY_SOURCE_DIGEST,
    pluginNames: capabilities
      .filter((capability) => capability.type === "plugin")
      .map((capability) => capability.name)
      .sort(),
  };
}

type MaterializerTestDouble = Pick<
  UserHomeCapabilityMaterializer,
  | "ensureOwner"
  | "reconcile"
  | "reconcileWithinPublicationStartFence"
  | "resolvePublishedRuntimeWithinPublicationStartFence"
  | "withPublicationStartFence"
  | "withPublishedRuntime"
  | "withVerifiedRuntime"
>;

function materializerWithReconcile<
  T extends {
    capabilities?: Array<{ name: string; type: string }>;
  },
>(
  reconcile: (input: T) => Promise<{
    generation: string;
    verification?: CapabilityRuntimeVerification;
  }>,
  withPublishedRuntime = vi.fn(
    async (_input: unknown, action: () => Promise<unknown>) => action(),
  ),
): MaterializerTestDouble {
  const reconciler = vi.fn(async (input: T) => {
    const result = await reconcile(input);
    return {
      ...result,
      verification:
        result.verification ?? capabilityVerification(input.capabilities),
    };
  });
  return {
    ensureOwner: vi.fn(async () => undefined),
    reconcile: reconciler,
    reconcileWithinPublicationStartFence: vi.fn((input: T) =>
      reconciler(input),
    ),
    resolvePublishedRuntimeWithinPublicationStartFence: vi.fn((input: T) =>
      reconciler(input),
    ),
    withPublicationStartFence: async (
      _ownerId: string,
      action: () => Promise<unknown>,
    ) => action(),
    withPublishedRuntime,
    withVerifiedRuntime: vi.fn(
      async (_input: unknown, action: () => Promise<unknown>) => action(),
    ),
  } as unknown as MaterializerTestDouble;
}

function capability(id: string, storagePath: string, hasMcpServers: boolean) {
  return {
    id,
    type: "plugin",
    status: "active",
    storagePath,
    name: id === PRIMARY_PLUGIN_ID ? "primary-plugin" : "secondary-plugin",
    description: null,
    ownerId: USER_ID,
    sourceType: "local",
    marketplaceListingId: null as string | null,
    marketplaceReleaseId: null as string | null,
    manifestJson: { has_mcp_servers: hasMcpServers },
    updatedAt: new Date("2026-07-19T00:00:00.000Z"),
  };
}

function prismaFixture(capabilities: Array<ReturnType<typeof capability>>) {
  return {
    application: {
      findUnique: vi.fn(async () => ({ ownerId: APPLICATION_OWNER_ID })),
    },
    applicationMcpServer: { findMany: vi.fn(async () => []) },
    applicationExternalSession: { findUnique: vi.fn(async () => null) },
    capability: {
      findMany: vi.fn(async () => capabilities),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    capabilityUserPreference: { findMany: vi.fn(async () => []) },
    marketplaceListing: {
      findMany: vi.fn(
        async (): Promise<Array<{ id: string; status: string }>> => [],
      ),
    },
    marketplaceRelease: {
      findMany: vi.fn(
        async (): Promise<
          Array<{
            id: string;
            listingId: string;
            status: string;
            contentSha256: string;
          }>
        > => [],
      ),
    },
  };
}
