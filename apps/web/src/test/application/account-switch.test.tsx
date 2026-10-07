import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, useLocation } from "react-router-dom"
import { describe, expect, it } from "vitest"

import App from "@/App"
import { AppProviders } from "@/app/providers"
import {
  conversation,
  installApiMock,
  json,
  setupApplicationTests,
  user,
} from "./fixture"

const applicationId = "20000000-0000-4000-8000-000000000001"
const packageId = "40000000-0000-4000-8000-000000000001"
const application = {
  id: applicationId,
  owner: { id: "10000000-0000-4000-8000-000000000001", name: user.name },
  name: "账号隔离测试应用",
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
  capability_count: 0,
  knowledge_base_count: 0,
  mcp_server_count: 0,
  dependencies_available: true,
  capabilities: [],
  knowledge_bases: [],
  mcp_servers: [],
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T00:00:00.000Z",
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="current-path">{location.pathname}</output>
}

describe("account switching", () => {
  setupApplicationTests()

  it.each(["/conversations/c1", `/applications/${applicationId}/run/c1`])(
    "opens a new task after signing out from %s and signing in as another user",
    async (path) => {
      const currentUser = { ...user }
      const { requests, fetchMock } = installApiMock({
        userOverride: currentUser,
        conversationGetResponse: async () =>
          currentUser.id === user.id
            ? json({
                success: true,
                data: {
                  ...conversation,
                  ...(path.startsWith("/applications/")
                    ? {
                        application: {
                          id: applicationId,
                          name: application.name,
                          kind: "interactive",
                          package_id: packageId,
                        },
                      }
                    : {}),
                },
              })
            : json(
                { success: false, error_code: "CONVERSATION_NOT_FOUND" },
                404
              ),
        conversationListResponse: () =>
          json({ success: true, data: { items: [], next_cursor: null } }),
      })
      const baseFetch = fetchMock.getMockImplementation()!
      let deniedApplicationRequests = 0
      fetchMock.mockImplementation(async (input, init) => {
        const url = new URL(String(input), window.location.origin)
        if (url.pathname.startsWith(`/api/v1/applications/${applicationId}`)) {
          if (currentUser.id !== user.id) {
            deniedApplicationRequests += 1
            return json(
              { success: false, error_code: "APPLICATION_NOT_FOUND" },
              404
            )
          }
          return json({
            success: true,
            data: url.pathname.endsWith("/interactive-runtime-token")
              ? {
                  runtime_url:
                    "/api/v1/interactive-app-runtime/first-account/index.html",
                  expires_at: "2099-01-01T00:00:00.000Z",
                  manifest: {
                    schema_version: 1,
                    id: "account-switch",
                    name: application.name,
                    version: "1.0.0",
                    sdk_version: 1,
                  },
                }
              : application,
          })
        }
        return baseFetch(input, init)
      })
      const interaction = userEvent.setup()
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppProviders>
            <App />
            <LocationProbe />
          </AppProviders>
        </MemoryRouter>
      )

      if (path.startsWith("/applications/")) {
        expect(await screen.findByTitle(application.name)).toHaveAttribute(
          "src",
          "/api/v1/interactive-app-runtime/first-account/index.html"
        )
      }
      await interaction.click(
        await screen.findByRole("button", { name: user.name })
      )
      await interaction.click(
        within(await screen.findByRole("menu")).getByRole("menuitem", {
          name: "退出登录",
        })
      )
      await interaction.click(
        within(
          await screen.findByRole("dialog", { name: "退出登录？" })
        ).getByRole("button", { name: "退出登录" })
      )
      await screen.findByRole("heading", { name: "登录 LinkSense" })
      currentUser.id = "user-2"
      currentUser.name = "新账号"
      currentUser.email = "second@example.test"
      const requestCountBeforeLogin = requests.length

      await interaction.type(
        screen.getByRole("textbox", { name: "邮箱" }),
        currentUser.email
      )
      await interaction.type(
        screen.getByLabelText(/^密码\s*\*?$/u),
        "Password1!"
      )
      await interaction.click(screen.getByRole("button", { name: "登录" }))

      await screen.findByRole("button", { name: currentUser.name })
      await waitFor(() =>
        expect(screen.getByTestId("current-path")).toHaveTextContent(
          /^\/conversations\/new$/
        )
      )
      expect(
        requests
          .slice(requestCountBeforeLogin)
          .some((request) =>
            request.path.startsWith("/api/v1/conversations/c1")
          )
      ).toBe(false)
      expect(deniedApplicationRequests).toBe(0)
      expect(screen.queryByTitle(application.name)).not.toBeInTheDocument()
    }
  )
})
