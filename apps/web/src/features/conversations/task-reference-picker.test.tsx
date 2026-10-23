import { useRef, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import {
  TaskReferencePicker,
  type TaskReference,
} from "./task-reference-picker"
import { taskReferenceMessages } from "./task-reference-messages"
import { supportedLocales } from "@linksense/shared"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const id = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`
function Host() {
  const anchor = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<TaskReference[]>([])
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  )
  return (
    <QueryClientProvider client={client}>
      <div ref={anchor} />
      <TaskReferencePicker
        anchor={anchor}
        open
        onOpenChange={() => undefined}
        selected={selected}
        onChange={setSelected}
        currentConversationId={id(0)}
        disabled={false}
      />
    </QueryClientProvider>
  )
}
describe("task reference selection", () => {
  it("excludes the current task, limits selection to three and allows deselection", async () => {
    await i18n.changeLanguage("en-US")
    vi.mocked(apiRequest).mockResolvedValue({
      items: Array.from({ length: 5 }, (_, n) => ({
        id: id(n),
        title: `Task ${n}`,
      })),
      next_cursor: null,
    })
    render(<Host />)
    expect(await screen.findByText("Task 1")).toBeInTheDocument()
    expect(screen.queryByText("Task 0")).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Show archived tasks" })
    )
    await waitFor(() =>
      expect(apiRequest).toHaveBeenLastCalledWith(
        "/conversations",
        expect.objectContaining({
          query: expect.objectContaining({ archived: true }),
        })
      )
    )
    for (const name of ["Task 1", "Task 2", "Task 3"])
      fireEvent.click(await screen.findByRole("checkbox", { name }))
    expect(screen.getByRole("checkbox", { name: "Task 4" })).toHaveAttribute(
      "aria-disabled",
      "true"
    )
    fireEvent.click(screen.getByRole("checkbox", { name: "Task 4" }))
    expect(screen.getByText("3 / 3 tasks selected")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: "Task 2" }))
    expect(
      screen.getByRole("checkbox", { name: "Task 4" })
    ).not.toHaveAttribute("aria-disabled", "true")
    fireEvent.change(screen.getByRole("textbox", { name: "Search tasks" }), {
      target: { value: "Research" },
    })
    await waitFor(() =>
      expect(apiRequest).toHaveBeenLastCalledWith(
        "/conversations",
        expect.objectContaining({
          query: expect.objectContaining({ search: "Research" }),
        })
      )
    )
  })
  it.each(supportedLocales)(
    "provides consistent keys, interpolation and fallback in %s",
    (locale) => {
      const messages = taskReferenceMessages
      expect(Object.keys(messages[locale]).sort()).toEqual(
        Object.keys(messages["zh-CN"]).sort()
      )
      for (const key of Object.keys(messages["zh-CN"])) {
        const fullKey = `taskReferences.${key}`
        expect(i18n.t(fullKey, { lng: locale })).not.toBe(fullKey)
        expect(
          (i18n.t(fullKey, { lng: locale }).match(/\{\{.*?\}\}/gu) ?? []).sort()
        ).toEqual(
          (
            i18n.t(fullKey, { lng: "zh-CN" }).match(/\{\{.*?\}\}/gu) ?? []
          ).sort()
        )
        const fallback = i18n.cloneInstance({ forkResourceStore: true })
        fallback.removeResourceBundle(locale, "translation")
        if (locale !== "zh-CN")
          expect(fallback.t(fullKey, { lng: locale })).toBe(
            i18n.t(fullKey, { lng: "zh-CN" })
          )
      }
    }
  )
})
