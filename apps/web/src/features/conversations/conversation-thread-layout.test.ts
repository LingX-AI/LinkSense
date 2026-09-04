import conversationStyles from "@/index.css?raw"
import nativeActivityItemSource from "@/features/conversations/native-activity-item.tsx?raw"
import { describe, expect, it } from "vitest"

describe("conversation message navigation layout", () => {
  it("shares the composer width and inner gutters with the message list", () => {
    const scrollRule = conversationStyles.match(
      /\.conversation-scroll\s*\{([^}]*)\}/u
    )?.[1]
    const sharedLayoutRule = conversationStyles.match(
      /\.app-main,\s*\.conversation-workspace\s*\{([^}]*)\}/u
    )?.[1]
    const columnRule = conversationStyles.match(
      /\.conversation-column\s*\{([^}]*)\}/u
    )?.[1]
    const workspaceRule = conversationStyles.match(
      /\.conversation-workspace\s*\{([^}]*--conversation-bottom-stack-height[^}]*)\}/u
    )?.[1]
    const composerDockRule = conversationStyles.match(
      /\.composer-dock\s*\{([^}]*)\}/u
    )?.[1]
    const bottomStackRule = conversationStyles.match(
      /^\.conversation-bottom-stack\s*\{([^}]*)\}/mu
    )?.[1]
    const markdownRule = conversationStyles.match(
      /\.assistant-markdown\s*\{([^}]*)\}/u
    )?.[1]

    expect(sharedLayoutRule).toMatch(
      /--conversation-content-width:\s*min\([\s\S]*?var\(--app-composer-width\)/u
    )
    expect(scrollRule).toMatch(/overflow-anchor:\s*none;/u)
    expect(scrollRule).toMatch(/scrollbar-gutter:\s*stable both-edges;/u)
    expect(sharedLayoutRule).toMatch(
      /--conversation-assistant-block-gap:\s*8px;/u
    )
    expect(columnRule).toMatch(/width:\s*var\(--conversation-content-width\);/u)
    expect(workspaceRule).toMatch(/--conversation-bottom-stack-height:\s*0px;/u)
    expect(workspaceRule).toMatch(
      /--conversation-bottom-stack-clearance:\s*42px;/u
    )
    expect(workspaceRule).toMatch(
      /--conversation-bottom-stack-fallback:\s*220px;/u
    )
    expect(columnRule).toMatch(
      /padding:\s*46px var\(--conversation-message-inner-padding\)\s*max\(\s*var\(--conversation-bottom-stack-fallback\),\s*calc\(\s*var\(--conversation-bottom-stack-height\)\s*\+\s*var\(--conversation-bottom-stack-clearance\)\s*\)\s*\);/u
    )
    expect(composerDockRule).toMatch(
      /padding-inline:\s*var\(--conversation-horizontal-gutter\);/u
    )
    expect(bottomStackRule).toMatch(
      /inset:\s*auto var\(--conversation-horizontal-gutter\) 18px;/u
    )
    expect(markdownRule).toMatch(/width:\s*100%;/u)
    expect(markdownRule).toMatch(/max-width:\s*100%;/u)
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.app-main,\s*\.conversation-workspace\s*\{[^}]*--conversation-horizontal-gutter:\s*10px;[^}]*--conversation-message-inner-padding:\s*10px;/u
    )
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-column\s*\{[^}]*--conversation-bottom-stack-clearance:\s*26px;[^}]*--conversation-bottom-stack-fallback:\s*206px;/u
    )
  })

  it("hides the line sidebar when the conversation workspace is narrow", () => {
    const workspaceRule = conversationStyles.match(
      /^\.conversation-workspace\s*\{[^}]*container:\s*conversation-workspace \/ inline-size;[^}]*\}/mu
    )?.[0]

    expect(workspaceRule).toMatch(
      /container:\s*conversation-workspace \/ inline-size;/u
    )
    expect(conversationStyles).toMatch(
      /@container conversation-workspace \(max-width:\s*900px\)\s*\{\s*\.conversation-message-line-sidebar\s*\{[^}]*display:\s*none;/u
    )
  })

  it("centers the task-switch loading state within the conversation workspace", () => {
    const loadingWorkspaceRule = conversationStyles.match(
      /\.conversation-workspace-loading\s*\{([^}]*)\}/u
    )?.[1]

    expect(loadingWorkspaceRule).toMatch(/display:\s*grid;/u)
    expect(loadingWorkspaceRule).toMatch(/place-items:\s*center;/u)
  })

  it("uses the requested morphing dot canvas for interactive generation", () => {
    const canvasRule = conversationStyles.match(
      /\.assistant-html-preview-loading-canvas\s*\{([^}]*)\}/u
    )?.[1]
    const dotsRule = conversationStyles.match(
      /\.assistant-html-preview-loading-dots\s*\{([^}]*)\}/u
    )?.[1]
    const glowRule = conversationStyles.match(
      /\.assistant-html-preview-loading-dots\s*\{[^}]*\}\s*\.assistant-html-preview-loading-glow\s*\{([^}]*)\}/u
    )?.[1]

    expect(canvasRule).toMatch(/position:\s*absolute;/u)
    expect(canvasRule).toMatch(/inset:\s*0;/u)
    expect(canvasRule).toMatch(/width:\s*100%;/u)
    expect(canvasRule).toMatch(/height:\s*100%;/u)
    expect(canvasRule).not.toMatch(/max-width:/u)
    expect(canvasRule).not.toMatch(/aspect-ratio:/u)
    expect(dotsRule).toMatch(/background-image:\s*radial-gradient\(/u)
    expect(dotsRule).toMatch(/opacity:\s*0\.22;/u)
    expect(glowRule).toMatch(/mask-image:/u)
    expect(glowRule).toMatch(/assistant-html-preview-loading-morph 4\.2s/u)
    expect(glowRule).toMatch(/assistant-html-preview-loading-breathe 1\.9s/u)
    expect(conversationStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.assistant-html-preview-loading-glow\s*\{[^}]*animation:\s*none;/u
    )
  })

  it("places the new-task welcome group slightly below the geometric center", () => {
    const welcomeColumnRule = conversationStyles.match(
      /\.conversation-column-welcome\s*\{([^}]*)\}/u
    )?.[1]
    const welcomeRule = conversationStyles.match(
      /\.conversation-welcome\s*\{([^}]*)\}/u
    )?.[1]

    expect(welcomeColumnRule).toMatch(
      /--conversation-welcome-offset-y:\s*clamp\(28px,\s*3vh,\s*36px\);/u
    )
    expect(welcomeRule).toMatch(
      /transform:\s*translateY\(var\(--conversation-welcome-offset-y\)\);/u
    )
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-column-welcome\s*\{[^}]*--conversation-welcome-offset-y:\s*14px;/u
    )
  })

  it("lays out the four new-task starter questions as a responsive two-by-two grid", () => {
    const gridRule = conversationStyles.match(
      /\.conversation-starter-questions\s*\{([^}]*)\}/u
    )?.[1]
    const questionRule = conversationStyles.match(
      /\.conversation-starter-question\s*\{([^}]*)\}/u
    )?.[1]
    const interactiveRule = conversationStyles.match(
      /\.conversation-starter-question:hover,\s*\.conversation-starter-question:focus-visible\s*\{([^}]*)\}/u
    )?.[1]

    expect(gridRule).toMatch(
      /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u
    )
    expect(gridRule).toMatch(/gap:\s*16px;/u)
    expect(gridRule).toMatch(/width:\s*min\(100%,\s*780px\);/u)
    expect(questionRule).toMatch(/border-color:\s*var\(--app-border\);/u)
    expect(questionRule).toMatch(/border-radius:\s*18px;/u)
    expect(questionRule).toMatch(/min-height:\s*112px;/u)
    expect(questionRule).toMatch(/gap:\s*18px;/u)
    expect(questionRule).toMatch(/padding:\s*18px 20px;/u)
    expect(questionRule).toMatch(/box-shadow:\s*none;/u)
    expect(interactiveRule).toMatch(/background:\s*var\(--app-hover-subtle\);/u)
    expect(conversationStyles).toMatch(
      /\.conversation-starter-question-icon\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;[^}]*background:\s*transparent;/u
    )
    expect(conversationStyles).toMatch(
      /\.conversation-starter-question-icon > svg\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/u
    )
    expect(conversationStyles).toMatch(
      /--app-starter-file:\s*#4f73c7;[\s\S]*--app-starter-knowledge:\s*#8661bb;[\s\S]*--app-starter-data:\s*#23877a;[\s\S]*--app-starter-deliverable:\s*#b87532;/u
    )
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-starter-questions\s*\{[^}]*gap:\s*12px;[^}]*\}[\s\S]*?\.conversation-starter-question\s*\{[^}]*min-height:\s*148px;[^}]*flex-direction:\s*column;[^}]*padding:\s*14px;[\s\S]*?\.conversation-starter-question-icon\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;/u
    )
  })

  it("limits the top task title width while keeping title truncation", () => {
    const titleActionsRule = conversationStyles.match(
      /\.conversation-title-actions\s*\{([^}]*)\}/u
    )?.[1]
    const titleRule = conversationStyles.match(
      /\.conversation-top-bar h1\s*\{([^}]*)\}/u
    )?.[1]

    expect(titleActionsRule).toMatch(
      /max-width:\s*min\(360px,\s*calc\(100% - 48px\)\);/u
    )
    expect(titleRule).toMatch(/min-width:\s*0;/u)
    expect(titleRule).toMatch(/overflow:\s*hidden;/u)
    expect(titleRule).toMatch(/text-overflow:\s*ellipsis;/u)
    expect(titleRule).toMatch(/white-space:\s*nowrap;/u)
  })

  it("uses a compact task top bar with a subtle divider", () => {
    const topBarRule = conversationStyles.match(
      /^\.conversation-top-bar\s*\{([^}]*)\}/mu
    )?.[1]

    expect(topBarRule).toMatch(
      /height:\s*var\(--conversation-top-bar-height\);/u
    )
    expect(topBarRule).toMatch(
      /border-bottom:\s*1px solid var\(--app-divider\);/u
    )
  })

  it("shows application management details through a compact title info control", () => {
    const applicationInfoTriggerRule = conversationStyles.match(
      /\.conversation-application-info-trigger\s*\{([^}]*)\}/u
    )?.[1]
    const applicationInfoTriggerHoverRule = conversationStyles.match(
      /\.conversation-application-info-trigger:hover,\s*\.conversation-application-info-trigger:focus-visible\s*\{([^}]*)\}/u
    )?.[1]
    const applicationInfoCardRule = conversationStyles.match(
      /\.conversation-application-info-card\s*\{([^}]*)\}/u
    )?.[1]
    const applicationInfoTitleRule = conversationStyles.match(
      /\.conversation-application-info-title\s*\{([^}]*)\}/u
    )?.[1]
    const applicationInfoDescriptionRule = conversationStyles.match(
      /\.conversation-application-info-description\s*\{([^}]*)\}/u
    )?.[1]

    expect(applicationInfoTriggerRule).toMatch(/flex:\s*0 0 auto;/u)
    expect(applicationInfoTriggerRule).toMatch(/inline-size:\s*26px;/u)
    expect(applicationInfoTriggerRule).toMatch(/block-size:\s*26px;/u)
    expect(applicationInfoTriggerRule).toMatch(/border-radius:\s*999px;/u)
    expect(applicationInfoTriggerRule).toMatch(/color:\s*var\(--app-muted\);/u)
    expect(applicationInfoTriggerHoverRule).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--app-muted\) 10%,\s*transparent\);/u
    )
    expect(applicationInfoTriggerHoverRule).toMatch(
      /color:\s*var\(--app-text\);/u
    )
    expect(applicationInfoCardRule).toMatch(
      /width:\s*min\(360px, calc\(100vw - 32px\)\);/u
    )
    expect(applicationInfoCardRule).toMatch(/padding:\s*12px;/u)
    expect(applicationInfoTitleRule).toMatch(/font-weight:\s*600;/u)
    expect(applicationInfoDescriptionRule).toMatch(
      /color:\s*var\(--app-muted\);/u
    )
    expect(applicationInfoDescriptionRule).toMatch(
      /font-size:\s*var\(--app-font-12\);/u
    )

    expect(conversationStyles).not.toMatch(
      /\.conversation-application-notice\s*\{/u
    )
  })
})

