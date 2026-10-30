import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  localBrowserCommandSchema,
  localBrowserFailure,
  localBrowserReplySchema,
  type LocalBrowserCommand,
  type LocalBrowserRequest,
  type LocalBrowserResult,
} from "@linksense/shared";
import { AppError } from "../../lib/errors.js";
import type { BrowserStore } from "./store.js";

const ttl = 45_000;
const pairingLifetime = 120_000;
const credentialLifetime = 24 * 60 * 60 * 1000;
const approvalLifetime = 30 * credentialLifetime;
const credentialSchema = z.strictObject({
  owner: z.uuid(),
  auth_valid_after: z.string(),
  origin: z.url(),
  approval_id: z.uuid().optional(),
});
const connectionSchema = z.strictObject({
  id: z.uuid(),
  browser: z.enum(["chrome", "edge"]),
  credential_hash: z.string(),
  approval_id: z.uuid().optional(),
});
const key = (owner: string, part: string) => `local-browser:${owner}:${part}`;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type BrowserCredential = z.infer<typeof credentialSchema>;

export class LocalBrowserService {
  constructor(
    readonly store: BrowserStore,
    readonly endpoint: string,
  ) {}

  async pairing(
    owner: string,
    authValidAfter: string,
  ): Promise<{ code: string; endpoint: string }> {
    const code = randomBytes(32).toString("base64url");
    const credential: BrowserCredential = {
      owner,
      auth_valid_after: authValidAfter,
      origin: new URL(this.endpoint).origin,
    };
    if (!(await this.store.put(key(owner, "pair-rate"), "1", 1000, true)))
      throw new AppError("CONFLICT", undefined, 429);
    await this.store.put(
      `local-browser:pair:${digest(code)}`,
      JSON.stringify(credential),
      pairingLifetime,
    );
    return { code, endpoint: this.endpoint };
  }

  async pair(code: string, previousApproval?: string): Promise<string> {
    const value = await this.store.take(`local-browser:pair:${digest(code)}`);
    if (!value) throw new AppError("AUTH_REQUIRED");
    const credential = credentialSchema.parse(JSON.parse(value));
    const approvalKey = key(credential.owner, "approval");
    if (previousApproval && await this.store.get(approvalKey) !== previousApproval)
      throw new AppError("FORBIDDEN");
    const approval = previousApproval ?? randomUUID();
    const previousHash = await this.store.get(key(credential.owner, "credential"));
    if (!previousApproval) await this.store.put(approvalKey, approval, approvalLifetime);
    const token = randomBytes(32).toString("base64url");
    const hash = digest(token);
    await this.store.put(
      `local-browser:credential:${hash}`,
      JSON.stringify({ ...credential, approval_id: approval }),
      credentialLifetime,
    );
    // Publishing is fenced by the active approval, including concurrent revoke/re-pair on another worker.
    const accepted = await this.store.putIf(
      key(credential.owner, "credential"),
      hash,
      credentialLifetime,
      approvalKey,
      approval,
    );
    if (!accepted) {
      await this.store.remove(`local-browser:credential:${hash}`);
      throw new AppError("FORBIDDEN");
    }
    if (previousApproval) await this.store.touch(approvalKey, approval, approvalLifetime);
    if (previousHash) {
      await this.store.put(`local-browser:revoked:${previousHash}`, "1", credentialLifetime);
      await this.store.remove(`local-browser:credential:${previousHash}`);
    }
    return token;
  }

  async authenticate(token: string): Promise<BrowserCredential | null> {
    const value = await this.store.get(
      `local-browser:credential:${digest(token)}`,
    );
    if (!value) return null;
    const credential = credentialSchema.parse(JSON.parse(value));
    return (await this.store.get(key(credential.owner, "credential"))) ===
      digest(token) && credential.origin === new URL(this.endpoint).origin &&
      (!credential.approval_id || await this.store.get(key(credential.owner, "approval")) === credential.approval_id)
      ? credential
      : null;
  }

  async revoke(owner: string): Promise<void> {
    await this.store.remove(key(owner, "approval"));
    const hash = await this.store.take(key(owner, "credential"));
    if (hash) {
      await this.store.put(`local-browser:revoked:${hash}`, "1", credentialLifetime);
      await this.store.remove(`local-browser:credential:${hash}`);
    }
    await this.store.remove(key(owner, "connection"));
    await this.store.remove(key(owner, "command"));
    await this.store.remove(key(owner, "request"));
  }

  async wasRevoked(token: string): Promise<boolean> {
    return (await this.store.get(`local-browser:revoked:${digest(token)}`)) !== null;
  }

  async connect(
    owner: string,
    token: string,
    browser: "chrome" | "edge",
  ): Promise<string> {
    const credential = await this.authenticate(token);
    if (!credential || credential.owner !== owner) throw new AppError("AUTH_REQUIRED");
    const connection = {
      id: randomUUID(),
      browser,
      credential_hash: digest(token),
      ...(credential.approval_id ? { approval_id: credential.approval_id } : {}),
    };
    const accepted = await this.store.putIf(
      key(owner, "connection"),
      JSON.stringify(connection),
      ttl,
      key(owner, "credential"),
      digest(token),
    );
    if (!accepted) throw new AppError("AUTH_REQUIRED");
    return connection.id;
  }

