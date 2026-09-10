import type {
  CredentialConfigurationStatus,
  CredentialPluginConfiguration,
} from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import type { CapabilityRecord } from "../capabilities/types.js";
import type {
  MaterializeUserHomes,
  UserHomeCapabilityTargets,
} from "../capabilities/user-home-reconciler.js";
import type {
  CredentialBindingRecord,
  CredentialBindingView,
  CredentialRecord,
  CredentialResolution,
  CredentialStore,
  CredentialUsageReceipt,
  CredentialView,
  RequestActor,
} from "./types.js";

export type CredentialSecretPayload = Record<string, string>;

export interface CredentialServiceOptions {
  store: CredentialStore;
  masterKey: string;
  keyId: string;
  materializeUserHomes?: MaterializeUserHomes;
  now?: () => Date;
}

export interface CreateCredentialInput {
  name: string;
  providerType: string;
  secretPayload: CredentialSecretPayload;
}

export interface PatchCredentialInput {
  name?: string;
  providerType?: string;
  secretPayload?: CredentialSecretPayload;
  secretFields?: CredentialSecretFieldPatch[];
  status?: "active" | "disabled";
}

export interface CredentialSecretFieldPatch {
  key: string;
  previousKey?: string;
  value?: string;
}

export interface SyncCredentialBindingsInput {
  credentialId: string;
  capabilityId: string;
  mappings: Array<{ envKey: string; credentialKey: string }>;
}

type CredentialFieldResolution =
  | { ok: true; value: string; credentialId: string; source: "personal" }
  | {
      ok: false;
      blockCode: Extract<CredentialResolution, { ok: false }>["blockCode"];
      reason: Exclude<CredentialConfigurationStatus, "configured">;
    };

export class CredentialService {
  readonly #store: CredentialStore;
  readonly #masterKey: string;
  readonly #keyId: string;
  readonly #materializeUserHomes: MaterializeUserHomes | undefined;
  readonly #now: () => Date;

  constructor(options: CredentialServiceOptions) {
    this.#store = options.store;
    this.#masterKey = options.masterKey;
    this.#keyId = options.keyId;
    this.#materializeUserHomes = options.materializeUserHomes;
    this.#now = options.now ?? (() => new Date());
  }

