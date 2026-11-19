import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  browserUseCommandSchema,
  browserUseOpenSiteCapability,
  browserUseFailure,
  browserUseReadOnly,
  browserUseReplySchema,
  type BrowserUseCommand,
  type BrowserUseExtensionRequest,
  type BrowserUseResult,
} from "@linksense/shared";
import type { AppConfig } from "../../config.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { desktopRunScopeSchema, type DesktopRunScope } from "../desktop-credentials/run-leases.js";
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
// Persisted credentials, revocations and active connections keep their original namespace.
const key = (owner: string, part: string) => `local-browser:${owner}:${part}`;
// Pre-upgrade replicas cannot parse site-window jobs in the legacy mailbox.
const siteWindowJobKey = (owner: string, connectionId: string, part: "command" | "request") =>
  key(owner, `site-window:${connectionId}:${part}`);
const desktopJobKey = (owner: string, part: "command" | "request") => key(owner, `desktop:${part}`);
const desktopReplyKey = (owner: string, id: string) => key(owner, `desktop:reply:${id}`);
const desktopJobSchema = z.strictObject({ command: browserUseCommandSchema, scope: desktopRunScopeSchema });
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export type BrowserCredential = z.infer<typeof credentialSchema>;
type DesktopBrowserMailbox = Pick<AppConfig, "credentialMasterKey" | "credentialKeyId"> & {
  isActiveRun: (scope: DesktopRunScope) => Promise<boolean>;
};
type PendingMarker = { key: string; expected: string };
type PendingCommand = { command: BrowserUseCommand; desktopMarker?: PendingMarker };

export class BrowserUseService {
  constructor(
    readonly store: BrowserStore,
    readonly endpoint: string,
    private readonly desktopMailbox?: DesktopBrowserMailbox,
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
    await this.store.remove(key(owner, "request"));
    await this.store.remove(key(owner, "command"));
    await this.store.remove(desktopJobKey(owner, "request"));
    await this.store.remove(desktopJobKey(owner, "command"));
  }

  async wasRevoked(token: string): Promise<boolean> {
    return (await this.store.get(`local-browser:revoked:${digest(token)}`)) !== null;
  }

  async connect(
    owner: string,
    token: string,
    browser: "chrome" | "edge",
    siteWindow?: typeof browserUseOpenSiteCapability,
  ): Promise<string> {
    const credential = await this.authenticate(token);
    if (!credential || credential.owner !== owner) throw new AppError("AUTH_REQUIRED");
    const connection = {
      id: randomUUID(),
      browser,
      credential_hash: digest(token),
      ...(credential.approval_id ? { approval_id: credential.approval_id } : {}),
    };
    const encoded = JSON.stringify(connection);
    const accepted = await this.store.putIf(
      key(owner, "connection"),
      encoded,
      ttl,
      key(owner, "credential"),
      digest(token),
    );
    if (!accepted) throw new AppError("AUTH_REQUIRED");
    // Keep the connection JSON readable by older API replicas during rollout.
    if (siteWindow) await this.store.putIf(
      key(owner, `site-window:${connection.id}`),
      siteWindow,
      ttl,
      key(owner, "connection"),
      encoded,
    );
    return connection.id;
  }

  async status(owner: string): Promise<{
    connected: boolean;
    browser?: "chrome" | "edge";
    connection_id?: string;
  }> {
    const connection = await this.currentConnection(owner);
    return connection ? {
      connected: true,
      browser: connection.browser,
      connection_id: connection.id,
    } : { connected: false };
  }

  private async currentConnection(owner: string, marker?: PendingMarker): Promise<z.infer<typeof connectionSchema> | null> {
    const [value, credential, approval, pending] = await this.store.getMany(
      key(owner, "connection"), key(owner, "credential"), key(owner, "approval"), ...(marker ? [marker.key] : []),
    );
    if (!value || (marker && pending !== marker.expected)) return null;
    const connection = connectionSchema.parse(JSON.parse(value));
    return credential === connection.credential_hash && (!connection.approval_id || approval === connection.approval_id)
      ? connection : null;
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
    const refreshed = await this.store.touch(key(owner, "connection"), value, ttl);
    if (refreshed) await this.store.touch(
      key(owner, `site-window:${connectionId}`),
      browserUseOpenSiteCapability,
      ttl,
    );
    return refreshed;
  }

  async disconnect(owner: string, connectionId: string): Promise<void> {
    const value = await this.store.get(key(owner, "connection"));
    if (value && connectionSchema.parse(JSON.parse(value)).id === connectionId)
      await this.store.remove(key(owner, "connection"), value);
    await this.store.remove(key(owner, `site-window:${connectionId}`));
  }