  async status(owner: string): Promise<{
    connected: boolean;
    browser?: "chrome" | "edge";
    connection_id?: string;
  }> {
    const value = await this.store.get(key(owner, "connection"));
    if (!value) return { connected: false };
    const connection = connectionSchema.parse(JSON.parse(value));
    if (connection.approval_id && await this.store.get(key(owner, "approval")) !== connection.approval_id)
      return { connected: false };
    if (
      (await this.store.get(key(owner, "credential"))) !==
      connection.credential_hash
    )
      return { connected: false };
    return {
      connected: true,
      browser: connection.browser,
      connection_id: connection.id,
    };
  }

  async maintain(owner: string, connectionId: string): Promise<boolean> {
    const value = await this.store.get(key(owner, "connection"));
    if (!value || connectionSchema.parse(JSON.parse(value)).id !== connectionId)
      return false;
    const connection = connectionSchema.parse(JSON.parse(value));
    if (connection.approval_id && await this.store.get(key(owner, "approval")) !== connection.approval_id)
      return false;
    if (
      (await this.store.get(key(owner, "credential"))) !==
      connection.credential_hash
    )
      return false;
    return this.store.touch(key(owner, "connection"), value, ttl);
  }

  async disconnect(owner: string, connectionId: string): Promise<void> {
    const value = await this.store.get(key(owner, "connection"));
    if (value && connectionSchema.parse(JSON.parse(value)).id === connectionId)
      await this.store.remove(key(owner, "connection"), value);
  }

  async next(
    owner: string,
    connectionId: string,
  ): Promise<LocalBrowserCommand | null> {
    const current = await this.store.get(key(owner, "connection"));
    if (
      !current ||
      connectionSchema.parse(JSON.parse(current)).id !== connectionId ||
      (await this.status(owner)).connection_id !== connectionId
    )
      return null;
    const value = await this.store.takeIf(
      key(owner, "command"),
      key(owner, "connection"),
      current,
    );
    if (!value) return null;
    const command = localBrowserCommandSchema.parse(JSON.parse(value));
    if (
      command.connection_id !== connectionId ||
      command.expires_at <= Date.now()
    )
      return null;
    return command;
  }

  async activeCommand(owner: string): Promise<string | null> {
    const value = await this.store.get(key(owner, "request"));
    if (!value) return null;
    const command = localBrowserCommandSchema.parse(JSON.parse(value));
    return command.expires_at > Date.now() ? command.id : null;
  }

  async reply(
    owner: string,
    connectionId: string,
    body: unknown,
  ): Promise<void> {
    const reply = localBrowserReplySchema.parse(body);
    const request = await this.store.get(key(owner, "request"));
    if (!request || (await this.status(owner)).connection_id !== connectionId)
      return;
    const command = localBrowserCommandSchema.parse(JSON.parse(request));
    if (
      command.id !== reply.id ||
      command.connection_id !== connectionId ||
      command.expires_at <= Date.now()
    )
      return;
    await this.store.put(
      key(owner, `reply:${reply.id}`),
      JSON.stringify(reply.result),
      ttl,
      true,
    );
  }

  async execute(
    owner: string,
    conversationId: string,
    request: LocalBrowserRequest,
    signal?: AbortSignal,
  ): Promise<LocalBrowserResult> {
    const status = await this.status(owner);
    if (request.action === "status")
      return { ok: true, browser: "local", data: status };
    if (!status.connection_id)
      return localBrowserFailure("LOCAL_BROWSER_NOT_CONNECTED");
    const id = randomUUID();
    if (!(await this.store.put(key(owner, "lock"), id, ttl, true)))
      return localBrowserFailure("LOCAL_BROWSER_BUSY");
    const command: LocalBrowserCommand = {
      id,
      connection_id: status.connection_id,
      conversation_id: conversationId,
      expires_at: Date.now() + 30_000,
      request,
    };
    const encoded = JSON.stringify(command);
    try {
      if (signal?.aborted)
        return localBrowserFailure("LOCAL_BROWSER_CANCELLED");
      await this.store.put(key(owner, "request"), encoded, ttl);
      await this.store.put(key(owner, "command"), encoded, ttl);
      while (Date.now() < command.expires_at) {
        if (signal?.aborted)
          return localBrowserFailure("LOCAL_BROWSER_CANCELLED");
        if ((await this.status(owner)).connection_id !== command.connection_id)
          return localBrowserFailure("LOCAL_BROWSER_NOT_CONNECTED");
        const response = await this.store.take(key(owner, `reply:${id}`));
        if (response)
          return localBrowserReplySchema.shape.result.parse(
            JSON.parse(response),
          );
        await delay(100, undefined, { signal });
      }
      return localBrowserFailure("LOCAL_BROWSER_TIMEOUT");
    } catch (error) {
      if (signal?.aborted)
        return localBrowserFailure("LOCAL_BROWSER_CANCELLED");
      throw error;
    } finally {
      await this.store.remove(key(owner, "command"), encoded);
      await this.store.remove(key(owner, "request"), encoded);
      await this.store.remove(key(owner, "lock"), id);
      await this.store.remove(key(owner, `reply:${id}`));
    }
  }
}
