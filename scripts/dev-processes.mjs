import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const registryVersion = 1;
const defaultGracePeriodMilliseconds = 2_000;
const defaultPollMilliseconds = 50;

const serviceTemplates = [
  {
    label: "Compose helpers",
    workspace: "@linksense/compose-helpers",
    relativeDirectory: ".",
    processKind: "compose-helper",
  },
  {
    label: "Runner",
    workspace: "@linksense/runner",
    relativeDirectory: "apps/runner",
    port: 4010,
  },
  {
    label: "API",
    workspace: "@linksense/api",
    relativeDirectory: "apps/api",
    port: 4000,
  },
  {
    label: "Web",
    workspace: "@linksense/web",
    relativeDirectory: "apps/web",
    port: 5173,
  },
  {
    label: "Docs",
    workspace: "@linksense/docs",
    relativeDirectory: "apps/docs",
    port: 3001,
  },
];

function servicesFor(rootDirectory) {
  const repositoryRoot = resolve(rootDirectory);
  return serviceTemplates.map((service) => ({
    ...service,
    directory: resolve(repositoryRoot, service.relativeDirectory),
  }));
}

export function developmentProcessRegistryPath(rootDirectory) {
  return resolve(rootDirectory, ".data/dev/processes.json");
}

export function createDevelopmentProcessRegistry(rootDirectory, sessionId) {
  return {
    version: registryVersion,
    repositoryRoot: resolve(rootDirectory),
    sessionId,
    processes: [],
  };
}

export function writeDevelopmentProcessRegistry(rootDirectory, registry) {
  const registryPath = developmentProcessRegistryPath(rootDirectory);
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, registryPath);
}

export function removeDevelopmentProcessRegistry(
  rootDirectory,
  expectedSessionId,
) {
  const registryPath = developmentProcessRegistryPath(rootDirectory);
  if (!existsSync(registryPath)) return false;
  if (expectedSessionId) {
    try {
      const registry = JSON.parse(readFileSync(registryPath, "utf8"));
      if (registry.sessionId !== expectedSessionId) return false;
    } catch {
      return false;
    }
  }
  rmSync(registryPath, { force: true });
  return true;
}

function isPathWithin(parentPath, candidatePath) {
  if (!candidatePath) return false;
  const difference = relative(resolve(parentPath), resolve(candidatePath));
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

function isDevelopmentComposeHelperCommand(command) {
  return (
    /(?:^|[/\s])(?:docker|docker-compose)(?:\s|$)/u.test(command) &&
    command.includes("docker-compose.dev.yml") &&
    /(?:^|\s)(?:watch|logs)(?:\s|$)/u.test(command)
  );
}

function processMatchesService(processInformation, service, repositoryRoot) {
  const command = processInformation.command ?? "";
  const workingDirectory = processInformation.workingDirectory;
  if (service.processKind === "compose-helper") {
    return (
      isPathWithin(repositoryRoot, workingDirectory) &&
      isDevelopmentComposeHelperCommand(command)
    );
  }
  if (command.includes(`${service.directory}${sep}`)) return true;
  if (isPathWithin(service.directory, workingDirectory)) {
    return (
      command.includes(`${repositoryRoot}${sep}`) ||
      command.includes(service.workspace) ||
      /(?:^|\s)(?:node|tsx|vite)(?:\s|$)/u.test(command)
    );
  }
  return (
    isPathWithin(repositoryRoot, workingDirectory) &&
    command.includes(service.workspace)
  );
}

function parseProcessGroupMembers(
  output,
  processInspector,
  expectedProcessGroupId,
  commandFilter,
) {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    if (!match) return [];
    const pid = Number(match[1]);
    const processGroupId = Number(match[2]);
    if (
      expectedProcessGroupId !== undefined &&
      processGroupId !== expectedProcessGroupId
    ) {
      return [];
    }
    if (commandFilter && !commandFilter(match[3])) return [];
    return [
      {
        pid,
        processGroupId,
        command: match[3],
        workingDirectory: processInspector.readWorkingDirectory(pid),
      },
    ];
  });
}

export function parseDevelopmentComposeProcesses(output, processInspector) {
  // On macOS each directory probe spawns lsof. Filter the cheap ps snapshot
  // first; shutdown still verifies repository ownership and the full group.
  return parseProcessGroupMembers(
    output,
    processInspector,
    undefined,
    isDevelopmentComposeHelperCommand,
  );
}

