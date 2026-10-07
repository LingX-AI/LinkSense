import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationSchema,
  interactiveDependencyTypeSchema,
  type InteractiveDependencyState,
} from "@linksense/shared"
import i18n from "@/i18n"
import { ApiError, apiRequest } from "@/api/client"
import { InteractiveApplicationImportDialog } from "./application-catalog-panel"
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
const previewApplication = {
  name: "Request review",
  description: "Review procurement requests.",
  version: "1.2.3",
}
const state: InteractiveDependencyState = {
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
  vi.mocked(apiRequest).mockImplementation(async (path) => {
    if (path.endsWith("/preview"))
      return { ...state, application: previewApplication }
    if (path === "/applications/interactive-dependency-options")
      return { items: [{ id: resourceId, name: "My review" }] }
    return { id }
  })
}

describe.each(["zh-CN", "en-US"])("interactive dependencies (%s)", (locale) => {
  it("shows an empty state when no resources are declared", async () => {
    await i18n.changeLanguage(locale)
    const onChange = vi.fn()
    show(
      <InteractiveDependencyFields state={{ items: [] }} onChange={onChange} />
    )
    expect(
      screen.getByText(i18n.t("applications.dependencies.empty"))
    ).toBeInTheDocument()
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(apiRequest).not.toHaveBeenCalled()
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
  it("shows parsed metadata, preserves resource selection and publishes the imported version", async () => {
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
      screen.getByLabelText(
        new RegExp(`^${i18n.t("applications.applicationPackage")}\\s*\\*?$`)
      ),
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
    expect(
      screen.getByRole("textbox", { name: i18n.t("common.name") })
    ).toHaveValue(previewApplication.name)
    expect(
      screen.getByRole("textbox", { name: i18n.t("common.description") })
    ).toHaveValue(previewApplication.description)
    expect(
      screen.getByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
    ).toHaveValue(previewApplication.version)
    expect(
      screen.getByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
    ).toHaveAttribute("readonly")
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
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${id}/publish`,
      expect.objectContaining({
        method: "POST",
        body: { version_number: "1.2.3", usage_instructions: "" },
      })
    )
  })
  it.each([
    ["import", "1.2.2"],
    ["update", "1.2.2"],
    ["update", "1.2.3"],
  ])(
    "submits resource choices during %s with existing version %s",
    async (mode, highest) => {
      await i18n.changeLanguage(locale)
      const application = applicationSchema.parse({
        id,
        owner: { id, name: "Owner" },
        name: "Review app",
        icon: { type: "preset", preset: "sparkles" },
        description: null,
        kind: "interactive",
        instructions: null,
        model: null,
        reasoning_effort: null,
        status: "active",
        is_owner: true,
        can_manage: true,
        access_source: "owner",
        capability_count: 1,
        knowledge_base_count: 0,
        mcp_server_count: 0,
        dependencies_available: true,
        capabilities: [],
        knowledge_bases: [],
        mcp_servers: [],
        created_at: "2026-09-16T00:00:00Z",
        updated_at: "2026-09-16T00:00:00Z",
      })
      const original = { id: resourceId, name: "Procurement review" }
      const alternative = {
        id: "20000000-0000-4000-8000-000000000002",
        name: "Expense review",
      }
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (path.endsWith("/distribution/settings"))
          return {
            version_number: "1.2.3",
            highest_version_number: highest,
            usage_instructions: "Existing guide",
          }
        if (path.endsWith("/preview"))
          return {
            application: previewApplication,
            items: [
              {
                type: "skill",
                id: original.id,
                name: original.name,
                resource_id: original.id,
                resource_name: original.name,
                available: true,
              },
            ],
          }
        if (path === "/applications/interactive-dependency-options") {
          const search = String(options?.query?.search ?? "").toLowerCase()
          return {
            items: [original, alternative].filter((item) =>
              item.name.toLowerCase().includes(search)
            ),
            next_cursor: null,
          }
        }
        return application
      })
      const user = userEvent.setup(),
        completed = vi.fn(async () => undefined)
      show(
        <InteractiveApplicationImportDialog
          open
          application={mode === "update" ? application : null}
          onOpenChange={vi.fn()}
          onCompleted={completed}
        />
      )
      await user.upload(
        screen.getByLabelText(
          new RegExp(`^${i18n.t("applications.applicationPackage")}\\s*\\*?$`)
        ),
        new File(["zip"], "app.zip", { type: "application/zip" })
      )
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("applications.dependencies.preview"),
        })
      )
      const picker = await screen.findByRole("combobox")
      expect(picker).toHaveValue(original.name)
      await user.clear(picker)
      await user.type(picker, "Expense")
      const option = await screen.findByRole("option", {
        name: alternative.name,
      })
      expect(
        screen.queryByRole("option", { name: original.name })
      ).not.toBeInTheDocument()
      await user.click(option)
      expect(picker).toHaveValue(alternative.name)
      await user.click(picker)
      await user.click(
        await screen.findByRole("option", { name: original.name })
      )
      expect(picker).toHaveValue(original.name)
      await user.click(
        screen.getByRole("button", {
          name: i18n.t(
            mode === "update"
              ? "applications.updatePackageAndPublish"
              : "applications.importPackageAction"
          ),
        })
      )
      await waitFor(() => expect(completed).toHaveBeenCalledOnce())
      const path =
        mode === "update"
          ? `/applications/${id}/interactive-package`
          : "/applications/interactive-import"
      const body = vi
        .mocked(apiRequest)
        .mock.calls.find(([url]) => url === path)?.[1]?.body
      expect(body).toBeInstanceOf(FormData)
      if (!(body instanceof FormData))
        throw new Error("Expected multipart body")
      expect(JSON.parse(String(body.get("dependencies")))).toEqual({
        bindings: [
          { type: "skill", id: original.id, resource_id: original.id },
        ],
      })
      if (mode === "update") {
        expect(JSON.parse(String(body.get("release")))).toEqual({
          version_number: "1.2.3",
          usage_instructions: "Existing guide",
        })
        expect(apiRequest).not.toHaveBeenCalledWith(
          `/applications/${id}/publish`,
          expect.anything()
        )
      }
    }
  )
  it.each(interactiveDependencyTypeSchema.options)(
    "allows switching a matched %s resource away and back without filtering by the selected name",
    async (type) => {
      await i18n.changeLanguage(locale)
      const original = { id: resourceId, name: "Procurement review" }
      const alternative = {
        id: "20000000-0000-4000-8000-000000000002",
        name: "Expense review",
      }
      const other = {
        id: "20000000-0000-4000-8000-000000000003",
        name: "Policy search",
      }
      vi.mocked(apiRequest).mockImplementation(async (path, options) => {
        if (path === "/applications/interactive-dependency-options") {
          const search = String(options?.query?.search ?? "").toLowerCase()
          return {
            items: [original, alternative, other].filter((item) =>
              item.name.toLowerCase().includes(search)
            ),
            next_cursor: null,
          }
        }
        throw new Error(`Unexpected request: ${path}`)
      })
      const user = userEvent.setup(),
        onChange = vi.fn()
      show(
        <InteractiveDependencyFields
          state={{
            items: [
              {
                type,
                id,
                name: "Declared review resource",
                resource_id: original.id,
                resource_name: original.name,
                available: true,
              },
            ],
          }}
          onChange={onChange}
        />
      )
      const picker = await screen.findByRole("combobox")
      expect(picker).toHaveValue(original.name)
      await user.click(picker)
      await user.click(
        await screen.findByRole("option", { name: alternative.name })
      )
      expect(picker).toHaveValue(alternative.name)
      await user.click(picker)
      expect(
        await screen.findByRole("option", { name: other.name })
      ).toBeInTheDocument()
      expect(screen.getAllByRole("option")).toHaveLength(3)
      await user.click(
        await screen.findByRole("option", { name: original.name })
      )
      expect(picker).toHaveValue(original.name)
      expect(onChange).toHaveBeenLastCalledWith({
        type,
        id,
        resource_id: original.id,
      })
    }
  )
  it("keeps an available original match selectable when it is outside the first options page", async () => {
    await i18n.changeLanguage(locale)
    const original = { id: resourceId, name: "Original review" }
    const alternative = {
      id: "10000000-0000-4000-8000-000000000002",
      name: "Alternative review",
    }
    vi.mocked(apiRequest).mockResolvedValue({
      items: [alternative],
      next_cursor: alternative.id,
    })
    const user = userEvent.setup(),
      change = vi.fn()
    show(
      <InteractiveDependencyFields
        state={{
          items: [
            {
              type: "skill",
              id,
              name: "Declared review",
              resource_id: original.id,
              resource_name: original.name,
              available: true,
            },
          ],
        }}
        onChange={change}
      />
    )
    const picker = screen.getByRole("combobox")
    await user.click(picker)
    await user.click(
      await screen.findByRole("option", { name: alternative.name })
    )
    await user.click(picker)
    await user.click(await screen.findByRole("option", { name: original.name }))
    expect(picker).toHaveValue(original.name)
    expect(change).toHaveBeenLastCalledWith({
      type: "skill",
      id,
      resource_id: original.id,
    })
    await user.click(
      screen.getByRole("button", {
        name: i18n.t("applications.dependencies.clear"),
      })
    )
    expect(picker).toHaveValue("")
    await user.click(picker)
    expect(
      await screen.findByRole("option", { name: original.name })
    ).toBeInTheDocument()
  })
  it("switches status icons when selecting and clearing inside the picker, and reports an empty mapping", async () => {
    await i18n.changeLanguage(locale)
    mockRequests()
    const user = userEvent.setup(),
      onChange = vi.fn()
    show(<InteractiveDependencyFields state={state} onChange={onChange} />)
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
    expect(onChange).toHaveBeenLastCalledWith({
      type: "skill",
      id,
      resource_id: null,
    })
  })
  it("marks unavailable saved resources with a warning and still allows clearing them", async () => {
    await i18n.changeLanguage(locale)
    vi.mocked(apiRequest).mockResolvedValue({
      items: [
        {
          id: "20000000-0000-4000-8000-000000000002",
          name: "Other review",
        },
      ],
      next_cursor: null,
    })
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
    await user.click(screen.getByRole("combobox"))
    expect(
      await screen.findByRole("option", { name: "Other review" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("option", { name: "Review" })
    ).not.toBeInTheDocument()
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
  await i18n.changeLanguage("de-DE")
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
    "de-DE",
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
    screen.getByLabelText(
      new RegExp(`^${i18n.t("applications.applicationPackage")}\\s*\\*?$`)
    ),
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

it("retries publication with corrected resources without importing a duplicate application", async () => {
  await i18n.changeLanguage("zh-CN")
  mockRequests()
  const original = vi.mocked(apiRequest).getMockImplementation()!
  let attempts = 0
  vi.mocked(apiRequest).mockImplementation(async (path, options) => {
    if (path.endsWith("/publish") && attempts++ === 0)
      throw new ApiError({
        status: 409,
        errorCode: "APPLICATION_DEPENDENCY_UNAVAILABLE",
      })
    return original(path, options)
  })
  const user = userEvent.setup()
  const completed = vi.fn(async () => undefined)
  show(
    <InteractiveApplicationImportDialog
      open
      application={null}
      onOpenChange={vi.fn()}
      onCompleted={completed}
    />
  )
  const fileInput = screen.getByLabelText(
    new RegExp(`^${i18n.t("applications.applicationPackage")}\\s*\\*?$`)
  )
  await user.upload(
    fileInput,
    new File(["zip"], "app.zip", { type: "application/zip" })
  )
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("applications.dependencies.preview"),
    })
  )
  await user.click(await screen.findByRole("button", { name: "导入" }))
  expect(await screen.findByRole("alert")).toBeVisible()
  expect(completed).not.toHaveBeenCalled()
  expect(fileInput).toBeDisabled()
  await user.click(screen.getByRole("combobox"))
  await user.click(await screen.findByRole("option", { name: "My review" }))
  await user.click(screen.getByRole("button", { name: "导入" }))
  await waitFor(() => expect(completed).toHaveBeenCalledOnce())
  expect(
    vi
      .mocked(apiRequest)
      .mock.calls.filter(
        ([path]) => path === "/applications/interactive-import"
      )
  ).toHaveLength(1)
  expect(apiRequest).toHaveBeenCalledWith(
    `/applications/${id}/interactive-dependencies`,
    expect.objectContaining({
      method: "PATCH",
      body: { bindings: [{ type: "skill", id, resource_id: resourceId }] },
    })
  )
})

it("clears the previous package information when choosing another file", async () => {
  await i18n.changeLanguage("zh-CN")
  mockRequests()
  const user = userEvent.setup()
  show(
    <InteractiveApplicationImportDialog
      open
      application={null}
      onOpenChange={vi.fn()}
      onCompleted={vi.fn(async () => undefined)}
    />
  )
  const fileInput = screen.getByLabelText(
    new RegExp(`^${i18n.t("applications.applicationPackage")}\\s*\\*?$`)
  )
  await user.upload(
    fileInput,
    new File(["zip"], "first.zip", { type: "application/zip" })
  )
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("applications.dependencies.preview"),
    })
  )
  expect(await screen.findByDisplayValue(previewApplication.name)).toBeVisible()
  await user.upload(
    fileInput,
    new File(["another zip"], "second.zip", { type: "application/zip" })
  )
  expect(
    screen.queryByDisplayValue(previewApplication.name)
  ).not.toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "导入" })).not.toBeInTheDocument()
  expect(
    screen.getByRole("button", {
      name: i18n.t("applications.dependencies.preview"),
    })
  ).toBeEnabled()
})

it("shows an empty description and prevents publishing a package with a non-release version", async () => {
  await i18n.changeLanguage("de-DE")
  vi.mocked(apiRequest).mockResolvedValue({
    items: [],
    application: {
      ...previewApplication,
      description: null,
      version: "1.2.3-beta",
    },
  })
  const user = userEvent.setup()
  show(
    <InteractiveApplicationImportDialog
      open
      application={null}
      onOpenChange={vi.fn()}
      onCompleted={vi.fn(async () => undefined)}
    />
  )
  await user.upload(
    screen.getByLabelText(
      new RegExp(`^${i18n.t("applications.applicationPackage")}\\s*\\*?$`)
    ),
    new File(["zip"], "first.zip", { type: "application/zip" })
  )
  await user.click(
    screen.getByRole("button", {
      name: i18n.t("applications.dependencies.preview"),
    })
  )
  expect(await screen.findByPlaceholderText("暂无说明")).toHaveValue("")
  expect(screen.getByRole("textbox", { name: "版本号" })).toHaveValue(
    "1.2.3-beta"
  )
  expect(screen.getByRole("textbox", { name: "版本号" })).toHaveAttribute(
    "aria-invalid",
    "true"
  )
  expect(
    screen.getByText(i18n.t("applications.interactivePackageVersionInvalid"))
  ).toBeVisible()
  const submit = screen.getByRole("button", { name: "导入" })
  expect(submit).toBeDisabled()
  await user.click(submit)
  expect(apiRequest).toHaveBeenCalledTimes(1)
})
