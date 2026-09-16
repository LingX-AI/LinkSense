import { ApplicationPublicationService } from "../src/modules/applications/publication-service.js";
import { describe, expect, it, vi } from "vitest";

import { ApplicationService } from "../src/modules/applications/service.js";

const RECIPIENT_ID = "10000000-0000-4000-8000-000000000001";
const OWNER_ID = "10000000-0000-4000-8000-000000000002";
const APPLICATION_ID = "20000000-0000-4000-8000-000000000001";
const CAPABILITY_ID = "30000000-0000-4000-8000-000000000001";
const NEXT_CAPABILITY_ID = "30000000-0000-4000-8000-000000000002";
const KNOWLEDGE_BASE_ID = "40000000-0000-4000-8000-000000000001";
const NEXT_KNOWLEDGE_BASE_ID = "40000000-0000-4000-8000-000000000002";
const SHARE_TARGET_GROUP_ID = "50000000-0000-4000-8000-000000000001";
const MCP_SERVER_ID = "60000000-0000-4000-8000-000000000001";

function modelSettings(resolveRuntimeForSelection = vi.fn(async () => runtimeModel())) {
  return {
    resolveRuntime: vi.fn(),
    resolveRuntimeForSelection,
    resolveModelTransitionRuntime: vi.fn(async () => ({
      model: runtimeModel().model,
      provider: runtimeModel().provider,
    })),
  };
}

function credentialResolver(
  result: { ok: boolean } = { ok: true },
) {
  return {
    resolveForCapability: vi.fn(async () =>
      result.ok
        ? {
            ok: true as const,
            environment: {},
            usageReceipt: {
              userId: OWNER_ID,
              capabilityId: CAPABILITY_ID,
              credentialIds: [],
            },
          }
        : {
            ok: false as const,
            blockCode: "required_credential_unavailable" as const,
          },
    ),
  };
}