function runInspectionCommand(command, argumentsList) {
  const result = spawnSync(command, argumentsList, { encoding: "utf8" });
  if (result.error) {
    if (result.error.code === "ENOENT") return undefined;
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `${command} ${argumentsList.join(" ")} exited with ${result.status ?? "no status"}`,
    );
  }
  return result.stdout;
}

function readWorkingDirectory(pid) {
  if (process.platform === "linux") {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return undefined;
    }
  }

  const output = runInspectionCommand("lsof", [
    "-a",
    "-p",
    String(pid),
    "-d",
    "cwd",
    "-Fn",
  ]);
  return output
    ?.split("\n")
    .find((line) => line.startsWith("n"))
    ?.slice(1);
}

function processInformation(pid) {
  const output = runInspectionCommand("ps", [
    "-o",
    "pid=,pgid=,command=",
    "-p",
    String(pid),
  ]);
  const [information] = parseProcessGroupMembers(output ?? "", {
    readWorkingDirectory,
  });
  return information;
}

function createSystemProcessInspector() {
  return {
    currentProcessGroupId() {
      return processInformation(process.pid)?.processGroupId;
    },
    listListeningProcessIds(port) {
      const output = runInspectionCommand("lsof", [
        "-nP",
        `-iTCP:${port}`,
        "-sTCP:LISTEN",
        "-Fp",
      ]);
      return [
        ...new Set(
          (output ?? "")
            .split("\n")
            .filter((line) => /^p\d+$/u.test(line))
            .map((line) => Number(line.slice(1))),
        ),
      ];
    },
    readProcess(pid) {
      return processInformation(pid);
    },
    readProcessGroupMembers(processGroupId) {
      const output = runInspectionCommand("ps", [
        "-axo",
        "pid=,pgid=,command=",
      ]);
      return parseProcessGroupMembers(
        output ?? "",
        {
          readWorkingDirectory,
        },
        processGroupId,
      );
    },
    listProcesses() {
      const output = runInspectionCommand("ps", [
        "-axo",
        "pid=,pgid=,command=",
      ]);
      return parseDevelopmentComposeProcesses(output ?? "", {
        readWorkingDirectory,
      });
    },
    processGroupExists(processGroupId) {
      try {
        process.kill(-processGroupId, 0);
        return true;
      } catch (error) {
        return error?.code === "EPERM";
      }
    },
    signalProcessGroup(processGroupId, signal) {
      process.kill(-processGroupId, signal);
    },
  };
}

