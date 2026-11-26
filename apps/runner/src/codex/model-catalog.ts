import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

import pino from "pino";
import { z } from "zod";

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js";
import { makeDirectoryTreeRemovable } from "../workspace/filesystem.js";
import { CodexJsonRpcClient } from "./json-rpc-client.js";

const execFileAsync = promisify(execFile);
const templateCatalogSchema = z.object({
  models: z.array(z.object({ slug: z.string().min(1) }).passthrough()).min(1),
});
const probeThreadSchema = z.object({
  thread: z.object({ id: z.string().min(1), path: z.string().min(1) }),
});
const catalogProbeProvider = "linksense-catalog-probe";
const probeRolloutSchema = z.object({
  type: z.literal("session_meta"),
  payload: z.object({
    model_provider: z.literal(catalogProbeProvider),
    base_instructions: z.object({ text: z.string().refine((text) => text.trim() !== "") }),
  }),
});
type TemplateCatalog = z.infer<typeof templateCatalogSchema>;

export type CodexModelCatalogInput = {
  command: string;
  codexHome: string;
  model: string;
  modelContextWindow?: number;
  supportsImageInput?: boolean;
  processIdentity?: ProcessIdentity;
};

export interface CodexModelCatalogWriter {
  /** Writes the catalog Codex should load and returns its absolute path. */
  ensure(input: CodexModelCatalogInput): Promise<string | null>;
}

type ProbeIdentity = Pick<CodexModelCatalogInput, "command" | "processIdentity">;

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  }
) => Promise<{ stdout: string }>;

/**
 * Codex clamps `model_context_window` to the model's `max_context_window`, and
 * unknown models fall back to 272k, so a 1M model still compacts at ~258k.
 *
 * `models_cache.json` cannot fix that: Codex 0.168 and later only reuse cache entries
 * whose identity hash matches the current provider and credentials, and the
 * hash covers the gateway URL and token, which change per run. `model_catalog_json`
 * replaces the bundled catalog without that gate, so write a catalog that keeps
 * the bundled models and adds the configured model with its real window.
 */
export function createCodexModelCatalogWriter(
  deps: {
    runCommand?: CommandRunner;
    readDefaultInstructions?: (input: ProbeIdentity) => Promise<string | null>;
  } = {}
): CodexModelCatalogWriter {
  const runCommand = deps.runCommand ?? execFileAsync;
  const readDefaultInstructions = deps.readDefaultInstructions ?? probeDefaultInstructions;
  const templates = new Map<string, Promise<TemplateCatalog | null>>();
  const genericInstructions = new Map<string, Promise<string | null>>();
  const writeLocks = new Map<string, Promise<void>>();

  return {
    async ensure(input) {
      if (input.modelContextWindow === undefined) return null;
      const { uid, gid } = input.processIdentity ?? {};
      const key = JSON.stringify([input.command, uid, gid]);
      const template = await cachedProbe(templates, key, () => loadTemplate(input, runCommand));
      if (!template) return null;
      const bundled = template.models.find((model) => model.slug === input.model);
      let base: Record<string, unknown>;
      if (bundled) {
        base = bundled;
      } else {
        const instructions = await cachedProbe(genericInstructions, key, () =>
          readDefaultInstructions(input)
        );
        if (!instructions) return null;
        base = genericModelEntry(input.model, instructions);
      }
      const entry = {
        ...base,
        context_window: input.modelContextWindow,
        max_context_window: input.modelContextWindow,
        effective_context_window_percent: 100,
        auto_compact_token_limit: null,
        input_modalities: input.supportsImageInput ? ["text", "image"] : ["text"],
        supports_image_detail_original: input.supportsImageInput === true &&
          bundled?.supports_image_detail_original === true,
      };
      const payload = JSON.stringify({
        models: [...template.models.filter((model) => model.slug !== input.model), entry],
      });
      // Other conversations can start with a different model before Codex loads this file.
      const identity = createHash("sha256").update(payload).digest("hex");
      const catalogPath = join(input.codexHome, `linksense-models-${identity}.json`);
      const previous = writeLocks.get(catalogPath) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => writeCatalog(catalogPath, payload));
      writeLocks.set(catalogPath, next);
      try {
        await next;
      } finally {
        if (writeLocks.get(catalogPath) === next) writeLocks.delete(catalogPath);
      }
      return catalogPath;
    },
  };
}