  async list(actor: RequestActor): Promise<CredentialView[]> {
    assertActiveActor(actor);
    const credentials = await this.#store.listCredentials();
    return credentials
      .filter((credential) => credential.ownerId === actor.id)
      .map((credential) => this.#credentialView(credential));
  }

  async get(
    actor: RequestActor,
    credentialId: string,
  ): Promise<CredentialView> {
    assertActiveActor(actor);
    const credential = await this.requireCredential(credentialId);
    assertCanManageCredential(actor, credential);
    return this.#credentialView(credential);
  }

  async create(
    actor: RequestActor,
    input: CreateCredentialInput,
  ): Promise<CredentialView> {
    assertActiveActor(actor);
    const name = validateName(input.name);
    const providerType = validateProviderType(input.providerType);
    const secretPayload = validateSecretPayload(input.secretPayload);
    const encryptedPayload = encryptJson(
      secretPayload,
      this.#masterKey,
      this.#keyId,
    );
    const credential = await this.#store.transaction(async (store) => {
      const created = await store.createCredential({
        ownerId: actor.id,
        name,
        providerType,
        encryptedPayload,
        encryptionKeyId: this.#keyId,
        status: "active",
        createdBy: actor.id,
        updatedBy: null,
      });
      await store.writeAudit(
        audit(actor, "credential_created", "credential", created.id, {
          credential_type: providerType,
        }),
      );
      return created;
    });
    return this.#credentialView(credential);
  }

  async patch(
    actor: RequestActor,
    credentialId: string,
    input: PatchCredentialInput,
  ): Promise<CredentialView> {
    assertActiveActor(actor);
    const current = await this.requireCredential(credentialId);
    assertCanManageCredential(actor, current);
    const name =
      input.name === undefined ? undefined : validateName(input.name);
    const providerType =
      input.providerType === undefined
        ? undefined
        : validateProviderType(input.providerType);
    if (input.secretPayload !== undefined && input.secretFields !== undefined) {
      throw new AppError("VALIDATION_ERROR");
    }
    const secretPayload =
      input.secretPayload !== undefined
        ? validateSecretPayload(input.secretPayload)
        : input.secretFields === undefined
          ? undefined
          : this.#applySecretFieldPatch(current, input.secretFields);
    const encryptedPayload =
      secretPayload === undefined
        ? undefined
        : encryptJson(secretPayload, this.#masterKey, this.#keyId);
    const affectsRuntime =
      encryptedPayload !== undefined || input.status !== undefined;
    const affectedBindings = affectsRuntime
      ? (await this.#store.listBindings({ credentialId })).filter(
          (binding) => binding.status === "active",
        )
      : [];
    const updated = await this.#store.transaction(async (store) => {
      const latest = await store.findCredential(credentialId);
      if (latest === null) throw new AppError("CREDENTIAL_NOT_FOUND");
      assertCanManageCredential(actor, latest);
      const value = await store.updateCredential(credentialId, {
        ...(name === undefined ? {} : { name }),
        ...(providerType === undefined ? {} : { providerType }),
        ...(encryptedPayload === undefined
          ? {}
          : { encryptedPayload, encryptionKeyId: this.#keyId }),
        ...(input.status === undefined ? {} : { status: input.status }),
        updatedBy: actor.id,
      });
      await store.writeAudit(
        audit(actor, "credential_updated", "credential", credentialId, {
          changed_name: name !== undefined,
          changed_provider: providerType !== undefined,
          rotated_secret: encryptedPayload !== undefined,
          changed_status: input.status !== undefined,
        }),
      );
      return value;
    });
    if (affectsRuntime) {
      await this.#materializeAffectedUserHomes(
        targetsFromCredentialBindings(affectedBindings),
      );
    }
    return this.#credentialView(updated);
  }

  #credentialView(credential: CredentialRecord): CredentialView {
    return {
      id: credential.id,
      name: credential.name,
      provider_type: credential.providerType,
      secret_keys: this.#secretKeys(credential),
      status: credential.status,
      last_used_at: credential.lastUsedAt?.toISOString() ?? null,
      created_at: credential.createdAt.toISOString(),
      updated_at: credential.updatedAt.toISOString(),
    };
  }

  #secretKeys(credential: CredentialRecord): string[] {
    try {
      return Object.keys(
        validateSecretPayload(
          decryptJson<unknown>(
            credential.encryptedPayload,
            this.#masterKey,
            credential.encryptionKeyId,
          ),
        ),
      );
    } catch {
      return [];
    }
  }

  #applySecretFieldPatch(
    credential: CredentialRecord,
    fields: readonly CredentialSecretFieldPatch[],
  ): CredentialSecretPayload {
    let currentPayload: CredentialSecretPayload;
    try {
      currentPayload = validateSecretPayload(
        decryptJson<unknown>(
          credential.encryptedPayload,
          this.#masterKey,
          credential.encryptionKeyId,
        ),
      );
    } catch {
      throw new AppError("VALIDATION_ERROR");
    }
    const nextPayload: CredentialSecretPayload = {};
    for (const field of fields) {
      const key = validateEnvironmentKey(field.key);
      if (Object.prototype.hasOwnProperty.call(nextPayload, key)) {
        throw new AppError("VALIDATION_ERROR");
      }
      if (field.value !== undefined) {
        nextPayload[key] = validateSecretValue(field.value);
        continue;
      }
      if (field.previousKey === undefined) {
        throw new AppError("VALIDATION_ERROR");
      }
      const previousKey = validateEnvironmentKey(field.previousKey);
      const value = currentPayload[previousKey];
      if (typeof value !== "string") {
        throw new AppError("VALIDATION_ERROR");
      }
      nextPayload[key] = value;
    }
    return validateSecretPayload(nextPayload);
  }

  async delete(actor: RequestActor, credentialId: string): Promise<void> {
    assertActiveActor(actor);
    const credential = await this.requireCredential(credentialId);
    assertCanManageCredential(actor, credential);
    const affectedBindings = await this.#store.transaction(async (store) => {
      const latest = await store.findCredential(credentialId);
      if (latest === null) throw new AppError("CREDENTIAL_NOT_FOUND");
      assertCanManageCredential(actor, latest);
      const bindings = await store.listBindings({ credentialId });
      await store.writeAudit(
        audit(actor, "credential_deleted", "credential", credentialId, {
          revoked_binding_count: bindings.length,
        }),
      );
      await store.deleteCredentialGraph(credentialId);
      return bindings.filter((binding) => binding.status === "active");
    });
    await this.#materializeAffectedUserHomes(
      targetsFromCredentialBindings(affectedBindings),
    );
  }

  async listBindings(actor: RequestActor): Promise<CredentialBindingView[]> {
    assertActiveActor(actor);
    const allBindings = await this.#store.listBindings();
    return allBindings
      .filter((binding) => binding.userId === actor.id)
      .map(bindingView);
  }

  async listPluginConfigurations(
    actor: RequestActor,
  ): Promise<CredentialPluginConfiguration[]> {
    assertActiveActor(actor);
    const bindings = await this.#store.listBindings({
      userId: actor.id,
      status: "active",
    });
    const result: CredentialPluginConfiguration[] = [];
    for (const capabilityId of new Set(
      bindings.map((binding) => binding.capabilityId),
    )) {
      const capability = await this.#store.findCapability(capabilityId);
      if (
        capability === null ||
        capability.type !== "plugin" ||
        capability.status !== "active" ||
        !(await this.#store.canUserUseCapability(actor.id, capabilityId))
      ) {
        result.push({
          capability_id: capabilityId,
          available: false,
          fields: [],
        });
        continue;
      }
      const declared = declaredEnvironmentKeys(capability);
      const pluginBindings = bindings.filter(
        (binding) => binding.capabilityId === capabilityId,
      );
      const keys = [
        ...new Set([
          ...declared,
          ...pluginBindings.map((binding) => binding.envKey),
        ]),
      ];
      const fields: CredentialPluginConfiguration["fields"] = [];
      for (const envKey of keys.filter(isEnvironmentKey)) {
        if (
          !declared.includes(envKey) ||
          declared.filter((key) => key === envKey).length > 1
        ) {
          fields.push({ env_key: envKey, status: "invalid" });
          continue;
        }
        const resolution = await this.#resolvePersonalBindings(
          actor.id,
          pluginBindings.filter((binding) => binding.envKey === envKey),
        );
        fields.push({
          env_key: envKey,
          status: resolution.ok ? "configured" : resolution.reason,
        });
      }
      result.push({ capability_id: capabilityId, available: true, fields });
    }
    return result;
  }

  async syncBindings(
    actor: RequestActor,
    input: SyncCredentialBindingsInput,
  ): Promise<CredentialBindingView[]> {
    assertActiveActor(actor);
    const mappings = validateBindingMappings(input.mappings);
    const credential = await this.requireCredential(input.credentialId);
    const capability = await this.#store.findCapability(input.capabilityId);
    if (capability === null || capability.type !== "plugin") {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    for (const mapping of mappings) {
      assertDeclaredEnvironmentKey(capability, mapping.envKey);
    }
    if (
      credential.ownerId !== actor.id ||
      !(await this.#store.canUserUseCapability(actor.id, capability.id))
    ) {
      throw new AppError("FORBIDDEN");
    }
    if (credential.status !== "active" || capability.status !== "active") {
      throw new AppError("CONFLICT");
    }
    const credentialPayload = this.#credentialPayload(credential);
    for (const mapping of mappings) {
      if (typeof credentialPayload[mapping.credentialKey] !== "string") {
        throw new AppError("VALIDATION_ERROR");
      }
    }

    const changedBindings: CredentialBindingRecord[] = [];
    const active = await this.#store.transaction(async (store) => {
      await store.lockCapability(capability.id);
      await store.lockCredential(credential.id);
      const latestCapability = await store.findCapability(capability.id);
      const latestCredential = await store.findCredential(credential.id);
      if (
        latestCapability === null ||
        latestCapability.type !== "plugin" ||
        latestCapability.status !== "active"
      ) {
        throw new AppError("CAPABILITY_NOT_FOUND");
      }
      if (
        latestCredential === null ||
        latestCredential.ownerId !== actor.id ||
        latestCredential.status !== "active"
      ) {
        throw new AppError("CONFLICT");
      }
      for (const mapping of mappings) {
        assertDeclaredEnvironmentKey(latestCapability, mapping.envKey);
      }
      const latestPayload = this.#credentialPayload(latestCredential);
      for (const mapping of mappings) {
        if (typeof latestPayload[mapping.credentialKey] !== "string") {
          throw new AppError("VALIDATION_ERROR");
        }
      }

      const activeBindings = await store.listBindings({
        capabilityId: capability.id,
        status: "active",
        userId: actor.id,
      });
      const desiredByEnvironment = new Map(
        mappings.map((mapping) => [mapping.envKey, mapping]),
      );
      const unchangedEnvironmentKeys = new Set<string>();
      for (const binding of activeBindings) {
        const desired = desiredByEnvironment.get(binding.envKey);
        const unchanged =
          desired !== undefined &&
          binding.credentialId === credential.id &&
          binding.credentialKey === desired.credentialKey;
        if (unchanged) {
          unchangedEnvironmentKeys.add(binding.envKey);
          continue;
        }
        if (desired === undefined && binding.credentialId !== credential.id) {
          continue;
        }
        const revoked = await store.revokeBinding(
          binding.id,
          actor.id,
          this.#now(),
        );
        changedBindings.push(revoked);
        await store.writeAudit(
          audit(actor, "credential_unbound", "credential_binding", binding.id, {
            capability_id: binding.capabilityId,
          }),
        );
      }

      for (const mapping of mappings) {
        if (unchangedEnvironmentKeys.has(mapping.envKey)) continue;
        const binding = await store.createBinding({
          credentialId: credential.id,
          capabilityId: capability.id,
          userId: actor.id,
          envKey: mapping.envKey,
          credentialKey: mapping.credentialKey,
          status: "active",
          createdBy: actor.id,
        });
        changedBindings.push(binding);
        await store.writeAudit(
          audit(actor, "credential_bound", "credential_binding", binding.id, {
            capability_id: binding.capabilityId,
          }),
        );
      }
      return await store.listBindings({
        capabilityId: capability.id,
        status: "active",
        userId: actor.id,
      });
    });
    if (changedBindings.length > 0) {
      await this.#materializeAffectedUserHomes(
        targetsFromCredentialBindings(changedBindings),
      );
    }
    return active.map(bindingView);
  }

  async revokeBinding(actor: RequestActor, bindingId: string): Promise<void> {
    assertActiveActor(actor);
    const binding = await this.#store.findBinding(bindingId);
    if (binding === null) throw new AppError("NOT_FOUND");
    if (binding.status !== "active") return;
    if (binding.userId !== actor.id) {
      throw new AppError("FORBIDDEN");
    }
    await this.#store.transaction(async (store) => {
      const latest = await store.findBinding(bindingId);
      if (latest === null) throw new AppError("NOT_FOUND");
      if (latest.status !== "active") return;
      await store.revokeBinding(bindingId, actor.id, this.#now());
      await store.writeAudit(
        audit(actor, "credential_unbound", "credential_binding", bindingId, {
          capability_id: latest.capabilityId,
        }),
      );
    });
    await this.#materializeAffectedUserHomes(
      targetsFromCredentialBindings([binding]),
    );
  }

  async revokePluginBindings(
    actor: RequestActor,
    credentialId: string,
    capabilityId: string,
  ): Promise<void> {
    assertActiveActor(actor);
    assertCanManageCredential(
      actor,
      await this.requireCredential(credentialId),
    );
    const revoked = await this.#store.transaction(async (store) => {
      await store.lockCapability(capabilityId);
      await store.lockCredential(credentialId);
      const current = await store.findCredential(credentialId);
      if (!current) throw new AppError("CREDENTIAL_NOT_FOUND");
      assertCanManageCredential(actor, current);
      const bindings = await store.listBindings({
        userId: actor.id,
        credentialId,
        capabilityId,
        status: "active",
      });
      for (const binding of bindings) {
        await store.revokeBinding(binding.id, actor.id, this.#now());
        await store.writeAudit(
          audit(actor, "credential_unbound", "credential_binding", binding.id, {
            capability_id: capabilityId,
          }),
        );
      }
      return bindings;
    });
    await this.#materializeAffectedUserHomes(
      targetsFromCredentialBindings(revoked),
    );
  }

  async resolveForCapability(
    userId: string,
    capabilityId: string,
    requiredEnvironmentKeys?: string[],
  ): Promise<CredentialResolution> {
    const capability = await this.#store.findCapability(capabilityId);
    if (
      capability === null ||
      capability.type !== "plugin" ||
      capability.status !== "active" ||
      !(await this.#store.canUserUseCapability(userId, capabilityId))
    ) {
      return { ok: false, blockCode: "required_credential_unavailable" };
    }
    const requiredKeys =
      requiredEnvironmentKeys ??
      (
        await this.#store.listBindings({
          capabilityId,
          userId,
          status: "active",
        })
      ).map((binding) => binding.envKey);
    if (
      requiredKeys.length !== new Set(requiredKeys).size ||
      requiredKeys.some(
        (key) =>
          !isEnvironmentKey(key) ||
          !declaredEnvironmentKeys(capability).includes(key),
      )
    ) {
      return { ok: false, blockCode: "credential_binding_ambiguous" };
    }
    const environment: Record<string, string> = {};
    const usedCredentialIds = new Set<string>();
    for (const envKey of requiredKeys) {
      const resolution = await this.#resolveEnvironmentKey(
        userId,
        capabilityId,
        envKey,
      );
      if (!resolution.ok) return { ok: false, blockCode: resolution.blockCode };
      environment[envKey] = resolution.value;
      usedCredentialIds.add(resolution.credentialId);
    }
    return {
      ok: true,
      environment,
      usageReceipt: {
        userId,
        capabilityId,
        credentialIds: [...usedCredentialIds].sort(),
      },
    };
  }

  /**
   * Records actual use only after the caller has successfully started a turn.
   * Resolution itself intentionally has no database or audit side effects.
   */
  async commitUsage(receipt: CredentialUsageReceipt): Promise<void> {
    const credentialIds = [...new Set(receipt.credentialIds)].sort();
    if (credentialIds.length === 0) return;
    const at = this.#now();
    await this.#store.transaction(async (store) => {
      for (const credentialId of credentialIds) {
        await store.markCredentialUsed(credentialId, at);
        await store.writeAudit({
          actorId: receipt.userId,
          action: "credential_used",
          targetType: "credential",
          targetId: credentialId,
          result: "success",
          metadata: { capability_id: receipt.capabilityId },
        });
      }
    });
  }

  async resolveOrThrow(
    userId: string,
    capabilityId: string,
    requiredEnvironmentKeys?: string[],
  ): Promise<Record<string, string>> {
    const result = await this.resolveForCapability(
      userId,
      capabilityId,
      requiredEnvironmentKeys,
    );
    if (result.ok) return result.environment;
    throw new AppError(
      result.blockCode === "credential_binding_ambiguous"
        ? "CREDENTIAL_BINDING_CONFLICT"
        : "CREDENTIAL_BINDING_REQUIRED",
    );
  }

  async #resolveEnvironmentKey(
    userId: string,
    capabilityId: string,
    envKey: string,
  ): Promise<CredentialFieldResolution> {
    const activePersonal = await this.#store.listBindings({
      capabilityId,
      userId,
      envKey,
      status: "active",
    });
    return this.#resolvePersonalBindings(userId, activePersonal);
  }

  async #resolvePersonalBindings(
    userId: string,
    activePersonal: CredentialBindingRecord[],
  ): Promise<CredentialFieldResolution> {
    if (activePersonal.length > 1) {
      return {
        ok: false,
        blockCode: "credential_binding_ambiguous",
        reason: "conflict",
      };
    }
    if (activePersonal.length > 0) {
      const binding = activePersonal[0];
      if (!binding) {
        return {
          ok: false,
          blockCode: "credential_binding_ambiguous",
          reason: "conflict",
        };
      }
      const credential = await this.#store.findCredential(binding.credentialId);
      return this.#resolveBoundCredential(credential, binding, userId);
    }

    return {
      ok: false,
      blockCode: "required_credential_unavailable",
      reason: "missing",
    };
  }

  #resolveBoundCredential(
    credential: CredentialRecord | null,
    binding: CredentialBindingRecord,
    userId: string,
  ): CredentialFieldResolution {
    if (
      credential === null ||
      credential.ownerId !== userId ||
      binding.userId !== userId
    ) {
      return {
        ok: false,
        blockCode: "credential_binding_ambiguous",
        reason: "invalid",
      };
    }
    if (credential.status !== "active") {
      return {
        ok: false,
        blockCode: "required_credential_unavailable",
        reason: "disabled",
      };
    }
    let payload: CredentialSecretPayload;
    try {
      payload = validateSecretPayload(
        decryptJson<unknown>(
          credential.encryptedPayload,
          this.#masterKey,
          credential.encryptionKeyId,
        ),
      );
    } catch {
      return {
        ok: false,
        blockCode: "credential_binding_ambiguous",
        reason: "invalid",
      };
    }
    const value = payload[binding.credentialKey];
    if (typeof value !== "string") {
      return {
        ok: false,
        blockCode: "credential_binding_ambiguous",
        reason: "invalid",
      };
    }
    return {
      ok: true,
      value,
      credentialId: credential.id,
      source: "personal",
    };
  }

  #credentialPayload(credential: CredentialRecord): CredentialSecretPayload {
    try {
      return validateSecretPayload(
        decryptJson<unknown>(
          credential.encryptedPayload,
          this.#masterKey,
          credential.encryptionKeyId,
        ),
      );
    } catch {
      throw new AppError("VALIDATION_ERROR");
    }
  }

  async #materializeAffectedUserHomes(
    targets: UserHomeCapabilityTargets,
  ): Promise<void> {
    if (this.#materializeUserHomes === undefined) return;
    try {
      await this.#materializeUserHomes(targets);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
    }
  }

  async requireCredential(credentialId: string): Promise<CredentialRecord> {
    const credential = await this.#store.findCredential(credentialId);
    if (credential === null) throw new AppError("CREDENTIAL_NOT_FOUND");
    return credential;
  }
}

