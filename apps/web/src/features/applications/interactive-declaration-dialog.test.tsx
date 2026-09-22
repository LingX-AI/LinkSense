import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  interactiveDependenciesSchema,
  interactiveDependencyTypeSchema,
} from "@linksense/shared"
import i18n from "@/i18n"
import { apiRequest } from "@/api/client"
import { notify } from "@/components/feedback/notification"
import { InteractiveDeclarationDialog } from "./interactive-declaration-dialog"
import {
  buildResourceDeclaration,
  loadDeclarationResources,
  type DeclarationResource,
} from "./interactive-declaration"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
vi.mock("@/components/feedback/notification", () => ({
  notify: { success: vi.fn() },
}))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})
const uuid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const resources: DeclarationResource[] =
  interactiveDependencyTypeSchema.options.map((type, i) => ({
    type,
    id: uuid(i),
    name: `Resource ${type}`,
  }))
function mockResources(items = resources) {
  vi.mocked(apiRequest).mockImplementation(async (_path, options) => ({
    items: items
      .filter((item) => item.type === options?.query?.type)
      .map(({ id, name }) => ({ id, name })),
    next_cursor: null,
  }))
}
function show(onClose = vi.fn()) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <InteractiveDeclarationDialog onClose={onClose} />
    </QueryClientProvider>
  )
  return onClose
}
const copyButton = () =>
  screen.getByRole("button", { name: i18n.t("applications.declaration.copy") })
const previewCopyButton = () =>
  screen.getByRole("button", { name: i18n.t("common.copy") })
const allBox = (type: DeclarationResource["type"], filtered = false) =>
  screen.getByRole("checkbox", {
    name: i18n.t(
      filtered
        ? "applications.declaration.selectTypeResults"
        : "applications.declaration.selectType",
      { type: i18n.t(`applications.dependencies.types.${type}`) }
    ),
  })
function preview() {
  const input = screen.getByRole("textbox", {
    name: i18n.t("applications.declaration.preview"),
  })
  if (!(input instanceof HTMLTextAreaElement))
    throw new Error("Expected declaration textarea")
  return JSON.parse(input.value)
}

