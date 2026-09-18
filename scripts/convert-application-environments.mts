import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { runApplicationEnvironmentConversion } from "../apps/api/src/commands/convert-application-environments.ts";
import { prepareNativeHomeFiles, nativeHomeTemporaryEntries } from "../apps/api/src/operations/native-home-files.ts";
import { CodexJsonRpcClient } from "../apps/runner/src/codex/json-rpc-client.ts";
import { CODEX_SCHEMA_VERSION } from "../apps/runner/src/codex/protocol.ts";

// Offline operator command. All native schema changes run through the pinned
// app-server on disposable copies, never through hand-written SQLite migrations.
const execute = promisify(execFile);
const command = process.env.CODEX_BIN || "codex";
const temporary = await mkdtemp(join(tmpdir(), "linksense-native-upgrade-"));
const normalized = new Map<string, string>();
const require = createRequire(new URL("../apps/runner/package.json", import.meta.url));
const logger = require("pino")({ enabled: false });
try {
  const version = (await execute(command, ["--version"], { timeout: 10000 })).stdout.trim().split(/\s+/u).at(-1);
  if (version !== CODEX_SCHEMA_VERSION) throw new Error("MIGRATION_NATIVE_VERSION_REQUIRED");
  await runApplicationEnvironmentConversion(async source => {
    const previous = normalized.get(source); if (previous) return previous;
    const home = join(temporary, String(normalized.size), "home"), codexHome = join(home, ".codex");
    await mkdir(home, { recursive: true, mode: 0o700 });
    await cp(source, codexHome, { recursive: true, dereference: false, verbatimSymlinks: true,
      filter: path => dirname(path) !== source || !nativeHomeTemporaryEntries.has(basename(path)) });
    await prepareNativeHomeFiles(source, codexHome);
    const client = new CodexJsonRpcClient({ command, userHome: home, codexHome, logger, requestTimeoutMs: 30000,
      configOverrides: ['features.memories=false', 'features.hooks=false', 'features.multi_agent=false'] });
    try { await client.initialize(); await client.request("thread/list", { limit: 1 }); }
    finally { await client.close(); }
    normalized.set(source, codexHome);
    return codexHome;
  });
} catch (error) {
  const code = error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message) ? error.message : "MIGRATION_FAILED";
  process.stderr.write(JSON.stringify({ error_code: code }) + "\n"); process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
