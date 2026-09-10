import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

import type { Logger } from "pino";

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js";
import {
  isJsonRpcResponse,
  isServerRequest,
  type InitializeParams,
  type InitializeResponse,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type ServerMessage,
} from "./protocol.js";

export class CodexProtocolError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = "CodexProtocolError";
  }
}

export type ChildProcessFactory = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) => ChildProcessWithoutNullStreams;

export type ServerRequestHandler = (
  request: JsonRpcRequest,
) => Promise<unknown>;

export type CodexClientUnhealthyReason =
  | {
      type: "request_timeout";
      method: string;
    }
  | {
      type: "child_process_error";
    };

const GRACEFUL_CLOSE_TIMEOUT_MS = 2_000;
const FORCED_CLOSE_TIMEOUT_MS = 2_000;

export class CodexJsonRpcClient extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private nextRequestId = 1;
  private initialized = false;
  private closed = false;
  private healthy = true;
  private exited = false;
  private childErrorHandled = false;
  private closePromise: Promise<void> | null = null;

  constructor(options: {
    command: string;
    userHome: string;
    codexHome: string;
    logger: Logger;
    requestTimeoutMs?: number;
    childProcessFactory?: ChildProcessFactory;
    onServerRequest?: ServerRequestHandler;
    extraEnvironment?: Record<string, string>;
    runtimeEnvironment?: Record<string, string>;
    configOverrides?: readonly string[];
    processIdentity?: ProcessIdentity;
  }) {
    super();
    this.logger = options.logger;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.onServerRequest = options.onServerRequest;
    const appServerArguments = codexAppServerArguments(
      options.extraEnvironment,
      options.runtimeEnvironment,
      options.configOverrides,
    );
    const childEnvironment = codexChildEnvironment(
      process.env,
      options.userHome,
      options.codexHome,
      options.extraEnvironment,
      options.runtimeEnvironment,
    );
    const isolatedInvocation = isolatedChildInvocation(
      options.command,
      appServerArguments,
      options.processIdentity,
    );
    this.child = options.childProcessFactory
      ? options.childProcessFactory(
          isolatedInvocation.command,
          isolatedInvocation.args,
          childEnvironment,
        )
      : spawn(isolatedInvocation.command, isolatedInvocation.args, {
          env: childEnvironment,
          stdio: "pipe",
        });

    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.logger.warn(
        { bytes: chunk.byteLength },
        "codex app-server emitted stderr output",
      );
    });
    this.child.once("exit", (code, signal) => {
      this.exited = true;
      this.rejectPending(
        new CodexProtocolError(
          `codex app-server exited (${String(code ?? signal ?? "unknown")})`,
        ),
      );
      if (!this.childErrorHandled) {
        this.emit("exit", { code, signal });
      }
    });
    this.child.once("error", () => {
      this.childErrorHandled = true;
      this.markUnhealthy({ type: "child_process_error" });
      this.rejectPending(
        new CodexProtocolError("codex app-server failed to start"),
      );
    });
  }

  private readonly logger: Logger;
  private readonly requestTimeoutMs: number;
  private readonly onServerRequest: ServerRequestHandler | undefined;

  get isClosed(): boolean {
    return this.closed;
  }

  get isHealthy(): boolean {
    return !this.closed && this.healthy;
  }

  get isExited(): boolean {
    return this.exited;
  }

  async initialize(): Promise<InitializeResponse> {
    if (this.initialized) {
      throw new CodexProtocolError(
        "app-server connection is already initialized",
      );
    }
    const params: InitializeParams = {
      clientInfo: {
        name: "linksense",
        title: "LinkSense",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
      },
    };
    const response = await this.request<InitializeResponse>(
      "initialize",
      params,
    );
    this.notify("initialized", {});
    this.initialized = true;
    return response;
  }

  request<TResult>(method: string, params: unknown): Promise<TResult> {
    if (this.closed || !this.healthy) {
      return Promise.reject(
        new CodexProtocolError(
          this.closed
            ? "app-server connection is closed"
            : "app-server connection is unhealthy",
        ),
      );
    }
    const id = this.nextRequestId++;
    const message: JsonRpcRequest = { method, id, params };
    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.markUnhealthy({ type: "request_timeout", method });
        reject(
          new CodexProtocolError(`app-server request timed out: ${method}`),
        );
      }, this.requestTimeoutMs);
      timer.unref();
      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer,
      });
      this.write(message);
    });
  }

  notify(method: string, params?: unknown): void {
    const message: JsonRpcNotification = { method, params };
    this.write(message);
  }

  async close(): Promise<void> {
    if (this.exited) return;
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.terminateChild();
    return this.closePromise;
  }

  private rejectPending(error: CodexProtocolError): void {
    this.closed = true;
    this.healthy = false;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private markUnhealthy(reason: CodexClientUnhealthyReason): void {
    if (this.closed || !this.healthy) return;
    this.healthy = false;
    this.emit("unhealthy", reason);
  }

  private async terminateChild(): Promise<void> {
    this.closed = true;
    this.healthy = false;
    const gracefulExit = this.waitForExit(GRACEFUL_CLOSE_TIMEOUT_MS);
    this.child.kill("SIGTERM");
    if (await gracefulExit) return;

    const forcedExit = this.waitForExit(FORCED_CLOSE_TIMEOUT_MS);
    this.child.kill("SIGKILL");
    if (await forcedExit) return;

    throw new CodexProtocolError("codex app-server did not exit after SIGKILL");
  }

  private waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.exited) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.child.off("exit", onExit);
        resolve(false);
      }, timeoutMs);
      timer.unref();
      this.child.once("exit", onExit);
    });
  }

  private write(
    message: JsonRpcRequest | JsonRpcNotification | JsonRpcResponse,
  ): void {
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let parsed: ServerMessage;
    try {
      parsed = JSON.parse(line) as ServerMessage;
    } catch {
      this.logger.warn(
        { lineLength: line.length },
        "ignored malformed app-server JSON",
      );
      return;
    }

    if (isJsonRpcResponse(parsed)) {
      const pending = this.pending.get(parsed.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(parsed.id);
      if ("error" in parsed) {
        pending.reject(
          new CodexProtocolError(parsed.error.message, parsed.error.code),
        );
      } else {
        pending.resolve(parsed.result);
      }
      return;
    }

    if (isServerRequest(parsed)) {
      void this.handleServerRequest(parsed);
      return;
    }

    if ("method" in parsed) {
      this.emit("notification", parsed);
    }
  }

  private async handleServerRequest(request: JsonRpcRequest): Promise<void> {
    try {
      if (!this.onServerRequest) {
        throw new CodexProtocolError(
          `unsupported server request: ${request.method}`,
          -32601,
        );
      }
      const result = await this.onServerRequest(request);
      if (!this.closed && !this.exited) this.write({ id: request.id, result });
    } catch (error) {
      const protocolError =
        error instanceof CodexProtocolError
          ? error
          : new CodexProtocolError("server request failed");
      if (!this.closed && !this.exited) {
        this.write({
          id: request.id,
          error: {
            code: protocolError.code ?? -32_000,
            message: protocolError.message,
          },
        });
      }
    }
  }
}