describe.each(["zh-CN", "en-US"])(
  "resource declaration list (%s)",
  (locale) => {
    it("explains the purpose and copies complete valid JSON with real IDs for all four categories", async () => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue()
      mockResources()
      show()
      const purpose =
        locale === "zh-CN"
          ? "创建交互式应用时，使用此清单在 manifest.json 中声明应用所需的插件、技能、MCP 服务和知识库。"
          : "When creating an interactive app, use this list to declare the plugins, skills, MCP servers, and knowledge bases it needs in manifest.json."
      expect(screen.getByText(purpose)).toBeVisible()
      expect(screen.getByRole("dialog")).toHaveAccessibleDescription(purpose)
      expect(copyButton()).toBeDisabled()
      await screen.findByRole("checkbox", { name: /Resource plugin/ })
      expect(
        screen
          .getByRole("dialog")
          .querySelector('[data-slot="declaration-resources"]')
          ?.firstElementChild
      ).toContainElement(
        screen.getByRole("textbox", {
          name: i18n.t("applications.declaration.search"),
        })
      )
      for (const resource of resources) {
        expect(
          screen.getByRole("checkbox", { name: resource.name })
        ).toBeVisible()
        expect(
          screen.queryByText(resource.id, { exact: true })
        ).not.toBeInTheDocument()
      }
      expect(
        screen.getByText(i18n.t("applications.declaration.mergeHint"))
      ).toBeVisible()
      for (const type of interactiveDependencyTypeSchema.options)
        await user.click(allBox(type))
      await user.click(copyButton())
      await waitFor(() => expect(write).toHaveBeenCalledOnce())
      const copied = JSON.parse(write.mock.calls[0]?.[0] ?? "{}")
      expect(copied).toEqual(preview())
      const dependencies = interactiveDependenciesSchema.parse(
        copied.dependencies
      )
      expect(dependencies.plugins).toEqual([
        { id: uuid(0), name: "Resource plugin" },
      ])
      expect(dependencies.skills).toEqual([
        { id: uuid(1), name: "Resource skill" },
      ])
      expect(dependencies.mcp_servers).toEqual([
        { id: uuid(2), name: "Resource mcp_server" },
      ])
      expect(dependencies.knowledge_bases).toEqual([
        { id: uuid(3), name: "Resource knowledge_base" },
      ])
      await waitFor(() =>
        expect(notify.success).toHaveBeenCalledWith(i18n.t("common.copied"))
      )
      expect(
        vi
          .mocked(apiRequest)
          .mock.calls.every(
            ([path, options]) =>
              path === "/applications/interactive-dependency-options" &&
              !options?.method
          )
      ).toBe(true)
      for (const type of interactiveDependencyTypeSchema.options)
        await user.click(allBox(type))
      expect(copyButton()).toBeDisabled()
      expect(preview().dependencies).toEqual({
        plugins: [],
        skills: [],
        mcp_servers: [],
        knowledge_bases: [],
      })
    })
    it("keeps selections outside the search and supports filtered select-all and deselection", async () => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      mockResources()
      show()
      await user.click(
        await screen.findByRole("checkbox", { name: /Resource plugin/ })
      )
      expect(allBox("plugin")).toBeChecked()
      expect(allBox("skill")).not.toBeChecked()
      const search = screen.getByRole("textbox", {
        name: i18n.t("applications.declaration.search"),
      })
      await user.type(search, "SKILL")
      const filtered = allBox("skill", true)
      await user.click(filtered)
      expect(preview().dependencies.plugins).toHaveLength(1)
      expect(preview().dependencies.skills).toHaveLength(1)
      await user.click(filtered)
      expect(preview().dependencies.skills).toEqual([])
      expect(preview().dependencies.plugins).toHaveLength(1)
      await user.clear(search)
      expect(
        screen.getByRole("checkbox", { name: /Resource plugin/ })
      ).toBeChecked()
    })
    it("copies from the JSON box with checkmark feedback only and disables both controls while copying", async () => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      let completeCopy = () => {}
      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              completeCopy = resolve
            })
        )
      mockResources()
      show()
      const resource = await screen.findByRole("checkbox", {
        name: /Resource skill/,
      })
      expect(previewCopyButton()).toBeDisabled()
      const input = screen.getByRole("textbox", {
        name: i18n.t("applications.declaration.preview"),
      })
      const box = input.closest('[data-slot="input-group"]')
      expect(box).toContainElement(previewCopyButton())
      expect(
        previewCopyButton().closest('[data-slot="input-group-addon"]')
      ).toHaveAttribute("data-align", "block-start")
      expect(
        previewCopyButton().closest('[data-slot="input-group-addon"]')
      ).toHaveClass("justify-end")
      expect(input).toHaveClass("font-mono", "text-xs", "md:text-xs")
      expect(input).toHaveAttribute("wrap", "off")
      await user.click(resource)
      await user.click(previewCopyButton())
      await waitFor(() => expect(write).toHaveBeenCalledOnce())
      expect(JSON.parse(write.mock.calls[0]?.[0] ?? "{}")).toEqual(preview())
      expect(preview().dependencies.skills).toEqual([
        { id: uuid(1), name: "Resource skill" },
      ])
      expect(previewCopyButton()).toBeDisabled()
      expect(previewCopyButton()).toHaveAttribute("aria-busy", "true")
      expect(copyButton()).toBeDisabled()
      completeCopy()
      await waitFor(() => expect(previewCopyButton()).toBeEnabled())
      expect(copyButton()).toBeEnabled()
      expect(notify.success).not.toHaveBeenCalled()
      expect(previewCopyButton()).toHaveAttribute(
        "title",
        i18n.t("common.copied")
      )
      expect(
        previewCopyButton().querySelector(".lucide-check")
      ).toBeInTheDocument()
      expect(
        previewCopyButton().querySelector(".lucide-copy")
      ).not.toBeInTheDocument()
      await user.click(resource)
      expect(previewCopyButton()).toHaveAttribute(
        "title",
        i18n.t("applications.declaration.copy")
      )
      expect(
        previewCopyButton().querySelector(".lucide-copy")
      ).toBeInTheDocument()
      expect(
        previewCopyButton().querySelector(".lucide-check")
      ).not.toBeInTheDocument()
    })
    it("offers manual copying after clipboard failure without reporting success", async () => {
      await i18n.changeLanguage(locale)
      const user = userEvent.setup()
      vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
        new Error("Clipboard denied")
      )
      mockResources()
      show()
      await user.click(
        await screen.findByRole("checkbox", { name: /Resource skill/ })
      )
      await user.click(previewCopyButton())
      expect(
        await screen.findByText(i18n.t("applications.declaration.copyFailed"))
      ).toBeVisible()
      expect(notify.success).not.toHaveBeenCalled()
      expect(
        previewCopyButton().querySelector(".lucide-check")
      ).not.toBeInTheDocument()
      expect(
        previewCopyButton().querySelector(".lucide-copy")
      ).toBeInTheDocument()
      expect(preview().dependencies.skills).toHaveLength(1)
    })
    it("shows an empty state and cannot copy until resources are selected", async () => {
      await i18n.changeLanguage(locale)
      mockResources([])
      show()
      expect(
        await screen.findByText(i18n.t("applications.declaration.empty"))
      ).toBeVisible()
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
      expect(copyButton()).toBeDisabled()
    })
  }
)

