import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js";

const execFileAsync = promisify(execFile);
const cacheFile = "models_cache.json";
const cacheIdentity = "linksense";

const templateCatalogSchema = z.object({
  models: z.array(z.record(z.string(), z.unknown())).min(1),
});

type JsonObject = Record<string, unknown>;

export type ModelCatalogCacheInput = {
  command: string;
  codexHome: string;
  codexVersion: string;
  model: string;
  modelContextWindow?: number;
  processIdentity?: ProcessIdentity;
};

export interface ModelCatalogCacheWriter {
  ensure(input: ModelCatalogCacheInput): Promise<void>;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string }>;

/**
 * Codex clamps `model_context_window` to the model's `max_context_window`. Unknown
 * models fall back to 272k, so a 1M model still compacts at ~258k unless Codex has
 * a catalog entry. Seed `models_cache.json` with the configured model and window.
 */
export function createCodexModelCatalogCacheWriter(deps: {
  runCommand?: CommandRunner;
  now?: () => Date;
} = {}): ModelCatalogCacheWriter {
  const runCommand = deps.runCommand ?? execFileAsync;
  const now = deps.now ?? (() => new Date());
  const templates = new Map<string, Promise<JsonObject | null>>();
  const baseInstructions = new Map<string, Promise<string | null>>();
  const writeLocks = new Map<string, Promise<void>>();

  function templateFor(
    command: string,
    processIdentity: ProcessIdentity | undefined,
  ): Promise<JsonObject | null> {
    const key = processIdentity ? `${command}\0${processIdentity.uid}:${processIdentity.gid}` : command;
    let template = templates.get(key);
    if (!template) {
      template = loadTemplate(command, processIdentity, runCommand);
      templates.set(key, template);
    }
    return template;
  }

  return {
    async ensure(input) {
      if (input.modelContextWindow === undefined) return;
      const template = await templateFor(input.command, input.processIdentity);
      if (!template) return;
      const instructions = await instructionsFor(
        input.codexHome,
        baseInstructions,
      );
      // Without a prior LinkSense session there is no known-good synthetic
      // instruction template; skip rather than replacing Codex's instructions.
      if (!instructions) return;
      const entry = buildModelEntry(template, {
        model: input.model,
        contextWindow: input.modelContextWindow,
        instructions,
      });
      const cachePath = join(input.codexHome, cacheFile);
      const previous = writeLocks.get(cachePath) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() =>
          writeCacheEntry(cachePath, input.codexVersion, entry, now()),
        );
      writeLocks.set(cachePath, next);
      try {
        await next;
      } finally {
        if (writeLocks.get(cachePath) === next) writeLocks.delete(cachePath);
      }
    },
  };
}

async function loadTemplate(
  command: string,
  processIdentity: ProcessIdentity | undefined,
  runCommand: CommandRunner,
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
    const invocation = isolatedChildInvocation(command, ["debug", "models"], processIdentity);
    const { stdout } = await runCommand(invocation.command, invocation.args, {
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, CODEX_HOME: codexHome, HOME: home },
    });
    const parsed = templateCatalogSchema.safeParse(JSON.parse(stdout));
    if (!parsed.success) return null;
    return (
      parsed.data.models.find((model) => {
        const messages = model.model_messages;
        return (
          isRecord(messages) &&
          typeof messages.instructions_template === "string" &&
          messages.instructions_template.trim() !== ""
        );
      }) ?? null
    );
  } catch {
    return null;
  } finally {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function instructionsFor(
  codexHome: string,
  cache: Map<string, Promise<string | null>>,
): Promise<string | null> {
  let instructions = cache.get(codexHome);
  if (!instructions) {
    instructions = readLatestBaseInstructions(codexHome);
    cache.set(codexHome, instructions);
  }
  return await instructions;
}

async function readLatestBaseInstructions(codexHome: string): Promise<string | null> {
  try {
    const sessionsRoot = join(codexHome, "sessions");
    const files = await collectSessionFiles(sessionsRoot, 3);
    for (const file of files) {
      const firstLine = await readFirstLine(file);
      const parsed = safeJson(firstLine);
      const payload = isRecord(parsed) && isRecord(parsed.payload) ? parsed.payload : null;
      const base = payload && isRecord(payload.base_instructions) ? payload.base_instructions : null;
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

async function collectSessionFiles(root: string, limit: number): Promise<string[]> {
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
  input: { model: string; contextWindow: number; instructions: string },
): JsonObject {
  const messages = isRecord(template.model_messages) ? template.model_messages : {};
  return {
    ...template,
    slug: input.model,
    display_name: input.model,
    description: null,
    priority: 1,
    context_window: input.contextWindow,
    max_context_window: input.contextWindow,
    effective_context_window_percent: 100,
    auto_compact_token_limit: null,
    model_messages: {
      ...messages,
      instructions_template: input.instructions,
    },
  };
}

async function writeCacheEntry(
  cachePath: string,
  codexVersion: string,
  entry: JsonObject,
  timestamp: Date,
): Promise<void> {
  const models = new Map<string, JsonObject>();
  try {
    const existing = JSON.parse(await readFile(cachePath, "utf8")) as unknown;
    if (
      isRecord(existing) &&
      existing.client_version === codexVersion &&
      Array.isArray(existing.models)
    ) {
      for (const model of existing.models) {
        if (isRecord(model) && typeof model.slug === "string") {
          models.set(model.slug, model);
        }
      }
    }
  } catch {
    // Missing or unreadable caches are replaced.
  }
  models.set(String(entry.slug), entry);
  const payload = {
    fetched_at: timestamp.toISOString(),
    client_version: codexVersion,
    identity: cacheIdentity,
    models: [...models.values()].slice(-50),
  };
  await mkdir(dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
  await rename(temporary, cachePath);
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
