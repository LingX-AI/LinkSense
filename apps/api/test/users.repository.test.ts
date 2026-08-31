import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaUserRepository } from "../src/modules/users/repository.js";

const NOW = new Date("2026-07-11T08:00:00.000Z");
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

describe("PrismaUserRepository administrator lifecycle", () => {
  it("filters paginated users to self-registered active members of the requested group", async () => {
    const groupId = "00000000-0000-4000-8000-000000000020";
    const member = persistedUser({
      id: "00000000-0000-4000-8000-000000000021",
    });
    const membershipFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ userId: member.id }])
      .mockResolvedValueOnce([]);
    const userFindMany = vi.fn(async () => [member]);
    const repository = new PrismaUserRepository({
      user: { findMany: userFindMany },
      userGroupMember: { findMany: membershipFindMany },
      userGroup: { findMany: vi.fn(async () => []) },
      capability: { findMany: vi.fn(async () => []) },
      credential: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient);

    await expect(
      repository.listUsers({
        userGroupId: groupId,
        registrationSource: "self_registration",
        limit: 100,
      }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ id: member.id })],
      nextCursor: null,
    });
    expect(membershipFindMany.mock.calls[0]?.[0]).toEqual({
      where: { userGroupId: groupId, status: "active" },
      select: { userId: true },
    });
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountType: "member",
          id: { in: [member.id] },
          selfRegisteredAt: { not: null },
        },
        take: 101,
      }),
    );
  });

  it("filters organization-invited users by a missing self-registration timestamp", async () => {
    const member = persistedUser({
      id: "00000000-0000-4000-8000-000000000022",
      selfRegisteredAt: null,
    });
    const userFindMany = vi.fn(async () => [member]);
    const repository = new PrismaUserRepository({
      user: { findMany: userFindMany },
      userGroupMember: { findMany: vi.fn(async () => []) },
      userGroup: { findMany: vi.fn(async () => []) },
      capability: { findMany: vi.fn(async () => []) },
      credential: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient);

    await repository.listUsers({
      registrationSource: "organization_invitation",
      limit: 100,
    });

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          accountType: "member",
          selfRegisteredAt: null,
        },
      }),
    );
  });

  it("persists the account language preference in the user row", async () => {
    const updatedUser = persistedUser({
      id: ACTOR_ID,
      preferredLocale: "en-US",
      updatedAt: NOW,
    });
    const transaction = baseTransaction();
    transaction.user.findUnique.mockResolvedValueOnce(updatedUser);
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await expect(
      repository.updateOwnProfile({
        userId: ACTOR_ID,
        preferredLocale: "en-US",
        now: NOW,
        audit: {},
      }),
    ).resolves.toMatchObject({ preferredLocale: "en-US" });

    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: { id: ACTOR_ID, status: "active" },
      data: { preferredLocale: "en-US", updatedAt: NOW },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user_profile_updated",
        metadataJson: expect.objectContaining({ locale_changed: true }),
      }),
    });
  });

  it("returns exact fixed-role active, disabled, and total account counts", async () => {
    const count = vi
      .fn()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    const repository = new PrismaUserRepository({
      user: { count },
    } as unknown as PrismaClient);

    await expect(repository.roleSummary()).resolves.toEqual([
      { role: "user", active_count: 7, disabled_count: 2, total_count: 9 },
      { role: "admin", active_count: 3, disabled_count: 1, total_count: 4 },
    ]);
    expect(count.mock.calls).toEqual([
      [{ where: { role: "user", status: "active" } }],
      [{ where: { role: "user", status: "disabled" } }],
      [{ where: { role: "admin", status: "active" } }],
      [{ where: { role: "admin", status: "disabled" } }],
    ]);
  });

  it("bulk-updates user token limits without touching authentication fields", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const targetIds = [
      "00000000-0000-4000-8000-000000000010",
      "00000000-0000-4000-8000-000000000011",
    ];
    const transaction = baseTransaction();
    transaction.user.findUnique.mockResolvedValueOnce(actor);
    transaction.user.count.mockResolvedValueOnce(2);
    transaction.user.findMany.mockResolvedValueOnce(
      targetIds.map((id) => persistedUser({ id, monthlyTokenLimit: 100_000n })),
    );
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await expect(
      repository.updateUserTokenLimits({
        actorId: actor.id,
        targetUserIds: targetIds,
        totalTokenLimit: 500_000n,
        weeklyTokenLimit: null,
        monthlyTokenLimit: 100_000n,
        now: NOW,
        audit: {},
      }),
    ).resolves.toHaveLength(2);

    expect(transaction.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: targetIds } },
      data: {
        totalTokenLimit: 500_000n,
        weeklyTokenLimit: null,
        monthlyTokenLimit: 100_000n,
        updatedAt: NOW,
      },
    });
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "users_token_limits_updated",
        metadataJson: {
          user_count: 2,
          total_token_limit_changed: true,
          weekly_token_limit_changed: true,
          monthly_token_limit_changed: true,
        },
      }),
    });
  });

  it("rejects self-disable before counting admins and commits a stable rejection audit", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const transaction = baseTransaction();
    transaction.user.findUnique.mockResolvedValue(actor);
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    const result = await repository.updateUser({
      actorId: ACTOR_ID,
      targetUserId: ACTOR_ID,
      status: "disabled",
      now: NOW,
      audit: {},
    });

    expect(result).toEqual({
      status: "rejected",
      errorCode: "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN",
    });
    expect(transaction.user.count).not.toHaveBeenCalled();
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user_admin_self_change_rejected",
        result: "rejected",
        metadataJson: expect.objectContaining({
          error_code: "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN",
        }),
      }),
    });
  });

  it("serializes and rejects removing the last active administrator without rolling back its audit", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const target = persistedUser({
      id: "00000000-0000-4000-8000-000000000002",
      role: "admin",
      status: "active",
    });
    const transaction = baseTransaction();
    transaction.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(target);
    transaction.user.count.mockResolvedValueOnce(1);
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    const result = await repository.updateUser({
      actorId: actor.id,
      targetUserId: target.id,
      role: "user",
      now: NOW,
      audit: {},
    });

    expect(result).toEqual({
      status: "rejected",
      errorCode: "LAST_ENABLED_ADMIN_REQUIRED",
    });
    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(3);
    expect(transaction.user.update).not.toHaveBeenCalled();
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "user_last_enabled_admin_change_rejected",
        result: "rejected",
        metadataJson: expect.objectContaining({
          active_administrator_count: 1,
          error_code: "LAST_ENABLED_ADMIN_REQUIRED",
        }),
      }),
    });
  });

  it("disables a user atomically, invalidates auth, cancels pending requests, and restores their attachments to draft", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const target = persistedUser({
      id: "00000000-0000-4000-8000-000000000010",
      role: "user",
      status: "active",
    });
    const disabled = {
      ...target,
      status: "disabled",
      authValidAfter: NOW,
      updatedAt: NOW,
    };
    const conversationId = "00000000-0000-4000-8000-000000000020";
    const pending = [
      pendingRequest(
        "00000000-0000-4000-8000-000000000021",
        conversationId,
        1n,
      ),
      pendingRequest(
        "00000000-0000-4000-8000-000000000022",
        conversationId,
        2n,
      ),
    ];
    const transaction = baseTransaction();
    transaction.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(target);
    transaction.user.update.mockResolvedValueOnce(disabled);
    transaction.conversation.findMany.mockResolvedValueOnce([
      { id: conversationId },
    ]);
    transaction.pendingRequest.findMany.mockResolvedValueOnce(pending);
    transaction.conversationDraft.upsert.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000030",
      conversationId,
      ownerId: target.id,
      inputText: "",
      priorityCapabilityIdsJson: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    const result = await repository.updateUser({
      actorId: actor.id,
      targetUserId: target.id,
      status: "disabled",
      now: NOW,
      audit: { ipAddress: "192.0.2.1", userAgent: "Vitest" },
    });

    expect(result.status).toBe("updated");
    expect(transaction.user.update).toHaveBeenCalledWith({
      where: { id: target.id },
      data: expect.objectContaining({
        status: "disabled",
        authValidAfter: NOW,
      }),
    });
    expect(transaction.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: target.id, revokedAt: null },
      data: { revokedAt: NOW, revokeReason: "user_changed" },
    });
    expect(transaction.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: target.id, consumedAt: null },
      data: { consumedAt: NOW },
    });
    expect(transaction.conversationFile.updateMany).toHaveBeenCalledWith({
      where: {
        pendingRequestId: { in: pending.map((request) => request.id) },
        turnId: null,
      },
      data: expect.objectContaining({
        pendingRequestId: null,
        draftId: "00000000-0000-4000-8000-000000000030",
        status: "draft",
      }),
    });
    expect(transaction.pendingRequest.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: pending.map((request) => request.id) } },
    });
    const pendingAudits = transaction.auditLog.create.mock.calls.filter(
      ([input]) =>
        input.data.action ===
        "conversation_pending_request_cancelled_user_disabled",
    );
    expect(pendingAudits).toHaveLength(2);
    expect(JSON.stringify(pendingAudits)).not.toContain("request body");
    expect(transaction).not.toHaveProperty("runner");
    expect(transaction).not.toHaveProperty("conversationTurn");
  });

  it("leaves a pending request protected by a durable turn-start intent for recovery while disabling its owner", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const target = persistedUser({
      id: "00000000-0000-4000-8000-000000000010",
      role: "user",
      status: "active",
    });
    const disabled = {
      ...target,
      status: "disabled",
      authValidAfter: NOW,
      updatedAt: NOW,
    };
    const conversationId = "00000000-0000-4000-8000-000000000020";
    const protectedPending = pendingRequest(
      "00000000-0000-4000-8000-000000000021",
      conversationId,
      1n,
    );
    const cancellablePending = pendingRequest(
      "00000000-0000-4000-8000-000000000022",
      conversationId,
      2n,
    );
    const transaction = baseTransaction();
    transaction.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(target);
    transaction.user.update.mockResolvedValueOnce(disabled);
    transaction.conversation.findMany.mockResolvedValueOnce([
      { id: conversationId },
    ]);
    transaction.conversationTurnStartIntent.findMany.mockResolvedValueOnce([
      { pendingRequestId: protectedPending.id },
    ]);
    transaction.pendingRequest.findMany.mockResolvedValueOnce([
      protectedPending,
      cancellablePending,
    ]);
    transaction.conversationDraft.upsert.mockResolvedValueOnce({
      id: "00000000-0000-4000-8000-000000000030",
      conversationId,
      ownerId: target.id,
      inputText: "",
      priorityCapabilityIdsJson: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await expect(
      repository.updateUser({
        actorId: actor.id,
        targetUserId: target.id,
        status: "disabled",
        now: NOW,
        audit: {},
      }),
    ).resolves.toMatchObject({ status: "updated" });

    expect(transaction.conversationFile.updateMany).toHaveBeenCalledWith({
      where: {
        pendingRequestId: { in: [cancellablePending.id] },
        turnId: null,
      },
      data: expect.objectContaining({
        pendingRequestId: null,
        draftId: "00000000-0000-4000-8000-000000000030",
        status: "draft",
      }),
    });
    expect(transaction.pendingRequest.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [cancellablePending.id] } },
    });
    expect(
      JSON.stringify(transaction.conversationFile.updateMany.mock.calls),
    ).not.toContain(protectedPending.id);
    expect(
      JSON.stringify(transaction.pendingRequest.deleteMany.mock.calls),
    ).not.toContain(protectedPending.id);
  });

  it("audits an administrator email change with irreversible address summaries and invalidation results only", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const target = persistedUser({
      id: "00000000-0000-4000-8000-000000000010",
      email: "old.member@example.test",
    });
    const updated = {
      ...target,
      email: "new.member@example.test",
      authValidAfter: NOW,
      updatedAt: NOW,
    };
    const transaction = baseTransaction();
    transaction.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(target);
    transaction.user.findFirst.mockResolvedValueOnce(null);
    transaction.user.update.mockResolvedValueOnce(updated);
    transaction.refreshToken.updateMany.mockResolvedValueOnce({ count: 4 });
    transaction.passwordResetToken.updateMany.mockResolvedValueOnce({
      count: 3,
    });
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    const result = await repository.updateUser({
      actorId: actor.id,
      targetUserId: target.id,
      email: updated.email,
      now: NOW,
      audit: { ipAddress: "192.0.2.9", userAgent: "Admin Browser" },
    });

    expect(result.status).toBe("updated");
    const emailAudit = transaction.auditLog.create.mock.calls.find(
      ([input]) => input.data.action === "user_email_changed",
    )?.[0];
    expect(emailAudit).toBeDefined();
    expect(emailAudit?.data.metadataJson).toEqual(
      expect.objectContaining({
        authentication_invalidated: true,
        session_revoked_count: 4,
        reset_link_invalidated_count: 3,
        previous_address_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        new_address_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    const serialized = JSON.stringify(emailAudit);
    expect(serialized).not.toContain(target.email);
    expect(serialized).not.toContain(updated.email);
    expect(serialized).not.toContain("refreshToken");
    expect(serialized).not.toContain("passwordResetToken");
  });

  it("locks create-user group parents before inserting memberships", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const created = persistedUser({
      id: "00000000-0000-4000-8000-000000000041",
      email: "created@example.com",
    });
    const groupId = "00000000-0000-4000-8000-000000000042";
    const transaction = baseTransaction();
    transaction.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(null);
    transaction.user.create.mockResolvedValueOnce(created);
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await repository.createUser({
      id: created.id,
      email: created.email,
      name: created.name,
      role: "user",
      userGroupIds: [groupId],
      weeklyTokenLimit: 25_000n,
      monthlyTokenLimit: 100_000n,
      actorId: actor.id,
      now: NOW,
      audit: {},
    });

    expect(transaction.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          weeklyTokenLimit: 25_000n,
          monthlyTokenLimit: 100_000n,
        }),
      }),
    );
    expectGroupKeyShareBeforeMembershipInsert(transaction, groupId);
  });

  it("locks update-user group parents before reconciling memberships", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const target = persistedUser({
      id: "00000000-0000-4000-8000-000000000043",
    });
    const groupId = "00000000-0000-4000-8000-000000000044";
    const transaction = baseTransaction();
    transaction.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(target);
    transaction.user.update.mockResolvedValueOnce(target);
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await repository.updateUser({
      targetUserId: target.id,
      actorId: actor.id,
      userGroupIds: [groupId],
      now: NOW,
      audit: {},
    });

    expectGroupKeyShareBeforeMembershipInsert(transaction, groupId);
  });

  it("locks imported-user group parents before inserting memberships", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const created = persistedUser({
      id: "00000000-0000-4000-8000-000000000045",
      email: "imported@example.com",
    });
    const group = {
      id: "00000000-0000-4000-8000-000000000046",
      name: "Imported Group",
    };
    const transaction = baseTransaction();
    transaction.user.findUnique.mockResolvedValueOnce(actor);
    transaction.user.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created]);
    transaction.userGroup.findMany.mockResolvedValueOnce([group]);
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await repository.importUsers({
      rows: [
        {
          rowNumber: 2,
          id: created.id,
          email: created.email,
          name: created.name,
          role: "user",
          userGroupNames: [group.name],
        },
      ],
      weeklyTokenLimit: 30_000n,
      monthlyTokenLimit: 120_000n,
      actorId: actor.id,
      now: NOW,
      audit: {},
    });

    expect(transaction.user.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            weeklyTokenLimit: 30_000n,
            monthlyTokenLimit: 120_000n,
          }),
        ],
      }),
    );
    expectGroupKeyShareBeforeMembershipInsert(transaction, group.id);
  });

  it("rejects a membership insert when the group row disappeared before the key-share lock", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const groupId = "00000000-0000-4000-8000-000000000047";
    const transaction = baseTransaction();
    transaction.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce(null);
    transaction.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const parts = args[0];
      if (
        Array.isArray(parts) &&
        parts.join(" ").includes("FROM user_groups")
      ) {
        return [];
      }
      return [];
    });
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await expect(
      repository.createUser({
        id: "00000000-0000-4000-8000-000000000048",
        email: "orphan@example.com",
        name: "Orphan",
        role: "user",
        userGroupIds: [groupId],
        weeklyTokenLimit: null,
        monthlyTokenLimit: null,
        actorId: actor.id,
        now: NOW,
        audit: {},
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(transaction.user.create).not.toHaveBeenCalled();
    expect(transaction.userGroupMember.createMany).not.toHaveBeenCalled();
  });

  it("hard-deletes group knowledge-base grants in the parent deletion transaction and audits only counts", async () => {
    const actor = persistedUser({
      id: ACTOR_ID,
      role: "admin",
      status: "active",
    });
    const group = {
      id: "00000000-0000-4000-8000-000000000040",
      name: "Sensitive Group Name",
      description: "must not enter the deletion audit",
      createdBy: actor.id,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const transaction = baseTransaction();
    transaction.user.findUnique.mockResolvedValueOnce(actor);
    transaction.userGroup.findUnique.mockResolvedValueOnce(group);
    transaction.userGroupMember.deleteMany.mockResolvedValueOnce({ count: 3 });
    transaction.knowledgeBaseGrant.deleteMany.mockResolvedValueOnce({
      count: 5,
    });
    const repository = new PrismaUserRepository(
      prismaWithTransaction(transaction),
    );

    await expect(
      repository.deleteGroup({
        id: group.id,
        actorId: actor.id,
        now: NOW,
        audit: { ipAddress: "192.0.2.20", userAgent: "Admin Browser" },
      }),
    ).resolves.toBe(true);

    expect(transaction.knowledgeBaseGrant.deleteMany).toHaveBeenCalledWith({
      where: {
        granteeType: "user_group",
        userGroupId: group.id,
      },
    });
    const groupLock = transaction.$queryRaw.mock.calls.find(
      ([parts, value]) =>
        Array.isArray(parts) &&
        parts.join(" ").includes("FROM user_groups") &&
        value === group.id,
    );
    expect(groupLock).toBeDefined();
    expect(transaction.userGroup.delete).toHaveBeenCalledWith({
      where: { id: group.id },
    });
    const audit = transaction.auditLog.create.mock.calls.find(
      ([input]) => input.data.action === "user_group_deleted",
    )?.[0];
    expect(audit).toEqual({
      data: expect.objectContaining({
        targetId: group.id,
        ipAddress: "192.0.2.20",
        userAgent: "Admin Browser",
        metadataJson: {
          member_record_count: 3,
          knowledge_base_grant_record_count: 5,
        },
      }),
    });
    expect(JSON.stringify(audit)).not.toContain(group.name);
    expect(JSON.stringify(audit)).not.toContain(group.description);
  });
});