describe("conversation message spacing", () => {
  it("uses a compact base gap between consecutive conversation entries", () => {
    const messageRowRule = conversationStyles.match(
      /\.message-row\s*\{([^}]*)\}/u
    )?.[1]
    const turnSummaryRule = conversationStyles.match(
      /\.turn-summary\s*\{([^}]*)\}/u
    )?.[1]

    expect(messageRowRule).toMatch(/margin-top:\s*20px;/u)
    expect(turnSummaryRule).toMatch(/margin-top:\s*20px;/u)
  })

  it("keeps site favicons compact without inheriting Markdown image spacing", () => {
    const iconRule = conversationStyles.match(
      /\.assistant-markdown \.site-link-icon\s*\{([^}]*)\}/u
    )?.[1]
    const iconMediaRule = conversationStyles.match(
      /\.assistant-markdown \.site-link-icon\[data-slot="site-link-icon"\] > img,\s*\.assistant-markdown \.site-link-icon\[data-slot="site-link-icon"\] > svg\s*\{([^}]*)\}/u
    )?.[1]

    expect(iconRule).toMatch(/display:\s*inline-flex;/u)
    expect(iconRule).toMatch(/width:\s*14px;/u)
    expect(iconRule).toMatch(/height:\s*14px;/u)
    expect(iconRule).toMatch(/margin-inline-end:\s*0\.28em;/u)
    expect(iconMediaRule).toMatch(/max-width:\s*none;/u)
    expect(iconMediaRule).toMatch(/max-height:\s*none;/u)
    expect(iconMediaRule).toMatch(/margin:\s*0;/u)
    expect(iconMediaRule).toMatch(/border:\s*0;/u)
    expect(conversationStyles).toMatch(
      /\.assistant-markdown img:not\(\.conversation-image-thumbnail-image\)\s*\{/u
    )
  })

  it("aligns source-link favicons with their URLs and uses the themed link color", () => {
    const sourceLinkRule = conversationStyles.match(
      /\.assistant-markdown \.assistant-markdown-source-link-stack > a\s*\{([^}]*)\}/u
    )?.[1]
    const sourceIconRule = conversationStyles.match(
      /\.assistant-markdown\s+\.assistant-markdown-source-link-stack\s+>\s+a\s+>\s+\.site-link-icon\s*\{([^}]*)\}/u
    )?.[1]
    const markdownLinkRule = conversationStyles.match(
      /\.assistant-markdown a\s*\{([^}]*)\}/u
    )?.[1]
    const markdownLinkHoverRule = conversationStyles.match(
      /\.assistant-markdown a:hover\s*\{([^}]*)\}/u
    )?.[1]

    expect(sourceLinkRule).toMatch(/display:\s*inline-flex;/u)
    expect(sourceLinkRule).toMatch(/align-items:\s*center;/u)
    expect(sourceLinkRule).toMatch(/gap:\s*6px;/u)
    expect(sourceLinkRule).toMatch(
      /line-height:\s*var\(--app-ui-copy-line-height\);/u
    )
    expect(sourceIconRule).toMatch(/flex:\s*0 0 14px;/u)
    expect(sourceIconRule).toMatch(/align-self:\s*center;/u)
    expect(sourceIconRule).toMatch(/margin-inline-end:\s*0;/u)
    expect(sourceIconRule).toMatch(/vertical-align:\s*baseline;/u)
    expect(markdownLinkRule).toMatch(/color:\s*var\(--app-link\);/u)
    expect(markdownLinkHoverRule).toMatch(/color:\s*var\(--app-link-hover\);/u)
    expect(conversationStyles).toMatch(/--app-link:\s*#174a7e;/u)
    expect(conversationStyles).toMatch(/--app-link-hover:\s*#123b68;/u)
  })

  it("renders knowledge citation markers as compact borderless gray numbered circles", () => {
    const inlineRule = conversationStyles.match(
      /\.assistant-markdown \.knowledge-citation-inline\s*\{([^}]*)\}/u
    )?.[1]
    const inlineJoinerRule = conversationStyles.match(
      /\.assistant-markdown \.knowledge-citation-inline::before\s*\{([^}]*)\}/u
    )?.[1]
    const citationRule = conversationStyles.match(
      /\.assistant-markdown \.knowledge-citation-link\s*\{([^}]*)\}/u
    )?.[1]
    const citationHoverRule = conversationStyles.match(
      /\.assistant-markdown \.knowledge-citation-link:hover,\s*\.assistant-markdown \.knowledge-citation-link:focus-visible\s*\{([^}]*)\}/u
    )?.[1]
    const hoverCardRule = conversationStyles.match(
      /\.knowledge-citation-hover-card\s*\{([^}]*)\}/u
    )?.[1]
    const hoverCardHeaderRule = conversationStyles.match(
      /\.knowledge-citation-hover-card-header\s*\{([^}]*)\}/u
    )?.[1]
    const hoverCardHeaderKickerRule = conversationStyles.match(
      /\.knowledge-citation-hover-card-header \.knowledge-citation-hover-card-kicker\s*\{([^}]*)\}/u
    )?.[1]
    const hoverCardActionRule = conversationStyles.match(
      /\.knowledge-citation-hover-card-action\s*\{([^}]*)\}/u
    )?.[1]
    const hoverCardActionHoverRule = conversationStyles.match(
      /\.knowledge-citation-hover-card-action:hover,\s*\.knowledge-citation-hover-card-action:focus-visible\s*\{([^}]*)\}/u
    )?.[1]
    const hoverCardArrowRule = conversationStyles.match(
      /\.knowledge-citation-hover-card-arrow\s*\{([^}]*)\}/u
    )?.[1]
    const excerptClampRule = conversationStyles.match(
      /\.knowledge-citation-hover-card-excerpt,\s*\.knowledge-citation-hover-card-excerpt\.knowledge-citation-excerpt\s*\{([^}]*)\}/u
    )?.[1]
    const excerptMarkdownRules = Array.from(
      conversationStyles.matchAll(
        /(?:^|\n)\.knowledge-citation-hover-card-excerpt\.knowledge-citation-excerpt\s*\{([^}]*)\}/gu
      )
    )
    const excerptMarkdownRule = excerptMarkdownRules.at(-1)?.[1]

    expect(inlineRule).toMatch(/position:\s*relative;/u)
    expect(inlineRule).toMatch(/display:\s*inline-flex;/u)
    expect(inlineRule).toMatch(/margin-inline:\s*0\.14em;/u)
    expect(inlineRule).toMatch(/break-inside:\s*avoid;/u)
    expect(inlineRule).toMatch(/white-space:\s*nowrap;/u)
    expect(inlineRule).toMatch(/vertical-align:\s*super;/u)
    expect(inlineJoinerRule).toMatch(/content:\s*"\\2060";/u)
    expect(citationRule).toMatch(/display:\s*inline-flex;/u)
    expect(citationRule).toMatch(/inline-size:\s*16px;/u)
    expect(citationRule).toMatch(/block-size:\s*16px;/u)
    expect(citationRule).toMatch(/border:\s*0;/u)
    expect(citationRule).toMatch(/border-radius:\s*999px;/u)
    expect(citationRule).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--app-muted\) 10%,\s*transparent\);/u
    )
    expect(citationRule).toMatch(/font-size:\s*0\.68em;/u)
    expect(citationRule).toMatch(/vertical-align:\s*baseline;/u)
    expect(citationHoverRule).toMatch(
      /background:\s*color-mix\(in srgb,\s*var\(--app-muted\) 16%,\s*transparent\);/u
    )
    expect(citationHoverRule).not.toMatch(/border-color/u)
    expect(citationHoverRule).toMatch(/text-decoration:\s*none;/u)
    expect(hoverCardRule).toMatch(
      /width:\s*min\(340px, calc\(100vw - 32px\)\);/u
    )
    expect(hoverCardRule).toMatch(/background:\s*var\(--app-popover\);/u)
    expect(hoverCardRule).toMatch(/box-shadow:\s*var\(--app-shadow\);/u)
    expect(hoverCardRule).not.toMatch(/box-shadow:[^;]*var\(--app-text\)/u)
    expect(hoverCardRule).not.toMatch(/position:\s*absolute;/u)
    expect(hoverCardRule).not.toMatch(/transform:\s*translateX/u)
    expect(hoverCardHeaderRule).toMatch(/display:\s*flex;/u)
    expect(hoverCardHeaderRule).toMatch(/align-items:\s*center;/u)
    expect(hoverCardHeaderRule).toMatch(/gap:\s*8px;/u)
    expect(hoverCardHeaderKickerRule).toMatch(/flex:\s*1 1 auto;/u)
    expect(hoverCardActionRule).toMatch(/display:\s*inline-flex;/u)
    expect(hoverCardActionRule).toMatch(/inline-size:\s*28px;/u)
    expect(hoverCardActionRule).toMatch(/block-size:\s*28px;/u)
    expect(hoverCardActionRule).toMatch(/border-radius:\s*999px;/u)
    expect(hoverCardActionRule).toMatch(/color:\s*var\(--app-muted\);/u)
    expect(hoverCardActionHoverRule).toMatch(/color:\s*var\(--app-text\);/u)
    expect(hoverCardArrowRule).toMatch(/inline-size:\s*16px;/u)
    expect(hoverCardArrowRule).toMatch(/block-size:\s*16px;/u)
    expect(excerptClampRule).toMatch(/display:\s*-webkit-box;/u)
    expect(excerptClampRule).toMatch(/overflow:\s*hidden;/u)
    expect(excerptClampRule).toMatch(/-webkit-box-orient:\s*vertical;/u)
    expect(excerptClampRule).toMatch(/-webkit-line-clamp:\s*4;/u)
    expect(excerptMarkdownRule).toMatch(/border:\s*0;/u)
    expect(excerptMarkdownRule).toMatch(/background:\s*transparent;/u)
    expect(excerptMarkdownRule).toMatch(/padding:\s*0;/u)
  })

  it("tightens only the gap from a user message to the following assistant turn", () => {
    const adjacentTurnRule = conversationStyles.match(
      /\.message-row-user\s*\+\s*\.turn-summary\s*\{([^}]*)\}/u
    )?.[1]

    expect(adjacentTurnRule).toMatch(/margin-top:\s*14px;/u)
  })

  it("keeps the final reply close to its turn status", () => {
    const finalReplyRule = conversationStyles.match(
      /\.turn-summary\s*\+\s*\.message-row-assistant\s*\{([^}]*)\}/u
    )?.[1]

    expect(finalReplyRule).toMatch(/margin-top:\s*12px;/u)
  })

  it("keeps Markdown code controls anchored and always visible", () => {
    const copyBlockRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-copy-block\s*\{([^}]*)\}/u
    )?.[1]
    const sharedButtonRule = conversationStyles.match(
      /\.markdown-copy-button,\s*\.markdown-preview-button,\s*\.markdown-html-code-toggle-button,\s*\.markdown-table-expand-button\s*\{([^}]*)\}/u
    )?.[1]
    const copyButtonRule = conversationStyles.match(
      /\.markdown-copy-button\s*\{([^}]*)\}/u
    )?.[1]
    const previewButtonRule = conversationStyles.match(
      /\.markdown-preview-button\s*\{([^}]*)\}/u
    )?.[1]
    const htmlPreviewRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-html-code-preview\s*\{([^}]*)\}/u
    )?.[1]
    const htmlPreviewSectionRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-html-code-preview > section\s*\{([^}]*)\}/u
    )?.[1]
    const htmlCodeButtonRule = conversationStyles.match(
      /\n\n\.markdown-html-code-toggle-button\s*\{([^}]*)\}/u
    )?.[1]

    expect(copyBlockRule).toMatch(/position:\s*relative;/u)
    expect(sharedButtonRule).toMatch(/background:\s*#fff;/u)
    expect(sharedButtonRule).not.toMatch(/background:\s*transparent;/u)
    expect(sharedButtonRule).not.toMatch(/box-shadow:/u)
    expect(sharedButtonRule).toMatch(/opacity:\s*1;/u)
    expect(sharedButtonRule).toMatch(/pointer-events:\s*auto;/u)
    expect(copyButtonRule).toMatch(/position:\s*absolute;/u)
    expect(copyButtonRule).toMatch(/top:\s*6px;/u)
    expect(copyButtonRule).toMatch(/right:\s*6px;/u)
    expect(previewButtonRule).toMatch(/position:\s*absolute;/u)
    expect(previewButtonRule).toMatch(/top:\s*6px;/u)
    expect(previewButtonRule).toMatch(/right:\s*34px;/u)
    expect(htmlPreviewRule).toMatch(/position:\s*relative;/u)
    expect(htmlPreviewRule).toMatch(/width:\s*100%;/u)
    expect(htmlPreviewRule).toMatch(/max-width:\s*100%;/u)
    expect(htmlPreviewSectionRule).toMatch(/width:\s*100%;/u)
    expect(htmlPreviewSectionRule).toMatch(/max-width:\s*100%;/u)
    expect(htmlCodeButtonRule).toMatch(/position:\s*absolute;/u)
    expect(htmlCodeButtonRule).toMatch(/top:\s*8px;/u)
    expect(htmlCodeButtonRule).toMatch(/right:\s*8px;/u)
    expect(conversationStyles).not.toMatch(
      /\.markdown-copy-block:hover\s*>\s*\.markdown-copy-button/u
    )
    expect(conversationStyles).toMatch(
      /\.assistant-markdown \.markdown-copy-block-code\s*>\s*pre\s*\{[^}]*padding-right:\s*48px;/u
    )
  })

  it("shows borderless table action backgrounds only on interaction", () => {
    const tableToolbarRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-table-toolbar\s*\{([^}]*)\}/u
    )?.[1]
    const visibleTableToolbarRule = conversationStyles.match(
      /\.assistant-markdown\s+\.markdown-copy-block-table:hover\s+\.markdown-table-toolbar,[\s\S]*?\.markdown-copy-block-table:focus-within\s+\.markdown-table-toolbar\s*\{([^}]*)\}/u
    )?.[1]
    const tableActionRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-table-toolbar \.markdown-copy-button,\s*\.assistant-markdown \.markdown-table-expand-button\s*\{([^}]*)\}/u
    )?.[1]
    const tableActionHoverRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-table-toolbar \.markdown-copy-button:hover,[\s\S]*?\.assistant-markdown \.markdown-table-expand-button:focus-visible\s*\{([^}]*)\}/u
    )?.[1]

    expect(tableToolbarRule).toMatch(/position:\s*absolute;/u)
    expect(tableToolbarRule).toMatch(/top:\s*3px;/u)
    expect(tableToolbarRule).toMatch(/right:\s*4px;/u)
    expect(tableToolbarRule).toMatch(/opacity:\s*0;/u)
    expect(tableToolbarRule).toMatch(/pointer-events:\s*none;/u)
    expect(visibleTableToolbarRule).toMatch(/opacity:\s*1;/u)
    expect(visibleTableToolbarRule).toMatch(/pointer-events:\s*auto;/u)
    expect(tableActionRule).toMatch(/border-color:\s*transparent;/u)
    expect(tableActionRule).toMatch(/background:\s*transparent;/u)
    expect(tableActionRule).toMatch(/color:\s*var\(--app-muted\);/u)
    expect(tableActionHoverRule).toMatch(/border-color:\s*transparent;/u)
    expect(tableActionHoverRule).toMatch(/background:\s*var\(--app-hover\);/u)
    expect(tableActionHoverRule).toMatch(/color:\s*var\(--app-text\);/u)
  })

  it("sizes Markdown table columns from their content before allowing horizontal scroll", () => {
    const tableRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-responsive-table,\s*\.markdown-table-dialog \.markdown-responsive-table\s*\{([^}]*)\}/u
    )?.[1]
    const cellRule = conversationStyles.match(
      /\.assistant-markdown \.markdown-copy-block-table th,\s*\.assistant-markdown \.markdown-copy-block-table td,\s*\.markdown-table-dialog th,\s*\.markdown-table-dialog td\s*\{([^}]*)\}/u
    )?.[1]

    expect(tableRule).toMatch(/display:\s*table;/u)
    expect(tableRule).toMatch(/width:\s*max-content;/u)
    expect(tableRule).toMatch(/min-width:\s*100%;/u)
    expect(tableRule).toMatch(/max-width:\s*none;/u)
    expect(tableRule).toMatch(/table-layout:\s*auto;/u)
    expect(cellRule).toMatch(/min-width:\s*0;/u)
    expect(cellRule).toMatch(/max-width:\s*min\(36rem,\s*70vw\);/u)
    expect(cellRule).toMatch(/overflow-wrap:\s*anywhere;/u)
    expect(cellRule).toMatch(/white-space:\s*normal;/u)
    expect(conversationStyles).not.toMatch(
      /\.markdown-copy-block-table (?:th|td):(?:first-child|not\(:first-child\))[^}]*min-width:/u
    )
    expect(conversationStyles).not.toMatch(
      /\.assistant-markdown \.markdown-copy-block-table th:first-child,[^{]*\{[^}]*position:\s*sticky;[^}]*left:\s*0;/u
    )
    expect(conversationStyles).not.toMatch(
      /\.markdown-table-dialog (?:th|td):first-child\s*\{[^}]*left:\s*0;/u
    )
  })

  it("keeps Markdown tables as tables in narrow containers", () => {
    expect(conversationStyles).not.toMatch(/data-table-card/u)
    expect(conversationStyles).not.toMatch(
      /@container assistant-markdown-table/u
    )
  })

  it("uses the user-message surface for Markdown code backgrounds", () => {
    const inlineCodeRule = conversationStyles.match(
      /\.assistant-markdown :not\(pre\) > code\s*\{([^}]*)\}/u
    )?.[1]
    const codeBlockRule = conversationStyles.match(
      /\.assistant-markdown pre\s*\{([^}]*)\}/u
    )?.[1]

    expect(inlineCodeRule).toMatch(/background:\s*var\(--app-user-surface\);/u)
    expect(codeBlockRule).toMatch(/background:\s*var\(--app-user-surface\);/u)
  })
})

