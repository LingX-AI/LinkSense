import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { z } from "zod";

const environmentKeySchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
  .max(120);
const environmentSourceSchema = z
  .string()
  .regex(/^LINKSENSE_(?:MCP_STDIO|CREDENTIAL)_[A-F0-9]{32}$/u);

export const PERSONAL_STDIO_PNPM_ENVIRONMENT_NAMES =
  "LINKSENSE_PNPM_PASSTHROUGH_ENV_NAMES";

const descriptorSchema = z.strictObject({
  version: z.literal(1),
  command: z.string().min(1).max(512),
  args: z.array(z.string().max(4_096)).max(128),
  environmentVariables: z
    .array(
      z.strictObject({
        name: environmentKeySchema,
        source: environmentSourceSchema,
      }),
    )
    .max(256),
});

export type PersonalStdioDescriptor = z.infer<typeof descriptorSchema>;

export function encodePersonalStdioDescriptor(
  descriptor: PersonalStdioDescriptor,
): string {
  return Buffer.from(
    JSON.stringify(descriptorSchema.parse(descriptor)),
    "utf8",
  ).toString("base64url");
}

export function decodePersonalStdioDescriptor(
  encoded: string,
): PersonalStdioDescriptor {
  if (encoded.length > 256 * 1_024) {
    throw new Error("personal MCP descriptor is too large");
  }
  return descriptorSchema.parse(
    JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
  );
}

export function normalizePersonalStdioCommand(
  command: string,
  args: readonly string[],
): { command: string; args: string[] } {
  const executable = path.basename(command).toLowerCase();
  if (executable === "npx" || executable === "npx.cmd") {
    return {
      command: "linksense-pnpm",
      args: ["dlx", ...args.filter((argument) => argument !== "-y" && argument !== "--yes")],
    };
  }
  if (
    (executable === "pnpm" || executable === "pnpm.cmd") &&
    args[0] === "dlx"
  ) {
    return { command: "linksense-pnpm", args: [...args] };
  }
  return { command, args: [...args] };
}

export function personalStdioChildEnvironment(
  descriptor: PersonalStdioDescriptor,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined &&
          !name.startsWith("LINKSENSE_MCP_STDIO_") &&
          !name.startsWith("LINKSENSE_CREDENTIAL_"),
    ),
  );
  for (const mapping of descriptor.environmentVariables) {
    const value = source[mapping.source];
    if (value === undefined) {
      throw new Error("personal MCP environment is unavailable");
    }
    environment[mapping.name] = value;
  }
  return environment;
}

export function personalStdioInvocationEnvironment(
  invocation: { command: string; args: readonly string[] },
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): Record<string, string> {
  const childEnvironment = Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete childEnvironment[PERSONAL_STDIO_PNPM_ENVIRONMENT_NAMES];
  if (
    invocation.command === "linksense-pnpm" &&
    invocation.args[0] === "dlx" &&
    names.length > 0
  ) {
    childEnvironment[PERSONAL_STDIO_PNPM_ENVIRONMENT_NAMES] = [
      ...new Set(names),
    ]
      .sort()
      .join(",");
  }
  return childEnvironment;
}

async function main(): Promise<void> {
  const encoded = process.argv[2];
  if (!encoded) throw new Error("personal MCP descriptor is missing");
  const descriptor = decodePersonalStdioDescriptor(encoded);
  const invocation = normalizePersonalStdioCommand(
    descriptor.command,
    descriptor.args,
  );
  const environment = personalStdioInvocationEnvironment(
    invocation,
    personalStdioChildEnvironment(descriptor),
    descriptor.environmentVariables.map(({ name }) => name),
  );
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: environment,
    shell: false,
    stdio: "inherit",
  });
  const forward = (signal: NodeJS.Signals) => {
    if (child.exitCode === null) child.kill(signal);
  };
  process.once("SIGTERM", () => forward("SIGTERM"));
  process.once("SIGINT", () => forward("SIGINT"));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 1;
      resolve();
    });
  });
}

function isMainModule(): boolean {
  return process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  await main().catch(() => {
    process.stderr.write("Unable to start the STDIO MCP server.\n");
    process.exitCode = 1;
  });
}