describe("ApplicationService owner lifecycle", () => {
  it("creates an application with stable resource references and a validated custom icon", async () => {
    const createdAt = new Date("2026-07-27T00:00:00.000Z");
    let applicationRow: Omit<
      ReturnType<typeof application>,
      "iconObjectKey"
    > & { iconObjectKey: string | null } = application({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use approved internal sources.",
      updatedAt: createdAt,
    });
    const capabilityRow = capability(CAPABILITY_ID);
    const knowledgeBaseRow = knowledgeBase(KNOWLEDGE_BASE_ID);
    const transaction = {
      application: {
        create: vi.fn(
          async (input: {
            data: { iconPreset: string; iconObjectKey: string | null };
          }) => {
            applicationRow = {
              ...applicationRow,
              iconPreset: input.data.iconPreset,
              iconObjectKey: input.data.iconObjectKey,
            };
            return applicationRow;
          },
        ),
      },
      applicationCapability: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      applicationKnowledgeBase: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      applicationMcpServer: {
        createMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (action: (tx: typeof transaction) => Promise<unknown>) =>
          action(transaction),
      ),
      user: {
        findMany: vi.fn(async () => [{ id: OWNER_ID, name: "Owner" }]),
      },
      userGroupMember: { findMany: vi.fn(async () => []) },
      applicationGrant: { findMany: vi.fn(async () => []) },
      application: {
        findMany: vi.fn(async () => [{ id: APPLICATION_ID }]),
        findFirst: vi.fn(async () => applicationRow),
      },
      applicationCapability: {
        findMany: vi.fn(async () => [
          {
            applicationId: APPLICATION_ID,
            capabilityId: CAPABILITY_ID,
            capabilityNameSnapshot: capabilityRow.name,
            capabilityTypeSnapshot: capabilityRow.type,
            selectionOrder: 0,
            createdAt,
          },
        ]),
      },
      applicationKnowledgeBase: {
        findMany: vi.fn(async () => [
          {
            applicationId: APPLICATION_ID,
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            knowledgeBaseNameSnapshot: knowledgeBaseRow.name,
            selectionOrder: 0,
            createdAt,
          },
        ]),
      },
      applicationMcpServer: { findMany: vi.fn(async () => []) },
      capability: { findMany: vi.fn(async () => [capabilityRow]) },
      knowledgeBase: { findMany: vi.fn(async () => [knowledgeBaseRow]) },
      mcpServer: { findMany: vi.fn(async () => []) },
    };
    const audit = { write: vi.fn(async () => undefined) };
    const iconStore = {
      put: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      presignGet: vi.fn(
        async (objectKey: string) =>
          `https://objects.example.test/${objectKey}`,
      ),
      enqueueRemoval: vi.fn(async () => undefined),
    };
    const modelResolution = vi.fn(async () => runtimeModel());
    const service = new ApplicationService(
      prisma as never,
      modelSettings(modelResolution),
      audit as never,
      credentialResolver(),
      iconStore,
    );

    const result = await service.create(
      activeActor(),
      {
        name: "Finance assistant",
        description: null,
        instructions: "Use approved internal sources.",
        model: null,
        reasoning_effort: null,
        capability_ids: [CAPABILITY_ID],
        knowledge_base_ids: [KNOWLEDGE_BASE_ID],
        mcp_server_ids: [],
        icon: {
          type: "upload",
          filename: "finance.png",
          mime_type: "image/png",
          data_base64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        },
      },
      { ipAddress: "192.0.2.1" },
    );

    expect(transaction.application.create).toHaveBeenCalledWith({
      data: {
        ownerId: OWNER_ID,
        name: "Finance assistant",
        iconPreset: "bot",
        iconObjectKey: expect.stringMatching(
          new RegExp(`^applications/${OWNER_ID}/icons/.+\\.png$`),
        ),
        description: null,
        instructions: "Use approved internal sources.",
        model: null,
        reasoningEffort: null,
        status: "active",
      },
    });
    expect(modelResolution).not.toHaveBeenCalled();
    expect(iconStore.put).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^applications/${OWNER_ID}/icons/.+\\.png$`),
      ),
      expect.any(Buffer),
      "image/png",
    );
    expect(transaction.applicationCapability.createMany).toHaveBeenCalledWith({
      data: [
        {
          applicationId: APPLICATION_ID,
          capabilityId: CAPABILITY_ID,
          capabilityNameSnapshot: capabilityRow.name,
          capabilityTypeSnapshot: capabilityRow.type,
          selectionOrder: 0,
        },
      ],
    });
    expect(
      transaction.applicationKnowledgeBase.createMany,
    ).toHaveBeenCalledWith({
      data: [
        {
          applicationId: APPLICATION_ID,
          knowledgeBaseId: KNOWLEDGE_BASE_ID,
          knowledgeBaseNameSnapshot: knowledgeBaseRow.name,
          selectionOrder: 0,
        },
      ],
    });
    expect(result).toMatchObject({
      id: APPLICATION_ID,
      is_owner: true,
      instructions: "Use approved internal sources.",
      icon: expect.objectContaining({
        type: "custom",
        url: expect.stringContaining("https://objects.example.test/"),
      }),
      capability_count: 1,
      knowledge_base_count: 1,
      capabilities: [{ id: CAPABILITY_ID }],
      knowledge_bases: [{ id: KNOWLEDGE_BASE_ID }],
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: OWNER_ID,
        action: "application_created",
        targetId: APPLICATION_ID,
      }),
    );
  });

  it("projects share target summaries only for application owners", async () => {
    const createdAt = new Date("2026-07-27T00:00:00.000Z");
    const applicationRow = application({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use approved internal sources.",
      updatedAt: createdAt,
    });
    const grants = [
      {
        id: "60000000-0000-4000-8000-000000000001",
        applicationId: APPLICATION_ID,
        granteeType: "user",
        userId: RECIPIENT_ID,
        userGroupId: null,
        status: "active",
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: "60000000-0000-4000-8000-000000000002",
        applicationId: APPLICATION_ID,
        granteeType: "user_group",
        userId: null,
        userGroupId: SHARE_TARGET_GROUP_ID,
        status: "active",
        createdAt,
        updatedAt: createdAt,
      },
    ];
    const ownerPrisma = {
      user: {
        findMany: vi.fn(async (query: { where: { id: { in: string[] } } }) =>
          query.where.id.in.includes(OWNER_ID)
            ? [{ id: OWNER_ID, name: "Owner" }]
            : [{ id: RECIPIENT_ID, name: "林老师" }],
        ),
      },
      userGroup: {
        findMany: vi.fn(async () => [
          { id: SHARE_TARGET_GROUP_ID, name: "教务组" },
        ]),
      },
      userGroupMember: { findMany: vi.fn(async () => []) },
      applicationGrant: {
        findMany: vi.fn(async (query: { select?: unknown }) =>
          query.select ? [] : grants,
        ),
      },
      application: {
        findMany: vi.fn(async (query: { select?: unknown }) =>
          query.select ? [{ id: APPLICATION_ID }] : [applicationRow],
        ),
      },
      applicationCapability: { findMany: vi.fn(async () => []) },
      applicationKnowledgeBase: { findMany: vi.fn(async () => []) },
      applicationMcpServer: { findMany: vi.fn(async () => []) },
      capability: { findMany: vi.fn(async () => []) },
      knowledgeBase: { findMany: vi.fn(async () => []) },
      mcpServer: { findMany: vi.fn(async () => []) },
    };
    const ownerService = new ApplicationService(
      ownerPrisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      ownerService.list(activeActor(), { scope: "owned", limit: 100 }),
    ).resolves.toMatchObject([
      {
        id: APPLICATION_ID,
        share_targets: [
          { id: RECIPIENT_ID, type: "user", name: "林老师" },
          { id: SHARE_TARGET_GROUP_ID, type: "user_group", name: "教务组" },
        ],
      },
    ]);
    expect(ownerPrisma.application.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );

    const recipientPrisma = {
      user: {
        findMany: vi.fn(async () => [{ id: OWNER_ID, name: "Owner" }]),
      },
      userGroupMember: { findMany: vi.fn(async () => []) },
      applicationGrant: {
        findMany: vi.fn(async () => [
          { applicationId: APPLICATION_ID, granteeType: "user" },
        ]),
      },
      application: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => applicationRow),
      },
      applicationCapability: { findMany: vi.fn(async () => []) },
      applicationKnowledgeBase: { findMany: vi.fn(async () => []) },
      applicationMcpServer: { findMany: vi.fn(async () => []) },
      capability: { findMany: vi.fn(async () => []) },
      knowledgeBase: { findMany: vi.fn(async () => []) },
      mcpServer: { findMany: vi.fn(async () => []) },
    };
    const recipientService = new ApplicationService(
      recipientPrisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      recipientService.get(
        {
          id: RECIPIENT_ID,
          role: "user",
          status: "active",
          ipAddress: "192.0.2.1",
        },
        APPLICATION_ID,
      ),
    ).resolves.toMatchObject({
      id: APPLICATION_ID,
      share_targets: [],
    });
    expect(recipientPrisma.applicationGrant.findMany).toHaveBeenCalledTimes(1);
  });

  it("atomically replaces selected bindings while preserving the application identity", async () => {
    const originalUpdatedAt = new Date("2026-07-27T01:00:00.000Z");
    const nextUpdatedAt = new Date("2026-07-27T02:00:00.000Z");
    const original = {
      ...application({
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
        instructions: "Use the finance workflow.",
        updatedAt: originalUpdatedAt,
      }),
      iconObjectKey: `applications/${OWNER_ID}/icons/old.png`,
    };
    const updated = {
      ...original,
      instructions: "Use the updated research workflow.",
      model: null,
      reasoningEffort: null,
      iconPreset: "book-open",
      iconObjectKey: null,
      updatedAt: nextUpdatedAt,
    };
    const nextCapability = capability(NEXT_CAPABILITY_ID, {
      name: "updated-finance-research",
    });
    const nextKnowledgeBase = knowledgeBase(NEXT_KNOWLEDGE_BASE_ID);
    const transaction = {
      application: { updateMany: vi.fn(async () => ({ count: 1 })) },
      applicationCapability: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      applicationKnowledgeBase: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
      applicationMcpServer: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (action: (tx: typeof transaction) => Promise<unknown>) =>
          action(transaction),
      ),
      user: {
        findMany: vi.fn(async () => [{ id: OWNER_ID, name: "Owner" }]),
      },
      userGroupMember: { findMany: vi.fn(async () => []) },
      applicationGrant: { findMany: vi.fn(async () => []) },
      application: {
        findMany: vi.fn(async () => [{ id: APPLICATION_ID }]),
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(original)
          .mockResolvedValueOnce(updated),
      },
      applicationCapability: {
        findMany: vi.fn(async () => [
          {
            applicationId: APPLICATION_ID,
            capabilityId: NEXT_CAPABILITY_ID,
            capabilityNameSnapshot: nextCapability.name,
            capabilityTypeSnapshot: nextCapability.type,
            selectionOrder: 0,
            createdAt: nextUpdatedAt,
          },
        ]),
      },
      applicationKnowledgeBase: {
        findMany: vi.fn(async () => [
          {
            applicationId: APPLICATION_ID,
            knowledgeBaseId: NEXT_KNOWLEDGE_BASE_ID,
            knowledgeBaseNameSnapshot: nextKnowledgeBase.name,
            selectionOrder: 0,
            createdAt: nextUpdatedAt,
          },
        ]),
      },
      applicationMcpServer: { findMany: vi.fn(async () => []) },
      capability: { findMany: vi.fn(async () => [nextCapability]) },
      knowledgeBase: { findMany: vi.fn(async () => [nextKnowledgeBase]) },
      mcpServer: { findMany: vi.fn(async () => []) },
    };
    const iconStore = {
      put: vi.fn(),
      remove: vi.fn(),
      presignGet: vi.fn(),
      enqueueRemoval: vi.fn(async () => undefined),
    };
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn(async () => undefined) } as never,
      credentialResolver(),
      iconStore,
    );

    const result = await service.update(
      activeActor(),
      APPLICATION_ID,
      {
        instructions: "Use the updated research workflow.",
        model: null,
        reasoning_effort: null,
        capability_ids: [NEXT_CAPABILITY_ID],
        knowledge_base_ids: [NEXT_KNOWLEDGE_BASE_ID],
        icon: { type: "preset", preset: "book-open" },
      },
      {},
    );

    expect(transaction.application.updateMany).toHaveBeenCalledWith({
      where: {
        id: APPLICATION_ID,
        ownerId: OWNER_ID,
        status: { in: ["active", "disabled"] },
        updatedAt: originalUpdatedAt,
      },
      data: expect.objectContaining({
        instructions: "Use the updated research workflow.",
        model: null,
        reasoningEffort: null,
        iconPreset: "book-open",
        iconObjectKey: null,
        updatedAt: expect.any(Date),
      }),
    });
    expect(transaction.applicationCapability.deleteMany).toHaveBeenCalledWith({
      where: { applicationId: APPLICATION_ID },
    });
    expect(
      transaction.applicationKnowledgeBase.deleteMany,
    ).toHaveBeenCalledWith({ where: { applicationId: APPLICATION_ID } });
    expect(result).toMatchObject({
      id: APPLICATION_ID,
      model: null,
      reasoning_effort: null,
      icon: { type: "preset", preset: "book-open" },
      capabilities: [{ id: NEXT_CAPABILITY_ID }],
      knowledge_bases: [{ id: NEXT_KNOWLEDGE_BASE_ID }],
    });
    expect(iconStore.enqueueRemoval).toHaveBeenCalledWith(
      `applications/${OWNER_ID}/icons/old.png`,
    );
  });

  it("soft-deletes an application and revokes all active shares atomically", async () => {
    const current = {
      ...application({
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
        instructions: "Use the finance workflow.",
        updatedAt: new Date("2026-07-27T01:00:00.000Z"),
      }),
      iconObjectKey: `applications/${OWNER_ID}/icons/old.png`,
    };
    const transaction = {
      application: { updateMany: vi.fn(async () => ({ count: 1 })) },
      applicationGrant: { updateMany: vi.fn(async () => ({ count: 2 })) },
      $queryRaw: vi.fn(),
      applicationInstallation: { deleteMany: vi.fn() },
      applicationListing: { updateMany: vi.fn() },
      applicationRelease: { updateMany: vi.fn() },
      applicationExternalSession: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      applicationExternalAccess: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      applicationExternalRefreshToken: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      user: { updateMany: vi.fn(async () => ({ count: 0 })) },
    };
    const prisma = {
      application: { findFirst: vi.fn(async () => current) },
      $transaction: vi.fn(
        async (action: (tx: typeof transaction) => Promise<unknown>) =>
          action(transaction),
      ),
    };
    const audit = { write: vi.fn(async () => undefined) };
    const iconStore = {
      put: vi.fn(),
      remove: vi.fn(),
      presignGet: vi.fn(),
      enqueueRemoval: vi.fn(async () => undefined),
    };
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      audit as never,
      credentialResolver(),
      iconStore,
    );

    await service.delete(activeActor(), APPLICATION_ID, {});

    expect(transaction.application.updateMany).toHaveBeenCalledWith({
      where: {
        id: APPLICATION_ID,
        ownerId: OWNER_ID,
        status: { in: ["active", "disabled"] },
      },
      data: {
        status: "deleted",
        deletedAt: expect.any(Date),
        deletedBy: OWNER_ID,
        updatedAt: expect.any(Date),
      },
    });
    expect(transaction.applicationGrant.updateMany).toHaveBeenCalledWith({
      where: { applicationId: APPLICATION_ID, status: "active" },
      data: {
        status: "revoked",
        revokedBy: OWNER_ID,
        revokedAt: expect.any(Date),
        revocationReason: "application_deleted",
      },
    });
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "application_deleted",
        targetId: APPLICATION_ID,
      }),
    );
    expect(iconStore.enqueueRemoval).toHaveBeenCalledWith(
      `applications/${OWNER_ID}/icons/old.png`,
    );
  });
});

describe("ApplicationService task metadata", () => {
  it.each([
    { status: "active", dependencyMissing: false, available: true },
    { status: "disabled", dependencyMissing: false, available: false },
    { status: "active", dependencyMissing: true, available: false },
  ])("resolves access and availability for $status applications with missing dependency=$dependencyMissing", async ({ status, dependencyMissing, available }) => {
    const inaccessibleId = "20000000-0000-4000-8000-000000000099";
    const deletedId = "20000000-0000-4000-8000-000000000098";
    const row = {
      ...application({ model: "model-a", reasoningEffort: "medium", instructions: "", updatedAt: new Date("2026-07-27") }),
      kind: "standard", interactivePackageId: null, status,
      iconPreset: "book-open", iconObjectKey: `applications/${OWNER_ID}/icons/current.png`,
    };
    const prisma = {
      user: {
        findFirst: vi.fn(async () => ({ selfRegisteredAt: null })),
        findMany: vi.fn(async () => [{ id: OWNER_ID, name: "Owner" }]),
      },
      application: { findMany: vi.fn().mockResolvedValueOnce([{ id: APPLICATION_ID }]).mockResolvedValue([row]) },
      applicationListing: { findMany: vi.fn(async () => []) },
      applicationRelease: { findMany: vi.fn(async () => []) },
      userGroupMember: { findMany: vi.fn(async () => []) },
      applicationGrant: { findMany: vi.fn(async () => [
        { applicationId: deletedId, granteeType: "user" },
      ]) },
      applicationCapability: { findMany: vi.fn(async () => dependencyMissing ? [{
        applicationId: APPLICATION_ID, capabilityId: CAPABILITY_ID,
        capabilityNameSnapshot: "Skill", capabilityTypeSnapshot: "skill", createdAt: row.createdAt,
      }] : []) },
      applicationKnowledgeBase: { findMany: vi.fn(async () => []) },
      applicationMcpServer: { findMany: vi.fn(async () => []) },
      capability: { findMany: vi.fn(async () => []) },
      knowledgeBase: { findMany: vi.fn(async () => []) },
      mcpServer: { findMany: vi.fn(async () => []) },
    };
    const iconStore = {
      put: vi.fn(), remove: vi.fn(),
      presignGet: vi.fn(async (key: string) => `https://objects.example.test/${key}`),
    };
    const service = new ApplicationService(prisma as never, modelSettings(), { write: vi.fn() } as never, credentialResolver(), iconStore);
    const metadata = await service.resolveTaskMetadata(OWNER_ID, [APPLICATION_ID, inaccessibleId, deletedId, APPLICATION_ID]);
    expect([...metadata]).toEqual([[APPLICATION_ID, { icon: { type: "custom", url: `https://objects.example.test/${row.iconObjectKey}`, fallback_preset: "book-open" }, available, unavailable_reason: status === "disabled" ? "APPLICATION_DISABLED" : dependencyMissing ? "APPLICATION_DEPENDENCY_UNAVAILABLE" : null }]]);
    expect(iconStore.presignGet).toHaveBeenCalledWith(row.iconObjectKey, 5 * 60);
    expect(prisma.application.findMany).toHaveBeenNthCalledWith(3, {
      where: { id: { in: [APPLICATION_ID] }, status: { in: ["active", "disabled"] } },
    });
  });
});

