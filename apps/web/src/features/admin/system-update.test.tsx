import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router-dom"

import { SystemUpdateSettings } from "@/features/admin/system-update"
import i18n, { supportedLanguages } from "@/i18n"

const authState = vi.hoisted(() => ({
  user: {
    id: "01900000-0000-7000-8000-000000000099",
    role: "admin",
    status: "active",
  } as { id: string; role: "admin" | "user"; status: "active" },
}))

vi.mock("@/app/auth-state", () => ({
  useAuth: () => authState,
}))

const updateAvailable = {
  status: "update_available",
  current_version: "v0.1.1",
  latest_release: {
    version: "v0.2.0",
    name: "LinkSense v0.2.0",
    published_at: "2026-09-01T08:00:00.000Z",
    url: "https://github.com/LingX-AI/linksense/releases/tag/v0.2.0",
    release_notes: "Administrator update notifications.",
  },
  checked_at: "2026-09-01T09:00:00.000Z",
  error_code: null,
} as const

function envelope(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function renderUpdateUi(component: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe("administrator system updates", () => {
  beforeEach(async () => {
    authState.user = {
      id: "01900000-0000-7000-8000-000000000099",
      role: "admin",
      status: "active",
    }
    window.localStorage.clear()
    await i18n.changeLanguage("zh-CN")
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(supportedLanguages)(
    "renders release notes as GitHub Markdown in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        envelope({
          ...updateAvailable,
          latest_release: {
            ...updateAvailable.latest_release,
            release_notes: [
              "# LinkSense v0.2.0",
              "",
              "## Highlights",
              "",
              "- **Render Markdown** in release notes.",
              "- Keep `existing releases` usable.",
              "",
              "1. Review the release.",
              "2. Install the update.",
              "",
              '[Release page](https://github.com/LingX-AI/linksense/releases/tag/v0.2.0 "GitHub release")',
              "",
              "| Feature | Status |",
              "| --- | --- |",
              "| Release notes | Ready |",
              "",
              "~~~sh",
              "pnpm --filter @linksense/web build",
              "~~~",
              "",
              "> Back up before updating.",
              "",
              "~~Outdated guidance~~",
              "",
              "- [x] Read the release notes.",
            ].join("\n"),
          },
        })
      )

      renderUpdateUi(<SystemUpdateSettings />)

      expect(
        await screen.findByRole("heading", {
          level: 1,
          name: "LinkSense v0.2.0",
        })
      ).toBeVisible()
      const releaseNotes = within(
        await screen.findByRole("article", {
          name: i18n.t("systemUpdate.releaseNotes"),
        })
      )
      expect(
        releaseNotes.getByRole("heading", { level: 2, name: "Highlights" })
      ).toBeVisible()
      expect(releaseNotes.getByText("Render Markdown").tagName).toBe("STRONG")
      expect(releaseNotes.getByText("existing releases").tagName).toBe("CODE")
      expect(
        releaseNotes.getByText("Render Markdown").closest("ul")
      ).not.toBeNull()
      expect(
        releaseNotes.getByText("Install the update.").closest("ol")
      ).not.toBeNull()
      expect(releaseNotes.getByRole("table")).toBeVisible()
      expect(releaseNotes.getByRole("cell", { name: "Ready" })).toBeVisible()
      expect(
        releaseNotes
          .getByText("pnpm --filter @linksense/web build")
          .closest("pre")
      ).not.toBeNull()
      expect(
        releaseNotes.getByText("Back up before updating.").closest("blockquote")
      ).not.toBeNull()
      expect(releaseNotes.getByText("Outdated guidance").tagName).toBe("DEL")
      expect(releaseNotes.getByRole("checkbox")).toBeChecked()
      expect(releaseNotes.getByRole("checkbox")).toBeDisabled()
      const link = releaseNotes.getByRole("link", { name: "Release page" })
      expect(link).toHaveAttribute("href", updateAvailable.latest_release.url)
      expect(link).toHaveAttribute("title", "GitHub release")
      expect(link).toHaveAttribute("target", "_blank")
      expect(link).toHaveAttribute("rel", "noopener noreferrer")
    }
  )

  it("renders safe HTML in release notes and removes scripts and unsafe links", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({
        ...updateAvailable,
        latest_release: {
          ...updateAvailable.latest_release,
          release_notes: [
            '<strong onclick="alert(1)">Useful HTML</strong>',
            "",
            "[Unsafe Markdown](javascript:alert(1))",
            "",
            '<a href="javascript:alert(1)">Unsafe HTML</a>',
            "",
            '<script>alert("release-notes-script")</script>',
            "",
            '<iframe src="https://example.test/embed"></iframe>',
          ].join("\n"),
        },
      })
    )

    renderUpdateUi(<SystemUpdateSettings />)

    const article = await screen.findByRole("article", { name: "发布说明" })
    const releaseNotes = within(article)
    const html = releaseNotes.getByText("Useful HTML")
    expect(html.tagName).toBe("STRONG")
    expect(html).not.toHaveAttribute("onclick")
    expect(releaseNotes.getByText("Unsafe Markdown").closest("a")).toBeNull()
    expect(releaseNotes.getByText("Unsafe HTML").closest("a")).toBeNull()
    expect(article.querySelector("script, iframe")).toBeNull()
    expect(article).not.toHaveTextContent("release-notes-script")
  })

  it.each([null, ""])(
    "hides release notes when their content is %j",
    async (releaseNotes) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        envelope({
          ...updateAvailable,
          latest_release: {
            ...updateAvailable.latest_release,
            release_notes: releaseNotes,
          },
        })
      )

      renderUpdateUi(<SystemUpdateSettings />)

      expect(await screen.findByText("版本状态")).toBeVisible()
      expect(screen.queryByText("发布说明")).not.toBeInTheDocument()
    }
  )

  it("gives the upgrade notice and both platform commands a subtle background", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(envelope(updateAvailable))

    renderUpdateUi(<SystemUpdateSettings />)

    const notice = await screen.findByText("升级不会由网页自动执行")
    expect(notice.closest('[data-slot="alert"]')).toHaveClass("bg-muted/60")
    for (const command of [
      "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh",
      "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sh",
    ]) {
      const code = screen.getByText(command)
      expect(code).toBeVisible()
      expect(code.closest("pre")).toHaveClass("bg-muted/60", "overflow-x-auto")
      expect(code.closest("pre")).not.toHaveClass("bg-background")
    }
  })

  it("shows update guidance for a newer release and hides it after becoming current", async () => {
    const upToDate = {
      ...updateAvailable,
      status: "up_to_date",
      current_version: "v0.2.0",
    } as const
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(envelope(updateAvailable))
      .mockResolvedValueOnce(envelope(upToDate))
    const interaction = userEvent.setup()

    renderUpdateUi(<SystemUpdateSettings />)

    const overview = await screen.findByText("版本状态")
    expect(overview).toBeVisible()
    expect(overview.closest('[data-slot="card"]')).toHaveClass(
      "rounded-card",
      "border"
    )
    expect(overview.closest('[data-slot="card"]')).toHaveAttribute(
      "data-appearance",
      "default"
    )
    const availableBadge = screen.getByText("有新版本")
    expect(availableBadge).toHaveAttribute("data-variant", "success")
    expect(availableBadge).toHaveClass("bg-success", "text-white")
    expect(
      screen.getByText("Administrator update notifications.")
    ).toBeVisible()
    expect(
      screen.getByText(
        "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh"
      )
    ).toBeVisible()

    await interaction.click(screen.getByRole("button", { name: "立即检查" }))

    const currentBadge = await screen.findByText("已是最新版")
    expect(currentBadge).toBeVisible()
    expect(currentBadge).toHaveAttribute("data-variant", "secondary")
    expect(currentBadge).toHaveClass(
      "bg-secondary",
      "text-secondary-foreground"
    )
    expect(currentBadge).not.toHaveClass("bg-success", "text-white")
    await waitFor(() => {
      expect(screen.queryByText("更新教程")).not.toBeInTheDocument()
    })
    expect(
      screen.queryByText(
        "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh"
      )
    ).not.toBeInTheDocument()
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/v1/admin/system-update/check",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("does not show update guidance when the release check fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      envelope({
        status: "check_failed",
        current_version: "v0.1.1",
        latest_release: null,
        checked_at: "2026-09-01T09:00:00.000Z",
        error_code: "GITHUB_UNAVAILABLE",
      })
    )

    renderUpdateUi(<SystemUpdateSettings />)

    expect(await screen.findByText("暂时无法获取最新版本")).toBeVisible()
    expect(screen.queryByText("更新教程")).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        "curl -fsSL https://raw.githubusercontent.com/LingX-AI/linksense/main/upgrade.sh | sudo sh"
      )
    ).not.toBeInTheDocument()
  })
})
