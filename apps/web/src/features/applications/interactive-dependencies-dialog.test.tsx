import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  interactiveDependencySelectionSchema,
  interactiveDependencyTypeSchema,
} from "@linksense/shared"
import i18n from "@/i18n"
import { apiRequest } from "@/api/client"
import { InteractiveApplicationImportDialog } from "./application-catalog-panel"
import { InteractiveDependenciesDialog } from "./interactive-dependencies-dialog"
import { InteractiveDependencyFields } from "./interactive-dependency-fields"
import { ApplicationUsageModes } from "./application-usage-modes"

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})
const id = "10000000-0000-4000-8000-000000000001"
const resourceId = "20000000-0000-4000-8000-000000000001"
const state = {
  items: [
    {
      type: "skill",
      id,
      name: "Review",
      resource_id: null,
      resource_name: null,
      available: false,
    },
  ],
}
function show(content: React.ReactNode) {
  return render(
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
      {content}
    </QueryClientProvider>
  )
}
function mockRequests() {
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (
      path.endsWith("/preview") ||
      (path.endsWith("/interactive-dependencies") &&
        options?.method !== "PATCH")
    )
      return state
    if (path === "/applications/interactive-dependency-options")
      return { items: [{ id: resourceId, name: "My review" }] }
    return { id }
  })
}

