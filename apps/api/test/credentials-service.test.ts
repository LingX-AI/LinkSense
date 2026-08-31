import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

import { decryptJson, encryptJson } from "../src/lib/crypto.js";
import { sendAppError } from "../src/lib/http.js";
import type {
  CapabilityRecord,
  RequestActor,
} from "../src/modules/capabilities/types.js";
import { credentialRoutes } from "../src/modules/credentials/routes.js";
import { CredentialService } from "../src/modules/credentials/service.js";
import type {
  CreateCredentialBindingRecordInput,
  CreateCredentialRecordInput,
  CredentialAuditInput,
  CredentialBindingRecord,
  CredentialRecord,
  CredentialStore,
  UpdateCredentialRecordInput,
} from "../src/modules/credentials/types.js";

type MaterializeUserHomes = NonNullable<
  ConstructorParameters<typeof CredentialService>[0]["materializeUserHomes"]
>;

const USER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_ID = "10000000-0000-4000-8000-000000000002";
const ADMIN_ID = "10000000-0000-4000-8000-000000000003";
const CAPABILITY_ID = "20000000-0000-4000-8000-000000000001";
const PERSONAL_CREDENTIAL_ID = "30000000-0000-4000-8000-000000000001";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const KEY_ID = "public-key-2026-01";
const NOW = new Date("2026-07-11T01:00:00.000Z");

