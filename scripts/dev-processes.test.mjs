import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  createDevelopmentProcessRegistry,
  developmentProcessRegistryPath,
  parseDevelopmentComposeProcesses,
  removeDevelopmentProcessRegistry,
  stopDevelopmentApplications,
  writeDevelopmentProcessRegistry,
} from "./dev-processes.mjs";

test("Compose discovery reads working directories only for development Watch and log candidates", () => {
  const reads = [];
  const processes = parseDevelopmentComposeProcesses(
    [
      "  PID PGID COMMAND",
      "  101 101 /usr/bin/window-server",
      "  202 202 node another-project/server.mjs",
      "  303 303 docker compose -f docker-compose.dev.yml build runner-worker-image",
      "  404 404 docker compose -f docker-compose.yml logs --follow",
      "  505 505 node watcher.mjs docker-compose.dev.yml",
      "  606 606 docker compose -f docker-compose.dev.yml watch --no-up api runner web",
      "  607 606 /opt/docker/cli-plugins/docker-compose compose -f docker-compose.dev.yml watch --no-up",
      "  707 707 /usr/local/bin/docker compose -f docker-compose.dev.yml logs --follow",
      "  808 808 docker compose -f docker-compose.dev.yml watch --no-up",
      "  909 909 /usr/local/bin/node /tmp/linksense/scripts/dev-watch.mjs /tmp/linksense/.env",
      "invalid process row",
    ].join("\n"),
    {
      readWorkingDirectory(pid) {
        reads.push(pid);
        return pid === 808 ? "/tmp/another-project" : "/tmp/linksense";
      },
    },
  );

  assert.deepEqual(reads, [606, 607, 707, 808, 909]);
  assert.deepEqual(processes.map(({ pid }) => pid), reads);
  assert.equal(processes[1].processGroupId, 606);
  // Discovery keeps other repositories as candidates; shutdown must still
  // verify working directories and every process-group member before signaling.
  assert.equal(processes[3].workingDirectory, "/tmp/another-project");
});

test("Compose discovery avoids directory probes when no development helpers exist", () => {
  const reads = [];
  const processes = parseDevelopmentComposeProcesses(
    Array.from(
      { length: 1000 },
      (_, index) => `${index + 1} 1 node app.mjs`,
    ).join("\n"),
    {
      readWorkingDirectory(pid) {
        reads.push(pid);
        return "/tmp/another-project";
      },
    },
  );

  assert.deepEqual(processes, []);
  assert.deepEqual(reads, []);
});

