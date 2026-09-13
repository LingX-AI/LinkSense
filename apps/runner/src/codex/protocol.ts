/**
 * Narrow projection of the app-server schema pinned in runtime-version.json.
 * Regenerate and compare with `codex app-server generate-ts --experimental`
 * whenever the deployed CLI version changes.
 */
import type { ReasoningEffort } from "@linksense/shared";
import { z } from "zod";
import runtimeVersion from "./runtime-version.json" with { type: "json" };

export const CODEX_SCHEMA_VERSION = z.strictObject({
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
}).parse(runtimeVersion).version;

export type RequestId = number;

export type AskForApproval =
  | "untrusted"
  | "on-request"
  | "never"
  | {
      granular: {
        sandbox_approval: boolean;
        rules: boolean;
        skill_approval: boolean;
        request_permissions: boolean;
        mcp_elicitations: boolean;
      };
    };

export type JsonRpcRequest<TParams = unknown> = {
  method: string;
  id: RequestId;
  params: TParams;
};

export type JsonRpcNotification<TParams = unknown> = {
  method: string;
  params?: TParams;
};

export type JsonRpcResponse<TResult = unknown> =
  | { id: RequestId; result: TResult }
  | {
      id: RequestId;
      error: { code: number; message: string; data?: unknown };
    };

export type InitializeParams = {
  clientInfo: { name: string; title: string | null; version: string };
  capabilities: {
    experimentalApi: boolean;
    requestAttestation: boolean;
    optOutNotificationMethods?: string[] | null;
    extensions?: Record<string, unknown> | null;
  } | null;
};

export type InitializeResponse = {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
};

export type ModelListParams = {
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
};

export type CodexModel = {
  id: string;
  model: string;
  displayName: string;
  modelSpecialty: string | null;
  hidden: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: unknown;
    description: string;
  }>;
  defaultReasoningEffort: unknown;
  multiAgentVersion: "disabled" | "v1" | "v2" | null;
};

export type ModelListResponse = {
  data: CodexModel[];
  nextCursor: string | null;
};

export type CollaborationModeKind = "default" | "plan";

export type CollaborationModeListResponse = {
  data: Array<{
    name: string;
    mode: CollaborationModeKind | null;
    model: string | null;
    reasoning_effort: ReasoningEffort | null;
  }>;
};

export type TurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export type TurnInterruptParams = { threadId: string; turnId: string };

export type CodexErrorInfo =
  | "contextWindowExceeded"
  | "sessionBudgetExceeded"
  | "usageLimitExceeded"
  | "rateLimitExceeded"
  | "serverOverloaded"
  | "cyberPolicy"
  | "misalignmentPolicyViolation"
  | "internalServerError"
  | "unauthorized"
  | "badRequest"
  | "threadRollbackFailed"
  | "sandboxError"
  | "other"
  | { httpConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamConnectionFailed: { httpStatusCode: number | null } }
  | { responseStreamDisconnected: { httpStatusCode: number | null } }
  | { responseTooManyFailedAttempts: { httpStatusCode: number | null } }
  | { activeTurnNotSteerable: { turnKind: "review" | "compact" } };

export type TurnError = {
  message: string;
  codexErrorInfo: CodexErrorInfo | null;
  additionalDetails: string | null;
};

export type CodexTurn = {
  id: string;
  status: TurnStatus;
  items: CodexThreadItem[];
  itemsView?: unknown;
  error: TurnError | null;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
};

/** Runtime status returned by thread/read and thread/list in app-server 0.154.0. */
export type CodexThreadStatus =
  | { type: "notLoaded" }
  | { type: "idle" }
  | { type: "systemError" }
  | { type: "active"; activeFlags: string[] };

export type CodexThread = {
  id: string;
  /** Model provider selected for the loaded native thread. */
  modelProvider: string;
  /** Present only when Codex created this thread as a collaboration subagent. */
  parentThreadId?: string | null;
  /** Native subagent metadata exposed by codex app-server 0.154.0. */
  source?: unknown;
  agentNickname?: string | null;
  agentRole?: string | null;
  name?: string | null;
  /** Independently persisted app-server section, when assigned. */
  section?: unknown | null;
  sectionEnteredAt?: number | null;
  /** Canonical app-server project assignment, when assigned. */
  projectId?: string | null;
  status?: CodexThreadStatus;
  turns?: CodexTurn[];
  [key: string]: unknown;
};

export type ThreadReadParams = {
  threadId: string;
  includeTurns?: boolean;
};

export type ThreadForkParams = {
  threadId: string;
  path?: string | null;
  lastTurnId?: string | null;
  model?: string | null;
  modelProvider?: string | null;
  cwd?: string | null;
  runtimeWorkspaceRoots?: string[] | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access" | null;
  deferGoalContinuation?: boolean;
};

export type ThreadRollbackParams = {
  threadId: string;
  numTurns: number;
};

export type ThreadReadResponse = {
  thread: CodexThread;
};

