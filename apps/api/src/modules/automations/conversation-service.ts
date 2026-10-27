import {
  automationToolResultSchema,
  automationToolSummarySchema,
  internalAutomationToolRequestSchema,
  type AutomationToolResult,
  type InternalAutomationToolRequest,
} from "@linksense/shared";
import { v5 as uuidV5 } from "uuid";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { normalizeLocale } from "../../lib/locale.js";
import type { AuditContext } from "../audit/service.js";
import { automationExpirationAt } from "./schedule.js";
import type { AutomationService } from "./service.js";

type ConversationAutomationPrisma = Pick<
  PrismaClient,
  "user" | "conversation" | "conversationTurn"
>;
type AutomationGateway = Pick<
  AutomationService,
  | "list"
  | "get"
  | "listPinnedConversations"
  | "create"
  | "update"
  | "delete"
  | "runNow"
>;

export class ConversationAutomationService {
  constructor(
    private readonly prisma: ConversationAutomationPrisma,
    private readonly automations: AutomationGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    ownerId: string,
    rawInput: InternalAutomationToolRequest,
    context: AuditContext,
  ): Promise<AutomationToolResult> {
    const { conversationId, turnId, request } =
      internalAutomationToolRequestSchema.parse(rawInput);
    const [user, conversation, turn] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { status: true, preferredLocale: true },
      }),
      this.prisma.conversation.findFirst({
        where: {
          id: conversationId,
          ownerId,
          archiveStatus: "active",
          applicationId: null,
        },
        select: {
          id: true,
          title: true,
          pinnedAt: true,
          collaborationMode: true,
        },
      }),
      this.prisma.conversationTurn.findFirst({
        where: {
          id: turnId,
          conversationId,
          submittedBy: ownerId,
          status: "running",
        },
        select: { id: true },
      }),
    ]);
    if (!user || user.status !== "active" || !conversation || !turn)
      throw new AppError("FORBIDDEN");
    if (
      conversation.collaborationMode !== "default" &&
      request.operation !== "list" &&
      request.operation !== "get"
    ) {
      throw new AppError("COLLABORATION_MODE_UNAVAILABLE");
    }
    const locale = normalizeLocale(user.preferredLocale) ?? undefined;
    const resolveTarget = (
      target:
        | { mode: "current_task" }
        | { mode: "new_task" }
        | { mode: "existing_task"; conversation_id: string },
    ) =>
      target.mode === "current_task"
        ? { mode: "existing_task" as const, conversation_id: conversationId }
        : target;

    switch (request.operation) {
      case "list": {
        const [automations, targets] = await Promise.all([
          this.automations.list(ownerId),
          this.automations.listPinnedConversations(ownerId),
        ]);
        const query = request.query?.toLowerCase();
        return automationToolResultSchema.parse({
          operation: "list",
          current_task: {
            id: conversation.id,
            title: conversation.title,
            pinned: conversation.pinnedAt !== null,
            automation_ids: automations.items.filter((item) => item.conversation.id === conversationId).map((item) => item.id),
          },
          items: automations.items
            .filter(
              (item) => !query || item.title.toLowerCase().includes(query),
            )
            .map((item) => automationToolSummarySchema.strip().parse(item)),
          pinned_tasks: targets.items
            .filter(
              (item) => !query || item.title.toLowerCase().includes(query),
            )
            .slice(0, 100),
        });
      }
      case "get":
        return {
          operation: "get",
          automation: await this.automations.get(
            ownerId,
            request.automation_id,
          ),
        };
      case "create": {
        const { request_id, target } = request;
        const creationId = uuidV5(`linksense:automation:${request_id}`, ownerId);
        if (target.mode !== "current_task" && request.additional !== true) {
          const existing = await this.automations.list(ownerId);
          if (!existing.items.some((item) => item.id === creationId) && existing.items.some((item) => item.conversation.id === conversationId)) {
            throw new AppError("AUTOMATION_TARGET_ALREADY_CONFIGURED");
          }
        }
        const automation = await this.automations.create(
          ownerId,
          {
            title: request.title,
            instruction: request.instruction,
            schedule: request.schedule,
            expires_on: request.expires_on,
            model_preference: request.model_preference,
            notification_target: request.notification_target,
            ...(request.monitoring ? { monitoring: request.monitoring } : {}),
            target: resolveTarget(target),
          },
          context,
          locale,
          {
            // The existing primary key is the durable creation receipt. Namespacing
            // prevents callers from selecting another resource's existing ID.
            creationId,
            pinTarget: target.mode === "current_task",
            allowAdditional: request.additional === true,
          },
        );
        return { operation: "create", automation };
      }
      case "update": {
        const { target, ...changes } = request.changes;
        return {
          operation: "update",
          automation: await this.automations.update(
            ownerId,
            request.automation_id,
            {
              ...changes,
              ...(target ? { target: resolveTarget(target) } : {}),
            },
            context,
            locale,
            { pinTarget: target?.mode === "current_task" },
          ),
        };
      }
      case "pause":
      case "resume": {
        if (request.operation === "resume") {
          const existing = await this.automations.get(
            ownerId,
            request.automation_id,
          );
          if (
            existing.expires_on &&
            automationExpirationAt(
              existing.expires_on,
              existing.schedule.time_zone,
            ).getTime() <= this.now().getTime()
          ) {
            throw new AppError("AUTOMATION_EXPIRED");
          }
        }
        return {
          operation: request.operation,
          automation: await this.automations.update(
            ownerId,
            request.automation_id,
            {
              status: request.operation === "pause" ? "paused" : "active",
            },
            context,
            locale,
          ),
        };
      }
      case "delete":
        await this.automations.delete(ownerId, request.automation_id, context);
        return { operation: "delete", automation_id: request.automation_id };
      case "run_now":
        return {
          operation: "run_now",
          result: await this.automations.runNow(
            ownerId,
            request.automation_id,
            request.request_id,
            context,
          ),
        };
    }
  }
}
