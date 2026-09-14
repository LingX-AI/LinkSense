import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { z } from "zod";

import { isolatedChildInvocation, type ProcessIdentity } from "../child-process-isolation.js";
import { CODEX_SCHEMA_VERSION } from "./protocol.js";

const execFileAsync = promisify(execFile);
const versionOutputSchema = z.string().trim().regex(/^codex-cli \d+\.\d+\.\d+$/u);

export type CodexVersionCommand = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>;

/** Check before starting execution services so an unsupported binary cannot accept tasks. */
export async function assertCodexRuntimeVersion(
  input: { command: string; processIdentity?: ProcessIdentity },
  runCommand: CodexVersionCommand = execFileAsync,
): Promise<void> {
  const invocation = isolatedChildInvocation(input.command, ["--version"], input.processIdentity);
  let stdout: string;
  try {
    ({ stdout } = await runCommand(invocation.command, invocation.args, {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 4096,
    }));
  } catch {
    throw new Error(
      `Unable to verify Codex ${CODEX_SCHEMA_VERSION}; check the worker image and CODEX_BIN`,
    );
  }
  const output = versionOutputSchema.safeParse(stdout);
  if (!output.success) {
    throw new Error("Codex returned an invalid version response");
  }
  const actualVersion = output.data.slice("codex-cli ".length);
  if (actualVersion !== CODEX_SCHEMA_VERSION) {
    throw new Error(
      `Codex version mismatch: expected ${CODEX_SCHEMA_VERSION}, received ${actualVersion}`,
    );
  }
}
