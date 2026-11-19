import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js";

const execFileAsync = promisify(execFile);
const templateCatalogSchema = z.object({
  models: z.array(z.record(z.string(), z.unknown())).min(1),
});

type JsonObject = Record<string, unknown>;

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

type CommandRunner = (
  command: string,
  args: string[],
  options: {
    encoding: "utf8";
    timeout: number;
    maxBuffer: number;
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
  } = {}
): CodexModelCatalogWriter {
  const runCommand = deps.runCommand ?? execFileAsync;
  const templates = new Map<string, Promise<JsonObject | null>>();
  const baseInstructions = new Map<string, Promise<string | null>>();
  const writeLocks = new Map<string, Promise<void>>();

  async function templateFor(
    command: string,
    processIdentity: ProcessIdentity | undefined
  ): Promise<JsonObject | null> {
    const key = processIdentity
      ? `${command}\0${processIdentity.uid}:${processIdentity.gid}`
      : command;
    let template = templates.get(key);
    if (!template) {
      template = loadTemplate(command, processIdentity, runCommand);
      templates.set(key, template);
    }
    const value = await template;
    if (value === null && templates.get(key) === template) {
      templates.delete(key);
    }
    return value;
  }

  return {
    async ensure(input) {
      if (input.modelContextWindow === undefined) return null;
      const template = await templateFor(input.command, input.processIdentity);
      if (!template) return null;
      const instructions = await instructionsFor(
        input.codexHome,
        baseInstructions
      );
      // Without a prior LinkSense session there is no known-good synthetic
      // instruction template; skip rather than replacing Codex's instructions.
      if (!instructions) return null;
      const entry = buildModelEntry(template, {
        model: input.model,
        contextWindow: input.modelContextWindow,
        supportsImageInput: input.supportsImageInput === true,
        instructions,
      });
      // Other conversations can start with a different model before Codex loads this file.
      const identity = createHash("sha256")
        .update(JSON.stringify([input.model, input.modelContextWindow]))
        .digest("hex");
      const catalogPath = join(input.codexHome, `linksense-models-${identity}.json`);
      const previous = writeLocks.get(catalogPath) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => writeCatalog(catalogPath, template, entry));
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

async function loadTemplate(
  command: string,
  processIdentity: ProcessIdentity | undefined,
  runCommand: CommandRunner
): Promise<JsonObject | null> {
  const root = await mkdtemp(join(tmpdir(), "linksense-codex-models-"));
  try {
    // The probe runs as the task identity while the supervisor owns the temp
    // root with mode 0700. Share the supervisor group so Codex can enter and
    // write its throwaway home; otherwise the probe fails and Codex clamps the
    // configured model window to its unknown-model default.
    await chmod(root, 0o770);
    const codexHome = join(root, "codex");
    const home = join(root, "home");
    await mkdir(codexHome, { recursive: true, mode: 0o770 });
    await mkdir(home, { recursive: true, mode: 0o770 });
    // mkdir modes are masked by umask, so set the shared group explicitly.
    await Promise.all([chmod(codexHome, 0o770), chmod(home, 0o770)]);
    const invocation = isolatedChildInvocation(
      command,
      ["debug", "models"],
      processIdentity
    );
    const { stdout } = await runCommand(invocation.command, invocation.args, {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CODEX_HOME: codexHome, HOME: home },
    });
    const parsed = templateCatalogSchema.safeParse(JSON.parse(stdout));
    if (!parsed.success) return null;
    if (!baseTemplateModel(parsed.data.models)) return null;
    return parsed.data;
  } catch {
    return null;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

function baseTemplateModel(models: readonly JsonObject[]): JsonObject | null {
  return (
    models.find((model) => {
      const messages = model.model_messages;
      return (
        isRecord(messages) &&
        typeof messages.instructions_template === "string" &&
        messages.instructions_template.trim() !== ""
      );
    }) ?? null
  );
}

async function instructionsFor(
  codexHome: string,
  cache: Map<string, Promise<string | null>>
): Promise<string | null> {
  let instructions = cache.get(codexHome);
  if (!instructions) {
    instructions = readLatestBaseInstructions(codexHome);
    cache.set(codexHome, instructions);
  }
  const value = await instructions;
  if (value === null && cache.get(codexHome) === instructions) {
    cache.delete(codexHome);
  }
  return value;
}

async function readLatestBaseInstructions(
  codexHome: string
): Promise<string | null> {
  try {
    const sessionsRoot = join(codexHome, "sessions");
    const files = await collectSessionFiles(sessionsRoot, 3);
    for (const file of files) {
      const firstLine = await readFirstLine(file);
      const parsed = safeJson(firstLine);
      const payload =
        isRecord(parsed) && isRecord(parsed.payload) ? parsed.payload : null;
      const base =
        payload && isRecord(payload.base_instructions)
          ? payload.base_instructions
          : null;
      if (
        payload?.model_provider === "link-sense" &&
        base &&
        typeof base.text === "string" &&
        base.text.trim() !== ""
      ) {
        return base.text;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function collectSessionFiles(
  root: string,
  limit: number
): Promise<string[]> {
  const files: Array<{ path: string; mtimeMs: number }> = [];
  async function walk(directory: string, depth: number): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth > 0) await walk(path, depth - 1);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const info = await stat(path);
        files.push({ path, mtimeMs: info.mtimeMs });
      }
    }
  }
  await walk(root, 4);
  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, limit)
    .map((file) => file.path);
}

function buildModelEntry(
  template: JsonObject,
  input: {
    model: string;
    contextWindow: number;
    supportsImageInput: boolean;
    instructions: string;
  }
): JsonObject {
  const base = baseTemplateModel(
    Array.isArray(template.models) ? template.models : []
  );
  const messages =
    base && isRecord(base.model_messages) ? base.model_messages : {};
  return {
    ...base,
    slug: input.model,
    display_name: input.model,
    description: null,
    priority: 1,
    context_window: input.contextWindow,
    max_context_window: input.contextWindow,
    effective_context_window_percent: 100,
    auto_compact_token_limit: null,
    // Never inherit the template's modalities: a text-only provider model must
    // not receive view_image results (base64 images are counted as tokens).
    input_modalities: input.supportsImageInput ? ["text", "image"] : ["text"],
    supports_image_detail_original: input.supportsImageInput
      ? base?.supports_image_detail_original === true
      : false,
    model_messages: {
      ...messages,
      instructions_template: input.instructions,
    },
  };
}

async function writeCatalog(
  catalogPath: string,
  template: JsonObject,
  entry: JsonObject
): Promise<void> {
  const models = (
    Array.isArray(template.models) ? template.models : []
  ).filter((model) => !isRecord(model) || model.slug !== entry.slug);
  const payload = { models: [...models, entry] };
  await mkdir(dirname(catalogPath), { recursive: true });
  const temporary = `${catalogPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  // The task identity reads the catalog, so keep it readable inside the
  // group-shared CODEX_HOME.
  await writeFile(temporary, JSON.stringify(payload), { mode: 0o644 });
  await rename(temporary, catalogPath);
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

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
