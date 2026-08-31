import type { IconNode } from "lucide-react"

export const KNOWLEDGE_FILE_VIEWER_THEME_ATTRIBUTE =
  "data-linksense-file-viewer-theme"
export const KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE = "data-linksense-viewer-icon"
export const KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_ATTRIBUTE =
  "data-linksense-search-field"
export const KNOWLEDGE_FILE_VIEWER_SEARCH_CLEAR_ATTRIBUTE =
  "data-linksense-search-clear"

const KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_BOUND_ATTRIBUTE =
  "data-linksense-search-field-bound"

type KnowledgeFileViewerToolbarIcon =
  | "search"
  | "previous"
  | "next"
  | "clear"
  | "zoom-out"
  | "zoom-reset"
  | "zoom-in"
  | "minus"
  | "plus"
  | "rotate-ccw"
  | "rotate-cw"

// Flyfish owns this Shadow DOM, so use Lucide's icon-node geometry without
// mounting nested React roots into its buttons.
const KNOWLEDGE_FILE_VIEWER_TOOLBAR_ICONS: Record<
  KnowledgeFileViewerToolbarIcon,
  IconNode
> = {
  search: [
    ["path", { d: "m21 21-4.34-4.34" }],
    ["circle", { cx: "11", cy: "11", r: "8" }],
  ],
  previous: [["path", { d: "m15 18-6-6 6-6" }]],
  next: [["path", { d: "m9 18 6-6-6-6" }]],
  clear: [
    ["path", { d: "M18 6 6 18" }],
    ["path", { d: "m6 6 12 12" }],
  ],
  "zoom-out": [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["line", { x1: "21", x2: "16.65", y1: "21", y2: "16.65" }],
    ["line", { x1: "8", x2: "14", y1: "11", y2: "11" }],
  ],
  "zoom-reset": [
    ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
    ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
    ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
  ],
  "zoom-in": [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["line", { x1: "21", x2: "16.65", y1: "21", y2: "16.65" }],
    ["line", { x1: "11", x2: "11", y1: "8", y2: "14" }],
    ["line", { x1: "8", x2: "14", y1: "11", y2: "11" }],
  ],
  minus: [["path", { d: "M5 12h14" }]],
  plus: [
    ["path", { d: "M5 12h14" }],
    ["path", { d: "M12 5v14" }],
  ],
  "rotate-ccw": [
    ["path", { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" }],
    ["path", { d: "M3 3v5h5" }],
  ],
  "rotate-cw": [
    ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }],
    ["path", { d: "M21 3v5h-5" }],
  ],
}