it.each(["zh-CN", "en-US"])(
  "keeps a long resource list in its own keyboard-accessible scroll region (%s)",
  async (locale) => {
    await i18n.changeLanguage(locale)
    const user = userEvent.setup()
    mockResources(
      Array.from({ length: 60 }, (_, index) => ({
        type: "skill",
        id: uuid(index),
        name: `Skill ${index}`,
      }))
    )
    show()
    const last = await screen.findByRole("checkbox", { name: "Skill 59" })
    const list = screen.getByRole("region", {
      name: i18n.t("applications.declaration.title"),
    })
    expect(list).toHaveClass(
      "min-h-0",
      "max-h-[45dvh]",
      "overflow-y-auto",
      "overscroll-contain",
      "lg:max-h-none",
      "lg:flex-1",
      "*:shrink-0"
    )
    expect(list).toHaveAttribute("tabindex", "0")
    expect(list).toContainElement(last)
    const search = screen.getByRole("textbox", {
      name: i18n.t("applications.declaration.search"),
    })
    expect(list).not.toContainElement(search)
    expect(list).not.toContainElement(copyButton())
    expect(list).not.toContainElement(
      screen.getByRole("textbox", {
        name: i18n.t("applications.declaration.preview"),
      })
    )
    expect(list.closest('[data-slot="declaration-resources"]')).toHaveClass(
      "min-h-0"
    )
    expect(list.closest('[data-slot="declaration-columns"]')).toHaveClass(
      "min-h-0",
      "lg:grid-rows-[minmax(0,1fr)]"
    )
    expect(list.closest('[data-slot="declaration-body"]')).toHaveClass(
      "lg:grid",
      "lg:grid-rows-[minmax(0,1fr)]",
      "lg:overflow-hidden"
    )
    expect(list.closest('[data-slot="declaration-body"]')).not.toHaveClass(
      "lg:h-[min(36rem,60dvh)]"
    )
    expect(screen.getByRole("dialog")).toHaveClass(
      "max-h-[calc(100dvh-1rem)]",
      "lg:grid",
      "lg:grid-rows-[auto_minmax(0,1fr)_auto]"
    )
    list.focus()
    expect(list).toHaveFocus()
    await user.click(last)
    expect(preview().dependencies.skills).toEqual([
      { id: uuid(59), name: "Skill 59" },
    ])
    await user.type(search, "Skill 0")
    expect(
      screen.queryByRole("checkbox", { name: "Skill 59" })
    ).not.toBeInTheDocument()
    await user.clear(search)
    expect(screen.getByRole("checkbox", { name: "Skill 59" })).toBeChecked()
  }
)