function targetsFromCredentialBindings(
  bindings: readonly CredentialBindingRecord[],
): UserHomeCapabilityTargets {
  return {
    userIds: bindings.map((binding) => binding.userId),
  };
}

function bindingView(binding: CredentialBindingRecord): CredentialBindingView {
  return {
    id: binding.id,
    credential_id: binding.credentialId,
    capability_id: binding.capabilityId,
    env_key: binding.envKey,
    credential_key: binding.credentialKey,
    status: binding.status,
    created_at: binding.createdAt.toISOString(),
    updated_at: binding.updatedAt.toISOString(),
  };
}

function assertCanManageCredential(
  actor: RequestActor,
  credential: CredentialRecord,
): void {
  if (credential.ownerId !== actor.id) {
    throw new AppError("CREDENTIAL_NOT_FOUND");
  }
}

function assertActiveActor(actor: RequestActor): void {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}

function validateName(value: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 160)
    throw new AppError("VALIDATION_ERROR");
  return result;
}

function validateProviderType(value: string): string {
  const result = value.trim();
  if (!/^[a-z0-9]+(?:[_-][a-z0-9]+)*$/u.test(result) || result.length > 80) {
    throw new AppError("VALIDATION_ERROR");
  }
  return result;
}

function validateEnvironmentKey(value: string): string {
  if (!isEnvironmentKey(value)) throw new AppError("VALIDATION_ERROR");
  return value;
}

