import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { supportedLocales } from "@linksense/shared"
import { afterEach, describe, expect, it } from "vitest"

import i18n from "@/i18n"
import { VoiceNotConfiguredHint } from "./voice-not-configured-hint"

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage("zh-CN")
})

describe("VoiceNotConfiguredHint", () => {
  it.each(supportedLocales)(
    "links the configure action to the voice transcription settings in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const { container } = render(
        <MemoryRouter>
          <VoiceNotConfiguredHint />
        </MemoryRouter>
      )
      const link = screen.getByRole("link")
      expect(link).toHaveAttribute(
        "href",
        "/admin/models?tab=voiceTranscription"
      )
      expect(link).toHaveTextContent(/\S/u)
      expect(container).not.toHaveTextContent("<configure>")
    }
  )
})