const CODEX_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "USER",
  "LANG",
  "LC_ALL",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
] as const;

const CODEX_SHELL_EXCLUDED_ENVIRONMENT = [
  "LINKSENSE_MODEL_GATEWAY_TOKEN",
  "LINK_SENSE_API_KEY",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
] as const;

const CODEX_SHELL_PINNED_ENVIRONMENT = [
  "BASH_ENV",
  "PATH",
  "LINKSENSE_PYTHON_PACKAGE_INDEX_URL",
  "LINKSENSE_NODE_PACKAGE_REGISTRY_URL",
  "UV_DEFAULT_INDEX",
  "UV_INDEX_STRATEGY",
  "PIP_INDEX_URL",
  "NPM_CONFIG_REGISTRY",
] as const;

// Codex consumes and removes this marker before starting worker threads. It
// prevents app-server from resolving a persisted ChatGPT remote control
// preference or opening that separate control-plane connection.
const CODEX_REMOTE_CONTROL_DISABLED_ENV =
  "CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED";

function allowedCodexEnvironment(
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    CODEX_ENV_ALLOWLIST.flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
}

function codexChildEnvironment(
  source: NodeJS.ProcessEnv,
  userHome: string,
  codexHome: string,
  extraEnvironment?: Record<string, string>,
  runtimeEnvironment?: Record<string, string>,
): Record<string, string> {
  return {
    ...allowedCodexEnvironment(source),
    ...extraEnvironment,
    // Runtime PATH and BASH_ENV are platform-owned. Keep them after
    // turn-scoped inputs so capability credentials cannot replace the
    // protected shell bootstrap even if an upstream validation regresses.
    ...runtimeEnvironment,
    // Tools share the execution user's persistent HOME. Native Codex state
    // remains in the task's CODEX_HOME, independently of its workspace cwd.
    HOME: userHome,
    CODEX_HOME: codexHome,
    [CODEX_REMOTE_CONTROL_DISABLED_ENV]: "1",
  };
}

export const codexEnvironmentForTesting = allowedCodexEnvironment;
export const codexChildEnvironmentForTesting = codexChildEnvironment;
export const codexArgumentsForTesting = codexAppServerArguments;

function codexAppServerArguments(
  extraEnvironment: Record<string, string> | undefined,
  runtimeEnvironment?: Record<string, string>,
  configOverrides: readonly string[] = [],
): string[] {
  const sensitiveKeys = [
    ...new Set([
      ...CODEX_SHELL_EXCLUDED_ENVIRONMENT,
      ...Object.keys(extraEnvironment ?? {}),
    ]),
  ].sort();
  const pinnedEnvironmentEntries = CODEX_SHELL_PINNED_ENVIRONMENT.flatMap(
    (key) => {
      const value = runtimeEnvironment?.[key];
      return value === undefined ? [] : [`${key}=${JSON.stringify(value)}`];
    },
  );
  return [
    "app-server",
    "-c",
    "allow_login_shell=false",
    "-c",
    "skills.bundled.enabled=false",
    "-c",
    `shell_environment_policy.exclude=${JSON.stringify(sensitiveKeys)}`,
    ...(pinnedEnvironmentEntries.length === 0
      ? []
      : [
          "-c",
          `shell_environment_policy.set={${pinnedEnvironmentEntries.join(",")}}`,
        ]),
    ...configOverrides.flatMap((value) => ["-c", value]),
    "--stdio",
  ];
}