function isEnvironmentKey(value: string): boolean {
  return (
    value.length <= 120 &&
    value.length > 0 &&
    /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)
  );
}

function validateSecretPayload(value: unknown): CredentialSecretPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("VALIDATION_ERROR");
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 200) {
    throw new AppError("VALIDATION_ERROR");
  }
  const result: CredentialSecretPayload = {};
  for (const [key, secret] of entries) {
    if (!isEnvironmentKey(key)) throw new AppError("VALIDATION_ERROR");
    result[key] = validateSecretValue(secret);
  }
  return result;
}

function validateSecretValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 64 * 1024
  ) {
    throw new AppError("VALIDATION_ERROR");
  }
  return value;
}

function declaredEnvironmentKeys(capability: CapabilityRecord): string[] {
  const value = capability.riskSummaryJson?.declared_environment_keys;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function assertDeclaredEnvironmentKey(
  capability: CapabilityRecord,
  envKey: string,
): void {
  if (!declaredEnvironmentKeys(capability).includes(envKey)) {
    throw new AppError("VALIDATION_ERROR");
  }
}

function validateBindingMappings(
  mappings: Array<{ envKey: string; credentialKey: string }>,
): Array<{ envKey: string; credentialKey: string }> {
  if (mappings.length > 1_000) throw new AppError("VALIDATION_ERROR");
  const result = mappings.map((mapping) => ({
    envKey: validateEnvironmentKey(mapping.envKey),
    credentialKey: validateEnvironmentKey(mapping.credentialKey),
  }));
  if (new Set(result.map((mapping) => mapping.envKey)).size !== result.length) {
    throw new AppError("VALIDATION_ERROR");
  }
  return result;
}

function audit(
  actor: RequestActor,
  action: string,
  targetType: "credential" | "credential_binding",
  targetId: string,
  metadata: Record<string, unknown>,
) {
  return {
    actorId: actor.id,
    action,
    targetType,
    targetId,
    result: "success" as const,
    metadata,
    ...(actor.ipAddress === undefined ? {} : { ipAddress: actor.ipAddress }),
    ...(actor.userAgent === undefined ? {} : { userAgent: actor.userAgent }),
  };
}