function expectGroupKeyShareBeforeMembershipInsert(
  transaction: ReturnType<typeof baseTransaction>,
  groupId: string,
): void {
  const lockCallIndex = transaction.$queryRaw.mock.calls.findIndex(
    ([parts, value]) =>
      Array.isArray(parts) &&
      parts.join(" ").includes("FROM user_groups") &&
      parts.join(" ").includes("FOR KEY SHARE") &&
      value === groupId,
  );
  expect(lockCallIndex).toBeGreaterThanOrEqual(0);
  const lockOrder =
    transaction.$queryRaw.mock.invocationCallOrder[lockCallIndex];
  const insertOrder =
    transaction.userGroupMember.createMany.mock.invocationCallOrder[0];
  if (lockOrder === undefined || insertOrder === undefined) {
    throw new Error("Expected group lock and membership insert calls");
  }
  expect(lockOrder).toBeLessThan(insertOrder);
}

function baseTransaction() {
  return {
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(
      async (...args: unknown[]): Promise<Array<{ id: string }>> => {
        const id = args[1];
        return typeof id === "string" ? [{ id }] : [];
      },
    ),
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
      count: vi.fn(async () => 2),
      create: vi.fn(),
      createMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    refreshToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
    passwordResetToken: { updateMany: vi.fn(async () => ({ count: 1 })) },
    conversation: {
      findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
    },
    pendingRequest: {
      findMany: vi.fn(
        async (): Promise<Array<ReturnType<typeof pendingRequest>>> => [],
      ),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    conversationTurnStartIntent: {
      findMany: vi.fn(
        async (): Promise<Array<{ pendingRequestId: string | null }>> => [],
      ),
    },
    conversationDraft: { upsert: vi.fn() },
    conversationFile: { updateMany: vi.fn(async () => ({ count: 0 })) },
    userGroupMember: {
      findMany: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    userGroup: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(
        async (): Promise<Record<string, unknown> | null> => null,
      ),
      findMany: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    capability: {
      findMany: vi.fn(async () => []),
    },
    knowledgeBaseGrant: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    credential: { findMany: vi.fn(async () => []) },
    auditLog: {
      create: vi.fn(
        async (input: {
          data: { action: string; metadataJson?: Record<string, unknown> };
        }) => {
          void input;
          return { id: crypto.randomUUID() };
        },
      ),
    },
  };
}

function prismaWithTransaction(transaction: object): PrismaClient {
  return {
    $transaction: vi.fn(async (work: (client: object) => Promise<unknown>) =>
      work(transaction),
    ),
  } as unknown as PrismaClient;
}

function persistedUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    email: "user@example.com",
    name: "User",
    avatarObjectKey: null,
    role: "user",
    status: "active",
    passwordHash: null,
    preferredLocale: null,
    selfRegisteredAt: null,
    runningMessageAction: "queue",
    totalTokenLimit: null,
    weeklyTokenLimit: null,
    monthlyTokenLimit: null,
    lastLoginAt: null,
    lastLoginMethod: null,
    passwordUpdatedAt: null,
    authValidAfter: new Date("2026-07-01T00:00:00.000Z"),
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

function pendingRequest(id: string, conversationId: string, queueNo: bigint) {
  return {
    id,
    conversationId,
    queueNo,
    submittedBy: "00000000-0000-4000-8000-000000000010",
    inputText: "request body",
    priorityCapabilityIdsJson: [],
    status: "pending",
    blockCode: null,
    idempotencyKey: null,
    lastStartCheckedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
