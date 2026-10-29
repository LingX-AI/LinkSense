import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { NewTaskWelcome } from "@/features/conversations/new-task-welcome"
import i18n, { supportedLanguages } from "@/i18n"

afterEach(cleanup)

describe("new task home", () => {
  it.each(supportedLanguages)(
    "keeps all four task prompts usable in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const interaction = userEvent.setup()
      const onSelect = vi.fn()
      render(
        <NewTaskWelcome
          productName="LinkSense"
          userName="Rebecca"
          onSelect={onSelect}
        />
      )

      expect(
        screen.getByRole("heading", {
          name: i18n.t("conversation.newTaskWelcome", {
            productName: "LinkSense",
          }),
        })
      ).toBeVisible()
      expect(
        screen.getByText(
          i18n.t("workspaceHome.greetingName", { name: "Rebecca" })
        )
      ).toBeVisible()
      const group = screen.getByRole("group", {
        name: i18n.t("conversation.starterQuestions.label"),
      })
      expect(within(group).getAllByRole("button")).toHaveLength(4)
      for (const card of within(group).getAllByRole("button")) {
        expect(card).not.toHaveClass("card-spotlight")
        expect(card).toHaveClass("focus-visible:ring-0!")
      }
      expect(onSelect).not.toHaveBeenCalled()
      for (const id of [
        "analyzeFile",
        "searchKnowledge",
        "analyzeData",
        "createDeliverable",
      ]) {
        await interaction.click(
          within(group).getByRole("button", {
            name: new RegExp(
              i18n.t(`conversation.starterQuestions.${id}.title`)
            ),
          })
        )
        expect(onSelect).toHaveBeenLastCalledWith(
          i18n.t(`conversation.starterQuestions.${id}.prompt`)
        )
      }
      expect(onSelect).toHaveBeenCalledTimes(4)
    }
  )

  it("retains first-use guidance and account notices without task suggestions", async () => {
    await i18n.changeLanguage("zh-CN")
    render(
      <NewTaskWelcome
        productName="LinkSense"
        guide={<button type="button">配置模型</button>}
        notice={<p role="alert">额度不足</p>}
      />
    )
    expect(screen.getByText("准备好开始了吗？")).toBeVisible()
    expect(screen.getByRole("button", { name: "配置模型" })).toBeEnabled()
    expect(screen.getByRole("alert")).toHaveTextContent("额度不足")
    expect(screen.queryByRole("group")).not.toBeInTheDocument()
  })
})
