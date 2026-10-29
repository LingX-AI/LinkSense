import type { Job } from "bullmq"
import { describe, expect, it, vi } from "vitest"

import { BackgroundJobs, type MaintenanceJob, type MaintenanceQueueControl } from "../src/adapters/jobs.js"
import { testConfig } from "./test-config.js"

vi.mock("bullmq", () => ({
  Queue: class {},
  Worker: class {
    close = vi.fn(async () => undefined)
  },
}))

describe("system maintenance expiry jobs", () => {
  function setup() {
    const queue = {
      add: vi.fn(), close: vi.fn(), getJob: vi.fn(),
      getJobs: vi.fn<MaintenanceQueueControl["getJobs"]>(async () => []), upsertJobScheduler: vi.fn(),
    } satisfies MaintenanceQueueControl
    const jobs = new BackgroundJobs(
      testConfig(),
      {} as ConstructorParameters<typeof BackgroundJobs>[1],
      {} as ConstructorParameters<typeof BackgroundJobs>[2],
      {} as ConstructorParameters<typeof BackgroundJobs>[3],
      undefined, queue,
    )
    const auth = { cleanupInvalidTokens: vi.fn() }
    const system = { expireMaintenanceSettings: vi.fn(async () => undefined) }
    return { queue, jobs, auth, system }
  }

  it("schedules expiry without browser activity and invokes cleanup on each job", async () => {
    const { queue, jobs, auth, system } = setup()
    await jobs.start(auth, system)
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith("system-maintenance-expiry", { every: 5_000 }, {
      name: "system-maintenance-expiry", data: { type: "system-maintenance-expiry" },
      opts: { attempts: 3, backoff: { type: "exponential", delay: 1_000 } },
    })
    const job = { data: { type: "system-maintenance-expiry" } } as Job<MaintenanceJob>
    await jobs["process"](job, auth)
    await jobs["process"](job, auth)
    expect(system.expireMaintenanceSettings).toHaveBeenCalledTimes(2)
    await jobs.close()
  })

  it("schedules recommendation resolution independently of browser activity and dispatches the registered processor", async () => {
    const { queue, jobs, auth, system } = setup()
    const resolve = vi.fn(async () => undefined)
    jobs.registerFormRecommendationProcessor(resolve)
    await jobs.start(auth, system)
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith("form-recommendation-resolution", { every: 1_000 }, {
      name: "form-recommendation-resolution", data: { type: "form-recommendation-resolution" }, opts: { attempts: 3, backoff: { type: "exponential", delay: 1_000 } },
    })
    const job = { data: { type: "form-recommendation-resolution" } } as Job<MaintenanceJob>
    await jobs["process"](job, auth)
    expect(resolve).toHaveBeenCalledOnce()
    resolve.mockRejectedValueOnce(new Error("Database unavailable"))
    await expect(jobs["process"](job, auth)).rejects.toThrow("Database unavailable")
    await jobs.close()
  })

  it("uses one durable recommendation job per form with bounded retries", async () => {
    const { queue, jobs, auth } = setup()
    const input = { ownerId: "10000000-0000-4000-8000-000000000001", conversationId: "20000000-0000-4000-8000-000000000001", requestId: "30000000-0000-4000-8000-000000000001" }
    const deliver = vi.fn(async () => undefined)
    jobs.registerFormRecommendationDeliveryProcessor(deliver)
    await jobs.enqueueFormRecommendation(input)
    expect(queue.add).toHaveBeenCalledWith("form-recommendation-delivery", { type: "form-recommendation-delivery", ...input }, {
      jobId: `form-recommendation-${input.requestId}`, attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 500, removeOnFail: false,
    })
    await jobs["process"]({ data: { type: "form-recommendation-delivery", ...input } } as Job<MaintenanceJob>, auth)
    expect(deliver).toHaveBeenCalledExactlyOnceWith(input)
  })

  it("propagates database errors so BullMQ can retry cleanup", async () => {
    const { jobs, auth, system } = setup()
    await jobs.start(auth, system)
    system.expireMaintenanceSettings.mockRejectedValueOnce(new Error("Database unavailable"))
    const job = { data: { type: "system-maintenance-expiry" } } as Job<MaintenanceJob>
    await expect(jobs["process"](job, auth)).rejects.toThrow("Database unavailable")
    await expect(jobs["process"](job, auth)).resolves.toEqual({ expired: true })
    await jobs.close()
  })

  it("does not present expiry jobs as failed resource deletions", async () => {
    const { jobs, queue } = setup()
    queue.getJobs.mockResolvedValueOnce([
      { id: "expiry", data: { type: "system-maintenance-expiry" } } as Awaited<ReturnType<MaintenanceQueueControl["getJobs"]>>[number],
    ])
    expect(await jobs.listFailedCleanupJobs()).toEqual([])
  })
})
