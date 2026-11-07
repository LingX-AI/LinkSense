import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SidebarConversationActions } from "./sidebar-conversation-actions"
import {
  SidebarConversationOverlays,
  SidebarConversationPreviewTrigger,
} from "./sidebar-conversation-overlays"
import i18n from "@/i18n"

beforeEach(async () => {
  await i18n.changeLanguage("en-US")
})
afterEach(cleanup)

describe("shared sidebar conversation overlays", () => {
  it("uses the active task's state and callback when different rows share one menu", async () => {
    const interaction = userEvent.setup()
    const firstPin = vi.fn()
    const secondPin = vi.fn()
    render(
      <SidebarConversationOverlays>
        <SidebarConversationActions
          title="First"
          pinned={false}
          pinDisabled={false}
          archiveDisabled={false}
          onTogglePinned={firstPin}
          onArchive={vi.fn()}
        />
        <SidebarConversationActions
          title="Second"
          pinned
          pinDisabled={false}
          archiveDisabled={false}
          onTogglePinned={secondPin}
          onArchive={vi.fn()}
        />
      </SidebarConversationOverlays>
    )
    await interaction.click(
      screen.getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: "First" }),
      })
    )
    await screen.findByRole("menu")
    expect(screen.getAllByRole("menu")).toHaveLength(1)
    await interaction.click(
      screen.getByRole("menuitem", { name: i18n.t("conversation.pin") })
    )
    expect(firstPin).toHaveBeenCalledOnce()
    expect(secondPin).not.toHaveBeenCalled()

    await interaction.click(
      screen.getByRole("button", {
        name: i18n.t("common.moreActionsNamed", { name: "Second" }),
      })
    )
    await screen.findByRole("menu")
    expect(screen.getAllByRole("menu")).toHaveLength(1)
    await interaction.click(
      screen.getByRole("menuitem", { name: i18n.t("conversation.unpin") })
    )
    expect(firstPin).toHaveBeenCalledOnce()
    expect(secondPin).toHaveBeenCalledOnce()
  })

  it("shows each trigger's title and timestamp without keeping a preview per row", async () => {
    const interaction = userEvent.setup()
    render(
      <SidebarConversationOverlays>
        {["First", "Second"].map((title, index) => (
          <SidebarConversationPreviewTrigger
            key={title}
            preview={{
              title,
              updatedAt: `2026-11-0${index + 1}T00:00:00Z`,
              relativeUpdatedAt: `${index + 1} days ago`,
            }}
            nativeButton={false}
            role="link"
            render={<a href={`#${title}`} />}
          >
            {title}
          </SidebarConversationPreviewTrigger>
        ))}
      </SidebarConversationOverlays>
    )
    await interaction.hover(screen.getByRole("link", { name: "First" }))
    const first = await screen.findByRole("dialog", { name: "First" })
    expect(within(first).getByText("1 days ago")).toHaveAttribute(
      "datetime",
      "2026-11-01T00:00:00Z"
    )
    await interaction.hover(screen.getByRole("link", { name: "Second" }))
    const second = await screen.findByRole("dialog", { name: "Second" })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(within(second).getByText("2 days ago")).toHaveAttribute(
      "datetime",
      "2026-11-02T00:00:00Z"
    )
  })

  it("dismisses a preview when virtualization unmounts its trigger", async () => {
    const interaction = userEvent.setup()
    const view = (visible: boolean) => (
      <SidebarConversationOverlays>
        {visible && (
          <SidebarConversationPreviewTrigger
            preview={{
              title: "Task",
              updatedAt: "2026-11-07T00:00:00Z",
              relativeUpdatedAt: "Today",
            }}
            nativeButton={false}
            role="link"
            render={<a href="#task" />}
          >
            Task
          </SidebarConversationPreviewTrigger>
        )}
      </SidebarConversationOverlays>
    )
    const { rerender } = render(view(true))
    await interaction.hover(screen.getByRole("link", { name: "Task" }))
    await screen.findByRole("dialog", { name: "Task" })
    rerender(view(false))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Task" })
      ).not.toBeInTheDocument()
    )
  })

  it("preserves the active preview when a different virtual row unmounts", async () => {
    const interaction = userEvent.setup()
    const view = (showOther: boolean) => (
      <SidebarConversationOverlays>
        <SidebarConversationPreviewTrigger
          key="active"
          preview={{
            title: "Active",
            updatedAt: "2026-11-07T00:00:00Z",
            relativeUpdatedAt: "Today",
          }}
          nativeButton={false}
          role="link"
          render={<a href="#active" />}
        >
          Active
        </SidebarConversationPreviewTrigger>
        {showOther && (
          <SidebarConversationPreviewTrigger
            key="other"
            preview={{
              title: "Other",
              updatedAt: "2026-11-07T00:00:00Z",
              relativeUpdatedAt: "Today",
            }}
            nativeButton={false}
            role="link"
            render={<a href="#other" />}
          >
            Other
          </SidebarConversationPreviewTrigger>
        )}
      </SidebarConversationOverlays>
    )
    const { rerender } = render(view(true))
    await interaction.hover(screen.getByRole("link", { name: "Active" }))
    await screen.findByRole("dialog", { name: "Active" })
    rerender(view(false))
    expect(screen.getByRole("dialog", { name: "Active" })).toBeVisible()
  })

  it("dismisses the shared archive tooltip when its virtual row unmounts", async () => {
    const interaction = userEvent.setup()
    const view = (visible: boolean) => (
      <SidebarConversationOverlays>
        {visible && (
          <SidebarConversationActions
            title="Task"
            pinned={false}
            pinDisabled={false}
            archiveDisabled={false}
            onTogglePinned={vi.fn()}
            onArchive={vi.fn()}
          />
        )}
      </SidebarConversationOverlays>
    )
    const { rerender } = render(view(true))
    await interaction.hover(
      screen.getByRole("button", {
        name: i18n.t("conversation.archiveNamed", { title: "Task" }),
      })
    )
    await screen.findByRole("tooltip")
    rerender(view(false))
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    )
  })
})
