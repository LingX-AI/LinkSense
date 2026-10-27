import type { ComponentProps } from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { AssistantMarkdown } from "./conversation-thread"
import { ReasoningActivity } from "./reasoning-activity"

const readers = vi.hoisted(() => ({ markdown: vi.fn(), reasoning: vi.fn() }))

vi.mock("react-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-markdown")>()
  return {
    ...actual,
    default: (props: ComponentProps<typeof actual.default>) => {
      readers.markdown(props.children)
      return <actual.default {...props} />
    },
  }
})
vi.mock("mdast-util-from-markdown", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("mdast-util-from-markdown")>()
  return {
    ...actual,
    fromMarkdown: (...args: Parameters<typeof actual.fromMarkdown>) => {
      readers.reasoning(args[0])
      return actual.fromMarkdown(...args)
    },
  }
})

describe("streaming rendering work", () => {
  it("does not parse completed Markdown blocks again as the last paragraph grows", () => {
    const prefix = Array.from(
      { length: 40 },
      (_, index) => `Completed paragraph ${index}.\n\n`
    ).join("")
    const { rerender } = render(
      <AssistantMarkdown content={`${prefix}Working`} streaming />
    )
    readers.markdown.mockClear()
    for (let index = 1; index <= 10; index++) {
      rerender(
        <AssistantMarkdown
          content={`${prefix}Working ${"more ".repeat(index)}`}
          streaming
        />
      )
    }
    expect(screen.getByText("Completed paragraph 0.")).toBeVisible()
    expect(
      readers.markdown.mock.calls.filter(([content]) =>
        String(content).startsWith("Completed paragraph")
      )
    ).toHaveLength(0)
    expect(screen.getByText(/Working more/)).toBeVisible()
  })

  it("does not reparse unchanged reasoning when another activity updates", () => {
    const content =
      "**Finished reasoning**\n\n" + "Detailed reasoning. ".repeat(500)
    const { rerender } = render(
      <ReasoningActivity content={content} turnRunning={false} />
    )
    readers.reasoning.mockClear()
    for (let index = 0; index < 10; index++) {
      rerender(<ReasoningActivity content={content} turnRunning={false} />)
    }
    expect(readers.reasoning).not.toHaveBeenCalled()
    expect(screen.getByText("Finished reasoning")).toBeVisible()
  })
})
