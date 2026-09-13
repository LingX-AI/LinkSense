export const snakeColumns = 24
export const snakeRows = 16
export const snakeTickMs = 160

export type SnakeDirection = "up" | "right" | "down" | "left"
export type SnakePoint = Readonly<{ x: number; y: number }>
export type SnakeSegment = SnakePoint & Readonly<{ id: number }>
export type SnakeState = Readonly<{
  phase: "ready" | "running" | "paused" | "over" | "won"
  snake: readonly SnakeSegment[]
  direction: SnakeDirection
  nextDirection: SnakeDirection
  food: SnakePoint | null
  score: number
}>
export type SnakeAction =
  | Readonly<{ type: "turn"; direction: SnakeDirection }>
  | Readonly<{ type: "tick"; random: number }>
  | Readonly<{ type: "start" | "pause" | "restart" }>

const vectors: Record<SnakeDirection, SnakePoint> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

export function createSnakeGame(): SnakeState {
  return {
    phase: "ready",
    snake: [
      { id: 0, x: 7, y: 8 },
      { id: 1, x: 6, y: 8 },
      { id: 2, x: 5, y: 8 },
      { id: 3, x: 4, y: 8 },
    ],
    direction: "right",
    nextDirection: "right",
    food: { x: 17, y: 8 },
    score: 0,
  }
}

function samePoint(a: SnakePoint, b: SnakePoint): boolean {
  return a.x === b.x && a.y === b.y
}

export function placeSnakeFood(
  snake: readonly SnakePoint[],
  random: number
): SnakePoint | null {
  const occupied = new Set(snake.map(({ x, y }) => y * snakeColumns + x))
  const available: SnakePoint[] = []
  for (let y = 0; y < snakeRows; y += 1) {
    for (let x = 0; x < snakeColumns; x += 1) {
      if (!occupied.has(y * snakeColumns + x)) available.push({ x, y })
    }
  }
  const fraction = Number.isFinite(random)
    ? Math.max(0, Math.min(1, random))
    : 0
  return (
    available[
      Math.min(available.length - 1, Math.floor(fraction * available.length))
    ] ?? null
  )
}

export function snakeDirectionForKey(key: string): SnakeDirection | null {
  switch (key.toLowerCase()) {
    case "arrowup":
    case "w":
      return "up"
    case "arrowright":
    case "d":
      return "right"
    case "arrowdown":
    case "s":
      return "down"
    case "arrowleft":
    case "a":
      return "left"
    default:
      return null
  }
}

export function snakeDirectionForDrag(
  x: number,
  y: number
): SnakeDirection | null {
  if (Math.max(Math.abs(x), Math.abs(y)) < 12) return null
  return Math.abs(x) > Math.abs(y)
    ? x > 0
      ? "right"
      : "left"
    : y > 0
      ? "down"
      : "up"
}

export function snakeReducer(
  state: SnakeState,
  action: SnakeAction
): SnakeState {
  switch (action.type) {
    case "restart":
      return { ...createSnakeGame(), phase: "running" }
    case "start":
      return state.phase === "ready" || state.phase === "paused"
        ? { ...state, phase: "running" }
        : state
    case "pause":
      return state.phase === "running" ? { ...state, phase: "paused" } : state
    case "turn": {
      if (state.phase !== "ready" && state.phase !== "running") return state
      const current = vectors[state.direction]
      const next = vectors[action.direction]
      // Accept one turn per tick so rapid inputs cannot reverse into the body.
      if (
        state.nextDirection !== state.direction ||
        (current.x + next.x === 0 && current.y + next.y === 0)
      )
        return state
      return { ...state, phase: "running", nextDirection: action.direction }
    }
    case "tick": {
      const head = state.snake[0]
      if (state.phase !== "running" || !head) return state
      const vector = vectors[state.nextDirection]
      const nextHead = { x: head.x + vector.x, y: head.y + vector.y }
      const eating = state.food !== null && samePoint(nextHead, state.food)
      // The tail vacates its cell on moves that do not consume food.
      const occupied = eating ? state.snake : state.snake.slice(0, -1)
      if (
        nextHead.x < 0 ||
        nextHead.x >= snakeColumns ||
        nextHead.y < 0 ||
        nextHead.y >= snakeRows ||
        occupied.some((point) => samePoint(point, nextHead))
      ) {
        return { ...state, phase: "over" }
      }
      const snake = state.snake.map((segment, index) => ({
        ...(index === 0 ? nextHead : (state.snake[index - 1] ?? segment)),
        id: segment.id,
      }))
      const tail = state.snake.at(-1)
      if (eating && tail) snake.push({ ...tail, id: state.snake.length })
      const food = eating ? placeSnakeFood(snake, action.random) : state.food
      return {
        ...state,
        snake,
        direction: state.nextDirection,
        food,
        score: state.score + Number(eating),
        phase: food === null ? "won" : "running",
      }
    }
  }
}
