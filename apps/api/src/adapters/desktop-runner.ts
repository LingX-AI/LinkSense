import { randomUUID } from "node:crypto";
import {
  desktopAttachmentStartLifetimeMs,
  desktopAttachmentStartupReserveMs,
  desktopExecutionCommandSchema,
  desktopExecutionCommandLifetimeMs,
  RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
  type DesktopExecutionCommand,
  type DesktopExecutionResult,
  type DesktopExecutionStartReceipt,
  type DesktopExecutionTerminal,
} from "@linksense/shared";
import dayjs from "dayjs";
import type { DesktopRunLeases, DesktopRunScope } from "../modules/desktop-credentials/run-leases.js";
import type { DesktopStartProjectionFence } from "../modules/desktop-credentials/run-authority.js";
import { AppError } from "../lib/errors.js";
import { DesktopCommandUncertainError, DesktopCommandUndeliveredError, type DesktopDeviceTransport } from "./desktop-device-transport.js";
import type { DesktopExecutionBinding } from "../modules/desktop-devices/coordinator.js";
import type { DesktopAttachments } from "../modules/files/desktop-attachments.js";
import type { RunnerStartInput } from "./runner.js";

type ConversationScope = Pick<DesktopRunScope, "ownerId" | "conversationId">;
type TurnScope = ConversationScope & { turnId: string; runtimeGeneration?: string; connectionId?: string };
type StartCommand = Extract<DesktopExecutionCommand, { operation: "turn.start" }>;
type InspectCommand = Extract<DesktopExecutionCommand, { operation: "turn.inspect" }>;
type UserInputCommand = Extract<DesktopExecutionCommand, { operation: "user-input.respond" }>;
type CommandInput = Pick<StartCommand, "operation" | "body"> | Pick<InspectCommand, "operation" | "body"> | Pick<UserInputCommand, "operation" | "body"> |
  { operation: Exclude<DesktopExecutionCommand["operation"], "turn.start" | "turn.inspect" | "user-input.respond" | "computer.execute"> };

export class DesktopRunner {
  constructor(
    private readonly findConversation: (scope: ConversationScope) => Promise<{ desktopDeviceId: string | null; runtimeGeneration: string } | null>,
    private readonly transport: Pick<DesktopDeviceTransport, "connection" | "send" | "supportsKnowledge" | "supportsAttachments" | "supportsConversationReference" | "supportsConversationReferenceRead" | "supportsModelSwitch">,
    private readonly leases: Pick<DesktopRunLeases, "issue" | "discardUndelivered">,
    private readonly scheduleExpiry: (scope: DesktopRunScope, expiresAt: number) => Promise<void>,
    private readonly attachments: Pick<DesktopAttachments, "manifest">,
    private readonly pauseArtifactPublication?: (turnId: string) => Promise<() => Promise<void>>,
    /** Best-effort product selection cleanup after a confirmed Codex interrupt. */
    private readonly onTurnInterrupted?: (scope: {
      ownerId: string;
      conversationId: string;
      turnId: string;
      runtimeGeneration: string;
    }) => Promise<void>,
  ) {}

  async assertAvailable(scope: ConversationScope, needsAttachments = false, needsConversationReference = false, needsModelSwitch = false, needsConversationReferenceRead = false): Promise<void> {
    const { binding } = await this.resolve(scope);
    if (needsModelSwitch) await this.assertModelSwitchSupport(binding);
    if (needsConversationReference) await this.assertConversationReferenceSupport(binding);
    if (needsConversationReferenceRead) await this.assertConversationReferenceReadSupport(binding);
    if (needsAttachments) await this.assertAttachmentSupport(binding);
  }

  /** Creation-time readiness only; no device reservation or lease is taken. */
  async assertDeviceAvailable(deviceId: string, needsConversationReferenceRead = false): Promise<void> {
    const binding = await this.transport.connection(deviceId);
    if (!binding) throw new AppError("RUNNER_UNAVAILABLE");
    if (needsConversationReferenceRead) await this.assertConversationReferenceReadSupport(binding);
  }