export const KNOWLEDGE_FILE_VIEWER_THEME_CSS = `
.file-viewer-web-shell {
  --file-viewer-bg: var(--app-canvas);
  --file-viewer-content-bg: var(--office-viewer-canvas);
  --file-viewer-text: var(--app-text);
  --file-viewer-muted: var(--app-muted);
  --file-viewer-font: var(--app-ui-font-size) / var(--app-ui-compact-line-height) var(--font-sans);
  --file-viewer-border: var(--app-border);
  --file-viewer-toolbar-bg: var(--app-canvas);
  --file-viewer-toolbar-border: var(--app-divider);
  --file-viewer-toolbar-shadow: 0 8px 24px color-mix(in srgb, var(--app-text) 9%, transparent);
  --file-viewer-toolbar-radius: 11px;
  --file-viewer-group-bg: transparent;
  --file-viewer-group-border: transparent;
  --file-viewer-button-color: var(--app-muted);
  --file-viewer-button-hover-bg: var(--app-hover);
  --file-viewer-button-hover-color: var(--app-text);
  --file-viewer-button-disabled-color: color-mix(in srgb, var(--app-muted) 48%, transparent);
  --file-viewer-button-radius: 6px;
  --file-viewer-input-bg: transparent;
  --file-viewer-input-color: var(--app-text);
}

.file-viewer-web-shell[data-viewer-density="compact"] {
  --file-viewer-toolbar-floating-padding: 5px;
  --file-viewer-group-gap: 0;
  --file-viewer-group-padding: 0;
  --file-viewer-floating-button-min-width: 32px;
  --file-viewer-floating-button-height: 34px;
  --file-viewer-floating-icon-button-size: 32px;
  --file-viewer-floating-zoom-meter-min-width: 50px;
  --file-viewer-floating-search-input-height: 34px;
  --file-viewer-search-count-min-width: 38px;
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] {
  right: auto;
  left: 50%;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  width: max-content;
  max-width: calc(100% - 24px);
  justify-content: center;
  gap: 4px;
  overflow-x: auto;
  overflow-y: hidden;
  border-color: var(--app-border);
  border-radius: 11px;
  background: var(--app-canvas);
  box-shadow: var(--file-viewer-toolbar-shadow);
  transform: translateX(-50%);
  scrollbar-width: none;
  backdrop-filter: none;
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"]::-webkit-scrollbar {
  display: none;
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-toolbar-group {
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-toolbar-group + .file-viewer-web-toolbar-group {
  margin-left: 2px;
  padding-left: 4px;
  border-left: 1px solid var(--app-divider);
}

.file-viewer-web-shell .file-viewer-web-toolbar button,
.file-viewer-web-shell .file-viewer-web-toolbar .file-viewer-web-zoom-meter--readonly,
.file-viewer-web-shell .file-viewer-web-search-count {
  font-weight: 500;
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] button,
.file-viewer-web-shell .file-viewer-web-search input {
  border-radius: 6px;
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.file-viewer-web-shell .file-viewer-web-toolbar button:hover:not(:disabled) {
  background: var(--app-hover);
  color: var(--app-text);
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] button:active:not(:disabled):not([data-linksense-search-clear]) {
  transform: translateY(1px);
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] button:focus-visible {
  outline: 1px solid var(--app-ring);
  outline-offset: -1px;
}

.file-viewer-web-shell .file-viewer-web-toolbar [data-linksense-viewer-icon] {
  font-size: 0;
}

.file-viewer-web-shell .file-viewer-web-toolbar [data-linksense-viewer-icon] svg {
  width: 16px;
  height: 16px;
  flex: none;
  pointer-events: none;
}

.file-viewer-web-shell .pdf-toolbar [data-linksense-viewer-icon] {
  font-size: 0;
}

.file-viewer-web-shell .pdf-toolbar [data-linksense-viewer-icon] svg {
  width: 16px;
  height: 16px;
  flex: none;
  pointer-events: none;
}

.file-viewer-web-shell .file-viewer-web-search [data-linksense-search-field] {
  position: relative;
  display: flex;
  align-items: center;
  width: clamp(150px, 21vw, 210px);
  height: var(--file-viewer-floating-search-input-height);
  flex: none;
  overflow: hidden;
  border-radius: 6px;
  background: var(--app-context-chip-surface);
}

.file-viewer-web-shell .file-viewer-web-search input {
  display: block;
  min-width: 0;
  border: 0;
  padding-right: 34px;
  background: transparent;
}

/* Flyfish assigns a narrower width at the floating-toolbar specificity. */
.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-search [data-linksense-search-field] input {
  width: 100%;
  flex: 1 1 auto;
}

.file-viewer-web-shell .file-viewer-web-search input::-webkit-search-cancel-button {
  display: none;
  appearance: none;
  -webkit-appearance: none;
}

.file-viewer-web-shell .file-viewer-web-search input:hover,
.file-viewer-web-shell .file-viewer-web-search input:focus {
  background: transparent;
}

.file-viewer-web-shell .file-viewer-web-search input:focus,
.file-viewer-web-shell .file-viewer-web-search input:focus-visible {
  outline: 0;
  border: 0;
  box-shadow: none;
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] [data-linksense-search-clear] {
  position: absolute;
  top: 50%;
  right: 3px;
  width: 28px;
  min-width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  color: var(--app-muted);
  transform: translateY(-50%);
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] [data-linksense-search-clear]:hover:not(:disabled) {
  background: transparent;
  color: var(--app-muted);
}

.file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] [data-linksense-search-clear]:disabled {
  opacity: 0;
  pointer-events: none;
}

.file-viewer-web-shell .pdf-shell {
  background: var(--office-viewer-canvas);
  color: var(--app-text);
  font-family: var(--font-sans);
}

.file-viewer-web-shell .pdf-toolbar {
  min-height: 40px;
  gap: 8px;
  padding: 4px 8px;
  border-color: var(--app-divider);
  background: var(--app-canvas);
  box-shadow: none;
}

.file-viewer-web-shell .pdf-toolbar-group {
  height: 30px;
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.file-viewer-web-shell .pdf-toolbar-group--rotate {
  margin-left: 2px;
  padding-left: 6px;
  border-left: 1px solid var(--app-divider);
}

.file-viewer-web-shell .pdf-icon-button,
.file-viewer-web-shell .pdf-scale-button {
  height: 28px;
  border: 0;
  border-radius: 6px;
  color: var(--app-muted);
  font-weight: 500;
}

.file-viewer-web-shell .pdf-icon-button:hover:not(:disabled),
.file-viewer-web-shell .pdf-scale-button:hover {
  border-color: transparent;
  background: var(--app-hover-subtle);
  color: var(--app-text);
}

.file-viewer-web-shell .pdf-toolbar .pdf-icon-button--active {
  border-color: transparent;
  background: transparent;
  color: var(--app-text);
}

.file-viewer-web-shell .pdf-icon-button:focus-visible,
.file-viewer-web-shell .pdf-scale-button:focus-visible,
.file-viewer-web-shell .pdf-nav-tabs button:focus-visible,
.file-viewer-web-shell .pdf-page-button:focus-visible,
.file-viewer-web-shell .pdf-outline-button:focus-visible {
  outline: 1px solid var(--app-ring);
  outline-offset: -1px;
}

.file-viewer-web-shell .pdf-page-meter,
.file-viewer-web-shell .pdf-rotation-meter {
  color: var(--app-muted);
  font-weight: 500;
}

.file-viewer-web-shell .pdf-page-meter strong,
.file-viewer-web-shell .pdf-nav-head strong {
  color: var(--app-text);
}

.file-viewer-web-shell .pdf-content {
  grid-template-columns: clamp(142px, 18%, 188px) minmax(0, 1fr);
}

.file-viewer-web-shell .pdf-shell--nav-hidden .pdf-content {
  grid-template-columns: minmax(0, 1fr);
}

.file-viewer-web-shell .pdf-nav-pane,
.file-viewer-web-shell .pdf-nav-head,
.file-viewer-web-shell .pdf-nav-tabs {
  border-color: var(--app-divider);
  background: var(--app-canvas);
}

.file-viewer-web-shell .pdf-nav-head {
  height: 38px;
  padding-inline: 10px;
  color: var(--app-muted);
}

.file-viewer-web-shell .pdf-nav-tabs {
  gap: 0;
  padding: 0 8px;
}

.file-viewer-web-shell .pdf-nav-tabs button {
  height: 36px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--app-muted);
  font-weight: 500;
}

.file-viewer-web-shell .pdf-nav-tabs button:hover {
  border-color: transparent;
  background: transparent;
  color: var(--app-text);
}

.file-viewer-web-shell .pdf-nav-tabs button.active {
  border-color: transparent;
  background: transparent;
  box-shadow: inset 0 -2px 0 var(--app-text);
  color: var(--app-text);
}

.file-viewer-web-shell .pdf-page-list {
  gap: 0;
  padding: 5px 6px;
}

.file-viewer-web-shell .pdf-page-button,
.file-viewer-web-shell .pdf-outline-button {
  border-color: transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--app-text);
}

.file-viewer-web-shell .pdf-page-button {
  grid-template-columns: minmax(0, 1fr);
  min-height: 36px;
  gap: 6px;
  padding: 2px 8px;
}

.file-viewer-web-shell .pdf-page-button:hover,
.file-viewer-web-shell .pdf-outline-button:hover {
  border-color: transparent;
  background: var(--app-hover-subtle);
}

.file-viewer-web-shell .pdf-page-button--active {
  border-color: transparent;
  background: var(--app-context-chip-surface);
  box-shadow: none;
}

.file-viewer-web-shell .pdf-page-thumb {
  width: 24px;
  height: auto;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--app-muted);
  font-weight: 500;
}

.file-viewer-web-shell .pdf-page-button:not(.pdf-page-button--with-thumbnail) .pdf-page-thumb {
  display: none;
}

.file-viewer-web-shell .pdf-page-button--active .pdf-page-thumb {
  color: var(--app-text);
  font-weight: 600;
}

.file-viewer-web-shell .pdf-page-button--with-thumbnail {
  grid-template-columns: 42px minmax(0, 1fr);
  min-height: 62px;
}

.file-viewer-web-shell .pdf-page-thumb--thumbnail {
  width: 38px;
  height: 50px;
  border: 1px solid var(--app-divider);
  border-radius: 4px;
  background: var(--app-canvas);
}

.file-viewer-web-shell .pdf-outline-empty {
  border-color: var(--app-divider);
  background: var(--app-canvas);
  color: var(--app-muted);
}

.file-viewer-web-shell .pdf-wrapper,
.file-viewer-web-shell .image-viewer,
.file-viewer-web-shell .ofd-viewer,
.file-viewer-web-shell .pptx-viewer-shell,
.file-viewer-web-shell .ppt-binary-shell,
.file-viewer-web-shell .docx-fit-viewer,
.file-viewer-web-shell .docx-fit-viewer .docx-wrapper,
.file-viewer-web-shell .odf-viewer,
.file-viewer-web-shell .flyfish-rtf-viewer {
  background: var(--office-viewer-canvas) !important;
}

.file-viewer-web-shell .pdfViewer {
  padding: 14px 12px 24px;
}

.file-viewer-web-shell .docx-fit-viewer .docx-wrapper {
  padding: 18px 12px 32px !important;
}

.file-viewer-web-shell .docx-fit-viewer .docx-page-frame > section.docx,
.file-viewer-web-shell .docx-fit-viewer .docx-flow-frame > section.docx {
  overflow: hidden;
  border-radius: 10px;
  box-shadow: var(--word-preview-page-shadow);
}

.file-viewer-web-shell .ofd-page,
.file-viewer-web-shell .ppt-binary-page,
.file-viewer-web-shell .image-stage img {
  box-shadow: 0 4px 18px color-mix(in srgb, var(--app-text) 11%, transparent);
}

.file-viewer-web-shell .pdf-state,
.file-viewer-web-shell .ofd-state {
  gap: 9px;
  min-width: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--app-muted);
  box-shadow: none;
  font-size: var(--app-ui-font-size);
  font-weight: 500;
}

.file-viewer-web-shell .ofd-state {
  background: color-mix(in srgb, var(--office-viewer-canvas) 94%, transparent);
}

.file-viewer-web-shell .pdf-state:not(.pdf-state--error)::before,
.file-viewer-web-shell .ofd-state:not(.error)::before,
.file-viewer-web-shell .pptx-loading-dot,
.file-viewer-web-shell .ppt-binary-loading-dot {
  width: 16px;
  height: 16px;
  flex: none;
  border: 2px solid color-mix(in srgb, var(--app-muted) 24%, transparent);
  border-top-color: var(--app-text);
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  content: "";
  animation: linksense-file-viewer-spin 800ms linear infinite;
}

.file-viewer-web-shell .pdf-state--error,
.file-viewer-web-shell .ofd-state.error {
  max-width: min(460px, calc(100% - 32px));
  padding: 12px 14px;
  border: 1px solid var(--app-divider);
  border-radius: 10px;
  background: var(--app-canvas);
  color: var(--destructive);
  text-align: center;
}

.file-viewer-web-shell .pptx-loading,
.file-viewer-web-shell .ppt-binary-loading {
  top: 10px;
  gap: 9px;
  padding: 8px 11px;
  border-color: var(--app-divider);
  border-radius: 10px;
  background: color-mix(in srgb, var(--app-canvas) 94%, transparent);
  color: var(--app-muted);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--app-text) 8%, transparent);
  font-size: var(--app-font-12);
  font-weight: 500;
  backdrop-filter: blur(16px);
}

.file-viewer-web-shell .excel-wrapper,
.file-viewer-web-shell .excel-wrapper .table-wrapper {
  background: var(--app-canvas);
  color: var(--app-text);
  font-family: var(--font-sans);
}

/* The knowledge viewer surface already owns the rounded outer boundary. */
.file-viewer-web-shell .excel-wrapper .e-virt-table-stage {
  border: 0 !important;
  border-radius: 0 !important;
}

.file-viewer-web-shell .excel-wrapper .toolbar {
  min-height: 40px;
  gap: 8px;
  padding: 6px 8px;
  border-color: var(--app-divider);
  background: var(--app-canvas);
}

.file-viewer-web-shell .excel-wrapper .sheet-tab {
  min-width: 64px;
  height: 28px;
  padding-inline: 10px;
  border-color: transparent;
  border-radius: 7px;
  color: var(--app-muted);
  font-weight: 550;
}

.file-viewer-web-shell .excel-wrapper .sheet-tab:hover,
.file-viewer-web-shell .excel-wrapper .sheet-tab.active {
  border-color: transparent;
  background: var(--app-hover);
  color: var(--app-text);
}

.file-viewer-web-shell .excel-wrapper .summary,
.file-viewer-web-shell .excel-wrapper .sheet-loading-summary {
  color: var(--app-muted);
  font-weight: 500;
}

.file-viewer-web-shell .excel-wrapper .loading {
  background: color-mix(in srgb, var(--office-viewer-canvas) 94%, transparent);
  backdrop-filter: blur(3px);
}

.file-viewer-web-shell .excel-wrapper .loading-card {
  width: min(420px, calc(100% - 32px));
  gap: 11px;
  padding: 12px 14px;
  border-color: var(--app-divider);
  border-radius: 12px;
  background: var(--app-canvas);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--app-text) 9%, transparent);
}

.file-viewer-web-shell .excel-wrapper .loading-brand {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: var(--app-context-chip-surface);
  color: var(--app-text);
  font-size: var(--app-font-10);
  font-weight: 650;
}

.file-viewer-web-shell .excel-wrapper .loading-kicker {
  display: none;
}

.file-viewer-web-shell .excel-wrapper .loading-copy strong {
  margin-top: 0;
  color: var(--app-text);
  font-size: var(--app-font-13);
  font-weight: 600;
}

.file-viewer-web-shell .excel-wrapper .loading-copy p {
  margin-top: 2px;
  color: var(--app-muted);
  font-size: var(--app-font-11);
}

.file-viewer-web-shell .excel-wrapper .loading-spinner {
  width: 16px;
  height: 16px;
  border-width: 2px;
  border-color: color-mix(in srgb, var(--app-muted) 24%, transparent);
  border-top-color: var(--app-text);
}

.file-viewer-web-shell .excel-wrapper .sheet-loading {
  padding: 7px 10px;
  border-color: var(--app-divider);
  border-radius: 9px;
  background: var(--app-canvas);
  box-shadow: 0 6px 18px color-mix(in srgb, var(--app-text) 8%, transparent);
  color: var(--app-text);
  font-weight: 500;
}

.file-viewer-web-shell .excel-wrapper .sheet-loading-dot {
  background: var(--app-text);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--app-text) 10%, transparent);
}

.file-viewer-web-shell .code-viewer {
  --code-bg: var(--office-viewer-canvas);
  --code-toolbar-bg: color-mix(in srgb, var(--app-canvas) 94%, transparent);
  --code-border: var(--app-divider);
  --code-text: var(--app-text);
  --code-muted: var(--app-muted);
}

.file-viewer-web-shell .code-toolbar,
.file-viewer-web-shell .patch-toolbar,
.file-viewer-web-shell .git-bundle-toolbar {
  height: 40px;
  padding-inline: 12px;
  border-color: var(--app-divider);
  background: color-mix(in srgb, var(--app-canvas) 94%, transparent);
  box-shadow: none;
  backdrop-filter: blur(14px);
}

.file-viewer-web-shell .fv-audio-viewer,
.file-viewer-web-shell .fv-midi-viewer {
  background: var(--office-viewer-canvas);
}

.file-viewer-web-shell .fv-audio-card,
.file-viewer-web-shell .fv-midi-card {
  border-color: var(--app-divider);
  border-radius: 12px;
  background: var(--app-canvas);
  color: var(--app-text);
  box-shadow: 0 8px 26px color-mix(in srgb, var(--app-text) 9%, transparent);
}

.file-viewer-web-shell .fv-audio-copy strong,
.file-viewer-web-shell .fv-midi-card header strong,
.file-viewer-web-shell .fv-midi-stats strong,
.file-viewer-web-shell .fv-midi-table {
  color: var(--app-text);
}

.file-viewer-web-shell .fv-audio-copy p,
.file-viewer-web-shell .fv-audio-meter,
.file-viewer-web-shell .fv-midi-state,
.file-viewer-web-shell .fv-midi-stats span,
.file-viewer-web-shell .fv-midi-table th {
  color: var(--app-muted);
}

@keyframes linksense-file-viewer-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 720px) {
  .file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] {
    bottom: calc(8px + env(safe-area-inset-bottom, 0px));
    max-width: calc(100% - 16px);
  }

  .file-viewer-web-shell .file-viewer-web-toolbar[data-toolbar-position="bottom-right"] .file-viewer-web-search [data-linksense-search-field] {
    width: clamp(104px, 30vw, 136px);
  }

  .file-viewer-web-shell .pdf-content,
  .file-viewer-web-shell .pdf-shell--nav-hidden .pdf-content {
    grid-template-columns: minmax(0, 1fr);
  }

  .file-viewer-web-shell .pdf-nav-pane {
    width: min(80vw, 232px);
    box-shadow: 8px 0 22px color-mix(in srgb, var(--app-text) 10%, transparent);
  }

  .file-viewer-web-shell .pdfViewer {
    padding: 10px 8px 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .file-viewer-web-shell .pdf-state:not(.pdf-state--error)::before,
  .file-viewer-web-shell .ofd-state:not(.error)::before,
  .file-viewer-web-shell .pptx-loading-dot,
  .file-viewer-web-shell .ppt-binary-loading-dot,
  .file-viewer-web-shell .excel-wrapper .loading-spinner {
    animation: none;
  }
}
`