describe("ApplicationService share targets", () => {
  it("blocks organization sharing for self-registered users", async () => {
    const prisma = {
      user: { findMany: vi.fn() },
      userGroup: { findMany: vi.fn() },
    };
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      service.searchShareTargets(
        {
          ...activeActor(),
          registrationSource: "self_registration",
        },
        { limit: 25 },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.userGroup.findMany).not.toHaveBeenCalled();
  });

  it("searches only user groups when a group target type is requested", async () => {
    const prisma = {
      user: {
        findMany: vi.fn(async () => [
          {
            id: RECIPIENT_ID,
            name: "Lin User",
            email: "lin@example.test",
          },
        ]),
      },
      userGroup: {
        findMany: vi.fn(async () => [
          {
            id: SHARE_TARGET_GROUP_ID,
            name: "Finance team",
            description: "Finance policy owners",
          },
        ]),
      },
    };
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    const result = await service.searchShareTargets(activeActor(), {
      type: "user_group",
      search: "finance",
      limit: 25,
    });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.userGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { name: { contains: "finance", mode: "insensitive" } },
            { description: { contains: "finance", mode: "insensitive" } },
          ],
        },
        take: 25,
      }),
    );
    expect(result).toEqual([
      {
        id: SHARE_TARGET_GROUP_ID,
        type: "user_group",
        name: "Finance team",
        secondary_text: "Finance policy owners",
      },
    ]);
  });
});

