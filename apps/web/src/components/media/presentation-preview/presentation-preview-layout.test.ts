// @vitest-environment node

import previewStyles from "@/index.css?raw"
import { describe, expect, it } from "vitest"

function declarationFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = previewStyles.match(
    new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "u")
  )
  return match?.groups?.body ?? ""
}

describe("presentation preview layout", () => {
  it("uses a two-fifths viewport default with the existing resizer and responsive fallback", () => {
    expect(previewStyles).not.toContain("min(62vw, 1180px)")
    expect(previewStyles).toMatch(
      /\[data-has-office-preview="true"\][\s\S]*?calc\(100% - 40vw\)/u
    )
    expect(previewStyles).toMatch(
      /\.office-preview-resize-handle,[\s\S]*?\{[\s\S]*?left:\s*var\([\s\S]*?--conversation-workspace-width/u
    )
    expect(previewStyles).toMatch(
      /@media \(max-width: 1100px\)[\s\S]*?\.office-preview-resize-handle,[\s\S]*?\{\s*display:\s*none;/u
    )
    expect(previewStyles).toMatch(
      /:has\(\.office-preview-pane-expanded\)[\s\S]*?\.office-preview-resize-handle,[\s\S]*?\{\s*display:\s*none;/u
    )
    expect(previewStyles).toMatch(
      /\[data-overlay-office-preview="true"\][\s\S]*?> \.office-preview-pane[\s\S]*?\{[\s\S]*?position:\s*absolute;/u
    )
  })

  it("keeps every panel resize target wide while using one thin indicator", () => {
    expect(declarationFor(".sidebar-resize-handle")).toMatch(/width:\s*10px;/u)
    expect(declarationFor(".sidebar-resize-handle::after")).toMatch(
      /width:\s*1px;/u
    )
    expect(previewStyles).not.toMatch(
      /\.office-preview-resize-handle(?::focus-visible)?::after\s*\{[^}]*width:/u
    )
  })

  it("keeps an expanded Office preview inside the application workspace", () => {
    const expanded = declarationFor(".office-preview-pane-expanded")

    expect(expanded).toMatch(/position:\s*absolute;/u)
    expect(expanded).toMatch(/inset:\s*0;/u)
    expect(expanded).toMatch(/z-index:\s*60;/u)
    expect(expanded).toMatch(/width:\s*auto;/u)
    expect(expanded).toMatch(/height:\s*auto;/u)
    expect(expanded).not.toMatch(/position:\s*fixed;/u)
    expect(expanded).not.toMatch(/100vw|100dvh/u)
  })

  it("uses a slower right-side transition when file preview panes open and close", () => {
    const previewMotion = previewStyles.match(
      /\.conversation-office-layout,\s*\.conversation-presentation-layout\s*\{(?<body>[^}]*)\}/u
    )?.groups?.body
    const animatedPanes = Array.from(
      previewStyles.matchAll(
        /animation:\s*(conversation-file-preview-pane-(?:in|out))\s+var\(--conversation-file-preview-motion-duration\)\s+var\(--conversation-file-preview-motion-easing\)\s+both;/gu
      ),
      ([, name]) => name
    )
    expect(previewMotion).toMatch(
      /--conversation-file-preview-motion-duration:\s*360ms;/u
    )
    expect(previewMotion).toMatch(
      /--conversation-file-preview-motion-easing:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\);/u
    )
    expect(animatedPanes).toEqual([
      "conversation-file-preview-pane-in",
      "conversation-file-preview-pane-out",
    ])
    expect(previewStyles).toMatch(
      /@property --conversation-file-preview-pane-offset\s*\{[\s\S]*?syntax:\s*"<percentage>";[\s\S]*?inherits:\s*true;[\s\S]*?initial-value:\s*0%;/u
    )
    expect(previewStyles).toMatch(
      /\.conversation-office-layout\[data-has-office-preview="true"\]:has\([\s\S]*?> \.office-preview-pane\.office-preview-pane-entering:not\([\s\S]*?\.subagent-detail-pane[\s\S]*?\)[\s\S]*?\)\s*\{[\s\S]*?animation:\s*conversation-file-preview-pane-in/u
    )
    expect(previewStyles).toMatch(
      /> \.office-preview-pane\.office-preview-pane-entering:not\([\s\S]*?\.subagent-detail-pane[\s\S]*?\)\s*\{[\s\S]*?transform:\s*translate3d\([\s\S]*?var\(--conversation-file-preview-pane-offset\)/u
    )
    expect(previewStyles).toMatch(
      /@keyframes conversation-file-preview-pane-in[\s\S]*?from\s*\{[\s\S]*?--conversation-file-preview-pane-offset:\s*100%;[\s\S]*?to\s*\{[\s\S]*?--conversation-file-preview-pane-offset:\s*0%;/u
    )
    expect(previewStyles).toMatch(
      /@keyframes conversation-file-preview-pane-out[\s\S]*?from\s*\{[\s\S]*?transform:\s*translate3d\(0, 0, 0\);[\s\S]*?to\s*\{[\s\S]*?transform:\s*translate3d\(100%, 0, 0\);/u
    )
    expect(previewStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-has-office-preview="true"\]:has\([\s\S]*?> \.office-preview-pane\.office-preview-pane-entering:not\([\s\S]*?\.subagent-detail-pane[\s\S]*?\)[\s\S]*?\),[\s\S]*?\[data-preview-closing="true"\][\s\S]*?> \.office-preview-pane:not\([\s\S]*?\.subagent-detail-pane[\s\S]*?\)[\s\S]*?\{[\s\S]*?animation:\s*none;/u
    )
  })

  it("animates the conversation workspace width in sync with the preview pane", () => {
    expect(previewStyles).toMatch(
      /\.conversation-office-layout > \.conversation-workspace,\s*\.conversation-presentation-layout > \.conversation-workspace\s*\{[^}]*flex:\s*0 0 100%;[^}]*transition:\s*flex-basis var\(--conversation-file-preview-motion-duration\)\s*var\(--conversation-file-preview-motion-easing\);/u
    )
    expect(previewStyles).toMatch(
      /\[data-has-office-preview="true"\][\s\S]*?> \.conversation-workspace,[\s\S]*?\[data-has-presentation-preview="true"\][\s\S]*?> \.conversation-workspace\s*\{[^}]*flex-basis:\s*var\(--conversation-workspace-width, calc\(100% - 40vw\)\);/u
    )
    expect(previewStyles).toMatch(
      /\[data-preview-closing="true"\][\s\S]*?> \.conversation-workspace\s*\{[^}]*flex-basis:\s*100%;/u
    )
  })

  it("skips workspace width motion while resizing or when reduced motion is preferred", () => {
    expect(previewStyles).toMatch(
      /\.conversation-office-layout\[data-preview-resizing="true"\]\s*> \.conversation-workspace,[\s\S]*?\.conversation-presentation-layout\[data-preview-resizing="true"\]\s*> \.conversation-workspace\s*\{[^}]*transition:\s*none;/u
    )
    expect(previewStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.conversation-office-layout > \.conversation-workspace,[\s\S]*?\.conversation-presentation-layout > \.conversation-workspace[\s\S]*?\{[^}]*transition:\s*none;/u
    )
  })

  it("lets exit override entrance without disabling preview interaction", () => {
    const closingRule = previewStyles.match(
      /\.conversation-office-layout\[data-has-office-preview="true"\]\[data-preview-closing="true"\][\s\S]*?> \.office-preview-pane:not\(\.subagent-detail-pane\)\s*\{(?<body>[^}]*)\}/u
    )?.groups?.body

    expect(closingRule).toContain(
      "animation: conversation-file-preview-pane-out"
    )
    expect(closingRule).not.toContain("pointer-events: none")
  })

  it("removes the embedded editor inspector and its resize handle", () => {
    expect(previewStyles).toMatch(
      /\.pptx-viewer-adapter \[data-pptx-viewer\] \[role="complementary"\][\s\S]*?display:\s*none\s*!important;/u
    )
    expect(previewStyles).toMatch(
      /\[role="separator"\]\[aria-orientation="horizontal"\]:has\(\s*\+ \[role="complementary"\]\s*\)[\s\S]*?display:\s*none\s*!important;/u
    )
  })

  it("disables the embedded navigator resize handle and its hover indicator", () => {
    expect(previewStyles).toMatch(
      /\[role="separator"\]\[aria-orientation="horizontal"\]\s*\{[\s\S]*?pointer-events:\s*none;/u
    )
    expect(previewStyles).toMatch(
      /\[role="separator"\]\[aria-orientation="horizontal"\]\s*> div\s*\{[\s\S]*?background:\s*transparent\s*!important;/u
    )
  })

  it("inherits the global scrollbar for the slide thumbnail navigator", () => {
    const navigator = declarationFor(
      '.pptx-viewer-adapter [role="navigation"] > div'
    )

    expect(navigator).not.toMatch(/scrollbar-(?:color|width):/u)
    expect(previewStyles).not.toMatch(
      /\.pptx-viewer-adapter\s+\[role="navigation"\]\s+> div::-webkit-scrollbar/u
    )
  })

  it("removes decorative dividers while keeping the selected thumbnail clear", () => {
    const header = declarationFor(".office-preview-header")
    expect(header).not.toMatch(/border-bottom:/u)
    expect(previewStyles).toMatch(
      /\.group:has\(\.border-primary\\\/60\)::before\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?content:\s*none\s*!important;/u
    )
  })

  it("matches every file preview header height to the conversation top bar", () => {
    const rootRule = declarationFor(":root")
    const conversationTopBar = previewStyles.match(
      /^\.conversation-top-bar\s*\{([^}]*)\}/mu
    )?.[1]
    const previewHeader = declarationFor(".office-preview-header")

    expect(rootRule).toMatch(/--conversation-top-bar-height:\s*54px;/u)
    expect(conversationTopBar).toMatch(
      /height:\s*var\(--conversation-top-bar-height\);/u
    )
    expect(previewHeader).toMatch(
      /height:\s*var\(--conversation-top-bar-height\);/u
    )
    expect(previewHeader).toMatch(
      /min-height:\s*var\(--conversation-top-bar-height\);/u
    )
  })

  it("places the document controls in the compact header action cluster", () => {
    const headerActions = declarationFor(".office-preview-header-actions")
    expect(headerActions).toMatch(/display:\s*flex;/u)
    expect(headerActions).toMatch(/flex:\s*none;/u)
    expect(headerActions).toMatch(/align-items:\s*center;/u)
    expect(headerActions).toMatch(/gap:\s*8px;/u)
    expect(previewStyles).not.toContain(".office-preview-toolbar {")
  })

  it("centers a slide in both axes while preserving overflow for large slides", () => {
    const viewport = declarationFor(".pptx-viewer-adapter [data-pptx-viewport]")
    const slideWrapper = declarationFor(
      ".pptx-viewer-adapter [data-pptx-viewport] > :first-child"
    )

    expect(viewport).toMatch(/display:\s*flex;/u)
    expect(viewport).toMatch(/min-width:\s*0;/u)
    expect(viewport).toMatch(/min-height:\s*0;/u)
    expect(viewport).toMatch(/padding:\s*16px 4px;/u)
    expect(viewport).toMatch(/cursor:\s*grab;/u)
    expect(viewport).toMatch(/overscroll-behavior:\s*contain;/u)
    expect(slideWrapper).toMatch(/flex:\s*0 0 auto;/u)
    expect(slideWrapper).toMatch(/margin:\s*auto\s*!important;/u)
  })

  it("keeps the 100 percent slide fit aligned with the visible canvas gutter", () => {
    const viewport = declarationFor(".pptx-viewer-adapter [data-pptx-viewport]")

    // pptx-react-viewer subtracts 8px from the viewport width when calculating
    // its 100% fit. The viewport must expose the same 8px content inset while
    // the outer margin preserves the intended 16px visual gutter.
    expect(viewport).toMatch(/margin-inline:\s*12px;/u)
    expect(viewport).toMatch(/padding:\s*16px 4px;/u)
  })

  it("uses the presentation canvas color across the embedded viewer shell", () => {
    expect(declarationFor(".pptx-viewer-adapter")).toMatch(
      /background:\s*var\(--presentation-viewer-canvas\);/u
    )
    expect(declarationFor(".presentation-preview-pptx-surface")).toMatch(
      /background:\s*var\(--presentation-viewer-canvas\);/u
    )
    expect(previewStyles).toMatch(
      /\.pptx-viewer-adapter \[data-pptx-viewer\] > div > \.relative\.z-10\s*\{[\s\S]*?background:\s*var\(--presentation-viewer-canvas\);/u
    )
    expect(previewStyles).toMatch(
      /\.pptx-viewer-adapter \[data-pptx-viewer\] main\s*\{[\s\S]*?background:\s*var\(--presentation-viewer-canvas\);/u
    )
  })

  it("keeps the slide wrapper borderless and draws selection in an unclipped overlay", () => {
    expect(previewStyles).toMatch(
      /\[role="region"\]\[aria-roledescription="slide"\]\s*\{[\s\S]*?--tw-shadow:\s*0 0 #0000\s*!important;[\s\S]*?--tw-shadow-colored:\s*0 0 #0000\s*!important;[\s\S]*?border:\s*0\s*!important;[\s\S]*?outline:\s*none\s*!important;[\s\S]*?overflow:\s*hidden;[\s\S]*?border-radius:\s*20px;[\s\S]*?box-shadow:\s*var\(--presentation-slide-shadow\)\s*!important;/u
    )
    expect(previewStyles).toMatch(
      /--presentation-slide-border:\s*transparent;/u
    )
    expect(previewStyles).not.toMatch(
      /--presentation-slide-border:\s*rgb\(92 92 92 \/ 18%\);/u
    )
    expect(previewStyles).not.toMatch(
      /--presentation-slide-border:\s*rgb\(174 174 174 \/ 24%\);/u
    )
    expect(previewStyles).toMatch(/--presentation-slide-shadow:\s*none;/u)
    expect(previewStyles).not.toMatch(
      /--presentation-slide-shadow:\s*0 0 16px rgb\(32 32 32 \/ 4%\), 0 1px 3px rgb\(32 32 32 \/ 2%\);/u
    )
    expect(previewStyles).not.toMatch(
      /--presentation-slide-shadow:\s*0 0 18px rgb\(0 0 0 \/ 18%\), 0 1px 4px rgb\(0 0 0 \/ 10%\);/u
    )
    expect(previewStyles).toMatch(
      /--presentation-navigator-shadow:\s*0 1px 4px rgb\(0 0 0 \/ 1%\);/u
    )
    expect(previewStyles).toMatch(
      /\[data-pptx-element\]\[data-pptx-selectable="true"\]:is\([\s\S]*?\[aria-selected="true"\],[\s\S]*?\[data-pptx-selection-active="true"\][\s\S]*?\)\s*\{[\s\S]*?--tw-ring-shadow:\s*0 0 #0000\s*!important;[\s\S]*?border-color:\s*transparent\s*!important;[\s\S]*?outline:\s*none\s*!important;/u
    )
    expect(previewStyles).toMatch(
      /\[data-pptx-element\]\[data-pptx-selectable="true"\]\s*\{[\s\S]*?border-width:\s*0\s*!important;[\s\S]*?border-color:\s*transparent\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;/u
    )
    const overlay = declarationFor(".presentation-selection-overlay")
    expect(overlay).toMatch(/position:\s*absolute;/u)
    expect(overlay).toMatch(/z-index:\s*53;/u)
    expect(overlay).toMatch(/inset:\s*0;/u)
    expect(overlay).toMatch(/pointer-events:\s*none;/u)
    const frame = declarationFor(".presentation-selection-frame")
    expect(frame).toMatch(/position:\s*absolute;/u)
    expect(frame).toMatch(/border:\s*2px dashed var\(--app-selection\);/u)
    expect(frame).toMatch(
      /background:\s*color-mix\(in srgb, var\(--app-selection\) 12%, transparent\);/u
    )
    expect(previewStyles).toMatch(
      /\[data-pptx-element\]\[data-pptx-selectable="true"\]:hover:not\([\s\S]*?\[aria-selected="true"\][\s\S]*?\):not\(\[data-pptx-selection-active="true"\]\)\s*\{[\s\S]*?border-color:\s*transparent\s*!important;[\s\S]*?outline:\s*none\s*!important;/u
    )
  })

  it("keeps all preview actions visually compact and consistent", () => {
    const controls = declarationFor(".office-preview-control-button")
    const download = declarationFor(".office-preview-download-button")
    expect(controls).toMatch(/var\(--app-muted\)/u)
    expect(previewStyles).toMatch(
      /\.office-preview-control-button > svg,[\s\S]*?\.office-preview-download-button > svg\s*\{[\s\S]*?width:\s*15px;[\s\S]*?height:\s*15px;[\s\S]*?stroke-width:\s*1\.7;/u
    )
    expect(download).toMatch(/background:\s*transparent;/u)
    expect(download).toMatch(/border:\s*0;/u)
    expect(download).toMatch(/var\(--app-muted\)/u)
    expect(previewStyles).not.toContain(".office-preview-file-close-button")
    expect(previewStyles).not.toContain(".office-preview-open-button")
  })

  it("uses a page-count rail with a compact blurred thumbnail navigator", () => {
    expect(previewStyles).toMatch(
      /\[data-pptx-viewer\] > div > \.contents > nav[\s\S]*?display:\s*none\s*!important;/u
    )
    const trigger = declarationFor(
      ".presentation-preview-compact-slides-trigger"
    )
    expect(trigger).toMatch(/position:\s*absolute;/u)
    expect(trigger).toMatch(/top:\s*50%;/u)
    expect(trigger).toMatch(/left:\s*16px;/u)
    expect(trigger).toMatch(/display:\s*none;/u)
    expect(trigger).toMatch(/border:\s*0;/u)
    expect(trigger).toMatch(/background:\s*transparent;/u)
    expect(trigger).toMatch(/box-shadow:\s*none;/u)
    expect(trigger).toMatch(/backdrop-filter:\s*none;/u)
    expect(previewStyles).toMatch(
      /\[data-pptx-compact-layout="true"\][\s\S]*?\.presentation-preview-compact-slides-trigger\s*\{[\s\S]*?display:\s*inline-flex;/u
    )
    expect(declarationFor(".presentation-preview-compact-slide-rail")).toMatch(
      /width:\s*40px;[\s\S]*?align-items:\s*center;[\s\S]*?gap:\s*5px;/u
    )
    expect(declarationFor(".presentation-preview-compact-slide-line")).toMatch(
      /width:\s*20px;[\s\S]*?height:\s*3px;[\s\S]*?var\(--app-text\) 10%/u
    )
    expect(
      declarationFor(
        '.presentation-preview-compact-slide-line[data-active="true"]'
      )
    ).toMatch(/var\(--app-text\) 92%/u)
    expect(previewStyles).not.toContain(
      ".presentation-preview-compact-slides-trigger > svg"
    )
    const compactNavigator = declarationFor(
      '.pptx-viewer-adapter [data-pptx-mobile-slides-sheet="true"] > div'
    )
    expect(compactNavigator).toMatch(/top:\s*50%\s*!important;/u)
    expect(compactNavigator).toMatch(/left:\s*12px\s*!important;/u)
    expect(compactNavigator).toMatch(
      /box-shadow:\s*var\(--presentation-navigator-shadow\)\s*!important;/u
    )
    expect(compactNavigator).toMatch(
      /(?:^|\s)backdrop-filter:\s*blur\(18px\) saturate\(145%\);/u
    )
    expect(compactNavigator).not.toContain("-webkit-backdrop-filter")
    expect(previewStyles).not.toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\[role="navigation"\]\s*\{\s*display:\s*none;/u
    )
  })

  it("clips compact navigator page previews to the shared rounded shape", () => {
    const thumbnailFrame = previewStyles.match(
      /\.pptx-viewer-adapter\s+\[data-pptx-mobile-slides-sheet="true"\][\s\S]*?aside\[role="navigation"\][\s\S]*?\.group\s*>\s*div:nth-child\(2\)\s*\{(?<body>[^}]*)\}/u
    )?.groups?.body

    expect(thumbnailFrame).toMatch(/border-radius:\s*6px;/u)
    expect(thumbnailFrame).toMatch(/overflow:\s*hidden;/u)
  })

  it("reserves an independent leading gutter for the compact slide rail", () => {
    expect(previewStyles).toMatch(
      /\.pptx-viewer-adapter\[data-pptx-compact-layout="true"\]\s*\[data-pptx-viewer\]\s*>\s*div\s*>\s*\.relative\.z-10\s*\{[^}]*padding-left:\s*64px;/u
    )
    expect(
      declarationFor(".pptx-viewer-adapter [data-pptx-viewport] > :first-child")
    ).toMatch(/transform:\s*translate3d\(/u)
  })
})
