import { randomUUID } from "node:crypto";

import {
  createUserInputSchema,
  defaultQuotaSettings,
  creditMicrosToDecimal,
  decimalToCreditMicros,
  bulkUserCreditLimitsInputSchema,
  type CurrentUserInfoSuccess,
  importUserRowSchema,
  localeSchema,
  type QuotaSettings,
  updateUserInputSchema,
  userNameSchema,
} from "@linksense/shared";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";

import { storedCreditLimits } from "../system/quota-settings.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext } from "../audit/service.js";
import { parseUserImportWorkbook } from "./import-workbook.js";
import type {
  AvatarStorage,
  AvatarUpload,
  ManagedUser,
  ManagedUserGroup,
  CreditQuotaRemainingZeroFilter,
  UserActor,
  UserPersistence,
  UserRecord,
} from "./types.js";

const DEFAULT_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export interface ObjectCleanupScheduler {
  scheduleObjectRemoval(objectKey: string): Promise<void>;
}

export interface UserLifecycleCoordinator {
  acquireUserLifecycleLock(
    userId: string,
    ttlMilliseconds?: number,
  ): Promise<string | null>;
  releaseUserLifecycleLock(userId: string, token: string): Promise<void>;
}

export interface UserCreditLimitDefaultsReader {
  getSettings(): Promise<QuotaSettings>;
}

export type UserCreditQuotaTotalUsage = {
  limitCreditMicros: bigint;
  usedCreditMicros: bigint;
  remainingCreditMicros: bigint;
  remainingPercentage: number;
};

export type UserCreditQuotaPeriodUsage = UserCreditQuotaTotalUsage & {
  resetAt: Date;
};

export type UserCreditQuotaUsage = {
  total: UserCreditQuotaTotalUsage | null;
  weekly: UserCreditQuotaPeriodUsage | null;
  monthly: UserCreditQuotaPeriodUsage | null;
};

export interface UserCreditQuotaUsageReader {
  currentUsageForLimits(
    userId: string,
    limits: {
      totalCreditLimitMicros: bigint | null;
      weeklyCreditLimitMicros: bigint | null;
      monthlyCreditLimitMicros: bigint | null;
      creditQuotaResetAt: Date | null;
    },
  ): Promise<UserCreditQuotaUsage>;
}

export type UserServiceOptions = {
  persistence: UserPersistence;
  avatarStorage: AvatarStorage;
  avatarCleanup: ObjectCleanupScheduler;
  lifecycleCoordinator: UserLifecycleCoordinator;
  creditLimitDefaults?: UserCreditLimitDefaultsReader;
  creditQuotaUsage?: UserCreditQuotaUsageReader;
  materializeUserHomes?: (userIds: readonly string[]) => Promise<void>;
  visitorProfile?: (userId: string) => Promise<{
    id: string; displayName: string | null;
    totalCreditLimitMicros: bigint | null; weeklyCreditLimitMicros: bigint | null;
    monthlyCreditLimitMicros: bigint | null; creditQuotaResetAt: Date | null;
  } | null>;
  avatarMaxBytes?: number;
  now?: () => Date;
  createId?: () => string;
};