  async start(input: RunnerStartInput, connectionId?: string): Promise<DesktopExecutionStartReceipt> {
    const context = input.context;
    // Only pass features supported by the Mac wire contract. Never send the cloud start body.
    if (input.collaborationMode !== "default" || input.goal || input.operationKind === "compact" ||
        input.forkFromCodexTurnId || input.eventProjectionTurnId || input.capabilities.length ||
        input.mcpServers.length || Object.keys(input.environment).length || input.modelProvider.privacyMasking ||
        input.modelTransitionSource?.provider.privacyMasking || context.applicationInstructions ||
        context.approvedPlanImplementation || context.automationExecution || context.requireFinalResponse ||
        (context.officeSelectionContext && !input.conversationReferenceContext) ||
        context.priorityPlugins.length || context.prioritySkills.length) {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    const scope = { ownerId: input.ownerId, conversationId: input.conversationId, turnId: input.projectionTurnId, runtimeGeneration: input.expectedRuntimeGeneration };
    const target = await this.resolve({ ...scope, ...(connectionId ? { connectionId } : {}) });
    const binding = target.binding;
    if (input.modelTransitionSource) {
      if (!input.codexThreadId) throw new AppError("FORBIDDEN");
      await this.assertModelSwitchSupport(binding);
    }
    if (input.conversationReferenceContext) {
      // A native quote cannot be represented by the Chat bridge; fail before
      // the run lease or any device dispatch.
      if (input.modelProvider.protocolMode === "chat_completions_bridge") throw new AppError("MODEL_SELECTION_INVALID");
      await this.assertConversationReferenceSupport(binding);
    }
    if (input.requiresConversationReferenceRead) {
      // The current handoff must still be the generation that negotiated the
      // explicit reference read; an old or replaced Mac never gets a command.
      await this.assertConversationReferenceReadSupport(binding);
    }
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
        ...(input.conversationReferenceContext ? { conversation_reference_context: input.conversationReferenceContext } : {}),
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

  private async assertConversationReferenceSupport(binding: DesktopExecutionBinding): Promise<void> {
    if (!await this.transport.supportsConversationReference(binding)) throw new AppError("DESKTOP_UPDATE_REQUIRED");
  }

  private async assertConversationReferenceReadSupport(binding: DesktopExecutionBinding): Promise<void> {
    if (!await this.transport.supportsConversationReferenceRead(binding)) throw new AppError("DESKTOP_UPDATE_REQUIRED");
  }

  private async assertModelSwitchSupport(binding: DesktopExecutionBinding): Promise<void> {
    if (!await this.transport.supportsModelSwitch(binding)) throw new AppError("DESKTOP_UPDATE_REQUIRED");
  }

  async inspect(scope: TurnScope & { transitionSourceThreadId?: string }): Promise<DesktopExecutionStartReceipt | null> {
    const target = await this.resolve(scope);
    if (scope.transitionSourceThreadId) await this.assertModelSwitchSupport(target.binding);
    const frame = await this.send(target, scope, { operation: "turn.inspect",
      ...(scope.transitionSourceThreadId && { body: { transition_source_thread_id: scope.transitionSourceThreadId } }),
    });
    if (frame.operation !== "turn.inspect") throw new DesktopCommandUncertainError();
    return frame.result;
  }

  async seal(scope: TurnScope): Promise<DesktopExecutionStartReceipt> {
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
      await this.onTurnInterrupted?.({
        ownerId: scope.ownerId, conversationId: scope.conversationId,
        turnId: scope.turnId, runtimeGeneration: target.runtimeGeneration,
      }).catch(() => undefined);
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

  async projectionFence(scope: TurnScope & { runtimeGeneration: string }): Promise<DesktopStartProjectionFence> {
    const { binding } = await this.resolve(scope);
    const runScope = { ...scope, deviceId: binding.deviceId, connectionId: binding.connectionId };
    return {
      scope: runScope, connectionId: binding.connectionId, check: () => this.checkConnection(binding),
    };
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
