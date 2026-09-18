import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applicationDetailsSchema,
  type ApplicationDetails,
} from "@linksense/shared"
import { apiRequest } from "@/api/client"
import i18n from "@/i18n"
import { ApplicationDetailsDialog } from "./application-details-dialog"

vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const id = "10000000-0000-4000-8000-000000000001"
const details = applicationDetailsSchema.parse({
  id,
  name: "Research assistant",
  icon: { type: "preset", preset: "bot" },
  description:
    "Full application description\nSecond line\nThird line remains visible",
  kind: "interactive",
  model: null,
  status: "active",
  creator_name: "Creator",
  view: "configuration",
  version_number: "1.2.0",
  created_at: "2026-09-17T00:00:00Z",
  updated_at: "2026-09-17T01:00:00Z",
  resources: [
    {
      id,
      type: "plugin",
      name: "Office plugin",
      configured_name: null,
      status: "unconfigured",
    },
    {
      id,
      type: "skill",
      name: "Research skill",
      configured_name: "My research skill",
      status: "configured",
    },
    {
      id,
      type: "knowledge_base",
      name: "Handbook",
      configured_name: null,
      status: "unavailable",
    },
    {
      id,
      type: "mcp_server",
      name: "Web search",
      configured_name: null,
      status: "configured",
    },
  ],
})

function show(channel: "direct" | "center" = "direct") {
  const onClose = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ApplicationDetailsDialog
        target={{ id, name: details.name, trigger: document.body }}
        channel={channel}
        onClose={onClose}
      />
    </QueryClientProvider>
  )
  return { onClose }
}