describe("ApplicationService runtime resolution", () => {
  it("does not grant self-registered users access to shared applications", async () => {
    const prisma = runtimePrisma({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use the workflow.",
      capabilityId: CAPABILITY_ID,
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      updatedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    prisma.user.findFirst.mockResolvedValue({
      id: RECIPIENT_ID,
      accountType: "member",
      selfRegisteredAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID),
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(prisma.userGroupMember.findMany).not.toHaveBeenCalled();
    expect(prisma.applicationGrant.findMany).not.toHaveBeenCalled();
  });

  it("keeps using the published release when only the application draft changes", async () => {
    const state = {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use the finance workflow.",
      capabilityId: CAPABILITY_ID,
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      updatedAt: new Date("2026-07-27T01:00:00.000Z"),
    };
    const modelResolution = vi.fn(async () => runtimeModel());
    const prisma = runtimePrisma(state);
    const service = new ApplicationService(
      prisma as never,
      modelSettings(modelResolution),
      { write: vi.fn(async () => undefined) } as never,
      credentialResolver(), undefined, undefined, new ApplicationPublicationService(prisma as never, "/unused"),
    );

    const first = await service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID);
    state.model = "gpt-5.6-sol";
    state.reasoningEffort = "high";
    state.instructions = "Use the updated research workflow.";
    state.capabilityId = NEXT_CAPABILITY_ID;
    state.knowledgeBaseId = NEXT_KNOWLEDGE_BASE_ID;
    state.updatedAt = new Date("2026-07-27T02:00:00.000Z");
    prisma.capability.findMany.mockResolvedValue([capability(CAPABILITY_ID), capability(NEXT_CAPABILITY_ID)]);
    prisma.knowledgeBase.findMany.mockResolvedValue([knowledgeBase(KNOWLEDGE_BASE_ID), knowledgeBase(NEXT_KNOWLEDGE_BASE_ID)]);
    const second = await service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID);

    expect(first).toMatchObject({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use the finance workflow.",
      capabilityIds: [CAPABILITY_ID],
      knowledgeBaseIds: [KNOWLEDGE_BASE_ID],
    });
    expect(second).toMatchObject({ ...first, applicationUpdatedAt: state.updatedAt });
    expect(modelResolution).toHaveBeenNthCalledWith(
      1,
      "gpt-5.6-terra",
      "medium",
    );
    expect(modelResolution).toHaveBeenNthCalledWith(2, "gpt-5.6-terra", "medium");
  });

  it("publishes edited draft instructions even when a prior release already exists", async () => {
    const state = { model: "gpt-5.6-terra", reasoningEffort: "medium", instructions: "Published release", capabilityId: CAPABILITY_ID, knowledgeBaseId: KNOWLEDGE_BASE_ID, updatedAt: new Date("2026-07-27T01:00:00.000Z") };
    const prisma = runtimePrisma(state);
    const publications = new ApplicationPublicationService(prisma as never, "/unused");
    const publish = vi.spyOn(publications, "capture").mockResolvedValue({ version_id: APPLICATION_ID, version_number: "2.0.0", usage_instructions: "Read the guide." });
    const service = new ApplicationService(prisma as never, modelSettings(), { write: vi.fn() } as never, credentialResolver(), undefined, undefined, publications);
    state.instructions = "Edited draft for the next release";
    const input = { version_number: "2.0.0", usage_instructions: "Read the guide." };
    await service.captureDistributionVersion(activeActor(), APPLICATION_ID, input, async () => {});
    expect(publish).toHaveBeenCalledWith(OWNER_ID, APPLICATION_ID, input, expect.objectContaining({ runtimeInstructions: state.instructions, complete: expect.any(Function) }));
    expect(prisma.applicationVersion.findFirst).not.toHaveBeenCalled();
  });

  it("loads a newly published release on the next execution without changing an admitted runtime", async () => {
    const prisma = runtimePrisma({ model: "gpt-5.6-terra", reasoningEffort: "medium", instructions: "Release one", capabilityId: CAPABILITY_ID, knowledgeBaseId: KNOWLEDGE_BASE_ID, updatedAt: new Date("2026-07-27T01:00:00Z") });
    const service = new ApplicationService(prisma as never, modelSettings(), { write: vi.fn() } as never, credentialResolver(), undefined, undefined, new ApplicationPublicationService(prisma as never, "/unused"));
    const first = await service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID);
    const application = await prisma.application.findFirst();
    const nextVersionId = "91000000-0000-4000-8000-000000000002";
    prisma.application.findFirst.mockResolvedValue({ ...application, publishedVersionId: nextVersionId });
    prisma.applicationVersion.findFirst.mockResolvedValue({ id: nextVersionId, assetsReady: true, definitionJson: { ...prisma.publishedDefinition, instructions: "Release two" } });
    const next = await service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID);
    expect(next).toMatchObject({ applicationVersionId: nextVersionId, instructions: "Release two" });
    expect(first.instructions).toBe("Release one");
    expect(prisma.applicationVersion.findFirst).toHaveBeenLastCalledWith({ where: { id: nextVersionId, applicationId: APPLICATION_ID, assetsReady: true } });
  });

  it("fails closed when the current user has no direct or group grant", async () => {
    const prisma = runtimePrisma({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use the workflow.",
      capabilityId: CAPABILITY_ID,
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      updatedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    prisma.applicationGrant.findMany.mockResolvedValue([]);
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID),
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(prisma.application.findFirst).not.toHaveBeenCalled();
  });

  it("resolves access through the recipient's current active user-group membership", async () => {
    const prisma = runtimePrisma({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use the workflow.",
      capabilityId: CAPABILITY_ID,
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      updatedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    const userGroupId = "50000000-0000-4000-8000-000000000001";
    prisma.userGroupMember.findMany.mockResolvedValue([{ userGroupId }]);
    prisma.applicationGrant.findMany.mockResolvedValue([
      {
        applicationId: APPLICATION_ID,
        granteeType: "user_group", usageModes: ["service"],
      },
    ]);
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(), undefined, undefined, new ApplicationPublicationService(prisma as never, "/unused"),
    );

    await expect(
      service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID),
    ).resolves.toMatchObject({ applicationId: APPLICATION_ID });
    expect(prisma.userGroupMember.findMany).toHaveBeenCalledWith({
      where: { userId: RECIPIENT_ID, status: "active" },
      select: { userGroupId: true },
    });
    expect(prisma.applicationGrant.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        OR: [
          { granteeType: "user", userId: RECIPIENT_ID },
          {
            granteeType: "user_group",
            userGroupId: { in: [userGroupId] },
          },
        ],
      },
      select: { applicationId: true, granteeType: true },
    });
  });

  it("keeps credential-requiring plugins available for application-scoped credential resolution", async () => {
    const prisma = runtimePrisma({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use the workflow.",
      capabilityId: CAPABILITY_ID,
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      updatedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    prisma.capability.findMany.mockResolvedValue([
      capability(CAPABILITY_ID, {
        type: "plugin",
        riskSummaryJson: {
          requires_credentials: true,
          declared_environment_keys: ["API_KEY"],
        },
      }),
    ]);
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(), undefined, undefined, new ApplicationPublicationService(prisma as never, "/unused"),
    );

    await expect(
      service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID),
    ).resolves.toMatchObject({
      applicationId: APPLICATION_ID,
      capabilityIds: [CAPABILITY_ID],
    });
  });

  it("resolves only the MCP servers explicitly bound to the application", async () => {
    const prisma = runtimePrisma({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Use the workflow.",
      capabilityId: CAPABILITY_ID,
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      updatedAt: new Date("2026-07-27T01:00:00.000Z"),
    });
    prisma.applicationMcpServer.findMany.mockResolvedValue([
      { mcpServerId: MCP_SERVER_ID },
    ]);
    prisma.mcpServer.findMany.mockResolvedValue([
      {
        id: MCP_SERVER_ID,
        ownerId: OWNER_ID,
        name: "Partner operations",
        status: "active",
      },
    ]);
    prisma.publishedDefinition.mcpServerIds = [MCP_SERVER_ID];
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(), undefined, undefined, new ApplicationPublicationService(prisma as never, "/unused"),
    );

    await expect(
      service.resolveRuntime(RECIPIENT_ID, APPLICATION_ID),
    ).resolves.toMatchObject({ mcpServerIds: [MCP_SERVER_ID] });
  });
});

