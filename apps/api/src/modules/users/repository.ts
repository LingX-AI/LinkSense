import { Prisma } from "../../generated/prisma/client.js";
import { isLocale, loginMethodSchema } from "@linksense/shared";
import type {
  PrismaClient,
  User,
  UserGroup,
} from "../../generated/prisma/client.js";

import { AppError } from "../../lib/errors.js";
import { sha256 } from "../../lib/crypto.js";
import { sanitizeAuditMetadata } from "../audit/service.js";
import type {
  CreateUserCommand,
  ImportUserCommand,
  ManagedUser,
  ManagedUserGroup,
  UpdateUserCommand,
  UpdateUserCreditLimitsCommand,
  UpdateUserResult,
  UserGroupRecord,
  UserPersistence,
  UserRecord,
  UserRoleSummary,
  UserLocale,
} from "./types.js";

const ADMIN_LIFECYCLE_ADVISORY_LOCK = 7_223_456_002n;
type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export class PrismaUserRepository implements UserPersistence {
  constructor(private readonly prisma: PrismaClient) {}

  async roleSummary(): Promise<UserRoleSummary[]> {
    const [activeUsers, disabledUsers, activeAdmins, disabledAdmins] =
      await Promise.all([
        this.prisma.user.count({ where: { role: "user", status: "active" } }),
        this.prisma.user.count({ where: { role: "user", status: "disabled" } }),
        this.prisma.user.count({ where: { role: "admin", status: "active" } }),
        this.prisma.user.count({
          where: { role: "admin", status: "disabled" },
        }),
      ]);
    return [
      {
        role: "user",
        active_count: activeUsers,
        disabled_count: disabledUsers,
        total_count: activeUsers + disabledUsers,
      },
      {
        role: "admin",
        active_count: activeAdmins,
        disabled_count: disabledAdmins,
        total_count: activeAdmins + disabledAdmins,
      },
    ];
  }

  async listUsers(input: {
    search?: string;
    status?: "active" | "disabled";
    role?: "user" | "admin";
    registrationSource?: "self_registration" | "organization_invitation";
    userGroupId?: string;
    creditQuotaRemainingZero?: "weekly";
    cursor?: string;
    limit: number;
  }): Promise<{ items: ManagedUser[]; nextCursor: string | null }> {
    const groupMemberIds = input.userGroupId
      ? (
          await this.prisma.userGroupMember.findMany({
            where: {
              userGroupId: input.userGroupId,
              status: "active",
            },
            select: { userId: true },
          })
        ).map((membership) => membership.userId)
      : null;
    if (groupMemberIds?.length === 0) {
      return { items: [], nextCursor: null };
    }
    const users = await this.prisma.user.findMany({
      where: {

        ...(groupMemberIds ? { id: { in: groupMemberIds } } : {}),
        ...(input.search
          ? {
              OR: [
                {
                  name: {
                    contains: input.search,
                    mode: "insensitive" as const,
                  },
                },
                {
                  email: {
                    contains: input.search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            }
          : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(input.registrationSource === "self_registration"
          ? { selfRegisteredAt: { not: null } }
          : input.registrationSource === "organization_invitation"
            ? { selfRegisteredAt: null }
            : {}),
      },
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
    });
    const visible = users.slice(0, input.limit);
    return {
      items: await enrichUsers(this.prisma, visible),
      nextCursor:
        users.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
    };
  }

  async findManagedUser(id: string): Promise<ManagedUser | null> {
    const user = await this.prisma.user.findFirst({
      where: { id },
    });
    if (!user) return null;
    return (await enrichUsers(this.prisma, [user]))[0] ?? null;
  }

  createUser(input: CreateUserCommand): Promise<ManagedUser> {
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAdministrator(transaction, input.actorId);
      await assertEmailAvailable(transaction, input.email);
      await assertGroupsExist(transaction, input.userGroupIds);
      const user = await transaction.user.create({
        data: {
          id: input.id,
          email: input.email,
          name: input.name,
          role: input.role,
          status: "active",
          passwordHash: null,
          passwordUpdatedAt: null,
          weeklyCreditLimitMicros: input.weeklyCreditLimitMicros,
          authValidAfter: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      if (input.userGroupIds.length > 0) {
        await transaction.userGroupMember.createMany({
          data: input.userGroupIds.map((userGroupId) => ({
            userId: user.id,
            userGroupId,
            status: "active",
            createdBy: input.actorId,
            createdAt: input.now,
            updatedAt: input.now,
          })),
        });
      }
      await writeAudit(transaction, {
        actorId: input.actorId,
        action: "user_created",
        targetType: "user",
        targetId: user.id,
        result: "success",
        metadata: {
          role: input.role,
          status: "active",
          user_group_count: input.userGroupIds.length,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      return (await enrichUsers(transaction, [user]))[0] as ManagedUser;
    });
  }

  updateUser(input: UpdateUserCommand): Promise<UpdateUserResult> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_LIFECYCLE_ADVISORY_LOCK})`;
      await assertActiveAdministrator(transaction, input.actorId);
      await lockUser(transaction, input.targetUserId);
      const target = await transaction.user.findUnique({
        where: { id: input.targetUserId },
      });
      if (!target) return { status: "not_found" };

      const nextRole = input.role ?? target.role;
      const nextStatus = input.status ?? target.status;
      const selfPrivilegeReduction =
        target.id === input.actorId &&
        target.role === "admin" &&
        (nextRole === "user" || nextStatus === "disabled");
      if (selfPrivilegeReduction) {
        await writeRejectedAdminAudit(
          transaction,
          input,
          target,
          "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN",
          null,
        );
        return {
          status: "rejected",
          errorCode: "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN",
        };
      }

      const removesActiveAdministrator =
        target.role === "admin" &&
        target.status === "active" &&
        (nextRole !== "admin" || nextStatus !== "active");
      if (removesActiveAdministrator) {
        await transaction.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM users
          WHERE role = 'admin' AND status = 'active'
          ORDER BY id
          FOR UPDATE
        `;
        const activeAdministratorCount = await transaction.user.count({
          where: { role: "admin", status: "active" },
        });
        if (activeAdministratorCount <= 1) {
          await writeRejectedAdminAudit(
            transaction,
            input,
            target,
            "LAST_ENABLED_ADMIN_REQUIRED",
            activeAdministratorCount,
          );
          return {
            status: "rejected",
            errorCode: "LAST_ENABLED_ADMIN_REQUIRED",
          };
        }
      }

      if (input.email && input.email !== target.email) {
        const conflict = await transaction.user.findFirst({
          where: { email: input.email, id: { not: target.id } },
          select: { id: true },
        });
        if (conflict) {
          await writeAudit(transaction, {
            actorId: input.actorId,
            action: "user_email_change_rejected",
            targetType: "user",
            targetId: target.id,
            result: "rejected",
            metadata: { error_code: "USER_EMAIL_ALREADY_EXISTS" },
            ipAddress: input.audit.ipAddress ?? null,
            userAgent: input.audit.userAgent ?? null,
          });
          return { status: "rejected", errorCode: "USER_EMAIL_ALREADY_EXISTS" };
        }
      }
      if (input.userGroupIds)
        await assertGroupsExist(transaction, input.userGroupIds);

      const invalidatesAuthentication =
        (input.email !== undefined && input.email !== target.email) ||
        (input.role !== undefined && input.role !== target.role) ||
        (input.status !== undefined && input.status !== target.status);
      const disabling =
        target.status !== "disabled" && nextStatus === "disabled";
      const updated = await transaction.user.update({
        where: { id: target.id },
        data: {
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.role !== undefined ? { role: input.role } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.weeklyCreditLimitMicros !== undefined
            ? { weeklyCreditLimitMicros: input.weeklyCreditLimitMicros }
            : {}),
          ...(invalidatesAuthentication ? { authValidAfter: input.now } : {}),
          updatedAt: input.now,
        },
      });

      let revokedSessionCount = 0;
      if (invalidatesAuthentication) {
        const revoked = await transaction.refreshToken.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: input.now, revokeReason: "user_changed" },
        });
        revokedSessionCount = revoked.count;
      }
      let invalidatedResetLinkCount = 0;
      if (
        disabling ||
        (input.email !== undefined && input.email !== target.email)
      ) {
        const invalidated = await transaction.passwordResetToken.updateMany({
          where: { userId: target.id, consumedAt: null },
          data: { consumedAt: input.now },
        });
        invalidatedResetLinkCount = invalidated.count;
      }

      const cancelledPendingCount = disabling
        ? await cancelPendingRequests(transaction, target.id, input)
        : 0;
      if (input.userGroupIds) {
        await reconcileGroupMemberships(
          transaction,
          target.id,
          input.userGroupIds,
          input.actorId,
          input.now,
        );
      }
      await writeAudit(transaction, {
        actorId: input.actorId,
        action:
          input.email !== undefined && input.email !== target.email
            ? "user_email_changed"
            : disabling
              ? "user_disabled"
              : target.status === "disabled" && nextStatus === "active"
                ? "user_enabled"
                : "user_updated",
        targetType: "user",
        targetId: target.id,
        result: "success",
        metadata: {
          role: updated.role,
          status: updated.status,
          authentication_invalidated: invalidatesAuthentication,
          ...(input.email !== undefined && input.email !== target.email
            ? {
                previous_address_sha256: sha256(
                  target.email.toLocaleLowerCase("en-US"),
                ),
                new_address_sha256: sha256(
                  input.email.toLocaleLowerCase("en-US"),
                ),
                session_revoked_count: revokedSessionCount,
                reset_link_invalidated_count: invalidatedResetLinkCount,
              }
            : {}),
          cancelled_pending_request_count: cancelledPendingCount,
          weekly_credit_limit_changed: input.weeklyCreditLimitMicros !== undefined,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      return {
        status: "updated",
        user: (await enrichUsers(transaction, [updated]))[0] as ManagedUser,
      };
    });
  }

  updateUserCreditLimits(
    input: UpdateUserCreditLimitsCommand,
  ): Promise<ManagedUser[]> {
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAdministrator(transaction, input.actorId);
      const targetUserIds = [...new Set(input.targetUserIds)].sort();
      if (targetUserIds.length === 0) {
        throw new AppError("VALIDATION_ERROR");
      }
      await assertUsersExist(transaction, targetUserIds);
      const targetUserSql = targetUserIds.map(
        (userId) => Prisma.sql`${userId}::uuid`,
      );
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users
        WHERE id IN (${Prisma.join(targetUserSql)})
        ORDER BY id
        FOR UPDATE
      `;
      await transaction.user.updateMany({
        where: { id: { in: targetUserIds } },
        data: {
          ...(input.weeklyCreditLimitMicros !== undefined
            ? { weeklyCreditLimitMicros: input.weeklyCreditLimitMicros }
            : {}),
          updatedAt: input.now,
        },
      });
      await writeAudit(transaction, {
        actorId: input.actorId,
        action: "users_credit_limits_updated",
        targetType: "user_batch",
        targetId: null,
        result: "success",
        metadata: {
          user_count: targetUserIds.length,
          weekly_credit_limit_changed: input.weeklyCreditLimitMicros !== undefined,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      const updated = await transaction.user.findMany({
        where: { id: { in: targetUserIds } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return enrichUsers(transaction, updated);
    });
  }

  importUsers(input: ImportUserCommand): Promise<ManagedUser[]> {
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAdministrator(transaction, input.actorId);
      const emails = input.rows.map((row) => row.email);
      const existing = await transaction.user.findMany({
        where: { email: { in: emails } },
        select: { email: true },
      });
      if (existing.length > 0) {
        const existingEmails = new Set(
          existing.map((user) => user.email.toLowerCase()),
        );
        throw new AppError("USER_EMAIL_ALREADY_EXISTS", {
          errors: input.rows
            .filter((row) => existingEmails.has(row.email.toLowerCase()))
            .map((row) => ({
              row: row.rowNumber,
              field: "email",
              code: "USER_EMAIL_ALREADY_EXISTS",
            })),
        });
      }
      const groupNames = [
        ...new Set(input.rows.flatMap((row) => row.userGroupNames)),
      ];
      const groups = await transaction.userGroup.findMany({
        where: { name: { in: groupNames } },
      });
      if (groups.length !== groupNames.length) {
        const existingGroupNames = new Set(groups.map((group) => group.name));
        throw new AppError("VALIDATION_ERROR", {
          errors: input.rows.flatMap((row) =>
            row.userGroupNames
              .filter((name) => !existingGroupNames.has(name))
              .map(() => ({
                row: row.rowNumber,
                field: "user_groups",
                code: "user_group_not_found",
              })),
          ),
        });
      }
      await assertGroupsExist(
        transaction,
        groups.map((group) => group.id),
      );
      const groupByName = new Map(
        groups.map((group) => [group.name, group.id]),
      );

      await transaction.user.createMany({
        data: input.rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          status: "active",
          passwordHash: null,
          passwordUpdatedAt: null,
          weeklyCreditLimitMicros: input.weeklyCreditLimitMicros,
          authValidAfter: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      });
      const memberships = input.rows.flatMap((row) =>
        row.userGroupNames.map((name) => ({
          userId: row.id,
          userGroupId: groupByName.get(name) as string,
          status: "active",
          createdBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      );
      if (memberships.length > 0) {
        await transaction.userGroupMember.createMany({ data: memberships });
      }
      await writeAudit(transaction, {
        actorId: input.actorId,
        action: "users_imported",
        targetType: "user_import",
        targetId: null,
        result: "success",
        metadata: { row_count: input.rows.length },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      const created = await transaction.user.findMany({
        where: { id: { in: input.rows.map((row) => row.id) } },
        orderBy: { createdAt: "asc" },
      });
      return enrichUsers(transaction, created);
    });
  }

  updateOwnProfile(input: {
    userId: string;
    name?: string;
    preferredLocale?: UserLocale | null;
    runningMessageAction?: "steer" | "queue";
    now: Date;
    audit: import("../audit/service.js").AuditContext;
  }): Promise<UserRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.user.updateMany({
        where: { id: input.userId, status: "active" },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.preferredLocale !== undefined
            ? { preferredLocale: input.preferredLocale }
            : {}),
          ...(input.runningMessageAction !== undefined
            ? { runningMessageAction: input.runningMessageAction }
            : {}),
          updatedAt: input.now,
        },
      });
      if (changed.count !== 1) return null;
      await writeAudit(transaction, {
        actorId: input.userId,
        action: "user_profile_updated",
        targetType: "user",
        targetId: input.userId,
        result: "success",
        metadata: {
          name_changed: input.name !== undefined,
          locale_changed: input.preferredLocale !== undefined,
          running_message_action_changed:
            input.runningMessageAction !== undefined,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      const user = await transaction.user.findUnique({
        where: { id: input.userId },
      });
      return user ? mapUser(user) : null;
    });
  }

  replaceAvatar(input: {
    userId: string;
    objectKey: string;
    now: Date;
    audit: import("../audit/service.js").AuditContext;
  }): Promise<{ user: UserRecord; previousObjectKey: string | null } | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockUser(transaction, input.userId);
      const current = await transaction.user.findUnique({
        where: { id: input.userId },
      });
      if (!current || current.status !== "active") return null;
      const updated = await transaction.user.update({
        where: { id: current.id },
        data: { avatarObjectKey: input.objectKey, updatedAt: input.now },
      });
      await writeAudit(transaction, {
        actorId: current.id,
        action: "user_avatar_replaced",
        targetType: "user",
        targetId: current.id,
        result: "success",
        metadata: {
          replaced_existing_avatar: current.avatarObjectKey !== null,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      return {
        user: mapUser(updated),
        previousObjectKey: current.avatarObjectKey,
      };
    });
  }

  async listGroups(): Promise<ManagedUserGroup[]> {
    const groups = await this.prisma.userGroup.findMany({
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return enrichGroups(this.prisma, groups);
  }

  createGroup(input: {
    id: string;
    name: string;
    description: string | null;
    memberIds: string[];
    actorId: string;
    now: Date;
    audit: import("../audit/service.js").AuditContext;
  }): Promise<ManagedUserGroup> {
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAdministrator(transaction, input.actorId);
      await assertUsersExist(transaction, input.memberIds);
      const duplicate = await transaction.userGroup.findUnique({
        where: { name: input.name },
      });
      if (duplicate) throw new AppError("CONFLICT");
      const group = await transaction.userGroup.create({
        data: {
          id: input.id,
          name: input.name,
          description: input.description,
          createdBy: input.actorId,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      if (input.memberIds.length > 0) {
        await transaction.userGroupMember.createMany({
          data: input.memberIds.map((userId) => ({
            userId,
            userGroupId: group.id,
            status: "active",
            createdBy: input.actorId,
            createdAt: input.now,
            updatedAt: input.now,
          })),
        });
      }
      await writeAudit(transaction, {
        actorId: input.actorId,
        action: "user_group_created",
        targetType: "user_group",
        targetId: group.id,
        result: "success",
        metadata: {
          member_count: input.memberIds.length,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      return (await enrichGroups(transaction, [group]))[0] as ManagedUserGroup;
    });
  }

  updateGroup(input: {
    id: string;
    name?: string;
    description?: string | null;
    memberIds?: string[];
    actorId: string;
    now: Date;
    audit: import("../audit/service.js").AuditContext;
  }): Promise<ManagedUserGroup | null> {
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAdministrator(transaction, input.actorId);
      const current = await transaction.userGroup.findUnique({
        where: { id: input.id },
      });
      if (!current) return null;
      if (input.name && input.name !== current.name) {
        const duplicate = await transaction.userGroup.findUnique({
          where: { name: input.name },
        });
        if (duplicate) throw new AppError("CONFLICT");
      }
      if (input.memberIds) await assertUsersExist(transaction, input.memberIds);
      const updated = await transaction.userGroup.update({
        where: { id: current.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          updatedAt: input.now,
        },
      });
      if (input.memberIds) {
        await reconcileGroupMembers(
          transaction,
          current.id,
          input.memberIds,
          input.actorId,
          input.now,
        );
      }
      await writeAudit(transaction, {
        actorId: input.actorId,
        action: "user_group_updated",
        targetType: "user_group",
        targetId: current.id,
        result: "success",
        metadata: {},
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      return (
        await enrichGroups(transaction, [updated])
      )[0] as ManagedUserGroup;
    });
  }

  deleteGroup(input: {
    id: string;
    actorId: string;
    now: Date;
    audit: import("../audit/service.js").AuditContext;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await assertActiveAdministrator(transaction, input.actorId);
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM user_groups WHERE id = ${input.id}::uuid FOR UPDATE
      `;
      const group = await transaction.userGroup.findUnique({
        where: { id: input.id },
      });
      if (!group) return false;
      const [members, knowledgeBaseGrants] = await Promise.all([
        transaction.userGroupMember.deleteMany({
          where: { userGroupId: group.id },
        }),
        transaction.knowledgeBaseGrant.deleteMany({
          where: {
            granteeType: "user_group",
            userGroupId: group.id,
          },
        }),
      ]);
      await writeAudit(transaction, {
        actorId: input.actorId,
        action: "user_group_deleted",
        targetType: "user_group",
        targetId: group.id,
        result: "success",
        metadata: {
          member_record_count: members.count,
          knowledge_base_grant_record_count: knowledgeBaseGrants.count,
        },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
      await transaction.userGroup.delete({ where: { id: group.id } });
      return true;
    });
  }
}

async function assertActiveAdministrator(
  client: DatabaseClient,
  actorId: string,
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users WHERE id = ${actorId}::uuid FOR UPDATE
  `;
  const actor = await client.user.findUnique({ where: { id: actorId } });
  if (!actor || actor.status !== "active" || actor.role !== "admin") {
    throw new AppError("FORBIDDEN");
  }
}

async function assertEmailAvailable(
  client: DatabaseClient,
  email: string,
): Promise<void> {
  const existing = await client.user.findUnique({ where: { email } });
  if (existing) throw new AppError("USER_EMAIL_ALREADY_EXISTS");
}

async function assertGroupsExist(
  client: Prisma.TransactionClient,
  groupIds: string[],
): Promise<void> {
  if (groupIds.length === 0) return;
  const uniqueGroupIds = [...new Set(groupIds)].sort();
  for (const groupId of uniqueGroupIds) {
    const rows = await client.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM user_groups WHERE id = ${groupId}::uuid FOR KEY SHARE
    `;
    if (rows.length !== 1) throw new AppError("VALIDATION_ERROR");
  }
}

