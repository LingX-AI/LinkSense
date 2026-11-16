import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function dependencyTunnelArguments(environment) {
  const target = environment.LINKSENSE_DEV_SSH_TARGET?.trim();
  if (!target || !/^(?:[a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/u.test(target)) {
    throw new Error("LINKSENSE_DEV_SSH_TARGET must be an SSH host or configured host alias");
  }
  const forwards = environment.LINKSENSE_DEV_SSH_FORWARDS?.split(",") ?? [];
  const localPorts = new Set();
  const argumentsList = [
    "-NT",
    "-o", "BatchMode=yes",
    "-o", "ControlMaster=no",
    "-o", "ControlPath=none",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=3",
  ];
  if (!forwards.length || forwards.length > 16) {
    throw new Error("LINKSENSE_DEV_SSH_FORWARDS requires 1–16 local:remote port pairs");
  }
  for (const forward of forwards) {
    const match = /^([0-9]{1,5}):([0-9]{1,5})$/u.exec(forward.trim());
    const localPort = Number(match?.[1]);
    const remotePort = Number(match?.[2]);
    if (!match || localPort < 1 || localPort > 65_535 || remotePort < 1 || remotePort > 65_535 || localPorts.has(localPort)) {
      throw new Error("LINKSENSE_DEV_SSH_FORWARDS requires valid, distinct local:remote port pairs");
    }
    localPorts.add(localPort);
    argumentsList.push("-L", `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`);
  }
  return [...argumentsList, "--", target];
}

export async function main() {
  const environmentFile = resolve(
    repositoryRoot,
    process.env.LINKSENSE_ENV_FILE?.trim() || ".env.host",
  );
  const environment = {
    ...process.env,
    ...parseEnv(readFileSync(environmentFile, "utf8")),
  };
  const child = spawn("ssh", dependencyTunnelArguments(environment), {
    stdio: "inherit",
  });
  const stop = (signal) => child.kill(signal);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    process.exitCode = await new Promise((resolveExit, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) =>
        resolveExit(signal === "SIGINT" || signal === "SIGTERM" ? 0 : code ?? 1),
      );
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