function resolveKnowledgeFileViewerToolbarIcon(
  button: HTMLButtonElement
): KnowledgeFileViewerToolbarIcon | null {
  const label = button.textContent?.trim()
  const searchGroup = button.closest(".file-viewer-web-search")

  if (searchGroup) {
    if (button.type === "submit") return "search"
    if (label === "<") return "previous"
    if (label === ">") return "next"
    if (button.hasAttribute(KNOWLEDGE_FILE_VIEWER_SEARCH_CLEAR_ATTRIBUTE)) {
      return "clear"
    }
    return null
  }

  if (
    button.closest(".pdf-toolbar") &&
    button.classList.contains("pdf-icon-button")
  ) {
    if (label === "−" || label === "-") return "minus"
    if (label === "+") return "plus"
    if (label === "↺") return "rotate-ccw"
    if (label === "↻") return "rotate-cw"
    return null
  }

  if (!button.classList.contains("file-viewer-web-icon-button")) return null
  if (label === "-") return "zoom-out"
  if (label === "1:1") return "zoom-reset"
  if (label === "+") return "zoom-in"
  return null
}

function createKnowledgeFileViewerToolbarIcon(
  documentRef: Document,
  icon: KnowledgeFileViewerToolbarIcon
): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg"
  const svg = documentRef.createElementNS(namespace, "svg")
  svg.setAttribute("viewBox", "0 0 24 24")
  svg.setAttribute("fill", "none")
  svg.setAttribute("stroke", "currentColor")
  svg.setAttribute("stroke-width", "2")
  svg.setAttribute("stroke-linecap", "round")
  svg.setAttribute("stroke-linejoin", "round")
  svg.setAttribute("aria-hidden", "true")
  svg.setAttribute("focusable", "false")

  for (const [elementName, attributes] of KNOWLEDGE_FILE_VIEWER_TOOLBAR_ICONS[
    icon
  ]) {
    const element = documentRef.createElementNS(namespace, elementName)
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value)
    }
    svg.append(element)
  }

  return svg
}

