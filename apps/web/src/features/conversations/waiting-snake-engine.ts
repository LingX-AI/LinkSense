export const snakeCellSize = 16
export const snakeTickMs = 160
export const snakeRestartMs = 650

export type SnakeBoard = Readonly<{ columns: number; rows: number }>

export function measureSnakeBoard(
  width: number,
  height: number
): SnakeBoard | null {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return null
  return {
    columns: Math.max(8, Math.floor(width / snakeCellSize)),
    rows: Math.max(6, Math.floor(height / snakeCellSize)),
  }
}

export type SnakeDirection = "up" | "right" | "down" | "left"
export type SnakePoint = Readonly<{ x: number; y: number }>
export type SnakeSegment = SnakePoint & Readonly<{ id: number }>
export type SnakeState = Readonly<{
  phase: "running" | "paused" | "over" | "won"
  board: SnakeBoard
  snake: readonly SnakeSegment[]
  direction: SnakeDirection
  nextDirection: SnakeDirection
  food: SnakePoint | null
}>
export type SnakeAction =
  | Readonly<{ type: "resize"; board: SnakeBoard }>
  | Readonly<{ type: "turn"; direction: SnakeDirection }>
  | Readonly<{ type: "tick"; random: number }>
  | Readonly<{ type: "resume" | "pause" | "restart" }>

const vectors: Record<SnakeDirection, SnakePoint> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
}

export function createSnakeGame(board: SnakeBoard): SnakeState {
  const x = Math.max(3, Math.floor(board.columns / 3))
  const y = Math.floor(board.rows / 2)
  return {
    phase: "running",
    board,
    snake: [
      { id: 0, x, y },
      { id: 1, x: x - 1, y },
      { id: 2, x: x - 2, y },
      { id: 3, x: x - 3, y },
    ],
    direction: "right",
    nextDirection: "right",
    food: { x: Math.floor(board.columns * 0.75), y },
  }
}

function samePoint(a: SnakePoint, b: SnakePoint): boolean {
  return a.x === b.x && a.y === b.y
}

export function placeSnakeFood(
  snake: readonly SnakePoint[],
  random: number,
  { columns, rows }: SnakeBoard
): SnakePoint | null {
  const occupied = new Set(snake.map(({ x, y }) => y * columns + x))
  const available: SnakePoint[] = []
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (!occupied.has(y * columns + x)) available.push({ x, y })
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
    case "resize":
      if (
        state.board.columns === action.board.columns &&
        state.board.rows === action.board.rows
      )
        return state
      return {
        ...createSnakeGame(action.board),
        phase: state.phase === "paused" ? "paused" : "running",
      }
    case "restart":
      return createSnakeGame(state.board)
    case "resume":
      return state.phase === "paused" ? { ...state, phase: "running" } : state
    case "pause":
      return state.phase === "running" ? { ...state, phase: "paused" } : state
    case "turn": {
      if (state.phase !== "running") return state
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
        nextHead.x >= state.board.columns ||
        nextHead.y < 0 ||
        nextHead.y >= state.board.rows ||
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
      const food = eating
        ? placeSnakeFood(snake, action.random, state.board)
        : state.food
      return {
        ...state,
        snake,
        direction: state.nextDirection,
        food,
        phase: food === null ? "won" : "running",
      }
    }
  }
}
