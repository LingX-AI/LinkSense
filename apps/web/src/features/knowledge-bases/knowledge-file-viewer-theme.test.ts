import { describe, expect, it, vi } from "vitest"

import {
  decorateKnowledgeFileViewerToolbar,
  KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE,
  installKnowledgeFileViewerTheme,
  KNOWLEDGE_FILE_VIEWER_SEARCH_CLEAR_ATTRIBUTE,
  KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_ATTRIBUTE,
  KNOWLEDGE_FILE_VIEWER_THEME_ATTRIBUTE,
  KNOWLEDGE_FILE_VIEWER_THEME_CSS,
} from "@/features/knowledge-bases/knowledge-file-viewer-theme"

describe("knowledge file viewer theme", () => {
  it("keeps the LinkSense overrides inside the Flyfish shadow root", () => {
    const container = document.createElement("div")
    const root = container.attachShadow({ mode: "open" })

    const first = installKnowledgeFileViewerTheme(container)
    const second = installKnowledgeFileViewerTheme(container)

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(
      root.querySelectorAll(`style[${KNOWLEDGE_FILE_VIEWER_THEME_ATTRIBUTE}]`)
    ).toHaveLength(1)
    expect(first?.textContent).toBe(KNOWLEDGE_FILE_VIEWER_THEME_CSS)
    expect(first?.textContent).toContain(".pdf-nav-pane")
    expect(first?.textContent).toContain(".excel-wrapper .loading-card")
    expect(first?.textContent).toContain("var(--app-context-chip-surface)")
  })

  it("does not leak a light-DOM style when Flyfish has no shadow root", () => {
    const container = document.createElement("div")

    expect(installKnowledgeFileViewerTheme(container)).toBeNull()
    expect(container.querySelector("style")).toBeNull()
  })

  it("flattens the PDF controls into a single minimal visual layer", () => {
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.pdf-toolbar-group\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.pdf-nav-tabs button\.active\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*inset 0 -2px 0 var\(--app-text\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.pdf-page-thumb\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*color:\s*var\(--app-muted\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-toolbar-group \+ \.file-viewer-web-toolbar-group\s*\{[^}]*border-left:\s*1px solid var\(--app-divider\);/u
    )
  })

  it("removes duplicate page numbers while preserving real thumbnails", () => {
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.pdf-page-button\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.pdf-page-button:not\(\.pdf-page-button--with-thumbnail\) \.pdf-page-thumb\s*\{[^}]*display:\s*none;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.pdf-page-button--with-thumbnail\s*\{[^}]*grid-template-columns:\s*42px minmax\(0,\s*1fr\);/u
    )
  })

  it("releases the PDF navigation column when the desktop sidebar is collapsed", () => {
    const desktopThemeCss = KNOWLEDGE_FILE_VIEWER_THEME_CSS.split(
      "@media (max-width: 720px)"
    )[0]

    expect(desktopThemeCss).toMatch(
      /\.file-viewer-web-shell \.pdf-shell--nav-hidden \.pdf-content\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/u
    )
  })

  it("keeps a single outer boundary around spreadsheet previews", () => {
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-shell \.excel-wrapper \.e-virt-table-stage\s*\{[^}]*border:\s*0 !important;[^}]*border-radius:\s*0 !important;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-shell \.excel-wrapper \.toolbar\s*\{[^}]*border-color:\s*var\(--app-divider\);/u
    )
  })

  it("gives Word pages restrained corners and a smaller lighter shadow", () => {
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.docx-page-frame > section\.docx,\s*\.file-viewer-web-shell \.docx-fit-viewer \.docx-flow-frame > section\.docx\s*\{[^}]*overflow:\s*hidden;[^}]*border-radius:\s*10px;[^}]*box-shadow:\s*var\(--word-preview-page-shadow\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-shell \.ofd-page,[^{]*\{[^}]*box-shadow:\s*0 4px 18px color-mix\(in srgb, var\(--app-text\) 11%, transparent\);/u
    )
  })

  it("centers the floating toolbar and uses the LinkSense control surfaces", () => {
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-toolbar\[data-toolbar-position="bottom-right"\]\s*\{[^}]*right:\s*auto;[^}]*left:\s*50%;[^}]*bottom:\s*calc\(12px \+ env\(safe-area-inset-bottom, 0px\)\);[^}]*background:\s*var\(--app-canvas\);[^}]*transform:\s*translateX\(-50%\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\[data-linksense-search-field\]\s*\{[^}]*overflow:\s*hidden;[^}]*border-radius:\s*6px;[^}]*background:\s*var\(--app-context-chip-surface\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /--file-viewer-floating-button-height:\s*34px;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-search input:focus,[^{]*\{[^}]*outline:\s*0;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /input::-webkit-search-cancel-button\s*\{[^}]*display:\s*none;[^}]*appearance:\s*none;[^}]*-webkit-appearance:\s*none;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toContain(
      "--file-viewer-button-hover-bg: var(--app-hover);"
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-toolbar button:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--app-hover\);[^}]*color:\s*var\(--app-text\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /button:active:not\(:disabled\):not\(\[data-linksense-search-clear\]\)/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).not.toContain("#16774c")
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).not.toContain("rgba(33,163,102")
  })

  it("replaces Flyfish character controls and embeds a custom clear button", () => {
    const container = document.createElement("div")
    const root = container.attachShadow({ mode: "open" })
    root.innerHTML = `
      <div class="file-viewer-web-toolbar" data-toolbar-position="bottom-right">
        <form class="file-viewer-web-toolbar-group file-viewer-web-search">
          <input type="search" />
          <button type="submit" aria-label="搜索">搜索</button>
          <button type="button" class="file-viewer-web-icon-button" aria-label="上一个匹配">&lt;</button>
          <button type="button" class="file-viewer-web-icon-button" aria-label="下一个匹配">&gt;</button>
          <button type="button" class="file-viewer-web-icon-button" aria-label="清除搜索">x</button>
          <span class="file-viewer-web-search-count">0/0</span>
        </form>
        <div class="file-viewer-web-toolbar-group">
          <button type="button" class="file-viewer-web-icon-button" aria-label="缩小预览">-</button>
          <button type="button" class="file-viewer-web-zoom-meter">115%</button>
          <button type="button" class="file-viewer-web-icon-button" aria-label="还原比例">1:1</button>
          <button type="button" class="file-viewer-web-icon-button" aria-label="放大预览">+</button>
        </div>
      </div>
    `

    expect(decorateKnowledgeFileViewerToolbar(container)).toBe(7)
    expect(decorateKnowledgeFileViewerToolbar(container)).toBe(0)
    expect(
      Array.from(
        root.querySelectorAll<HTMLElement>(
          `[${KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE}]`
        ),
        (element) => element.getAttribute(KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE)
      )
    ).toEqual([
      "clear",
      "search",
      "previous",
      "next",
      "zoom-out",
      "zoom-reset",
      "zoom-in",
    ])
    expect(
      root.querySelectorAll("button > svg[aria-hidden='true']")
    ).toHaveLength(7)
    const searchField = root.querySelector(
      "[" + KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_ATTRIBUTE + "]"
    )
    expect(searchField).toContainElement(
      root.querySelector("input[type='search']")
    )
    expect(searchField).toContainElement(
      root.querySelector("button[aria-label='清除搜索']")
    )
    expect(root.querySelector("button[aria-label='清除搜索']")).toHaveAttribute(
      KNOWLEDGE_FILE_VIEWER_SEARCH_CLEAR_ATTRIBUTE
    )
    expect(
      root.querySelector("button[aria-label='清除搜索']")
    ).not.toHaveTextContent("x")
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\[data-linksense-search-field\]\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-search input\s*\{[^}]*display:\s*block;[^}]*min-width:\s*0;[^}]*background:\s*transparent;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.file-viewer-web-toolbar\[data-toolbar-position="bottom-right"\] \.file-viewer-web-search \[data-linksense-search-field\] input\s*\{[^}]*width:\s*100%;[^}]*flex:\s*1 1 auto;/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\[data-linksense-search-clear\]\s*\{[^}]*position:\s*absolute;[^}]*top:\s*50%;[^}]*right:\s*3px;[^}]*width:\s*28px;[^}]*transform:\s*translateY\(-50%\);/u
    )
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\[data-linksense-search-clear\]:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--app-muted\);/u
    )
    expect(root.querySelector(".file-viewer-web-zoom-meter")).toHaveTextContent(
      "115%"
    )
    expect(
      root.querySelector("button[aria-label='上一个匹配']")
    ).toHaveAccessibleName("上一个匹配")
  })

  it("replaces PDF zoom and rotation characters with LinkSense Lucide icons", () => {
    const container = document.createElement("div")
    const root = container.attachShadow({ mode: "open" })
    root.innerHTML = `
      <div class="pdf-toolbar">
        <div class="pdf-toolbar-group pdf-toolbar-group--zoom">
          <button type="button" class="pdf-icon-button" aria-label="缩小">−</button>
          <button type="button" class="pdf-scale-button" aria-label="适合宽度">101%</button>
          <button type="button" class="pdf-icon-button" aria-label="放大">+</button>
        </div>
        <div class="pdf-toolbar-group pdf-toolbar-group--rotate">
          <button type="button" class="pdf-icon-button" aria-label="向左旋转">↺</button>
          <span class="pdf-rotation-meter">0°</span>
          <button type="button" class="pdf-icon-button" aria-label="向右旋转">↻</button>
        </div>
      </div>
    `

    expect(decorateKnowledgeFileViewerToolbar(container)).toBe(4)
    expect(decorateKnowledgeFileViewerToolbar(container)).toBe(0)
    expect(
      Array.from(
        root.querySelectorAll<HTMLElement>(
          `.pdf-toolbar [${KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE}]`
        ),
        (element) => element.getAttribute(KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE)
      )
    ).toEqual(["minus", "plus", "rotate-ccw", "rotate-cw"])
    expect(
      root.querySelectorAll(".pdf-toolbar button > svg[aria-hidden='true']")
    ).toHaveLength(4)
    expect(root.querySelector(".pdf-scale-button")).toHaveTextContent("101%")
    expect(root.querySelector(".pdf-rotation-meter")).toHaveTextContent("0°")
    expect(
      root.querySelector("button[aria-label='向左旋转']")
    ).toHaveAccessibleName("向左旋转")
    expect(KNOWLEDGE_FILE_VIEWER_THEME_CSS).toMatch(
      /\.pdf-toolbar \[data-linksense-viewer-icon\] svg\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/u
    )
  })

  it("keeps the custom clear button in sync with the search input", () => {
    const container = document.createElement("div")
    const root = container.attachShadow({ mode: "open" })
    root.innerHTML = `
      <div class="file-viewer-web-toolbar" data-toolbar-position="bottom-right">
        <form class="file-viewer-web-toolbar-group file-viewer-web-search">
          <input type="search" />
          <button type="submit">搜索</button>
          <button type="button" aria-label="清除搜索" disabled>x</button>
        </form>
      </div>
    `
    const input = root.querySelector<HTMLInputElement>("input[type='search']")
    const clearButton = root.querySelector<HTMLButtonElement>(
      "button[aria-label='清除搜索']"
    )
    const onClear = vi.fn()
    clearButton?.addEventListener("click", onClear)

    decorateKnowledgeFileViewerToolbar(container)
    decorateKnowledgeFileViewerToolbar(container)
    if (input) input.value = "LinkSense"
    input?.dispatchEvent(new Event("input", { bubbles: true }))
    expect(clearButton).toBeEnabled()

    clearButton?.click()

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(input).toHaveValue("")
    expect(clearButton).toBeDisabled()
  })
})