describe("CredentialService encryption and boundaries", () => {
  it("stores AES-GCM ciphertext and never returns plaintext or ciphertext in API views", async () => {
    const store = baseStore();
    const service = createService(store);

    const view = await service.create(userActor(), {
      name: "My API key",
      providerType: "custom_api_key",
      secretPayload: { API_KEY: "top-secret-value" },
    });

    const record = store.credentials[0];
    expect(record).toBeDefined();
    expect(record?.encryptedPayload).not.toContain("top-secret-value");
    expect(
      decryptJson<Record<string, string>>(
        record?.encryptedPayload ?? "",
        MASTER_KEY,
        KEY_ID,
      ),
    ).toEqual({ API_KEY: "top-secret-value" });
    expect(JSON.stringify(view)).not.toContain("top-secret-value");
    expect(JSON.stringify(view)).not.toContain("encrypted");
    expect(JSON.stringify(view)).not.toContain(KEY_ID);
  });

  it("hard-deletes encrypted credentials and all active or revoked bindings", async () => {
    const store = baseStore();
    store.credentials.push(personalCredential());
    store.bindings.push(
      binding({
        id: "40000000-0000-4000-8000-000000000001",
        credentialId: PERSONAL_CREDENTIAL_ID,
        status: "active",
      }),
      binding({
        id: "40000000-0000-4000-8000-000000000002",
        credentialId: PERSONAL_CREDENTIAL_ID,
        status: "revoked",
      }),
    );
    const service = createService(store);

    await service.delete(userActor(), PERSONAL_CREDENTIAL_ID);

    expect(store.credentials).toEqual([]);
    expect(store.bindings).toEqual([]);
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        action: "credential_deleted",
        targetId: PERSONAL_CREDENTIAL_ID,
      }),
    );
    expect(JSON.stringify(store.audits)).not.toContain("personal-secret");
  });

  it("keeps daily unbinding as a revoked history row", async () => {
    const store = baseStore();
    store.credentials.push(personalCredential());
    store.bindings.push(
      binding({
        id: "40000000-0000-4000-8000-000000000001",
        credentialId: PERSONAL_CREDENTIAL_ID,
      }),
    );
    const service = createService(store);

    await service.revokeBinding(
      userActor(),
      "40000000-0000-4000-8000-000000000001",
    );

    expect(store.bindings).toHaveLength(1);
    expect(store.bindings[0]).toMatchObject({
      status: "revoked",
      revokedBy: USER_ID,
      revokedAt: NOW,
    });
  });

  it("requires an explicitly declared capability and environment key", async () => {
    const store = baseStore();
    store.credentials.push(personalCredential());
    const service = createService(store);

    await expect(
      service.syncBindings(userActor(), {
        credentialId: PERSONAL_CREDENTIAL_ID,
        capabilityId: CAPABILITY_ID,
        mappings: [
          { envKey: "UNDECLARED_KEY", credentialKey: "API_KEY" },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(store.bindings).toEqual([]);
  });

  it("reconciles affected users after credential runtime changes", async () => {
    const personalStore = baseStore();
    personalStore.credentials.push(personalCredential());
    const materializePersonal = vi.fn<MaterializeUserHomes>(
      async () => undefined,
    );
    const personalService = createService(personalStore, materializePersonal);
    const personalBindings = await personalService.syncBindings(userActor(), {
      credentialId: PERSONAL_CREDENTIAL_ID,
      capabilityId: CAPABILITY_ID,
      mappings: [{ envKey: "API_KEY", credentialKey: "API_KEY" }],
    });
    await personalService.patch(userActor(), PERSONAL_CREDENTIAL_ID, {
      secretPayload: { API_KEY: "rotated-secret" },
    });
    await personalService.revokeBinding(
      userActor(),
      personalBindings[0]!.id,
    );

    expect(materializePersonal.mock.calls.map(([targets]) => targets)).toEqual([
      { userIds: [USER_ID] },
      { userIds: [USER_ID] },
      { userIds: [USER_ID] },
    ]);
  });
});

describe("CredentialService strict runtime resolution", () => {
  it("keeps native MCP environment references optional when no binding exists", async () => {
    const store = baseStore();
    store.capabilities[0] = capability({
      riskSummaryJson: {
        declared_environment_keys: ["API_KEY"],
      },
    });

    await expect(
      createService(store).resolveForCapability(USER_ID, CAPABILITY_ID),
    ).resolves.toEqual({
      ok: true,
      environment: {},
      usageReceipt: {
        userId: USER_ID,
        capabilityId: CAPABILITY_ID,
        credentialIds: [],
      },
    });
  });

  it("uses the unique active personal binding", async () => {
    const store = resolvedStore();
    store.bindings.push(
      binding({
        id: "40000000-0000-4000-8000-000000000001",
        credentialId: PERSONAL_CREDENTIAL_ID,
      }),
    );
    const service = createService(store);

    await expect(
      service.resolveForCapability(USER_ID, CAPABILITY_ID, ["API_KEY"]),
    ).resolves.toMatchObject({
      ok: true,
      environment: { API_KEY: "personal-secret" },
      usageReceipt: {
        userId: USER_ID,
        capabilityId: CAPABILITY_ID,
        credentialIds: [PERSONAL_CREDENTIAL_ID],
      },
    });
    expect(store.usedCredentialIds).toEqual([]);
    expect(store.audits).not.toContainEqual(
      expect.objectContaining({ action: "credential_used" }),
    );
  });

  it("resolves a plugin environment name from a differently named credential field", async () => {
    const store = resolvedStore();
    store.credentials[0] = personalCredential({
      encryptedPayload: encryptJson(
        { STORED_CLIENT_SECRET: "mapped-secret" },
        MASTER_KEY,
        KEY_ID,
      ),
    });
    store.bindings.push(
      binding({
        credentialId: PERSONAL_CREDENTIAL_ID,
        envKey: "API_KEY",
        credentialKey: "STORED_CLIENT_SECRET",
      }),
    );

    await expect(
      createService(store).resolveForCapability(USER_ID, CAPABILITY_ID),
    ).resolves.toMatchObject({
      ok: true,
      environment: { API_KEY: "mapped-secret" },
    });
  });

  it("synchronizes multiple field mappings in one transaction", async () => {
    const store = baseStore();
    store.capabilities[0] = capability({
      riskSummaryJson: {
        declared_environment_keys: ["CLIENT_ID", "CLIENT_SECRET"],
      },
    });
    store.credentials.push(
      personalCredential({
        encryptedPayload: encryptJson(
          { id_value: "client-id", secret_value: "client-secret" },
          MASTER_KEY,
          KEY_ID,
        ),
      }),
    );

    const bindings = await createService(store).syncBindings(userActor(), {
      credentialId: PERSONAL_CREDENTIAL_ID,
      capabilityId: CAPABILITY_ID,
      mappings: [
        { envKey: "CLIENT_ID", credentialKey: "id_value" },
        { envKey: "CLIENT_SECRET", credentialKey: "secret_value" },
      ],
    });

    expect(bindings).toEqual([
      expect.objectContaining({
        env_key: "CLIENT_ID",
        credential_key: "id_value",
      }),
      expect.objectContaining({
        env_key: "CLIENT_SECRET",
        credential_key: "secret_value",
      }),
    ]);
    expect(store.bindings).toHaveLength(2);
  });

  it("blocks a revoked personal binding", async () => {
    const store = resolvedStore();
    store.bindings.push(
      binding({
        credentialId: PERSONAL_CREDENTIAL_ID,
        status: "revoked",
      }),
    );

    await expect(
      createService(store).resolveForCapability(USER_ID, CAPABILITY_ID, [
        "API_KEY",
      ]),
    ).resolves.toEqual({
      ok: false,
      blockCode: "required_credential_unavailable",
    });
    expect(store.usedCredentialIds).toEqual([]);
  });

  it("blocks a disabled personal credential", async () => {
    const store = resolvedStore();
    store.credentials[0] = personalCredential({ status: "disabled" });
    store.bindings.push(binding({ credentialId: PERSONAL_CREDENTIAL_ID }));
    const service = createService(store);

    const result = await service.resolveForCapability(USER_ID, CAPABILITY_ID, [
      "API_KEY",
    ]);
    expect(result).toEqual({
      ok: false,
      blockCode: "required_credential_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(PERSONAL_CREDENTIAL_ID);
    expect(JSON.stringify(result)).not.toContain("personal-secret");
  });

  it("returns a stable ambiguous code for duplicate or inconsistent candidates without identifiers", async () => {
    const duplicateStore = resolvedStore();
    duplicateStore.bindings.push(
      binding({
        id: "40000000-0000-4000-8000-000000000001",
        credentialId: PERSONAL_CREDENTIAL_ID,
      }),
      binding({
        id: "40000000-0000-4000-8000-000000000002",
        credentialId: PERSONAL_CREDENTIAL_ID,
      }),
    );
    const duplicate = await createService(duplicateStore).resolveForCapability(
      USER_ID,
      CAPABILITY_ID,
      ["API_KEY"],
    );
    expect(duplicate).toEqual({
      ok: false,
      blockCode: "credential_binding_ambiguous",
    });

    const inconsistentStore = resolvedStore();
    inconsistentStore.credentials[0] = personalCredential({
      ownerId: OTHER_ID,
    });
    inconsistentStore.bindings.push(
      binding({ credentialId: PERSONAL_CREDENTIAL_ID }),
    );
    const inconsistent = await createService(
      inconsistentStore,
    ).resolveForCapability(USER_ID, CAPABILITY_ID, ["API_KEY"]);
    expect(inconsistent).toEqual({
      ok: false,
      blockCode: "credential_binding_ambiguous",
    });
    expect(JSON.stringify({ duplicate, inconsistent })).not.toContain(
      PERSONAL_CREDENTIAL_ID,
    );
    expect(JSON.stringify({ duplicate, inconsistent })).not.toContain("secret");
  });

  it("maps preflight blocks to stable API errors without secret params", async () => {
    const store = resolvedStore();
    const service = createService(store);

    await expect(
      service.resolveOrThrow(USER_ID, CAPABILITY_ID, ["API_KEY"]),
    ).rejects.toMatchObject({
      code: "CREDENTIAL_BINDING_REQUIRED",
      params: undefined,
    });
  });

  it("updates last-used metadata and writes usage audit only when usage is committed", async () => {
    const store = resolvedStore();
    store.bindings.push(binding({ credentialId: PERSONAL_CREDENTIAL_ID }));
    const service = createService(store);
    const resolution = await service.resolveForCapability(
      USER_ID,
      CAPABILITY_ID,
      ["API_KEY"],
    );
    if (!resolution.ok)
      throw new Error("expected successful credential resolution");

    expect(store.usedCredentialIds).toEqual([]);
    expect(store.audits).not.toContainEqual(
      expect.objectContaining({ action: "credential_used" }),
    );

    await service.commitUsage(resolution.usageReceipt);

    expect(store.usedCredentialIds).toEqual([PERSONAL_CREDENTIAL_ID]);
    expect(store.audits).toContainEqual(
      expect.objectContaining({
        actorId: USER_ID,
        action: "credential_used",
        targetId: PERSONAL_CREDENTIAL_ID,
        metadata: { capability_id: CAPABILITY_ID },
      }),
    );
    expect(JSON.stringify(store.audits)).not.toContain("personal-secret");
  });

  it("projects only the effective credential source for each declared key", async () => {
    const personalStore = resolvedStore();
    personalStore.bindings.push(
      binding({ credentialId: PERSONAL_CREDENTIAL_ID }),
    );
    await expect(
      createService(personalStore).listEffectiveBindings(
        userActor(),
        CAPABILITY_ID,
      ),
    ).resolves.toEqual([
      {
        capability_id: CAPABILITY_ID,
        env_key: "API_KEY",
        effective_source: "personal",
      },
    ]);

    const revokedPersonalStore = resolvedStore();
    revokedPersonalStore.bindings.push(
      binding({ credentialId: PERSONAL_CREDENTIAL_ID, status: "revoked" }),
    );
    await expect(
      createService(revokedPersonalStore).listEffectiveBindings(
        userActor(),
        CAPABILITY_ID,
      ),
    ).resolves.toEqual([
      expect.objectContaining({ effective_source: "missing" }),
    ]);

    const ambiguousStore = resolvedStore();
    ambiguousStore.bindings.push(
      binding({
        id: "40000000-0000-4000-8000-000000000001",
        credentialId: PERSONAL_CREDENTIAL_ID,
      }),
      binding({
        id: "40000000-0000-4000-8000-000000000002",
        credentialId: PERSONAL_CREDENTIAL_ID,
      }),
    );
    const ambiguous = await createService(ambiguousStore).listEffectiveBindings(
      userActor(),
      CAPABILITY_ID,
    );
    expect(ambiguous).toEqual([
      expect.objectContaining({ effective_source: "conflict" }),
    ]);
    expect(JSON.stringify({ personalStore, ambiguous })).not.toContain(
      "personal-secret",
    );
  });
});

describe("credential Fastify routes", () => {
  it("rejects removed credential scopes and no longer exposes the legacy binding route", async () => {
    const store = baseStore();
    store.credentials.push(personalCredential({ ownerId: ADMIN_ID }));
    const service = createService(store);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(credentialRoutes, {
      prefix: "/api/v1/credentials",
      service,
      resolveActor: () => adminActor(),
    });

    const credentialResponse = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      payload: {
        scope: "public",
        name: "Legacy shared key",
        provider_type: "custom_api_key",
        secret_payload: { API_KEY: "legacy-secret" },
      },
    });
    expect(credentialResponse.statusCode).toBe(400);

    const credentialListResponse = await app.inject({
      method: "GET",
      url: "/api/v1/credentials?scope=public",
    });
    expect(credentialListResponse.statusCode).toBe(400);

    const bindingResponse = await app.inject({
      method: "POST",
      url: "/api/v1/credentials/bindings",
      payload: {
        credential_id: store.credentials[0]!.id,
        capability_id: CAPABILITY_ID,
        binding_scope: "public",
        env_key: "API_KEY",
      },
    });
    expect(bindingResponse.statusCode).toBe(404);
    await app.close();
  });

  it("rejects invalid credential provider types and secret field names", async () => {
    const store = baseStore();
    const service = createService(store);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(credentialRoutes, {
      prefix: "/api/v1/credentials",
      service,
      resolveActor: () => userActor(),
    });

    const providerTypeResponse = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      payload: {
        name: "测试",
        provider_type: "测试",
        secret_payload: { test1: "12345", test2: "123456" },
      },
    });
    expect(providerTypeResponse.statusCode).toBe(400);
    expect(providerTypeResponse.json()).toMatchObject({
      success: false,
      error_code: "VALIDATION_ERROR",
    });

    const secretKeyResponse = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      payload: {
        name: "Private key",
        provider_type: "custom_api_key",
        secret_payload: { "api-key": "secret" },
      },
    });
    expect(secretKeyResponse.statusCode).toBe(400);
    expect(store.credentials).toEqual([]);
    await app.close();
  });

  it("creates and lists personal credentials without echoing secret material", async () => {
    const store = baseStore();
    const service = createService(store);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(credentialRoutes, {
      prefix: "/api/v1/credentials",
      service,
      resolveActor: () => userActor(),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/credentials",
      payload: {
        name: "Private key",
        provider_type: "custom_api_key",
        secret_payload: { API_KEY: "do-not-echo" },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        name: "Private key",
        provider_type: "custom_api_key",
        secret_keys: ["API_KEY"],
      },
    });
    expect(response.body).not.toContain("do-not-echo");
    expect(response.body).not.toContain("encrypted");
    expect(response.body).not.toContain(KEY_ID);
    expect(response.body).not.toContain('"scope"');

    const listResponse = await app.inject({
      method: "GET",
      url: "/api/v1/credentials",
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            name: "Private key",
            provider_type: "custom_api_key",
            secret_keys: ["API_KEY"],
          },
        ],
      },
    });
    expect(listResponse.body).not.toContain("do-not-echo");
    expect(listResponse.body).not.toContain("encrypted");

    store.bindings.push(binding({ credentialId: PERSONAL_CREDENTIAL_ID }));
    const effectiveResponse = await app.inject({
      method: "GET",
      url:
        "/api/v1/credentials/effective-bindings?capability_id=" + CAPABILITY_ID,
    });
    expect(effectiveResponse.statusCode).toBe(200);
    expect(effectiveResponse.json()).toMatchObject({
      success: true,
      data: {
        items: [
          {
            capability_id: CAPABILITY_ID,
            env_key: "API_KEY",
            effective_source: "personal",
          },
        ],
      },
    });
    expect(effectiveResponse.body).not.toContain(PERSONAL_CREDENTIAL_ID);
    expect(effectiveResponse.body).not.toContain("personal-secret");
    expect(effectiveResponse.body).not.toContain("Personal");

    await app.close();
  });

  it("updates secret field names while preserving hidden values", async () => {
    const store = baseStore();
    store.credentials.push(
      personalCredential({
        encryptedPayload: encryptJson(
          { API_KEY: "old-key", API_SECRET: "old-secret" },
          MASTER_KEY,
          KEY_ID,
        ),
      }),
    );
    const service = createService(store);
    const app = Fastify();
    app.setErrorHandler((error, request, reply) =>
      sendAppError(reply, request, error),
    );
    await app.register(credentialRoutes, {
      prefix: "/api/v1/credentials",
      service,
      resolveActor: () => userActor(),
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/credentials/${PERSONAL_CREDENTIAL_ID}`,
      payload: {
        name: "Private key",
        provider_type: "custom_api_key",
        secret_fields: [
          { key: "RENAMED_API_KEY", previous_key: "API_KEY" },
          { key: "API_SECRET", previous_key: "API_SECRET", value: "rotated" },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        secret_keys: ["RENAMED_API_KEY", "API_SECRET"],
      },
    });
    expect(response.body).not.toContain("old-key");
    expect(response.body).not.toContain("old-secret");
    expect(response.body).not.toContain("rotated");
    expect(
      decryptJson<Record<string, string>>(
        store.credentials[0]?.encryptedPayload ?? "",
        MASTER_KEY,
        KEY_ID,
      ),
    ).toEqual({ RENAMED_API_KEY: "old-key", API_SECRET: "rotated" });

    await app.close();
  });
});

function createService(
  store: MemoryCredentialStore,
  materializeUserHomes?: ConstructorParameters<
    typeof CredentialService
  >[0]["materializeUserHomes"],
) {
  return new CredentialService({
    store,
    masterKey: MASTER_KEY,
    keyId: KEY_ID,
    ...(materializeUserHomes ? { materializeUserHomes } : {}),
    now: () => NOW,
  });
}

function baseStore(): MemoryCredentialStore {
  const store = new MemoryCredentialStore();
  store.capabilities.push(capability());
  store.usableCapabilityIds.add(CAPABILITY_ID);
  return store;
}

function resolvedStore(): MemoryCredentialStore {
  const store = baseStore();
  store.credentials.push(personalCredential());
  return store;
}

function userActor(): RequestActor {
  return { id: USER_ID, role: "user", status: "active" };
}

function adminActor(): RequestActor {
  return { id: ADMIN_ID, role: "admin", status: "active" };
}

function capability(
  overrides: Partial<CapabilityRecord> = {},
): CapabilityRecord {
  return {
    id: CAPABILITY_ID,
    type: "plugin",
    ownerId: USER_ID,
    name: "API Plugin",
    slug: "api-plugin",
    description: null,
    sourceType: "local",
    marketplaceListingId: null,
    marketplaceReleaseId: null,
    logoObjectKey: null,
    storagePath: "/private/plugin",
    manifestJson: { name: "API Plugin" },
    riskSummaryJson: { declared_environment_keys: ["API_KEY"] },
    status: "active",
    installedBy: USER_ID,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function personalCredential(
  overrides: Partial<CredentialRecord> = {},
): CredentialRecord {
  return {
    id: PERSONAL_CREDENTIAL_ID,
    ownerId: USER_ID,
    name: "Personal",
    providerType: "custom_api_key",
    encryptedPayload: encryptJson(
      { API_KEY: "personal-secret" },
      MASTER_KEY,
      KEY_ID,
    ),
    encryptionKeyId: KEY_ID,
    status: "active",
    createdBy: USER_ID,
    updatedBy: null,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function binding(
  overrides: Partial<CredentialBindingRecord> & {
    credentialId: string;
  },
): CredentialBindingRecord {
  const {
    credentialId,
    credentialKey = "API_KEY",
    ...remainingOverrides
  } = overrides;
  return {
    id: "40000000-0000-4000-8000-000000000001",
    credentialId,
    capabilityId: CAPABILITY_ID,
    userId: USER_ID,
    envKey: "API_KEY",
    credentialKey,
    status: "active",
    createdBy: USER_ID,
    revokedBy: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...remainingOverrides,
  };
}

class MemoryCredentialStore implements CredentialStore {
  credentials: CredentialRecord[] = [];
  bindings: CredentialBindingRecord[] = [];
  capabilities: CapabilityRecord[] = [];
  usableCapabilityIds = new Set<string>();
  audits: CredentialAuditInput[] = [];
  usedCredentialIds: string[] = [];
  next = 1;

  transaction<T>(work: (store: CredentialStore) => Promise<T>): Promise<T> {
    return work(this);
  }

  async lockCapability(): Promise<void> {
    // In-memory tests execute transactions serially.
  }

  async lockCredential(): Promise<void> {
    // In-memory tests execute transactions serially.
  }

  async findCredential(id: string) {
    return this.credentials.find((credential) => credential.id === id) ?? null;
  }

  async listCredentials() {
    return [...this.credentials];
  }

  async createCredential(input: CreateCredentialRecordInput) {
    const record: CredentialRecord = {
      ...input,
      id:
        input.id ??
        "30000000-0000-4000-8000-" + String(this.next++).padStart(12, "0"),
      lastUsedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.credentials.push(record);
    return record;
  }

  async updateCredential(id: string, input: UpdateCredentialRecordInput) {
    const credential = await this.findCredential(id);
    if (!credential) throw new Error("missing credential");
    Object.assign(credential, input, { updatedAt: NOW });
    return credential;
  }

  async markCredentialUsed(id: string, at: Date) {
    const credential = await this.findCredential(id);
    if (!credential) throw new Error("missing credential");
    credential.lastUsedAt = at;
    this.usedCredentialIds.push(id);
  }

  async deleteCredentialGraph(id: string) {
    this.credentials = this.credentials.filter(
      (credential) => credential.id !== id,
    );
    this.bindings = this.bindings.filter(
      (binding) => binding.credentialId !== id,
    );
  }

  async findBinding(id: string) {
    return this.bindings.find((item) => item.id === id) ?? null;
  }

  async listBindings(input?: {
    capabilityId?: string;
    credentialId?: string;
    userId?: string;
    envKey?: string;
    credentialKey?: string;
    status?: "active" | "revoked";
  }) {
    return this.bindings.filter(
      (item) =>
        (input?.capabilityId === undefined ||
          item.capabilityId === input.capabilityId) &&
        (input?.credentialId === undefined ||
          item.credentialId === input.credentialId) &&
        (!input || !("userId" in input) || item.userId === input.userId) &&
        (input?.envKey === undefined || item.envKey === input.envKey) &&
        (input?.credentialKey === undefined ||
          item.credentialKey === input.credentialKey) &&
        (input?.status === undefined || item.status === input.status),
    );
  }

  async createBinding(input: CreateCredentialBindingRecordInput) {
    const record: CredentialBindingRecord = {
      ...input,
      id:
        input.id ??
        "40000000-0000-4000-8000-" + String(this.next++).padStart(12, "0"),
      revokedBy: null,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    this.bindings.push(record);
    return record;
  }

  async revokeBinding(id: string, actorId: string, at: Date) {
    const value = await this.findBinding(id);
    if (!value) throw new Error("missing binding");
    value.status = "revoked";
    value.revokedBy = actorId;
    value.revokedAt = at;
    return value;
  }

  async findCapability(id: string) {
    return this.capabilities.find((item) => item.id === id) ?? null;
  }

  async canUserUseCapability(_userId: string, capabilityId: string) {
    return this.usableCapabilityIds.has(capabilityId);
  }

  async writeAudit(input: CredentialAuditInput) {
    this.audits.push(input);
  }
}