describe("conversation activity typography", () => {
  it("keeps guided user messages on the normal user-message text color", () => {
    const turnSummaryRule = conversationStyles.match(
      /\.turn-summary\s*\{([^}]*)\}/u
    )?.[1]
    const userMessageRule = conversationStyles.match(
      /\.user-message\s*\{([^}]*)\}/u
    )?.[1]

    expect(turnSummaryRule).toMatch(/color:\s*var\(--app-muted\);/u)
    expect(userMessageRule).toMatch(/color:\s*var\(--app-text\);/u)
  })

  it("groups adjacent subagent statuses into horizontal agent chips", () => {
    const subAgentGroupRule = conversationStyles.match(
      /\.native-subagent-activity\s*\{([^}]*)\}/u
    )?.[1]
    const subAgentListRule = conversationStyles.match(
      /\.native-subagent-activity-list\s*\{([^}]*)\}/u
    )?.[1]
    const subAgentSegmentRule = conversationStyles.match(
      /\.native-subagent-activity-segment\s*\{([^}]*)\}/u
    )?.[1]
    const subAgentChipRule = conversationStyles.match(
      /\.native-subagent-agent\s*\{([^}]*)\}/u
    )?.[1]
    const subAgentStatusRule = conversationStyles.match(
      /\.native-subagent-status\s*\{([^}]*)\}/u
    )?.[1]
    const subAgentIconRule = conversationStyles.match(
      /\.native-subagent-agent\s*\[data-slot="subagent-icon"\]\s*\{([^}]*)\}/u
    )?.[1]

    expect(subAgentGroupRule).toMatch(/width:\s*fit-content;/u)
    expect(subAgentGroupRule).not.toMatch(/border:/u)
    expect(subAgentGroupRule).not.toMatch(/background:/u)
    expect(subAgentListRule).toMatch(/display:\s*flex;/u)
    expect(subAgentListRule).toMatch(/flex-wrap:\s*wrap;/u)
    expect(subAgentSegmentRule).toMatch(/display:\s*inline-flex;/u)
    expect(subAgentSegmentRule).toMatch(/align-items:\s*center;/u)
    expect(subAgentChipRule).toMatch(/border:\s*1px solid color-mix\(/u)
    expect(subAgentChipRule).toMatch(/background:\s*transparent;/u)
    expect(subAgentChipRule).toMatch(/color:\s*color-mix\(/u)
    expect(subAgentChipRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
    expect(subAgentChipRule).toMatch(/font-weight:\s*500;/u)
    expect(subAgentStatusRule).toMatch(/background-color:\s*transparent;/u)
    expect(subAgentStatusRule).not.toMatch(/background:\s*transparent;/u)
    expect(subAgentStatusRule).toMatch(/color:\s*var\(--app-muted\);/u)
    expect(nativeActivityItemSource).toMatch(
      /className="native-subagent-agent[^"]*\brounded-full\b/u
    )
    expect(nativeActivityItemSource).not.toMatch(
      /className="native-subagent-agent[^"]*\btext-sm\b/u
    )
    expect(nativeActivityItemSource).not.toMatch(
      /className="native-subagent-agent[^"]*\btext-foreground\b/u
    )
    expect(subAgentIconRule).toMatch(/opacity:\s*0\.72;/u)
    expect(subAgentIconRule).toMatch(/filter:\s*saturate\(0\.72\);/u)
    expect(subAgentStatusRule).toMatch(/border:\s*0;/u)
    expect(subAgentStatusRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
  })

  it("matches the completed-turn divider to the fork-source marker while hiding it during initial thinking", () => {
    const summaryHeadingRule = conversationStyles.match(
      /\.turn-summary-heading\s*\{([^}]*)\}/u
    )?.[1]
    const initialThinkingRule = conversationStyles.match(
      /\.turn-summary-heading\[data-initial-thinking="true"\]\s*\{([^}]*)\}/u
    )?.[1]

    expect(summaryHeadingRule).toMatch(/border-bottom-width:\s*1px;/u)
    expect(summaryHeadingRule).toMatch(
      /border-bottom-color:\s*var\(--app-divider\);/u
    )
    expect(initialThinkingRule).toMatch(/border-bottom-color:\s*transparent;/u)
    expect(initialThinkingRule).not.toMatch(/border-bottom-width:\s*0;/u)
    expect(initialThinkingRule).not.toMatch(/padding-bottom:\s*0;/u)
  })

  it("matches live first-response spacing to the completed response", () => {
    const completedResponseRule = conversationStyles.match(
      /\.turn-summary \+ \.message-row-assistant\s*\{([^}]*)\}/u
    )?.[1]
    const activityPanelRule = Array.from(
      conversationStyles.matchAll(/\.activity-panel\s*\{([^}]*)\}/gu)
    ).find((match) => match[1]?.includes("var(--app-ui-copy-line-height)"))?.[1]
    const activityPanelInnerRule = conversationStyles.match(
      /\.activity-panel-inner\s*\{([^}]*)\}/u
    )?.[1]
    const activityPanelParagraphRule = conversationStyles.match(
      /\.activity-panel-inner > p\s*\{([^}]*)\}/u
    )?.[1]

    expect(completedResponseRule).toMatch(/margin-top:\s*12px;/u)
    expect(activityPanelRule).toMatch(/margin-top:\s*0;/u)
    expect(activityPanelInnerRule).toMatch(/display:\s*flex;/u)
    expect(activityPanelInnerRule).toMatch(/flex-direction:\s*column;/u)
    expect(activityPanelInnerRule).toMatch(
      /gap:\s*var\(--conversation-assistant-block-gap,\s*8px\);/u
    )
    expect(activityPanelInnerRule).toMatch(/padding:\s*12px 0 0;/u)
    expect(activityPanelParagraphRule).toMatch(/margin-block:\s*0;/u)
    expect(conversationStyles).not.toMatch(
      /\.activity-panel-inner > \.process-commentary:first-child/u
    )
  })

  it("matches thinking and processed status labels to the configured UI font size", () => {
    expect(conversationStyles).toMatch(
      /\.turn-status\s*\{[^}]*font-size:\s*var\(--app-ui-font-size\);[^}]*font-weight:\s*500;[^}]*line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(conversationStyles).toMatch(
      /\.turn-thinking-activity\s*\{[^}]*font-size:\s*var\(--app-ui-font-size\);[^}]*font-weight:\s*500;[^}]*line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
  })

  it("keeps execution durations readable while secondary to the status label", () => {
    expect(conversationStyles).toMatch(
      /\.turn-duration\s*\{[^}]*font-size:\s*var\(--app-font-13\);[^}]*font-weight:\s*500;[^}]*line-height:\s*var\(--app-line-19\);/u
    )
  })

  it("keeps the turn disclosure arrow immediately after the duration", () => {
    const summaryContentRule = conversationStyles.match(
      /\.turn-summary-marker-content\s*\{([^}]*)\}/u
    )?.[1]

    expect(summaryContentRule).toMatch(/display:\s*inline-flex;/u)
    expect(summaryContentRule).toMatch(/align-items:\s*center;/u)
    expect(summaryContentRule).toMatch(/gap:\s*8px;/u)
    expect(conversationStyles).toMatch(
      /\.turn-summary-chevron\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/u
    )
  })

  it("keeps the disclosure arrow immediately beside the activity title", () => {
    const triggerRule = conversationStyles.match(
      /\.native-activity-trigger\s*\{([^}]*)\}/u
    )?.[1]

    expect(triggerRule).toMatch(/display:\s*inline-flex;/u)
    expect(triggerRule).toMatch(/width:\s*fit-content;/u)
    expect(triggerRule).toMatch(/max-width:\s*100%;/u)
    expect(triggerRule).toMatch(/justify-content:\s*flex-start;/u)
  })

  it("animates activity disclosure panels from their measured height", () => {
    const expansionMotionRule = conversationStyles.match(
      /\.activity-panel,\s*\.native-activity-details\s*\{([^}]*)\}/u
    )?.[1]
    const collapsedMotionRule = conversationStyles.match(
      /\.activity-panel\[data-starting-style\],\s*\.activity-panel\[data-ending-style\],\s*\.native-activity-details\[data-starting-style\],\s*\.native-activity-details\[data-ending-style\]\s*\{([^}]*)\}/u
    )?.[1]

    expect(conversationStyles).toMatch(
      /@media \(prefers-reduced-motion:\s*no-preference\)/u
    )
    expect(expansionMotionRule).toMatch(/box-sizing:\s*border-box;/u)
    expect(expansionMotionRule).toMatch(
      /height:\s*var\(--collapsible-panel-height\);/u
    )
    expect(expansionMotionRule).toMatch(/overflow:\s*hidden;/u)
    expect(expansionMotionRule).toMatch(/transform-origin:\s*top;/u)
    expect(expansionMotionRule).toMatch(/height 160ms/u)
    expect(expansionMotionRule).not.toMatch(/margin-top/u)
    expect(expansionMotionRule).not.toMatch(/transform\s+160ms/u)
    expect(collapsedMotionRule).toMatch(/height:\s*0;/u)
    expect(collapsedMotionRule).toMatch(/opacity:\s*0;/u)
    expect(collapsedMotionRule).not.toMatch(/translateY/u)
  })

  it("uses the Marker spacing baseline for native and legacy activity rows", () => {
    const activityRowRule = conversationStyles.match(
      /\.capability-trace-row,\s*\.activity-item\s*\{([^}]*)\}/u
    )?.[1]

    expect(activityRowRule).toMatch(/gap:\s*8px;/u)
    expect(activityRowRule).not.toMatch(/gap:\s*12px;/u)
  })

  it("uses compact medium typography for expanded activity labels", () => {
    const traceChipRules = Array.from(
      conversationStyles.matchAll(/\.trace-chip\s*\{([^}]*)\}/gu),
      (match) => match[1]
    )
    const traceChipRule = traceChipRules.at(-1)

    expect(traceChipRule).toMatch(
      /background:\s*var\(--app-context-chip-surface\);/u
    )
    expect(traceChipRule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
    expect(traceChipRule).toMatch(/font-weight:\s*500;/u)
    expect(conversationStyles).toMatch(
      /\.activity-panel\s*\{[^}]*font-size:\s*var\(--app-font-13\);[^}]*line-height:\s*var\(--app-ui-copy-line-height\);/u
    )
    expect(conversationStyles).toMatch(
      /\.capability-trace-content\s*>\s*span:first-child,\s*\.conversation-marker-content\s*>\s*span:not\(\.trace-chip\)\s*\{[^}]*font-weight:\s*500;/u
    )
    expect(conversationStyles).toMatch(
      /\.native-activity-details\s*\{[^}]*font-size:\s*var\(--app-font-13\);[^}]*font-weight:\s*500;[^}]*line-height:\s*var\(--app-ui-copy-line-height\);/u
    )
    expect(conversationStyles).toMatch(
      /\.native-activity-details-inner\s*\{[^}]*padding:\s*2px 0 7px 22px;/u
    )
    expect(conversationStyles).toMatch(
      /\.native-command-activity-details \.native-activity-details-inner\s*\{[^}]*padding-left:\s*0;/u
    )
    expect(conversationStyles).toMatch(
      /\.native-activity-details code\s*\{[^}]*font-size:\s*1em;[^}]*font-weight:\s*500;/u
    )
  })

  it("keeps native image preview errors readable without overflowing details", () => {
    const inlineStateRule = conversationStyles.match(
      /\.assistant-inline-image-state\s*\{([^}]*)\}/u
    )?.[1]
    const inlineStateTextRule = conversationStyles.match(
      /\.assistant-inline-image-state-text\s*\{([^}]*)\}/u
    )?.[1]
    const retryRule = conversationStyles.match(
      /\.assistant-inline-image-retry\s*\{([^}]*)\}/u
    )?.[1]
    const detailCodeRule = conversationStyles.match(
      /\.native-activity-detail-grid dd code\s*\{([^}]*)\}/u
    )?.[1]
    const nativePreviewRule = conversationStyles.match(
      /\.native-activity-image-preview:has\(\.assistant-inline-image-state\)\s*\{([^}]*)\}/u
    )?.[1]
    const nativePreviewStateRule = conversationStyles.match(
      /\.native-activity-image-preview \.assistant-inline-image-state\s*\{([^}]*)\}/u
    )?.[1]
    const nativePreviewErrorRule = conversationStyles.match(
      /\.native-activity-image-preview \.assistant-inline-image-error\s*\{([^}]*)\}/u
    )?.[1]

    expect(inlineStateRule).toMatch(/width:\s*fit-content;/u)
    expect(inlineStateRule).toMatch(/min-width:\s*0;/u)
    expect(inlineStateTextRule).toMatch(/min-width:\s*0;/u)
    expect(inlineStateTextRule).toMatch(/overflow-wrap:\s*anywhere;/u)
    expect(retryRule).toMatch(/margin-left:\s*auto;/u)
    expect(detailCodeRule).toMatch(/max-width:\s*100%;/u)
    expect(detailCodeRule).toMatch(/word-break:\s*break-word;/u)
    expect(nativePreviewRule).toMatch(/width:\s*min\(100%,\s*360px\);/u)
    expect(nativePreviewStateRule).toMatch(/display:\s*flex;/u)
    expect(nativePreviewStateRule).toMatch(/width:\s*100%;/u)
    expect(nativePreviewErrorRule).toMatch(/min-height:\s*56px;/u)
    expect(nativePreviewErrorRule).toMatch(/border-style:\s*solid;/u)
  })

  it("fills image preview boxes without stretching the image", () => {
    const previewImageRule = conversationStyles.match(
      /\.conversation-image-thumbnail-image,\s*\.native-activity-image-preview-image\s*\{([^}]*)\}/u
    )?.[1]

    expect(previewImageRule).toMatch(/object-fit:\s*cover;/u)
    expect(previewImageRule).toMatch(/object-position:\s*center;/u)
  })

  it("uses a stable centered image placeholder without visible loading copy", () => {
    const placeholderRule = conversationStyles.match(
      /\.assistant-inline-image-placeholder\s*\{([^}]*)\}/u
    )?.[1]
    const thumbnailPlaceholderRule = conversationStyles.match(
      /\.assistant-inline-image-thumbnail-placeholder\s*\{([^}]*)\}/u
    )?.[1]

    expect(placeholderRule).toMatch(/display:\s*flex;/u)
    expect(placeholderRule).toMatch(/align-items:\s*center;/u)
    expect(placeholderRule).toMatch(/justify-content:\s*center;/u)
    expect(placeholderRule).toMatch(/aspect-ratio:\s*16\s*\/\s*9;/u)
    expect(placeholderRule).toMatch(
      /background:\s*color-mix\(\s*in srgb,\s*var\(--app-artifact-surface\) 50%,\s*transparent\s*\);/u
    )
    expect(placeholderRule).toMatch(
      /color:\s*color-mix\(in srgb,\s*var\(--app-muted\) 55%,\s*transparent\);/u
    )
    expect(thumbnailPlaceholderRule).toMatch(/width:\s*94px;/u)
    expect(thumbnailPlaceholderRule).toMatch(/height:\s*88px;/u)
    expect(thumbnailPlaceholderRule).toMatch(/margin-block:\s*0;/u)
  })

  it("uses a compact muted thumbnail when an external Markdown image fails", () => {
    const errorRule = conversationStyles.match(
      /\.conversation-image-thumbnail-error\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = conversationStyles.match(
      /\.conversation-image-thumbnail-error-icon\s*\{([^}]*)\}/u
    )?.[1]
    const labelRule = conversationStyles.match(
      /\.conversation-image-thumbnail-error-label\s*\{([^}]*)\}/u
    )?.[1]

    expect(errorRule).toMatch(/display:\s*grid;/u)
    expect(errorRule).toMatch(/width:\s*94px;/u)
    expect(errorRule).toMatch(/height:\s*88px;/u)
    expect(errorRule).toMatch(/place-content:\s*center;/u)
    expect(errorRule).toMatch(/border:\s*0\.5px dashed/u)
    expect(iconRule).toMatch(/width:\s*28px;/u)
    expect(iconRule).toMatch(/height:\s*28px;/u)
    expect(labelRule).toMatch(/font-size:\s*10px;/u)
    expect(labelRule).toMatch(/text-overflow:\s*ellipsis;/u)
  })

  it("centers detail icons against the first text line", () => {
    const rowRule = conversationStyles.match(
      /\.native-activity-detail-lines\s*>\s*li\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = conversationStyles.match(
      /\.native-activity-detail-lines\s*>\s*li\s*>\s*svg\s*\{([^}]*)\}/u
    )?.[1]

    expect(rowRule).toMatch(/align-items:\s*flex-start;/u)
    expect(iconRule).toMatch(
      /margin-top:\s*calc\(\(var\(--app-ui-copy-line-height\) - 14px\) \/ 2\);/u
    )
  })

  it("uses subtle bordered rows for expanded command groups", () => {
    const commandRowRule = conversationStyles.match(
      /\.native-command-detail-item\s*\{([^}]*)\}/u
    )?.[1]

    expect(commandRowRule).toMatch(/border:\s*1px solid var\(--app-border\);/u)
    expect(commandRowRule).toMatch(/border-radius:\s*8px;/u)
  })

  it("aligns expanded command cards with the activity icon", () => {
    const commandDetailsRule = conversationStyles.match(
      /\.native-command-activity-details \.native-activity-details-inner\s*\{([^}]*)\}/u
    )?.[1]

    expect(commandDetailsRule).toMatch(/padding-left:\s*0;/u)
  })

  it("centers activity glyphs inside their marker icon box", () => {
    const iconRule = conversationStyles.match(
      /\.conversation-marker\s*>\s*\[data-slot="marker-icon"\]\s*\{([^}]*)\}/u
    )?.[1]

    expect(iconRule).toMatch(/display:\s*inline-flex;/u)
    expect(iconRule).toMatch(/align-items:\s*center;/u)
    expect(iconRule).toMatch(/justify-content:\s*center;/u)
  })

  it("aligns legacy activity icons with the first text line", () => {
    expect(conversationStyles).toMatch(
      /\.legacy-activity-item\s*>\s*\[data-slot="marker-icon"\]\s*\{[^}]*margin-top:\s*calc\(\(var\(--app-ui-copy-line-height\) - 16px\) \/ 2\);/u
    )
  })

  it("aligns live and completed reasoning icons with the first summary line", () => {
    const liveReasoningRule = conversationStyles.match(
      /\.live-reasoning-summary\s*\{([^}]*)\}/u
    )?.[1]
    const sharedReasoningIconRule = conversationStyles.match(
      /\.conversation-marker\s*>\s*\.reasoning-activity-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(liveReasoningRule).toMatch(/align-items:\s*flex-start;/u)
    expect(liveReasoningRule).not.toMatch(/align-items:\s*center;/u)
    expect(sharedReasoningIconRule).toMatch(
      /margin-top:\s*calc\(6px \+ \(var\(--app-ui-copy-line-height\) - 16px\) \/ 2\);/u
    )
    expect(conversationStyles).not.toMatch(
      /\.live-reasoning-summary\s*>\s*\[data-slot="marker-icon"\]\s*\{/u
    )
  })

  it("shows the complete live reasoning text without a line clamp", () => {
    const liveReasoningTextRule = conversationStyles.match(
      /\.live-reasoning-summary-text\s*\{([^}]*)\}/u
    )?.[1]

    expect(liveReasoningTextRule).toMatch(/overflow:\s*visible;/u)
    expect(liveReasoningTextRule).not.toMatch(/line-clamp/u)
    expect(liveReasoningTextRule).not.toMatch(/overflow:\s*hidden;/u)
  })

  it("centers the reasoning icon and disclosure control with the collapsed label", () => {
    expect(conversationStyles).toMatch(
      /\.reasoning-activity-row\[data-open="false"\]\s*\{[^}]*align-items:\s*center;/u
    )
    expect(conversationStyles).toMatch(
      /\.reasoning-activity-row\[data-open="false"\]\s*>\s*\.reasoning-activity-icon,\s*\.reasoning-activity-row\[data-open="false"\]\s+\.reasoning-activity-trigger\s*\{[^}]*margin-top:\s*0;/u
    )
    expect(conversationStyles).toMatch(
      /\.reasoning-activity-row\[data-open="false"\]\s+\.reasoning-activity-content\s*\{[^}]*flex:\s*0 0 auto;[^}]*align-items:\s*center;/u
    )
  })

  it("top-aligns native activity icons with multiline summaries", () => {
    const nativeActivityRule = conversationStyles.match(
      /\.native-activity-item\s*\{([^}]*)\}/u
    )?.[1]
    const nativeActivityIconRule = conversationStyles.match(
      /\.native-activity-item\s*>\s*\[data-slot="marker-icon"\]\s*\{([^}]*)\}/u
    )?.[1]

    expect(nativeActivityRule).toMatch(/align-items:\s*flex-start;/u)
    expect(nativeActivityRule).not.toMatch(/align-items:\s*center;/u)
    expect(nativeActivityIconRule).toMatch(/margin-top:\s*2px;/u)
  })

  it("keeps commentary prominent until a final answer is visible while tool activity stays muted", () => {
    expect(conversationStyles).toMatch(
      /\.turn-summary\s*\{[^}]*color:\s*var\(--app-muted\);/u
    )
    expect(conversationStyles).toMatch(
      /\.process-commentary\s*\{[^}]*--process-commentary-color:\s*var\(--app-text\);[^}]*font-weight:\s*500;/u
    )
    expect(conversationStyles).toMatch(
      /\.process-commentary\[data-final-answer-visible="true"\]\s*\{[^}]*--process-commentary-color:\s*var\(--app-muted\);/u
    )
  })

  it("uses medium weight for the text-only thinking activity", () => {
    expect(conversationStyles).toMatch(
      /\.turn-thinking-activity\s*\{[^}]*font-weight:\s*500;/u
    )
  })

  it("adds breathing room before the text-only thinking activity", () => {
    const activityPanelInnerRule = conversationStyles.match(
      /\.activity-panel-inner\s*\{([^}]*)\}/u
    )?.[1]

    expect(activityPanelInnerRule).toMatch(
      /gap:\s*var\(--conversation-assistant-block-gap,\s*8px\);/u
    )
    expect(conversationStyles).toMatch(
      /\.activity-item\s*\+\s*\.turn-thinking-activity\s*\{[^}]*margin-top:\s*0;/u
    )
  })

  it("horizontally aligns reconnect content and delegates shimmer to shadcn", () => {
    const reconnectRule = conversationStyles.match(
      /(?:^|\n)\.turn-reconnecting-activity\s*\{([^}]*)\}/u
    )?.[1]

    expect(reconnectRule).toMatch(/align-items:\s*center;/u)
    expect(reconnectRule).toMatch(/width:\s*fit-content;/u)
    expect(conversationStyles).toMatch(
      /\.turn-reconnecting-activity\s*>\s*\[data-slot="marker-icon"\]\s*\{[^}]*margin-top:\s*0;/u
    )
    expect(conversationStyles).toMatch(/@import\s+"shadcn\/tailwind\.css";/u)
    expect(conversationStyles).not.toMatch(
      /\.turn-reconnecting-activity::after/u
    )
    expect(conversationStyles).not.toMatch(/turn-reconnecting-sweep/u)
  })

  it("uses a compact token-based inline card for reconnect exhaustion", () => {
    const failureRule = conversationStyles.match(
      /\.turn-reconnect-failure\s*\{([^}]*)\}/u
    )?.[1]

    expect(failureRule).toMatch(/display:\s*flex;/u)
    expect(failureRule).toMatch(/align-items:\s*center;/u)
    expect(failureRule).toMatch(/border:\s*1px solid var\(--app-border\);/u)
    expect(failureRule).toMatch(/background:\s*transparent;/u)
  })

  it("lets the activity stack own commentary spacing without changing Markdown block spacing", () => {
    const commentaryRule = conversationStyles.match(
      /\.process-commentary\s*\{([^}]*)\}/u
    )?.[1]
    const markdownBlocksRule = conversationStyles.match(
      /\.assistant-markdown p,\s*\.assistant-markdown ul,\s*\.assistant-markdown ol,\s*\.assistant-markdown pre,\s*\.assistant-markdown blockquote,\s*\.assistant-markdown table\s*\{([^}]*)\}/u
    )?.[1]

    expect(commentaryRule).toMatch(/margin-block:\s*0;/u)
    expect(markdownBlocksRule).toMatch(/margin-block:\s*12px;/u)
  })

  it("lays out multiline external source links as a separated stack", () => {
    const sourceLinkStackRule = conversationStyles.match(
      /\.assistant-markdown \.assistant-markdown-source-link-stack\s*\{([^}]*)\}/u
    )?.[1]

    expect(sourceLinkStackRule).toMatch(/display:\s*flex;/u)
    expect(sourceLinkStackRule).toMatch(/flex-direction:\s*column;/u)
    expect(sourceLinkStackRule).toMatch(/gap:\s*12px;/u)
    expect(conversationStyles).toMatch(
      /\.assistant-markdown \.assistant-markdown-source-link-stack > br\s*\{[^}]*display:\s*none;/u
    )
    expect(conversationStyles).toMatch(
      /\.assistant-markdown \.assistant-markdown-source-link-stack > a\s*\{[^}]*display:\s*inline-flex;/u
    )
  })

  it("delegates processing shimmer and reduced motion to shadcn styles", () => {
    expect(conversationStyles).toMatch(/@import\s+"shadcn\/tailwind\.css";/u)
    expect(conversationStyles).not.toMatch(/processing-shimmer/u)
    expect(conversationStyles).not.toMatch(/processing-icon-glow/u)
  })
})

