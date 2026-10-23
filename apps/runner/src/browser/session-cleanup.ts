import { execFile } from "node:child_process"
import { promisify } from "node:util"

import {
  isolatedChildInvocation,
  type ProcessIdentity,
} from "../child-process-isolation.js"

const execFileAsync = promisify(execFile)

export type BrowserSessionCleanupInput = {
  command: string
  conversationId: string
  userHome: string
  codexHome: string
  workspace: string
  preserveHumanControl?: boolean
  processIdentity?: ProcessIdentity
  sourceEnvironment?: NodeJS.ProcessEnv
}

export async function cleanupManagedBrowserSession(
  input: BrowserSessionCleanupInput,
): Promise<boolean> {
  const source = input.sourceEnvironment ?? process.env
  const invocation = isolatedChildInvocation(
    input.command,
    ["__cleanup"],
    input.processIdentity,
  )
  const result = await execFileAsync(invocation.command, invocation.args, {
    cwd: input.workspace,
    timeout: 15_000,
    killSignal: "SIGKILL",
    env: {
      HOME: input.userHome,
      CODEX_HOME: input.codexHome,
      LINKSENSE_CONVERSATION_ID: input.conversationId,
      LINKSENSE_WORKSPACE_PATH: input.workspace,
      ...(input.preserveHumanControl ? { LINKSENSE_BROWSER_PRESERVE_CONTROL: "1" } : {}),
      ...copyEnvironment(source, [
        "LANG",
        "LC_ALL",
        "PATH",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
      ]),
    },
  })
  return !result.stdout.includes("LINKSENSE_BROWSER_CLEANUP_DEFERRED")
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
