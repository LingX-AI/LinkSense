import { expect, it, vi } from "vitest";

const startup = vi.hoisted(() => ({
  mode: "worker",
  provider: "docker",
  verifyVersion: vi.fn(),
  executionLoaded: vi.fn(),
}));

vi.mock("../src/config.js", async (original) => ({
  ...await original<object>(),
  parseRunnerConfig: () => ({
    LINKSENSE_RUNNER_MODE: startup.mode,
    LINKSENSE_WORKER_PROVIDER: startup.provider,
    CODEX_BIN: "/managed/codex",
  }),
}));
vi.mock("../src/codex/runtime-version.js", () => ({
  assertCodexRuntimeVersion: startup.verifyVersion,
}));
vi.mock("../src/server.js", () => {
  startup.executionLoaded();
  return { buildRunnerServer: vi.fn() };
});

it.each([
  ["worker", "docker"],
  ["worker", "local-process"],
  ["standalone", "docker"],
])("refuses %s/%s startup before execution modules load when Codex verification fails", async (mode, provider) => {
  startup.mode = mode;
  startup.provider = provider;
  startup.verifyVersion.mockClear();
  const failure = new Error("Codex version mismatch");
  startup.verifyVersion.mockRejectedValue(failure);
  const { main } = await import("../src/index.js");

  await expect(main({})).rejects.toBe(failure);

  expect(startup.verifyVersion).toHaveBeenCalledExactlyOnceWith({
    command: "/managed/codex",
    ...(mode === "worker" && provider === "docker" ? { processIdentity: { uid: 1001, gid: 1000 } } : {}),
  });
  expect(startup.executionLoaded).not.toHaveBeenCalled();
});
