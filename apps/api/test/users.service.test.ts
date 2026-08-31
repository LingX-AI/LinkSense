import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

import {
  UserService,
  type UserTokenQuotaUsage,
} from "../src/modules/users/service.js";
import type {
  AvatarStorage,
  ImportUserCommand,
  ManagedUser,
  ManagedUserGroup,
  UserPersistence,
  UserRecord,
} from "../src/modules/users/types.js";

const NOW = new Date("2026-07-11T08:00:00.750Z");
const ADMIN = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "admin" as const,
  status: "active" as const,
};

describe("UserService", () => {
  it("passes validated group and registration-source filters to the paginated user query", async () => {
    const fixture = userFixture();
    const userGroupId = "00000000-0000-4000-8000-000000000020";

    await fixture.service.listUsers({
      user_group_id: userGroupId,
      registration_source: "self_registration",
      limit: "100",
    });

    expect(fixture.persistence.listUsers).toHaveBeenCalledWith({
      userGroupId,
      registrationSource: "self_registration",
      limit: 100,
    });
  });

  it("creates non-initialization users without accepting any password field", async () => {
    const fixture = userFixture();
    await expect(
      fixture.service.createUser(ADMIN, {
        name: "New User",
        email: "new@example.com",
        role: "user",
        password: "Password1!",
        user_group_ids: [],
      }),
    ).rejects.toBeDefined();
    expect(fixture.persistence.createUser).not.toHaveBeenCalled();

    await fixture.service.createUser(ADMIN, {
      name: "New User",
      email: "new@example.com",
      role: "user",
      user_group_ids: [],
    });
    const command = vi.mocked(fixture.persistence.createUser).mock
      .calls[0]?.[0];
    expect(command).not.toHaveProperty("password");
    expect(command).not.toHaveProperty("passwordHash");
    expect(command).toMatchObject({
      weeklyTokenLimit: null,
      monthlyTokenLimit: null,
    });
    expect(command?.now.toISOString()).toBe("2026-07-11T08:00:00.750Z");
  });

  it("copies model-setting initial token usage into newly created users", async () => {
    const fixture = userFixture();
    vi.mocked(fixture.tokenLimitDefaults.getAdminSettings).mockResolvedValueOnce({
      token_limits: {
        weekly_token_limit: "25000",
        monthly_token_limit: "100000",
      },
    });

    await fixture.service.createUser(ADMIN, {
      name: "New User",
      email: "new@example.com",
      role: "user",
      user_group_ids: [],
    });

    expect(fixture.persistence.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyTokenLimit: 25_000n,
        monthlyTokenLimit: 100_000n,
      }),
    );
  });

  it("projects current user info with groups and token quota for Core MCP", async () => {
    const fixture = userFixture();
    vi.mocked(fixture.persistence.findManagedUser).mockResolvedValueOnce(
      makeManagedUser({
        name: "Ada",
        email: "ada@example.com",
        totalTokenLimit: 5_000n,
        weeklyTokenLimit: 1_000n,
        monthlyTokenLimit: 10_000n,
        groups: [
          makeGroup({
            id: "00000000-0000-4000-8000-000000000022",
            name: "Zeta",
          }),
          makeGroup({
            id: "00000000-0000-4000-8000-000000000021",
            name: "Alpha",
          }),
        ],
      }),
    );
    vi.mocked(fixture.tokenQuotaUsage.currentUsageForLimits).mockResolvedValueOnce({
      total: {
        limitTokens: 5_000n,
        usedTokens: 1_250n,
        remainingTokens: 3_750n,
        remainingPercentage: 75,
      },
      weekly: {
        limitTokens: 1_000n,
        usedTokens: 250n,
        remainingTokens: 750n,
        remainingPercentage: 75,
        resetAt: new Date("2026-08-24T00:00:00.000Z"),
      },
      monthly: null,
    });

    await expect(
      fixture.service.getCurrentUserInfo("00000000-0000-4000-8000-000000000010"),
    ).resolves.toEqual({
      success: true,
      user: {
        name: "Ada",
        email: "ada@example.com",
        user_groups: [
          {
            id: "00000000-0000-4000-8000-000000000021",
            name: "Alpha",
          },
          {
            id: "00000000-0000-4000-8000-000000000022",
            name: "Zeta",
          },
        ],
      },
      token_quota: {
        total: {
          limit_tokens: "5000",
          used_tokens: "1250",
          remaining_tokens: "3750",
          remaining_percentage: 75,
        },
        weekly: {
          limit_tokens: "1000",
          used_tokens: "250",
          remaining_tokens: "750",
          remaining_percentage: 75,
          reset_at: "2026-08-24T00:00:00.000Z",
        },
        monthly: null,
      },
    });
    expect(fixture.tokenQuotaUsage.currentUsageForLimits).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000010",
      {
        totalTokenLimit: 5_000n,
        weeklyTokenLimit: 1_000n,
        monthlyTokenLimit: 10_000n,
      },
    );
  });

  it("rejects non-administrators before performing user management writes", async () => {
    const fixture = userFixture();
    await expect(
      fixture.service.createUser(
        { ...ADMIN, role: "user" },
        { name: "User", email: "u@example.com", role: "user" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.persistence.createUser).not.toHaveBeenCalled();
  });

  it("rejects removed user-level capability grant input", async () => {
    const fixture = userFixture();
    const capabilityId = "00000000-0000-4000-8000-000000000222";
    await expect(
      fixture.service.createUser(ADMIN, {
        name: "User",
        email: "u@example.com",
        role: "user",
        user_group_ids: [],
        capability_ids: [capabilityId],
      }),
    ).rejects.toBeDefined();
    expect(fixture.persistence.createUser).not.toHaveBeenCalled();
  });

  it("maps administrator invariant rejections to their stable API codes", async () => {
    const fixture = userFixture();
    vi.mocked(fixture.persistence.updateUser).mockResolvedValueOnce({
      status: "rejected",
      errorCode: "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN",
    });
    await expect(
      fixture.service.updateUser(ADMIN, ADMIN.id, { status: "disabled" }),
    ).rejects.toMatchObject({
      code: "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN",
    });

    vi.mocked(fixture.persistence.updateUser).mockResolvedValueOnce({
      status: "rejected",
      errorCode: "LAST_ENABLED_ADMIN_REQUIRED",
    });
    await expect(
      fixture.service.updateUser(
        ADMIN,
        "00000000-0000-4000-8000-000000000002",
        { role: "user" },
      ),
    ).rejects.toMatchObject({ code: "LAST_ENABLED_ADMIN_REQUIRED" });
  });

  it("rejects removed capability grant updates", async () => {
    const fixture = userFixture();
    const capabilityId = "00000000-0000-4000-8000-000000000222";
    await expect(
      fixture.service.updateUser(
        ADMIN,
        "00000000-0000-4000-8000-000000000010",
        { capability_ids: [capabilityId] },
      ),
    ).rejects.toBeDefined();
    expect(fixture.persistence.updateUser).not.toHaveBeenCalled();
  });

  it("forwards per-user token limit updates as nullable bigint values", async () => {
    const fixture = userFixture();
    const targetUserId = "00000000-0000-4000-8000-000000000010";

    await fixture.service.updateUser(ADMIN, targetUserId, {
      total_token_limit: "500000",
      weekly_token_limit: "25000",
      monthly_token_limit: null,
    });

    expect(fixture.persistence.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserId,
        totalTokenLimit: 500_000n,
        weeklyTokenLimit: 25_000n,
        monthlyTokenLimit: null,
      }),
    );
  });

  it("bulk-updates selected user token limits after de-duplicating ids", async () => {
    const fixture = userFixture();
    const firstUserId = "00000000-0000-4000-8000-000000000011";
    const secondUserId = "00000000-0000-4000-8000-000000000010";

    await fixture.service.updateUserTokenLimits(ADMIN, {
      user_ids: [firstUserId, secondUserId, firstUserId],
      total_token_limit: "500000",
      weekly_token_limit: null,
      monthly_token_limit: "100000",
    });

    expect(fixture.persistence.updateUserTokenLimits).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUserIds: [secondUserId, firstUserId],
        totalTokenLimit: 500_000n,
        weeklyTokenLimit: null,
        monthlyTokenLimit: 100_000n,
      }),
    );
  });

  it("holds the target user's lifecycle lock until the administrator update commits", async () => {
    const fixture = userFixture();
    const targetUserId = "00000000-0000-4000-8000-000000000010";
    let resolveUpdate:
      ((value: { status: "updated"; user: ManagedUser }) => void) | undefined;
    vi.mocked(fixture.persistence.updateUser).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const update = fixture.service.updateUser(ADMIN, targetUserId, {
      status: "disabled",
    });

    await vi.waitFor(() => {
      expect(fixture.persistence.updateUser).toHaveBeenCalledOnce();
    });
    expect(
      fixture.lifecycleCoordinator.acquireUserLifecycleLock,
    ).toHaveBeenCalledWith(targetUserId, 120_000);
    expect(
      fixture.lifecycleCoordinator.releaseUserLifecycleLock,
    ).not.toHaveBeenCalled();

    resolveUpdate?.({
      status: "updated",
      user: makeManagedUser({ status: "disabled" }),
    });
    await expect(update).resolves.toMatchObject({ status: "disabled" });
    expect(
      fixture.lifecycleCoordinator.releaseUserLifecycleLock,
    ).toHaveBeenCalledWith(targetUserId, "user-lifecycle-lock");
  });

  it("imports strict Excel rows atomically without a password or temporary-password column", async () => {
    const fixture = userFixture();
    const result = await fixture.service.importWorkbook(
      ADMIN,
      await userImportWorkbook(
        ["Name", "Email", "Role", "User groups"],
        [["Member", "MEMBER@example.com", "user", "Operations;Staff"]],
      ),
    );
    expect(result.imported_count).toBe(1);
    const command = vi.mocked(fixture.persistence.importUsers).mock
      .calls[0]?.[0];
    expect(command?.rows[0]).toEqual(
      expect.objectContaining({
        name: "Member",
        email: "member@example.com",
        role: "user",
        userGroupNames: ["Operations", "Staff"],
      }),
    );
    expect(command).toMatchObject({
      weeklyTokenLimit: null,
      monthlyTokenLimit: null,
    });
    expect(command?.rows[0]).not.toHaveProperty("password");

    await expect(
      fixture.service.importWorkbook(
        ADMIN,
        await userImportWorkbook(
          ["Name", "Email", "Role", "User groups", "temporary_password"],
          [["Member", "m@example.com", "user", "", "Password1!"]],
        ),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("copies model-setting initial token usage into imported users", async () => {
    const fixture = userFixture();
    vi.mocked(fixture.tokenLimitDefaults.getAdminSettings).mockResolvedValueOnce({
      token_limits: {
        weekly_token_limit: "30000",
        monthly_token_limit: "120000",
      },
    });

    await fixture.service.importWorkbook(
      ADMIN,
      await userImportWorkbook(
        ["Name", "Email", "Role", "User groups"],
        [["Member", "member@example.com", "user", ""]],
      ),
    );

    expect(fixture.persistence.importUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        weeklyTokenLimit: 30_000n,
        monthlyTokenLimit: 120_000n,
      }),
    );
  });

  it("reports duplicate Excel emails by row without echoing row values", async () => {
    const fixture = userFixture();
    const error = await fixture.service
      .importWorkbook(
        ADMIN,
        await userImportWorkbook(
          ["姓名", "邮箱", "角色", "用户组"],
          [
            ["A", "same@example.com", "user", ""],
            ["B", "SAME@example.com", "user", ""],
          ],
        ),
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      params: {
        errors: [{ row: 3, field: "email", code: "duplicate_in_file" }],
      },
    });
    expect(JSON.stringify(error)).not.toContain("same@example.com");
    expect(fixture.persistence.importUsers).not.toHaveBeenCalled();
  });

  it("never permits a profile owner to update their email or role", async () => {
    const fixture = userFixture();
    await expect(
      fixture.service.updateOwnProfile(ADMIN.id, {
        email: "changed@example.com",
      }),
    ).rejects.toBeDefined();
    expect(fixture.persistence.updateOwnProfile).not.toHaveBeenCalled();
  });

  it("accepts the Web language alias while persisting only preferred_locale", async () => {
    const fixture = userFixture();
    await fixture.service.updateOwnProfile(ADMIN.id, { language: "en-US" });
    expect(fixture.persistence.updateOwnProfile).toHaveBeenCalledWith(
      expect.objectContaining({ preferredLocale: "en-US" }),
    );
  });

  it("persists the default action for a message sent during a running turn", async () => {
    const fixture = userFixture();
    await fixture.service.updateOwnProfile(ADMIN.id, {
      running_message_action: "steer",
    });
    expect(fixture.persistence.updateOwnProfile).toHaveBeenCalledWith(
      expect.objectContaining({ runningMessageAction: "steer" }),
    );
  });

  it("rejects MIME-spoofed avatars before object storage or persistence", async () => {
    const fixture = userFixture();
    await expect(
      fixture.service.replaceOwnAvatar(ADMIN.id, {
        filename: "avatar.png",
        declaredMimeType: "image/png",
        bytes: Buffer.from("not an image"),
      }),
    ).rejects.toMatchObject({ code: "AVATAR_UPLOAD_INVALID" });
    expect(fixture.avatarStorage.putObject).not.toHaveBeenCalled();
    expect(fixture.persistence.replaceAvatar).not.toHaveBeenCalled();
  });

  it("uploads a verified avatar, commits its key, and removes the previous object", async () => {
    const fixture = userFixture();
    vi.mocked(fixture.persistence.replaceAvatar).mockResolvedValueOnce({
      user: makeUserRecord({ avatarObjectKey: "new-key" }),
      previousObjectKey: "old-key",
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg==",
      "base64",
    );
    await fixture.service.replaceOwnAvatar(ADMIN.id, {
      filename: "my avatar.png",
      declaredMimeType: "image/png",
      bytes: png,
    });
    expect(fixture.avatarStorage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^users\/.+\/avatars\/.+\.png$/u),
      png,
      expect.objectContaining({ "content-type": "image/png" }),
    );
    expect(fixture.avatarCleanup.scheduleObjectRemoval).toHaveBeenCalledWith(
      "old-key",
    );
  });

  it("cleans an uploaded object if the database reference update fails", async () => {
    const fixture = userFixture();
    vi.mocked(fixture.persistence.replaceAvatar).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg==",
      "base64",
    );
    await expect(
      fixture.service.replaceOwnAvatar(ADMIN.id, {
        filename: "avatar.png",
        declaredMimeType: "image/png",
        bytes: png,
      }),
    ).rejects.toThrow("database unavailable");
    expect(fixture.avatarStorage.removeObject).toHaveBeenCalledTimes(1);
  });

  it("manages flat group members as an explicit set", async () => {
    const fixture = userFixture();
    const memberId = "00000000-0000-4000-8000-000000000010";
    await fixture.service.createGroup(ADMIN, {
      name: "Operators",
      description: null,
      member_ids: [memberId],
    });
    expect(fixture.persistence.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        memberIds: [memberId],
      }),
    );
  });

  it("requires an administrator and forwards deletion audit context to the group parent transaction", async () => {
    const fixture = userFixture();
    const groupId = "00000000-0000-4000-8000-000000000020";
    const audit = { ipAddress: "192.0.2.20", userAgent: "Admin Browser" };

    await fixture.service.deleteGroup(ADMIN, groupId, audit);
    expect(fixture.persistence.deleteGroup).toHaveBeenCalledWith({
      id: groupId,
      actorId: ADMIN.id,
      now: NOW,
      audit,
    });

    vi.mocked(fixture.persistence.deleteGroup).mockClear();
    await expect(
      fixture.service.deleteGroup({ ...ADMIN, role: "user" }, groupId, audit),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.persistence.deleteGroup).not.toHaveBeenCalled();
  });

  it("reports HOME reconciliation failure after preserving the committed user change", async () => {
    const materializeUserHomes = vi.fn(async () => {
      throw new Error("filesystem unavailable");
    });
    const fixture = userFixture(materializeUserHomes);
    const targetUserId = "00000000-0000-4000-8000-000000000010";

    await expect(
      fixture.service.updateUser(ADMIN, targetUserId, {
        status: "disabled",
      }),
    ).rejects.toMatchObject({ code: "CAPABILITY_HOME_SYNC_FAILED" });
    expect(fixture.persistence.updateUser).toHaveBeenCalledOnce();
  });
});