async function cachedProbe<T>(
  cache: Map<string, Promise<T | null>>,
  key: string,
  load: () => Promise<T | null>,
): Promise<T | null> {
  let probe = cache.get(key);
  if (!probe) {
    probe = load().catch(() => null);
    cache.set(key, probe);
  }
  const value = await probe;
  if (value === null && cache.get(key) === probe) cache.delete(key);
  return value;
}

async function withProbeHome<T>(
  identity: ProcessIdentity | undefined,
  probe: (home: string, codexHome: string) => Promise<T>,
): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "linksense-codex-models-"));
  try {
    const codexHome = join(home, ".codex");
    await mkdir(codexHome);
    if (identity) await Promise.all([chmod(home, 0o770), chmod(codexHome, 0o770)]);
    return await probe(home, codexHome);
  } finally {
    if (identity) await makeDirectoryTreeRemovable(home, identity).catch(() => undefined);
    await rm(home, { recursive: true, force: true });
  }
}

async function loadTemplate(
  input: ProbeIdentity,
  runCommand: CommandRunner,
): Promise<TemplateCatalog> {
  return withProbeHome(input.processIdentity, async (home, codexHome) => {
    const invocation = isolatedChildInvocation(
      input.command,
      ["debug", "models", "--bundled"],
      input.processIdentity,
    );
    const { stdout } = await runCommand(invocation.command, invocation.args, {
      encoding: "utf8",
      cwd: home,
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TMPDIR: home,
        TEMP: home,
        TMP: home,
        CODEX_HOME: codexHome,
        HOME: home,
      },
    });
    return templateCatalogSchema.parse(JSON.parse(stdout));
  });
}

async function probeDefaultInstructions(input: ProbeIdentity): Promise<string> {
  return withProbeHome(input.processIdentity, async (home, codexHome) => {
    const client = new CodexJsonRpcClient({
      command: input.command,
      cwd: home,
      userHome: home,
      codexHome,
      logger: pino({ enabled: false }),
      requestTimeoutMs: 5_000,
      ...(input.processIdentity ? { processIdentity: input.processIdentity } : {}),
      configOverrides: [
        'cli_auth_credentials_store="ephemeral"',
        "check_for_update_on_startup=false",
        "analytics.enabled=false",
        "features.apps=false",
        "features.plugins=false",
        "features.remote_models=false",
        "features.memories=false",
        `model_providers.${catalogProbeProvider}={name="Catalog probe",base_url="http://127.0.0.1:1/v1",wire_api="responses"}`,
      ],
    });
    try {
      await client.initialize();
      const { thread } = probeThreadSchema.parse(await client.request("thread/start", {
        model: `${catalogProbeProvider}-model`,
        modelProvider: catalogProbeProvider,
        cwd: home,
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: false,
      }));
      await client.request("thread/inject_items", {
        threadId: thread.id,
        items: [{
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Catalog probe" }],
        }],
      });
      const file = await realpath(thread.path);
      const relativePath = relative(await realpath(codexHome), file);
      if (!relativePath.startsWith(`sessions${sep}`) || isAbsolute(relativePath)) {
        throw new Error("Codex catalog probe rollout escaped its temporary home");
      }
      return probeRolloutSchema.parse(JSON.parse(await readFirstLine(file)))
        .payload.base_instructions.text;
    } finally {
      await client.close();
    }
  });
}

/** Match the pinned native descriptor for an unknown model, not a bundled model's capabilities. */
function genericModelEntry(model: string, instructions: string): Record<string, unknown> {
  return {
    slug: model,
    display_name: model,
    description: null,
    supported_reasoning_levels: [],
    shell_type: "unified_exec",
    visibility: "none",
    supported_in_api: true,
    priority: 99,
    model_messages: { instructions_template: instructions },
    include_apps_usage_instructions: false,
    default_reasoning_summary: "auto",
    support_verbosity: false,
    truncation_policy: { mode: "bytes", limit: 10_000 },
    experimental_supported_tools: [],
    use_responses_lite: false,
  };
}

async function writeCatalog(catalogPath: string, payload: string): Promise<void> {
  await mkdir(dirname(catalogPath), { recursive: true });
  const temporary = `${catalogPath}.${randomUUID()}.tmp`;
  // The task identity reads the catalog, so keep it readable inside the
  // group-shared CODEX_HOME.
  await writeFile(temporary, payload, { mode: 0o644, flag: "wx" });
  try {
    await rename(temporary, catalogPath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readFirstLine(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(1_024 * 1_024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const newline = text.indexOf("\n");
    return newline === -1 ? text : text.slice(0, newline);
  } finally {
    await handle.close();
  }
}