export type ThreadCompactStartParams = {
  threadId: string;
};

export type ThreadCompactStartResponse = Record<string, never>;

type ThreadRuntimeResponse = {
  thread: CodexThread;
  /** Effective model reported by Codex for this loaded thread runtime. */
  model: string;
  /** Effective model provider reported by Codex for this loaded thread runtime. */
  modelProvider: string;
};

export type ThreadStartResponse = ThreadRuntimeResponse;

export type ThreadResumeResponse = ThreadRuntimeResponse;

export type ThreadListParams = {
  cursor?: string | null;
  limit?: number | null;
  sourceKinds?: Array<
    | "subAgent"
    | "subAgentReview"
    | "subAgentCompact"
    | "subAgentThreadSpawn"
    | "subAgentOther"
  > | null;
  archived?: boolean | null;
  parentThreadId?: string | null;
  sectionId?: string | null;
  projectId?: string | null;
};

export type ThreadListResponse = {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor?: string | null;
};

export type ThreadForkResponse = ThreadRuntimeResponse;

export type ThreadRollbackResponse = {
  thread: CodexThread;
};

export type ThreadNameUpdatedParams = {
  threadId: string;
  threadName?: string | null;
};

export type ThreadGoalStatus =
  | "active"
  | "paused"
  | "blocked"
  | "usageLimited"
  | "budgetLimited"
  | "complete";

export type ThreadGoal = {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type ThreadGoalSetParams = {
  threadId: string;
  objective?: string | null;
  status?: ThreadGoalStatus | null;
  tokenBudget?: number | null;
};

export type ThreadGoalSetResponse = { goal: ThreadGoal };
export type ThreadGoalGetParams = { threadId: string };
export type ThreadGoalGetResponse = { goal: ThreadGoal | null };
export type ThreadGoalClearParams = { threadId: string };
export type ThreadGoalClearResponse = { cleared: boolean };
export type ThreadGoalUpdatedParams = {
  threadId: string;
  turnId: string | null;
  goal: ThreadGoal;
};
export type ThreadGoalClearedParams = { threadId: string };

export type HookEventName =
  | "preToolUse"
  | "permissionRequest"
  | "postToolUse"
  | "preCompact"
  | "postCompact"
  | "sessionStart"
  | "sessionEnd"
  | "userPromptSubmit"
  | "subagentStart"
  | "subagentStop"
  | "stop"
  | "interrupt";

export type HookRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "stopped";

/**
 * Deliberately narrow projection of the 0.154.0 HookRunSummary. The native id
 * embeds sourcePath, so it stays private alongside hook output entries,
 * commands, and status text.
 */
export type HookRunSummary = {
  eventName: HookEventName;
  status: HookRunStatus;
};

export type HookNotificationParams = {
  threadId: string;
  turnId: string | null;
  run: HookRunSummary;
};

export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

export type ThreadTokenUsageUpdatedParams = {
  threadId: string;
  turnId: string;
  tokenUsage: {
    total: TokenUsageBreakdown;
    last: TokenUsageBreakdown;
    modelContextWindow: number | null;
  };
};

export type CodexAdditionalContext = Record<
  string,
  { kind: "application" | "untrusted"; value: string }
>;

export type CodexUserInput =
  | { type: "text"; text: string; text_elements: [] }
  | { type: "localImage"; path: string; detail?: "low" | "high" }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type TurnStartParams = {
  threadId: string;
  model: string;
  effort: ReasoningEffort;
  summary: "auto" | "concise" | "detailed" | "none";
  clientUserMessageId: string;
  input: CodexUserInput[];
  /**
   * Version-pinned codex 0.154.0 metadata flattened into
   * client_metadata["x-codex-turn-metadata"] for Responses requests.
   */
  responsesapiClientMetadata?: Record<string, string>;
  additionalContext?: CodexAdditionalContext;
  collaborationMode: {
    mode: CollaborationModeKind;
    settings: {
      model: string;
      reasoning_effort: ReasoningEffort;
      developer_instructions: string | null;
    };
  };
  cwd: string;
  runtimeWorkspaceRoots: string[];
  approvalPolicy: AskForApproval;
  sandboxPolicy:
    | { type: "dangerFullAccess" }
    | { type: "readOnly"; networkAccess: boolean };
};

export type ToolRequestUserInputOption = {
  label: string;
  description: string;
};

export type ToolRequestUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: ToolRequestUserInputOption[] | null;
};

export type ToolRequestUserInputParams = {
  threadId: string;
  turnId: string;
  itemId: string;
  questions: ToolRequestUserInputQuestion[];
  isBlocking: boolean;
  /** @deprecated Retained by app-server 0.154.0 as the host timeout policy. */
  autoResolutionMs: number | null;
};

export type ToolRequestUserInputResponse = {
  answers: Record<string, { answers: string[] }>;
};

export type ServerRequestResolvedParams = {
  threadId: string;
  requestId: RequestId;
};

