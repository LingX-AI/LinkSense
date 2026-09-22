import { describe, expect, it } from "vitest"
import { createT } from "@eigenpal/docx-editor-i18n"

import { wordPreviewLocale } from "./word-preview-i18n"

describe("Word preview translations", () => {
  it.each([
    ["zh-CN", "复制链接"],
    ["en-US", "Copy link"],
    ["es-ES", "Copiar enlace"],
    ["pt-BR", "Copiar link"],
    ["fr-FR", "Copier le lien"],
    ["ja-JP", "リンクをコピー"],
  ] as const)("localizes read-only controls in %s", (locale, copyLink) => {
    const messages = wordPreviewLocale(locale)
    expect(messages.hyperlinkPopup?.copyLink).toBe(copyLink)
    const t = createT(messages, locale)
    const page = t("viewer.pageIndicator", { current: 2, total: 8 })
    expect(page).toContain("2")
    expect(page).toContain("8")
    expect(page).not.toMatch(/[{}]/u)
    if (locale !== "en-US" && locale !== "zh-CN") {
      expect(messages.errors.failedToLoad).not.toBe("Failed to Load Document")
      expect(messages.comments.resolved).not.toBe("Resolved")
      expect(messages.contextMenu.copy).not.toBe("Copy")
    }
  })
})
