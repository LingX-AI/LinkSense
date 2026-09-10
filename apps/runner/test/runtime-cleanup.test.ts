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
  it("removes the task HOME, workspace and control directories", async () => {
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
      removeConversationRuntimeDirectories({ home, workspace, taskControl }),
    ).resolves.toEqual({ workspace: "deleted", control: "deleted" })
    await expect(lstat(home)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(workspace)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(lstat(taskControl)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("treats already absent task resources as successfully cleaned", async () => {
    const root = await tempRoot()

    await expect(
      removeConversationRuntimeDirectories({
        home: path.join(root, "task-home"),
        workspace: path.join(root, "home", "workspaces", "missing"),
        taskControl: path.join(root, "control", "workspaces", "missing"),
      }),
    ).resolves.toEqual({ workspace: "absent", control: "absent" })
  })

  it("returns a stable stage and reason without exposing the path", async () => {
    const error = Object.assign(new Error("private path"), { code: "EACCES" })
    const remove = vi.fn(async () => {
      throw error
    })

    await expect(
      removeConversationRuntimeDirectories(
        { home: "/private/task-home", workspace: "/private/workspace", taskControl: "/private/control" },
        {
          inspect: vi.fn(async () => ({}) as never),
          makeRemovable: vi.fn(async () => undefined),
          remove,
        },
      ),
    ).rejects.toMatchObject({
      stage: "delete_workspace",
      reasonCode: "CLEANUP_PERMISSION_DENIED",
      message: "CLEANUP_PERMISSION_DENIED",
    })
  })
})
