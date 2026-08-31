import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureSharedWorkspaceDirectory,
  SharedWorkspaceDirectoryError,
} from "../src/lib/shared-workspace-directory.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("shared workspace directory", () => {
  it("creates every managed segment with the shared setgid mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-api-workspace-"));
    roots.push(root);
    const attachments = join(root, "attachments");
    const upload = join(attachments, "upload-id");

    await ensureSharedWorkspaceDirectory(root, upload);

    expect((await lstat(attachments)).mode & 0o7777).toBe(0o2770);
    expect((await lstat(upload)).mode & 0o7777).toBe(0o2770);
  });

  it("fails closed instead of following an existing directory symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "linksense-api-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "linksense-api-outside-"));
    roots.push(root, outside);
    await mkdir(join(root, "safe"));
    await symlink(outside, join(root, "safe", "linked"), "dir");

    await expect(
      ensureSharedWorkspaceDirectory(
        root,
        join(root, "safe", "linked", "nested"),
      ),
    ).rejects.toBeInstanceOf(SharedWorkspaceDirectoryError);
    await expect(lstat(join(outside, "nested"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