export type CodexCommandAction =
  | { type: "read"; command: string; name: string; path: string }
  | { type: "listFiles"; command: string; path: string | null }
  | {
      type: "search";
      command: string;
      query: string | null;
      path: string | null;
    }
  | { type: "unknown"; command: string };

export type CodexFileUpdateChange = {
  path: string;
  kind:
    | { type: "add" }
    | { type: "delete" }
    | { type: "update"; move_path: string | null };
  diff: string;
};

export type CodexCollabAgentStatus =
  | "pendingInit"
  | "running"
  | "interrupted"
  | "completed"
  | "errored"
  | "shutdown"
  | "notFound";

export type CodexCollabAgentState = {
  status: CodexCollabAgentStatus;
  /** Native status text is intentionally never projected beyond the Runner. */
  message: string | null;
};

export type CodexThreadItem =
  | {
      type: "userMessage";
      id: string;
      clientId?: string | null;
      content: CodexUserInput[];
      [key: string]: unknown;
    }
  | {
      type: "agentMessage";
      id: string;
      text: string;
      phase: "commentary" | "final_answer" | null;
      delivery?: "async" | null;
      questions?: Array<{ title: string; options: string[] | null }> | null;
      [key: string]: unknown;
    }
  | {
      type: "reasoning";
      id: string;
      summary?: string[];
      content?: string[];
      [key: string]: unknown;
    }
  | { type: "plan"; id: string; text: string; [key: string]: unknown }
  | {
      type: "commandExecution";
      id: string;
      source?:
        "agent" | "userShell" | "unifiedExecStartup" | "unifiedExecInteraction";
      status: "inProgress" | "completed" | "failed" | "declined";
      pluginId?: string | null;
      scriptPath?: string | null;
      commandActions?: CodexCommandAction[];
      exitCode?: number | null;
      durationMs?: number | null;
      [key: string]: unknown;
    }
  | {
      type: "fileChange";
      id: string;
      status: "inProgress" | "completed" | "failed" | "declined";
      changes?: CodexFileUpdateChange[];
      [key: string]: unknown;
    }
  | {
      type: "mcpToolCall";
      id: string;
      server: string;
      tool: string;
      status: "inProgress" | "completed" | "failed";
      pluginId?: string | null;
      readOnlyHint?: boolean | null;
      durationMs?: number | null;
      [key: string]: unknown;
    }
  | {
      type: "dynamicToolCall";
      id: string;
      namespace?: string | null;
      tool: string;
      status: "inProgress" | "completed" | "failed";
      success?: boolean | null;
      durationMs?: number | null;
      [key: string]: unknown;
    }
  | {
      type: "collabAgentToolCall";
      id: string;
      tool:
        | "spawnAgent"
        | "sendInput"
        | "resumeAgent"
        | "wait"
        | "closeAgent"
        | "sendMessage"
        | "followupTask"
        | "interruptAgent"
        | "listAgents";
      status: "inProgress" | "completed" | "failed" | "interrupted";
      senderThreadId: string;
      receiverThreadIds: string[];
      prompt: string | null;
      model: string | null;
      reasoningEffort: unknown | null;
      agentsStates: Record<string, CodexCollabAgentState | undefined>;
      [key: string]: unknown;
    }
  | {
      type: "subAgentActivity";
      id: string;
      kind: "started" | "interacted" | "interrupted" | "completed";
      agentThreadId: string;
      agentPath: string;
      [key: string]: unknown;
    }
  | {
      type: "webSearch";
      id: string;
      action?: { type?: string } | null;
      [key: string]: unknown;
    }
  | { type: "imageView"; id: string; [key: string]: unknown }
  | { type: "sleep"; id: string; durationMs: number; [key: string]: unknown }
  | {
      type: "imageGeneration";
      id: string;
      status: string;
      revisedPrompt?: string | null;
      transparentBackground?: boolean;
      failure?: {
        type: "usageLimitExceeded";
        limitId: string;
        resetsAt: number | null;
      } | null;
      savedPath?: string;
      [key: string]: unknown;
    }
  | {
      type: "enteredReviewMode" | "exitedReviewMode";
      id: string;
      review?: string;
      [key: string]: unknown;
    }
  | { type: "contextCompaction"; id: string; [key: string]: unknown }
  | { type: string; id: string; [key: string]: unknown };

export type DynamicToolCallParams = {
  threadId: string;
  turnId: string;
  callId: string;
  namespace: string | null;
  tool: string;
  arguments: unknown;
};

export type DynamicToolCallResponse = {
  contentItems: Array<{ type: "inputText"; text: string }>;
  success: boolean;
};

export type ServerMessage =
  JsonRpcResponse | JsonRpcNotification | JsonRpcRequest;

export function isJsonRpcResponse(
  message: ServerMessage,
): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message);
}

export function isServerRequest(
  message: ServerMessage,
): message is JsonRpcRequest {
  return "id" in message && "method" in message && !isJsonRpcResponse(message);
}
