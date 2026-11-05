import {
  mkdir,
  readFile,
  rename,
  writeFile,
  chown,
  chmod,
  rm,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Logger } from "pino";
import lockfile from "proper-lockfile";
import {
  publicKnowledgeConcurrencyLimit,
  publicKnowledgeOutputLimit,
  limitPublicKnowledgeOutput,
  publicKnowledgeRunnerInputSchema,
  publicKnowledgeRunnerResultSchema,
  type PublicKnowledgeRunnerInput,
  type PublicKnowledgeRunnerResult,
} from "@linksense/shared";
import {
  CodexJsonRpcClient,
  type ChildProcessFactory,
} from "../codex/json-rpc-client.js";
import {
  linkSenseModelProviderConfigOverrides,
  linkSenseModelProviderId,
} from "../codex/runtime-config-overrides.js";
import {
  ModelGateway,
  modelGatewayEnvironmentKey,
  type ModelGatewayLease,
} from "../model-gateway/model-gateway.js";
import type { ProcessIdentity } from "../child-process-isolation.js";
import type { CodexUserInput } from "../codex/protocol.js";
import { OrderedBatchQueue } from "../ordered-batch-queue.js";
import {
  projectPublicKnowledgeProgress,
  type PublicKnowledgeProgress,
} from "./progress.js";

const threadResponse = z.object({
  thread: z.object({
    id: z.string().min(1),
    modelProvider: z.literal(linkSenseModelProviderId),
  }),
});
const skillsResponse = z.object({
  data: z.array(
    z.object({
      skills: z.array(
        z.object({ name: z.string(), path: z.string(), enabled: z.boolean() }),
      ),
    }),
  ),
});
const notification = z.object({
  method: z.string(),
  params: z
    .object({
      threadId: z.string().optional(),
      turnId: z.string().optional(),
      delta: z.string().optional(),
      turn: z
        .object({
          id: z.string(),
          status: z.enum(["completed", "failed", "interrupted", "inProgress"]),
          items: z
            .array(
              z
                .object({
                  type: z.string(),
                  text: z.string().optional(),
                  phase: z
                    .enum(["commentary", "final_answer"])
                    .nullable()
                    .optional(),
                })
                .passthrough(),
            )
            .optional(),
        })
        .optional(),
    })
    .passthrough(),
});
const zeroPricing = {
  input_price_per_million: "0",
  cached_input_price_per_million: "0",
  output_price_per_million: "0",
};
export const publicKnowledgeNativeOverrides = [
  'approval_policy="never"',
  'sandbox_mode="read-only"',
  'web_search="disabled"',
  "features.shell_tool=false",
  "features.shell_snapshot=false",
  "features.unified_exec=false",
  "features.js_repl=false",
  "features.apply_patch_freeform=false",
  "features.multi_agent=false",
  "features.memories=false",
  "features.plugins=false",
  "features.remote_plugin=false",
  "features.apps=false",
  "features.hooks=false",
  "features.browser_use=false",
  "features.computer_use=false",
  "features.image_generation=false",
  "features.workspace_dependencies=false",
  "features.tool_suggest=false",
  "skills.include_instructions=false",
  "skills.bundled.enabled=false",
  "memories.generate_memories=false",
  "memories.use_memories=false",
  "mcp_servers={}",
  "project_doc_max_bytes=0",
  "check_for_update_on_startup=false",
] as const;
type LiveTurn = {
  operationId: string;
  client: CodexJsonRpcClient | null;
  threadId: string | null;
  turnId: string | null;
  interruptRequested: boolean;
};