export class UserService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly avatarMaxBytes: number;

  constructor(private readonly options: UserServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    this.avatarMaxBytes = options.avatarMaxBytes ?? DEFAULT_AVATAR_MAX_BYTES;
  }

  getRoleSummary() {
    return this.options.persistence.roleSummary();
  }

  listUsers(query: unknown) {
    const parsed = z
      .strictObject({
        search: z.string().trim().min(1).max(240).optional(),
        q: z.string().trim().min(1).max(240).optional(),
        status: z.enum(["active", "disabled"]).optional(),
        role: z.enum(["user", "admin"]).optional(),
        registration_source: z
          .enum(["self_registration", "organization_invitation"])
          .optional(),
        user_group_id: z.string().uuid().optional(),
        credit_quota_remaining_zero: z
          .enum(["total", "weekly", "monthly"])
          .optional(),
        cursor: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(50),
      })
      .parse(query);
    const search = parsed.search ?? parsed.q;
    return this.listUsersWithCreditQuotaFilter({
      ...(search ? { search } : {}),
      ...(parsed.status ? { status: parsed.status } : {}),
      ...(parsed.role ? { role: parsed.role } : {}),
      ...(parsed.registration_source
        ? { registrationSource: parsed.registration_source }
        : {}),
      ...(parsed.user_group_id ? { userGroupId: parsed.user_group_id } : {}),
      ...(parsed.credit_quota_remaining_zero
        ? { creditQuotaRemainingZero: parsed.credit_quota_remaining_zero }
        : {}),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      limit: parsed.limit,
    });
  }

  private async listUsersWithCreditQuotaFilter(input: {
    search?: string;
    status?: "active" | "disabled";
    role?: "user" | "admin";
    registrationSource?: "self_registration" | "organization_invitation";
    userGroupId?: string;
    creditQuotaRemainingZero?: CreditQuotaRemainingZeroFilter;
    cursor?: string;
    limit: number;
  }): Promise<{ items: ManagedUser[]; nextCursor: string | null }> {
    const creditQuotaRemainingZero = input.creditQuotaRemainingZero;
    if (!creditQuotaRemainingZero) {
      return this.options.persistence.listUsers(input);
    }
    const result = await this.options.persistence.listUsers(input);
    const checks = await Promise.all(
      result.items.map(async (user) => ({
        user,
        usage: await this.getCurrentCreditQuotaUsage(user),
      })),
    );
    return {
      items: checks
        .filter(({ usage }) => {
          const period = usage?.[creditQuotaRemainingZero];
          return period ? period.remainingCreditMicros === 0n : false;
        })
        .map(({ user }) => user),
      nextCursor: result.nextCursor,
    };
  }

  async getManagedUser(id: string): Promise<ManagedUser> {
    const user = await this.options.persistence.findManagedUser(id);
    if (!user) throw new AppError("NOT_FOUND");
    return user;
  }

  async createUser(
    actor: UserActor,
    input: unknown,
    audit: AuditContext = {},
  ): Promise<ManagedUser> {
    assertAdministrator(actor);
    const raw = z
      .strictObject({
        email: z.unknown(),
        name: z.unknown(),
        role: z.unknown().optional(),
        user_group_ids: z.unknown().optional(),
      })
      .parse(input);
    const parsed = createUserInputSchema.parse({
      email: raw.email,
      name: raw.name,
      ...(raw.role !== undefined ? { role: raw.role } : {}),
      ...(raw.user_group_ids !== undefined
        ? { user_group_ids: raw.user_group_ids }
        : {}),
    });
    const creditLimits = await this.defaultCreditLimitsForNewUser();
    const user = await this.options.persistence.createUser({
      id: this.createId(),
      email: parsed.email,
      name: parsed.name,
      role: parsed.role,
      userGroupIds: parsed.user_group_ids,
      totalCreditLimitMicros: creditLimits.totalCreditLimitMicros,
      weeklyCreditLimitMicros: creditLimits.weeklyCreditLimitMicros,
      monthlyCreditLimitMicros: creditLimits.monthlyCreditLimitMicros,
      actorId: actor.id,
      now: jwtBoundary(this.now()),
      audit,
    });
    await this.materializeUserHomes([user.id]);
    return user;
  }

  async updateUser(
    actor: UserActor,
    targetUserId: string,
    input: unknown,
    audit: AuditContext = {},
  ): Promise<ManagedUser> {
    assertAdministrator(actor);
    const parsed = updateUserInputSchema.parse(input);
    const affectsCapabilities = parsed.status !== undefined;
    const result = await this.withUserLifecycleLock(targetUserId, async () => {
      const updated = await this.options.persistence.updateUser({
        targetUserId,
        actorId: actor.id,
        ...(parsed.email !== undefined ? { email: parsed.email } : {}),
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.role !== undefined ? { role: parsed.role } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
        ...(parsed.user_group_ids !== undefined
          ? { userGroupIds: parsed.user_group_ids }
          : {}),
        ...(parsed.total_credit_limit !== undefined
          ? { totalCreditLimitMicros: parseCreditLimit(parsed.total_credit_limit) }
          : {}),
        ...(parsed.weekly_credit_limit !== undefined
          ? { weeklyCreditLimitMicros: parseCreditLimit(parsed.weekly_credit_limit) }
          : {}),
        ...(parsed.monthly_credit_limit !== undefined
          ? { monthlyCreditLimitMicros: parseCreditLimit(parsed.monthly_credit_limit) }
          : {}),
        now: jwtBoundary(this.now()),
        audit,
      });
      if (updated.status === "updated" && affectsCapabilities) {
        await this.materializeUserHomes([targetUserId]);
      }
      return updated;
    });
    if (result.status === "not_found") throw new AppError("NOT_FOUND");
    if (result.status === "rejected") throw new AppError(result.errorCode);
    return result.user;
  }

  async updateUserCreditLimits(
    actor: UserActor,
    input: unknown,
    audit: AuditContext = {},
  ): Promise<ManagedUser[]> {
    assertAdministrator(actor);
    const parsed = bulkUserCreditLimitsInputSchema.parse(input);
    return this.options.persistence.updateUserCreditLimits({
      targetUserIds: [...new Set(parsed.user_ids)].sort(),
      actorId: actor.id,
      ...(parsed.total_credit_limit !== undefined
        ? { totalCreditLimitMicros: parseCreditLimit(parsed.total_credit_limit) }
        : {}),
      ...(parsed.weekly_credit_limit !== undefined
        ? { weeklyCreditLimitMicros: parseCreditLimit(parsed.weekly_credit_limit) }
        : {}),
      ...(parsed.monthly_credit_limit !== undefined
        ? { monthlyCreditLimitMicros: parseCreditLimit(parsed.monthly_credit_limit) }
        : {}),
      now: jwtBoundary(this.now()),
      audit,
    });
  }

  async importWorkbook(
    actor: UserActor,
    workbook: Buffer,
    audit: AuditContext = {},
  ): Promise<{ items: ManagedUser[]; imported_count: number }> {
    assertAdministrator(actor);
    const parsedRows = await parseUserImportWorkbook(workbook);
    const rows: Array<{
      rowNumber: number;
      id: string;
      name: string;
      email: string;
      role: "user" | "admin";
      userGroupNames: string[];
    }> = [];
    const errors: Array<{ row: number; field: string; code: string }> = [];
    const seenEmails = new Set<string>();
    parsedRows.forEach((row) => {
      const rowNumber = row.rowNumber;
      const result = importUserRowSchema.safeParse({
        name: row.name,
        email: row.email,
        role: row.role,
        user_groups: splitGroupNames(row.user_groups),
      });
      if (!result.success) {
        for (const issue of result.error.issues) {
          errors.push({
            row: rowNumber,
            field: String(issue.path[0] ?? "row"),
            code: issue.code,
          });
        }
        return;
      }
      if (seenEmails.has(result.data.email)) {
        errors.push({
          row: rowNumber,
          field: "email",
          code: "duplicate_in_file",
        });
        return;
      }
      seenEmails.add(result.data.email);
      rows.push({
        rowNumber,
        id: this.createId(),
        name: result.data.name,
        email: result.data.email,
        role: result.data.role,
        userGroupNames: result.data.user_groups,
      });
    });
    if (errors.length > 0) {
      throw new AppError("VALIDATION_ERROR", { errors });
    }
    const creditLimits = await this.defaultCreditLimitsForNewUser();
    const items = await this.options.persistence.importUsers({
      rows,
      totalCreditLimitMicros: creditLimits.totalCreditLimitMicros,
      weeklyCreditLimitMicros: creditLimits.weeklyCreditLimitMicros,
      monthlyCreditLimitMicros: creditLimits.monthlyCreditLimitMicros,
      actorId: actor.id,
      now: jwtBoundary(this.now()),
      audit,
    });
    await this.materializeUserHomes(items.map((item) => item.id));
    return { items, imported_count: items.length };
  }

  async getOwnProfile(userId: string): Promise<ManagedUser> {
    const user = await this.options.persistence.findManagedUser(userId);
    if (!user || user.status !== "active") throw new AppError("AUTH_REQUIRED");
    return user;
  }

  async getCurrentUserInfo(userId: string): Promise<CurrentUserInfoSuccess> {
    const visitor = await this.options.visitorProfile?.(userId);
    if (visitor) return {
      success: true, user: { name: visitor.displayName, email: null, user_groups: [] },
      credit_quota: projectCurrentUserCreditQuota(await this.getCurrentCreditQuotaUsage(visitor)),
    };
    const user = await this.getOwnProfile(userId);
    const creditQuota = await this.getCurrentCreditQuotaUsage(user);
    return {
      success: true,
      user: {
        name: user.name,
        email: user.email,
        user_groups: user.groups
          .map((group) => ({ id: group.id, name: group.name }))
          .sort(compareCurrentUserGroups),
      },
      credit_quota: projectCurrentUserCreditQuota(creditQuota),
    };
  }

  async getAvatarUrl(userId: string): Promise<string | null> {
    const user = await this.options.persistence.findManagedUser(userId);
    return user ? this.resolveAvatarUrl(user) : null;
  }

  resolveAvatarUrl(user: {
    avatarObjectKey: string | null;
  }): Promise<string | null> {
    if (!user.avatarObjectKey) return Promise.resolve(null);
    return this.options.avatarStorage.presignedGetObject(
      user.avatarObjectKey,
      5 * 60,
    );
  }

  getCurrentCreditQuotaUsage(user: {
    id: string;
    totalCreditLimitMicros: bigint | null;
    weeklyCreditLimitMicros: bigint | null;
    monthlyCreditLimitMicros: bigint | null;
    creditQuotaResetAt: Date | null;
  }): Promise<UserCreditQuotaUsage | null> {
    if (!this.options.creditQuotaUsage) return Promise.resolve(null);
    return this.options.creditQuotaUsage.currentUsageForLimits(user.id, {
      totalCreditLimitMicros: user.totalCreditLimitMicros,
      weeklyCreditLimitMicros: user.weeklyCreditLimitMicros,
      monthlyCreditLimitMicros: user.monthlyCreditLimitMicros,
      creditQuotaResetAt: user.creditQuotaResetAt,
    });
  }

  async updateOwnProfile(
    userId: string,
    input: unknown,
    audit: AuditContext = {},
  ): Promise<UserRecord> {
    const body = z
      .strictObject({
        name: userNameSchema.optional(),
        preferred_locale: localeSchema.nullable().optional(),
        language: localeSchema.nullable().optional(),
        running_message_action: z.enum(["steer", "queue"]).optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .parse(input);
    const user = await this.options.persistence.updateOwnProfile({
      userId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.preferred_locale !== undefined || body.language !== undefined
        ? { preferredLocale: body.preferred_locale ?? body.language ?? null }
        : {}),
      ...(body.running_message_action !== undefined
        ? { runningMessageAction: body.running_message_action }
        : {}),
      now: this.now(),
      audit,
    });
    if (!user) throw new AppError("AUTH_REQUIRED");
    return user;
  }

  async replaceOwnAvatar(
    userId: string,
    upload: AvatarUpload,
    audit: AuditContext = {},
  ): Promise<UserRecord> {
    if (
      upload.bytes.byteLength === 0 ||
      upload.bytes.byteLength > this.avatarMaxBytes
    ) {
      throw new AppError("AVATAR_UPLOAD_INVALID");
    }
    const detected = await fileTypeFromBuffer(upload.bytes);
    const extension = detected
      ? ALLOWED_AVATAR_TYPES.get(detected.mime)
      : undefined;
    if (!detected || !extension || detected.mime !== upload.declaredMimeType) {
      throw new AppError("AVATAR_UPLOAD_INVALID");
    }
    const objectKey = `users/${userId}/avatars/${this.createId()}.${extension}`;
    try {
      await this.options.avatarStorage.putObject(objectKey, upload.bytes, {
        "content-type": detected.mime,
        "original-filename": sanitizeFilename(upload.filename),
      });
    } catch {
      throw new AppError("AVATAR_UPLOAD_INVALID");
    }

    let replaced;
    try {
      replaced = await this.options.persistence.replaceAvatar({
        userId,
        objectKey,
        now: this.now(),
        audit,
      });
    } catch (error) {
      await this.scheduleCleanup(objectKey);
      throw error;
    }
    if (!replaced) {
      await this.scheduleCleanup(objectKey);
      throw new AppError("AUTH_REQUIRED");
    }
    if (replaced.previousObjectKey) {
      await this.options.avatarCleanup.scheduleObjectRemoval(
        replaced.previousObjectKey,
      );
    }
    return replaced.user;
  }

  listGroups(actor: UserActor) {
    assertAdministrator(actor);
    return this.options.persistence.listGroups();
  }

  async createGroup(
    actor: UserActor,
    input: unknown,
    audit: AuditContext = {},
  ): Promise<ManagedUserGroup> {
    assertAdministrator(actor);
    const body = z
      .strictObject({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().max(2_000).nullable().default(null),
        member_ids: z.array(z.string().uuid()).max(10_000).default([]),
      })
      .parse(input);
    const group = await this.options.persistence.createGroup({
      id: this.createId(),
      name: body.name,
      description: body.description,
      memberIds: [...new Set(body.member_ids)],
      actorId: actor.id,
      now: this.now(),
      audit,
    });
    return group;
  }

  async updateGroup(
    actor: UserActor,
    id: string,
    input: unknown,
    audit: AuditContext = {},
  ): Promise<ManagedUserGroup> {
    assertAdministrator(actor);
    const body = z
      .strictObject({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(2_000).nullable().optional(),
        member_ids: z.array(z.string().uuid()).max(10_000).optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .parse(input);
    const group = await this.options.persistence.updateGroup({
      id,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
      ...(body.member_ids !== undefined
        ? { memberIds: [...new Set(body.member_ids)] }
        : {}),
      actorId: actor.id,
      now: this.now(),
      audit,
    });
    if (!group) throw new AppError("NOT_FOUND");
    return group;
  }

  async deleteGroup(
    actor: UserActor,
    id: string,
    audit: AuditContext = {},
  ): Promise<void> {
    assertAdministrator(actor);
    const deleted = await this.options.persistence.deleteGroup({
      id,
      actorId: actor.id,
      now: this.now(),
      audit,
    });
    if (!deleted) throw new AppError("NOT_FOUND");
  }

  private async scheduleCleanup(objectKey: string): Promise<void> {
    try {
      await this.options.avatarStorage.removeObject(objectKey);
    } catch {
      await this.options.avatarCleanup.scheduleObjectRemoval(objectKey);
    }
  }

  private async materializeUserHomes(
    userIds: readonly string[],
  ): Promise<void> {
    if (this.options.materializeUserHomes === undefined) return;
    try {
      await this.options.materializeUserHomes([...new Set(userIds)].sort());
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
    }
  }

  private async defaultCreditLimitsForNewUser(): Promise<ReturnType<typeof storedCreditLimits>> {
    const settings = await this.options.creditLimitDefaults?.getSettings();
    return storedCreditLimits((settings ?? defaultQuotaSettings()).organization_members);
  }

  private async withUserLifecycleLock<T>(
    userId: string,
    action: () => Promise<T>,
  ): Promise<T> {
    let token: string | null = null;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      token = await this.options.lifecycleCoordinator.acquireUserLifecycleLock(
        userId,
        120_000,
      );
      if (token) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    if (!token) throw new AppError("CONFLICT");
    try {
      return await action();
    } finally {
      await this.options.lifecycleCoordinator
        .releaseUserLifecycleLock(userId, token)
        .catch(() => undefined);
    }
  }
}

function assertAdministrator(actor: UserActor): void {
  if (actor.role !== "admin" || actor.status !== "active") {
    throw new AppError("FORBIDDEN");
  }
}

function parseCreditLimit(value: string | null): bigint | null {
  return value === null ? null : decimalToCreditMicros(value);
}

function projectCurrentUserCreditQuota(
  usage: UserCreditQuotaUsage | null,
): CurrentUserInfoSuccess["credit_quota"] {
  return {
    total: projectCurrentUserCreditQuotaTotal(usage?.total ?? null),
    weekly: projectCurrentUserCreditQuotaPeriod(usage?.weekly ?? null),
    monthly: projectCurrentUserCreditQuotaPeriod(usage?.monthly ?? null),
  };
}

function projectCurrentUserCreditQuotaTotal(
  total: UserCreditQuotaTotalUsage | null,
): CurrentUserInfoSuccess["credit_quota"]["total"] {
  if (!total) return null;
  return {
    limit_credits: creditMicrosToDecimal(total.limitCreditMicros),
    used_credits: creditMicrosToDecimal(total.usedCreditMicros),
    remaining_credits: creditMicrosToDecimal(total.remainingCreditMicros),
    remaining_percentage: total.remainingPercentage,
  };
}

function projectCurrentUserCreditQuotaPeriod(
  period: UserCreditQuotaPeriodUsage | null,
): CurrentUserInfoSuccess["credit_quota"]["weekly"] {
  if (!period) return null;
  return {
    limit_credits: creditMicrosToDecimal(period.limitCreditMicros),
    used_credits: creditMicrosToDecimal(period.usedCreditMicros),
    remaining_credits: creditMicrosToDecimal(period.remainingCreditMicros),
    remaining_percentage: period.remainingPercentage,
    reset_at: period.resetAt.toISOString(),
  };
}

function compareCurrentUserGroups(
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  return left.name.localeCompare(right.name, "zh-CN") || left.id.localeCompare(right.id);
}

function splitGroupNames(value: string): string[] {
  if (!value.trim()) return [];
  return [
    ...new Set(
      value
        .split(";")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

function sanitizeFilename(filename: string): string {
  return filename.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 160) || "avatar";
}

function jwtBoundary(now: Date): Date {
  return new Date(now.getTime());
}
