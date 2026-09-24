import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  connectionProviderSchema,
  type ConnectionProvider,
} from "@linksense/shared";
import { ConnectionService } from "../src/modules/connections/service.js";
import type {
  ConnectionRecord,
  ConnectionRepository,
  ConnectionWrite,
} from "../src/modules/connections/repository.js";
import type { ConnectionProtocol } from "../src/modules/connections/protocol.js";
import type { WorkspaceAdapter } from "../src/modules/connections/workspace-adapter.js";
import type { ConnectionGraph } from "../src/modules/connections/graph.js";
import type { SocialStateStore } from "../src/modules/social-auth/state.js";
import { AppError } from "../src/lib/errors.js";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const conversation = "00000000-0000-4000-8000-000000000003";
const turn = "00000000-0000-4000-8000-000000000004";
const clock = Date.parse("2026-09-23T00:00:00Z");
function fixture() {
  let now = clock;
  let authVersion = "version-one";
  let tail: Promise<unknown> = Promise.resolve();
  const rows = new Map<string, ConnectionRecord>();
  const states = new Map<string, unknown>();
  const repository: ConnectionRepository = {
    list: async (id) => [...rows.values()].filter((row) => row.ownerId === id),
    get: async (id, provider) => rows.get(`${id}:${provider}`) ?? null,
    authVersion: vi.fn(async () => authVersion),
    assertTurn: vi.fn(async () => undefined),
    mutate: (id, provider, transform) => {
      const pending = tail.then(async () => {
        const key = `${id}:${provider}`;
        const current = rows.get(key) ?? null;
        const next: ConnectionWrite = await transform(current);
        const row: ConnectionRecord = {
          id: conversation,
          ownerId: id,
          provider,
          createdAt: new Date(clock),
          updatedAt: new Date(now),
          ...next,
        };
        rows.set(key, row);
        return row;
      });
      tail = pending.catch(() => undefined);
      return pending;
    },
  };
  const stateStore: SocialStateStore = {
    put: async (key, value) => {
      states.set(key, value);
    },
    read: async <T>(key: string, schema: z.ZodType<T>, consume = false) => {
      const value = states.get(key);
      if (consume) states.delete(key);
      return value === undefined ? null : schema.parse(value);
    },
    throttle: async () => true,
  };
  const token = {
    clientId: "test-client",
    accountId: "account",
    tenantId: other,
    accessToken: "provider-secret-access",
    refreshToken: "provider-secret-refresh",
    expiresAt: clock + 300_000,
    scopes: ["Files.Read"],
  };
  const protocol = {
    start: vi
      .fn<ConnectionProtocol["start"]>()
      .mockImplementation(
        async (_provider, _config, checks) =>
          `https://login.microsoftonline.com/authorize?state=${checks.state}`,
      ),
    complete: vi
      .fn<ConnectionProtocol["complete"]>()
      .mockResolvedValue({ token, accountName: "member@example.test" }),
    refresh: vi
      .fn<ConnectionProtocol["refresh"]>()
      .mockImplementation(async (_provider, _config, value) => ({
        ...value,
        accessToken: "refreshed-access",
        refreshToken: "rotated-refresh",
        expiresAt: now + 300_000,
      })),
  };
  const graph = {
    execute: vi.fn<ConnectionGraph["execute"]>().mockResolvedValue({
      result: { kind: "page", items: [], next_cursor: null },
      nextLink: null,
    }),
  };
  const workspace = {
    execute: vi.fn<WorkspaceAdapter["execute"]>().mockResolvedValue({
      result: { kind: "workspace_data", data: [], next_cursor: null },
      nextLink: null,
    }),
  };
  const settings = {
    resolve: vi.fn(async () => ({
      revision: 1,
      enabled: false,
      client_id: "test-client",
      client_secret: "test-only-app-secret",
    })),
  };
  const audit = { write: vi.fn(async () => undefined) };
  const service = new ConnectionService({
    repository,
    settings,
    states: stateStore,
    protocol,
    graph,
    workspace,
    audit,
    masterKey: "test-only-connection-master",
    keyId: "test",
    now: () => now,
  });
  async function begin(provider: ConnectionProvider = "onedrive") {
    const url = await service.start(owner, provider, "browser-one");
    return { state: new URL(url).searchParams.get("state")!, code: "code" };
  }
  async function connect(provider: ConnectionProvider = "onedrive") {
    await service.complete(provider, await begin(provider), "browser-one");
  }
  return {
    service,
    rows,
    states,
    settings,
    audit,
    protocol,
    graph,
    workspace,
    token,
    repository,
    begin,
    connect,
    advance: () => {
      now += 260_000;
    },
    expireSession: () => {
      authVersion = "changed";
    },
  };
}