it.each(["zh-CN", "en-US"])(
  "uses a wider two-column resource layout and independent category selection in %s",
  async (locale) => {
    await i18n.changeLanguage(locale)
    const user = userEvent.setup()
    mockResources([
      ...resources,
      { type: "plugin", id: uuid(10), name: "Second plugin" },
    ])
    show()
    const first = await screen.findByRole("checkbox", {
      name: /Resource plugin/,
    })
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveClass("sm:max-w-6xl")
    const columns = dialog.querySelector('[data-slot="declaration-columns"]')
    const resourceColumn = dialog.querySelector(
      '[data-slot="declaration-resources"]'
    )
    const previewColumn = dialog.querySelector<HTMLDivElement>(
      '[data-slot="declaration-preview"]'
    )
    expect(columns).toHaveClass(
      "grid-cols-1",
      "lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
    )
    expect(columns?.firstElementChild).toBe(resourceColumn)
    expect(columns?.lastElementChild).toBe(previewColumn)
    expect(resourceColumn).toContainElement(first)
    expect(previewColumn).toContainElement(
      screen.getByRole("textbox", {
        name: i18n.t("applications.declaration.preview"),
      })
    )
    expect(columns).toHaveClass("lg:items-stretch")
    expect(previewColumn).toHaveClass("min-w-0", "min-h-0")
    expect(previewColumn).not.toHaveClass("lg:sticky")
    const previewInput = screen.getByRole("textbox", {
      name: i18n.t("applications.declaration.preview"),
    })
    expect(previewInput.closest('[data-slot="input-group"]')).toHaveClass(
      "lg:flex-1",
      "min-h-0"
    )
    expect(previewInput).toHaveClass(
      "field-sizing-fixed",
      "lg:h-0",
      "lg:flex-1",
      "lg:max-h-none"
    )
    expect(resourceColumn).not.toContainElement(previewColumn)
    const body = dialog.querySelector(".overflow-y-auto")
    expect(body).toHaveClass("-mr-6", "pr-6", "w-auto", "min-h-0")
    expect(body).toContainElement(first)
    expect(body).not.toContainElement(
      dialog.querySelector('[data-slot="dialog-header"]')
    )
    expect(body).not.toContainElement(copyButton())
    expect(
      screen.getByRole("textbox", {
        name: i18n.t("applications.declaration.preview"),
      })
    ).not.toHaveClass("-mr-6")
    expect(first.closest('[data-slot="field-group"]')).toHaveClass(
      "grid",
      "grid-cols-1",
      "sm:grid-cols-2"
    )
    for (const type of interactiveDependencyTypeSchema.options) {
      const legend = allBox(type).closest('[data-slot="field-legend"]')
      expect(legend).toHaveClass("justify-start", "gap-x-4", "mb-3")
      expect(legend).toHaveAttribute("data-variant", "label")
      expect(legend).not.toHaveClass("justify-between", "mb-0")
      expect(legend?.firstElementChild).toHaveTextContent(
        i18n.t(`applications.dependencies.types.${type}`)
      )
    }
    await user.click(first)
    expect(allBox("plugin")).toBePartiallyChecked()
    expect(allBox("skill")).not.toBeChecked()
    await user.click(allBox("plugin"))
    expect(preview().dependencies.plugins).toHaveLength(2)
    expect(preview().dependencies.skills).toEqual([])
    await user.click(allBox("skill"))
    await user.click(allBox("plugin"))
    expect(preview().dependencies.plugins).toEqual([])
    expect(preview().dependencies.skills).toHaveLength(1)
    const search = screen.getByRole("textbox", {
      name: i18n.t("applications.declaration.search"),
    })
    await user.type(search, "Second")
    await user.click(allBox("plugin", true))
    await user.clear(search)
    expect(allBox("plugin")).toBePartiallyChecked()
    expect(preview().dependencies.plugins).toEqual([
      { id: uuid(10), name: "Second plugin" },
    ])
    expect(preview().dependencies.skills).toHaveLength(1)
  }
)

it("disables copying on loading or failed pages and supports retry", async () => {
  await i18n.changeLanguage("zh-CN")
  const user = userEvent.setup()
  vi.mocked(apiRequest).mockRejectedValue(new Error("Failed"))
  show()
  expect(copyButton()).toBeDisabled()
  const retry = await screen.findByRole("button", {
    name: i18n.t("common.retry"),
  })
  expect(copyButton()).toBeDisabled()
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  mockResources()
  await user.click(retry)
  await user.click(
    await screen.findByRole("checkbox", { name: /Resource plugin/ })
  )
  expect(copyButton()).toBeEnabled()
})

it("does not silently truncate an over-limit selection and allows fixing it", async () => {
  await i18n.changeLanguage("zh-CN")
  const user = userEvent.setup()
  mockResources(
    Array.from({ length: 51 }, (_, i) => ({
      type: i < 25 ? "plugin" : "skill",
      id: uuid(i),
      name: `Resource ${i}`,
    }))
  )
  show()
  await screen.findByRole("checkbox", { name: /Resource 50/ })
  await user.click(allBox("plugin"))
  await user.click(allBox("skill"))
  expect(
    screen.getByText(i18n.t("applications.declaration.invalid"))
  ).toBeVisible()
  expect(copyButton()).toBeDisabled()
  await user.click(screen.getByRole("checkbox", { name: /Resource 50/ }))
  expect(copyButton()).toBeEnabled()
  expect(
    interactiveDependenciesSchema.parse(preview().dependencies).skills
  ).toHaveLength(25)
})

