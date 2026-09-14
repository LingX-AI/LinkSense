// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  createSnakeGame,
  placeSnakeFood,
  measureSnakeBoard,
  snakeDirectionForDrag,
  snakeDirectionForKey,
  snakeReducer,
  type SnakePoint,
  type SnakeState,
} from "@/features/conversations/waiting-snake-engine"

const snakeColumns = 24
const snakeRows = 16
const board = { columns: snakeColumns, rows: snakeRows }

const tick = (game: SnakeState) =>
  snakeReducer(game, { type: "tick", random: 0 })
const runningGame = (): SnakeState => createSnakeGame(board)
const segments = (points: readonly SnakePoint[]) =>
  points.map((point, id) => ({ ...point, id }))

describe("waiting snake rules", () => {
  it.each([
    [960, 320, 60, 20],
    [320, 320, 20, 20],
    [320, 640, 20, 40],
  ])("uses the full %s by %s surface", (width, height, columns, rows) => {
    const measured = measureSnakeBoard(width, height)
    expect(measured).toEqual({ columns, rows })
    if (!measured) throw new Error("Expected a measurable board")
    const game = createSnakeGame(measured)
    expect(game.board).toEqual(measured)
    expect(
      tick({ ...game, snake: [{ id: 0, x: columns - 2, y: 2 }] }).phase
    ).toBe("running")
    expect(
      tick({ ...game, snake: [{ id: 0, x: columns - 1, y: 2 }] }).phase
    ).toBe("over")
    expect(placeSnakeFood([], 1, measured)).toEqual({
      x: columns - 1,
      y: rows - 1,
    })
    expect(snakeReducer(game, { type: "restart" }).board).toEqual(measured)
  })

  it("does not initialize hidden or invalid surfaces", () => {
    expect(measureSnakeBoard(0, 320)).toBeNull()
    expect(measureSnakeBoard(320, 0)).toBeNull()
    expect(measureSnakeBoard(NaN, 320)).toBeNull()
    expect(measureSnakeBoard(-1, 320)).toBeNull()
    expect(measureSnakeBoard(1, 1)).toEqual({ columns: 8, rows: 6 })
  })

  it("preserves suspension when resizing and keeps an unchanged board intact", () => {
    const game = runningGame()
    expect(snakeReducer(game, { type: "resize", board })).toBe(game)
    const paused = snakeReducer(game, { type: "pause" })
    const resized = snakeReducer(paused, {
      type: "resize",
      board: { columns: 60, rows: 20 },
    })
    expect(resized.phase).toBe("paused")
    expect(resized.board).toEqual({ columns: 60, rows: 20 })
    expect(resized.snake[0]).toEqual({ id: 0, x: 20, y: 10 })
  })

  it("starts immediately, moves one cell, and preserves segment identities", () => {
    const ready = createSnakeGame(board)
    expect(ready.phase).toBe("running")
    const moved = tick(snakeReducer(ready, { type: "turn", direction: "up" }))
    expect(moved.snake[0]).toEqual({ id: 0, x: 8, y: 7 })
    expect(moved.snake[1]).toEqual({ id: 1, x: 8, y: 8 })
    expect(moved.snake).toHaveLength(4)
    expect(moved.direction).toBe("up")
    expect(ready.snake[0]).toEqual({ id: 0, x: 8, y: 8 })
  })

  it("rejects reversal and a second turn before the next tick", () => {
    const game = runningGame()
    expect(snakeReducer(game, { type: "turn", direction: "left" })).toBe(game)
    const turned = snakeReducer(game, { type: "turn", direction: "up" })
    expect(snakeReducer(turned, { type: "turn", direction: "left" })).toBe(
      turned
    )
    const moved = tick(turned)
    expect(
      snakeReducer(moved, { type: "turn", direction: "left" }).nextDirection
    ).toBe("left")
  })

  it("grows when eating, with new food outside the body", () => {
    const game = { ...runningGame(), food: { x: 9, y: 8 } }
    const moved = tick(game)
    expect(moved.snake).toHaveLength(5)
    expect(moved.snake.at(-1)).toEqual({ id: 4, x: 5, y: 8 })
    expect(moved.food).toEqual({ x: 0, y: 0 })
    expect(
      moved.snake.some(
        (point) => point.x === moved.food?.x && point.y === moved.food.y
      )
    ).toBe(false)
  })

  it.each([
    ["right", { x: snakeColumns - 1, y: 8 }],
    ["left", { x: 0, y: 8 }],
    ["up", { x: 8, y: 0 }],
    ["down", { x: 8, y: snakeRows - 1 }],
  ] as const)("ends the game at the %s wall", (direction, head) => {
    const game: SnakeState = {
      ...runningGame(),
      direction,
      nextDirection: direction,
      snake: [{ ...head, id: 0 }],
    }
    expect(tick(game).phase).toBe("over")
    expect(tick(tick(game))).toEqual(tick(game))
  })

  it("ends the game on a body collision but permits entering a vacating tail cell", () => {
    const body = segments([
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 2 },
      { x: 3, y: 1 },
    ])
    const game = { ...runningGame(), snake: body }
    expect(tick(game).phase).toBe("over")
    const withVacatingTail = tick({ ...game, snake: body.slice(0, -1) })
    expect(withVacatingTail.phase).toBe("running")
    expect(withVacatingTail.snake[0]).toEqual({ id: 0, x: 3, y: 2 })
  })

  it("pauses without moving, resumes, and restarts on the current board", () => {
    const game = runningGame()
    const paused = snakeReducer(game, { type: "pause" })
    expect(paused.phase).toBe("paused")
    expect(tick(paused)).toBe(paused)
    expect(snakeReducer(paused, { type: "turn", direction: "up" })).toBe(paused)
    expect(snakeReducer(paused, { type: "resume" })).toEqual(game)
    expect(
      snakeReducer({ ...game, phase: "over" }, { type: "restart" })
    ).toEqual(runningGame())
  })

  it("wins after eating the last available cell without trying forever to place food", () => {
    const points: SnakePoint[] = []
    for (let y = 0; y < snakeRows; y += 1) {
      for (let x = 0; x < snakeColumns; x += 1) points.push({ x, y })
    }
    const food = { x: 1, y: 0 }
    const game = {
      ...runningGame(),
      snake: segments(
        points.filter((point) => point.x !== food.x || point.y !== food.y)
      ),
      food,
    }
    const won = tick(game)
    expect(won.phase).toBe("won")
    expect(won.snake).toHaveLength(snakeColumns * snakeRows)
    expect(won.food).toBeNull()
  })

  it("places food safely for empty and full boards and boundary random values", () => {
    expect(placeSnakeFood([], 0, board)).toEqual({ x: 0, y: 0 })
    expect(placeSnakeFood([], 1, board)).toEqual({ x: 23, y: 15 })
    expect(placeSnakeFood([], Number.NaN, board)).toEqual({ x: 0, y: 0 })
    const fullBoard = Array.from(
      { length: snakeColumns * snakeRows },
      (_, index) => ({
        x: index % snakeColumns,
        y: Math.floor(index / snakeColumns),
      })
    )
    expect(placeSnakeFood(fullBoard, 0.5, board)).toBeNull()
    expect(placeSnakeFood(fullBoard.slice(0, -1), 0.5, board)).toEqual({
      x: 23,
      y: 15,
    })
  })

  it("supports direction keys and swipe directions without treating taps as turns", () => {
    expect(snakeDirectionForKey("ArrowUp")).toBe("up")
    expect(snakeDirectionForKey("W")).toBe("up")
    expect(snakeDirectionForKey("d")).toBe("right")
    expect(snakeDirectionForKey("s")).toBe("down")
    expect(snakeDirectionForKey("a")).toBe("left")
    expect(snakeDirectionForKey("Tab")).toBeNull()
    expect(snakeDirectionForDrag(2, -3)).toBeNull()
    expect(snakeDirectionForDrag(30, 5)).toBe("right")
    expect(snakeDirectionForDrag(-30, 5)).toBe("left")
    expect(snakeDirectionForDrag(5, -30)).toBe("up")
    expect(snakeDirectionForDrag(5, 30)).toBe("down")
  })
})
