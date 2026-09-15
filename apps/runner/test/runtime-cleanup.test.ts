import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  removeConversationRuntimeDirectories,
} from "../src/runtime-cleanup.js"
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "linksense-cleanup-"))
  roots.push(root)
  return root
}

describe("runtime cleanup directories", () => {
  it("removes task control state and preserves shared HOME and project files", async () => {
    const root = await tempRoot()
    const home = path.join(root, "task-home")
    await mkdir(home)
    await writeFile(path.join(home, "private-state"), "state", { mode: 0o600 })
    const workspace = path.join(root, "home", "workspaces", "task")
    const taskControl = path.join(root, "control", "workspaces", "task")
    await Promise.all([
      mkdir(workspace, { recursive: true }),
      mkdir(taskControl, { recursive: true }),
    ])
    await writeFile(path.join(workspace, "attachment.txt"), "content")

    await expect(
      removeConversationRuntimeDirectories({ taskControl }),
    ).resolves.toEqual({ workspace: "preserved", control: "deleted" })
    expect((await lstat(home)).isDirectory()).toBe(true)
    expect((await lstat(workspace)).isDirectory()).toBe(true)
    await expect(lstat(taskControl)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("treats already absent task resources as successfully cleaned", async () => {
    const root = await tempRoot()

    await expect(
      removeConversationRuntimeDirectories({
        taskControl: path.join(root, "control", "workspaces", "missing"),
      }),
    ).resolves.toEqual({ workspace: "preserved", control: "absent" })
  })

  it("returns a stable stage and reason without exposing the path", async () => {
    const error = Object.assign(new Error("private path"), { code: "EACCES" })
    const remove = vi.fn(async () => {
      throw error
    })

    await expect(
      removeConversationRuntimeDirectories(
        { taskControl: "/private/control" },
        {
          inspect: vi.fn(async () => ({}) as never),
          makeRemovable: vi.fn(async () => undefined),
          remove,
        },
      ),
    ).rejects.toMatchObject({
      stage: "delete_control",
      reasonCode: "CLEANUP_PERMISSION_DENIED",
      message: "CLEANUP_PERMISSION_DENIED",
    })
  })
})