describe("personal Microsoft connections", () => {
  it("keeps existing read-only grants usable while requiring fresh user consent for writes", async () => {
    const f = fixture();
    await f.connect();
    expect((await f.service.list(owner))[0]).toMatchObject({
      status: "connected",
      access_mode: "read",
    });
    await expect(
      f.service.execute(owner, conversation, turn, {
        operation: "create_folder",
        provider: "onedrive",
        drive_id: "drive",
        name: "Reports",
      }),
    ).rejects.toMatchObject({ code: "CONNECTION_WRITE_REQUIRED" });
    expect(f.graph.execute).not.toHaveBeenCalled();
    await f.service.execute(owner, conversation, turn, {
      operation: "list_drives",
      provider: "onedrive",
    });
    expect(f.graph.execute).toHaveBeenCalledOnce();
    f.protocol.complete.mockResolvedValue({
      token: { ...f.token, scopes: ["Files.ReadWrite"] },
      accountName: "member@example.test",
    });
    await f.connect();
    expect((await f.service.list(owner))[0]).toMatchObject({
      status: "connected",
      access_mode: "read_write",
    });
    await f.service.execute(owner, conversation, turn, {
      operation: "create_folder",
      provider: "onedrive",
      drive_id: "drive",
      name: "Reports",
    });
    expect(f.repository.assertTurn).toHaveBeenCalledWith(
      owner,
      conversation,
      turn,
      true,
    );
    expect(f.graph.execute).toHaveBeenCalledTimes(2);
  });

  it("reports damaged grants as needing reconnection without exposing ciphertext", async () => {
    const f = fixture();
    await f.connect();
    const row = f.rows.get(`${owner}:onedrive`);
    if (!row) throw new Error("missing connection");
    row.encryptedPayload = "damaged-secret";
    const result = await f.service.list(owner);
    expect(result[0]).toMatchObject({
      status: "reconnect_required",
      access_mode: null,
    });
    expect(JSON.stringify(result)).not.toContain("damaged-secret");
  });
  it("preserves accounts without any connection and separates file access from disabled Microsoft sign-in", async () => {
    const f = fixture();
    expect(await f.service.list(owner)).toEqual(
      connectionProviderSchema.options.map((provider) => ({
        provider,
        configured: true,
        status: "disconnected",
        access_mode: null,
        account_name: null,
        connected_at: null,
      })),
    );
    await f.connect();
    expect((await f.service.list(owner))[0]).toMatchObject({
      status: "connected",
    });
    expect((await f.service.list(other))[0]).toMatchObject({
      status: "disconnected",
    });
    const serialized =
      JSON.stringify([...f.rows.values()]) +
      JSON.stringify([...f.states.values()]) +
      JSON.stringify(f.audit.write.mock.calls);
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("test-only-app-secret");
  });
  it("binds callbacks to the browser, provider and original authenticated session and consumes them once", async () => {
    const f = fixture();
    const parameters = await f.begin();
    await expect(
      f.service.complete("onedrive", parameters, "other-browser"),
    ).rejects.toMatchObject({ code: "CONNECTION_AUTH_FAILED" });
    await expect(
      f.service.complete("sharepoint", parameters, "browser-one"),
    ).rejects.toMatchObject({ code: "CONNECTION_AUTH_FAILED" });
    await f.service.complete("onedrive", parameters, "browser-one");
    await expect(
      f.service.complete("onedrive", parameters, "browser-one"),
    ).rejects.toMatchObject({
      code: "CONNECTION_AUTH_FAILED",
    });
    const next = await f.begin();
    f.expireSession();
    await expect(
      f.service.complete("onedrive", next, "browser-one"),
    ).rejects.toMatchObject({
      code: "CONNECTION_AUTH_FAILED",
    });
  });
  it("does not resurrect credentials when a pending authorization finishes after disconnect", async () => {
    const f = fixture();
    const parameters = await f.begin();
    await f.service.disconnect(owner, "onedrive");
    await expect(
      f.service.complete("onedrive", parameters, "browser-one"),
    ).rejects.toMatchObject({
      code: "CONNECTION_AUTH_FAILED",
    });
    expect(f.rows.get(`${owner}:onedrive`)).toMatchObject({
      encryptedPayload: null,
      status: "disconnected",
    });
  });
  it("refreshes once across concurrent calls and keeps the rotated token encrypted", async () => {
    const f = fixture();
    await f.connect();
    f.advance();
    const request = () =>
      f.service.execute(owner, conversation, turn, {
        operation: "list_drives",
        provider: "onedrive",
      });
    await Promise.all([request(), request()]);
    expect(f.protocol.refresh).toHaveBeenCalledTimes(1);
    expect(f.graph.execute.mock.calls.map((call) => call[0])).toEqual([
      "refreshed-access",
      "refreshed-access",
    ]);
    expect(JSON.stringify([...f.rows.values()])).not.toContain(
      "rotated-refresh",
    );
  });
  it("marks revoked grants for reconnect but preserves a connection after transient refresh failure", async () => {
    const f = fixture();
    await f.connect();
    f.advance();
    f.protocol.refresh.mockRejectedValueOnce(
      new AppError("CONNECTION_UNAVAILABLE"),
    );
    const request = () =>
      f.service.execute(owner, conversation, turn, {
        operation: "list_drives",
        provider: "onedrive",
      });
    await expect(request()).rejects.toMatchObject({
      code: "CONNECTION_UNAVAILABLE",
    });
    expect(f.rows.get(`${owner}:onedrive`)?.status).toBe("connected");
    f.protocol.refresh.mockRejectedValueOnce(
      new AppError("CONNECTION_REQUIRED"),
    );
    await expect(request()).rejects.toMatchObject({
      code: "CONNECTION_REQUIRED",
    });
    expect(f.rows.get(`${owner}:onedrive`)).toMatchObject({
      status: "reconnect_required",
      encryptedPayload: null,
    });
  });
  it("uses previously disabled connected grants by default but denies unowned and concurrently disconnected accounts", async () => {
    const f = fixture();
    await f.connect();
    const request = (id = owner) =>
      f.service.execute(id, conversation, turn, {
        operation: "list_drives",
        provider: "onedrive",
      });
    await expect(request(other)).rejects.toMatchObject({
      code: "CONNECTION_REQUIRED",
    });
    const stored = f.rows.get(`${owner}:onedrive`)!;
    f.rows.set(`${owner}:onedrive`, { ...stored, enabled: false });
    expect((await f.service.list(owner))[0]).toMatchObject({
      status: "connected",
    });
    await expect(request()).resolves.toMatchObject({ kind: "page" });
    expect(f.graph.execute).toHaveBeenCalledOnce();
    f.graph.execute.mockImplementationOnce(async () => {
      await f.service.disconnect(owner, "onedrive");
      return {
        result: { kind: "page", items: [], next_cursor: null },
        nextLink: null,
      };
    });
    await expect(request()).rejects.toMatchObject({
      code: "CONNECTION_REQUIRED",
    });
  });
  it("binds encrypted pagination to owner, provider, request and connection revision", async () => {
    const f = fixture();
    await f.connect();
    f.graph.execute.mockResolvedValue({
      result: { kind: "page", items: [], next_cursor: null },
      nextLink:
        "https://graph.microsoft.com/v1.0/me/drives?$skiptoken=secret-cursor",
    });
    const first = await f.service.execute(owner, conversation, turn, {
      operation: "list_drives",
      provider: "onedrive",
    });
    if (first.kind !== "page" || !first.next_cursor)
      throw new Error("missing cursor");
    expect(first.next_cursor).not.toContain("secret-cursor");
    await f.service.execute(owner, conversation, turn, {
      operation: "list_drives",
      provider: "onedrive",
      cursor: first.next_cursor,
    });
    await expect(
      f.service.execute(owner, conversation, turn, {
        operation: "list_files",
        provider: "onedrive",
        drive_id: "different",
        cursor: first.next_cursor,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await f.connect();
    await expect(
      f.service.execute(owner, conversation, turn, {
        operation: "list_drives",
        provider: "onedrive",
        cursor: first.next_cursor,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
  it("requires active task authorization before even listing personal accounts", async () => {
    const f = fixture();
    vi.mocked(f.repository.assertTurn).mockRejectedValue(
      new AppError("FORBIDDEN"),
    );
    await expect(
      f.service.execute(owner, conversation, turn, {
        operation: "list_connections",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.graph.execute).not.toHaveBeenCalled();
  });
});

describe("workspace connection isolation", () => {
  it.each(["google_docs", "gmail"] as const)(
    "uses Google credentials and encrypted opaque cursors for %s",
    async (provider) => {
      const f = fixture();
      const token = {
        clientId: f.token.clientId,
        accountId: f.token.accountId,
        accessToken: f.token.accessToken,
        refreshToken: f.token.refreshToken,
        expiresAt: f.token.expiresAt,
        scopes: f.token.scopes,
      };
      f.protocol.complete.mockResolvedValue({
        token: {
          ...token,
          scopes: [
            "https://www.googleapis.com/auth/documents",
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/gmail.modify",
          ],
        },
        accountName: "google@example.test",
      });
      await f.connect(provider);
      expect(f.settings.resolve).toHaveBeenCalledWith("google");
      expect((await f.service.list(owner)).find(item => item.provider === provider)).toMatchObject({
        status: "connected",
        access_mode: "read_write",
      });
      f.workspace.execute.mockImplementation(async () => ({
        result: { kind: "workspace_data", data: [], next_cursor: null },
        nextLink: "opaque-google-page-token",
      }));
      const request =
        provider === "gmail"
          ? { provider, operation: "search_mail" as const, query: "meeting" }
          : {
              provider,
              operation: "search_documents" as const,
              query: "meeting",
            };
      const first = await f.service.execute(owner, conversation, turn, request);
      if (first.kind !== "workspace_data" || !first.next_cursor)
        throw new Error("missing cursor");
      expect(first.next_cursor).not.toContain("opaque-google");
      await f.service.execute(owner, conversation, turn, {
        ...request,
        cursor: first.next_cursor,
      });
      expect(f.workspace.execute).toHaveBeenLastCalledWith(
        token.accessToken,
        expect.anything(),
        "opaque-google-page-token",
        undefined,
      );
      expect(f.graph.execute).not.toHaveBeenCalled();
      await expect(
        f.service.execute(other, conversation, turn, request),
      ).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
      await expect(
        f.service.execute(owner, conversation, turn, {
          ...request,
          query: "changed",
          cursor: first.next_cursor,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await f.connect(provider);
      await expect(
        f.service.execute(owner, conversation, turn, {
          ...request,
          cursor: first.next_cursor,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );
  it("requires mail write grants and active task authorization", async () => {
    const f = fixture();
    await f.connect("outlook");
    await expect(
      f.service.execute(owner, conversation, turn, {
        provider: "outlook",
        operation: "send_draft",
        draft_id: "draft",
      }),
    ).rejects.toMatchObject({ code: "CONNECTION_WRITE_REQUIRED" });
    expect(f.workspace.execute).not.toHaveBeenCalled();
    f.protocol.complete.mockResolvedValue({
      token: { ...f.token, scopes: ["Mail.ReadWrite", "Mail.Send"] },
      accountName: "outlook@example.test",
    });
    await f.connect("outlook");
    await f.service.execute(owner, conversation, turn, {
      provider: "outlook",
      operation: "send_draft",
      draft_id: "draft",
    });
    expect(f.repository.assertTurn).toHaveBeenCalledWith(
      owner,
      conversation,
      turn,
      true,
    );
    f.workspace.execute.mockRejectedValueOnce(
      new AppError("CONNECTION_REQUIRED"),
    );
    await expect(
      f.service.execute(owner, conversation, turn, {
        provider: "outlook",
        operation: "read_mail",
        message_id: "message",
      }),
    ).rejects.toMatchObject({ code: "CONNECTION_REQUIRED" });
    expect(f.rows.get(`${owner}:outlook`)?.status).toBe("reconnect_required");
  });
});
