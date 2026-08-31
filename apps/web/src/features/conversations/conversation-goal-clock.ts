import { useSyncExternalStore } from "react"

let currentNowMs = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function readGoalClock() {
  return currentNowMs
}

function subscribeGoalClock(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    currentNowMs = Date.now()
    timer = setInterval(() => {
      currentNowMs = Date.now()
      for (const notify of listeners) notify()
    }, 1_000)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size > 0 || timer === null) return
    clearInterval(timer)
    timer = null
  }
}

const subscribePausedGoalClock = () => () => undefined

export function useGoalClockNow(active: boolean) {
  return useSyncExternalStore(
    active ? subscribeGoalClock : subscribePausedGoalClock,
    readGoalClock,
    readGoalClock
  )
}
