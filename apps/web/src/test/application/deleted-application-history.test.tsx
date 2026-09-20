import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  installApiMock,
  json,
  planReviewConversationFixture,
  renderApp,
  setupApplicationTests,
} from "./fixture"

const applicationId = "20000000-0000-4000-8000-000000000001"

describe("deleted application conversation history", () => {
  setupApplicationTests()

  it.each(["standard", "interactive"] as const)(
    "retains messages without execution controls after deleting a %s application",
    async (kind) => {
      const { fetchMock, requests } = installApiMock({
        eventStreamBody: "",
        conversationOverride: {
          ...planReviewConversationFixture(null),
          application: {
            id: applicationId,
            name: "已删除的应用",
            kind,
            package_id:
              kind === "interactive"
                ? "40000000-0000-4000-8000-000000000001"
                : null,
            available: false,
            unavailable_reason: "APPLICATION_DELETED",
          },
        },
      })
      const original = fetchMock.getMockImplementation()!
      fetchMock.mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), window.location.origin).pathname
          if (path.startsWith(`/api/v1/applications/${applicationId}`)) {
            return json(
              { success: false, error_code: "APPLICATION_NOT_FOUND" },
              404
            )
          }
          return original(input, init)
        }
      )

      // Opening an old regular conversation URL must also work after it redirects
      // to the interactive application route.
      renderApp("/conversations/c1")
      expect(await screen.findByText("请先规划完整实现方案")).toBeVisible()
      expect(
        await screen.findByRole("heading", { name: "完整实施计划" })
      ).toBeVisible()
      await waitFor(() =>
        expect(
          screen.queryByTestId("conversation-plan-decision")
        ).not.toBeInTheDocument()
      )
      if (kind === "interactive") {
        const notice = await screen.findByRole("status", {
          name: "此应用已被删除",
        })
        expect(notice).toHaveAttribute("data-slot", "alert")
        expect(notice).toHaveClass(
          "max-w-[var(--app-composer-width)]",
          "rounded-[18px]",
          "border-[color:var(--app-border)]"
        )
        expect(notice.closest(".conversation-bottom-stack")).not.toBeNull()
        expect(
          screen
            .getByRole("heading", { name: "完整实施计划" })
            .closest(".interactive-application-layout")
        ).toBeNull()
      }
      expect(
        screen.queryByRole("textbox", { name: "任务输入框" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "重新生成" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "发送" })
      ).not.toBeInTheDocument()
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            /\/(turns|fork|prewarm)$/u.test(request.path)
        )
      ).toBe(false)
    }
  )
})
