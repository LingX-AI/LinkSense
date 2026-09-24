import * as oidc from "openid-client";
import { z } from "zod";
import {
  connectionProviderSchema,
  connectionSchema,
  isConnectionWrite,
  isWorkspaceInput,
  type Connection,
  type ConnectionProvider,
  type ConnectionInput,
  type ConnectionResult,
} from "@linksense/shared";
import {
  encryptJson,
  decryptJson,
  randomToken,
  sha256,
} from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type {
  SocialSettingsService,
  SocialConfiguration,
} from "../social-auth/settings.js";
import type { SocialStateStore } from "../social-auth/state.js";
import type { AuditService } from "../audit/service.js";
import {
  disconnectedConnection,
  type ConnectionRepository,
  type ConnectionRecord,
  type ConnectionWrite,
} from "./repository.js";
import {
  hasConnectionWriteAccess,
  parseConnectionToken,
  connectionIdentityProvider,
  type ConnectionProtocol,
  type ConnectionToken,
} from "./protocol.js";
import type { WorkspaceAdapter } from "./workspace-adapter.js";
import type { ConnectionGraph } from "./graph.js";

const flowSchema = z.strictObject({
  ownerId: z.uuid(),
  provider: connectionProviderSchema,
  browserHash: z.string(),
  authVersion: z.string(),
  revision: z.number().int(),
  clientId: z.string(),
  nonce: z.string(),
  verifier: z.string(),
});
const cursorSchema = z.strictObject({
  revision: z.number().int(),
  requestHash: z.string(),
  nextLink: z.string().min(1).max(8000),
  expiresAt: z.number(),
});
type Options = {
  repository: ConnectionRepository;
  settings: Pick<SocialSettingsService, "resolve">;
  states: SocialStateStore;
  protocol: ConnectionProtocol;
  graph: ConnectionGraph;
  workspace?: WorkspaceAdapter;
  audit: Pick<AuditService, "write">;
  masterKey: string;
  keyId: string;
  now?: () => number;
};

