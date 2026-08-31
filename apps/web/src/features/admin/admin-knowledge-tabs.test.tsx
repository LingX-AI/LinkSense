import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MemoryRouter, Route, Routes } from "react-router-dom"

import { AdminKnowledgeTabs } from "@/features/admin/admin-knowledge-tabs"
import i18n from "@/i18n"

describe("AdminKnowledgeTabs", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => cleanup())

  it("navigates between the knowledge base and source routes", async () => {
    const interaction = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/admin/knowledge-sources"]}>
        <Routes>
          <Route
            path="/admin/knowledge-sources"
            element={
              <AdminKnowledgeTabs value="sources">
                <span>数据源内容</span>
              </AdminKnowledgeTabs>
            }
          />
          <Route
            path="/admin/knowledge-bases"
            element={<span>知识库内容</span>}
          />
        </Routes>
      </MemoryRouter>
    )

    expect(screen.getByText("数据源内容")).toBeVisible()
    await interaction.click(screen.getByRole("tab", { name: "知识库" }))
    expect(await screen.findByText("知识库内容")).toBeVisible()
  })
})
