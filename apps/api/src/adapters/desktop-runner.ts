import { randomUUID } from "node:crypto";
import {
  desktopAttachmentStartLifetimeMs,
  desktopAttachmentStartupReserveMs,
  desktopExecutionCommandSchema,
  desktopExecutionCommandLifetimeMs,
  RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
  type DesktopExecutionCommand,
  type DesktopExecutionResult,
  type DesktopExecutionTerminal,
} from "@linksense/shared";
import dayjs from "dayjs";
import type { DesktopRunLeases, DesktopRunScope } from "../modules/desktop-credentials/run-leases.js";
import type { DesktopProjectionFence } from "../modules/desktop-credentials/run-authority.js";
import { AppError } from "../lib/errors.js";
import { DesktopCommandUncertainError, DesktopCommandUndeliveredError, type DesktopDeviceTransport } from "./desktop-device-transport.js";
import type { DesktopExecutionBinding } from "../modules/desktop-devices/coordinator.js";
import type { DesktopAttachments } from "../modules/files/desktop-attachments.js";
import type { RunnerStartInput, RunnerStartOperation } from "./runner.js";

type ConversationScope = Pick<DesktopRunScope, "ownerId" | "conversationId">;
type TurnScope = ConversationScope & { turnId: string; runtimeGeneration?: string; connectionId?: string };
type StartCommand = Extract<DesktopExecutionCommand, { operation: "turn.start" }>;
type UserInputCommand = Extract<DesktopExecutionCommand, { operation: "user-input.respond" }>;
type CommandInput = Pick<StartCommand, "operation" | "body"> | Pick<UserInputCommand, "operation" | "body"> |
  { operation: Exclude<DesktopExecutionCommand["operation"], "turn.start" | "user-input.respond"> };

export class DesktopRunner {
  constructor(
    private readonly findConversation: (scope: ConversationScope) => Promise<{ desktopDeviceId: string | null; runtimeGeneration: string } | null>,
    private readonly transport: Pick<DesktopDeviceTransport, "connection" | "send" | "supportsKnowledge" | "supportsAttachments">,
    private readonly leases: Pick<DesktopRunLeases, "issue" | "discardUndelivered">,
    private readonly scheduleExpiry: (scope: DesktopRunScope, expiresAt: number) => Promise<void>,
    private readonly attachments: Pick<DesktopAttachments, "manifest">,
    private readonly pauseArtifactPublication?: (turnId: string) => Promise<() => Promise<void>>,
  ) {}

  async assertAvailable(scope: ConversationScope, needsAttachments = false): Promise<void> {
    const { binding } = await this.resolve(scope);
    if (needsAttachments) await this.assertAttachmentSupport(binding);
  }