function readDevelopmentProcessRegistry(rootDirectory) {
  const registryPath = developmentProcessRegistryPath(rootDirectory);
  if (!existsSync(registryPath)) return { registry: undefined };
  try {
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    if (
      registry.version !== registryVersion ||
      registry.repositoryRoot !== resolve(rootDirectory) ||
      typeof registry.sessionId !== "string" ||
      !Array.isArray(registry.processes)
    ) {
      throw new Error("registry metadata does not match this repository");
    }
    return { registry };
  } catch (error) {
    return {
      registry: undefined,
      warning: `Ignored invalid development process registry: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

function addCandidate(candidates, processGroupId, service, source) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) return;
  const candidate = candidates.get(processGroupId) ?? {
    processGroupId,
    services: new Map(),
    sources: new Set(),
  };
  candidate.services.set(service.workspace, service);
  candidate.sources.add(source);
  candidates.set(processGroupId, candidate);
}

function signalCandidate(processInspector, candidate, signal, warnings) {
  try {
    processInspector.signalProcessGroup(candidate.processGroupId, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    warnings.push(
      `Unable to send ${signal} to process group ${candidate.processGroupId}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return false;
  }
}

export async function stopDevelopmentApplications(rootDirectory, options = {}) {
  if (process.platform === "win32" && !options.processInspector) {
    throw new Error(
      "pnpm dev:stop currently requires macOS or Linux process-group support.",
    );
  }

  const repositoryRoot = resolve(rootDirectory);
  const services = servicesFor(repositoryRoot);
  const serviceByWorkspace = new Map(
    services.map((service) => [service.workspace, service]),
  );
  const processInspector =
    options.processInspector ?? createSystemProcessInspector();
  const delay =
    options.delay ??
    ((milliseconds) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)));
  const now = options.now ?? Date.now;
  const gracePeriodMilliseconds =
    options.gracePeriodMilliseconds ?? defaultGracePeriodMilliseconds;
  const pollMilliseconds = options.pollMilliseconds ?? defaultPollMilliseconds;
  const warnings = [];
  const candidates = new Map();
  const registryResult = readDevelopmentProcessRegistry(repositoryRoot);
  if (registryResult.warning) warnings.push(registryResult.warning);

  for (const processEntry of registryResult.registry?.processes ?? []) {
    const service = serviceByWorkspace.get(processEntry.workspace);
    if (!service) {
      warnings.push(
        `Ignored unknown registered development service: ${String(processEntry.workspace)}`,
      );
      continue;
    }
    addCandidate(
      candidates,
      Number(processEntry.processGroupId),
      service,
      "registry",
    );
  }

  for (const service of services) {
    if (service.processKind === "compose-helper") {
      for (const processEntry of processInspector.listProcesses?.() ?? []) {
        if (!processMatchesService(processEntry, service, repositoryRoot)) {
          continue;
        }
        addCandidate(
          candidates,
          processEntry.processGroupId,
          service,
          "project Compose helper",
        );
      }
      continue;
    }
    for (const pid of processInspector.listListeningProcessIds(service.port)) {
      const processEntry = processInspector.readProcess(pid);
      if (
        !processEntry ||
        !processMatchesService(processEntry, service, repositoryRoot)
      ) {
        continue;
      }
      addCandidate(
        candidates,
        processEntry.processGroupId,
        service,
        `port ${service.port}`,
      );
    }
  }

  const currentProcessGroupId = processInspector.currentProcessGroupId();
  const targetedCandidates = [];
  for (const candidate of candidates.values()) {
    if (candidate.processGroupId === currentProcessGroupId) {
      warnings.push(
        `Refused to stop the current terminal process group ${candidate.processGroupId}.`,
      );
      continue;
    }
    const members = processInspector.readProcessGroupMembers(
      candidate.processGroupId,
    );
    const ownedServices = [...candidate.services.values()].filter((service) =>
      members.some((member) =>
        processMatchesService(member, service, repositoryRoot),
      ),
    );
    if (ownedServices.length === 0) {
      warnings.push(
        `Ignored stale process group ${candidate.processGroupId}; it no longer belongs to LinkSense.`,
      );
      continue;
    }
    const processGroupLeader = members.find(
      (member) => member.pid === candidate.processGroupId,
    );
    const processGroupLeaderIsOwned =
      processGroupLeader &&
      ownedServices.some((service) =>
        processMatchesService(processGroupLeader, service, repositoryRoot),
      );
    const leaderIsUnrelated = processGroupLeader && !processGroupLeaderIsOwned;
    const leaderIsMissingFromMixedGroup =
      !processGroupLeader &&
      members.some(
        (member) =>
          !ownedServices.some((service) =>
            processMatchesService(member, service, repositoryRoot),
          ),
      );
    if (leaderIsUnrelated || leaderIsMissingFromMixedGroup) {
      warnings.push(
        `Refused to stop mixed process group ${candidate.processGroupId}; it contains processes outside LinkSense ${ownedServices
          .map((service) => service.label)
          .join("/")}.`,
      );
      continue;
    }
    candidate.ownedServices = ownedServices;
    if (signalCandidate(processInspector, candidate, "SIGTERM", warnings)) {
      targetedCandidates.push(candidate);
    }
  }

  const deadline = now() + gracePeriodMilliseconds;
  let remainingCandidates = targetedCandidates.filter((candidate) =>
    processInspector.processGroupExists(candidate.processGroupId),
  );
  while (remainingCandidates.length > 0 && now() < deadline) {
    await delay(Math.min(pollMilliseconds, Math.max(1, deadline - now())));
    remainingCandidates = remainingCandidates.filter((candidate) =>
      processInspector.processGroupExists(candidate.processGroupId),
    );
  }

  const forcedServices = new Set();
  for (const candidate of remainingCandidates) {
    if (signalCandidate(processInspector, candidate, "SIGKILL", warnings)) {
      for (const service of candidate.ownedServices) {
        forcedServices.add(service.label);
      }
    }
  }

  if (registryResult.registry) {
    removeDevelopmentProcessRegistry(
      repositoryRoot,
      registryResult.registry.sessionId,
    );
  }

  return {
    stoppedServices: [
      ...new Set(
        targetedCandidates.flatMap((candidate) =>
          candidate.ownedServices.map((service) => service.label),
        ),
      ),
    ],
    forcedServices: [...forcedServices],
    warnings,
  };
}