describe("ApplicationService recipient projection", () => {
  it("runs the published page for both author and recipient and denies unpublished recipient previews", async () => {
    const versionId = "91000000-0000-4000-8000-000000000001";
    const publishedPackage = "92000000-0000-4000-8000-000000000001";
    const draftPackage = "92000000-0000-4000-8000-000000000002";
    const current = { ...application({ model: "gpt-5.6-terra", reasoningEffort: "medium", instructions: "Draft", updatedAt: new Date() }),
      kind: "interactive", interactivePackageId: draftPackage, publishedVersionId: versionId };
    const definition = { schemaVersion: 1, name: "Page", kind: "interactive", instructions: "Published page instructions", usageInstructions: "Open the page.",
      model: null, reasoningEffort: null, interactivePackageId: publishedPackage, capabilities: [], knowledgeBaseIds: [], mcpServerIds: [] };
    const prisma = {
      user: { findFirst: vi.fn(async () => ({ id: OWNER_ID, selfRegisteredAt: null })) },
      userGroupMember: { findMany: vi.fn(async () => []) },
      applicationGrant: { findMany: vi.fn(async () => []) },
      application: { findMany: vi.fn(async () => [{ id: APPLICATION_ID }]), findFirst: vi.fn(async () => current) },
      applicationVersion: { findFirst: vi.fn(async ({ where }: { where: { definitionJson?: { equals: string } } }) =>
        !where.definitionJson || where.definitionJson.equals === publishedPackage ? { id: versionId, assetsReady: true, definitionJson: definition } : null) },
      capability: { findMany: vi.fn(async () => []) }, knowledgeBase: { findMany: vi.fn(async () => []) }, mcpServer: { findMany: vi.fn(async () => []) },
      interactiveApplicationPackage: { findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, manifestJson: { schema_version: 1, id: "page", name: "Page", version: "1.0.0", sdk_version: 1 } })) },
    };
    const service = new ApplicationService(prisma as never, modelSettings(), { write: vi.fn() } as never, credentialResolver(), undefined, undefined, new ApplicationPublicationService(prisma as never, "/unused-test-store"));
    for (const actorId of [OWNER_ID, RECIPIENT_ID]) {
      expect(await service.resolveRuntime(actorId, APPLICATION_ID)).toMatchObject({ interactivePackageId: publishedPackage, instructions: definition.instructions });
      expect(await service.resolveInteractiveRuntimePackage({ id: actorId, role: "user", status: "active", ipAddress: "192.0.2.1" }, APPLICATION_ID)).toMatchObject({ id: publishedPackage });
    }
    await expect(service.resolveInteractiveRuntimePackage({ id: RECIPIENT_ID, role: "user", status: "active", ipAddress: "192.0.2.1" }, APPLICATION_ID, draftPackage)).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    await expect(service.resolveInteractiveRuntimePackage({ id: OWNER_ID, role: "user", status: "active", ipAddress: "192.0.2.1" }, APPLICATION_ID, draftPackage)).resolves.toMatchObject({ id: draftPackage });
  });

  it("uses the creator's plugin binding status without disclosing private inventory", async () => {
    const createdAt = new Date("2026-07-27T00:00:00.000Z");
    const app = application({
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
      instructions: "Private application instructions.",
      updatedAt: createdAt,
    });
    Object.assign(app, { publishedVersionId: APPLICATION_ID });
    const publishedDefinition = { schemaVersion: 1, name: app.name, kind: "standard", instructions: app.instructions,
      usageInstructions: "Use the application service.", model: app.model, reasoningEffort: app.reasoningEffort, interactivePackageId: null,
      capabilities: [{ id: CAPABILITY_ID, type: "plugin", name: "private-plugin", description: "Private workflow metadata", sourceType: "local", storagePath: "published/plugin", revision: createdAt.toISOString(), contentSha256: "a".repeat(64), manifestJson: null, riskSummaryJson: { requires_credentials: true, declared_environment_keys: ["API_KEY"] } }],
      knowledgeBaseIds: [KNOWLEDGE_BASE_ID], mcpServerIds: [],
    };
    const prisma = {
      applicationVersion: { findMany: vi.fn(async () => [{ id: APPLICATION_ID, definitionJson: publishedDefinition }]) },
      user: {
        findMany: vi.fn(async () => [{ id: OWNER_ID, name: "Owner" }]),
      },
      userGroupMember: { findMany: vi.fn(async () => []) },
      applicationGrant: {
        findMany: vi.fn(async () => [
          { applicationId: APPLICATION_ID, granteeType: "user" },
        ]),
      },
      application: {
        findMany: vi.fn(async (): Promise<ReturnType<typeof application>[]> => []),
        findFirst: vi.fn(async () => app),
      },
      applicationCapability: {
        findMany: vi.fn(async () => [
          {
            applicationId: APPLICATION_ID,
            capabilityId: CAPABILITY_ID,
            capabilityNameSnapshot: "private-plugin",
            capabilityTypeSnapshot: "plugin",
            selectionOrder: 0,
            createdAt,
          },
        ]),
      },
      applicationKnowledgeBase: {
        findMany: vi.fn(async () => [
          {
            applicationId: APPLICATION_ID,
            knowledgeBaseId: KNOWLEDGE_BASE_ID,
            knowledgeBaseNameSnapshot: "Private handbook",
            selectionOrder: 0,
            createdAt,
          },
        ]),
      },
      applicationMcpServer: { findMany: vi.fn(async () => []) },
      capability: {
        findMany: vi.fn(async () => [
          {
            ...capability(CAPABILITY_ID),
            type: "plugin",
            description: "Private workflow metadata",
            riskSummaryJson: {
              requires_credentials: true,
              declared_environment_keys: ["API_KEY"],
            },
            updatedAt: createdAt,
          },
        ]),
      },
      knowledgeBase: {
        findMany: vi.fn(async () => [
          { ...knowledgeBase(KNOWLEDGE_BASE_ID), updatedAt: createdAt },
        ]),
      },
      mcpServer: { findMany: vi.fn(async () => []) },
    };
    const credentials = credentialResolver();
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentials,
    );

    const result = await service.get(
      {
        id: RECIPIENT_ID,
        role: "user",
        status: "active",
        ipAddress: "192.0.2.1",
      },
      APPLICATION_ID,
    );

    expect(result).toMatchObject({
      instructions: null,
      capability_count: 1,
      knowledge_base_count: 1,
      dependencies_available: true,
      capabilities: [],
      knowledge_bases: [],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CAPABILITY_ID);
    expect(serialized).not.toContain(KNOWLEDGE_BASE_ID);
    expect(serialized).not.toContain("Private handbook");
    expect(serialized).not.toContain("Private application instructions");
    expect(credentials.resolveForCapability).toHaveBeenCalledWith(
      OWNER_ID,
      CAPABILITY_ID,
      ["API_KEY"],
    );

    credentials.resolveForCapability.mockResolvedValueOnce({
      ok: false,
      blockCode: "required_credential_unavailable",
    });
    await expect(
      service.get(
        {
          id: RECIPIENT_ID,
          role: "user",
          status: "active",
          ipAddress: "192.0.2.1",
        },
        APPLICATION_ID,
      ),
    ).resolves.toMatchObject({ dependencies_available: false });

    prisma.application.findMany.mockResolvedValue([app]);
    prisma.applicationGrant.findMany.mockResolvedValue([]);
    prisma.applicationKnowledgeBase.findMany.mockResolvedValueOnce([{
      applicationId: APPLICATION_ID, knowledgeBaseId: NEXT_KNOWLEDGE_BASE_ID,
      knowledgeBaseNameSnapshot: "Unconfigured draft dependency", selectionOrder: 0, createdAt,
    }]);
    await expect(service.get({ id: OWNER_ID, role: "user", status: "active", ipAddress: "192.0.2.1" }, APPLICATION_ID)).resolves.toMatchObject({
      dependencies_available: true, is_owner: true,
      knowledge_bases: [expect.objectContaining({ id: NEXT_KNOWLEDGE_BASE_ID, available: false })],
    });
  });
});

