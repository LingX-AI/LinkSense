import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { bootstrapSchema, userSchema } from "@/api/contracts"
import { AuthContext, type AuthContextValue } from "@/app/auth-state"
import { BootstrapContext } from "@/app/bootstrap-state"
import { ProtectedRoute, PublicAuthRoute } from "@/app/route-guards"
import i18n from "@/i18n"

const applicationPath =
  "/applications/20000000-0000-4000-8000-000000000001/run/30000000-0000-4000-8000-000000000001"
const user = userSchema.parse({
  id: "user-1",
  name: "First user",
  email: "first@example.test",
  role: "user",
  status: "active",
  registration_source: "organization_invitation",
})
const bootstrap = bootstrapSchema.parse({ initialized: true })

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="current-path">{location.pathname}</output>
}

function renderSession(initialStatus: AuthContextValue["status"]) {
  const tree = (status: AuthContextValue["status"], userId = user.id) => (
    <BootstrapContext.Provider
      value={{ bootstrap, isLoading: false, error: null, refetch: vi.fn() }}
    >
      <AuthContext.Provider
        value={{
          status,
          user: status === "authenticated" ? { ...user, id: userId } : null,
          acceptSession: vi.fn(),
          refreshUser: vi.fn(),
          signOut: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={[applicationPath]}>
          <LocationProbe />
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path={applicationPath} element={<p>Interactive app</p>} />
              <Route path="/conversations/new" element={<p>New task</p>} />
            </Route>
            <Route element={<PublicAuthRoute />}>
              <Route path="/login" element={<p>Sign in</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </BootstrapContext.Provider>
  )
  const view = render(tree(initialStatus))
  return (status: AuthContextValue["status"], userId = user.id) =>
    view.rerender(tree(status, userId))
}

describe("account-scoped login destinations", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh-CN")
  })
  afterEach(cleanup)

  it.each([
    { userId: user.id, destination: applicationPath },
    { userId: "user-2", destination: "/conversations/new" },
  ])(
    "restores a task only for its previous account when signing in as $userId",
    async ({ userId, destination }) => {
      const updateSession = renderSession("loading")
      updateSession("authenticated")
      expect(await screen.findByText("Interactive app")).toBeVisible()

      updateSession("anonymous")
      expect(await screen.findByText("Sign in")).toBeVisible()
      updateSession("authenticated", userId)

      await waitFor(() =>
        expect(screen.getByTestId("current-path").textContent).toBe(destination)
      )
    }
  )

  it("preserves a directly opened application link when no previous account viewed it", async () => {
    const updateSession = renderSession("anonymous")
    expect(await screen.findByText("Sign in")).toBeVisible()

    updateSession("authenticated", "user-2")

    expect(await screen.findByText("Interactive app")).toBeVisible()
    expect(screen.getByTestId("current-path").textContent).toBe(applicationPath)
  })
})
