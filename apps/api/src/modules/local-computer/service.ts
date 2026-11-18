import {
  localComputerGrantLimit,
  localComputerSessionDurationMs,
  type LocalComputerPermissionInput,
  type LocalComputerStatus,
} from "@linksense/shared";
import dayjs from "dayjs";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import {
  activeLocalComputerSession,
  auditLocalComputerChange,
  endLocalComputerSessions,
  insertLocalComputerGrant,
  insertLocalComputerSession,
  localComputerSessionExists,
  readLocalComputerStatus,
  revokeLocalComputerGrant,
  withLocalComputerScope,
  type LocalComputerActor,
} from "./repository.js";

export class LocalComputerService {
  constructor(private readonly prisma: PrismaClient, private readonly now = () => new Date()) {}

  status(actor: LocalComputerActor, conversationId: string): Promise<LocalComputerStatus> {
    return withLocalComputerScope(this.prisma, actor, conversationId, (tx, binding) =>
      readLocalComputerStatus(tx, binding, this.now()));
  }

  start(actor: LocalComputerActor, conversationId: string, sessionId: string): Promise<LocalComputerStatus> {
    return withLocalComputerScope(this.prisma, actor, conversationId, async (tx, binding) => {
      const now = this.now();
      const active = await activeLocalComputerSession(tx, binding, now);
      if (active) {
        if (active.id !== sessionId) throw new AppError("CONFLICT");
        return readLocalComputerStatus(tx, binding, now);
      }
      await endLocalComputerSessions(tx, binding.device, now);
      const expiresAt = dayjs(now).add(localComputerSessionDurationMs, "millisecond").toDate();
      // A delayed POST cannot revive an expired or stopped authorization.
      if (!await insertLocalComputerSession(tx, binding, sessionId, now, expiresAt)) throw new AppError("CONFLICT");
      await auditLocalComputerChange(tx, actor.id, "computer_session_started", sessionId);
      return readLocalComputerStatus(tx, binding, now);
    });
  }

  stop(actor: LocalComputerActor, conversationId: string, sessionId: string): Promise<LocalComputerStatus> {
    return withLocalComputerScope(this.prisma, actor, conversationId, async (tx, binding) => {
      const now = this.now();
      const where = { ...binding.device, id: sessionId };
      if (!await localComputerSessionExists(tx, where)) throw new AppError("FORBIDDEN");
      if ((await endLocalComputerSessions(tx, where, now)).length) {
        await auditLocalComputerChange(tx, actor.id, "computer_session_stopped", sessionId);
      }
      return readLocalComputerStatus(tx, binding, now);
    });
  }

  changePermission(actor: LocalComputerActor, conversationId: string, input: LocalComputerPermissionInput): Promise<LocalComputerStatus> {
    return withLocalComputerScope(this.prisma, actor, conversationId, async (tx, binding) => {
      const now = this.now();
      const status = await readLocalComputerStatus(tx, binding, now);
      if (status.session?.id !== input.session_id) throw new AppError("CONFLICT");
      const key = { ...binding.device, sessionId: input.session_id, id: input.grant_id };
      if (input.action === "grant") {
        const duplicate = status.grants.find(grant => grant.id === input.grant_id);
        if (duplicate) {
          if (duplicate.capability !== input.capability || duplicate.target.bundle_id !== input.target.bundle_id) {
            throw new AppError("CONFLICT");
          }
          return status;
        }
        if (status.grants.length >= localComputerGrantLimit) throw new AppError("CONFLICT");
        const expiresAt = dayjs(status.session.expires_at).toDate();
        if (!await insertLocalComputerGrant(tx, key, input, now, expiresAt)) throw new AppError("CONFLICT");
        await auditLocalComputerChange(tx, actor.id, "computer_permission_granted", input.grant_id);
      } else {
        const result = await revokeLocalComputerGrant(tx, key, now);
        if (result === "missing") throw new AppError("FORBIDDEN");
        if (result === "revoked") {
          await auditLocalComputerChange(tx, actor.id, "computer_permission_revoked", input.grant_id);
        }
      }
      return readLocalComputerStatus(tx, binding, now);
    });
  }
}
