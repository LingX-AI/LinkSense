import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { APPLICATION_DEVELOPMENT_PROJECT_NAME } from "@linksense/shared"
import i18n from "@/i18n"
import { ProjectDialog } from "./project-dialog"
import { saveProject } from "./project-api"

vi.mock("./project-api", () => ({
  saveProject: vi.fn(),
  refreshProjects: vi.fn(),
  deleteProject: vi.fn(),
}))
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("dedicated development project editing", () => {
  it.each([APPLICATION_DEVELOPMENT_PROJECT_NAME, "Work"])(
    "only locks the dedicated project name: %s",
    async (name) => {
      const client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      })
      const project = {
        id: "60000000-0000-4000-8000-000000000001",
        name,
        icon: "folder" as const,
        color: "default" as const,
        created_at: "2026-09-23T00:00:00Z",
        updated_at: "2026-09-23T00:00:00Z",
      }
      render(
        <QueryClientProvider client={client}>
          <ProjectDialog action={{ mode: "edit", project }} onClose={vi.fn()} />
        </QueryClientProvider>
      )
      const input = screen.getByRole("textbox")
      if (name === APPLICATION_DEVELOPMENT_PROJECT_NAME) {
        expect(input).toHaveAttribute("readonly")
        expect(
          screen.getByText("此项目用于集中管理应用开发任务，名称不能更改。")
        ).toBeVisible()
      } else {
        expect(input).not.toHaveAttribute("readonly")
        fireEvent.change(input, { target: { value: "Renamed" } })
      }
      fireEvent.click(screen.getByRole("button", { name: "保存" }))
      await waitFor(() =>
        expect(saveProject).toHaveBeenCalledWith(
          {
            name:
              name === APPLICATION_DEVELOPMENT_PROJECT_NAME ? name : "Renamed",
            icon: "folder",
            color: "default",
          },
          project.id
        )
      )
      client.clear()
    }
  )
})
