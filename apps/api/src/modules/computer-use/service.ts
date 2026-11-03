import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  COMPUTER_USE_COMMAND_TTL_MS, computerUseCommandSchema, computerUseControlSchema,
  computerUseDeviceSchema, computerUseFailure, computerUsePermissionsSchema,
  computerUseResultSchema,
  type ComputerUseCommand, type ComputerUseRequest, type ComputerUseResult,
  type ComputerUseStatus,
} from "@linksense/shared";
import type { BrowserStore } from "../browser-use/store.js";
import { AppError } from "../../lib/errors.js";

const credentialTtl = 30 * 24 * 60 * 60 * 1000;
const connectionTtl = 40_000;
const commandTtl = COMPUTER_USE_COMMAND_TTL_MS + 5_000;
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const key = (owner: string, name: string): string => `computer-use:${owner}:${name}`;
const pairingSchema = z.strictObject({
  owner: z.uuid(), auth_valid_after: z.string(), epoch: z.uuid(), origin: z.url(),
});
const credentialSchema = pairingSchema.extend({ device: computerUseDeviceSchema });
const connectionSchema = z.strictObject({
  id: z.uuid(), hash: z.string(), control: computerUseControlSchema,
  permissions: computerUsePermissionsSchema,
});
export type ComputerUseCredential = z.infer<typeof credentialSchema>;

export class ComputerUseService {
  constructor(readonly store: BrowserStore, readonly endpoint: string) {}

  async pairing(owner: string, authValidAfter: string) {
    if (!await this.store.put(key(owner, "pair-rate"), "1", 1_000, true))
      throw new AppError("CONFLICT", undefined, 429);
    await this.store.put(key(owner, "epoch"), randomUUID(), credentialTtl, true);
    const epoch = await this.store.get(key(owner, "epoch"));
    if (!epoch) throw new AppError("CONFLICT");
    const code = randomBytes(32).toString("base64url");
    await this.store.put(`computer-use:pair:${hash(code)}`, JSON.stringify({
      owner, auth_valid_after: authValidAfter, epoch, origin: new URL(this.endpoint).origin,
    }), 120_000);
    return { code, endpoint: this.endpoint, expires_at: new Date(Date.now() + 120_000).toISOString() };
  }

  async pair(code: string, name: string, platform: z.infer<typeof computerUseDeviceSchema>["platform"]) {
    const raw = await this.store.take(`computer-use:pair:${hash(code)}`);
    if (!raw) throw new AppError("AUTH_REQUIRED");
    const pairing = pairingSchema.parse(JSON.parse(raw));
    const token = randomBytes(32).toString("base64url");
    const device = { id: randomUUID(), name, platform };
    const digest = hash(token);
    await this.store.put(`computer-use:credential:${digest}`, JSON.stringify({ ...pairing, device }), credentialTtl);
    // A revoked pairing code cannot recreate credentials after revocation.
    if (!await this.store.putIf(key(pairing.owner, "credential"), digest, credentialTtl, key(pairing.owner, "epoch"), pairing.epoch)) {
      await this.store.remove(`computer-use:credential:${digest}`);
      throw new AppError("AUTH_REQUIRED");
    }
    return { token, device };
  }

  async authenticate(token: string): Promise<ComputerUseCredential | null> {
    return this.credentialForHash(hash(token));
  }

  private async credentialForHash(digest: string): Promise<ComputerUseCredential | null> {
    const raw = await this.store.get(`computer-use:credential:${digest}`);
    if (!raw) return null;
    const credential = credentialSchema.parse(JSON.parse(raw));
    return credential.origin === new URL(this.endpoint).origin &&
      await this.store.get(key(credential.owner, "credential")) === digest &&
      await this.store.get(key(credential.owner, "epoch")) === credential.epoch
      ? credential : null;
  }

  private async connection(owner: string) {
    const raw = await this.store.get(key(owner, "connection"));
    if (!raw) return null;
    const value = connectionSchema.parse(JSON.parse(raw));
    const credential = await this.credentialForHash(value.hash);
    return credential?.owner === owner ? { raw, value, credential } : null;
  }