describe("ApplicationService turn-scoped knowledge access", () => {
  it("keeps the turn-start knowledge snapshot after the application is edited", async () => {
    const prisma = turnKnowledgePrisma({ granted: true });
    const service = new ApplicationService(
      prisma as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      service.resolveUsableKnowledgeBaseIdsForTurn(
        RECIPIENT_ID,
        { turnId: "50000000-0000-4000-8000-000000000001" },
        [KNOWLEDGE_BASE_ID, NEXT_KNOWLEDGE_BASE_ID],
      ),
    ).resolves.toEqual([KNOWLEDGE_BASE_ID]);
    expect("applicationCapability" in prisma).toBe(false);
    expect("applicationKnowledgeBase" in prisma).toBe(false);
  });

  it("fails closed when application sharing is revoked during a turn", async () => {
    const service = new ApplicationService(
      turnKnowledgePrisma({ granted: false }) as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      service.resolveUsableKnowledgeBaseIdsForTurn(
        RECIPIENT_ID,
        { turnId: "50000000-0000-4000-8000-000000000001" },
        [KNOWLEDGE_BASE_ID],
      ),
    ).resolves.toEqual([]);
  });

  it("fails closed when the application is disabled during a turn", async () => {
    const service = new ApplicationService(
      turnKnowledgePrisma({ granted: true, applicationActive: false }) as never,
      modelSettings(),
      { write: vi.fn() } as never,
      credentialResolver(),
    );

    await expect(
      service.resolveUsableKnowledgeBaseIdsForTurn(
        RECIPIENT_ID,
        { turnId: "50000000-0000-4000-8000-000000000001" },
        [KNOWLEDGE_BASE_ID],
      ),
    ).resolves.toEqual([]);
  });
});

