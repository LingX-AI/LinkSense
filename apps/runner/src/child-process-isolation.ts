export type ProcessIdentity = {
  uid: number
  gid: number
}

export type IsolatedChildInvocation = {
  command: string
  args: string[]
}

export const SETPRIV_COMMAND = "/usr/bin/setpriv"

/**
 * Runs a task-side child through setpriv instead of Node's uid/gid spawn
 * options. The worker supervisor deliberately retains ambient capabilities,
 * including SETPCAP so setpriv can clear the task's capability bounding set;
 * an ordinary Node spawn would pass those capabilities through exec.
 */
export function isolatedChildInvocation(
  command: string,
  args: readonly string[],
  identity?: ProcessIdentity,
): IsolatedChildInvocation {
  if (identity === undefined) {
    return { command, args: [...args] }
  }
  assertIdentity(identity)
  return {
    command: SETPRIV_COMMAND,
    args: [
      `--reuid=${identity.uid}`,
      `--regid=${identity.gid}`,
      "--keep-groups",
      "--bounding-set=-all",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--",
      command,
      ...args,
    ],
  }
}

function assertIdentity(identity: ProcessIdentity): void {
  if (
    !Number.isSafeInteger(identity.uid) ||
    identity.uid < 1 ||
    !Number.isSafeInteger(identity.gid) ||
    identity.gid < 1
  ) {
    throw new Error("child process identity is invalid")
  }
}
