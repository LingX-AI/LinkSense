// @vitest-environment node

import composerStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

describe("conversation composer capability chips", () => {
  it("gives the capability picker a wider responsive width", () => {
    const pickerRule = composerStyles.match(
      /\.capability-picker-popover\s*\{([^}]*)\}/u
    )?.[1]

    expect(pickerRule).toMatch(
      /width:\s*min\(520px,\s*calc\(100vw\s*-\s*2rem\)\);/u
    )
  })

  it("uses compact icons inside the capability picker", () => {
    const iconRule = composerStyles.match(
      /\.capability-picker-popover\s+\.capability-menu-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(iconRule).toMatch(/width:\s*24px;/u)
    expect(iconRule).toMatch(/height:\s*24px;/u)
    expect(iconRule).toMatch(/border-radius:\s*8px;/u)
  })

  it("removes the action icon background and makes add-group icons smaller", () => {
    const actionIconRule = composerStyles.match(
      /\.capability-picker-popover\s+\.capability-menu-action-icon\s*\{([^}]*)\}/u
    )?.[1]
    const actionSvgRule = composerStyles.match(
      /\.capability-picker-popover\s+\.capability-menu-action-icon\s+svg\s*\{([^}]*)\}/u
    )?.[1]

    expect(actionIconRule).toMatch(/width:\s*20px;/u)
    expect(actionIconRule).toMatch(/height:\s*20px;/u)
    expect(actionIconRule).toMatch(/background:\s*transparent;/u)
    expect(actionSvgRule).toMatch(/width:\s*14px;/u)
    expect(actionSvgRule).toMatch(/height:\s*14px;/u)
  })

  it("uses one shared card geometry for every selected Composer resource", () => {
    const iconRule = composerStyles.match(
      /\.capability-chip-icon\s*\{([^}]*)\}/u
    )?.[1]
    const chipRule = composerStyles.match(
      /\.composer-context-chip\s*\{([^}]*)\}/u
    )?.[1]

    expect(chipRule).toMatch(/height:\s*32px;/u)
    expect(chipRule).toMatch(/border-radius:\s*11px;/u)
    expect(chipRule).toMatch(/padding:\s*3px 4px 3px 7px;/u)
    expect(chipRule).toMatch(
      /background:\s*var\(--app-context-chip-surface\);/u
    )
    expect(chipRule).toMatch(/font-size:\s*var\(--app-ui-font-size\);/u)
    expect(chipRule).toMatch(/font-weight:\s*500;/u)
    expect(chipRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(iconRule).toMatch(/width:\s*18px;/u)
    expect(iconRule).toMatch(/height:\s*18px;/u)
  })

  it("renders the selected knowledge base icon at the shared icon size", () => {
    const knowledgeBaseIconRule = composerStyles.match(
      /\.knowledge-base-chip-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(knowledgeBaseIconRule).toMatch(/width:\s*18px;/u)
    expect(knowledgeBaseIconRule).toMatch(/height:\s*18px;/u)
    expect(knowledgeBaseIconRule).toMatch(/color:\s*var\(--app-muted\);/u)
  })

  it("uses the same medium-weight UI typography for every context label", () => {
    const labelRule = composerStyles.match(
      /\.composer-chip-label\s*\{([^}]*)\}/u
    )?.[1]

    expect(labelRule).toMatch(/font-size:\s*var\(--app-ui-font-size\);/u)
    expect(labelRule).toMatch(/font-weight:\s*500;/u)
    expect(labelRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(labelRule).toMatch(/max-width:\s*min\(15rem,\s*48vw\);/u)
    expect(labelRule).toMatch(/text-overflow:\s*ellipsis;/u)
  })

  it("uses a softer semantic surface for selected capability and knowledge chips", () => {
    const chipRule = composerStyles.match(
      /\.composer-context-chip\s*\{([^}]*)\}/u
    )?.[1]

    expect(composerStyles).toMatch(
      /--app-context-chip-surface:\s*color-mix\(\s*in srgb,\s*var\(--app-control-surface\) 52%,\s*var\(--app-composer\)\s*\);/u
    )
    expect(chipRule).toMatch(
      /background:\s*var\(--app-context-chip-surface\);/u
    )
  })

  it("keeps context chips horizontally scrollable without a visible scrollbar", () => {
    const contextRowRule = composerStyles.match(
      /\.composer-context-row\s*\{([^}]*)\}/u
    )?.[1]

    expect(contextRowRule).toMatch(/overflow-x:\s*auto;/u)
    expect(contextRowRule).toMatch(/scrollbar-width:\s*none;/u)
    expect(composerStyles).toMatch(
      /\.composer-context-row::-webkit-scrollbar\s*\{[^}]*display:\s*none;/u
    )
  })

  it("keeps the attachment overflow trigger compact and its full list bounded", () => {
    const triggerRule = composerStyles.match(
      /\.attachment-overflow-trigger\s*\{([^}]*)\}/u
    )?.[1]
    const composerTriggerRule = composerStyles.match(
      /\.composer-attachment-overflow-trigger\s*\{([^}]*)\}/u
    )?.[1]
    const contentRule = composerStyles.match(
      /\.attachment-overflow-content\s*\{([^}]*)\}/u
    )?.[1]
    const headerRule = composerStyles.match(
      /\.attachment-overflow-header\s*\{([^}]*)\}/u
    )?.[1]
    const listRule = composerStyles.match(
      /\.attachment-overflow-list\s*\{([^}]*)\}/u
    )?.[1]
    const nameRule = composerStyles.match(
      /\.attachment-overflow-name\s*\{([^}]*)\}/u
    )?.[1]

    expect(triggerRule).toMatch(
      /font-size:\s*calc\(var\(--app-ui-font-size\) - 1px\);/u
    )
    expect(triggerRule).toMatch(/font-weight:\s*400;/u)
    expect(composerTriggerRule).toMatch(/min-width:\s*40px;/u)
    expect(contentRule).toMatch(
      /width:\s*min\(360px,\s*calc\(100vw - 32px\)\);/u
    )
    expect(contentRule).toMatch(/overflow:\s*hidden;/u)
    expect(headerRule).toMatch(/justify-content:\s*space-between;/u)
    expect(headerRule).toMatch(/margin-bottom:\s*8px;/u)
    expect(listRule).toMatch(/overflow-y:\s*auto;/u)
    expect(listRule).toMatch(/overscroll-behavior:\s*contain;/u)
    expect(nameRule).toMatch(/text-overflow:\s*ellipsis;/u)
    expect(nameRule).toMatch(/white-space:\s*nowrap;/u)
  })

  it("keeps overflowing attachments inside the Composer grid instead of widening the page", () => {
    const shellRule = composerStyles.match(
      /\.composer-shell\s*\{([^}]*)\}/u
    )?.[1]
    const contextRowRule = composerStyles.match(
      /\.composer-context-row\s*\{([^}]*)\}/u
    )?.[1]
    const bottomStackRule = composerStyles.match(
      /(?:^|\n)\.conversation-bottom-stack\s*\{([^}]*)\}/u
    )?.[1]
    const bottomStackChildrenRule = composerStyles.match(
      /(?:^|\n)\.conversation-bottom-stack\s*>\s*\*\s*\{([^}]*)\}/u
    )?.[1]

    expect(shellRule).toMatch(/max-width:\s*100%;/u)
    expect(shellRule).toMatch(/min-width:\s*0;/u)
    expect(contextRowRule).toMatch(/width:\s*100%;/u)
    expect(contextRowRule).toMatch(/min-width:\s*0;/u)
    expect(contextRowRule).toMatch(/align-items:\s*center;/u)
    expect(bottomStackRule).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\);/u
    )
    expect(bottomStackRule).toMatch(/min-width:\s*0;/u)
    expect(bottomStackChildrenRule).toMatch(/min-width:\s*0;/u)
  })

  it("layers blue URL highlights over the native composer input", () => {
    const layerRule = composerStyles.match(
      /\.composer-input-layer\s*\{([^}]*)\}/u
    )?.[1]
    const highlightRule = composerStyles.match(
      /\.composer-input-highlight\s*\{([^}]*)\}/u
    )?.[1]
    const highlightedTextareaRule = composerStyles.match(
      /\.composer-input\.composer-input-has-url\s*\{([^}]*)\}/u
    )?.[1]
    const urlRule = composerStyles.match(
      /\.composer-url-highlight\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = composerStyles.match(
      /\.composer-url-highlight-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(layerRule).toMatch(/position:\s*relative;/u)
    expect(highlightRule).toMatch(/position:\s*absolute;/u)
    expect(highlightRule).toMatch(/pointer-events:\s*none;/u)
    expect(highlightedTextareaRule).toMatch(/color:\s*transparent;/u)
    expect(highlightedTextareaRule).toMatch(
      /caret-color:\s*var\(--app-text\);/u
    )
    expect(urlRule).toMatch(/color:\s*var\(--app-link\);/u)
    expect(iconRule).toMatch(/top:\s*2px;/u)
    expect(iconRule).toMatch(/width:\s*14px;/u)
    expect(iconRule).toMatch(/height:\s*14px;/u)
  })

  it("uses compact thumbnails that preserve the complete image when files share the context row", () => {
    const mixedAttachmentRule = composerStyles.match(
      /\.composer-context-row-with-files\s*\{([^}]*)\}/u
    )?.[1]
    const mixedAttachmentThumbnailRule = composerStyles.match(
      /\.composer-context-row-with-files\s+\.image-preview-thumbnail\s*\{([^}]*)\}/u
    )?.[1]
    const thumbnailImageRule = composerStyles.match(
      /\.image-preview-thumbnail-trigger img\s*\{([^}]*)\}/u
    )?.[1]

    expect(mixedAttachmentRule).toMatch(/align-items:\s*flex-start;/u)
    expect(mixedAttachmentThumbnailRule).toMatch(/width:\s*40px;/u)
    expect(mixedAttachmentThumbnailRule).toMatch(/height:\s*40px;/u)
    expect(thumbnailImageRule).toMatch(/object-fit:\s*contain;/u)
    expect(thumbnailImageRule).not.toMatch(/object-position:/u)
  })

  it("anchors the slash command surface directly above the Composer", () => {
    const shellRule = composerStyles.match(
      /\.composer-shell\s*\{([^}]*)\}/u
    )?.[1]
    const menuRule = composerStyles.match(
      /\.composer-slash-menu\s*\{([^}]*)\}/u
    )?.[1]

    expect(shellRule).toMatch(/position:\s*relative;/u)
    expect(menuRule).toMatch(/position:\s*absolute;/u)
    expect(menuRule).toMatch(/bottom:\s*calc\(100% \+ 8px\);/u)
    expect(menuRule).toMatch(/border-radius:\s*14px;/u)
    expect(menuRule).toMatch(/background:\s*color-mix\(/u)
    expect(menuRule).toMatch(/box-shadow:\s*var\(--app-shadow\);/u)
    expect(menuRule).toMatch(/font-size:\s*var\(--app-ui-font-size\);/u)
  })

  it("uses compact rows, one-step-smaller UI labels, and right-aligned descriptions", () => {
    const itemRule = composerStyles.match(
      /\.composer-slash-root-item\s*\{([^}]*)\}/u
    )?.[1]
    const labelRule = composerStyles.match(
      /\.composer-slash-root-label\s*\{([^}]*)\}/u
    )?.[1]
    const descriptionRule = composerStyles.match(
      /\.composer-slash-root-description\s*\{([^}]*)\}/u
    )?.[1]

    expect(itemRule).toMatch(/display:\s*grid;/u)
    expect(itemRule).toMatch(
      /grid-template-columns:\s*20px minmax\(108px, auto\) minmax\(0, 1fr\) 14px;/u
    )
    expect(itemRule).toMatch(/min-height:\s*36px;/u)
    expect(labelRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
    expect(labelRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(descriptionRule).toMatch(/text-align:\s*right;/u)
    expect(descriptionRule).toMatch(/text-overflow:\s*ellipsis;/u)
  })

  it("keeps expanded resource rows flat, iconless, and single-line", () => {
    const inlinePanelRule = composerStyles.match(
      /\.composer-slash-inline-panel\s*\{([^}]*)\}/u
    )?.[1]
    const detailItemRule = composerStyles.match(
      /\.composer-slash-detail-item,\s*\.composer-slash-status-row\s*\{([^}]*)\}/u
    )?.[1]
    const itemCopyRule = composerStyles.match(
      /\.composer-slash-item-copy\s*\{([^}]*)\}/u
    )?.[1]
    const itemTitleRule = composerStyles.match(
      /\.composer-slash-item-title\s*\{([^}]*)\}/u
    )?.[1]

    expect(inlinePanelRule).toMatch(/margin:\s*1px 0 3px 24px;/u)
    expect(inlinePanelRule).toMatch(/border-left:\s*0;/u)
    expect(detailItemRule).toMatch(/min-height:\s*32px;/u)
    expect(detailItemRule).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) auto 14px;/u
    )
    expect(itemCopyRule).toMatch(/align-items:\s*baseline;/u)
    expect(itemCopyRule).toMatch(/gap:\s*8px;/u)
    expect(itemTitleRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
    expect(composerStyles).not.toContain(".composer-slash-item-icon")
  })

  it("uses a semantic green dot for successful MCP tests without a manage row", () => {
    const statusDotRule = composerStyles.match(
      /\.composer-slash-mcp-status-dot\s*\{([^}]*)\}/u
    )?.[1]

    expect(statusDotRule).toMatch(/width:\s*6px;/u)
    expect(statusDotRule).toMatch(/height:\s*6px;/u)
    expect(statusDotRule).toMatch(/border-radius:\s*999px;/u)
    expect(statusDotRule).toMatch(/background:\s*var\(--success\);/u)
    expect(composerStyles).not.toContain(".composer-slash-manage-item")
  })
})