test("development process registry is replaced atomically and only removed by its owner", () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-dev-processes-"));
  try {
    const registry = createDevelopmentProcessRegistry(root, "session-current");
    registry.processes.push({
      label: "Runner",
      workspace: "@linksense/runner",
      processGroupId: 101,
    });
    writeDevelopmentProcessRegistry(root, registry);

    assert.deepEqual(
      JSON.parse(readFileSync(developmentProcessRegistryPath(root), "utf8")),
      registry,
    );
    assert.equal(
      removeDevelopmentProcessRegistry(root, "session-newer"),
      false,
    );
    assert.equal(existsSync(developmentProcessRegistryPath(root)), true);
    assert.equal(
      removeDevelopmentProcessRegistry(root, "session-current"),
      true,
    );
    assert.equal(existsSync(developmentProcessRegistryPath(root)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stopDevelopmentApplications clears registered and legacy project services", async () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-dev-stop-"));
  try {
    const registry = createDevelopmentProcessRegistry(root, "session-current");
    registry.processes.push({
      label: "Runner",
      workspace: "@linksense/runner",
      processGroupId: 101,
    });
    writeDevelopmentProcessRegistry(root, registry);

    const aliveGroups = new Set([101, 202]);
    const signals = [];
    const checkedPorts = [];
    let clock = 0;
    const result = await stopDevelopmentApplications(root, {
      gracePeriodMilliseconds: 10,
      pollMilliseconds: 5,
      now: () => clock,
      delay: async (milliseconds) => {
        clock += milliseconds;
      },
      processInspector: {
        currentProcessGroupId: () => 999,
        listListeningProcessIds: (port) => {
          checkedPorts.push(port);
          return ({
            4010: [1_001],
            4000: [2_001],
            18173: [],
          })[port] ?? [];
        },
        readProcess: (pid) =>
          ({
            1_001: {
              pid,
              processGroupId: 101,
              command: `${root}/node_modules/tsx src/index.ts`,
              workingDirectory: resolve(root, "apps/runner"),
            },
            2_001: {
              pid,
              processGroupId: 202,
              command: `${root}/node_modules/tsx src/index.ts`,
              workingDirectory: resolve(root, "apps/api"),
            },
          })[pid],
        readProcessGroupMembers: (processGroupId) =>
          ({
            101: [
              {
                pid: 101,
                processGroupId,
                command: "pnpm --filter @linksense/runner dev",
                workingDirectory: root,
              },
              {
                pid: 102,
                processGroupId,
                command: "python task-tool.py",
                workingDirectory: resolve(root, ".data/dev/workspaces/task-1"),
              },
            ],
            202: [
              {
                pid: 2_001,
                processGroupId,
                command: `${root}/node_modules/tsx src/index.ts`,
                workingDirectory: resolve(root, "apps/api"),
              },
            ],
          })[processGroupId] ?? [],
        processGroupExists: (processGroupId) => aliveGroups.has(processGroupId),
        signalProcessGroup: (processGroupId, signal) => {
          signals.push({ processGroupId, signal });
          if (signal === "SIGKILL" || processGroupId === 101) {
            aliveGroups.delete(processGroupId);
          }
        },
      },
    });

    assert.deepEqual(checkedPorts, [4010, 4000, 18173, 3001]);
    assert.deepEqual(signals, [
      { processGroupId: 101, signal: "SIGTERM" },
      { processGroupId: 202, signal: "SIGTERM" },
      { processGroupId: 202, signal: "SIGKILL" },
    ]);
    assert.deepEqual(result.stoppedServices, ["Runner", "API"]);
    assert.deepEqual(result.forcedServices, ["API"]);
    assert.deepEqual(result.warnings, []);
    assert.equal(existsSync(developmentProcessRegistryPath(root)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stopDevelopmentApplications clears only this repository's Compose helpers", async () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-dev-compose-stop-"));
  try {
    const signals = [];
    const aliveGroups = new Set([606, 707]);
    const projectProcesses = [
      {
        pid: 606,
        processGroupId: 606,
        command:
          "docker compose -f docker-compose.yml -f docker-compose.dev.yml watch --no-up api runner web",
        workingDirectory: root,
      },
      {
        pid: 707,
        processGroupId: 707,
        command:
          "docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --follow api runner web",
        workingDirectory: root,
      },
      {
        pid: 808,
        processGroupId: 808,
        command:
          "docker compose -f docker-compose.yml -f docker-compose.dev.yml watch --no-up api runner web",
        workingDirectory: "/tmp/another-project",
      },
    ];
    const result = await stopDevelopmentApplications(root, {
      processInspector: {
        currentProcessGroupId: () => 999,
        listProcesses: () => projectProcesses,
        listListeningProcessIds: () => [],
        readProcess: () => undefined,
        readProcessGroupMembers: (processGroupId) =>
          projectProcesses.filter(
            (processEntry) =>
              processEntry.processGroupId === processGroupId,
          ),
        processGroupExists: (processGroupId) =>
          aliveGroups.has(processGroupId),
        signalProcessGroup: (processGroupId, signal) => {
          signals.push({ processGroupId, signal });
          aliveGroups.delete(processGroupId);
        },
      },
    });

    assert.deepEqual(signals, [
      { processGroupId: 606, signal: "SIGTERM" },
      { processGroupId: 707, signal: "SIGTERM" },
    ]);
    assert.deepEqual(result.stoppedServices, ["Compose helpers"]);
    assert.deepEqual(result.warnings, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stopDevelopmentApplications refuses stale groups and unrelated port owners", async () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-dev-stop-safe-"));
  try {
    const registry = createDevelopmentProcessRegistry(root, "session-stale");
    registry.processes.push({
      label: "Web",
      workspace: "@linksense/web",
      processGroupId: 303,
    });
    writeDevelopmentProcessRegistry(root, registry);
    const signals = [];

    const result = await stopDevelopmentApplications(root, {
      processInspector: {
        currentProcessGroupId: () => 999,
        listListeningProcessIds: (port) => (port === 4000 ? [4_001] : []),
        readProcess: (pid) => ({
          pid,
          processGroupId: 404,
          command: "node another-project/server.mjs",
          workingDirectory: "/tmp/another-project",
        }),
        readProcessGroupMembers: () => [
          {
            pid: 303,
            processGroupId: 303,
            command: "node another-project/server.mjs",
            workingDirectory: "/tmp/another-project",
          },
        ],
        processGroupExists: () => true,
        signalProcessGroup: (processGroupId, signal) => {
          signals.push({ processGroupId, signal });
        },
      },
    });

    assert.deepEqual(signals, []);
    assert.deepEqual(result.stoppedServices, []);
    assert.match(result.warnings[0], /stale process group 303/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stopDevelopmentApplications never kills a terminal process group shared with a service", async () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-dev-stop-mixed-"));
  try {
    const signals = [];
    const result = await stopDevelopmentApplications(root, {
      processInspector: {
        currentProcessGroupId: () => 999,
        listListeningProcessIds: (port) => (port === 4000 ? [5_001] : []),
        readProcess: (pid) => ({
          pid,
          processGroupId: 505,
          command: `${root}/node_modules/tsx src/index.ts`,
          workingDirectory: resolve(root, "apps/api"),
        }),
        readProcessGroupMembers: (processGroupId) => [
          {
            pid: 505,
            processGroupId,
            command: "-zsh",
            workingDirectory: root,
          },
          {
            pid: 5_001,
            processGroupId,
            command: `${root}/node_modules/tsx src/index.ts`,
            workingDirectory: resolve(root, "apps/api"),
          },
        ],
        processGroupExists: () => true,
        signalProcessGroup: (processGroupId, signal) => {
          signals.push({ processGroupId, signal });
        },
      },
    });

    assert.deepEqual(signals, []);
    assert.deepEqual(result.stoppedServices, []);
    assert.match(result.warnings[0], /mixed process group 505/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