describe.each(["zh-CN", "en-US"])("interactive dependencies (%s)", (locale) => {
  it("hides cancel and save when no resources are declared and keeps the close button usable", async () => {
    await i18n.changeLanguage(locale)
    vi.mocked(apiRequest).mockResolvedValue({ items: [] })
    const close = vi.fn(),
      user = userEvent.setup()
    show(<InteractiveDependenciesDialog applicationId={id} onClose={close} />)
    expect(
      await screen.findByText(i18n.t("applications.dependencies.empty"))
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: i18n.t("common.cancel") })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: i18n.t("common.save") })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("dialog").querySelector('[data-slot="dialog-footer"]')
    ).toBeNull()
    await user.click(
      screen.getByRole("button", { name: i18n.t("common.close") })
    )
    expect(close).toHaveBeenCalledOnce()
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.some(([, options]) => options?.method === "PATCH")
    ).toBe(false)
  })
  it("keeps every resource label beside a right-aligned picker, with wrapping space for long names", async () => {
    await i18n.changeLanguage(locale)
    mockRequests()
    const name = "LongResourceName".repeat(6)
    show(
      <InteractiveDependencyFields
        state={{
          items: interactiveDependencyTypeSchema.options.map((type) => ({
            type,
            id,
            name,
            resource_id: resourceId,
            resource_name: "My review",
            available: true,
          })),
        }}
        onChange={vi.fn()}
      />
    )
    for (const type of interactiveDependencyTypeSchema.options) {
      const labelText = `${i18n.t(`applications.dependencies.types.${type}`)} · ${name}`
      const picker = screen.getByRole("combobox", { name: labelText })
      const label = screen.getByText(labelText).closest("label")
      const inputGroup = picker.closest('[data-slot="input-group"]')
      const row = label?.parentElement
      expect(row).toHaveAttribute("data-orientation", "horizontal")
      expect(inputGroup?.parentElement).toBe(row)
      expect(inputGroup).toHaveClass(
        "ml-auto",
        "w-1/2",
        "min-w-0",
        "max-w-64",
        "shrink-0"
      )
      expect(label).toHaveClass("min-w-0", "wrap-anywhere")
    }
    expect(
      screen.getAllByRole("img", {
        name: i18n.t("applications.dependencies.matched"),
      })
    ).toHaveLength(4)
    expect(
      screen.getAllByRole("button", {
        name: i18n.t("applications.dependencies.clear"),
      })
    ).toHaveLength(4)
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(4))
  })
  it("previews missing resources and imports without forcing a selection", async () => {
    await i18n.changeLanguage(locale)
    mockRequests()
    const user = userEvent.setup(),
      completed = vi.fn(async () => undefined)
    show(
      <InteractiveApplicationImportDialog
        open
        application={null}
        onOpenChange={vi.fn()}
        onCompleted={completed}
      />
    )
    await user.upload(
      screen.getByLabelText(i18n.t("applications.applicationPackage")),
      new File(["test-zip"], "app.zip", { type: "application/zip" })
    )
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("applications.dependencies.preview"),
      })
    )
    expect(
      await screen.findByRole("img", {
        name: i18n.t("applications.dependencies.unmatched"),
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t("applications.dependencies.hint"))
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("applications.importPackageAction"),
      })
    )
    await waitFor(() => expect(completed).toHaveBeenCalledOnce())
    const request = vi
      .mocked(apiRequest)
      .mock.calls.find(([path]) => path === "/applications/interactive-import")
    const body = request?.[1]?.body
    expect(body).toBeInstanceOf(FormData)
    if (!(body instanceof FormData)) throw new Error("Expected multipart body")
    expect(JSON.parse(String(body.get("dependencies")))).toEqual({
      bindings: [],
    })
    expect(body.get("file")).toBeInstanceOf(File)
  })
  it("allows manual matching after import and submits only the declared mapping", async () => {
    await i18n.changeLanguage(locale)
    mockRequests()
    const user = userEvent.setup(),
      close = vi.fn()
    show(<InteractiveDependenciesDialog applicationId={id} onClose={close} />)
    const picker = await screen.findByRole("combobox")
    expect(
      screen.getByRole("button", { name: i18n.t("common.cancel") })
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: i18n.t("common.save") })
    ).toBeEnabled()
    await user.click(picker)
    await user.click(await screen.findByRole("option", { name: "My review" }))
    await user.click(
      screen.getByRole("button", { name: i18n.t("common.save") })
    )
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    const request = vi
      .mocked(apiRequest)
      .mock.calls.find(([, options]) => options?.method === "PATCH")
    expect(
      interactiveDependencySelectionSchema.parse(request?.[1]?.body)
    ).toEqual({ bindings: [{ type: "skill", id, resource_id: resourceId }] })
  })
  it("switches status icons when selecting and clearing inside the picker, and saves an empty mapping", async () => {
    await i18n.changeLanguage(locale)
    mockRequests()
    const user = userEvent.setup(),
      close = vi.fn()
    show(<InteractiveDependenciesDialog applicationId={id} onClose={close} />)
    const picker = await screen.findByRole("combobox")
    expect(
      screen.getByRole("img", {
        name: i18n.t("applications.dependencies.unmatched"),
      })
    ).toHaveClass("text-warning", "lucide-circle-alert")
    expect(
      screen.queryByText(i18n.t("applications.dependencies.unmatched"))
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: i18n.t("applications.dependencies.clear"),
      })
    ).not.toBeInTheDocument()
    await user.click(picker)
    await user.click(await screen.findByRole("option", { name: "My review" }))
    const status = screen.getByRole("img", {
      name: i18n.t("applications.dependencies.matched"),
    })
    expect(status).toHaveClass("text-success", "lucide-circle-check")
    expect(status.parentElement?.tagName).toBe("LABEL")
    expect(
      screen.queryByText(i18n.t("applications.dependencies.matched"))
    ).not.toBeInTheDocument()
    const clear = screen.getByRole("button", {
      name: i18n.t("applications.dependencies.clear"),
    })
    expect(clear.textContent).toBe("")
    expect(clear.closest('[data-slot="input-group"]')).toBe(
      picker.closest('[data-slot="input-group"]')
    )
    expect(clear.closest('[data-slot="input-group-addon"]')).toHaveAttribute(
      "data-align",
      "inline-end"
    )
    expect(picker).toHaveAttribute("aria-expanded", "false")
    picker.focus()
    await user.tab()
    expect(clear).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(picker).toHaveValue("")
    expect(
      screen.getByRole("img", {
        name: i18n.t("applications.dependencies.unmatched"),
      })
    ).toHaveClass("text-warning")
    expect(
      screen.queryByRole("button", {
        name: i18n.t("applications.dependencies.clear"),
      })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: i18n.t("common.save") })
    )
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    const request = vi
      .mocked(apiRequest)
      .mock.calls.find(([, options]) => options?.method === "PATCH")
    expect(
      interactiveDependencySelectionSchema.parse(request?.[1]?.body)
    ).toEqual({ bindings: [{ type: "skill", id, resource_id: null }] })
  })
  it("marks unavailable saved resources with a warning and still allows clearing them", async () => {
    await i18n.changeLanguage(locale)
    mockRequests()
    const change = vi.fn(),
      user = userEvent.setup()
    show(
      <InteractiveDependencyFields
        state={{
          items: [
            {
              type: "skill",
              id,
              name: "Review",
              resource_id: resourceId,
              resource_name: null,
              available: false,
            },
          ],
        }}
        onChange={change}
      />
    )
    expect(
      screen.getByRole("img", {
        name: i18n.t("applications.dependencies.unmatched"),
      })
    ).toHaveClass("text-warning")
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("applications.dependencies.clear"),
      })
    )
    expect(change).toHaveBeenLastCalledWith({
      type: "skill",
      id,
      resource_id: null,
    })
    expect(screen.getByRole("combobox")).toHaveValue("")
  })
  it("disables the internal clear button while resource editing is disabled", async () => {
    await i18n.changeLanguage(locale)
    mockRequests()
    const change = vi.fn(),
      user = userEvent.setup()
    show(
      <InteractiveDependencyFields
        disabled
        state={{
          items: [
            {
              type: "skill",
              id,
              name: "Review",
              resource_id: resourceId,
              resource_name: "My review",
              available: true,
            },
          ],
        }}
        onChange={change}
      />
    )
    const clear = screen.getByRole("button", {
      name: i18n.t("applications.dependencies.clear"),
    })
    expect(clear).toBeDisabled()
    await user.click(clear)
    expect(change).not.toHaveBeenCalled()
    await waitFor(() => expect(apiRequest).toHaveBeenCalled())
  })
  it("shows only the fixed service mode for interactive apps", async () => {
    await i18n.changeLanguage(locale)
    show(
      <ApplicationUsageModes
        value={["service"]}
        onChange={vi.fn()}
        serviceOnly
      />
    )
    expect(
      screen.queryByRole("checkbox", {
        name: i18n.t("applications.distribution.modes.install"),
      })
    ).not.toBeInTheDocument()
    const service = screen.getByRole("checkbox", {
      name: i18n.t("applications.distribution.modes.service"),
    })
    expect(service).toBeChecked()
    expect(service).toHaveAttribute("aria-disabled", "true")
  })
})

