import { describe, expect, it, vi } from "vitest"

import {
  PasswordResetMailDeliveryQueue,
  type PasswordResetMailQueueControl,
} from "../src/adapters/password-reset-mail-queue.js"
import { testConfig } from "./test-config.js"

const DELIVERY = {
  purpose: "password_reset" as const,
  deliveryId: "00000000-0000-4000-8000-000000000001",
  tokenHash: "a".repeat(64),
  to: "person@example.com",
  subject: "Set or reset your LinkSense password",
  text: "Open https://linksense.example/reset-password#token=plaintext-secret",
  html: '<a href="https://linksense.example/reset-password#token=plaintext-secret">Reset</a>',
}

const REGISTRATION_DELIVERY = {
  ...DELIVERY,
  purpose: "registration" as const,
  deliveryId: "00000000-0000-4000-8000-000000000002",
  tokenHash: "b".repeat(64),
  subject: "Activate your LinkSense account",
  text: "Open https://linksense.example/register/activate#token=activation-secret",
  html: '<a href="https://linksense.example/register/activate#token=activation-secret">Activate</a>',
}

describe("PasswordResetMailDeliveryQueue", () => {
  it("reliably enqueues only an AES-GCM encrypted envelope and never waits for SMTP", async () => {
    const fixture = queueFixture()

    await fixture.deliveryQueue.enqueue(DELIVERY)

    expect(fixture.mailer.sendRaw).not.toHaveBeenCalled()
    expect(fixture.queue.add).toHaveBeenCalledOnce()
    const [name, data, options] = fixture.queue.add.mock.calls[0] ?? []
    expect(name).toBe("password-reset-mail")
    expect(data).toEqual({ encryptedEnvelope: expect.stringMatching(/^v1\./u) })
    expect(options).toMatchObject({
      jobId: `password_reset-${DELIVERY.deliveryId}`,
      attempts: 5,
      removeOnComplete: 500,
      removeOnFail: 2_000,
    })
    const persistedJob = JSON.stringify({ name, data, options })
    for (const sensitive of [
      DELIVERY.to,
      DELIVERY.tokenHash,
      DELIVERY.subject,
      DELIVERY.text,
      DELIVERY.html,
      "plaintext-secret",
    ]) {
      expect(persistedJob).not.toContain(sensitive)
    }
  })

  it("decrypts the envelope only inside the worker and sends the localized raw mail", async () => {
    const fixture = queueFixture()
    const data = await encryptedJobData(fixture)

    await expect(
      fixture.deliveryQueue.process({ data, attemptsMade: 0 }),
    ).resolves.toEqual({ delivered: true })
    expect(fixture.mailer.sendRaw).toHaveBeenCalledWith({
      to: DELIVERY.to,
      subject: DELIVERY.subject,
      text: DELIVERY.text,
      html: DELIVERY.html,
    })
    expect(fixture.persistence.invalidatePasswordResetToken).not.toHaveBeenCalled()
  })

  it("uses bounded sanitized retries, then invalidates by hash and writes an anonymous audit", async () => {
    const fixture = queueFixture()
    const data = await encryptedJobData(fixture)
    fixture.mailer.sendRaw.mockRejectedValue(new Error(`550 ${DELIVERY.to}`))

    const firstFailure = await fixture.deliveryQueue
      .process({ data, attemptsMade: 0 })
      .catch((error: unknown) => error)
    expect(firstFailure).toMatchObject({
      message: "AUTHENTICATION_MAIL_DELIVERY_FAILED",
    })
    expect(JSON.stringify(firstFailure)).not.toContain(DELIVERY.to)
    expect(fixture.persistence.invalidatePasswordResetToken).not.toHaveBeenCalled()

    await expect(
      fixture.deliveryQueue.process({ data, attemptsMade: 2 }),
    ).resolves.toEqual({ delivered: false })
    expect(fixture.mailer.sendRaw).toHaveBeenCalledTimes(2)
    expect(fixture.persistence.invalidatePasswordResetToken).toHaveBeenCalledWith(
      DELIVERY.tokenHash,
      expect.any(Date),
    )
    expect(fixture.audit.write).toHaveBeenCalledWith({
      actorId: null,
      action: "password_setup_or_reset_delivery_failed",
      result: "failed",
      targetType: null,
      targetId: null,
      metadata: { capability: "smtp", error_code: "SMTP_SEND_FAILED" },
    })
    const serializedAudit = JSON.stringify(fixture.audit.write.mock.calls)
    expect(serializedAudit).not.toContain(DELIVERY.to)
    expect(serializedAudit).not.toContain(DELIVERY.tokenHash)
    expect(serializedAudit).not.toContain("plaintext-secret")
  })

  it("invalidates a failed registration token without touching password reset tokens", async () => {
    const fixture = queueFixture()
    await fixture.deliveryQueue.enqueue(REGISTRATION_DELIVERY)
    const data = fixture.queue.add.mock.calls[0]?.[1]
    if (!data) throw new Error("encrypted registration job was not enqueued")
    fixture.mailer.sendRaw.mockRejectedValue(new Error("SMTP rejected recipient"))

    await expect(
      fixture.deliveryQueue.process({ data, attemptsMade: 2 }),
    ).resolves.toEqual({ delivered: false })
    expect(fixture.persistence.invalidateRegistrationToken).toHaveBeenCalledWith(
      REGISTRATION_DELIVERY.tokenHash,
      expect.any(Date),
    )
    expect(fixture.persistence.invalidatePasswordResetToken).not.toHaveBeenCalled()
    expect(fixture.audit.write).toHaveBeenCalledWith({
      actorId: null,
      action: "self_registration_delivery_failed",
      result: "failed",
      targetType: null,
      targetId: null,
      metadata: { capability: "smtp", error_code: "SMTP_SEND_FAILED" },
    })
  })

  it("starts one worker and closes both worker and queue", async () => {
    const queue = queueControl()
    const worker = { close: vi.fn(async () => undefined) }
    const workerFactory = vi.fn(() => worker)
    const deliveryQueue = new PasswordResetMailDeliveryQueue(
      testConfig(),
      { sendRaw: vi.fn(async () => undefined) },
      {
        invalidatePasswordResetToken: vi.fn(async () => undefined),
        invalidateRegistrationToken: vi.fn(async () => undefined),
      },
      { write: vi.fn(async () => undefined) },
      queue,
      workerFactory,
    )

    await deliveryQueue.start()
    await deliveryQueue.start()
    await deliveryQueue.close()

    expect(queue.waitUntilReady).toHaveBeenCalledOnce()
    expect(workerFactory).toHaveBeenCalledOnce()
    expect(worker.close).toHaveBeenCalledOnce()
    expect(queue.close).toHaveBeenCalledOnce()
  })

  it("does not start a worker until the producer connection is ready", async () => {
    const queue = queueControl()
    const startupError = new Error("redis unavailable")
    queue.waitUntilReady.mockRejectedValueOnce(startupError)
    const workerFactory = vi.fn()
    const deliveryQueue = new PasswordResetMailDeliveryQueue(
      testConfig(),
      { sendRaw: vi.fn(async () => undefined) },
      {
        invalidatePasswordResetToken: vi.fn(async () => undefined),
        invalidateRegistrationToken: vi.fn(async () => undefined),
      },
      { write: vi.fn(async () => undefined) },
      queue,
      workerFactory,
    )

    await expect(deliveryQueue.start()).rejects.toBe(startupError)
    expect(workerFactory).not.toHaveBeenCalled()
  })
})

function queueFixture() {
  const queue = queueControl()
  const mailer = { sendRaw: vi.fn(async () => undefined) }
  const persistence = {
    invalidatePasswordResetToken: vi.fn(async () => undefined),
    invalidateRegistrationToken: vi.fn(async () => undefined),
  }
  const audit = { write: vi.fn(async () => undefined) }
  const deliveryQueue = new PasswordResetMailDeliveryQueue(
    testConfig(),
    mailer,
    persistence,
    audit,
    queue,
  )
  return { deliveryQueue, queue, mailer, persistence, audit }
}

async function encryptedJobData(fixture: ReturnType<typeof queueFixture>) {
  await fixture.deliveryQueue.enqueue(DELIVERY)
  const data = fixture.queue.add.mock.calls[0]?.[1]
  if (!data) throw new Error("encrypted test job was not enqueued")
  return data
}

function queueControl() {
  return {
    add: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    waitUntilReady: vi.fn(async () => undefined),
  } as unknown as PasswordResetMailQueueControl & {
    add: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    waitUntilReady: ReturnType<typeof vi.fn>
  }
}
