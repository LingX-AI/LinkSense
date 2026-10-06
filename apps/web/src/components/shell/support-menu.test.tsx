import { StrictMode, useState } from "react"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { notify } from "@/components/feedback/notification"
import {
  FeedbackDialog,
  SupportMenuItems,
} from "@/components/shell/support-menu"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import i18n from "@/i18n"

describe("support menu", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("offers feedback and the existing contextual help page", async () => {
    const interaction = userEvent.setup()
    renderSupportMenu()

    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))

    expect(await screen.findByRole("menuitem", { name: "反馈" })).toBeVisible()
    expect(screen.getByRole("menu")).toHaveAttribute("data-side", "top")
    expect(screen.getByRole("menu")).toHaveAttribute("data-align", "start")
    const helpLink = screen.getByRole("menuitem", {
      name: "在新标签页打开帮助中心",
    })
    expect(helpLink).toHaveTextContent("使用帮助")
    expect(helpLink).toHaveAttribute(
      "href",
      "/help/user-guide/tasks/create-and-run/"
    )
    expect(helpLink).toHaveAttribute("target", "_blank")
    expect(helpLink).toHaveAttribute("rel", "noreferrer noopener")
  })

  it.each([
    ["zh-CN", "使用帮助", "反馈"],
    ["en-US", "User guide", "Feedback"],
    ["es-ES", "Guía de uso", "Comentarios"],
    ["pt-BR", "Guia de uso", "Feedback"],
    ["fr-FR", "Guide d’utilisation", "Donner un avis"],
    ["ja-JP", "使い方ガイド", "フィードバック"],
  ])(
    "localizes both support actions and contextual help in %s",
    async (locale, help, feedback) => {
      await i18n.changeLanguage(locale)
      const interaction = userEvent.setup()
      renderSupportMenu("/knowledge-bases?tab=sites")

      await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
      const menu = await screen.findByRole("menu")
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent)
      ).toEqual([help, feedback])
      expect(
        within(menu).getByRole("menuitem", {
          name: i18n.t("nav.helpCenterNewTab"),
        })
      ).toHaveAttribute(
        "href",
        `/help/${locale === "zh-CN" ? "" : "en-US/"}user-guide/tasks/publish-websites/`
      )
    }
  )

  it("keeps feedback submission actions and heading outside the scrolling fields", async () => {
    const interaction = userEvent.setup()
    renderSupportMenu()
    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )
    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    const body = within(dialog)
      .getByRole("textbox", { name: "反馈内容" })
      .closest<HTMLDivElement>('[data-slot="feedback-dialog-body"]')
    expect(dialog).toHaveClass(
      "flex",
      "flex-col",
      "overflow-hidden",
      "max-h-[calc(100dvh-2rem)]"
    )
    expect(body).toHaveClass("min-h-0", "overflow-y-auto")
    expect(body).not.toContainElement(
      within(dialog).getByRole("heading", { name: "提交反馈" })
    )
    const submit = within(dialog).getByRole("button", { name: "提交" })
    expect(submit.closest('[data-slot="dialog-footer"]')).toHaveClass(
      "shrink-0"
    )
    expect(body).not.toContainElement(submit)
    expect(submit.closest("form")).toContainElement(body)
  })

  it("submits text and selected images through the feedback API", async () => {
    const interaction = userEvent.setup()
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "10000000-0000-4000-8000-000000000010",
              created_at: "2026-08-03T05:06:07.000Z",
              image_count: 1,
            },
          }),
          { status: 201, headers: { "content-type": "application/json" } }
        )
    )
    const successNotification = vi
      .spyOn(notify, "success")
      .mockImplementation(() => "support-feedback-submitted")
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:feedback-image")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    renderSupportMenu()

    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )

    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    const feedbackInput = within(dialog).getByRole("textbox", {
      name: "反馈内容",
    })
    expect(feedbackInput).toHaveAttribute(
      "placeholder",
      "描述你的反馈，或直接粘贴文本及图片…"
    )
    const submitButton = within(dialog).getByRole("button", { name: "提交" })
    expect(submitButton).toBeDisabled()

    await interaction.type(feedbackInput, "希望增加更多快捷键。")
    const firstImage = new File(["image-one"], "one.png", {
      type: "image/png",
    })
    const secondImage = new File(["image-two"], "two.png", {
      type: "image/png",
    })
    await interaction.upload(within(dialog).getByLabelText("图片"), [
      firstImage,
      secondImage,
    ])
    const firstImagePreview = within(dialog).getByAltText("one.png")
    expect(firstImagePreview).toBeVisible()
    expect(firstImagePreview.closest("li")).toHaveClass("border-divider")
    expect(within(dialog).getByAltText("two.png")).toBeVisible()
    await interaction.click(
      within(dialog).getByRole("button", { name: "移除图片 two.png" })
    )
    expect(submitButton).toBeEnabled()
    await interaction.click(submitButton)

    expect(
      screen.queryByRole("dialog", { name: "提交反馈" })
    ).not.toBeInTheDocument()
    expect(successNotification).toHaveBeenCalledWith("感谢你的反馈。", {
      id: "support-feedback-submitted",
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body
    expect(requestBody).toBeInstanceOf(FormData)
    expect((requestBody as FormData).get("content")).toBe(
      "希望增加更多快捷键。"
    )
    expect((requestBody as FormData).getAll("images")).toEqual([firstImage])
  })

  it("adds a clipboard image to the feedback image list", async () => {
    const interaction = userEvent.setup()
    vi.spyOn(URL, "createObjectURL").mockReturnValue(
      "blob:pasted-feedback-image"
    )
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    renderSupportMenu()
    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )

    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    const feedbackInput = within(dialog).getByRole("textbox", {
      name: "反馈内容",
    })
    const pastedImage = new File(["clipboard-image"], "screenshot.png", {
      type: "image/png",
    })

    const pasteAllowed = fireEvent.paste(feedbackInput, {
      clipboardData: {
        items: [
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => pastedImage,
          },
        ],
        files: [pastedImage],
      },
    })

    expect(pasteAllowed).toBe(false)
    expect(await within(dialog).findByAltText("screenshot.png")).toBeVisible()
    expect(
      within(dialog).getByRole("button", {
        name: "移除图片 screenshot.png",
      })
    ).toBeEnabled()
  })

  it("leaves ordinary text paste to the textarea", async () => {
    const interaction = userEvent.setup()

    renderSupportMenu()
    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )

    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    const feedbackInput = within(dialog).getByRole("textbox", {
      name: "反馈内容",
    })
    const pasteAllowed = fireEvent.paste(feedbackInput, {
      clipboardData: {
        items: [{ kind: "string", type: "text/plain" }],
        files: [],
      },
    })

    expect(pasteAllowed).toBe(true)
    expect(
      within(dialog).queryByRole("list", { name: "已选择的反馈图片" })
    ).not.toBeInTheDocument()
  })

  it("keeps mixed clipboard text paste while adding its image", async () => {
    const interaction = userEvent.setup()
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mixed-paste-image")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)

    renderSupportMenu()
    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )

    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    const feedbackInput = within(dialog).getByRole("textbox", {
      name: "反馈内容",
    })
    const pastedImage = new File(["mixed-image"], "mixed.png", {
      type: "image/png",
    })
    const pasteAllowed = fireEvent.paste(feedbackInput, {
      clipboardData: {
        items: [
          { kind: "string", type: "text/plain" },
          {
            kind: "file",
            type: "image/png",
            getAsFile: () => pastedImage,
          },
        ],
        files: [pastedImage],
      },
    })

    expect(pasteAllowed).toBe(true)
    expect(await within(dialog).findByAltText("mixed.png")).toBeVisible()
  })

  it("keeps the active image preview URL valid after Strict Mode remounts effects", async () => {
    const interaction = userEvent.setup()
    let nextObjectUrl = 0
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockImplementation(() => `blob:feedback-image-${++nextObjectUrl}`)
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined)

    renderSupportMenu()
    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )
    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    await interaction.upload(
      within(dialog).getByLabelText("图片"),
      new File(["image"], "preview.png", { type: "image/png" })
    )

    const preview = await within(dialog).findByAltText("preview.png")
    const activeSource = preview.getAttribute("src")
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(activeSource).toBe("blob:feedback-image-2")
    expect(revokeObjectURL).not.toHaveBeenCalledWith(activeSource)
  })

  it("preserves the feedback draft when the API submission fails", async () => {
    const interaction = userEvent.setup()
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error_code: "FEEDBACK_SUBMISSION_FAILED",
              message_key: "errors.feedback.submissionFailed",
              message: "反馈暂时无法提交，请稍后重试。",
            }),
            { status: 503, headers: { "content-type": "application/json" } }
          )
      )
    )
    renderSupportMenu()

    await interaction.click(screen.getByRole("button", { name: "账户菜单" }))
    await interaction.click(
      await screen.findByRole("menuitem", { name: "反馈" })
    )
    const dialog = await screen.findByRole("dialog", { name: "提交反馈" })
    const feedbackInput = within(dialog).getByRole("textbox", {
      name: "反馈内容",
    })
    await interaction.type(feedbackInput, "请保留这段反馈")
    await interaction.click(
      within(dialog).getByRole("button", { name: "提交" })
    )

    expect(
      await within(dialog).findByText("反馈暂时无法提交，请稍后重试。")
    ).toBeVisible()
    expect(feedbackInput).toHaveValue("请保留这段反馈")
  })
})

function SupportMenuTestHarness() {
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button />}>账户菜单</DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <DropdownMenuGroup>
            <SupportMenuItems onFeedback={() => setFeedbackOpen(true)} />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  )
}

function renderSupportMenu(pathname = "/conversations/task-1") {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={[pathname]}>
        <QueryClientProvider client={queryClient}>
          <SupportMenuTestHarness />
        </QueryClientProvider>
      </MemoryRouter>
    </StrictMode>
  )
}
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
