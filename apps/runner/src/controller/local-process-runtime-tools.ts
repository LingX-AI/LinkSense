import { randomUUID } from "node:crypto"
import { lstatSync } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export async function prepareLocalProcessRuntimeTools(input: {
  root: string
  launcherCommand: string
  launcherArgs: readonly string[]
  connectionLauncherArgs: readonly string[]
}): Promise<string> {
  if (!input.launcherCommand.trim()) {
    throw new Error("local STDIO launcher command is required")
  }
  const root = path.resolve(input.root)
  const bin = path.join(root, "bin")
  await mkdir(bin, { recursive: true, mode: 0o700 })
  const binInfo = await lstat(bin)
  if (!binInfo.isDirectory() || binInfo.isSymbolicLink()) {
    throw new Error("local runtime tool directory must be a real directory")
  }
  await chmod(bin, 0o700)

  for (const [name, args] of [
    ["linksense-plugin-stdio", input.launcherArgs],
    ["linksense-connection-mcp", input.connectionLauncherArgs],
  ] as const) {
  const launcher = path.join(bin, name)
  const temporaryLauncher = path.join(
    bin,
    `.${name}-${randomUUID()}.tmp`,
  )
  const invocation = [input.launcherCommand, ...args]
    .map(quoteShellArgument)
    .join(" ")
  try {
    await writeFile(
      temporaryLauncher,
      `#!/bin/sh\nset -eu\nexec ${invocation} "$@"\n`,
      { encoding: "utf8", flag: "wx", mode: 0o700 },
    )
    await rename(temporaryLauncher, launcher)
    await chmod(launcher, 0o700)
  } catch (error) {
    await rm(temporaryLauncher, { force: true }).catch(() => undefined)
    throw error
  }
  }
  return bin
}

export function resolvePersonalStdioLauncher(moduleUrl: string): string {
  return resolveRuntimeLauncher(moduleUrl, "personal-stdio-launcher")
}

export function resolveConnectionLauncher(moduleUrl: string): string {
  return resolveRuntimeLauncher(moduleUrl, "connection-service-server")
}

function resolveRuntimeLauncher(moduleUrl: string, name: string): string {
  const directory = path.dirname(fileURLToPath(moduleUrl))
  const built = path.resolve(
    directory,
    `../mcp/${name}.js`,
  )
  if (isRealFile(built)) return built
  const source = path.resolve(
    directory,
    `../mcp/${name}.ts`,
  )
  if (isRealFile(source)) return source
  throw new Error("LinkSense personal STDIO launcher was not found")
}

function isRealFile(candidate: string): boolean {
  try {
    const info = lstatSync(candidate)
    return info.isFile() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

function quoteShellArgument(value: string): string {
  if (value.includes("\0")) {
    throw new Error("local STDIO launcher argument contains a NUL byte")
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`
}
