import { createHash, createHmac } from "node:crypto"

export const WORKER_RUNTIME_LAYOUT =
  "single-writer-managed-agents-readonly-task-owned-home-codex-owner-volume-subpaths"

export function ownerStorageKey(ownerId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`linksense-worker:${ownerId}`)
    .digest("hex")
    .slice(0, 32)
}

export function ownerWorkerSecret(ownerId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`linksense-worker-auth:${ownerId}`)
    .digest("base64url")
}

export type ControllerStorageDomain = {
  LINKSENSE_WORKER_CONTROL_NETWORK: string
  LINKSENSE_USER_DATA_ROOT: string
  LINKSENSE_USER_DATA_VOLUME?: string | undefined
}

export type WorkerContractDomain = {
  LINKSENSE_PYTHON_PACKAGE_INDEX_URL: string
  LINKSENSE_NODE_PACKAGE_REGISTRY_URL: string
  LINKSENSE_WORKER_IMAGE_REVISION: string
  LINKSENSE_WORKER_PIDS_LIMIT: number
  LINKSENSE_WORKER_SHM_MB: number
  LINKSENSE_BROWSER_SESSION_LIMIT: number
  LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS: number
}

export function workerContractKey(domain: WorkerContractDomain): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "linksense-runner-worker-contract",
        WORKER_RUNTIME_LAYOUT,
        domain.LINKSENSE_PYTHON_PACKAGE_INDEX_URL,
        domain.LINKSENSE_NODE_PACKAGE_REGISTRY_URL,
        domain.LINKSENSE_WORKER_IMAGE_REVISION,
        domain.LINKSENSE_WORKER_PIDS_LIMIT,
        domain.LINKSENSE_WORKER_SHM_MB,
        domain.LINKSENSE_BROWSER_SESSION_LIMIT,
        domain.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
      ]),
    )
    .digest("hex")
    .slice(0, 32)
}

export function controllerInstanceKey(domain: ControllerStorageDomain): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "linksense-runner-storage-domain",
        domain.LINKSENSE_WORKER_CONTROL_NETWORK,
        domain.LINKSENSE_USER_DATA_VOLUME ? "volume" : "bind",
        domain.LINKSENSE_USER_DATA_VOLUME ?? domain.LINKSENSE_USER_DATA_ROOT,
      ]),
    )
    .digest("hex")
    .slice(0, 32)
}
