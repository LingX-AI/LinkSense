import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createInstance } from "i18next"
import { webSiteSchema } from "@linksense/shared"
import i18n from "@/i18n"
import { notify } from "@/components/feedback/notification"
import { OfficePreviewShell } from "@/components/media/office-preview/office-preview-shell"
import { SiteLibrary } from "./site-library"
import { SiteDialog } from "./site-dialog"
import { SiteShareButton } from "./site-share-button"
import { webSitesEnUS, webSitesZhCN } from "./messages"

const id = "10000000-0000-4000-8000-000000000001"
const fileId = "20000000-0000-4000-8000-000000000001"
const site = webSiteSchema.parse({
  id,
  name: "山海集",
  description: "杂志",
  slug: "shanhai",
  status: "published",
  url_path: "/web/shanhai",
  conversation_id: id,
  source_task_title: "制作杂志",
  source_file_id: fileId,
  release_id: id,
  file_count: 3,
  size_bytes: 12000,
  published_at: "2026-09-17T09:00:00.000Z",
  created_at: "2026-09-17T09:00:00.000Z",
  updated_at: "2026-09-17T09:00:00.000Z",
})
const clients: QueryClient[] = []
function mount(element: React.ReactNode, url = "/knowledge-bases?tab=sites") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>{element}</MemoryRouter>
    </QueryClientProvider>
  )
}
function success(data: unknown) {
  return Response.json({ success: true, data })
}
async function choosePublishMode(mode: "newSite" | "updateExisting") {
  await userEvent.click(
    screen.getByRole("radio", { name: i18n.t(`webSites.${mode}`) })
  )
}
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("website management", () => {
  it.each(["zh-CN", "en-US"])(
    "places copy beside each card's URL and shows a temporary check without a success toast in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const secondSite = {
        ...site,
        id: fileId,
        name: "第二个站点",
        slug: "second",
        url_path: "/web/second",
      }
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          success({ items: [site, secondSite], next_cursor: null })
        )
      )
      userEvent.setup()
      const writeText = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue(undefined)
      const successToast = vi.spyOn(notify, "success")
      mount(<SiteLibrary />)
      const copy = await screen.findByRole("button", {
        name: i18n.t("webSites.copyNamed", { name: site.name }),
      })
      const otherCopy = screen.getByRole("button", {
        name: i18n.t("webSites.copyNamed", { name: secondSite.name }),
      })
      const url = new URL(site.url_path, window.location.origin).href
      expect(copy.parentElement).toContainElement(screen.getByText(url))
      expect(copy).toHaveClass("size-6", "text-muted-foreground/70")
      const cards = screen.getAllByRole("listitem")
      expect(cards).toHaveLength(2)
      for (const card of cards) {
        expect(card.querySelector('[data-slot="card"]')).toHaveClass(
          "rounded-card",
          "border-[color:var(--app-border)]"
        )
      }
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      await act(async () => {
        fireEvent.click(copy)
      })
      expect(writeText).toHaveBeenCalledExactlyOnceWith(url)
      expect(copy).toHaveAttribute("data-copy-state", "copied")
      expect(copy).toHaveAccessibleName(i18n.t("webSites.copied"))
      expect(copy.querySelector(".lucide-check")).not.toBeNull()
      expect(otherCopy).toHaveAttribute("data-copy-state", "idle")
      expect(successToast).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(copy).toHaveAttribute("data-copy-state", "idle")
      expect(copy.querySelector(".lucide-copy")).not.toBeNull()
    }
  )
  it("disables copy while pending and allows retry after a clipboard failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => success({ items: [site], next_cursor: null }))
    )
    const user = userEvent.setup()
    let rejectCopy: ((error: Error) => void) | undefined
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectCopy = reject
          })
      )
      .mockResolvedValue(undefined)
    const errorToast = vi.spyOn(notify, "error").mockReturnValue("copy-error")
    const successToast = vi.spyOn(notify, "success")
    mount(<SiteLibrary />)
    const copy = await screen.findByRole("button", {
      name: "复制 山海集 的链接",
    })
    await user.click(copy)
    expect(copy).toBeDisabled()
    expect(copy).toHaveAttribute("aria-busy", "true")
    await user.click(copy)
    expect(writeText).toHaveBeenCalledOnce()
    await act(async () => {
      rejectCopy?.(new Error("permission denied"))
    })
    expect(copy).toBeEnabled()
    expect(copy).toHaveAttribute("data-copy-state", "idle")
    expect(errorToast).toHaveBeenCalledWith(i18n.t("webSites.copyFailed"))
    await user.click(copy)
    expect(copy).toHaveAttribute("data-copy-state", "copied")
    expect(successToast).not.toHaveBeenCalled()
  })
  it("renders its empty state and sends search/status filters", async () => {
    const fetch = vi.fn(async () => success({ items: [], next_cursor: null }))
    vi.stubGlobal("fetch", fetch)
    mount(<SiteLibrary />)
    expect(await screen.findByText("还没有发布的站点")).toBeVisible()
    expect(
      screen
        .getByRole("combobox", { name: "发布状态" })
        .querySelector(".lucide-globe")
    ).not.toBeNull()
    await userEvent.type(
      screen.getByRole("textbox", { name: "搜索站点名称或链接" }),
      "journal"
    )
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("search=journal"),
        expect.anything()
      )
    )
    await userEvent.click(screen.getByRole("combobox", { name: "发布状态" }))
    await userEvent.click(await screen.findByRole("option", { name: "未发布" }))
    await waitFor(() =>
      expect(fetch).toHaveBeenLastCalledWith(
        expect.stringContaining("status=disabled"),
        expect.anything()
      )
    )
  })
  it("shows an error and supports retry", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(success({ items: [], next_cursor: null }))
    vi.stubGlobal("fetch", fetch)
    mount(<SiteLibrary />)
    await userEvent.click(await screen.findByRole("button", { name: "重试" }))
    expect(await screen.findByText("还没有发布的站点")).toBeVisible()
  })
  it("stops sharing and restores it through the same management record", async () => {
    let current = site
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "PATCH") {
        const body = JSON.parse(String(options.body))
        current = { ...current, status: body.status }
        return success(current)
      }
      return success({ items: [current], next_cursor: null })
    })
    vi.stubGlobal("fetch", fetch)
    mount(<SiteLibrary />)
    expect(await screen.findByRole("link", { name: "访问" })).toHaveAttribute(
      "href",
      "/web/shanhai"
    )
    await userEvent.click(screen.getByRole("button", { name: "管理 山海集" }))
    expect(
      await screen.findByRole("menuitem", { name: /^编辑$/ })
    ).toBeVisible()
    expect(
      screen.getByRole("menuitem", { name: "取消发布" }).querySelector("svg")
    ).toHaveAttribute("aria-hidden", "true")
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "取消发布" })
    )
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: "访问" })
      ).not.toBeInTheDocument()
    )
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/web-sites/${id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "disabled" }),
      })
    )
    await userEvent.click(screen.getByRole("button", { name: "管理 山海集" }))
    expect(
      (await screen.findByRole("menuitem", { name: "重新发布" })).querySelector(
        "svg"
      )
    ).toHaveAttribute("aria-hidden", "true")
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "重新发布" })
    )
    expect(await screen.findByRole("link", { name: "访问" })).toBeVisible()
  })
  it("validates custom slugs and creates a site with automatic UUID selection when left blank", async () => {
    const fetch = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? success(site)
        : success({ items: [], next_cursor: null })
    )
    vi.stubGlobal("fetch", fetch)
    mount(
      <SiteDialog
        action={{
          kind: "share",
          source: { conversationId: id, fileId, name: "index.html" },
        }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByRole("dialog", { name: "发布为站点" })).toHaveClass(
      "max-w-lg",
      "sm:max-w-lg",
      "w-[calc(100vw_-_2rem)]"
    )
    expect(screen.getByRole("button", { name: "发布站点" })).toBeEnabled()
    expect(
      screen.getByRole("radiogroup", { name: "发布方式" })
    ).toHaveAttribute("data-slot", "radio-group")
    expect(
      screen.queryByRole("combobox", { name: "发布方式" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "新建站点" })).toBeChecked()
    await userEvent.type(
      screen.getByRole("textbox", { name: "链接名称" }),
      "../bad"
    )
    expect(screen.getByRole("button", { name: "发布站点" })).toBeDisabled()
    await userEvent.clear(screen.getByRole("textbox", { name: "链接名称" }))
    await userEvent.click(screen.getByRole("button", { name: "发布站点" }))
    expect(
      await screen.findByRole("heading", { name: "站点已发布" })
    ).toBeVisible()
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/web-sites",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          conversation_id: id,
          file_id: fileId,
          name: "index",
          description: "",
        }),
      })
    )
    expect(screen.getByRole("textbox", { name: "站点链接" })).toHaveValue(
      "http://localhost/web/shanhai"
    )
  })
  it("provides a localized close control while keeping the hero decoration out of the accessible content", async () => {
    await i18n.changeLanguage("en-US")
    const close = vi.fn()
    const view = mount(
      <SiteDialog action={{ kind: "edit", site }} onClose={close} />
    )
    expect(screen.getByRole("dialog", { name: "Edit site" })).toBeVisible()
    expect(
      view.container.ownerDocument.querySelector(
        '[data-slot="site-dialog-hero"]'
      )
    ).toHaveAttribute("aria-hidden", "true")
    await userEvent.click(screen.getByRole("button", { name: "Close" }))
    expect(close).toHaveBeenCalledOnce()
  })
  it("keeps editing open when a slug is taken, and warns that the old address will stop working", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { success: false, error_code: "WEB_SITE_SLUG_TAKEN" },
          { status: 409 }
        )
      )
    )
    const close = vi.fn()
    mount(<SiteDialog action={{ kind: "edit", site }} onClose={close} />)
    await userEvent.type(
      screen.getByRole("textbox", { name: "链接名称" }),
      "-changed"
    )
    expect(screen.getByText("修改后，原来的站点链接将立即失效。")).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.webSites.slugTaken")
    )
    expect(close).not.toHaveBeenCalled()
  })
  it.each(["published", "disabled"] as const)(
    "distinguishes source versions and keeps the address and %s state when publishing an update",
    async (status) => {
      const nextFileId = "20000000-0000-4000-8000-000000000002"
      const fetch = vi.fn(async (_url: string, options?: RequestInit) =>
        options?.method === "POST"
          ? success({ ...site, status, source_file_id: nextFileId })
          : success([
              {
                id: nextFileId,
                filename: "index.html",
                created_at: "2026-09-17T10:00:00.000Z",
              },
              {
                id: fileId,
                filename: "index.html",
                created_at: "2026-09-17T09:00:00.000Z",
              },
            ])
      )
      vi.stubGlobal("fetch", fetch)
      mount(
        <SiteDialog
          action={{ kind: "publish", site: { ...site, status } }}
          onClose={vi.fn()}
        />
      )
      expect(screen.getByRole("button", { name: "更新站点" })).toBeDisabled()
      await userEvent.click(await screen.findByRole("combobox"))
      const options = await screen.findAllByRole("option")
      expect(options[0]).toHaveTextContent("最新")
      expect(options[1]).toHaveTextContent("当前")
      await userEvent.click(options[0]!)
      await userEvent.click(screen.getByRole("button", { name: "更新站点" }))
      expect(
        await screen.findByRole("textbox", { name: "站点链接" })
      ).toHaveValue("http://localhost/web/shanhai")
      expect(
        screen.getByRole("heading", {
          name: "站点已更新",
        })
      ).toBeVisible()
      if (status === "disabled")
        expect(
          screen.getByText(
            "内容已更新，此站点仍未发布。可在“我的站点”中重新发布。"
          )
        ).toBeVisible()
      expect(fetch).toHaveBeenCalledWith(
        `/api/v1/web-sites/${id}/releases`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ file_id: nextFileId }),
        })
      )
    }
  )
  it.each(["zh-CN", "en-US"])(
    "updates a site from another task without creating a new link in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const sourceTaskId = "10000000-0000-4000-8000-000000000002"
      const incomingFileId = "20000000-0000-4000-8000-000000000002"
      const currentSite = {
        ...site,
        id: fileId,
        name: "当前任务站点",
        conversation_id: sourceTaskId,
        slug: "current",
        url_path: "/web/current",
      }
      const fetch = vi.fn(async (input: string, options?: RequestInit) => {
        if (options?.method === "POST")
          return success({
            ...site,
            conversation_id: sourceTaskId,
            source_file_id: incomingFileId,
          })
        const url = new URL(input, window.location.origin)
        return success({
          items: url.searchParams.has("conversation_id")
            ? [currentSite]
            : [site, currentSite],
          next_cursor: null,
        })
      })
      vi.stubGlobal("fetch", fetch)
      mount(
        <SiteDialog
          action={{
            kind: "share",
            source: {
              conversationId: sourceTaskId,
              fileId: incomingFileId,
              name: "redesigned.html",
            },
          }}
          onClose={vi.fn()}
        />
      )
      expect(
        screen.getByRole("button", { name: i18n.t("webSites.publish") })
      ).toBeEnabled()
      expect(
        screen.getByRole("radio", { name: i18n.t("webSites.newSite") })
      ).toBeChecked()
      await choosePublishMode("updateExisting")
      expect(
        screen.getByRole("button", { name: i18n.t("webSites.updateSite") })
      ).toBeDisabled()
      expect(
        screen.queryByPlaceholderText(i18n.t("webSites.search"))
      ).not.toBeInTheDocument()
      await userEvent.click(
        await screen.findByRole("combobox", {
          name: i18n.t("webSites.existingSite"),
        })
      )
      expect(
        (await screen.findByPlaceholderText(i18n.t("webSites.search"))).closest(
          '[data-slot="combobox-content"]'
        )
      ).not.toBeNull()
      const options = await screen.findAllByRole("option")
      expect(options).toHaveLength(2)
      expect(options[0]).toHaveTextContent(currentSite.name)
      expect(options[1]).toHaveTextContent(site.url_path)
      await userEvent.click(options[1]!)
      expect(
        screen.queryByPlaceholderText(i18n.t("webSites.search"))
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole("textbox", { name: i18n.t("webSites.url") })
      ).toHaveValue("http://localhost/web/shanhai")
      expect(
        screen.queryByRole("textbox", { name: i18n.t("webSites.slug") })
      ).not.toBeInTheDocument()
      await userEvent.click(
        screen.getByRole("button", { name: i18n.t("webSites.updateSite") })
      )
      expect(
        await screen.findByRole("heading", {
          name: i18n.t("webSites.updatedTitle"),
        })
      ).toBeVisible()
      expect(
        screen.getByRole("textbox", { name: i18n.t("webSites.url") })
      ).toHaveValue("http://localhost/web/shanhai")
      expect(
        fetch.mock.calls.filter(([, options]) => options?.method === "POST")
      ).toEqual([
        [
          `/api/v1/web-sites/${id}/releases`,
          expect.objectContaining({
            body: JSON.stringify({ file_id: incomingFileId }),
          }),
        ],
      ])
    }
  )
  it("loads further targets, searches all owned sites, and preserves selection after an update fails", async () => {
    const later = {
      ...site,
      id: fileId,
      name: "旧站点",
      slug: "old-site",
      url_path: "/web/old-site",
    }
    const fetch = vi.fn(async (input: string, options?: RequestInit) => {
      if (options?.method === "POST")
        return Response.json(
          { success: false, error_code: "WEB_SITE_BUNDLE_INVALID" },
          { status: 400 }
        )
      const url = new URL(input, window.location.origin)
      if (url.searchParams.has("conversation_id"))
        return success({ items: [], next_cursor: null })
      if (
        url.searchParams.has("cursor") ||
        url.searchParams.get("search") === "old-site"
      )
        return success({ items: [later], next_cursor: null })
      if (url.searchParams.get("search"))
        return success({ items: [], next_cursor: null })
      return success({
        items: [site],
        next_cursor: `${site.updated_at}|${site.id}`,
      })
    })
    vi.stubGlobal("fetch", fetch)
    const close = vi.fn()
    mount(
      <SiteDialog
        action={{
          kind: "share",
          source: { conversationId: id, fileId, name: "new.html" },
        }}
        onClose={close}
      />
    )
    await choosePublishMode("updateExisting")
    await userEvent.click(screen.getByRole("combobox", { name: "选择站点" }))
    await userEvent.click(
      await screen.findByRole("button", { name: "加载更多" })
    )
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("cursor="),
        expect.anything()
      )
    )
    await userEvent.click(
      await screen.findByRole("option", { name: /旧站点/u })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "选择站点" })
      ).toHaveAttribute("aria-expanded", "false")
    )
    await userEvent.click(screen.getByRole("combobox", { name: "选择站点" }))
    await userEvent.type(
      await screen.findByRole("combobox", { name: "搜索站点名称或链接" }),
      "missing"
    )
    expect(await screen.findByText(i18n.t("webSites.noResults"))).toBeVisible()
    await userEvent.clear(
      screen.getByRole("combobox", { name: "搜索站点名称或链接" })
    )
    await userEvent.type(
      screen.getByRole("combobox", { name: "搜索站点名称或链接" }),
      "old-site"
    )
    expect(screen.getByRole("button", { name: "更新站点" })).toBeDisabled()
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining("search=old-site"),
        expect.anything()
      )
    )
    await userEvent.click(
      await screen.findByRole("option", { name: /旧站点/u })
    )
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "选择站点" })
      ).toHaveAttribute("aria-expanded", "false")
    )
    await userEvent.click(screen.getByRole("combobox", { name: "选择站点" }))
    expect(
      await screen.findByRole("combobox", { name: "搜索站点名称或链接" })
    ).toHaveValue("")
    await userEvent.keyboard("{Escape}")
    expect(screen.getByRole("button", { name: "更新站点" })).toBeEnabled()
    await userEvent.click(screen.getByRole("button", { name: "更新站点" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.webSites.bundleInvalid")
    )
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByRole("textbox", { name: "站点链接" })).toHaveValue(
      "http://localhost/web/old-site"
    )
    expect(screen.getByRole("button", { name: "更新站点" })).toBeEnabled()
  })
  it("does not silently create a new site when target loading fails or the list is empty", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"))
    vi.stubGlobal("fetch", fetch)
    mount(
      <SiteDialog
        action={{
          kind: "share",
          source: { conversationId: id, fileId, name: "new.html" },
        }}
        onClose={vi.fn()}
      />
    )
    await choosePublishMode("updateExisting")
    await userEvent.click(screen.getByRole("combobox", { name: "选择站点" }))
    const retry = await screen.findByRole("button", { name: "重试" })
    expect(screen.getByRole("button", { name: "更新站点" })).toBeDisabled()
    fetch.mockImplementation(async () =>
      success({ items: [], next_cursor: null })
    )
    await userEvent.click(retry)
    expect(
      await screen.findByText(i18n.t("webSites.noUpdateTargets"))
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "更新站点" })).toBeDisabled()
    await userEvent.keyboard("{Escape}")
    await choosePublishMode("newSite")
    expect(screen.getByRole("textbox", { name: "站点名称" })).toHaveValue("new")
    expect(
      screen.queryByRole("textbox", { name: "搜索站点名称或链接" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "发布站点" })).toBeEnabled()
    expect(
      fetch.mock.calls.every(([, options]) => options?.method !== "POST")
    ).toBe(true)
  })
  it("deletes only the site after displaying the task-preservation explanation", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetch)
    const close = vi.fn()
    mount(<SiteDialog action={{ kind: "delete", site }} onClose={close} />)
    expect(
      screen.getByText(
        "站点及发布版本将永久删除，地址可被任何人重新使用。原任务和文件仍会保留。"
      )
    ).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "删除站点" }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(fetch).toHaveBeenCalledWith(
      `/api/v1/web-sites/${id}`,
      expect.objectContaining({ method: "DELETE" })
    )
  })
  it.each(["zh-CN", "en-US"])(
    "keeps the delete dialog compact and left aligned with a readable long site name in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const fetch = vi.fn()
      vi.stubGlobal("fetch", fetch)
      const close = vi.fn()
      const name = "VeryLongSiteNameWithoutSpaces".repeat(6)
      mount(
        <SiteDialog
          action={{ kind: "delete", site: { ...site, name } }}
          onClose={close}
        />
      )
      const title = screen.getByRole("heading", {
        name: i18n.t("webSites.dialog.delete"),
      })
      expect(title.closest('[data-slot="dialog-header"]')).toHaveClass(
        "items-start",
        "text-left"
      )
      expect(title).toHaveClass("text-base")
      expect(screen.getByText(name)).toHaveClass("[overflow-wrap:anywhere]")
      const confirm = screen.getByRole("button", {
        name: i18n.t("webSites.delete"),
      })
      expect(confirm.closest('[data-slot="dialog-footer"]')).toHaveClass(
        "justify-end"
      )
      expect(confirm).toHaveClass("h-8")
      await userEvent.click(
        screen.getByRole("button", { name: i18n.t("webSites.cancel") })
      )
      expect(close).toHaveBeenCalledOnce()
      expect(fetch).not.toHaveBeenCalled()
    }
  )
  it("only exposes sharing for generated HTML artifacts", () => {
    const view = mount(
      <SiteShareButton
        conversationId={id}
        file={{
          id: fileId,
          name: "page.html",
          size: 10,
          download_available: false,
          kind: "attachment",
        }}
      />
    )
    expect(screen.queryByRole("button", { name: "发布为站点" })).toBeNull()
    view.unmount()
    mount(
      <SiteShareButton
        conversationId={id}
        file={{
          id: fileId,
          name: "page.html",
          size: 10,
          download_available: true,
          kind: "artifact",
        }}
      />
    )
    expect(screen.getByRole("button", { name: "发布为站点" })).toBeVisible()
  })
  it("shows the existing site immediately when its original HTML is published, including after reopening", async () => {
    const fetch = vi.fn(async (input: string, options?: RequestInit) => {
      expect(options?.method).toBe("GET")
      expect(
        new URL(input, window.location.origin).searchParams.get(
          "origin_file_id"
        )
      ).toBe(fileId)
      return success({ items: [site], next_cursor: null })
    })
    vi.stubGlobal("fetch", fetch)
    mount(
      <SiteShareButton
        conversationId={id}
        file={{
          id: fileId,
          name: "page.html",
          size: 10,
          download_available: true,
          kind: "artifact",
        }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))
    expect(
      await screen.findByRole("heading", { name: "此网页已有站点" })
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "站点链接" })).toHaveValue(
      "http://localhost/web/shanhai"
    )
    expect(
      screen.queryByRole("button", { name: "发布站点" })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "完成" }))
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))
    expect(
      await screen.findByRole("heading", { name: "此网页已有站点" })
    ).toBeVisible()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it("shows an unpublished linked site and allows updating a different site", async () => {
    const unpublished = { ...site, status: "disabled" }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => success({ items: [unpublished], next_cursor: null }))
    )
    mount(
      <SiteShareButton
        conversationId={id}
        file={{
          id: fileId,
          name: "page.html",
          size: 10,
          download_available: true,
          kind: "artifact",
        }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))
    expect(
      await screen.findByRole("heading", { name: "此站点未发布" })
    ).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "更新其他站点" }))
    expect(screen.getByRole("button", { name: "更新站点" })).toBeDisabled()
    expect(screen.getByRole("combobox", { name: "选择站点" })).toBeVisible()
  })
  it("opens the first-publish form when the HTML has no site", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => success({ items: [], next_cursor: null }))
    )
    mount(
      <SiteShareButton
        conversationId={id}
        file={{
          id: fileId,
          name: "page.html",
          size: 10,
          download_available: true,
          kind: "artifact",
        }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))
    expect(
      await screen.findByRole("button", { name: "发布站点" })
    ).toBeEnabled()
  })
  it("shows the created site's link when the same HTML is opened again after publishing", async () => {
    let published = false
    const fetch = vi.fn(async (_input: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        published = true
        return success(site)
      }
      return success({ items: published ? [site] : [], next_cursor: null })
    })
    vi.stubGlobal("fetch", fetch)
    mount(
      <SiteShareButton
        conversationId={id}
        file={{
          id: fileId,
          name: "page.html",
          size: 10,
          download_available: true,
          kind: "artifact",
        }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))
    await userEvent.click(
      await screen.findByRole("button", { name: "发布站点" })
    )
    expect(
      await screen.findByRole("heading", { name: "站点已发布" })
    ).toBeVisible()
    await userEvent.click(screen.getByRole("button", { name: "完成" }))
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))
    expect(
      await screen.findByRole("heading", { name: "此网页已有站点" })
    ).toBeVisible()
    expect(screen.getByRole("textbox", { name: "站点链接" })).toHaveValue(
      "http://localhost/web/shanhai"
    )
    expect(
      fetch.mock.calls.filter(([, options]) => options?.method === "POST")
    ).toHaveLength(1)
  })
  it("shows a retryable error if the site lookup fails", async () => {
    let attempt = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempt += 1
        if (attempt === 1) throw new Error("offline")
        return success({ items: [site], next_cursor: null })
      })
    )
    mount(
      <SiteShareButton
        conversationId={id}
        file={{
          id: fileId,
          name: "page.html",
          size: 10,
          download_available: true,
          kind: "artifact",
        }}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))
    expect(await screen.findByRole("button", { name: "重试" })).toBeVisible()
    expect(
      screen.queryByRole("button", { name: "发布站点" })
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "重试" }))
    expect(
      await screen.findByRole("heading", { name: "此网页已有站点" })
    ).toBeVisible()
  })
  it("renders the publishing dialog inside an expanded office preview", async () => {
    mount(
      <OfficePreviewShell
        document={{ status: "ready" }}
        fileName="page.html"
        mimeType="text/html"
        controls={
          <SiteShareButton
            conversationId={id}
            file={{
              id: fileId,
              name: "page.html",
              size: 10,
              download_available: true,
              kind: "artifact",
            }}
          />
        }
      >
        <div>preview</div>
      </OfficePreviewShell>
    )
    const preview = screen.getByRole("region", {
      name: "预览文档 page.html",
    })

    await userEvent.click(screen.getByRole("button", { name: "全屏预览文档" }))
    await userEvent.click(screen.getByRole("button", { name: "发布为站点" }))

    const dialog = screen.getByRole("dialog", { name: "发布为站点" })
    expect(preview).toHaveClass("office-preview-pane-expanded")
    expect(preview).toContainElement(
      dialog.closest<HTMLElement>('[data-slot="dialog-portal"]')
    )
  })
  it("keeps Chinese and English keys aligned and supports language fallback", async () => {
    const flatten = (value: object, prefix = ""): string[] =>
      Object.entries(value).flatMap(([key, content]) =>
        typeof content === "string"
          ? [`${prefix}${key}`]
          : flatten(content, `${prefix}${key}.`)
      )
    expect(flatten(webSitesZhCN)).toEqual(flatten(webSitesEnUS))
    const instance = createInstance()
    await instance.init({
      lng: "fr",
      fallbackLng: "zh-CN",
      resources: {
        "zh-CN": { translation: webSitesZhCN },
        "en-US": { translation: webSitesEnUS },
      },
    })
    expect(instance.t("title")).toBe("我的站点")
    await instance.changeLanguage("en-US")
    expect(instance.t("title")).toBe("My sites")
  })
})