  async next(
    owner: string,
    connectionId: string,
  ): Promise<BrowserUseCommand | null> {
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
    ) ?? await this.store.takeIf(
      siteWindowJobKey(owner, connectionId, "command"),
      key(owner, "connection"),
      current,
    );
    if (value) {
      const command = browserUseCommandSchema.parse(JSON.parse(value));
      return isCurrentCommand(command, connectionId) ? command : null;
    }
    const mailbox = this.desktopMailbox;
    if (!mailbox) return null;
    const commandKey = desktopJobKey(owner, "command");
    const encrypted = await this.store.get(commandKey);
    if (!encrypted) return null;
    const { command } = desktopJobSchema.parse(decryptJson<unknown>(encrypted,
      mailbox.credentialMasterKey, mailbox.credentialKeyId, commandKey));
    if (await this.activeCommand(owner, connectionId) !== command.id) return null;
    return await this.store.takeIf(commandKey, commandKey, encrypted) ? command : null;
  }

  private async pendingCommand(owner: string, connectionId: string): Promise<PendingCommand | null> {
    if ((await this.status(owner)).connection_id !== connectionId) return null;
    const value = await this.store.get(key(owner, "request")) ??
      await this.store.get(siteWindowJobKey(owner, connectionId, "request"));
    if (value) {
      const command = browserUseCommandSchema.parse(JSON.parse(value));
      return isCurrentCommand(command, connectionId) ? { command } : null;
    }
    const mailbox = this.desktopMailbox;
    if (!mailbox) return null;
    const requestKey = desktopJobKey(owner, "request");
    const encrypted = await this.store.get(requestKey);
    if (!encrypted) return null;
    const { command, scope } = desktopJobSchema.parse(decryptJson<unknown>(encrypted,
      mailbox.credentialMasterKey, mailbox.credentialKeyId, requestKey));
    if (!isCurrentCommand(command, connectionId) || scope.ownerId !== owner || scope.conversationId !== command.conversation_id ||
      !await mailbox.isActiveRun(scope)) return null;
    const desktopMarker = { key: requestKey, expected: encrypted };
    if ((await this.currentConnection(owner, desktopMarker))?.id !== connectionId || !isCurrentCommand(command, connectionId))
      return null;
    return { command, desktopMarker };
  }

  async activeCommand(owner: string, connectionId: string): Promise<string | null> {
    return (await this.pendingCommand(owner, connectionId))?.command.id ?? null;
  }

  async reply(
    owner: string,
    connectionId: string,
    body: unknown,
  ): Promise<void> {
    const reply = browserUseReplySchema.parse(body);
    const pending = await this.pendingCommand(owner, connectionId);
    if (pending?.command.id !== reply.id) return;
    if (pending.desktopMarker && this.desktopMailbox) {
      const replyKey = desktopReplyKey(owner, reply.id);
      const { credentialMasterKey, credentialKeyId } = this.desktopMailbox;
      await this.store.putIf(replyKey, encryptJson(reply.result, credentialMasterKey, credentialKeyId, replyKey), ttl,
        pending.desktopMarker.key, pending.desktopMarker.expected, true);
      return;
    }
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
    request: BrowserUseExtensionRequest,
    signal?: AbortSignal,
    desktop?: { connectionId: string; scope: DesktopRunScope; checkRun: () => Promise<void> },
  ): Promise<BrowserUseResult> {
    const mailbox = desktop ? this.desktopMailbox : undefined;
    if (desktop && !mailbox) return browserUseFailure("BROWSER_USE_ACCESS_DENIED");
    const status = await this.status(owner);
    if (desktop && status.connection_id !== desktop.connectionId)
      return browserUseFailure("BROWSER_USE_NOT_CONNECTED");
    if (request.action === "status")
      return { ok: true, browser: "local", data: status };
    if (!status.connection_id)
      return browserUseFailure("BROWSER_USE_NOT_CONNECTED");
    if (request.action === "open_site_window") {
      if (await this.store.get(key(owner, `site-window:${status.connection_id}`)) !== browserUseOpenSiteCapability)
        return browserUseFailure("BROWSER_USE_ACCESS_DENIED");
    }
    await desktop?.checkRun();
    const id = randomUUID();
    if (!(await this.store.put(key(owner, "lock"), id, ttl, true)))
      return browserUseFailure("BROWSER_USE_BUSY");
    const command: BrowserUseCommand = {
      id,
      connection_id: status.connection_id,
      conversation_id: conversationId,
      expires_at: Date.now() + 30_000,
      request,
    };
    const commandKey = desktop ? desktopJobKey(owner, "command") : request.action === "open_site_window"
      ? siteWindowJobKey(owner, command.connection_id, "command")
      : key(owner, "command");
    const requestKey = desktop ? desktopJobKey(owner, "request") : request.action === "open_site_window"
      ? siteWindowJobKey(owner, command.connection_id, "request")
      : key(owner, "request");
    const replyKey = desktop ? desktopReplyKey(owner, id) : key(owner, `reply:${id}`);
    try {
      const legacy = JSON.stringify(command);
      const job = desktop && { command, scope: desktop.scope };
      const encodedRequest = mailbox
        ? encryptJson(job, mailbox.credentialMasterKey, mailbox.credentialKeyId, requestKey) : legacy;
      const encodedCommand = mailbox
        ? encryptJson(job, mailbox.credentialMasterKey, mailbox.credentialKeyId, commandKey) : legacy;
      return await this.runCommand({
        owner, command, commandKey, requestKey, replyKey, encodedRequest, encodedCommand, signal, desktop, mailbox,
      });
    } finally {
      await this.store.remove(key(owner, "lock"), id);
    }
  }

  private async runCommand({
    owner, command, commandKey, requestKey, replyKey, encodedRequest, encodedCommand, signal, desktop, mailbox,
  }: {
    owner: string;
    command: BrowserUseCommand;
    commandKey: string;
    requestKey: string;
    replyKey: string;
    encodedRequest: string;
    encodedCommand: string;
    signal: AbortSignal | undefined;
    desktop: { checkRun: () => Promise<void> } | undefined;
    mailbox: DesktopBrowserMailbox | undefined;
  }): Promise<BrowserUseResult> {
    const mutation = mailbox !== undefined &&
      (command.request.action === "open_site_window" || !browserUseReadOnly(command.request));
    let mayBeClaimed = false;
    const stop = async (code: "BROWSER_USE_CANCELLED" | "BROWSER_USE_NOT_CONNECTED" | "BROWSER_USE_TIMEOUT") => {
      if (mayBeClaimed) {
        // Withdraw the exact job atomically. If the pump won, the mutation may have run.
        const unclaimed = await this.store.takeIf(commandKey, commandKey, encodedCommand);
        if (!unclaimed) return browserUseFailure("RUNNER_OPERATION_UNCERTAIN");
      }
      return browserUseFailure(code);
    };
    try {
      if (signal?.aborted)
        return browserUseFailure("BROWSER_USE_CANCELLED");
      await this.store.put(requestKey, encodedRequest, ttl);
      await desktop?.checkRun();
      if (signal?.aborted)
        return browserUseFailure("BROWSER_USE_CANCELLED");
      if (mailbox) {
        if (!await this.store.putIf(commandKey, encodedCommand, ttl, requestKey, encodedRequest))
          return browserUseFailure("BROWSER_USE_CANCELLED");
        mayBeClaimed = mutation;
      } else await this.store.put(commandKey, encodedCommand, ttl);
      while (Date.now() < command.expires_at) {
        if (signal?.aborted)
          return await stop("BROWSER_USE_CANCELLED");
        if ((await this.status(owner)).connection_id !== command.connection_id)
          return await stop("BROWSER_USE_NOT_CONNECTED");
        const response = mailbox ? await this.store.get(replyKey) : await this.store.take(replyKey);
        if (response) {
          const result = browserUseReplySchema.shape.result.parse(
            mailbox ? decryptJson<unknown>(response, mailbox.credentialMasterKey, mailbox.credentialKeyId, replyKey)
              : JSON.parse(response),
          );
          // A legacy extension can report these after the action has already run.
          if (mayBeClaimed && !result.ok &&
              (result.code === "BROWSER_USE_COMMAND_FAILED" || result.code === "BROWSER_USE_CANCELLED" ||
               result.code === "BROWSER_USE_TIMEOUT" || result.code === "BROWSER_USE_ACCESS_DENIED")) {
            return browserUseFailure("RUNNER_OPERATION_UNCERTAIN");
          }
          try {
            await desktop?.checkRun();
          } catch (error) {
            if (mayBeClaimed && result.ok) return browserUseFailure("RUNNER_OPERATION_UNCERTAIN");
            throw error;
          }
          return result;
        }
        await delay(100, undefined, { signal });
      }
      return await stop("BROWSER_USE_TIMEOUT");
    } catch (error) {
      if (signal?.aborted) return await stop("BROWSER_USE_CANCELLED");
      throw error;
    } finally {
      await this.store.remove(requestKey, encodedRequest);
      await this.store.remove(commandKey, encodedCommand);
      await this.store.remove(replyKey);
    }
  }
}

function isCurrentCommand(command: BrowserUseCommand, connectionId: string): boolean {
  return command.connection_id === connectionId && command.expires_at > Date.now();
}