export class ConnectionService {
  private readonly now: () => number;
  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
  }

  async list(ownerId: string): Promise<Connection[]> {
    await this.options.repository.authVersion(ownerId);
    const [rows, microsoft, google] = await Promise.all([
      this.options.repository.list(ownerId),
      this.options.settings.resolve("microsoft"),
      this.options.settings.resolve("google"),
    ]);
    return connectionProviderSchema.options.map((provider) => {
      const settings =
        connectionIdentityProvider(provider) === "google" ? google : microsoft;
      const configured = Boolean(settings?.client_id && settings.client_secret);
      const row = rows.find((value) => value.provider === provider);
      let accessMode: "read" | "read_write" | null = null;
      if (row?.status === "connected" && row.encryptedPayload) {
        try {
          const token = parseConnectionToken(
            provider,
            this.decrypt(row.encryptedPayload, this.context(ownerId, provider)),
          );
          if (token.clientId === settings?.client_id)
            accessMode = hasConnectionWriteAccess(provider, token.scopes)
              ? "read_write"
              : "read";
        } catch {
          // A damaged authorization must not make the other account disappear.
          // No stored account details or decryption failures reach the client.
        }
      }
      return connectionSchema.parse({
        provider,
        configured,
        status:
          row?.status === "connected" && accessMode === null
            ? "reconnect_required"
            : (row?.status ?? "disconnected"),
        access_mode: accessMode,
        account_name: row?.accountName ?? null,
        connected_at: row?.connectedAt?.toISOString() ?? null,
      });
    });
  }

  async start(
    ownerId: string,
    provider: ConnectionProvider,
    browser: string,
  ): Promise<string> {
    const authVersion = await this.options.repository.authVersion(ownerId);
    const settings = await this.settings(provider);
    if (
      !(await this.options.states.throttle(
        `connection:${ownerId}:${provider}`,
        3,
      ))
    )
      throw new AppError("CONFLICT");
    const checks = {
      state: randomToken(),
      nonce: oidc.randomNonce(),
      verifier: oidc.randomPKCECodeVerifier(),
    };
    const url = await this.options.protocol.start(provider, settings, checks);
    const row = await this.options.repository.mutate(
      ownerId,
      provider,
      async (current) => ({
        ...(current ?? disconnectedConnection(0)),
        revision: (current?.revision ?? 0) + 1,
      }),
    );
    const flow = {
      ownerId,
      provider,
      browserHash: sha256(browser),
      authVersion,
      revision: row.revision,
      clientId: settings.client_id,
      nonce: checks.nonce,
      verifier: checks.verifier,
    };
    await this.options.states.put(
      `connection-flow:${checks.state}`,
      this.encrypt(flow, "flow"),
      600,
    );
    return url;
  }

  async complete(
    provider: ConnectionProvider,
    parameters: Record<string, string>,
    browser: string,
  ): Promise<void> {
    if (!parameters.state || !browser)
      throw new AppError("CONNECTION_AUTH_FAILED");
    const key = `connection-flow:${parameters.state}`;
    const encrypted = await this.options.states.read(key, z.string());
    if (!encrypted) throw new AppError("CONNECTION_AUTH_FAILED");
    const flow = flowSchema.parse(this.decrypt(encrypted, "flow"));
    if (flow.provider !== provider || flow.browserHash !== sha256(browser))
      throw new AppError("CONNECTION_AUTH_FAILED");
    if (!(await this.options.states.read(key, z.string(), true)))
      throw new AppError("CONNECTION_AUTH_FAILED");
    if (parameters.error) throw new AppError("CONNECTION_AUTH_FAILED");
    const settings = await this.settings(provider);
    if (
      settings.client_id !== flow.clientId ||
      (await this.options.repository.authVersion(flow.ownerId)) !==
        flow.authVersion
    )
      throw new AppError("CONNECTION_AUTH_FAILED");
    const result = await this.options.protocol.complete(
      provider,
      settings,
      parameters,
      {
        state: parameters.state,
        nonce: flow.nonce,
        verifier: flow.verifier,
      },
    );
    await this.options.repository.mutate(
      flow.ownerId,
      provider,
      async (current) => {
        if (
          !current ||
          current.revision !== flow.revision ||
          (await this.options.repository.authVersion(flow.ownerId)) !==
            flow.authVersion
        )
          throw new AppError("CONNECTION_AUTH_FAILED");
        return {
          status: "connected",
          enabled: true,
          accountName: result.accountName,
          connectedAt: new Date(this.now()),
          revision: current.revision + 1,
          encryptedPayload: this.encrypt(
            parseConnectionToken(provider, result.token),
            this.context(flow.ownerId, provider),
          ),
          encryptionKeyId: this.options.keyId,
        };
      },
    );
    await this.audit(flow.ownerId, provider, "connection_authorized");
  }

  async disconnect(
    ownerId: string,
    provider: ConnectionProvider,
  ): Promise<void> {
    await this.options.repository.authVersion(ownerId);
    await this.options.repository.mutate(ownerId, provider, async (row) =>
      disconnectedConnection((row?.revision ?? 0) + 1),
    );
    await this.audit(ownerId, provider, "connection_disconnected");
  }
  async execute(
    ownerId: string,
    conversationId: string,
    turnId: string,
    input: ConnectionInput,
    signal?: AbortSignal,
  ): Promise<ConnectionResult> {
    const write = isConnectionWrite(input);
    await this.options.repository.assertTurn(
      ownerId,
      conversationId,
      turnId,
      write,
    );
    if (input.operation === "list_connections")
      return { kind: "connections", items: await this.list(ownerId) };
    const { token, revision } = await this.access(ownerId, input.provider);
    if (write && !hasConnectionWriteAccess(input.provider, token.scopes))
      throw new AppError("CONNECTION_WRITE_REQUIRED");
    const { cursor, ...query } =
      "cursor" in input ? input : { ...input, cursor: undefined };
    const requestHash = sha256(JSON.stringify(query));
    let nextLink: string | undefined;
    if (cursor) {
      try {
        const data = cursorSchema.parse(
          this.decrypt(cursor, `cursor:${ownerId}:${input.provider}`),
        );
        if (
          data.revision !== revision ||
          data.requestHash !== requestHash ||
          data.expiresAt < this.now()
        )
          throw new Error("invalid cursor");
        nextLink = data.nextLink;
      } catch {
        throw new AppError("VALIDATION_ERROR");
      }
    }
    let page;
    try {
      if (isWorkspaceInput(input)) {
        if (!this.options.workspace)
          throw new AppError("CONNECTION_NOT_CONFIGURED");
        page = await this.options.workspace.execute(
          token.accessToken,
          input,
          nextLink,
          signal,
        );
      } else
        page = await this.options.graph.execute(
          token.accessToken,
          input,
          nextLink,
          signal,
        );
    } catch (error) {
      if (error instanceof AppError && error.code === "CONNECTION_REQUIRED")
        await this.requireReconnect(ownerId, input.provider, revision);
      throw error;
    }
    await this.options.audit.write({
      actorId: ownerId,
      action: "connection_used",
      targetType: "connection",
      result: "success",
      metadata: { provider: input.provider, operation: input.operation },
    });
    await this.options.repository.assertTurn(
      ownerId,
      conversationId,
      turnId,
      write,
    );
    const current = await this.options.repository.get(ownerId, input.provider);
    if (
      !current ||
      current.status !== "connected" ||
      current.revision !== revision
    )
      throw new AppError("CONNECTION_REQUIRED");
    if (
      (page.result.kind === "page" || page.result.kind === "workspace_data") &&
      page.nextLink
    )
      page.result.next_cursor = this.encrypt(
        {
          revision,
          requestHash,
          nextLink: page.nextLink,
          expiresAt: this.now() + 600_000,
        },
        `cursor:${ownerId}:${input.provider}`,
      );
    return page.result;
  }

  private async access(
    ownerId: string,
    provider: ConnectionProvider,
  ): Promise<{ token: ConnectionToken; revision: number }> {
    const settings = await this.settings(provider);
    const row = await this.options.repository.mutate(
      ownerId,
      provider,
      async (current) => {
        if (
          !current ||
          current.status !== "connected" ||
          !current.encryptedPayload
        )
          throw new AppError("CONNECTION_REQUIRED");
        const token = parseConnectionToken(
          provider,
          this.decrypt(
            current.encryptedPayload,
            this.context(ownerId, provider),
          ),
        );
        if (token.clientId !== settings.client_id)
          return this.reconnectWrite(current);
        if (token.expiresAt > this.now() + 60_000) return current;
        try {
          const refreshed = await this.options.protocol.refresh(
            provider,
            settings,
            token,
          );
          return {
            ...current,
            encryptedPayload: this.encrypt(
              refreshed,
              this.context(ownerId, provider),
            ),
            encryptionKeyId: this.options.keyId,
          };
        } catch (error) {
          if (error instanceof AppError && error.code === "CONNECTION_REQUIRED")
            return this.reconnectWrite(current);
          throw error;
        }
      },
    );
    if (row.status !== "connected" || !row.encryptedPayload)
      throw new AppError("CONNECTION_REQUIRED");
    return {
      token: parseConnectionToken(
        provider,
        this.decrypt(row.encryptedPayload, this.context(ownerId, provider)),
      ),
      revision: row.revision,
    };
  }
  private async requireReconnect(
    ownerId: string,
    provider: ConnectionProvider,
    revision: number,
  ): Promise<void> {
    await this.options.repository.mutate(ownerId, provider, async (row) =>
      row?.revision === revision
        ? this.reconnectWrite(row)
        : (row ?? disconnectedConnection(0)),
    );
  }
  private reconnectWrite(row: ConnectionRecord): ConnectionWrite {
    return {
      ...row,
      status: "reconnect_required",
      enabled: false,
      encryptedPayload: null,
      encryptionKeyId: null,
      revision: row.revision + 1,
    };
  }
  private async settings(
    provider: ConnectionProvider,
  ): Promise<SocialConfiguration> {
    const settings = await this.options.settings.resolve(
      connectionIdentityProvider(provider),
    );
    // Sign-in and data access are independent; disabling Microsoft sign-in
    // does not revoke a user's separately consented file connection.
    if (!settings?.client_id || !settings.client_secret)
      throw new AppError("CONNECTION_NOT_CONFIGURED");
    return settings;
  }
  private context(ownerId: string, provider: ConnectionProvider): string {
    return `account:${ownerId}:${provider}`;
  }
  private encrypt(value: unknown, purpose: string): string {
    return encryptJson(
      value,
      this.options.masterKey,
      this.options.keyId,
      `linksense:connections:v1:${purpose}`,
    );
  }
  private decrypt(value: string, purpose: string): unknown {
    return decryptJson<unknown>(
      value,
      this.options.masterKey,
      this.options.keyId,
      `linksense:connections:v1:${purpose}`,
    );
  }
  private audit(
    ownerId: string,
    provider: ConnectionProvider,
    action: string,
  ): Promise<void> {
    return this.options.audit.write({
      actorId: ownerId,
      action,
      targetType: "connection",
      result: "success",
      metadata: { provider },
    });
  }
}