it("falls back to Chinese when dependency translations are missing in the selected language", async () => {
  await i18n.changeLanguage("fr-FR")
  expect(i18n.t("applications.dependencies.title")).toBe("配置所需资源")
  expect(i18n.t("applications.dependencies.types.skill")).toBe("技能")
  expect(i18n.t("applications.dependencies.matched")).toBe("已配置")
  expect(i18n.t("applications.dependencies.unmatched")).toBe("未配置")
  expect(i18n.t("applications.dependencies.clear")).toBe("清除选择")
})

it.each([
  [
    "zh-CN",
    "以下是应用包已声明的插件技能等资源，导入前建议完成资源配置，以便可以正常的使用应用包。",
  ],
  [
    "en-US",
    "The following plugins, skills, and other resources have been declared by the app package. We recommend completing resource configuration before importing so the app can work properly.",
  ],
  [
    "fr-FR",
    "以下是应用包已声明的插件技能等资源，导入前建议完成资源配置，以便可以正常的使用应用包。",
  ],
])(
  "recommends resource configuration in %s without making it mandatory",
  async (locale, expected) => {
    await i18n.changeLanguage(locale)
    expect(i18n.t("applications.dependencies.hint")).toBe(expected)
  }
)

it("keeps the import open and displays a preview error", async () => {
  await i18n.changeLanguage("zh-CN")
  vi.mocked(apiRequest).mockRejectedValue(new Error("preview failed"))
  const user = userEvent.setup(),
    completed = vi.fn(async () => undefined)
  show(
    <InteractiveApplicationImportDialog
      open
      application={null}
      onOpenChange={vi.fn()}
      onCompleted={completed}
    />
  )
  await user.upload(
    screen.getByLabelText(i18n.t("applications.applicationPackage")),
    new File(["zip"], "app.zip", { type: "application/zip" })
  )
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("applications.dependencies.preview"),
    })
  )
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
  expect(completed).not.toHaveBeenCalled()
})