it("loads every resource page with authorization handled by the API and forwards cancellation", async () => {
  const first = Array.from({ length: 100 }, (_, i) => ({
    id: uuid(i),
    name: `Skill ${i}`,
  }))
  vi.mocked(apiRequest).mockImplementation(async (_path, options) =>
    options?.query?.type !== "skill"
      ? { items: [], next_cursor: null }
      : options.query.cursor
        ? { items: [{ id: uuid(100), name: "Last skill" }], next_cursor: null }
        : { items: first, next_cursor: uuid(99) }
  )
  const signal = new AbortController().signal
  const result = await loadDeclarationResources(signal)
  expect(result).toHaveLength(101)
  expect(result.some((item) => item.name === "Last skill")).toBe(true)
  expect(
    vi
      .mocked(apiRequest)
      .mock.calls.every(([, options]) => options?.signal === signal)
  ).toBe(true)
  expect(apiRequest).toHaveBeenCalledWith(
    "/applications/interactive-dependency-options",
    expect.objectContaining({ query: { type: "skill", cursor: uuid(99) } })
  )
})

it("rejects the entire resource load if a later page fails", async () => {
  vi.mocked(apiRequest).mockImplementation(async (_path, options) => {
    if (options?.query?.cursor) throw new Error("Page failed")
    return options?.query?.type === "skill"
      ? { items: [{ id: uuid(0), name: "First" }], next_cursor: uuid(0) }
      : { items: [], next_cursor: null }
  })
  await expect(
    loadDeclarationResources(new AbortController().signal)
  ).rejects.toThrow("Page failed")
})

it.each(["mcp_server", "knowledge_base"] as const)(
  "validates the %s limit using the manifest contract",
  (type) => {
    const entries = Array.from({ length: 21 }, (_, i) => ({
      id: uuid(i),
      name: "Resource",
      type,
    }))
    expect(buildResourceDeclaration(entries).success).toBe(false)
    expect(buildResourceDeclaration(entries.slice(0, 20)).success).toBe(true)
  }
)

it("provides Chinese fallback for declaration instructions", async () => {
  const fallback = i18n.cloneInstance({ lng: "de", fallbackLng: "zh-CN" })
  await fallback.init()
  for (const key of [
    "title",
    "purpose",
    "mergeHint",
    "copyFailed",
    "groupSelected",
  ] as const) {
    expect(fallback.t(`applications.declaration.${key}`)).toBe(
      i18n.getFixedT("zh-CN")(`applications.declaration.${key}`)
    )
  }
})

it.each(["zh-CN", "en-US"])(
  "selects rounded resource rows by label and keyboard, keeps counts in the footer, and updates the always-visible preview (%s)",
  async (locale) => {
    await i18n.changeLanguage(locale)
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue()
    mockResources()
    show()
    const checkbox = await screen.findByRole("checkbox", {
      name: "Resource plugin",
    })
    const card = checkbox.closest("label")
    expect(card).toHaveClass("rounded-xl", "border", "min-h-10", "w-full")
    expect(card).toHaveClass("border-[color:var(--app-border)]")
    expect(card).not.toHaveClass(
      "border-border",
      "has-data-[checked]:border-primary/40"
    )
    expect(
      screen.queryByRole("textbox", {
        name: i18n.t("applications.declaration.preview"),
      })
    ).toBeVisible()
    expect(
      screen.queryByRole("button", {
        name: i18n.t("applications.declaration.preview"),
      })
    ).not.toBeInTheDocument()
    await user.click(screen.getByText("Resource plugin"))
    expect(checkbox).toBeChecked()
    expect(card).toHaveClass("border-[color:var(--app-border)]")
    expect(card).not.toHaveClass("has-data-[checked]:border-primary/40")
    const footer = copyButton().closest('[data-slot="dialog-footer"]')
    expect(footer).toContainElement(
      screen.getByText(
        i18n.t("applications.declaration.selected", { count: 1 })
      )
    )
    expect(allBox("plugin").closest("legend")).toHaveTextContent(
      i18n.t("applications.declaration.groupSelected", { count: 1, total: 1 })
    )
    checkbox.focus()
    await user.keyboard(" ")
    expect(checkbox).not.toBeChecked()
    await user.keyboard(" ")
    expect(checkbox).toBeChecked()
    await user.click(copyButton())
    await waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(
      JSON.parse(write.mock.calls[0]?.[0] ?? "{}").dependencies.plugins
    ).toEqual([{ id: uuid(0), name: "Resource plugin" }])
    expect(preview().dependencies.plugins).toHaveLength(1)
    expect(checkbox).toBeChecked()
  }
)
