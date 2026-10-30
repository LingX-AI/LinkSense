import type { FormEvent } from "react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { notify } from "@/components/feedback/notification"
import i18n, { supportedLanguages } from "@/i18n"
import { CallbackUrlInput } from "./callback-url-input"

const callback = "https://linksense.example.test/api/v1/auth/oidc/callback"

beforeEach(async () => {
  await i18n.changeLanguage("zh-CN")
  vi.spyOn(notify, "success").mockImplementation(() => 0)
  vi.spyOn(notify, "error").mockImplementation(() => 0)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("callback URL input", () => {
  it.each(supportedLanguages)(
    "copies the complete read-only URL with an accessible icon button in %s without submitting the form",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const interaction = userEvent.setup()
      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue()
      const submit = vi.fn((event: FormEvent) => event.preventDefault())
      render(
        <form onSubmit={submit}>
          <label htmlFor="callback">
            {i18n.t("admin.authSettings.oidcRedirectUri")}
          </label>
          <CallbackUrlInput id="callback" value={callback} />
        </form>
      )
      const input = screen.getByRole("textbox")
      const button = screen.getByRole("button", {
        name: i18n.t("admin.authSettings.copyCallback"),
      })
      expect(input).toHaveValue(callback)
      expect(input).toHaveAttribute("readonly")
      expect(button).toHaveAttribute("type", "button")
      expect(button).toHaveAttribute(
        "title",
        i18n.t("admin.authSettings.copyCallback")
      )
      expect(button.textContent).toBe("")
      expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
      expect(button.closest('[data-slot="input-group-addon"]')).toHaveAttribute(
        "data-align",
        "inline-end"
      )
      await interaction.click(button)
      expect(write).toHaveBeenCalledWith(callback)
      expect(notify.success).toHaveBeenCalledWith(
        i18n.t("admin.authSettings.callbackCopied")
      )
      expect(submit).not.toHaveBeenCalled()
    }
  )

  it("reports a clipboard failure and allows retry without changing the URL", async () => {
    const interaction = userEvent.setup()
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockRejectedValueOnce(new Error("clipboard unavailable"))
      .mockResolvedValue()
    render(<CallbackUrlInput id="callback" value={callback} />)
    const button = screen.getByRole("button")
    await interaction.click(button)
    expect(notify.error).toHaveBeenCalledWith(
      i18n.t("admin.authSettings.copyFailed")
    )
    expect(notify.success).not.toHaveBeenCalled()
    expect(button).toBeEnabled()
    expect(screen.getByRole("textbox")).toHaveValue(callback)
    await interaction.click(button)
    expect(write).toHaveBeenCalledTimes(2)
    expect(notify.success).toHaveBeenCalledWith(
      i18n.t("admin.authSettings.callbackCopied")
    )
  })

  it("prevents repeated copying until the clipboard operation finishes", async () => {
    const interaction = userEvent.setup()
    let finish: () => void = () => {
      throw new Error("Clipboard operation not started")
    }
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockReturnValue(pending)
    render(<CallbackUrlInput id="callback" value={callback} />)
    const button = screen.getByRole("button")
    await interaction.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("aria-busy", "true")
    await interaction.click(button)
    expect(write).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).not.toHaveAttribute("aria-busy")
  })

  it("disables copying for an empty URL or a disabled field", () => {
    const { rerender } = render(<CallbackUrlInput id="callback" value="" />)
    expect(screen.getByRole("button")).toBeDisabled()
    rerender(<CallbackUrlInput id="callback" value={callback} disabled />)
    expect(screen.getByRole("textbox")).toBeDisabled()
    expect(screen.getByRole("button")).toBeDisabled()
  })
})
