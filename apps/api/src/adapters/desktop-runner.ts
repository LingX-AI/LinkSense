import { randomUUID } from "node:crypto";
import {
  desktopExecutionCommandSchema,
  desktopExecutionCommandLifetimeMs,
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
import type { RunnerStartInput, RunnerStartOperation } from "./runner.js";

type ConversationScope = Pick<DesktopRunScope, "ownerId" | "conversationId">;
type TurnScope = ConversationScope & { turnId: string; runtimeGeneration?: string; connectionId?: string };
type StartCommand = Extract<DesktopExecutionCommand, { operation: "turn.start" }>;
type CommandInput = Pick<StartCommand, "operation" | "body"> |
  { operation: Exclude<DesktopExecutionCommand["operation"], "turn.start"> };

export class DesktopRunner {
  constructor(
    private readonly findConversation: (scope: ConversationScope) => Promise<{ desktopDeviceId: string | null; runtimeGeneration: string } | null>,
    private readonly transport: Pick<DesktopDeviceTransport, "connection" | "send">,
    private readonly leases: Pick<DesktopRunLeases, "issue" | "discardUndelivered">,
    private readonly scheduleExpiry: (scope: DesktopRunScope, expiresAt: number) => Promise<void>,
  ) {}

  async assertAvailable(scope: ConversationScope): Promise<void> {
    await this.resolve(scope);
  }

  async start(input: RunnerStartInput, connectionId?: string): Promise<RunnerStartOperation> {
    const context = input.context;
    // Only pass features supported by the Mac wire contract. Never send the cloud start body.
    if (input.collaborationMode !== "default" || input.goal || input.operationKind === "compact" ||
        input.forkFromCodexTurnId || input.eventProjectionTurnId || input.capabilities.length ||
        input.mcpServers.length || Object.keys(input.environment).length || input.modelProvider.privacyMasking ||
        input.modelTransitionSource?.provider.privacyMasking || context.applicationInstructions ||
        context.approvedPlanImplementation || context.automationExecution || context.requireFinalResponse ||
        context.officeSelectionContext || context.selectedKnowledgeBases?.length ||
        context.attachments.length || context.priorityPlugins.length || context.prioritySkills.length) {
      throw new AppError("RUNNER_UNAVAILABLE");
    }
    const scope = { ownerId: input.ownerId, conversationId: input.conversationId, turnId: input.projectionTurnId, runtimeGeneration: input.expectedRuntimeGeneration };
    const target = await this.resolve({ ...scope, ...(connectionId ? { connectionId } : {}) });
    const binding = target.binding;
    const credentials = await this.leases.issue(binding, input);
    try {
      // A worker cannot report its exit with an expired lease.
      await this.scheduleExpiry({ ...scope, deviceId: binding.deviceId, connectionId: binding.connectionId }, dayjs(credentials.expires_at).valueOf());
    } catch {
      await this.leases.discardUndelivered(credentials.turn_id, credentials.run_token);
      throw new DesktopCommandUndeliveredError();
    }
    const frame = await this.send(target, scope, {
      operation: "turn.start",
      body: { native_thread_id: input.codexThreadId ?? null, input: context.userInput, reasoning_effort: input.reasoningEffort, credentials },
    }).catch(async (error: unknown) => {
      if (error instanceof DesktopCommandUndeliveredError) {
        await this.leases.discardUndelivered(credentials.turn_id, credentials.run_token);
      }
      throw error;
    });
    if (frame.operation !== "turn.start" || !frame.result) throw new DesktopCommandUncertainError();
    return frame.result;
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
    const frame = await this.send(await this.resolve(scope), scope, { operation: "turn.interrupt" });
    if (frame.operation !== "turn.interrupt") throw new DesktopCommandUncertainError();
    return frame.result;
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
  ): Promise<Extract<DesktopExecutionResult, { ok: true }>> {
    const command = desktopExecutionCommandSchema.safeParse({
      type: "command", id: randomUUID(), owner_id: scope.ownerId, conversation_id: scope.conversationId,
      runtime_generation: target.runtimeGeneration, turn_id: scope.turnId,
      expires_at: new Date(Date.now() + desktopExecutionCommandLifetimeMs).toISOString(),
      ...input,
    });
    if (!command.success) throw new DesktopCommandUndeliveredError();
    const frame = await this.transport.send(target.binding, command.data);
    if (frame.ok) return frame;
    if (frame.error_code === "RUNNER_OPERATION_UNCERTAIN") throw new DesktopCommandUncertainError();
    throw new AppError(frame.error_code);
  }
}
