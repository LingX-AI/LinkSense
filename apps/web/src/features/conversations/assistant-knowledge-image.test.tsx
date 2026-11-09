import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  AssistantKnowledgeImage,
  ConversationKnowledgeAssetProvider,
  type LoadConversationKnowledgeAsset,
} from "@/features/conversations/assistant-knowledge-image"
import i18n, { supportedLanguages } from "@/i18n"
import { createIntersectionObserverMock } from "@/test/intersection-observer"

describe("knowledge image lazy loading", () => {
  const visibility = createIntersectionObserverMock()
  const createObjectURL = vi.fn(() => "blob:knowledge-image")
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", visibility.Observer)
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createObjectURL
        static revokeObjectURL = revokeObjectURL
      }
    )
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each(supportedLanguages)(
    "waits for visibility before requesting the authorized image in %s",
    async (language) => {
      await i18n.changeLanguage(language)
      const load = vi.fn<LoadConversationKnowledgeAsset>(
        async () => new Blob(["image"], { type: "image/png" })
      )
      const view = render(
        <ConversationKnowledgeAssetProvider load={load}>
          <AssistantKnowledgeImage
            assetReferenceId="asset"
            citationIds={[]}
            conversationId="conversation"
            turnId="turn"
            alt="reference.png"
          />
        </ConversationKnowledgeAssetProvider>
      )
      await act(async () => {})
      const placeholder = screen.getByRole("status", {
        name: i18n.t("conversation.previewLoading", { name: "reference.png" }),
      })
      expect(load).not.toHaveBeenCalled()
      expect(createObjectURL).not.toHaveBeenCalled()
      const surface = placeholder.closest(
        '[data-slot="knowledge-image-surface"]'
      )
      if (!surface) throw new Error("Missing knowledge image surface")
      act(() => visibility.intersect(surface))
      expect(
        await screen.findByRole("img", { name: "reference.png" })
      ).toHaveAttribute("src", "blob:knowledge-image")
      expect(load).toHaveBeenCalledExactlyOnceWith({
        conversationId: "conversation",
        turnId: "turn",
        assetReferenceId: "asset",
        signal: expect.any(AbortSignal),
      })
      act(() => visibility.intersect(surface, false))
      act(() => visibility.intersect(surface))
      expect(load).toHaveBeenCalledOnce()
      view.unmount()
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:knowledge-image"
      )
    }
  )

  it("aborts the visible image request when its task is unmounted", async () => {
    const load = vi.fn<LoadConversationKnowledgeAsset>(
      () => new Promise(() => {})
    )
    const view = render(
      <ConversationKnowledgeAssetProvider load={load}>
        <AssistantKnowledgeImage
          assetReferenceId="asset"
          citationIds={[]}
          conversationId="conversation"
          turnId="turn"
        />
      </ConversationKnowledgeAssetProvider>
    )
    const surface = view.container.querySelector(
      '[data-slot="knowledge-image-surface"]'
    )
    if (!surface) throw new Error("Missing knowledge image surface")
    act(() => visibility.intersect(surface))
    expect(load).toHaveBeenCalledOnce()
    const signal = load.mock.calls[0]?.[0].signal
    expect(signal?.aborted).toBe(false)
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it("keeps failure and retry working after a visible image request fails", async () => {
    await i18n.changeLanguage("zh-CN")
    const load = vi
      .fn<LoadConversationKnowledgeAsset>()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(new Blob(["image"], { type: "image/png" }))
    const view = render(
      <ConversationKnowledgeAssetProvider load={load}>
        <AssistantKnowledgeImage
          assetReferenceId="asset"
          citationIds={[]}
          conversationId="conversation"
          turnId="turn"
          alt="reference.png"
        />
      </ConversationKnowledgeAssetProvider>
    )
    const surface = view.container.querySelector(
      '[data-slot="knowledge-image-surface"]'
    )
    if (!surface) throw new Error("Missing knowledge image surface")
    act(() => visibility.intersect(surface))
    fireEvent.click(await screen.findByRole("button", { name: "重试" }))
    expect(
      await screen.findByRole("img", { name: "reference.png" })
    ).toBeVisible()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
