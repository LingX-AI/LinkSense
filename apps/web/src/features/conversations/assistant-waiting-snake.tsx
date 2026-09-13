import { useDrag } from "@use-gesture/react"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowLeftIcon, PauseIcon, PlayIcon, RotateCcwIcon } from "lucide-react"
import { useEffect, useId, useReducer, useRef, type KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  createSnakeGame,
  snakeColumns,
  snakeDirectionForDrag,
  snakeDirectionForKey,
  snakeReducer,
  snakeRows,
  snakeTickMs,
} from "@/features/conversations/waiting-snake-engine"

const cellSize = 16

export function AssistantWaitingSnake({
  onExit,
}: Readonly<{ onExit: () => void }>) {
  const { t, i18n } = useTranslation()
  const [game, dispatch] = useReducer(snakeReducer, undefined, createSnakeGame)
  const boardRef = useRef<HTMLDivElement>(null)
  const instructionsId = useId()
  const reducedMotion = useReducedMotion()
  const running = game.phase === "running"
  const finished = game.phase === "over" || game.phase === "won"
  const score = new Intl.NumberFormat(i18n.resolvedLanguage).format(game.score)

  useEffect(() => {
    boardRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(
      () => dispatch({ type: "tick", random: Math.random() }),
      snakeTickMs
    )
    return () => window.clearInterval(timer)
  }, [running])

  useEffect(() => {
    const pause = () => dispatch({ type: "pause" })
    const onVisibilityChange = () => {
      if (document.hidden) pause()
    }
    window.addEventListener("blur", pause)
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      window.removeEventListener("blur", pause)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [])

  const play = () => {
    dispatch({ type: finished ? "restart" : "start" })
    boardRef.current?.focus({ preventScroll: true })
  }
  const bindDrag = useDrag(
    ({ last, movement: [x, y] }) => {
      if (!last) return
      const direction = snakeDirectionForDrag(x, y)
      if (direction) {
        boardRef.current?.focus({ preventScroll: true })
        dispatch({ type: "turn", direction })
      }
    },
    { filterTaps: true, pointer: { keys: false, touch: true } }
  )

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const direction = snakeDirectionForKey(event.key)
    if (direction) {
      event.preventDefault()
      event.stopPropagation()
      dispatch({ type: "turn", direction })
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (running) dispatch({ type: "pause" })
      else play()
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onExit()
    }
  }

  return (
    <div
      className="absolute inset-0 flex min-h-0 flex-col gap-2 p-3 text-muted-foreground sm:p-4"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          dispatch({ type: "pause" })
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">
          {t("conversation.waitingGame.title")}
        </span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums" aria-live="polite">
            {t("conversation.waitingGame.score", { score })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t(
              running
                ? "conversation.waitingGame.pause"
                : "conversation.waitingGame.resume"
            )}
            disabled={game.phase === "ready" || finished}
            onClick={() => {
              if (running) dispatch({ type: "pause" })
              else play()
            }}
          >
            {running ? (
              <PauseIcon aria-hidden="true" />
            ) : (
              <PlayIcon aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <div
        {...bindDrag()}
        ref={boardRef}
        role="application"
        tabIndex={0}
        aria-label={t("conversation.waitingGame.title")}
        aria-describedby={instructionsId}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 touch-none rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <svg
          viewBox={`0 0 ${snakeColumns * cellSize} ${snakeRows * cellSize}`}
          className="absolute inset-0 size-full overflow-visible text-[var(--app-selection)]"
          aria-hidden="true"
        >
          <rect
            x="0"
            y="0"
            width={snakeColumns * cellSize}
            height={snakeRows * cellSize}
            rx="8"
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.16"
          />
          {game.food && (
            <g
              transform={`translate(${(game.food.x + 0.5) * cellSize} ${(game.food.y + 0.5) * cellSize})`}
            >
              <circle r="10" fill="currentColor" opacity="0.1" />
              <circle r="4" fill="currentColor" />
              <circle cx="-1" cy="-1" r="1.2" className="fill-background" />
            </g>
          )}
          {game.snake.map((segment) => (
            <motion.g
              key={segment.id}
              initial={false}
              animate={{ x: segment.x * cellSize, y: segment.y * cellSize }}
              transition={{
                duration: reducedMotion ? 0 : snakeTickMs / 1000,
                ease: "linear",
              }}
            >
              <rect
                x="0.5"
                y="0.5"
                width="15"
                height="15"
                rx={segment.id === 0 ? 5 : 4}
                fill="currentColor"
                opacity={
                  segment.id === 0
                    ? 1
                    : 0.65 + 0.3 * (1 - segment.id / game.snake.length)
                }
              />
              {segment.id === 0 && (
                <g
                  transform={`rotate(${{ right: 0, down: 90, left: 180, up: 270 }[game.direction]} 8 8)`}
                  className="fill-background"
                >
                  <circle cx="10.5" cy="4.5" r="1.4" />
                  <circle cx="10.5" cy="11.5" r="1.4" />
                </g>
              )}
            </motion.g>
          ))}
        </svg>
        {!running && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto flex max-w-full flex-col items-center gap-2 rounded-xl bg-background/90 px-4 py-3 text-center backdrop-blur-sm">
              <span
                className="text-sm font-medium text-foreground"
                role="status"
              >
                {t(`conversation.waitingGame.${game.phase}`)}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={play}>
                {finished ? (
                  <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <PlayIcon data-icon="inline-start" aria-hidden="true" />
                )}
                {t(
                  finished
                    ? "conversation.waitingGame.restart"
                    : game.phase === "paused"
                      ? "conversation.waitingGame.resume"
                      : "conversation.waitingGame.start"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
        <span id={instructionsId}>
          {t("conversation.waitingGame.controls")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onExit}
          className="ml-auto"
        >
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          {t("conversation.waitingGame.back")}
        </Button>
      </div>
    </div>
  )
}
