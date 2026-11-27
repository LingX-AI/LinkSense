import { describe, expect, it } from "vitest";

import {
  desktopCloudToolInvocationSchema,
  desktopCloudToolLifetimeFor,
  desktopCloudToolResultSchema,
} from "./desktop-cloud-tools.js";
import {
  localShellDefaultTimeoutMs,
  localShellExecInputSchema,
} from "./desktop-shell-tools.js";

const root = "50000000-0000-4000-8000-000000000001";

describe("desktop shell tool inputs", () => {
  it("defaults the timeout and keeps cwd relative to the grant", () => {
    expect(localShellExecInputSchema.parse({ root_id: root, command: "ls" })).toEqual({
      root_id: root,
      command: "ls",
      timeout_ms: localShellDefaultTimeoutMs,
    });
    expect(localShellExecInputSchema.safeParse({
      root_id: root, cwd: "/etc", command: "ls",
    }).success).toBe(false);
    expect(localShellExecInputSchema.safeParse({
      root_id: root, command: "ls", timeout_ms: 200_000,
    }).success).toBe(false);
  });

  it("parses the shell invocation and rejects another operation's input", () => {
    expect(desktopCloudToolInvocationSchema.parse({
      operation: "local_shell.exec",
      input: { root_id: root, cwd: "src", command: "pnpm test" },
    })).toMatchObject({
      operation: "local_shell.exec",
      input: { cwd: "src", command: "pnpm test" },
    });
    expect(desktopCloudToolInvocationSchema.safeParse({
      operation: "local_shell.exec",
      input: { root_id: root, path: "src", command: "ls" },
    }).success).toBe(false);
  });

  it("carries the bounded result and its lifetime", () => {
    expect(desktopCloudToolResultSchema.safeParse({
      type: "cloud_tool.result",
      id: "50000000-0000-4000-8000-000000000002",
      operation: "local_shell.exec",
      ok: true,
      data: {
        cwd: "src", exit_code: 0, timed_out: false,
        stdout: "ok\n", stdout_truncated: false,
        stderr: "", stderr_truncated: false,
        duration_ms: 12,
      },
    }).success).toBe(true);
    expect(desktopCloudToolLifetimeFor("local_shell.exec")).toBeGreaterThan(
      desktopCloudToolLifetimeFor("local_files.read")
    );
  });
});
