import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ApplicationIcon } from "@linksense/shared"
import i18n from "@/i18n"
import {
  ApplicationMetadataDialog,
  ApplicationMetadataPublishDialog,
} from "./application-metadata-dialog"

import { ApiError, apiRequest } from "@/api/client"
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  apiRequest: vi.fn(),
}))

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  clients.splice(0).forEach((client) => client.clear())
})
function show(
  icon: ApplicationIcon = { type: "preset", preset: "sparkles" },
  save = vi.fn(async () => {})
) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  clients.push(client)
  const close = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <ApplicationMetadataDialog
        initial={{ name: "Original", description: "Description", icon }}
        onSave={save}
        onClose={close}
      />
    </QueryClientProvider>
  )
  return { save, close }
}

describe("application metadata editor", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "edits metadata and a preset with localized labels and fallback in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const f = show()
      const user = userEvent.setup()
      expect(screen.getByRole("dialog")).toHaveAccessibleName(
        i18n.t("applications.editMetadata")
      )
      expect(i18n.t("applications.editMetadata")).not.toBe(
        "applications.editMetadata"
      )
      await user.clear(
        screen.getByRole("textbox", { name: i18n.t("common.name") })
      )
      await user.type(
        screen.getByRole("textbox", { name: i18n.t("common.name") }),
        "Renamed"
      )
      await user.clear(
        screen.getByRole("textbox", { name: i18n.t("common.description") })
      )
      await user.click(
        screen.getByRole("button", {
          name: i18n.t("applications.iconPresets.book-open"),
        })
      )
      await user.click(
        screen.getByRole("button", { name: i18n.t("common.save") })
      )
      await waitFor(() =>
        expect(f.save).toHaveBeenCalledWith({
          name: "Renamed",
          description: null,
          icon: { type: "preset", preset: "book-open" },
        })
      )
      expect(f.close).toHaveBeenCalledOnce()
    }
  )

  it.each(["zh-CN", "en-US", "fr-FR"])(
    "shows saving feedback, preserves the uploaded icon and prevents duplicate saves in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      let finish: () => void = () => {
        throw new Error("not started")
      }
      const save = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      const f = show(
        {
          type: "custom",
          url: "https://icons.example.test/logo.png",
          fallback_preset: "sparkles",
        },
        save
      )
      const button = screen.getByRole("button", { name: i18n.t("common.save") })
      await userEvent.click(button)
      expect(button).toBeDisabled()
      expect(button).toHaveAccessibleName(i18n.t("common.saving"))
      expect(button).toHaveAttribute("aria-busy", "true")
      expect(button.querySelector('[data-slot="spinner"]')).toBeVisible()
      await userEvent.click(button)
      expect(save).toHaveBeenCalledExactlyOnceWith({
        name: "Original",
        description: "Description",
      })
      finish()
      await waitFor(() => expect(f.close).toHaveBeenCalledOnce())
    }
  )

  it("encodes an uploaded image and shows errors for invalid files without replacing the selection", async () => {
    await i18n.changeLanguage("en-US")
    const f = show()
    const input = screen.getByLabelText(i18n.t("applications.uploadIcon"), {
      selector: "input",
    })
    fireEvent.change(input, {
      target: {
        files: [new File(["unsafe"], "logo.svg", { type: "image/svg+xml" })],
      },
    })
    expect(screen.getByRole("alert")).toHaveTextContent(
      i18n.t("applications.iconFileInvalid")
    )
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([1, 2, 3])], "logo.png", {
            type: "image/png",
          }),
        ],
      },
    })
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: i18n.t("applications.replaceIcon") })
      ).toBeEnabled()
    )
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.save") })
    )
    await waitFor(() =>
      expect(f.save).toHaveBeenCalledWith({
        name: "Original",
        description: "Description",
        icon: {
          type: "upload",
          filename: "logo.png",
          mime_type: "image/png",
          data_base64: "AQID",
        },
      })
    )
  })

  it("keeps edits available after a save failure and requires a nonempty name", async () => {
    await i18n.changeLanguage("en-US")
    const save = vi.fn().mockRejectedValue(new Error("unavailable"))
    const f = show(undefined, save)
    await userEvent.clear(
      screen.getByRole("textbox", { name: i18n.t("common.name") })
    )
    expect(
      screen.getByRole("button", { name: i18n.t("common.save") })
    ).toBeDisabled()
    await userEvent.type(
      screen.getByRole("textbox", { name: i18n.t("common.name") }),
      "Retry"
    )
    await userEvent.click(
      screen.getByRole("button", { name: i18n.t("common.save") })
    )
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(f.close).not.toHaveBeenCalled()
    expect(
      screen.getByRole("textbox", { name: i18n.t("common.name") })
    ).toHaveValue("Retry")
    expect(
      screen.getByRole("button", { name: i18n.t("common.save") })
    ).toBeEnabled()
    expect(
      screen.getByRole("button", { name: i18n.t("common.save") })
    ).toHaveAttribute("aria-busy", "false")
    expect(
      screen
        .getByRole("button", { name: i18n.t("common.save") })
        .querySelector('[data-slot="spinner"]')
    ).not.toBeInTheDocument()
  })
})

describe("interactive metadata publication", () => {
  it.each(["zh-CN", "en-US", "fr-FR"])(
    "supports unchanged versions and retry without losing edits in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      vi.mocked(apiRequest).mockResolvedValue({
        version_number: "1.2.4",
        highest_version_number: "1.2.3",
        usage_instructions: "Guide",
      })
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
      clients.push(client)
      const save = vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError({ status: 409, errorCode: "APPLICATION_RUNTIME_BUSY" })
        )
        .mockResolvedValue(undefined)
      const close = vi.fn()
      render(
        <QueryClientProvider client={client}>
          <ApplicationMetadataPublishDialog
            application={{
              id: "10000000-0000-4000-8000-000000000001",
              name: "Original",
              description: null,
              icon: { type: "preset", preset: "bot" },
            }}
            onSave={save}
            onClose={close}
          />
        </QueryClientProvider>
      )
      const user = userEvent.setup()
      const version = await screen.findByRole("textbox", {
        name: i18n.t("applications.distribution.versionNumber"),
      })
      expect(version).toHaveValue("1.2.3")
      const submit = screen.getByRole("button", {
        name: i18n.t("applications.editAndPublish"),
      })
      for (const invalid of ["1.2.2", "1.2", "1.2.3-beta"]) {
        await user.clear(version)
        await user.type(version, invalid)
        expect(submit).toBeDisabled()
      }
      await user.clear(version)
      await user.type(version, "v1.2.3")
      expect(version).toHaveValue("1.2.3")
      expect(submit).toBeEnabled()
      await user.clear(
        screen.getByRole("textbox", { name: i18n.t("common.name") })
      )
      await user.type(
        screen.getByRole("textbox", { name: i18n.t("common.name") }),
        "Renamed"
      )
      await user.click(submit)
      expect(await screen.findByRole("alert")).toHaveTextContent(
        i18n.t("errors.application.runtimeBusy")
      )
      expect(close).not.toHaveBeenCalled()
      expect(version).toHaveValue("1.2.3")
      await user.click(submit)
      await waitFor(() => expect(close).toHaveBeenCalledOnce())
      expect(save).toHaveBeenLastCalledWith(
        { name: "Renamed", description: null },
        { version_number: "1.2.3", usage_instructions: "Guide" }
      )
    }
  )
})
