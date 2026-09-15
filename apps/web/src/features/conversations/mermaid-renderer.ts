import DOMPurify from "dompurify"
import { z } from "zod"
import type { MermaidConfig } from "mermaid"
import type { ResolvedTheme } from "@/app/theme"

export type MermaidDiagram = Readonly<{
  url: string
  width: number
  height: number
  background: string
}>

const viewBoxSchema = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().positive().finite(),
  z.number().positive().finite(),
])
// Mermaid's theme engine requires literal hex colors rather than CSS variables.
const palettes = {
  light: {
    background: "#ffffff",
    surface: "#f5f5f5",
    text: "#262626",
    border: "#a3a3a3",
    line: "#737373",
  },
  dark: {
    background: "#141414",
    surface: "#262626",
    text: "#f5f5f5",
    border: "#737373",
    line: "#a3a3a3",
  },
} satisfies Record<ResolvedTheme, Record<string, string>>

// Serialize initialize + render together: Mermaid has mutable global configuration.
let renderQueue: Promise<unknown> = Promise.resolve()
let nextDiagramId = 0

export function normalizeMermaidSource(source: string): string {
  // Only repair encoded indentation, never entities in node labels or code examples.
  return source.replace(/^(?:[\t ]|&#x20;|&#32;)+/gimu, (indent) =>
    indent.replace(/&#(?:x20|32);/giu, " ")
  )
}

export function renderMermaidDiagram(
  source: string,
  theme: ResolvedTheme
): Promise<MermaidDiagram> {
  const pending = renderQueue.then(async () => {
    const { default: mermaid } = await import("mermaid")
    const palette = palettes[theme]
    const config: MermaidConfig = {
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      theme: "base",
      htmlLabels: false,
      fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      // These settings cannot be overridden by model-generated frontmatter/directives.
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "suppressErrorRendering",
        "maxTextSize",
        "maxEdges",
        "htmlLabels",
        "theme",
        "themeVariables",
        "themeCSS",
        "fontFamily",
        "dompurifyConfig",
      ],
      dompurifyConfig: { FORBID_TAGS: ["image", "foreignObject"] },
      themeVariables: {
        darkMode: theme === "dark",
        background: palette.background,
        primaryColor: palette.surface,
        primaryTextColor: palette.text,
        primaryBorderColor: palette.border,
        secondaryColor: palette.surface,
        tertiaryColor: palette.surface,
        lineColor: palette.line,
        textColor: palette.text,
        edgeLabelBackground: palette.background,
        clusterBkg: palette.surface,
        clusterBorder: palette.border,
        fontSize: "14px",
      },
      flowchart: {
        htmlLabels: false,
        useMaxWidth: false,
        curve: "linear",
        nodeSpacing: 28,
        rankSpacing: 40,
        padding: 14,
        diagramPadding: 20,
      },
      // Library SVG styling is kept inside its image, away from the application CSS.
      themeCSS:
        ".node rect { rx: 8px; ry: 8px; } .edgeLabel rect { opacity: 1; }",
    }
    mermaid.initialize(config)
    const normalized = normalizeMermaidSource(
      z.string().max(50_000).parse(source)
    )
    await mermaid.parse(normalized)
    const container = document.createElement("div")
    container.className =
      "pointer-events-none fixed top-0 -left-[100000px] opacity-0"
    container.setAttribute("aria-hidden", "true")
    document.body.append(container)
    try {
      const { svg } = await mermaid.render(
        `linksense-diagram-${++nextDiagramId}`,
        normalized,
        container
      )
      const safeSvg = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject", "image", "a"],
      })
      const documentSvg = new DOMParser().parseFromString(
        safeSvg,
        "image/svg+xml"
      )
      const root = documentSvg.documentElement
      if (root.localName !== "svg" || documentSvg.querySelector("parsererror"))
        throw new Error("Invalid diagram SVG")
      const [, , width, height] = viewBoxSchema.parse(
        root
          .getAttribute("viewBox")
          ?.trim()
          .split(/[\s,]+/u)
          .map(Number)
      )
      root.setAttribute("width", String(width))
      root.setAttribute("height", String(height))
      root.removeAttribute("style")
      const serialized = new XMLSerializer().serializeToString(root)
      return {
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`,
        width,
        height,
        background: palette.background,
      }
    } finally {
      container.remove()
    }
  })
  renderQueue = pending.catch(() => undefined)
  return pending
}
