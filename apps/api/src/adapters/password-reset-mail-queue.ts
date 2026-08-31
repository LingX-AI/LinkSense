import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq"
import { z } from "zod"

import type { AppConfig } from "../config.js"
import { decryptJson, encryptJson } from "../lib/crypto.js"
import type { AuditWriter } from "../modules/auth/types.js"
import type { Mailer } from "./mailer.js"

const QUEUE_NAME = "linksense-password-reset-mail"
const JOB_NAME = "password-reset-mail"
const SMTP_DELIVERY_ATTEMPTS = 3
const TOTAL_JOB_ATTEMPTS = 5

const encryptedJobSchema = z.strictObject({
  encryptedEnvelope: z.string().min(1).max(1_000_000),
})

const deliveryEnvelopeSchema = z.strictObject({
  purpose: z.enum(["password_reset", "registration"]),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/u),
  to: z.string().email().max(320),
  subject: z.string().min(1).max(500),
  text: z.string().min(1).max(100_000),
  html: z.string().min(1).max(200_000),
})

type EncryptedPasswordResetMailJob = z.infer<typeof encryptedJobSchema>
type PasswordResetMailEnvelope = z.infer<typeof deliveryEnvelopeSchema>

type PasswordResetMailQueue = Queue<
  EncryptedPasswordResetMailJob,
  PasswordResetMailResult,
  typeof JOB_NAME
>

export type PasswordResetMailQueueControl = Pick<
  PasswordResetMailQueue,
  "add" | "close" | "waitUntilReady"
>

export type PasswordResetMailWorkerControl = Pick<
  Worker<
    EncryptedPasswordResetMailJob,
    PasswordResetMailResult,
    typeof JOB_NAME
  >,
  "close"
>

export type PasswordResetMailJob = Pick<
  Job<EncryptedPasswordResetMailJob, PasswordResetMailResult, typeof JOB_NAME>,
  "attemptsMade" | "data"
>

export type PasswordResetMailDelivery = PasswordResetMailEnvelope & {
  deliveryId: string
}

export type PasswordResetMailResult = {
  delivered: boolean
}

export interface PasswordResetMailFailurePersistence {
  invalidatePasswordResetToken(tokenHash: string, now: Date): Promise<void>
  invalidateRegistrationToken(tokenHash: string, now: Date): Promise<void>
}

type WorkerFactory = (
  processor: (
    job: Job<
      EncryptedPasswordResetMailJob,
      PasswordResetMailResult,
      typeof JOB_NAME
    >,
  ) => Promise<PasswordResetMailResult>,
) => PasswordResetMailWorkerControl

export class PasswordResetMailDeliveryQueue {
  private readonly queue: PasswordResetMailQueueControl
  private readonly createWorker: WorkerFactory
  private worker: PasswordResetMailWorkerControl | null = null

  constructor(
    config: Pick<
      AppConfig,
      "credentialKeyId" | "credentialMasterKey" | "redisUrl"
    >,
    private readonly mailer: Pick<Mailer, "sendRaw">,
    private readonly persistence: PasswordResetMailFailurePersistence,
    private readonly audit: AuditWriter,
    queueOverride?: PasswordResetMailQueueControl,
    workerFactory?: WorkerFactory,
  ) {
    const producerConnection = bullMqConnection(config.redisUrl, false)
    const workerConnection = bullMqConnection(config.redisUrl, true)
    this.queue =
      queueOverride ??
      new Queue<
        EncryptedPasswordResetMailJob,
        PasswordResetMailResult,
        typeof JOB_NAME
      >(QUEUE_NAME, {
        connection: producerConnection,
        defaultJobOptions: {
          attempts: TOTAL_JOB_ATTEMPTS,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 500,
          removeOnFail: 2_000,
        },
      })
    this.createWorker =
      workerFactory ??
      ((processor) =>
        new Worker<
          EncryptedPasswordResetMailJob,
          PasswordResetMailResult,
          typeof JOB_NAME
        >(QUEUE_NAME, processor, {
          connection: workerConnection,
          concurrency: 2,
        }))
    this.masterKey = config.credentialMasterKey
    this.keyId = config.credentialKeyId
  }

  private readonly masterKey: string
  private readonly keyId: string

  async start(): Promise<void> {
    if (this.worker) return
    await this.queue.waitUntilReady()
    this.worker = this.createWorker((job) => this.process(job))
  }

  async enqueue(input: PasswordResetMailDelivery): Promise<void> {
    const { deliveryId, ...rawEnvelope } = input
    const envelope = deliveryEnvelopeSchema.parse(rawEnvelope)
    const encryptedEnvelope = encryptJson(envelope, this.masterKey, this.keyId)
    await this.queue.add(
      JOB_NAME,
      { encryptedEnvelope },
      {
        jobId: `${envelope.purpose}-${z.string().uuid().parse(deliveryId)}`,
        attempts: TOTAL_JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 500,
        removeOnFail: 2_000,
      },
    )
  }

  async process(job: PasswordResetMailJob): Promise<PasswordResetMailResult> {
    const encryptedJob = encryptedJobSchema.parse(job.data)
    const envelope = deliveryEnvelopeSchema.parse(
      decryptJson<unknown>(encryptedJob.encryptedEnvelope, this.masterKey, this.keyId),
    )

    if (job.attemptsMade >= SMTP_DELIVERY_ATTEMPTS) {
      await this.recordDeliveryFailure(envelope.purpose, envelope.tokenHash)
      return { delivered: false }
    }

    try {
      await this.mailer.sendRaw({
        to: envelope.to,
        subject: envelope.subject,
        text: envelope.text,
        html: envelope.html,
      })
      return { delivered: true }
    } catch {
      if (job.attemptsMade + 1 >= SMTP_DELIVERY_ATTEMPTS) {
        await this.recordDeliveryFailure(envelope.purpose, envelope.tokenHash)
        return { delivered: false }
      }
      // Never persist an SMTP error as BullMQ's failedReason because providers may
      // include the recipient address or message content in that error.
      throw new Error("AUTHENTICATION_MAIL_DELIVERY_FAILED")
    }
  }

  async close(): Promise<void> {
    await this.worker?.close()
    this.worker = null
    await this.queue.close()
  }

  private async recordDeliveryFailure(
    purpose: PasswordResetMailEnvelope["purpose"],
    tokenHash: string,
  ): Promise<void> {
    const now = new Date()
    if (purpose === "registration") {
      await this.persistence.invalidateRegistrationToken(tokenHash, now)
    } else {
      await this.persistence.invalidatePasswordResetToken(tokenHash, now)
    }
    await this.audit.write({
      actorId: null,
      action:
        purpose === "registration"
          ? "self_registration_delivery_failed"
          : "password_setup_or_reset_delivery_failed",
      result: "failed",
      targetType: null,
      targetId: null,
      metadata: { capability: "smtp", error_code: "SMTP_SEND_FAILED" },
    })
  }
}

function bullMqConnection(input: string, worker: boolean): ConnectionOptions {
  const url = new URL(input)
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis or rediss")
  }
  const databaseText = url.pathname.replace(/^\//u, "")
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(databaseText ? { db: Number(databaseText) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: worker ? null : 1,
    ...(!worker ? { connectTimeout: 1_000, enableOfflineQueue: false } : {}),
  }
}