function userFixture(
  materializeUserHomes = vi.fn(async (userIds: readonly string[]) => {
    void userIds;
  }),
) {
  const user = makeManagedUser();
  const group = makeGroup();
  const persistence: UserPersistence = {
    roleSummary: vi.fn(async () => []),
    listUsers: vi.fn(async () => ({ items: [user], nextCursor: null })),
    findManagedUser: vi.fn(async () => user),
    createUser: vi.fn(async () => user),
    updateUser: vi.fn(async () => ({ status: "updated" as const, user })),
    updateUserTokenLimits: vi.fn(async () => [user]),
    importUsers: vi.fn(async (input: ImportUserCommand) =>
      input.rows.map((row) =>
        makeManagedUser({
          id: row.id,
          name: row.name,
          email: row.email,
          role: row.role,
          weeklyTokenLimit: input.weeklyTokenLimit,
          monthlyTokenLimit: input.monthlyTokenLimit,
        }),
      ),
    ),
    updateOwnProfile: vi.fn(async () => makeUserRecord()),
    replaceAvatar: vi.fn(async () => ({
      user: makeUserRecord(),
      previousObjectKey: null,
    })),
    listGroups: vi.fn(async () => [group]),
    createGroup: vi.fn(async () => group),
    updateGroup: vi.fn(async () => group),
    deleteGroup: vi.fn(async () => true),
  };
  const avatarStorage: AvatarStorage = {
    putObject: vi.fn(async () => undefined),
    removeObject: vi.fn(async () => undefined),
    presignedGetObject: vi.fn(async (key) => `https://objects.example/${key}`),
  };
  let id = 100;
  const avatarCleanup = { scheduleObjectRemoval: vi.fn(async () => undefined) };
  const lifecycleCoordinator = {
    acquireUserLifecycleLock: vi.fn(async () => "user-lifecycle-lock"),
    releaseUserLifecycleLock: vi.fn(async () => undefined),
  };
  const tokenLimitDefaults = {
    getAdminSettings: vi.fn(
      async (): Promise<{
        token_limits: {
          weekly_token_limit: string | null;
          monthly_token_limit: string | null;
        };
      }> => ({
        token_limits: {
          weekly_token_limit: null,
          monthly_token_limit: null,
        },
      }),
    ),
  };
  const tokenQuotaUsage = {
    currentUsageForLimits: vi.fn(async (): Promise<UserTokenQuotaUsage> => ({
      total: null,
      weekly: null,
      monthly: null,
    })),
  };
  const service = new UserService({
    persistence,
    avatarStorage,
    avatarCleanup,
    lifecycleCoordinator,
    tokenLimitDefaults,
    tokenQuotaUsage,
    materializeUserHomes,
    now: () => new Date(NOW),
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  });
  return {
    service,
    persistence,
    avatarStorage,
    avatarCleanup,
    lifecycleCoordinator,
    tokenLimitDefaults,
    tokenQuotaUsage,
    materializeUserHomes,
  };
}

