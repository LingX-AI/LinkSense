import type { AuditContext } from "../audit/service.js"

export type UserRole = "user" | "admin"
export type UserStatus = "active" | "disabled"
export type UserLocale = "zh-CN" | "en-US"
export type RunningMessageAction = "steer" | "queue"
export type CreditQuotaRemainingZeroFilter = "total" | "weekly" | "monthly"
export type UserRegistrationSource =
  | "self_registration"
  | "organization_invitation"

export type UserRoleSummary = {
  role: UserRole
  active_count: number
  disabled_count: number
  total_count: number
}

export type UserRecord = {
  id: string
  email: string
  name: string
  avatarObjectKey: string | null
  role: UserRole
  status: UserStatus
  passwordHash: string | null
  preferredLocale: UserLocale | null
  selfRegisteredAt: Date | null
  runningMessageAction: RunningMessageAction
  totalCreditLimitMicros: bigint | null
  weeklyCreditLimitMicros: bigint | null
  monthlyCreditLimitMicros: bigint | null
  creditQuotaResetAt: Date | null
  lastLoginAt: Date | null
  lastLoginMethod: "password" | "oidc" | "teams" | null
  passwordUpdatedAt: Date | null
  authValidAfter: Date
  createdAt: Date
  updatedAt: Date
}

export type UserGroupRecord = {
  id: string
  name: string
  description: string | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export type ManagedUserGroup = UserGroupRecord & {
  memberIds: string[]
  memberCount: number
}

export type ManagedUser = Omit<UserRecord, "passwordHash"> & {
  groups: UserGroupRecord[]
  counts: {
    user_groups: number
    personal_plugins: number
    personal_skills: number
    personal_credentials: number
  }
}

export type CreateUserCommand = {
  id: string
  email: string
  name: string
  role: UserRole
  userGroupIds: string[]
  totalCreditLimitMicros: bigint | null
  weeklyCreditLimitMicros: bigint | null
  monthlyCreditLimitMicros: bigint | null
  actorId: string
  now: Date
  audit: AuditContext
}

export type UpdateUserCommand = {
  targetUserId: string
  actorId: string
  email?: string
  name?: string
  role?: UserRole
  status?: UserStatus
  userGroupIds?: string[]
  totalCreditLimitMicros?: bigint | null
  weeklyCreditLimitMicros?: bigint | null
  monthlyCreditLimitMicros?: bigint | null
  now: Date
  audit: AuditContext
}

export type UpdateUserCreditLimitsCommand = {
  targetUserIds: string[]
  actorId: string
  totalCreditLimitMicros?: bigint | null
  weeklyCreditLimitMicros?: bigint | null
  monthlyCreditLimitMicros?: bigint | null
  now: Date
  audit: AuditContext
}

export type UpdateUserResult =
  | { status: "updated"; user: ManagedUser }
  | {
      status: "rejected"
      errorCode:
        | "ADMIN_SELF_ROLE_OR_STATUS_CHANGE_FORBIDDEN"
        | "LAST_ENABLED_ADMIN_REQUIRED"
        | "USER_EMAIL_ALREADY_EXISTS"
    }
  | { status: "not_found" }

export type ImportUserCommand = {
  rows: Array<{
    rowNumber: number
    id: string
    email: string
    name: string
    role: UserRole
    userGroupNames: string[]
  }>
  totalCreditLimitMicros: bigint | null
  weeklyCreditLimitMicros: bigint | null
  monthlyCreditLimitMicros: bigint | null
  actorId: string
  now: Date
  audit: AuditContext
}

export interface UserPersistence {
  roleSummary(): Promise<UserRoleSummary[]>
  listUsers(input: {
    search?: string
    status?: UserStatus
    role?: UserRole
    registrationSource?: UserRegistrationSource
    userGroupId?: string
    creditQuotaRemainingZero?: CreditQuotaRemainingZeroFilter
    cursor?: string
    limit: number
  }): Promise<{ items: ManagedUser[]; nextCursor: string | null }>
  findManagedUser(id: string): Promise<ManagedUser | null>
  createUser(input: CreateUserCommand): Promise<ManagedUser>
  updateUser(input: UpdateUserCommand): Promise<UpdateUserResult>
  updateUserCreditLimits(
    input: UpdateUserCreditLimitsCommand,
  ): Promise<ManagedUser[]>
  importUsers(input: ImportUserCommand): Promise<ManagedUser[]>
  updateOwnProfile(input: {
    userId: string
    name?: string
    preferredLocale?: UserLocale | null
    runningMessageAction?: RunningMessageAction
    now: Date
    audit: AuditContext
  }): Promise<UserRecord | null>
  replaceAvatar(input: {
    userId: string
    objectKey: string
    now: Date
    audit: AuditContext
  }): Promise<{ user: UserRecord; previousObjectKey: string | null } | null>
  listGroups(): Promise<ManagedUserGroup[]>
  createGroup(input: {
    id: string
    name: string
    description: string | null
    memberIds: string[]
    actorId: string
    now: Date
    audit: AuditContext
  }): Promise<ManagedUserGroup>
  updateGroup(input: {
    id: string
    name?: string
    description?: string | null
    memberIds?: string[]
    actorId: string
    now: Date
    audit: AuditContext
  }): Promise<ManagedUserGroup | null>
  deleteGroup(input: {
    id: string
    actorId: string
    now: Date
    audit: AuditContext
  }): Promise<boolean>
}

export interface AvatarStorage {
  putObject(
    key: string,
    data: Buffer,
    metadata?: Record<string, string>,
  ): Promise<void>
  removeObject(key: string): Promise<void>
  presignedGetObject(key: string, expiresSeconds: number): Promise<string>
}

export type UserActor = {
  id: string
  role: UserRole
  status: UserStatus
}

export type AvatarUpload = {
  filename: string
  declaredMimeType: string
  bytes: Buffer
}