async function assertUsersExist(
  client: DatabaseClient,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const count = await client.user.count({ where: { id: { in: userIds } } });
  if (count !== userIds.length) throw new AppError("VALIDATION_ERROR");
}

async function lockUser(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await transaction.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE
  `;
}

async function writeRejectedAdminAudit(
  transaction: Prisma.TransactionClient,
  input: UpdateUserCommand,
  target: User,
  errorCode:
    | "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN"
    | "LAST_ENABLED_ADMIN_REQUIRED",
  activeAdministratorCount: number | null,
): Promise<void> {
  const operation = input.status === "disabled" ? "disable" : "demote";
  await writeAudit(transaction, {
    actorId: input.actorId,
    action:
      errorCode === "LAST_ENABLED_ADMIN_REQUIRED"
        ? "user_last_enabled_admin_change_rejected"
        : "user_admin_self_change_rejected",
    targetType: "user",
    targetId: target.id,
    result: "rejected",
    metadata: {
      operation,
      error_code: errorCode,
      requested_at: input.now.toISOString(),
      ...(activeAdministratorCount === null
        ? {}
        : { active_administrator_count: activeAdministratorCount }),
    },
    ipAddress: input.audit.ipAddress ?? null,
    userAgent: input.audit.userAgent ?? null,
  });
}

async function reconcileGroupMemberships(
  transaction: Prisma.TransactionClient,
  userId: string,
  desiredGroupIds: string[],
  actorId: string,
  now: Date,
): Promise<void> {
  const current = await transaction.userGroupMember.findMany({
    where: { userId, status: "active" },
  });
  const desired = new Set(desiredGroupIds);
  const existing = new Set(current.map((member) => member.userGroupId));
  const removed = current.filter((member) => !desired.has(member.userGroupId));
  if (removed.length > 0) {
    await transaction.userGroupMember.updateMany({
      where: { id: { in: removed.map((member) => member.id) } },
      data: {
        status: "revoked",
        revokedBy: actorId,
        revokedAt: now,
        updatedAt: now,
      },
    });
  }
  const added = desiredGroupIds.filter((groupId) => !existing.has(groupId));
  if (added.length > 0) {
    await transaction.userGroupMember.createMany({
      data: added.map((userGroupId) => ({
        userId,
        userGroupId,
        status: "active",
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      })),
    });
  }
}

async function reconcileGroupMembers(
  transaction: Prisma.TransactionClient,
  userGroupId: string,
  desiredUserIds: string[],
  actorId: string,
  now: Date,
): Promise<void> {
  const current = await transaction.userGroupMember.findMany({
    where: { userGroupId, status: "active" },
  });
  const desired = new Set(desiredUserIds);
  const existing = new Set(current.map((member) => member.userId));
  const removed = current.filter((member) => !desired.has(member.userId));
  if (removed.length > 0) {
    await transaction.userGroupMember.updateMany({
      where: { id: { in: removed.map((member) => member.id) } },
      data: {
        status: "revoked",
        revokedBy: actorId,
        revokedAt: now,
        updatedAt: now,
      },
    });
  }
  const added = desiredUserIds.filter((userId) => !existing.has(userId));
  if (added.length > 0) {
    await transaction.userGroupMember.createMany({
      data: added.map((userId) => ({
        userId,
        userGroupId,
        status: "active",
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      })),
    });
  }
}

async function cancelPendingRequests(
  transaction: Prisma.TransactionClient,
  userId: string,
  input: UpdateUserCommand,
): Promise<number> {
  const conversations = await transaction.conversation.findMany({
    where: { ownerId: userId },
    select: { id: true },
  });
  if (conversations.length === 0) return 0;
  const conversationIds = conversations.map((conversation) => conversation.id);
  const protectedIntents =
    await transaction.conversationTurnStartIntent.findMany({
      where: {
        ownerId: userId,
        conversationId: { in: conversationIds },
        pendingRequestId: { not: null },
      },
      select: { pendingRequestId: true },
    });
  const protectedPendingIds = new Set(
    protectedIntents.flatMap((intent) =>
      intent.pendingRequestId ? [intent.pendingRequestId] : [],
    ),
  );
  const pendingRequests = (
    await transaction.pendingRequest.findMany({
      where: { conversationId: { in: conversationIds } },
      orderBy: [{ conversationId: "asc" }, { queueNo: "asc" }],
    })
  ).filter((pending) => !protectedPendingIds.has(pending.id));
  const requestsByConversation = new Map<string, typeof pendingRequests>();
  for (const pending of pendingRequests) {
    const items = requestsByConversation.get(pending.conversationId) ?? [];
    items.push(pending);
    requestsByConversation.set(pending.conversationId, items);
  }
  for (const [conversationId, pending] of requestsByConversation) {
    const pendingIds = pending.map((item) => item.id);
    await transaction.conversationFile.updateMany({
      where: { pendingRequestId: { in: pendingIds }, turnId: null },
      data: {
        pendingRequestId: null,
        status: "staged",
        updatedAt: input.now,
      },
    });
    for (const request of pending) {
      await writeAudit(transaction, {
        actorId: input.actorId,
        action: "conversation_pending_request_cancelled_user_disabled",
        targetType: "pending_request",
        targetId: request.id,
        result: "success",
        metadata: { conversation_id: conversationId },
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      });
    }
    await transaction.pendingRequest.deleteMany({
      where: { id: { in: pendingIds } },
    });
  }
  return pendingRequests.length;
}

async function enrichUsers(
  client: DatabaseClient,
  users: User[],
): Promise<ManagedUser[]> {
  if (users.length === 0) return [];
  const userIds = users.map((user) => user.id);
  const [memberships, ownedCapabilities, credentials] = await Promise.all([
    client.userGroupMember.findMany({
      where: { userId: { in: userIds }, status: "active" },
    }),
    client.capability.findMany({
      where: { ownerId: { in: userIds } },
      select: { ownerId: true, type: true },
    }),
    client.credential.findMany({
      where: { ownerId: { in: userIds } },
      select: { ownerId: true },
    }),
  ]);
  const groupIds = [
    ...new Set(memberships.map((member) => member.userGroupId)),
  ];
  const groups = await client.userGroup.findMany({
    where: { id: { in: groupIds } },
  });
  const groupById = new Map(groups.map((group) => [group.id, mapGroup(group)]));

  return users.map((user) => {
    const userMemberships = memberships.filter(
      (member) => member.userId === user.id,
    );
    const userGroups = userMemberships.flatMap((member) => {
      const group = groupById.get(member.userGroupId);
      return group ? [group] : [];
    });
    const owned = ownedCapabilities.filter(
      (capability) => capability.ownerId === user.id,
    );
    const personalCredentialCount = credentials.filter(
      (credential) => credential.ownerId === user.id,
    ).length;
    const safeUser = mapUser(user);
    const visible = {
      id: safeUser.id,
      email: safeUser.email,
      name: safeUser.name,
      avatarObjectKey: safeUser.avatarObjectKey,
      role: safeUser.role,
      status: safeUser.status,
      preferredLocale: safeUser.preferredLocale,
      selfRegisteredAt: safeUser.selfRegisteredAt,
      runningMessageAction: safeUser.runningMessageAction,
      weeklyCreditLimitMicros: safeUser.weeklyCreditLimitMicros,
      creditQuotaResetAt: safeUser.creditQuotaResetAt,
      lastLoginAt: safeUser.lastLoginAt,
      lastLoginMethod: safeUser.lastLoginMethod,
      passwordUpdatedAt: safeUser.passwordUpdatedAt,
      authValidAfter: safeUser.authValidAfter,
      createdAt: safeUser.createdAt,
      updatedAt: safeUser.updatedAt,
    };
    return {
      ...visible,
      groups: userGroups,
      counts: {
        user_groups: userGroups.length,
        personal_plugins: owned.filter(
          (capability) => capability.type === "plugin",
        ).length,
        personal_skills: owned.filter(
          (capability) => capability.type === "skill",
        ).length,
        personal_credentials: personalCredentialCount,
      },
    };
  });
}

async function enrichGroups(
  client: DatabaseClient,
  groups: UserGroup[],
): Promise<ManagedUserGroup[]> {
  if (groups.length === 0) return [];
  const groupIds = groups.map((group) => group.id);
  const memberships = await client.userGroupMember.findMany({
    where: { userGroupId: { in: groupIds }, status: "active" },
    select: { userGroupId: true, userId: true },
  });
  return groups.map((group) => {
    const memberIds = memberships
      .filter((member) => member.userGroupId === group.id)
      .map((member) => member.userId);
    return {
      ...mapGroup(group),
      memberIds,
      memberCount: memberIds.length,
    };
  });
}

function mapUser(user: User): UserRecord {
  if (
    (user.role !== "user" && user.role !== "admin") ||
    (user.status !== "active" && user.status !== "disabled") ||
    (user.preferredLocale !== null && !isLocale(user.preferredLocale)) ||
    (user.runningMessageAction !== "steer" &&
      user.runningMessageAction !== "queue") ||
    (user.lastLoginMethod !== null && !loginMethodSchema.safeParse(user.lastLoginMethod).success)
  ) {
    throw new Error("invalid persisted user state");
  }
  return {
    ...user,
    role: user.role,
    status: user.status,
    preferredLocale: user.preferredLocale,
    runningMessageAction: user.runningMessageAction,
    lastLoginMethod: user.lastLoginMethod === null ? null : loginMethodSchema.parse(user.lastLoginMethod),
  };
}

function mapGroup(group: UserGroup): UserGroupRecord {
  return group;
}

type AuditWrite = {
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: "success" | "rejected" | "failed";
  metadata: Record<string, string | number | boolean | null>;
  ipAddress: string | null;
  userAgent: string | null;
};

function writeAudit(
  client: DatabaseClient,
  entry: AuditWrite,
): Promise<unknown> {
  return client.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      result: entry.result,
      metadataJson: sanitizeAuditMetadata(entry.action, entry.metadata),
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
    },
  });
}
