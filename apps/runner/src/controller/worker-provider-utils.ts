import { createHash } from "node:crypto"
import path from "node:path"

export function safeChildPath(parent: string, child: string): string {
  const candidate = path.resolve(parent, child)
  if (candidate === parent || !candidate.startsWith(`${parent}${path.sep}`)) {
    throw new Error("user data path escapes its configured root")
  }
  return candidate
}

export function isNodeError(
  error: unknown,
  code: string
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code
}

export function workerName(storageKey: string, instanceKey: string): string {
  return `linksense-worker-${containerNameKey(instanceKey, storageKey)}`
}

export function probeWorkerName(
  storageKey: string,
  instanceKey: string
): string {
  return `linksense-worker-probe-${containerNameKey(instanceKey, storageKey)}`
}

function containerNameKey(instanceKey: string, storageKey: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "linksense-runner-container-name",
        instanceKey,
        storageKey,
      ])
    )
    .digest("hex")
    .slice(0, 32)
}
