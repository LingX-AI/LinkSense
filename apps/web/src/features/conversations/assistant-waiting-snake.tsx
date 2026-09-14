import { useDrag } from "@use-gesture/react"
import { motion, useReducedMotion } from "framer-motion"
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useTranslation } from "react-i18next"

import {
  createSnakeGame,
  measureSnakeBoard,
  snakeCellSize as cellSize,
  snakeDirectionForDrag,
  snakeDirectionForKey,
  snakeReducer,
  snakeRestartMs,
  snakeTickMs,
  type SnakeBoard,
} from "@/features/conversations/waiting-snake-engine"

export function AssistantWaitingSnake({
  onExit,
}: Readonly<{ onExit: () => void }>) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [board, setBoard] = useState<SnakeBoard | null>(null)

  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const measure = () => {
      const { width, height } = surface.getBoundingClientRect()
      const next = measureSnakeBoard(width, height)
      setBoard((current) =>
        current?.columns === next?.columns && current?.rows === next?.rows
          ? current
          : next
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={surfaceRef}
      className="absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      {board && <SnakePlayfield board={board} onExit={onExit} />}
    </div>
  )
}

function SnakePlayfield({
  board,
  onExit,
}: Readonly<{ board: SnakeBoard; onExit: () => void }>) {
  const { t } = useTranslation()
  const [game, dispatch] = useReducer(snakeReducer, board, createSnakeGame)
  const boardRef = useRef<HTMLDivElement>(null)
  const suspended = useRef(false)
  const reducedMotion = useReducedMotion()

  useLayoutEffect(() => {
    dispatch({ type: "resize", board })
    if (suspended.current) dispatch({ type: "pause" })
  }, [board])

  useEffect(() => {
    boardRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (game.phase === "running") {
      const timer = window.setInterval(
        () => dispatch({ type: "tick", random: Math.random() }),
        snakeTickMs
      )
      return () => window.clearInterval(timer)
    }
    if (game.phase === "over" || game.phase === "won") {
      const timer = window.setTimeout(() => {
        dispatch({ type: "restart" })
        if (suspended.current) dispatch({ type: "pause" })
      }, snakeRestartMs)
      return () => window.clearTimeout(timer)
    }
  }, [game.phase])

  useEffect(() => {
    const pause = () => {
      suspended.current = true
      dispatch({ type: "pause" })
    }
    const resume = () => {
      if (!document.hidden && document.activeElement === boardRef.current) {
        suspended.current = false
        dispatch({ type: "resume" })
      }
    }
    const visibility = () => {
      if (document.hidden) pause()
      else resume()
    }
    window.addEventListener("blur", pause)
    window.addEventListener("focus", resume)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      window.removeEventListener("blur", pause)
      window.removeEventListener("focus", resume)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [])

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
    } else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onExit()
    }
  }

  return (
    <div
      {...bindDrag()}
      ref={boardRef}
      role="application"
      tabIndex={0}
      aria-label={t("conversation.waitingGame.title")}
      aria-description={t("conversation.waitingGame.controls")}
      onKeyDown={onKeyDown}
      onFocus={() => {
        if (!document.hidden) {
          suspended.current = false
          dispatch({ type: "resume" })
        }
      }}
      onBlur={() => {
        suspended.current = true
        dispatch({ type: "pause" })
      }}
      className="absolute inset-0 touch-none overflow-hidden rounded-[inherit] outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
    >
      <svg
        viewBox={`0 0 ${board.columns * cellSize} ${board.rows * cellSize}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full text-[var(--app-selection)]"
        aria-hidden="true"
      >
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
    </div>
  )
}