describe("application details dialog", () => {
  it.each(["zh-CN", "en-US"])(
    "shows full basic information and four resource groups without displaying identifiers in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest).mockResolvedValue(details)
      const { onClose } = show()
      const dialog = await screen.findByRole("dialog", {
        name: i18n.t("applications.details.title"),
      })
      const info = await within(dialog).findByRole("region", {
        name: i18n.t("applications.basicInformation"),
      })
      expect(info).toHaveTextContent("Creator")
      expect(dialog).toHaveTextContent("v1.2.0")
      expect(info).toHaveTextContent("Third line remains visible")
      expect(info).toHaveTextContent(i18n.t("applications.userSelectedModel"))
      expect(within(dialog).getAllByText(details.name)).toHaveLength(1)
      for (const resource of details.resources) {
        const group = within(dialog).getByRole("region", {
          name: i18n.t(`applications.dependencies.types.${resource.type}`),
        })
        expect(group).toHaveTextContent(resource.name ?? "")
        const status = i18n.t(
          `applications.details.resourceStatus.${resource.status}`
        )
        if (resource.status === "configured") {
          expect(within(group).getByRole("img", { name: status })).toBeVisible()
          expect(within(group).queryByText(status)).not.toBeInTheDocument()
        } else {
          expect(within(group).getByText(status)).toBeVisible()
        }
      }
      expect(dialog).toHaveTextContent("My research skill")
      expect(dialog).not.toHaveTextContent(id)
      expect(info.parentElement).toHaveClass(
        "overflow-y-auto",
        "-mr-6",
        "min-h-0"
      )
      expect(apiRequest).toHaveBeenCalledWith(
        `/applications/${id}/details`,
        expect.objectContaining({
          query: { channel: "direct" },
          schema: applicationDetailsSchema,
        })
      )
      expect(dialog.querySelector('[data-slot="dialog-footer"]')).toBeNull()
      const closeButton = within(dialog).getByRole("button", {
        name: i18n.t("common.close"),
      })
      expect(closeButton.querySelector("svg")).toBeInTheDocument()
      await userEvent.click(closeButton)
      expect(onClose).toHaveBeenCalledOnce()
    }
  )

  it("still closes with Escape after removing the footer action", async () => {
    vi.mocked(apiRequest).mockResolvedValue(details)
    const { onClose } = show()
    await screen.findByRole("region", {
      name: i18n.t("applications.basicInformation"),
    })
    await userEvent.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("uses plain two-column metadata and resource groups with one section divider", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue(details)
    show()
    const info = await screen.findByRole("region", { name: "基本信息" })
    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-2xl", "gap-5")
    expect(screen.getByRole("heading", { name: details.name })).toHaveClass(
      "text-base",
      "text-pretty"
    )
    const metadata = within(info).getByText("创建者").closest("dl")
    expect(metadata).toHaveClass("grid-cols-1", "sm:grid-cols-2")
    expect(within(info).getByText("创建者")).toHaveClass("text-xs")
    expect(within(info).getByText("Creator")).toHaveClass("text-sm")
    for (const className of ["bg-muted/50", "rounded-xl", "p-4"]) {
      expect(metadata).not.toHaveClass(className)
    }
    expect(screen.getAllByRole("separator")).toHaveLength(1)
    const resources = screen.getByRole("region", { name: "应用资源" })
    expect(
      within(resources).getByRole("heading", { name: "插件（1）" })
    ).toBeVisible()
    expect(within(resources).getAllByRole("listitem")).toHaveLength(4)
    for (const item of within(resources).getAllByRole("listitem")) {
      expect(item).not.toHaveClass("border")
      expect(item).not.toHaveClass("rounded-xl")
    }
    expect(
      resources.querySelector('[data-slot="badge"]')
    ).not.toBeInTheDocument()
  })

  it.each(["zh-CN", "en-US"])(
    "emphasizes the configured name and explains a different declaration with an accessible status in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest).mockResolvedValue(details)
      show()
      const group = await screen.findByRole("region", {
        name: i18n.t("applications.dependencies.types.skill"),
      })
      expect(within(group).getByText("My research skill")).toHaveClass(
        "text-sm"
      )
      expect(
        within(group).getByText(
          i18n.t("applications.details.declaredResource", {
            name: "Research skill",
          })
        )
      ).toHaveClass("text-xs", "text-muted-foreground")
      const status = i18n.t("applications.details.resourceStatus.configured")
      const indicator = within(group).getByRole("img", { name: status })
      await userEvent.hover(indicator)
      expect(await screen.findByRole("tooltip")).toHaveTextContent(status)
      await userEvent.unhover(indicator)
      indicator.focus()
      expect(await screen.findByRole("tooltip")).toHaveTextContent(status)
    }
  )

  it("does not repeat a declaration when it matches the configured resource name", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue({
      ...details,
      resources: [
        { ...details.resources[1], configured_name: "Research skill" },
      ],
    })
    show()
    const group = await screen.findByRole("region", { name: "技能" })
    expect(within(group).getAllByText("Research skill")).toHaveLength(1)
    expect(within(group).queryByText(/应用声明/)).not.toBeInTheDocument()
  })

  it("uses the center channel and renders deleted published resource names safely", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue({
      ...details,
      view: "published",
      resources: [{ ...details.resources[2], name: null }],
    })
    show("center")
    expect(await screen.findByText("资源已不可用")).toBeVisible()
    expect(screen.getByText("已发布版本")).toBeVisible()
    expect(apiRequest).toHaveBeenCalledWith(
      `/applications/${id}/details`,
      expect.objectContaining({ query: { channel: "center" } })
    )
  })

  it("handles applications without resources, a description or a version", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue({
      ...details,
      description: null,
      version_number: null,
      resources: [],
    })
    show()
    expect(
      await screen.findByText("此应用未配置或声明任何资源。")
    ).toBeVisible()
    expect(screen.getByText(i18n.t("applications.noDescription"))).toBeVisible()
    expect(screen.queryByText("版本")).not.toBeInTheDocument()
    expect(screen.queryByText("v1.2.0")).not.toBeInTheDocument()
  })

  it("keeps a standard application's disabled status and fixed model visible in the simplified overview", async () => {
    await i18n.changeLanguage("zh-CN")
    vi.mocked(apiRequest).mockResolvedValue({
      ...details,
      kind: "standard",
      status: "disabled",
      model: "test-model",
      version_number: null,
    })
    show()
    expect(await screen.findByText("普通应用")).toBeVisible()
    expect(
      screen.getByText(i18n.t("applications.status.disabled"))
    ).toBeVisible()
    const info = screen.getByRole("region", { name: "基本信息" })
    expect(info).toHaveTextContent("test-model")
    expect(
      screen.queryByText(i18n.t("applications.userSelectedModel"))
    ).not.toBeInTheDocument()
  })

  it("shows loading then an error and supports retry without presenting stale details", async () => {
    await i18n.changeLanguage("zh-CN")
    let reject: (reason: Error) => void = () => {}
    vi.mocked(apiRequest).mockReturnValueOnce(
      new Promise<ApplicationDetails>((_resolve, rejectPromise) => {
        reject = rejectPromise
      })
    )
    show()
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true")
    reject(new Error("Network unavailable"))
    const retry = await screen.findByRole("button", {
      name: i18n.t("common.retry"),
    })
    expect(screen.queryByText("Office plugin")).not.toBeInTheDocument()
    vi.mocked(apiRequest).mockResolvedValueOnce(details)
    await userEvent.click(retry)
    await waitFor(() => expect(screen.getByText("Office plugin")).toBeVisible())
  })
})