describe("presentation annotation message layout", () => {
  it("right-aligns the compact annotation trigger with the user message", () => {
    const annotationRule = conversationStyles.match(
      /\.annotation-hover\s*\{([^}]*)\}/u
    )?.[1]

    expect(annotationRule).toMatch(/display:\s*flex;/u)
    expect(annotationRule).toMatch(/width:\s*min\(420px, 82%\);/u)
    expect(annotationRule).toMatch(/justify-content:\s*flex-end;/u)
    expect(annotationRule).not.toMatch(/justify-content:\s*flex-start;/u)
    expect(conversationStyles).toMatch(
      /\.annotation-hover-content\s*\{[^}]*width:\s*min\(420px, calc\(100vw - 32px\)\);[^}]*min-width:\s*0;/u
    )
    expect(conversationStyles).toMatch(
      /\.annotation-hover-trigger\s*\{[^}]*border-color:\s*var\(--app-border\);[^}]*background:\s*var\(--app-canvas\);/u
    )
  })

  it("wraps long annotation requests and distinguishes non-interactive files", () => {
    expect(conversationStyles).toMatch(
      /\.annotation-hover-content\s*\{[^}]*min-width:\s*0;/u
    )
    expect(conversationStyles).toMatch(
      /\.annotation-hover-request\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*pre-wrap;/u
    )
    expect(conversationStyles).toMatch(
      /\.annotation-hover-file-static\s*\{[^}]*color:\s*var\(--app-muted\);/u
    )
  })
})