function installKnowledgeFileViewerSearchField(root: ShadowRoot): void {
  for (const searchGroup of root.querySelectorAll<HTMLElement>(
    ".file-viewer-web-search"
  )) {
    const input = searchGroup.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )
    const clearButton = Array.from(
      searchGroup.querySelectorAll<HTMLButtonElement>("button")
    ).find(
      (button) =>
        button.hasAttribute(KNOWLEDGE_FILE_VIEWER_SEARCH_CLEAR_ATTRIBUTE) ||
        button.textContent?.trim() === "x"
    )

    if (!input || !clearButton) continue

    clearButton.setAttribute(KNOWLEDGE_FILE_VIEWER_SEARCH_CLEAR_ATTRIBUTE, "")
    let searchField = input.closest<HTMLElement>(
      "[" + KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_ATTRIBUTE + "]"
    )
    if (!searchField) {
      searchField = input.ownerDocument.createElement("div")
      searchField.setAttribute(KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_ATTRIBUTE, "")
      input.before(searchField)
      searchField.append(input, clearButton)
    } else if (clearButton.parentElement !== searchField) {
      searchField.append(clearButton)
    }

    if (
      searchField.hasAttribute(
        KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_BOUND_ATTRIBUTE
      )
    ) {
      continue
    }
    searchField.setAttribute(
      KNOWLEDGE_FILE_VIEWER_SEARCH_FIELD_BOUND_ATTRIBUTE,
      ""
    )

    input.addEventListener("input", () => {
      if (input.disabled) return
      if (input.value !== "") {
        clearButton.disabled = false
      } else if (!clearButton.disabled) {
        clearButton.click()
      }
    })
    clearButton.addEventListener("click", () => {
      input.value = ""
      clearButton.disabled = true
    })
  }
}

