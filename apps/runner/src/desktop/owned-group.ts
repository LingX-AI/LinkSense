export const launcherOwnerEnv = "LINKSENSE_DESKTOP_OWNER_PID"

export type OwnedGroupInput = {
  platform: NodeJS.Platform
  frameAccepted: boolean
  pipeLost: boolean
  launcherOwnerPid: number | undefined
  currentPpid: number
  groupId: number
  groupExists: boolean
}

/**
 * The Go launcher supplies its exact PID in a private child-only env marker and
 * starts this process with Setpgid. A canonical positive marker, the kernel
 * group probe, the closed private pipe, and reparenting to launchd are the only
 * boundary. No renderer/API value or hex-token shape participates.
 */
export function parseLauncherOwnerPid(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9][0-9]{0,9}$/u.test(value)) return undefined
  const pid = Number(value)
  return Number.isSafeInteger(pid) && pid > 1 && pid <= 0x7fffffff ? pid : undefined
}

export function shouldReclaimOwnedGroup(input: OwnedGroupInput): boolean {
  return input.platform === "darwin" &&
    input.frameAccepted &&
    input.pipeLost &&
    input.groupExists &&
    input.launcherOwnerPid !== undefined &&
    input.launcherOwnerPid > 1 &&
    input.groupId > 1 &&
    input.launcherOwnerPid !== input.groupId &&
    input.currentPpid === 1
}
