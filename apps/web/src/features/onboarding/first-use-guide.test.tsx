import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ModelPreference } from "@linksense/shared"
import i18n, { supportedLanguages } from "@/i18n"
import { FirstUseGuide } from "./first-use-guide"
import { onboardingMessages } from "./messages"

const preference: ModelPreference = {
  configured: true,
  default_model: "model",
  selected_model: "model",
  selected_reasoning_effort: "low",
  models: [
    {
      id: "model",
      display_name: "Model",
      enabled: true,
      context_window: null,
      supported_reasoning_efforts: ["low"],
      default_reasoning_effort: "low",
    },
  ],
}
const defaults = {
  userId: "user-a",
  isAdmin: true,
  preference: { ...preference, configured: false },
  loading: false,
  failed: false,
  onRetry: vi.fn(),
}

beforeEach(async () => {
  window.localStorage.clear()
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("first use guide", () => {
  it("guides unconfigured administrators and hides the guide for members", () => {
    const view = render(
      <MemoryRouter>
        <FirstUseGuide {...defaults} />
      </MemoryRouter>
    )
    expect(screen.getByRole("link", { name: "配置模型" })).toHaveAttribute(
      "href",
      "/admin/models"
    )
    view.rerender(
      <MemoryRouter>
        <FirstUseGuide {...defaults} isAdmin={false} />
      </MemoryRouter>
    )
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
    expect(screen.queryByText("开始使用")).not.toBeInTheDocument()
  })

  it("hides onboarding while checking model setup and retries failed requests", async () => {
    const onRetry = vi.fn()
    const view = render(
      <FirstUseGuide {...defaults} loading onRetry={onRetry} />
    )
    expect(screen.queryByText("开始使用")).not.toBeInTheDocument()
    view.rerender(<FirstUseGuide {...defaults} failed onRetry={onRetry} />)
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }))
    expect(onRetry).toHaveBeenCalledOnce()
    view.rerender(
      <MemoryRouter>
        <FirstUseGuide
          {...defaults}
          preference={{ ...preference, configured: false }}
        />
      </MemoryRouter>
    )
    expect(screen.getByText("需要配置模型")).toBeVisible()
  })

  it.each([false, true])(
    "hides an already configured guide even when force is %s",
    (force) => {
      render(
        <FirstUseGuide {...defaults} preference={preference} force={force} />
      )
      expect(screen.queryByText("开始使用")).not.toBeInTheDocument()
    }
  )

  it("hides the guide immediately when model configuration completes", () => {
    const view = render(
      <MemoryRouter>
        <FirstUseGuide {...defaults} />
      </MemoryRouter>
    )
    expect(screen.getByRole("link", { name: "配置模型" })).toBeVisible()
    view.rerender(
      <MemoryRouter>
        <FirstUseGuide {...defaults} preference={preference} />
      </MemoryRouter>
    )
    expect(screen.queryByText("开始使用")).not.toBeInTheDocument()
  })

  it("persists dismissal per account and allows explicitly reopening", async () => {
    const view = render(
      <MemoryRouter>
        <FirstUseGuide {...defaults} />
      </MemoryRouter>
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "关闭引导" }))
    view.unmount()
    const reopened = render(
      <MemoryRouter>
        <FirstUseGuide {...defaults} />
      </MemoryRouter>
    )
    expect(screen.queryByText("开始使用")).not.toBeInTheDocument()
    reopened.rerender(
      <MemoryRouter>
        <FirstUseGuide key="other-account" {...defaults} userId="user-b" />
      </MemoryRouter>
    )
    expect(screen.getByText("开始使用")).toBeVisible()
    reopened.rerender(
      <MemoryRouter>
        <FirstUseGuide key="forced" {...defaults} force />
      </MemoryRouter>
    )
    expect(screen.getByText("开始使用")).toBeVisible()
  })

  it("works when browser storage is unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    render(
      <MemoryRouter>
        <FirstUseGuide {...defaults} />
      </MemoryRouter>
    )
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "关闭引导" }))
    expect(screen.queryByText("开始使用")).not.toBeInTheDocument()
  })

  it.each(supportedLanguages)(
    "covers the complete guide in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      expect(Object.keys(onboardingMessages[locale])).toEqual(
        Object.keys(onboardingMessages["zh-CN"])
      )
      for (const [key, message] of Object.entries(onboardingMessages[locale])) {
        expect(message.trim()).not.toBe("")
        expect(i18n.t(`onboarding.${key}`)).toBe(message)
      }
      render(
        <MemoryRouter>
          <FirstUseGuide {...defaults} />
        </MemoryRouter>
      )
      expect(
        screen.getByText(onboardingMessages[locale].modelNeeded)
      ).toBeVisible()
    }
  )
})
