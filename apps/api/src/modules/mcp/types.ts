import type { RuntimeMcpServer } from "@linksense/shared"

import type { RequestActor } from "../capabilities/types.js"

export type { RequestActor }

export type McpServerRecord = {
  id: string
  ownerId: string
  name: string
  serverKey: string
  transport: "streamable_http" | "stdio"
  url: string | null
  command: string | null
  args: string[]
  encryptedEnvironment: string | null
  environmentKeys: string[]
  authType: "none" | "bearer" | "api_key"
  apiKeyHeader: string | null
  encryptedCredential: string | null
  encryptionKeyId: string | null
  status: "active" | "disabled"
  required: boolean
  startupTimeoutSeconds: number
  toolTimeoutSeconds: number
  insecureHttpAcknowledged: boolean
  lastTestStatus: "succeeded" | "failed" | null
  lastTestErrorCode: string | null
  lastTestedAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type CreateMcpServerRecord = Omit<
  McpServerRecord,
  | "lastTestStatus"
  | "lastTestErrorCode"
  | "lastTestedAt"
  | "lastUsedAt"
  | "createdAt"
  | "updatedAt"
>

export type UpdateMcpServerRecord = Partial<
  Pick<
    McpServerRecord,
    | "name"
    | "transport"
    | "url"
    | "command"
    | "args"
    | "encryptedEnvironment"
    | "environmentKeys"
    | "authType"
    | "apiKeyHeader"
    | "encryptedCredential"
    | "encryptionKeyId"
    | "status"
    | "startupTimeoutSeconds"
    | "toolTimeoutSeconds"
    | "insecureHttpAcknowledged"
    | "lastTestStatus"
    | "lastTestErrorCode"
    | "lastTestedAt"
    | "lastUsedAt"
  >
>

export interface McpServerRepository {
  listByOwner(ownerId: string): Promise<McpServerRecord[]>
  findOwned(ownerId: string, id: string): Promise<McpServerRecord | null>
  createWithinOwnerLimit(
    input: CreateMcpServerRecord,
    limit: number
  ): Promise<McpServerRecord | null>
  createManyWithinOwnerLimit(
    input: CreateMcpServerRecord[],
    limit: number
  ): Promise<McpServerRecord[] | null>
  update(id: string, input: UpdateMcpServerRecord): Promise<McpServerRecord>
  delete(id: string): Promise<void>
}

export type ResolvedMcpRuntime = {
  servers: RuntimeMcpServer[]
  generation: string
  environment: Record<string, string>
  credentialUsageReceipts: Array<{ serverId: string }>
}

export interface McpConnectionProbe {
  probe(input: {
    url: URL
    auth:
      | { type: "none" }
      | { type: "bearer"; value: string }
      | { type: "api_key"; headerName: string; value: string }
    timeoutMs: number
  }): Promise<{
    serverName: string
    protocolVersion: string
    toolCount: number
  }>
}

export interface McpStdioConnectionProbe {
  probe(input: {
    ownerId: string
    command: string
    args: string[]
    environment: Record<string, string>
    timeoutMs: number
  }): Promise<{
    serverName: string
    protocolVersion: string
    toolCount: number
  }>
}