/** One bounded application worker serves many isolated, durable native threads. */
export class PublicKnowledgeRuntime {
  private readonly active = new Map<string, LiveTurn>();
  constructor(
    private readonly options: {
      root: string;
      command: string;
      logger: Logger;
      processIdentity?: ProcessIdentity;
      childProcessFactory?: ChildProcessFactory;
      timeoutMs?: number;
    },
  ) {}
  get size(): number {
    return this.active.size;
  }
  private async prepareAncestors(applicationId: string): Promise<void> {
    for (const directory of [
      path.join(this.options.root, "public-knowledge"),
      path.join(
        this.options.root,
        "public-knowledge",
        z.uuid().parse(applicationId),
      ),
    ]) {
      await mkdir(directory, { recursive: true, mode: 0o750 });
      if (this.options.processIdentity) {
        await chown(
          directory,
          process.getuid?.() ?? this.options.processIdentity.uid,
          this.options.processIdentity.gid,
        );
        await chmod(directory, 0o750);
      }
    }
  }
  private directory(applicationId: string, conversationId: string): string {
    return path.join(
      this.options.root,
      "public-knowledge",
      z.uuid().parse(applicationId),
      z.uuid().parse(conversationId),
    );
  }
  async result(
    applicationId: string,
    conversationId: string,
    operationId: string,
  ): Promise<PublicKnowledgeRunnerResult | null> {
    const directory = this.directory(applicationId, conversationId);
    const file = path.join(
      directory,
      `${z.uuid().parse(operationId)}.result.json`,
    );
    try {
      return publicKnowledgeRunnerResultSchema.parse(
        JSON.parse(await readFile(file, "utf8")),
      );
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (
      this.active.get(directory)?.operationId === operationId ||
      (await lockfile.check(directory, { realpath: false, stale: 240_000 }))
    )
      return null;
    try {
      await readFile(path.join(directory, `${operationId}.started`));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    // A dead supervisor cannot provide a terminal native event. Observe the
    // abandoned operation after its lock expires; never replay its input.
    let threadId: string | null = null;
    try {
      threadId = z
        .string()
        .min(1)
        .max(200)
        .parse(
          JSON.parse(
            await readFile(path.join(directory, "thread.json"), "utf8"),
          ),
        );
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const result: PublicKnowledgeRunnerResult = {
      threadId,
      turnId: null,
      status: "failed",
      outputText: "",
    };
    await atomicJson(file, result);
    return result;
  }
  async interrupt(
    applicationId: string,
    conversationId: string,
    operationId: string,
  ): Promise<void> {
    const key = this.directory(applicationId, conversationId);
    await this.prepareAncestors(applicationId);
    await mkdir(key, { recursive: true, mode: 0o770 });
    await writeFile(
      path.join(key, `${z.uuid().parse(operationId)}.cancelled`),
      "cancelled",
      { mode: 0o640 },
    );
    const active = this.active.get(key);
    if (!active || active.operationId !== operationId) return;
    active.interruptRequested = true;
    if (active.client && active.threadId && active.turnId)
      await active.client.request("turn/interrupt", {
        threadId: active.threadId,
        turnId: active.turnId,
      });
  }
  async close(): Promise<void> {
    await Promise.all(
      [...this.active.values()].map((item) => item.client?.close()),
    );
  }
  async run(
    value: PublicKnowledgeRunnerInput,
    publish?: (events: readonly PublicKnowledgeProgress[]) => Promise<void>,
  ): Promise<PublicKnowledgeRunnerResult> {
    const input = publicKnowledgeRunnerInputSchema.parse(value);
    const root = this.directory(input.applicationId, input.conversationId);
    await this.prepareAncestors(input.applicationId);
    await mkdir(root, { recursive: true, mode: 0o770 });
    const release = await lockfile.lock(root, {
      realpath: false,
      retries: 0,
      stale: 240_000,
      update: 10_000,
    });
    try {
      return await this.runLocked(input, publish);
    } finally {
      await release();
    }
  }
  private async runLocked(
    value: PublicKnowledgeRunnerInput,
    publish?: (events: readonly PublicKnowledgeProgress[]) => Promise<void>,
  ): Promise<PublicKnowledgeRunnerResult> {
    const input = publicKnowledgeRunnerInputSchema.parse(value);
    const root = this.directory(input.applicationId, input.conversationId);
    const previous = await this.result(
      input.applicationId,
      input.conversationId,
      input.operationId,
    );
    if (previous) return previous;
    if (this.active.has(root)) throw new Error("public conversation is active");
    if (this.active.size >= publicKnowledgeConcurrencyLimit)
      throw new Error("public worker capacity reached");
    const home = path.join(root, "home"),
      codexHome = path.join(home, ".codex"),
      workspace = path.join(home, "workspace");
    for (const directory of [root, home, codexHome, workspace]) {
      await mkdir(directory, { recursive: true, mode: 0o770 });
      if (this.options.processIdentity) {
        await chown(
          directory,
          this.options.processIdentity.uid,
          this.options.processIdentity.gid,
        );
        await chmod(directory, 0o770);
      }
    }
    // Only the selected instruction files exist in this visitor's native home.
    // Package scripts, references and owner-wide Skill directories are never mounted.
    const agentsRoot = path.join(home, ".agents");
    await mkdir(agentsRoot, { recursive: true, mode: 0o750 });
    if (this.options.processIdentity)
      await chown(
        agentsRoot,
        process.getuid?.() ?? this.options.processIdentity.uid,
        this.options.processIdentity.gid,
      );
    const skillsRoot = path.join(agentsRoot, "skills");
    await rm(skillsRoot, { recursive: true, force: true });
    const skillInputs: CodexUserInput[] = [];
    for (const skill of input.skills) {
      const directory = path.join(skillsRoot, skill.id);
      await mkdir(directory, { recursive: true, mode: 0o750 });
      const target = path.join(directory, "SKILL.md");
      await writeFile(target, skill.markdown, { mode: 0o640 });
      const filename = await realpath(target);
      if (this.options.processIdentity) {
        for (const entry of [skillsRoot, directory, filename]) {
          await chown(
            entry,
            process.getuid?.() ?? this.options.processIdentity.uid,
            this.options.processIdentity.gid,
          );
        }
      }
      skillInputs.push({ type: "skill", name: skill.name, path: filename });
    }
    // The start marker survives a lost HTTP response. It authorizes observation,
    // never another turn/start for the same operation.
    const marker = path.join(root, `${input.operationId}.started`);
    await writeFile(marker, "started", { flag: "wx", mode: 0o640 });
    const gateway = new ModelGateway({ logger: this.options.logger });
    let lease: ModelGatewayLease | undefined;
    let client: CodexJsonRpcClient | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let outputText = "";
    let turnRequested = false;
    const displayedCharacters = new Map<string, number>();
    const progress = new OrderedBatchQueue<PublicKnowledgeProgress>(
      async (events) => {
        if (publish) await publish(events);
      },
      { maxCount: 32, maxBytes: 256 * 1024 },
    );
    const live: LiveTurn = {
      operationId: input.operationId,
      client: null,
      threadId: null,
      turnId: null,
      interruptRequested: false,
    };
    try {
      await gateway.start();
      lease = gateway.issueLease({
        conversationId: input.conversationId,
        ownerId: input.applicationId,
        revision: input.provider.revision,
        upstreamBaseUrl: input.provider.baseUrl,
        apiKey: input.provider.apiKey,
        protocolMode: input.provider.protocolMode,
        model: input.model,
        pricing: input.provider.pricing ?? zeroPricing,
        toolPolicy: "none",
      });
      client = new CodexJsonRpcClient({
        command: this.options.command,
        userHome: home,
        codexHome,
        logger: this.options.logger,
        ...(this.options.childProcessFactory
          ? { childProcessFactory: this.options.childProcessFactory }
          : {}),
        ...(this.options.processIdentity
          ? { processIdentity: this.options.processIdentity }
          : {}),
        runtimeEnvironment: {
          [modelGatewayEnvironmentKey]: lease.token,
          TOKIO_WORKER_THREADS: "2",
        },
        configOverrides: [
          ...publicKnowledgeNativeOverrides,
          `skills.include_instructions=${input.skills.length > 0}`,
          ...linkSenseModelProviderConfigOverrides({
            baseUrl: gateway.baseUrl,
            protocolMode: input.provider.protocolMode,
            allowWebSockets: false,
            ...(input.provider.modelContextWindow
              ? { modelContextWindow: input.provider.modelContextWindow }
              : {}),
            ...(input.provider.modelAutoCompactTokenLimit
              ? {
                  modelAutoCompactTokenLimit:
                    input.provider.modelAutoCompactTokenLimit,
                }
              : {}),
          }),
          `model_provider=${JSON.stringify(linkSenseModelProviderId)}`,
          `model=${JSON.stringify(input.model)}`,
        ],
        onServerRequest: async () => {
          throw new Error(
            "public knowledge runtime does not authorize tool or approval requests",
          );
        },
      });
      live.client = client;
      this.active.set(root, live);
      const terminal = new Promise<PublicKnowledgeRunnerResult>(
        (resolve, reject) => {
          client?.on("notification", (raw: unknown) => {
            const parsed = notification.safeParse(raw);
            if (!parsed.success || settled) return;
            const { method, params } = parsed.data;
            if (params.threadId !== live.threadId) return;
            if (!turnRequested) return;
            const nativeTurnId = params.turn?.id ?? params.turnId;
            if (live.turnId && nativeTurnId && nativeTurnId !== live.turnId)
              return;
            if (publish)
              for (const event of projectPublicKnowledgeProgress(raw, {
                conversationId: input.conversationId,
                operationId: input.operationId,
                workspace,
                codexHome,
              })) {
                const delta = event.params.notification;
                if (
                  (delta.method === "item/started" ||
                    delta.method === "item/completed") &&
                  delta.params.item.type === "agentMessage"
                )
                  displayedCharacters.set(
                    delta.params.item.id,
                    Math.max(
                      displayedCharacters.get(delta.params.item.id) ?? 0,
                      delta.params.item.text.length,
                    ),
                  );
                if (delta.method === "item/agentMessage/delta") {
                  const used =
                    displayedCharacters.get(delta.params.itemId) ?? 0;
                  delta.params.delta = limitPublicKnowledgeOutput(
                    delta.params.delta,
                    Math.max(0, publicKnowledgeOutputLimit - used),
                  );
                  if (!delta.params.delta) continue;
                  displayedCharacters.set(
                    delta.params.itemId,
                    used + delta.params.delta.length,
                  );
                }
                const key =
                  delta.method === "item/agentMessage/delta" ||
                  delta.method === "item/reasoning/summaryTextDelta"
                    ? `${delta.method}:${delta.params.itemId}`
                    : null;
                void progress
                  .enqueue(event, key, Buffer.byteLength(JSON.stringify(event)))
                  .catch(() =>
                    this.options.logger.error(
                      { operationId: input.operationId },
                      "public progress delivery could not be persisted",
                    ),
                  );
              }
            if (method === "turn/started" && params.turn)
              live.turnId = params.turn.id;
            if (method === "item/agentMessage/delta" && params.delta)
              outputText = limitPublicKnowledgeOutput(
                outputText + params.delta,
              );
            if (
              method === "turn/completed" &&
              params.turn &&
              params.turn.status !== "inProgress" &&
              live.threadId
            ) {
              settled = true;
              const messages = params.turn.items?.filter(
                (item) => item.type === "agentMessage",
              );
              const answer =
                messages
                  ?.filter((item) => item.phase === "final_answer")
                  .at(-1) ?? messages?.at(-1);
              resolve({
                threadId: live.threadId,
                turnId: params.turn.id,
                status: params.turn.status,
                outputText: limitPublicKnowledgeOutput(
                  answer?.text ?? outputText,
                ),
              });
            }
          });
          const onExit = () => {
            if (!settled) {
              settled = true;
              reject(new Error("public native process exited"));
            }
          };
          client?.once("exit", onExit);
          timer = setTimeout(() => {
            if (!settled)
              reject(new Error("public knowledge turn deadline exceeded"));
          }, this.options.timeoutMs ?? 180_000);
          timer.unref();
        },
      );
      // Handle early failures before awaiting the terminal promise.
      void terminal.catch(() => undefined);
      await client.initialize();
      if (skillInputs.length) {
        const available = skillsResponse.parse(
          await client.request("skills/list", {
            cwds: [workspace],
            forceReload: true,
          }),
        );
        for (const skill of input.skills) {
          const filename = await realpath(
            path.join(skillsRoot, skill.id, "SKILL.md"),
          );
          if (
            !available.data.some((entry) =>
              entry.skills.some(
                (item) =>
                  item.enabled &&
                  item.name === skill.name &&
                  item.path === filename,
              ),
            )
          )
            throw new Error("selected public Skill is unavailable");
        }
      }
      let storedThreadId: string | null = null;
      try {
        storedThreadId = z
          .string()
          .min(1)
          .max(200)
          .parse(
            JSON.parse(await readFile(path.join(root, "thread.json"), "utf8")),
          );
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      if (input.threadId && storedThreadId !== input.threadId)
        throw new Error("public thread binding mismatch");
      const params = {
        model: input.model,
        modelProvider: linkSenseModelProviderId,
        cwd: workspace,
        approvalPolicy: "never",
        sandbox: "read-only",
        baseInstructions: input.instructions,
        developerInstructions: null,
        config: { "tools.update_plan.enabled": false },
      };
      const response = threadResponse.parse(
        await client.request(
          storedThreadId ? "thread/resume" : "thread/start",
          {
            ...params,
            ...(storedThreadId
              ? { threadId: storedThreadId, excludeTurns: true }
              : {}),
          },
        ),
      );
      live.threadId = response.thread.id;
      if (storedThreadId && live.threadId !== storedThreadId)
        throw new Error("public native thread changed");
      await atomicJson(path.join(root, "thread.json"), live.threadId);
      try {
        await readFile(path.join(root, `${input.operationId}.cancelled`));
        const result: PublicKnowledgeRunnerResult = {
          threadId: live.threadId,
          turnId: null,
          status: "interrupted",
          outputText: "",
        };
        await atomicJson(
          path.join(root, `${input.operationId}.result.json`),
          result,
        );
        return result;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      turnRequested = true;
      const started = z.object({ turn: z.object({ id: z.string() }) }).parse(
        await client.request("turn/start", {
          threadId: live.threadId,
          input: [
            { type: "text", text: input.inputText, text_elements: [] },
            ...skillInputs,
          ],
          model: input.model,
          effort: input.reasoningEffort,
        }),
      );
      live.turnId = started.turn.id;
      lease.setTurnCorrelation({
        turnId: input.operationId,
        codexTurnId: live.turnId,
        modelTransitionNonce: null,
      });
      if (live.interruptRequested)
        await this.interrupt(
          input.applicationId,
          input.conversationId,
          input.operationId,
        );
      const result = await terminal;
      await progress.enqueueOperation(async () => undefined);
      await atomicJson(
        path.join(root, `${input.operationId}.result.json`),
        result,
      );
      return result;
    } catch {
      await progress.enqueueOperation(async () => undefined);
      if (live.turnId && client?.isHealthy)
        await client
          .request("turn/interrupt", {
            threadId: live.threadId,
            turnId: live.turnId,
          })
          .catch(() => undefined);
      const failed: PublicKnowledgeRunnerResult = {
        threadId: live.threadId ?? input.threadId,
        turnId: live.turnId,
        status: "failed",
        outputText,
      };
      await atomicJson(
        path.join(root, `${input.operationId}.result.json`),
        failed,
      );
      return failed;
    } finally {
      clearTimeout(timer);
      await client?.close();
      lease?.release();
      await gateway.close();
      this.active.delete(root);
    }
  }
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o640 });
  await rename(temporary, file);
}
function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