describe("office preview annotation batch tray layout", () => {
  it("renders the pending annotation count trigger as a blue opaque bordered pill with an even light shadow", () => {
    const annotationBatchTriggerRule = conversationStyles.match(
      /\.office-annotation-batch-trigger,\s*\.dark \.office-annotation-batch-trigger\s*\{([^}]*)\}/u
    )?.[1]
    const annotationBatchTriggerInteractiveRule = conversationStyles.match(
      /\.office-annotation-batch-trigger:hover,\s*\.office-annotation-batch-trigger:focus-visible,\s*\.office-annotation-batch-trigger\[aria-expanded="true"\]\s*\{([^}]*)\}/u
    )?.[1]

    expect(annotationBatchTriggerRule).toMatch(
      /border:\s*1px solid\s*color-mix\(in srgb, var\(--app-selection\) 72%, var\(--app-border\)\);/u
    )
    expect(annotationBatchTriggerRule).toMatch(
      /background:\s*var\(--app-selection\);/u
    )
    expect(annotationBatchTriggerRule).toMatch(/color:\s*#fff;/u)
    expect(annotationBatchTriggerRule).toMatch(
      /font-size:\s*var\(--app-font-13\);/u
    )
    expect(annotationBatchTriggerRule).toMatch(/font-weight:\s*500;/u)
    expect(annotationBatchTriggerRule).toMatch(
      /box-shadow:\s*0 0 12px rgb\(0 0 0 \/ 8%\);/u
    )
    expect(annotationBatchTriggerRule).not.toMatch(/shadow-md|transparent/u)
    expect(annotationBatchTriggerInteractiveRule).toMatch(
      /background:\s*color-mix\(in srgb, var\(--app-selection\) 88%, var\(--app-text\)\);/u
    )
    expect(annotationBatchTriggerInteractiveRule).toMatch(/color:\s*#fff;/u)
  })

  it("draws compact chat-bubble numbered markers on saved annotations", () => {
    const annotationFrameRule = conversationStyles.match(
      /\.office-annotation-frame,\s*\.office-annotation-highlight\s*\{([^}]*)\}/u
    )?.[1]
    const annotationIndexRule = conversationStyles.match(
      /\.office-annotation-number-bubble\s*\{([^}]*)\}/u
    )?.[1]
    const annotationShapeRule = conversationStyles.match(
      /\.office-annotation-number-bubble-shape\s*\{([^}]*)\}/u
    )?.[1]
    const annotationLabelRule = conversationStyles.match(
      /\.office-annotation-number-bubble-label\s*\{([^}]*)\}/u
    )?.[1]

    expect(annotationFrameRule).toMatch(
      /background:\s*color-mix\(in srgb, var\(--app-selection\) 12%, transparent\);/u
    )
    expect(annotationIndexRule).toMatch(/position:\s*absolute;/u)
    expect(annotationIndexRule).toMatch(/inline-size:\s*24px;/u)
    expect(annotationIndexRule).toMatch(/block-size:\s*24px;/u)
    expect(annotationIndexRule).toMatch(/color:\s*#fff;/u)
    expect(annotationIndexRule).not.toMatch(/transform:/u)
    expect(annotationShapeRule).toMatch(/fill:\s*var\(--app-selection\);/u)
    expect(annotationShapeRule).toMatch(/stroke:\s*var\(--app-popover\);/u)
    expect(annotationShapeRule).toMatch(/stroke-width:\s*2;/u)
    expect(annotationLabelRule).toMatch(/font-style:\s*normal;/u)
    expect(annotationLabelRule).toMatch(/font-size:\s*var\(--app-font-11\);/u)
    expect(conversationStyles).not.toMatch(
      /\.office-annotation-number-bubble::(?:before|after)/u
    )
  })

  it("uses compact annotation copy", () => {
    const requestRule = conversationStyles.match(
      /\.office-annotation-batch-request\s*\{([^}]*)\}/u
    )?.[1]

    expect(requestRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
  })
})

