import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import {
  initializeUserRuntime,
} from "../apps/runner/src/user-runtime.ts"
import { developmentRuntimePaths } from "./dev.mjs"

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(import.meta.dirname, "..")
const publicRuntime = developmentRuntimePaths(repositoryRoot)
const root = await mkdtemp(path.join(tmpdir(), "linksense-standalone-smoke-"))
const userRoot = path.join(root, "user-a")
const workspaceRoot = path.join(root, "workspaces")

try {
  const runtime = await initializeUserRuntime(userRoot, {
    basePythonSitePackages: publicRuntime.pythonSitePackages,
    baseNodeProject: publicRuntime.nodeProject,
    nodeRegisterHook: publicRuntime.nodeRegisterHook,
    runtimeToolBin: publicRuntime.toolBin,
    pnpmVersion: "10.34.6",
  })
  const result = await execFileAsync(
    process.execPath,
    [path.join(repositoryRoot, "scripts/runtime-command-smoke.mjs")],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...runtime.environment,
        LINKSENSE_SMOKE_WORKSPACE_ROOT: workspaceRoot,
        LINKSENSE_SMOKE_USER_ROOT: userRoot,
        LINKSENSE_SMOKE_EXPECT_UID: String(process.getuid?.() ?? ""),
        LINKSENSE_SMOKE_EXPECT_GID: String(process.getgid?.() ?? ""),
        LINKSENSE_SMOKE_OFFICE: "0",
        LINKSENSE_SMOKE_PRODUCTION: "0",
      },
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300_000,
    },
  )
  process.stdout.write(result.stdout)
  console.log("LinkSense standalone Codex runtime smoke succeeded.")
} finally {
  await rm(root, { recursive: true, force: true })
}
