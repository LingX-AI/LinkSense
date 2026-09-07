/**
 * Waits before reconnecting an SSE stream without retaining an abort listener
 * after the timer has completed.
 */
export function waitForSseReconnectDelay(
  milliseconds: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const finish = () => {
      window.clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timer = window.setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
  })
}