describe("conversation execution plan layout", () => {
  it("centers status banners below the top bar", () => {
    const overlayRule = conversationStyles.match(
      /\.conversation-top-overlay-stack\s*\{([^}]*)\}/u
    )?.[1]
    const bannerRule = conversationStyles.match(
      /\.conversation-banner-stack\s*\{([^}]*)\}/u
    )?.[1]

    expect(overlayRule).toMatch(/position:\s*absolute;/u)
    expect(overlayRule).toMatch(/top:\s*50px;/u)
    expect(overlayRule).toMatch(/right:\s*24px;/u)
    expect(overlayRule).toMatch(/left:\s*24px;/u)
    expect(overlayRule).toMatch(/align-items:\s*center;/u)
    expect(bannerRule).toMatch(
      /width:\s*min\(calc\(100% - 64px\), var\(--app-reading-width\)\);/u
    )
  })

  it("centers a compact plan indicator directly above the composer", () => {
    const dockRule = conversationStyles.match(
      /\.conversation-plan-dock\s*\{([^}]*)\}/u
    )?.[1]
    const triggerRule = conversationStyles.match(
      /\.conversation-plan-composer-trigger\s*\{([^}]*)\}/u
    )?.[1]
    expect(dockRule).toMatch(
      /width:\s*min\(100%, var\(--app-composer-width\)\);/u
    )
    expect(dockRule).toMatch(/justify-content:\s*center;/u)
    expect(triggerRule).toMatch(/min-height:\s*38px;/u)
    expect(triggerRule).toMatch(/border-radius:\s*999px;/u)
    expect(conversationStyles).not.toMatch(
      /\.conversation-plan-card-composer\[data-open="true"\]::before/u
    )
  })

  it("sizes the shared hover card to its plan content and scrolls long plans", () => {
    const contentRule = conversationStyles.match(
      /\.conversation-plan-composer-content\s*\{([^}]*)\}/u
    )?.[1]

    expect(contentRule).toMatch(/width:\s*fit-content;/u)
    expect(contentRule).not.toMatch(/min-width:/u)
    expect(contentRule).toMatch(
      /max-width:\s*min\(560px, calc\(100cqw - 48px\)\);/u
    )
    expect(contentRule).toMatch(/max-height:\s*min\(52svh, 440px\);/u)
    expect(contentRule).toMatch(/padding:\s*6px 12px;/u)
    expect(contentRule).toMatch(/overflow-y:\s*auto;/u)
    expect(contentRule).not.toMatch(
      /(?:position:\s*absolute|bottom:|left:|transform:|box-shadow:)/u
    )
  })

  it("keeps the historical plan inline without floating positioning", () => {
    const inlineRule = conversationStyles.match(
      /\.conversation-plan-card-inline\s*\{([^}]*)\}/u
    )?.[1]

    expect(inlineRule).toMatch(/margin-block:\s*12px 4px;/u)
    expect(inlineRule).toMatch(
      /var\(--app-activity-surface\) 48%,\s*var\(--app-canvas\)/u
    )
    expect(inlineRule).not.toMatch(/position:\s*(?:absolute|fixed);/u)
  })

  it("keeps banners and the composer plan inside the mobile page width", () => {
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-top-overlay-stack\s*\{[^}]*right:\s*10px;[^}]*left:\s*10px;[^}]*\}[\s\S]*?\.conversation-banner-stack\s*\{[^}]*width:\s*min\(340px, 100%\);[\s\S]*?\.conversation-plan-composer-content\s*\{[^}]*max-width:\s*min\(440px, calc\(100cqw - 20px\)\);/u
    )
    expect(conversationStyles).not.toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-plan-composer-content\s*\{[^}]*min-width:/u
    )
  })

  it("stacks multiple top banners without overlap", () => {
    const overlayRule = conversationStyles.match(
      /\.conversation-top-overlay-stack\s*\{([^}]*)\}/u
    )?.[1]
    const bannerRule = conversationStyles.match(
      /\.conversation-banner-stack\s*\{([^}]*)\}/u
    )?.[1]

    expect(overlayRule).toMatch(/flex-direction:\s*column;/u)
    expect(overlayRule).toMatch(/gap:\s*10px;/u)
    expect(bannerRule).toMatch(/position:\s*static;/u)
  })

  it("keeps queued follow-ups compact above the composer", () => {
    const pendingRule = conversationStyles.match(
      /\.pending-requests\s*\{([^}]*)\}/u
    )?.[1]
    const contextRule = conversationStyles.match(
      /\.pending-request-context\s*\{([^}]*)\}/u
    )?.[1]
    const inputRule = conversationStyles.match(
      /\.pending-request-context-input\s*\{([^}]*)\}/u
    )?.[1]

    expect(pendingRule).toMatch(/background:\s*var\(--app-composer\);/u)
    expect(pendingRule).toMatch(/width:\s*min\([\s\S]*?calc\(100% - 28px\)/u)
    expect(pendingRule).toMatch(/margin-bottom:\s*-1px;/u)
    expect(pendingRule).toMatch(/border-bottom:\s*0;/u)
    expect(pendingRule).toMatch(/border-radius:\s*20px 20px 0 0;/u)
    expect(contextRule).toMatch(/min-height:\s*40px;/u)
    expect(contextRule).toMatch(/padding:\s*6px 14px;/u)
    expect(contextRule).toMatch(/align-items:\s*center;/u)
    expect(inputRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
    expect(inputRule).toMatch(/font-weight:\s*500;/u)
    expect(inputRule).toMatch(/text-overflow:\s*ellipsis;/u)
    expect(inputRule).toMatch(/white-space:\s*nowrap;/u)
    expect(conversationStyles).toMatch(
      /\.conversation-bottom-stack:has\(\.pending-requests\)\s*\{[^}]*gap:\s*0;/u
    )
  })

  it("integrates the queued guide card with the native Goal context", () => {
    const combinedPendingRule = conversationStyles.match(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-requests\s*\{([^}]*)\}/u
    )?.[1]
    const combinedContextRule = conversationStyles.match(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-context\s*\{([^}]*)\}/u
    )?.[1]
    const combinedGoalRule = conversationStyles.match(
      /\.pending-requests\s*\+\s*\.conversation-goal-bar\s*\{([^}]*)\}/u
    )?.[1]
    const combinedHandleRule = conversationStyles.match(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-drag-handle\s*\{([^}]*)\}/u
    )?.[1]
    const combinedHandleIconRule = conversationStyles.match(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-drag-handle\s*>\s*svg\s*\{([^}]*)\}/u
    )?.[1]
    const combinedActionsRule = conversationStyles.match(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-context-actions\s*\{([^}]*)\}/u
    )?.[1]
    const combinedGuideRule = conversationStyles.match(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-context-guide\s*\{([^}]*)\}/u
    )?.[1]
    const combinedPendingActionRule = conversationStyles.match(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-context-action\s*\{([^}]*)\}/u
    )?.[1]

    expect(combinedPendingRule).toMatch(
      /width:\s*min\(calc\(100% - 56px\), calc\(var\(--app-composer-width\) - 56px\)\);/u
    )
    expect(combinedPendingRule).toMatch(/margin-bottom:\s*0;/u)
    expect(combinedPendingRule).toMatch(
      /border-bottom:\s*1px solid var\(--app-border\);/u
    )
    expect(combinedPendingRule).toMatch(/border-radius:\s*24px 24px 0 0;/u)
    expect(combinedPendingRule).toMatch(/box-shadow:\s*none;/u)
    expect(combinedContextRule).toMatch(/gap:\s*4px;/u)
    expect(combinedContextRule).toMatch(/padding:\s*6px 18px 6px 14px;/u)
    expect(combinedGoalRule).toMatch(/border-top:\s*0;/u)
    expect(combinedGoalRule).toMatch(/border-radius:\s*0;/u)
    expect(combinedHandleRule).toMatch(/width:\s*22px;/u)
    expect(combinedHandleRule).toMatch(/height:\s*22px;/u)
    expect(combinedHandleRule).toMatch(/margin-left:\s*0;/u)
    expect(combinedHandleIconRule).toMatch(/width:\s*14px;/u)
    expect(combinedHandleIconRule).toMatch(/height:\s*14px;/u)
    expect(combinedActionsRule).toMatch(/gap:\s*1px;/u)
    expect(combinedGuideRule).toMatch(/height:\s*27px;/u)
    expect(combinedGuideRule).toMatch(/min-height:\s*27px;/u)
    expect(combinedPendingActionRule).toMatch(/width:\s*27px;/u)
    expect(combinedPendingActionRule).toMatch(/height:\s*27px;/u)
    expect(conversationStyles).toMatch(
      /\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-context-guide\s*>\s*svg,[\s\S]*?\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-context-action\s*>\s*svg\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/u
    )
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-requests\s*\{[^}]*width:\s*calc\(100% - 16px\);[^}]*border-radius:\s*20px 20px 0 0;/u
    )
    expect(conversationStyles).toMatch(
      /@media \(max-width:\s*767px\)[\s\S]*?\.conversation-bottom-stack:has\(\.conversation-goal-bar\)\s*\.pending-request-context\s*\{[^}]*gap:\s*2px;[^}]*padding:\s*6px 10px 6px 6px;/u
    )
  })

  it("matches the native Goal card geometry to the referenced Composer cap", () => {
    const goalRule = conversationStyles.match(
      /\.conversation-goal-bar\s*\{([^}]*)\}/u
    )?.[1]
    const goalCopyRule = conversationStyles.match(
      /\.conversation-goal-copy\s*\{([^}]*)\}/u
    )?.[1]
    const elapsedRule = conversationStyles.match(
      /\.conversation-goal-elapsed\s*\{([^}]*)\}/u
    )?.[1]
    const actionsRule = conversationStyles.match(
      /\.conversation-goal-actions\s*\{([^}]*)\}/u
    )?.[1]
    const actionRule = conversationStyles.match(
      /\.conversation-goal-action\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = conversationStyles.match(
      /(?:^|\n)\.conversation-goal-icon\s*\{([^}]*)\}/u
    )?.[1]
    const activeIconRule = conversationStyles.match(
      /\.conversation-goal-bar\[data-status="active"\]\s*\.conversation-goal-icon\s*\{([^}]*)\}/u
    )?.[1]
    const actionIconRule = conversationStyles.match(
      /\.conversation-goal-action\s*>\s*svg\[aria-hidden="true"\]\s*\{([^}]*)\}/u
    )?.[1]

    expect(goalRule).toMatch(/display:\s*flex;/u)
    expect(goalRule).toMatch(
      /width:\s*min\(calc\(100% - 56px\), calc\(var\(--app-composer-width\) - 56px\)\);/u
    )
    expect(goalRule).toMatch(/min-height:\s*48px;/u)
    expect(goalRule).toMatch(/margin:\s*0 auto -10px;/u)
    expect(goalRule).toMatch(/padding:\s*6px 18px 8px;/u)
    expect(goalRule).toMatch(/border:\s*1px solid var\(--app-border\);/u)
    expect(goalRule).toMatch(/border-radius:\s*24px 24px 0 0;/u)
    expect(goalRule).toMatch(/box-shadow:\s*none;/u)
    expect(goalCopyRule).toMatch(/display:\s*flex;/u)
    expect(goalCopyRule).toMatch(/min-width:\s*0;/u)
    expect(elapsedRule).toMatch(/display:\s*inline-flex;/u)
    expect(conversationStyles).toMatch(
      /\.conversation-goal-elapsed::before\s*\{[^}]*content:\s*"·";/u
    )
    expect(actionsRule).toMatch(/gap:\s*1px;/u)
    expect(actionsRule).toMatch(/margin-left:\s*auto;/u)
    expect(actionRule).toMatch(/width:\s*27px;/u)
    expect(actionRule).toMatch(/height:\s*27px;/u)
    expect(activeIconRule).toMatch(
      /color:\s*color-mix\(in srgb,\s*var\(--app-muted\) 58%,\s*transparent\);/u
    )
    expect(iconRule).toMatch(/width:\s*14px;/u)
    expect(iconRule).toMatch(/height:\s*14px;/u)
    expect(iconRule).toMatch(
      /color:\s*color-mix\(in srgb,\s*var\(--app-muted\) 58%,\s*transparent\);/u
    )
    expect(actionIconRule).toMatch(/width:\s*14px;/u)
    expect(actionIconRule).toMatch(/height:\s*14px;/u)
  })

  it("keeps compact queued follow-ups separated from a plan in the bottom stack", () => {
    expect(conversationStyles).toMatch(
      /\.conversation-bottom-stack:has\(\.pending-requests\)\s*>\s*\.conversation-plan-dock\s*\{[^}]*margin-bottom:\s*14px;/u
    )
  })
})

