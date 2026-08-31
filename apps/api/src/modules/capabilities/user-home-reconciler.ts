import { AppError } from "../../lib/errors.js"

export interface UserHomeCapabilityTargets {
  userIds?: readonly string[]
  capabilityIds?: readonly string[]
}

export type MaterializeUserHomes = (
  targets: UserHomeCapabilityTargets,
) => Promise<void>

interface UserHomeCapabilityReconcilerOptions {
  loadCapabilityOwnerIds(capabilityIds: readonly string[]): Promise<string[]>
  resolveActiveUserIds(userIds: readonly string[]): Promise<string[]>
  reconcileUser(userId: string): Promise<void>
  attempts?: number
  concurrency?: number
}

export class UserHomeCapabilityReconciler {
  readonly #options: Required<
    Pick<UserHomeCapabilityReconcilerOptions, "attempts" | "concurrency">
  > &
    Omit<UserHomeCapabilityReconcilerOptions, "attempts" | "concurrency">

  constructor(options: UserHomeCapabilityReconcilerOptions) {
    this.#options = {
      ...options,
      attempts: options.attempts ?? 3,
      concurrency: options.concurrency ?? 8,
    }
  }

  async reconcile(targets: UserHomeCapabilityTargets): Promise<void> {
    const capabilityIds = unique(targets.capabilityIds ?? [])
    const ownerIds =
      capabilityIds.length === 0
        ? []
        : await this.#options.loadCapabilityOwnerIds(capabilityIds)
    const userIds = unique(
      await this.#options.resolveActiveUserIds(
        unique([...(targets.userIds ?? []), ...ownerIds]),
      ),
    )
    if (userIds.length === 0) return

    const failedUserIds: string[] = []
    let cursor = 0
    const worker = async () => {
      while (cursor < userIds.length) {
        const index = cursor
        cursor += 1
        const userId = userIds[index]
        if (userId === undefined) continue
        if (!(await this.#reconcileWithRetry(userId))) {
          failedUserIds.push(userId)
        }
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(this.#options.concurrency, userIds.length) },
        worker,
      ),
    )
    if (failedUserIds.length > 0) {
      throw new AppError("CAPABILITY_HOME_SYNC_FAILED", {
        failed_user_count: failedUserIds.length,
      })
    }
  }

  async #reconcileWithRetry(userId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.#options.attempts; attempt += 1) {
      try {
        await this.#options.reconcileUser(userId)
        return true
      } catch {
        // Each retry rebuilds the user's capability home from current ownership.
      }
    }
    return false
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}