export function decorateKnowledgeFileViewerToolbar(
  container: HTMLElement
): number {
  const root = container.shadowRoot
  if (!root) return 0

  installKnowledgeFileViewerSearchField(root)

  let decoratedCount = 0
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    ".file-viewer-web-toolbar button, .pdf-toolbar button"
  )) {
    if (button.hasAttribute(KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE)) continue
    const icon = resolveKnowledgeFileViewerToolbarIcon(button)
    if (!icon) continue

    button.setAttribute(KNOWLEDGE_FILE_VIEWER_ICON_ATTRIBUTE, icon)
    button.replaceChildren(
      createKnowledgeFileViewerToolbarIcon(container.ownerDocument, icon)
    )
    decoratedCount += 1
  }

  return decoratedCount
}

export function installKnowledgeFileViewerTheme(
  container: HTMLElement
): HTMLStyleElement | null {
  const root = container.shadowRoot
  if (!root) return null

  decorateKnowledgeFileViewerToolbar(container)

  const existing = root.querySelector<HTMLStyleElement>(
    `style[${KNOWLEDGE_FILE_VIEWER_THEME_ATTRIBUTE}]`
  )
  if (existing) return existing

  const style = container.ownerDocument.createElement("style")
  style.setAttribute(KNOWLEDGE_FILE_VIEWER_THEME_ATTRIBUTE, "")
  style.textContent = KNOWLEDGE_FILE_VIEWER_THEME_CSS
  root.append(style)
  return style
}
