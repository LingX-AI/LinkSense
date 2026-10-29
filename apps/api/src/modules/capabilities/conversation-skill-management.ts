import {
  internalSkillManagementRequestSchema,
  isBuiltInCapabilityId,
  skillManagementResultSchema,
  type InternalSkillManagementRequest,
  type SkillManagementResult,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { CapabilityService } from "./service.js";
import type { RequestActor } from "./types.js";

export class ConversationSkillManagementService {
  constructor(
    private readonly prisma: Pick<PrismaClient, "user" | "conversation" | "conversationTurn">,
    private readonly capabilities: Pick<CapabilityService, "listAvailable" | "get" | "delete">,
  ) {}

  async execute(ownerId: string, rawInput: InternalSkillManagementRequest): Promise<SkillManagementResult> {
    const { conversationId, turnId, request } = internalSkillManagementRequestSchema.parse(rawInput);
    const [user, conversation, turn] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { id: true, role: true, status: true },
      }),
      this.prisma.conversation.findFirst({
        where: { id: conversationId, ownerId, archiveStatus: "active", applicationId: null },
        select: { id: true },
      }),
      this.prisma.conversationTurn.findFirst({
        where: { id: turnId, conversationId, submittedBy: ownerId, status: "running" },
        select: { collaborationMode: true },
      }),
    ]);
    if (!user || user.status !== "active" || (user.role !== "admin" && user.role !== "user") || !conversation || !turn) throw new AppError("FORBIDDEN");
    const actor: RequestActor = { id: user.id, role: user.role, status: "active" };

    if (request.operation === "list") {
      const items = await this.capabilities.listAvailable(actor);
      return skillManagementResultSchema.parse({
        success: true,
        operation: "list",
        items: items
          .filter(item => item.type === "skill" && item.status === "active" && item.preference_status === "enabled")
          .map(item => ({
            id: item.id,
            name: item.name,
            display_name: item.display_name ?? null,
            description: item.description,
            source_type: item.source_type,
            is_builtin: item.is_builtin,
            can_uninstall: !item.is_builtin && item.is_owner && item.can_delete,
          })),
      });
    }

    if (turn.collaborationMode !== "default") throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
    if (isBuiltInCapabilityId(request.skill_id)) throw new AppError("SKILL_UNINSTALL_NOT_ALLOWED");
    // Ownership is checked again by delete while holding the capability lock.
    const skill = await this.capabilities.get(actor, request.skill_id);
    if (skill.type !== "skill" || !skill.is_owner) throw new AppError("CAPABILITY_NOT_FOUND");
    if (skill.is_builtin || !skill.can_delete) throw new AppError("SKILL_UNINSTALL_NOT_ALLOWED");
    await this.capabilities.delete(actor, skill.id);
    return { success: true, operation: "uninstall", skill_id: skill.id, name: skill.name };
  }
}
