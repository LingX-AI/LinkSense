import { execFile } from "node:child_process"
import { promisify } from "node:util"

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js"

const execFileAsync = promisify(execFile)

export type BrowserSessionCleanupInput = {
  command: string
  userHome: string
  codexHome: string
  workspace: string
  processIdentity?: ProcessIdentity
  sourceEnvironment?: NodeJS.ProcessEnv
}

export async function cleanupManagedBrowserSession(
  input: BrowserSessionCleanupInput,
): Promise<void> {
  const source = input.sourceEnvironment ?? process.env
  const invocation = isolatedChildInvocation(
    input.command,
    ["__cleanup"],
    input.processIdentity,
  )
  await execFileAsync(invocation.command, invocation.args, {
    cwd: input.workspace,
    timeout: 15_000,
    killSignal: "SIGKILL",
    env: {
      HOME: input.userHome,
      CODEX_HOME: input.codexHome,
      ...copyEnvironment(source, [
        "LANG",
        "LC_ALL",
        "PATH",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
      ]),
    },
  })
}

function copyEnvironment(
  source: NodeJS.ProcessEnv,
  keys: string[],
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]!]],
    ),
  )
}