describe("conversation artifact tile", () => {
  it("uses the shared file-card minimum width without filename-dependent expansion", () => {
    const fileRule = conversationStyles.match(/\.file-tile\s*\{([^}]*)\}/u)?.[1]
    const fileMessageRule = conversationStyles.match(
      /\.message-row-assistant \.message-content:has\(> \.file-tile\)\s*\{([^}]*)\}/u
    )?.[1]
    const artifactRule = conversationStyles.match(
      /\.artifact-tile\.file-tile\s*\{([^}]*)\}/u
    )?.[1]

    expect(fileRule).toMatch(/--conversation-file-tile-min-width:\s*420px;/u)
    expect(fileRule).toMatch(
      /width:\s*min\(100%, var\(--conversation-file-tile-min-width\)\);/u
    )
    expect(fileRule).toMatch(
      /min-width:\s*min\(100%, var\(--conversation-file-tile-min-width\)\);/u
    )
    expect(fileMessageRule).toMatch(/width:\s*100%;/u)
    expect(artifactRule).toMatch(/max-width:\s*100%;/u)
    expect(artifactRule).not.toMatch(/width:\s*fit-content;/u)
  })

  it("uses a transparent base with a subtle full-tile hover surface", () => {
    const artifactRule = conversationStyles.match(
      /\.artifact-tile\s*\{([^}]*)\}/u
    )?.[1]
    const artifactHoverRule = conversationStyles.match(
      /\.artifact-tile:hover,\s*\.artifact-tile:focus-within\s*\{([^}]*)\}/u
    )?.[1]

    expect(artifactRule).toMatch(/border:\s*1px solid var\(--app-border\);/u)
    expect(artifactRule).toMatch(/background:\s*transparent;/u)
    expect(artifactHoverRule).toMatch(
      /border-color:\s*color-mix\(in srgb, var\(--app-text\) 16%, transparent\);/u
    )
    expect(artifactHoverRule).toMatch(
      /background:\s*var\(--app-hover-subtle\);/u
    )
  })

  it("lets the assistant message stack separate direct file tiles consistently", () => {
    const assistantContentRule = conversationStyles.match(
      /\.message-row-assistant \.message-content\s*\{([^}]*)\}/u
    )?.[1]
    const directFileRule = conversationStyles.match(
      /\.message-content\s*>\s*\.file-tile\s*\{([^}]*)\}/u
    )?.[1]
    const consecutiveFileRule = conversationStyles.match(
      /\.message-content\s*>\s*\.file-tile\s*\+\s*\.file-tile\s*\{([^}]*)\}/u
    )?.[1]

    expect(assistantContentRule).toMatch(/display:\s*flex;/u)
    expect(assistantContentRule).toMatch(/flex-direction:\s*column;/u)
    expect(assistantContentRule).toMatch(
      /gap:\s*var\(--conversation-assistant-block-gap,\s*8px\);/u
    )
    expect(directFileRule).toMatch(/margin-top:\s*0;/u)
    expect(consecutiveFileRule).toMatch(/margin-top:\s*0;/u)
  })

  it("keeps the presentation button transparent and swaps its metadata for a preview cue", () => {
    const presentationHoverRule = conversationStyles.match(
      /\.artifact-presentation-open-button:hover\s*\{([^}]*)\}/u
    )?.[1]

    expect(presentationHoverRule).toMatch(/background:\s*transparent;/u)
    expect(conversationStyles).toMatch(
      /\.artifact-presentation-preview-label\s*\{[^}]*display:\s*none;/u
    )
    expect(conversationStyles).toMatch(
      /\.artifact-presentation-open-button:is\(:hover, :focus-visible\)\s*\.artifact-presentation-preview-label\s*\{[^}]*display:\s*inline;/u
    )
  })

  it("uses smaller typography for artifact names and metadata", () => {
    const artifactNameRule = conversationStyles.match(
      /\.artifact-tile \.file-tile-name\s*\{([^}]*)\}/u
    )?.[1]
    const artifactMetaRule = conversationStyles.match(
      /\.artifact-tile \.file-tile-meta\s*\{([^}]*)\}/u
    )?.[1]

    expect(artifactNameRule).toMatch(/font-size:\s*var\(--app-font-13\);/u)
    expect(artifactNameRule).toMatch(/line-height:\s*var\(--app-line-19\);/u)
    expect(artifactMetaRule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
    expect(artifactMetaRule).toMatch(/line-height:\s*var\(--app-line-18\);/u)
  })

  it("uses one slightly roomier fixed height for image and file artifacts", () => {
    const artifactFileRule = conversationStyles.match(
      /\.artifact-tile\.file-tile\s*\{([^}]*)\}/u
    )?.[1]
    const imageArtifactRule = conversationStyles.match(
      /\.artifact-image-tile\s*\{([^}]*)\}/u
    )?.[1]
    const presentationArtifactRule = conversationStyles.match(
      /\.artifact-presentation-tile\s*\{([^}]*)\}/u
    )?.[1]
    const thumbnailRule = conversationStyles.match(
      /\.artifact-image-tile \.image-preview-thumbnail\s*\{([^}]*)\}/u
    )?.[1]

    expect(artifactFileRule).toMatch(/height:\s*60px;/u)
    expect(artifactFileRule).toMatch(/min-height:\s*60px;/u)
    expect(artifactFileRule).toMatch(/align-items:\s*center;/u)
    expect(artifactFileRule).toMatch(/padding:\s*6px 8px;/u)
    expect(imageArtifactRule).not.toMatch(/padding:/u)
    expect(presentationArtifactRule).not.toMatch(/padding:/u)
    expect(thumbnailRule).toMatch(/width:\s*44px;/u)
    expect(thumbnailRule).toMatch(/height:\s*44px;/u)
  })

  it("does not reserve hidden action-row space below image artifacts", () => {
    const imageMessageRule = conversationStyles.match(
      /\.message-row-assistant:has\(\.artifact-image-tile\)\s*\{([^}]*)\}/u
    )?.[1]
    const actionRule = conversationStyles.match(
      /\.message-row-assistant:has\(\.artifact-image-tile\) \.message-actions\s*\{([^}]*)\}/u
    )?.[1]

    expect(imageMessageRule).toMatch(/position:\s*relative;/u)
    expect(actionRule).toMatch(/position:\s*absolute;/u)
    expect(actionRule).toMatch(/top:\s*100%;/u)
  })

  it("keeps the gap above absolutely positioned image actions hoverable", () => {
    const actionRule = conversationStyles.match(
      /\.message-actions\s*\{([^}]*)\}/u
    )?.[1]

    expect(actionRule).toMatch(/min-height:\s*31px;/u)
    expect(actionRule).toMatch(/padding-top:\s*3px;/u)
    expect(actionRule).not.toMatch(/margin-top:/u)
  })

  it("keeps the completed Goal marker aligned with message metadata", () => {
    const goalCompletionRule = conversationStyles.match(
      /\.message-goal-completion\s*\{([^}]*)\}/u
    )?.[1]

    expect(goalCompletionRule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
    expect(goalCompletionRule).toMatch(/font-weight:\s*400;/u)
    expect(goalCompletionRule).toMatch(/line-height:\s*28px;/u)
    expect(goalCompletionRule).not.toMatch(/border-left:/u)
    expect(conversationStyles).not.toMatch(/\.message-goal-completion::before/u)
    expect(conversationStyles).not.toMatch(
      /\.message-actions:has\(\.message-goal-completion\)/u
    )

    const goalCompletionIconRule = conversationStyles.match(
      /\.message-goal-completion-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(goalCompletionIconRule).toMatch(/width:\s*12px;/u)
    expect(goalCompletionIconRule).toMatch(/height:\s*12px;/u)
  })

  it("keeps the user Goal marker visible while preserving hover-only actions", () => {
    const goalActionsRule = conversationStyles.match(
      /\.message-actions-user-goal\s*\{([^}]*)\}/u
    )?.[1]
    const hiddenControlsRule = conversationStyles.match(
      /\.message-actions-user-goal \.message-user-action-controls\s*\{([^}]*)\}/u
    )?.[1]
    const indicatorRule = conversationStyles.match(
      /\.user-message-goal-indicator\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = conversationStyles.match(
      /\.user-message-goal-indicator-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(goalActionsRule).toMatch(/opacity:\s*1;/u)
    expect(goalActionsRule).toMatch(/transform:\s*none;/u)
    expect(hiddenControlsRule).toMatch(/opacity:\s*0;/u)
    expect(hiddenControlsRule).toMatch(/pointer-events:\s*none;/u)
    expect(indicatorRule).toMatch(/display:\s*inline-flex;/u)
    expect(indicatorRule).toMatch(/font-size:\s*var\(--app-font-12\);/u)
    expect(indicatorRule).toMatch(/font-weight:\s*400;/u)
    expect(indicatorRule).toMatch(/line-height:\s*28px;/u)
    expect(iconRule).toMatch(/width:\s*13px;/u)
    expect(iconRule).toMatch(/height:\s*13px;/u)
    expect(conversationStyles).toMatch(
      /\.message-row:hover[\s\S]*?\.message-actions-user-goal[\s\S]*?\.message-user-action-controls,[\s\S]*?\.message-row:focus-within[\s\S]*?\{[^}]*opacity:\s*1;/u
    )
  })
})

