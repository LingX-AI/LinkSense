/**
 * Drives one SSE conversation-event replay stream.
 *
 * Both the conversation and embed SSE routes carried an identical copy of this
 * loop. It lives here so the replay state machine can be exercised directly: a
 * response can become `destroyed` without ever emitting `close`, which a real
 * socket in a test harness does not reproduce.
 */

export type ReplayPumpEvent = {
  sequence_no: string | number | bigint
}

export type ReplayPumpPage<Event extends ReplayPumpEvent> = {
  items: readonly Event[]
  next_cursor: string | null
  confirmed_sequence: bigint
}

export type ReplayPumpOptions<Event extends ReplayPumpEvent> = {
  conversationId: string
  initialSequence: bigint
  pageSize: number
  gapRetryDelaysMs: readonly number[]
  loadPage: (input: {
    afterSequence: bigint
    limit: number
  }) => Promise<ReplayPumpPage<Event>>
  writeEvent: (event: Event) => Promise<boolean>
  isDestroyed: () => boolean
  /** Release the stream's resources. `destroy` forces the client to reconnect. */
  closeStream: (destroy: boolean) => void
  logWarn: (details: Record<string, unknown>, message: string) => void
  logMessages: { replayFailed: string; projectionBehind: string }
}

export type ReplayPump = {
  markReady(): void
  wake(): void
  observe(sequence: bigint): void
  close(destroy?: boolean): void
  isClosed(): boolean
}

function waitForReplayProjection(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds)
    timer.unref()
  })
}

export function createReplayPump<Event extends ReplayPumpEvent>(
  options: ReplayPumpOptions<Event>,
): ReplayPump {
  let lastWrittenSequence = options.initialSequence
  let observedSequence = options.initialSequence
  let confirmedSequence = options.initialSequence
  let replayGapRetryAttempt = 0
  let pumping = false
  let closed = false
  let streamReady = false

  const close = (destroy = false) => {
    if (closed) return
    closed = true
    options.closeStream(destroy)
  }

  const pump = async () => {
    if (pumping || closed) return
    pumping = true
    try {
      while (!closed) {
        const previousLastWrittenSequence = lastWrittenSequence
        const previousConfirmedSequence = confirmedSequence
        const page = await options.loadPage({
          afterSequence: lastWrittenSequence,
          limit: options.pageSize,
        })
        if (page.confirmed_sequence > confirmedSequence) {
          confirmedSequence = page.confirmed_sequence
        }
        for (const event of page.items) {
          const sequence = BigInt(event.sequence_no)
          if (sequence <= lastWrittenSequence) continue
          const written = await options.writeEvent(event)
          if (!written) {
            // A failed write means the client is gone (destroyed, or closed while
            // awaiting drain). Close the stream rather than just this pass, or the
            // re-arm below spins on a dead response.
            close()
            return
          }
          lastWrittenSequence = sequence
        }
        if (
          lastWrittenSequence > previousLastWrittenSequence ||
          confirmedSequence > previousConfirmedSequence
        ) {
          replayGapRetryAttempt = 0
        }
        if (page.next_cursor) continue
        if (lastWrittenSequence >= observedSequence) return
        // Let a model-switch branch projection settle before falling back to
        // cursor replay. Persisted but filtered gaps keep this stream open.
        const retryDelay = options.gapRetryDelaysMs[replayGapRetryAttempt]
        if (retryDelay !== undefined) {
          replayGapRetryAttempt += 1
          await waitForReplayProjection(retryDelay)
          continue
        }
        if (confirmedSequence < observedSequence) {
          options.logWarn(
            {
              conversationId: options.conversationId,
              lastWrittenSequence: lastWrittenSequence.toString(),
              observedSequence: observedSequence.toString(),
              confirmedSequence: confirmedSequence.toString(),
            },
            options.logMessages.projectionBehind,
          )
          close(true)
        }
        return
      }
    } catch (error) {
      options.logWarn(
        { err: error, conversationId: options.conversationId },
        options.logMessages.replayFailed,
      )
      close(true)
    } finally {
      pumping = false
      if (options.isDestroyed()) close()
      if (
        !closed &&
        observedSequence > lastWrittenSequence &&
        observedSequence > confirmedSequence
      ) {
        void pump()
      }
    }
  }

  return {
    markReady() {
      streamReady = true
    },
    wake() {
      void pump()
    },
    observe(sequence) {
      if (sequence > observedSequence) observedSequence = sequence
      if (streamReady) void pump()
    },
    close,
    isClosed: () => closed,
  }
}
