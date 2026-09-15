import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, cp, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, stringify } from "smol-toml";
import { coreMcpServerKey, managedBrowserMcpServerKey } from "@linksense/shared";
import { PERSONAL_PLUGIN_MARKETPLACE_NAME } from "../modules/capabilities/user-home-materializer.js";

export const nativeHomeTemporaryEntries: ReadonlySet<string> = new Set(["tmp", ".tmp", "thread-writer-locks"]);

/** Machine-local diagnostic IDs cannot be merged as globally unique history.
 * Retain each original outside HOME, including damaged logs, for inspection. */
export async function prepareNativeHomeFiles(source: string, target: string): Promise<Set<string>> {
  const excluded = new Set<string>();
  const archive = resolve(target, "../../control/native-home-imports", createHash("sha256").update(source).digest("hex"));
  const names = await readdir(source);
  for (const name of names) {
    // The stopped process's temporary catalogs and locks are regenerated. The
    // coordinator retains the original HOME for rollback; do not duplicate them.
    if (nativeHomeTemporaryEntries.has(name)) { excluded.add(name); continue; }
    if (!/^(?:(?:logs|state|goals|memories|queue)_\d+\.sqlite(?:-wal|-shm)?|memories|logs|installation_id|config\.toml|AGENTS\.md)$/.test(name)) continue;
    if (["config.toml", "installation_id", "AGENTS.md"].includes(name) && !(await lstat(join(source, name))).isFile()) throw new Error("MIGRATION_NATIVE_PATH_INVALID");
    await mkdir(archive, { recursive: true, mode: 0o700 });
    await cp(join(source, name), join(archive, name), { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false, mode: constants.COPYFILE_FICLONE });
    if (name !== "AGENTS.md" && !/^(?:state|goals|memories|queue)_\d+\.sqlite(?:-wal|-shm)?$/.test(name)) excluded.add(name);
  }
  if (names.includes("installation_id") && !await exists(join(target, "installation_id"))) {
    await copyFile(join(source, "installation_id"), join(target, "installation_id"), constants.COPYFILE_EXCL);
  }
  // Phase 2 owns one Git baseline per HOME. Keep that workspace intact and
  // archive each other rendered version; merged stage-1 SQLite records feed
  // the native consolidation pipeline on subsequent session starts.
  if (names.includes("memories")) {
    const memory = await lstat(join(source, "memories"));
    if (!memory.isDirectory() || memory.isSymbolicLink()) throw new Error("MIGRATION_NATIVE_PATH_INVALID");
    if (!await exists(join(target, "memories"))) excluded.delete("memories");
  }
  if (names.includes("config.toml")) {
    const destination = join(target, "config.toml");
    const incoming = portableConfiguration(await readFile(join(source, "config.toml"), "utf8"));
    const current = await exists(destination) ? portableConfiguration(await readFile(destination, "utf8")) : {};
    await writeFile(destination, stringify(mergeConfiguration(current, incoming)), { mode: 0o600 });
  }
  return excluded;
}

function portableConfiguration(source: string): Record<string, unknown> {
  const config: Record<string, unknown> = parse(source);
  // The runner supplies these per process. Carrying their old localhost ports
  // or task context into a shared HOME would preserve an obsolete connection.
  for (const [table, keys] of [
    ["mcp_servers", [coreMcpServerKey, managedBrowserMcpServerKey]],
    ["marketplaces", [PERSONAL_PLUGIN_MARKETPLACE_NAME]],
  ] as const) {
    const value = config[table];
    if (isTable(value)) for (const key of keys) delete value[key];
  }
  const providers = config.model_providers;
  if (config.model_provider === "link-sense" || (isTable(providers) && Object.hasOwn(providers, "link-sense"))) {
    if (providers !== undefined && !isTable(providers)) throw new Error("MIGRATION_NATIVE_CONFIG_INVALID");
    // Native plugin CLI commands also load this provider, before the runner's
    // process overrides exist. Match the fresh-HOME template's inert definition
    // while removing every old gateway address, token and header.
    config.model_providers = {
      ...providers,
      "link-sense": {
        name: "LinkSense",
        base_url: "http://127.0.0.1:1/linksense-model-provider-not-configured",
        wire_api: "responses",
        env_key: "LINKSENSE_MODEL_GATEWAY_TOKEN",
        supports_websockets: true,
        stream_max_retries: 2,
        websocket_connect_timeout_ms: 12000,
        requires_openai_auth: false,
      },
    };
  }
  for (const key of ["model_context_window", "model_auto_compact_token_limit", "model_auto_compact_token_limit_scope"]) delete config[key];
  if (isTable(config.skills)) {
    delete config.skills.include_instructions;
    if (isTable(config.skills.bundled)) delete config.skills.bundled.enabled;
  }
  if (isTable(config.plugins)) {
    for (const key of Object.keys(config.plugins)) if (key.endsWith(`@${PERSONAL_PLUGIN_MARKETPLACE_NAME}`)) delete config.plugins[key];
  }
  return config;
}

function isTable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function mergeConfiguration(target: Record<string, unknown>, source: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: true });
    else if (isTable(target[key]) && isTable(value)) mergeConfiguration(target[key], value, `${prefix}${key}.`);
    else if (!isDeepStrictEqual(target[key], value)) throw new Error("MIGRATION_NATIVE_CONFIG_CONFLICT", { cause: { key: `${prefix}${key}` } });
  }
  return target;
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