  async connect(credential: ComputerUseCredential, token: string): Promise<string> {
    const id = randomUUID();
    const accepted = await this.store.putIf(key(credential.owner, "connection"), JSON.stringify({
      id, hash: hash(token), control: "ready",
      permissions: { accessibility: "unknown", screen_recording: "unknown" },
    }), connectionTtl, key(credential.owner, "credential"), hash(token));
    if (!accepted || !await this.authenticate(token)) throw new AppError("AUTH_REQUIRED");
    return id;
  }

  async status(owner: string): Promise<ComputerUseStatus> {
    const current = await this.connection(owner);
    if (current) return {
      connected: true, device: current.credential.device,
      control: await this.store.get(key(owner, "paused")) === current.value.id ? "paused" : current.value.control,
      permissions: current.value.permissions,
    };
    const digest = await this.store.get(key(owner, "credential"));
    const credential = digest ? await this.credentialForHash(digest) : null;
    return { connected: false, ...(credential ? { device: credential.device } : {}) };
  }

  async maintain(owner: string, id: string, update?: {
    control: z.infer<typeof computerUseControlSchema>;
    permissions: z.infer<typeof computerUsePermissionsSchema>;
  }): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await this.connection(owner);
      if (current?.value.id !== id) return false;
      if (!update) {
        if (await this.store.touch(key(owner, "connection"), current.raw, connectionTtl)) return true;
      } else {
        const paused = await this.store.get(key(owner, "paused")) === id;
        if (await this.store.putIf(key(owner, "connection"), JSON.stringify({
          ...current.value, ...update, ...(paused ? { control: "paused" } : {}),
        }), connectionTtl, key(owner, "connection"), current.raw)) return true;
      }
    }
    return (await this.connection(owner))?.value.id === id;
  }

  async pause(owner: string, id: string): Promise<void> {
    let accepted = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await this.connection(owner);
      if (current?.value.id !== id) return;
      accepted = await this.store.putIf(key(owner, "paused"), id, credentialTtl, key(owner, "connection"), current.raw);
      if (accepted) break;
    }
    if (!accepted) throw new AppError("CONFLICT");
    const pending = await this.store.get(key(owner, "request"));
    if (pending && computerUseCommandSchema.parse(JSON.parse(pending)).connection_id === id)
      await this.store.remove(key(owner, "request"), pending);
  }

  async resume(owner: string, id: string): Promise<void> {
    const current = await this.connection(owner);
    if (current?.value.id === id) {
      await this.store.remove(key(owner, "paused"), id);
      await this.maintain(owner, id, { control: "ready", permissions: current.value.permissions });
    }
  }

  async paused(owner: string, id: string): Promise<boolean> {
    return await this.store.get(key(owner, "paused")) === id ||
      (await this.connection(owner))?.value.control === "paused";
  }

  async disconnect(owner: string, id: string): Promise<void> {
    const current = await this.connection(owner);
    if (current?.value.id === id) await this.store.remove(key(owner, "connection"), current.raw);
  }

  async revoke(owner: string): Promise<void> {
    await this.store.put(key(owner, "epoch"), randomUUID(), credentialTtl);
    const digest = await this.store.take(key(owner, "credential"));
    if (digest) await this.store.remove(`computer-use:credential:${digest}`);
    await this.store.remove(key(owner, "connection"));
    await this.store.remove(key(owner, "request"));
    await this.store.remove(key(owner, "command"));
  }

  async active(owner: string, id: string): Promise<boolean> {
    const raw = await this.store.get(key(owner, "request"));
    return raw !== null && computerUseCommandSchema.parse(JSON.parse(raw)).id === id;
  }

  async next(owner: string, connectionId: string): Promise<ComputerUseCommand | null> {
    const current = await this.connection(owner);
    if (current?.value.id !== connectionId || await this.paused(owner, connectionId)) return null;
    const raw = await this.store.takeIf(key(owner, "command"), key(owner, "connection"), current.raw);
    if (!raw) return null;
    const command = computerUseCommandSchema.parse(JSON.parse(raw));
    return command.connection_id === connectionId && command.device_id === current.credential.device.id &&
      command.expires_at > Date.now() && await this.active(owner, command.id) ? command : null;
  }

  async reply(owner: string, connectionId: string, id: string, result: ComputerUseResult): Promise<void> {
    const raw = await this.store.get(key(owner, "request"));
    if (!raw || (await this.connection(owner))?.value.id !== connectionId) return;
    const request = computerUseCommandSchema.parse(JSON.parse(raw));
    if (request.id !== id || request.connection_id !== connectionId || request.expires_at <= Date.now()) return;
    await this.store.put(key(owner, `reply:${id}`), JSON.stringify(computerUseResultSchema.parse(result)), commandTtl, true);
  }

  async execute(owner: string, context: {
    conversationId: string; turnId: string; title: string; readOnly: boolean;
  }, request: ComputerUseRequest, signal?: AbortSignal): Promise<ComputerUseResult> {
    const status = await this.status(owner);
    if (request.action === "status") return { ok: true, data: { status } };
    if (!status.connected || !status.device) return computerUseFailure("COMPUTER_USE_NOT_CONNECTED");
    if (request.device_id !== status.device.id) return computerUseFailure("COMPUTER_USE_ACCESS_DENIED");
    const connection = await this.connection(owner);
    if (!connection) return computerUseFailure("COMPUTER_USE_NOT_CONNECTED");
    if (request.device_id !== connection.credential.device.id) return computerUseFailure("COMPUTER_USE_ACCESS_DENIED");
    if (request.action === "release") {
      await this.pause(owner, connection.value.id);
      return { ok: true, data: { status: await this.status(owner) } };
    }
    if (await this.paused(owner, connection.value.id)) return computerUseFailure("COMPUTER_USE_PAUSED");
    const id = randomUUID();
    if (!await this.store.put(key(owner, "lock"), id, commandTtl, true)) return computerUseFailure("COMPUTER_USE_BUSY");
    const command: ComputerUseCommand = {
      type: "command", id, connection_id: connection.value.id, device_id: request.device_id,
      conversation_id: context.conversationId, turn_id: context.turnId,
      title: context.title.slice(0, 500), read_only: context.readOnly,
      expires_at: Date.now() + COMPUTER_USE_COMMAND_TTL_MS, request,
    };
    const encoded = JSON.stringify(command);
    try {
      if (signal?.aborted) return computerUseFailure("COMPUTER_USE_CANCELLED");
      await this.store.put(key(owner, "request"), encoded, commandTtl);
      await this.store.put(key(owner, "command"), encoded, commandTtl);
      while (Date.now() < command.expires_at) {
        if (signal?.aborted) return computerUseFailure("COMPUTER_USE_CANCELLED", "unknown");
        if (!await this.active(owner, id) || await this.paused(owner, connection.value.id))
          return computerUseFailure("COMPUTER_USE_PAUSED", "unknown");
        if ((await this.connection(owner))?.value.id !== command.connection_id)
          return computerUseFailure("COMPUTER_USE_NOT_CONNECTED", "unknown");
        const raw = await this.store.take(key(owner, `reply:${id}`));
        if (raw) return computerUseResultSchema.parse(JSON.parse(raw));
        await delay(100, undefined, { signal });
      }
      return computerUseFailure("COMPUTER_USE_TIMEOUT", "unknown");
    } catch (error) {
      if (signal?.aborted) return computerUseFailure("COMPUTER_USE_CANCELLED", "unknown");
      throw error;
    } finally {
      await this.store.remove(key(owner, "command"), encoded);
      await this.store.remove(key(owner, "request"), encoded);
      await this.store.remove(key(owner, "lock"), id);
      await this.store.remove(key(owner, `reply:${id}`));
    }
  }
}