async function userImportWorkbook(
  headers: string[],
  rows: Array<Array<string>>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("User Import");
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function makeManagedUser(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    email: "user@example.com",
    name: "User",
    avatarObjectKey: null,
    role: "user",
    status: "active",
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
    groups: [],
    counts: {
      user_groups: 0,
      personal_plugins: 0,
      personal_skills: 0,
      personal_credentials: 0,
    },
    ...overrides,
  };
}

function makeUserRecord(overrides: Partial<UserRecord> = {}): UserRecord {
  const managed = makeManagedUser();
  return {
    id: managed.id,
    email: managed.email,
    name: managed.name,
    avatarObjectKey: managed.avatarObjectKey,
    role: managed.role,
    status: managed.status,
    passwordHash: "hash",
    preferredLocale: managed.preferredLocale,
    selfRegisteredAt: managed.selfRegisteredAt,
    runningMessageAction: managed.runningMessageAction,
    totalTokenLimit: managed.totalTokenLimit,
    weeklyTokenLimit: managed.weeklyTokenLimit,
    monthlyTokenLimit: managed.monthlyTokenLimit,
    lastLoginAt: managed.lastLoginAt,
    lastLoginMethod: managed.lastLoginMethod,
    passwordUpdatedAt: managed.passwordUpdatedAt,
    authValidAfter: managed.authValidAfter,
    createdAt: managed.createdAt,
    updatedAt: managed.updatedAt,
    ...overrides,
  };
}

function makeGroup(
  overrides: Partial<ManagedUserGroup> = {},
): ManagedUserGroup {
  return {
    id: "00000000-0000-4000-8000-000000000030",
    name: "Operators",
    description: null,
    createdBy: ADMIN.id,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    memberIds: [],
    memberCount: 0,
    ...overrides,
  };
}
