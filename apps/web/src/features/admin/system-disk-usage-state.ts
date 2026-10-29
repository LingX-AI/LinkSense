import type { DiskUsage } from "@linksense/shared"

export function hasCompleteDiskUsage(usage: DiskUsage | undefined): boolean {
  return usage?.status === "available" && usage.total_bytes !== null
}