function runtimePrisma(state: {
  model: string;
  reasoningEffort: string;
  instructions: string;
  capabilityId: string;
  knowledgeBaseId: string;
  updatedAt: Date;
}) {
  const versionId = "91000000-0000-4000-8000-000000000001";
  const publishedDefinition = {
    schemaVersion: 1, name: "Finance assistant", kind: "standard", instructions: state.instructions,
    usageInstructions: "Read the guide.", model: state.model, reasoningEffort: state.reasoningEffort,
    interactivePackageId: null,
    capabilities: [{ id: state.capabilityId, type: "skill", name: "finance-research", description: null,
      sourceType: "local", storagePath: "published/skill", revision: state.updatedAt.toISOString(),
      contentSha256: "a".repeat(64), manifestJson: null, riskSummaryJson: null }],
    knowledgeBaseIds: [state.knowledgeBaseId], mcpServerIds: [] as string[],
  };
  return {
    publishedDefinition,
    applicationListing: { findUnique: vi.fn(async () => null) },
    applicationVersion: { findFirst: vi.fn(async () => ({ id: versionId, assetsReady: true, definitionJson: publishedDefinition })) },
    user: {
      findFirst: vi.fn(
        async (): Promise<{
          id: string;
          accountType?: string;
          selfRegisteredAt?: Date | null;
        }> => ({ id: RECIPIENT_ID, selfRegisteredAt: null }),
      ),
    },
    userGroupMember: {
      findMany: vi.fn(async () => [] as Array<{ userGroupId: string }>),
    },
    applicationGrant: {
      findMany: vi.fn(async () => [
        {
          applicationId: APPLICATION_ID,
          granteeType: "user", usageModes: ["service"],
        },
      ]),
    },
    application: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({ ...application(state), publishedVersionId: versionId })),
    },
    applicationCapability: {
      findMany: vi.fn(async () => [
        {
          applicationId: APPLICATION_ID,
          capabilityId: state.capabilityId,
          selectionOrder: 0,
        },
      ]),
    },
    applicationKnowledgeBase: {
      findMany: vi.fn(async () => [
        {
          applicationId: APPLICATION_ID,
          knowledgeBaseId: state.knowledgeBaseId,
          selectionOrder: 0,
        },
      ]),
    },
    applicationMcpServer: {
      findMany: vi.fn(async () => [] as Array<{ mcpServerId: string }>),
    },
    capability: {
      findMany: vi.fn(async () => [capability(state.capabilityId)]),
    },
    knowledgeBase: {
      findMany: vi.fn(async () => [knowledgeBase(state.knowledgeBaseId)]),
    },
    mcpServer: {
      findMany: vi.fn(
        async () =>
          [] as Array<{
            id: string;
            ownerId: string;
            name: string;
            status: string;
          }>,
      ),
    },
  };
}