describe("user message URLs", () => {
  it("matches the composer URL color, icon size, and visual alignment", () => {
    const urlRule = conversationStyles.match(
      /\.user-message-url\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = conversationStyles.match(
      /\.user-message-url-icon\s*\{([^}]*)\}/u
    )?.[1]

    expect(urlRule).toMatch(/position:\s*relative;/u)
    expect(urlRule).toMatch(/padding-left:\s*20px;/u)
    expect(urlRule).toMatch(/color:\s*var\(--app-link\);/u)
    expect(iconRule).toMatch(/top:\s*2px;/u)
    expect(iconRule).toMatch(/left:\s*1px;/u)
    expect(iconRule).toMatch(/width:\s*14px;/u)
    expect(iconRule).toMatch(/height:\s*14px;/u)
  })
})

describe("user message attachments", () => {
  it("right-aligns attachments above the user text card", () => {
    const groupRule = conversationStyles.match(
      /\.user-message-attachments\s*\{([^}]*)\}/u
    )?.[1]
    const imageListRule = conversationStyles.match(
      /\.user-message-attachment-images\s*\{([^}]*)\}/u
    )?.[1]

    expect(groupRule).toMatch(/max-width:\s*82%;/u)
    expect(groupRule).toMatch(/flex-direction:\s*column;/u)
    expect(groupRule).toMatch(/align-items:\s*flex-end;/u)
    expect(groupRule).toMatch(/margin-bottom:\s*8px;/u)
    expect(imageListRule).toMatch(/flex-wrap:\s*wrap;/u)
    expect(imageListRule).toMatch(/justify-content:\s*flex-end;/u)
  })

  it("uses filled bordered image thumbnails and a transparent file pill", () => {
    const thumbnailRule = conversationStyles.match(
      /\.user-message-attachment-images \.image-preview-thumbnail\s*\{([^}]*)\}/u
    )?.[1]
    const triggerRule = conversationStyles.match(
      /\.user-message-attachment-images \.image-preview-thumbnail-trigger\s*\{([^}]*)\}/u
    )?.[1]
    const imageRule = conversationStyles.match(
      /\.user-message-attachment-images \.image-preview-thumbnail-trigger img\s*\{([^}]*)\}/u
    )?.[1]
    const fileRule = conversationStyles.match(
      /\.user-message-file-attachment\s*\{([^}]*)\}/u
    )?.[1]
    const previewableFileRule = conversationStyles.match(
      /\.user-message-file-attachment-previewable:hover,\s*\.user-message-file-attachment-previewable:focus-visible\s*\{([^}]*)\}/u
    )?.[1]

    expect(thumbnailRule).toMatch(/width:\s*80px;/u)
    expect(thumbnailRule).toMatch(/height:\s*80px;/u)
    expect(triggerRule).toMatch(/border:\s*1px solid var\(--app-border\);/u)
    expect(triggerRule).toMatch(/background:\s*transparent;/u)
    expect(imageRule).toMatch(/object-fit:\s*contain;/u)
    expect(imageRule).not.toMatch(/object-position:/u)
    expect(fileRule).toMatch(/min-height:\s*38px;/u)
    expect(fileRule).toMatch(/border:\s*1px solid var\(--app-border\);/u)
    expect(fileRule).toMatch(/border-radius:\s*999px;/u)
    expect(fileRule).toMatch(/background:\s*transparent;/u)
    expect(previewableFileRule).toMatch(
      /border-color:\s*color-mix\(in srgb, var\(--app-text\) 16%, transparent\);/u
    )
    expect(previewableFileRule).toMatch(
      /background:\s*var\(--app-hover-subtle\);/u
    )
  })

  it("styles the sent-message attachment overflow as a compact file pill", () => {
    const triggerRule = conversationStyles.match(
      /\.user-message-attachment-overflow-trigger\s*\{([^}]*)\}/u
    )?.[1]
    const hoverRule = conversationStyles.match(
      /\.user-message-attachment-overflow-trigger:hover,\s*\.user-message-attachment-overflow-trigger:focus-visible\s*\{([^}]*)\}/u
    )?.[1]

    expect(triggerRule).toMatch(/min-width:\s*52px;/u)
    expect(triggerRule).toMatch(/justify-content:\s*center;/u)
    expect(hoverRule).toMatch(/background:\s*var\(--app-hover-subtle\);/u)
  })

  it("keeps attachment width and image size compact on narrow screens", () => {
    const mobileStyles = conversationStyles.slice(
      conversationStyles.lastIndexOf("@media (max-width: 420px)")
    )

    expect(mobileStyles).toMatch(
      /\.user-message-attachments\s*\{[^}]*max-width:\s*90%;/u
    )
    expect(mobileStyles).toMatch(
      /\.user-message-attachment-images \.image-preview-thumbnail\s*\{[^}]*width:\s*60px;[^}]*height:\s*60px;/u
    )
  })
})

describe("user message capability badges", () => {
  it("uses a white bordered pill for selected Skills and knowledge bases", () => {
    const badgeRule = conversationStyles.match(
      /\.user-message-capability\s*\{([^}]*)\}/u
    )?.[1]
    const iconRule = conversationStyles.match(
      /\.user-message-capability-icon\s*\{([^}]*)\}/u
    )?.[1]
    const labelRule = conversationStyles.match(
      /\.user-message-capability-label\s*\{([^}]*)\}/u
    )?.[1]

    expect(badgeRule).toMatch(/height:\s*auto;/u)
    expect(badgeRule).toMatch(
      /min-height:\s*calc\(var\(--app-ui-compact-line-height\) \+ 8px\);/u
    )
    expect(badgeRule).toMatch(/font-size:\s*var\(--app-ui-font-size\);/u)
    expect(badgeRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(badgeRule).toMatch(/border:\s*1px solid var\(--app-border\);/u)
    expect(badgeRule).toMatch(/border-radius:\s*999px;/u)
    expect(badgeRule).toMatch(/background:\s*var\(--app-canvas\);/u)
    expect(badgeRule).toMatch(/color:\s*var\(--app-text\);/u)
    expect(labelRule).toMatch(/font-size:\s*var\(--app-ui-font-size\);/u)
    expect(labelRule).toMatch(
      /line-height:\s*var\(--app-ui-compact-line-height\);/u
    )
    expect(iconRule).toMatch(
      /width:\s*calc\(var\(--app-ui-font-size\) \+ 2px\);/u
    )
    expect(iconRule).toMatch(
      /height:\s*calc\(var\(--app-ui-font-size\) \+ 2px\);/u
    )
  })
})

describe("composer image attachment controls", () => {
  it("keeps a compact translucent remove circle inside a usable hit area", () => {
    const removeRule = conversationStyles.match(
      /\.image-preview-thumbnail-remove\s*\{([^}]*)\}/u
    )?.[1]
    const removeSurfaceRule = conversationStyles.match(
      /\.image-preview-thumbnail-remove::before\s*\{([^}]*)\}/u
    )?.[1]
    const removeIconRule = conversationStyles.match(
      /\.image-preview-thumbnail-remove\s*>\s*svg\s*\{([^}]*)\}/u
    )?.[1]
    const removeHoverRule = conversationStyles.match(
      /\.image-preview-thumbnail-remove:hover::before\s*\{([^}]*)\}/u
    )?.[1]

    expect(removeRule).toMatch(/width:\s*24px;/u)
    expect(removeRule).toMatch(/height:\s*24px;/u)
    expect(removeRule).toMatch(/background:\s*transparent;/u)
    expect(removeSurfaceRule).toMatch(/inset:\s*2px;/u)
    expect(removeSurfaceRule).toMatch(
      /background:\s*color-mix\(in srgb, var\(--app-canvas\) 68%, transparent\);/u
    )
    expect(removeSurfaceRule).toMatch(/backdrop-filter:\s*blur\(6px\);/u)
    expect(removeIconRule).toMatch(/width:\s*10px;/u)
    expect(removeIconRule).toMatch(/height:\s*10px;/u)
    expect(removeHoverRule).toMatch(
      /background:\s*color-mix\(in srgb, var\(--app-canvas\) 82%, transparent\);/u
    )
  })
})

describe("conversation message editor", () => {
  it("uses a shorter borderless surface with a lighter editing background", () => {
    const editorSurfaceRule = conversationStyles.match(
      /\.message-row-user\.message-row-editing \.message-content\s*\{([^}]*)\}/u
    )?.[1]
    const editorFormRule = conversationStyles.match(
      /\.message-edit-form\s*\{([^}]*)\}/u
    )?.[1]
    const editorTextareaRule = conversationStyles.match(
      /\.message-edit-textarea\s*\{([^}]*)\}/u
    )?.[1]

    expect(conversationStyles).toContain("--app-message-edit-surface: #f8f8f8;")
    expect(editorSurfaceRule).toMatch(/border:\s*0;/u)
    expect(editorSurfaceRule).toMatch(/padding:\s*12px;/u)
    expect(editorSurfaceRule).toMatch(
      /background:\s*var\(--app-message-edit-surface\);/u
    )
    expect(editorFormRule).toMatch(/gap:\s*8px;/u)
    expect(editorTextareaRule).toMatch(/min-height:\s*72px;/u)
    expect(editorTextareaRule).toMatch(/border:\s*0;/u)
    expect(editorTextareaRule).toMatch(/background:\s*transparent;/u)
  })
})