  async start(input: RunnerStartInput, connectionId?: string): Promise<RunnerStartOperation> {
    const context = input.context;
    // Only pass features supported by the Mac wire contract. Never send the cloud start body.
    if (input.collaborationMode !== "default" || input.goal || input.operationKind === "compact" ||
        input.forkFromCodexTurnId || input.eventProjectionTurnId || input.capabilities.length ||
        input.mcpServers.length || Object.keys(input.environment).length || input.modelProvider.privacyMasking ||
        input.modelTransitionSource?.provider.privacyMasking || context.applicationInstructions ||
        context.approvedPlanImplementation || context.automationExecution || context.requireFinalResponse ||
        context.officeSelectionContext || context.priorityPlugins.length || context.prioritySkills.length) {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    const scope = { ownerId: input.ownerId, conversationId: input.conversationId, turnId: input.projectionTurnId, runtimeGeneration: input.expectedRuntimeGeneration };
    const target = await this.resolve({ ...scope, ...(connectionId ? { connectionId } : {}) });
    const binding = target.binding;
    if (context.selectedKnowledgeBases?.length && !await this.transport.supportsKnowledge(binding)) {
      throw new DesktopCommandUndeliveredError();
    }
    const commandId = randomUUID();
    const runScope = { ...scope, deviceId: binding.deviceId, connectionId: binding.connectionId };
    if (context.attachments.length) await this.assertAttachmentSupport(binding);
    const expiry = Date.now() + desktopAttachmentStartLifetimeMs;
    const attachments = context.attachments.length
      ? await this.attachments.manifest(runScope, context.attachments.length, commandId, expiry - desktopAttachmentStartupReserveMs)
      : undefined;
    const credentials = await this.leases.issue(binding, input);
    try {
      // A worker cannot report its exit with an expired lease.
      await this.scheduleExpiry(runScope, dayjs(credentials.expires_at).valueOf());
    } catch {
      await this.leases.discardUndelivered(credentials.turn_id, credentials.run_token);
      throw new DesktopCommandUndeliveredError();
    }
    const frame = await this.send(target, scope, {
      operation: "turn.start",
      body: {
        native_thread_id: input.codexThreadId ?? null, input: context.userInput, reasoning_effort: input.reasoningEffort, credentials,
        ...(context.selectedKnowledgeBases?.length ? { selected_knowledge_bases: context.selectedKnowledgeBases } : {}),
        ...(attachments ? { attachments } : {}),
      },
    }, attachments ? { expiresAt: expiry, id: commandId } : undefined).catch(async (error: unknown) => {
      if (error instanceof DesktopCommandUndeliveredError || (error instanceof AppError && error.code === "ATTACHMENT_UPLOAD_INVALID")) {
        await this.leases.discardUndelivered(credentials.turn_id, credentials.run_token);
      }
      throw error;
    });
    if (frame.operation !== "turn.start" || !frame.result) throw new DesktopCommandUncertainError();
    if (attachments && frame.result.status === "failed") {
      await this.leases.discardUndelivered(credentials.turn_id, credentials.run_token);
    }
    return frame.result;
  }

  private async assertAttachmentSupport(binding: DesktopExecutionBinding): Promise<void> {
    if (!await this.transport.supportsAttachments(binding)) throw new AppError("DESKTOP_UPDATE_REQUIRED");
  }

  async inspect(scope: TurnScope): Promise<RunnerStartOperation | null> {
    const frame = await this.send(await this.resolve(scope), scope, { operation: "turn.inspect" });
    if (frame.operation !== "turn.inspect") throw new DesktopCommandUncertainError();
    return frame.result;
  }

  async seal(scope: TurnScope): Promise<RunnerStartOperation> {
    const frame = await this.send(await this.resolve(scope), scope, { operation: "turn.seal" });
    if (frame.operation !== "turn.seal" || !frame.result || frame.result.status === "starting") {
      throw new DesktopCommandUncertainError();
    }
    return frame.result;
  }

  async interrupt(scope: TurnScope) {
    const target = await this.resolve(scope);
    const release = await this.pauseArtifactPublication?.(scope.turnId);
    try {
      const frame = await this.send(target, scope, { operation: "turn.interrupt" });
      if (frame.operation !== "turn.interrupt") throw new DesktopCommandUncertainError();
      if (frame.result.code === RUNNER_TURN_INTERRUPT_NOT_ACTIVE) await release?.();
      return frame.result;
    } catch (error) {
      if (error instanceof DesktopCommandUndeliveredError) await release?.();
      throw error;
    }
  }

  async respondUserInput(scope: TurnScope, body: UserInputCommand["body"]): Promise<{ accepted: true }> {
    const target = await this.resolve(scope);
    try {
      const frame = await this.send(target, scope, { operation: "user-input.respond", body });
      if (frame.operation !== "user-input.respond") throw new DesktopCommandUncertainError();
      return frame.result;
    } catch (error) {
      if (error instanceof DesktopCommandUncertainError) throw new AppError("RUNNER_OPERATION_UNCERTAIN");
      throw error;
    }
  }

  async drain(scope: TurnScope & { runtimeGeneration: string }): Promise<{
    terminal: DesktopExecutionTerminal | undefined;
    deviceId: string;
    check: () => Promise<void>;
  }> {
    const target = await this.resolve(scope);
    const frame = await this.send(target, scope, { operation: "turn.drain" });
    if (frame.operation !== "turn.drain") throw new AppError("RUNNER_UNAVAILABLE");
    const check = () => this.checkConnection(target.binding);
    await check();
    return { terminal: frame.result.terminal, deviceId: target.binding.deviceId, check };
  }

  async projectionFence(scope: TurnScope & { runtimeGeneration: string }): Promise<DesktopProjectionFence & { connectionId: string }> {
    const { binding } = await this.resolve(scope);
    return { scope: { ...scope, deviceId: binding.deviceId }, connectionId: binding.connectionId, check: () => this.checkConnection(binding) };
  }

  private async checkConnection(binding: DesktopExecutionBinding): Promise<void> {
    const current = await this.transport.connection(binding.deviceId);
    if (current?.connectionId !== binding.connectionId || current.gatewayId !== binding.gatewayId) {
      throw new AppError("FORBIDDEN");
    }
  }

  private async resolve(scope: ConversationScope & { runtimeGeneration?: string; connectionId?: string }) {
    const conversation = await this.findConversation(scope);
    if (!conversation?.desktopDeviceId || (scope.runtimeGeneration !== undefined && scope.runtimeGeneration !== conversation.runtimeGeneration)) {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    const binding = await this.transport.connection(conversation.desktopDeviceId);
    if (!binding || (scope.connectionId !== undefined && scope.connectionId !== binding.connectionId)) {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    return { binding, runtimeGeneration: conversation.runtimeGeneration };
  }

  private async send(
    target: Awaited<ReturnType<DesktopRunner["resolve"]>>,
    scope: TurnScope,
    input: CommandInput,
    delivery = { id: randomUUID(), expiresAt: Date.now() + desktopExecutionCommandLifetimeMs },
  ): Promise<Extract<DesktopExecutionResult, { ok: true }>> {
    const command = desktopExecutionCommandSchema.safeParse({
      type: "command", id: delivery.id, owner_id: scope.ownerId, conversation_id: scope.conversationId,
      runtime_generation: target.runtimeGeneration, turn_id: scope.turnId,
      expires_at: new Date(delivery.expiresAt).toISOString(),
      ...input,
    });
    if (!command.success) throw new DesktopCommandUndeliveredError();
    const frame = await this.transport.send(target.binding, command.data);
    if (frame.ok) return frame;
    if (frame.error_code === "RUNNER_OPERATION_UNCERTAIN") throw new DesktopCommandUncertainError();
    throw new AppError(frame.error_code);
  }
}