function turnKnowledgePrisma({
  granted,
  applicationActive = true,
}: {
  granted: boolean;
  applicationActive?: boolean;
}) {
  const conversationId = "60000000-0000-4000-8000-000000000001";
  return {
    conversationTurn: {
      findUnique: vi.fn(async () => ({
        conversationId,
        knowledgeBaseIdsJson: [KNOWLEDGE_BASE_ID],
      })),
    },
    conversationTurnStartIntent: {
      findUnique: vi.fn(async () => null),
    },
    conversation: {
      findFirst: vi.fn(async () => ({ applicationId: APPLICATION_ID })),
    },
    user: {
      findFirst: vi.fn(async () => ({ id: RECIPIENT_ID, selfRegisteredAt: null })),
    },
    applicationListing: { findUnique: vi.fn(async () => null) },
    userGroupMember: {
      findMany: vi.fn(async () => []),
    },
    applicationGrant: {
      findMany: vi.fn(async () =>
        granted ? [{ applicationId: APPLICATION_ID, granteeType: "user", usageModes: ["service"] }] : [],
      ),
    },
    application: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () =>
        applicationActive ? { id: APPLICATION_ID, ownerId: OWNER_ID, status: "active", publishedVersionId: APPLICATION_ID } : null,
      ),
    },
  };
}

function application(state: {
  model: string;
  reasoningEffort: string;
  instructions: string;
  updatedAt: Date;
}) {
  return {
    id: APPLICATION_ID,
    ownerId: OWNER_ID,
    name: "Finance assistant",
    description: null,
    iconPreset: "bot",
    iconObjectKey: null,
    instructions: state.instructions,
    model: state.model,
    reasoningEffort: state.reasoningEffort,
    status: "active",
    deletedAt: null,
    deletedBy: null,
    createdAt: new Date("2026-07-27T00:00:00.000Z"),
    updatedAt: state.updatedAt,
  };
}

function capability(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ownerId: OWNER_ID,
    type: "skill",
    name: "finance-research",
    description: null,
    status: "active",
    riskSummaryJson: null,
    updatedAt: new Date("2026-07-27T00:00:00.000Z"),
    ...overrides,
  };
}

function knowledgeBase(id: string) {
  return {
    id,
    ownerId: OWNER_ID,
    name: "Finance handbook",
    lifecycleStatus: "active",
    availabilityStatus: "enabled",
    updatedAt: new Date("2026-07-27T00:00:00.000Z"),
  };
}

function activeActor() {
  return {
    id: OWNER_ID,
    role: "user" as const,
    status: "active" as const,
    ipAddress: "192.0.2.1",
  };
}

function runtimeModel() {
  return {
    model: "unused",
    reasoningEffort: "medium" as const,
    provider: {
      revision: 1,
      baseUrl: "https://example.test/v1",
      protocolMode: "native_responses" as const,
      apiKey: "secret",
    },
  };
}
