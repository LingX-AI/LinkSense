import { describe, expect, it, vi } from "vitest";

import runtimeVersion from "../src/codex/runtime-version.json" with { type: "json" };
import { CODEX_SCHEMA_VERSION } from "../src/codex/protocol.js";
import {
  assertCodexRuntimeVersion,
  type CodexVersionCommand,
} from "../src/codex/runtime-version.js";

describe("the repository-pinned Codex runtime", () => {
  it("checks the configured executable against the adapter version, ignoring environment version overrides", async () => {
    vi.stubEnv("CODEX_VERSION", "999.0.0");
    const run = vi.fn<CodexVersionCommand>().mockResolvedValue({
      stdout: `codex-cli ${runtimeVersion.version}\n`,
    });

    await expect(assertCodexRuntimeVersion({ command: "/managed/codex" }, run)).resolves.toBeUndefined();

    expect(CODEX_SCHEMA_VERSION).toBe(runtimeVersion.version);
    expect(run).toHaveBeenCalledExactlyOnceWith("/managed/codex", ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 4096,
    });
    vi.unstubAllEnvs();
  });

  it.each(["0.150.1", "999.0.0"])("rejects Codex %s before it can serve tasks", async (version) => {
    const run = vi.fn<CodexVersionCommand>().mockResolvedValue({ stdout: `codex-cli ${version}\n` });

    await expect(assertCodexRuntimeVersion({ command: "codex" }, run)).rejects.toThrow(
      `Codex version mismatch: expected ${CODEX_SCHEMA_VERSION}, received ${version}`,
    );
  });

  it.each(["", "untrusted-output", "codex-cli latest", "codex-cli 0.154.0-alpha.1", "codex-cli 0.154.0\nextra-output"])(
    "rejects malformed version output without exposing it: %j",
    async (stdout) => {
      const run = vi.fn<CodexVersionCommand>().mockResolvedValue({ stdout });

      await expect(assertCodexRuntimeVersion({ command: "codex" }, run)).rejects.toThrow(
        "Codex returned an invalid version response",
      );
    },
  );

  it.each(["ENOENT", "EACCES", "ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"])(
    "fails closed when the version command fails with %s",
    async (code) => {
      const run = vi.fn<CodexVersionCommand>().mockRejectedValue(
        Object.assign(new Error("untrusted stderr and command path"), { code }),
      );

      await expect(assertCodexRuntimeVersion({ command: "codex" }, run)).rejects.toThrow(
        `Unable to verify Codex ${CODEX_SCHEMA_VERSION}; check the worker image and CODEX_BIN`,
      );
      expect(run).toHaveBeenCalledOnce();
    },
  );

  it("drops supervisor identity and capabilities before executing a worker version command", async () => {
    const run = vi.fn<CodexVersionCommand>().mockResolvedValue({
      stdout: `codex-cli ${runtimeVersion.version}\n`,
    });

    await assertCodexRuntimeVersion({
      command: "/managed/codex",
      processIdentity: { uid: 1001, gid: 1000 },
    }, run);

    expect(run).toHaveBeenCalledExactlyOnceWith("/usr/bin/setpriv", [
      "--reuid=1001", "--regid=1000", "--keep-groups", "--bounding-set=-all",
      "--inh-caps=-all", "--ambient-caps=-all", "--", "/managed/codex", "--version",
    ], { encoding: "utf8", timeout: 10_000, maxBuffer: 4096 });
  });
});
