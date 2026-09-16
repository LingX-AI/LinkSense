import DOMPurify from "dompurify"
import { z } from "zod"
import type { MermaidConfig } from "mermaid"
import type { ResolvedTheme } from "@/app/theme"
import { getMermaidAppearance } from "@/features/conversations/mermaid-appearance"
import { roundMermaidDiamonds } from "@/features/conversations/mermaid-rounded-diamonds"

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
// Serialize initialize + render together: Mermaid has mutable global configuration.
let renderQueue: Promise<unknown> = Promise.resolve()
let nextDiagramId = 0
const flowchartTypes = new Set(["flowchart-v2", "flowchart-elk"])

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
    const appearance = getMermaidAppearance(theme)
    const config: MermaidConfig = {
      ...appearance.config,
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      htmlLabels: false,
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
        "look",
        "themeVariables",
        "themeCSS",
        "fontFamily",
        "layout",
        "elk",
        "flowchart",
        "dompurifyConfig",
      ],
      dompurifyConfig: { FORBID_TAGS: ["image", "foreignObject"] },
    }
    mermaid.initialize(config)
    const normalized = normalizeMermaidSource(
      z.string().max(50_000).parse(source)
    )
    const parsed = await mermaid.parse(normalized)
    if (parsed && flowchartTypes.has(parsed.diagramType)) {
      // Mermaid bundles and lazily loads ELK, including orthogonal attachments.
      mermaid.initialize({
        ...config,
        layout: "elk",
        elk: {
          // Keep branches distinguishable while allowing crossing minimization
          // to move nodes; declared order is a preference, not a hard constraint.
          mergeEdges: false,
          nodePlacementStrategy: "BRANDES_KOEPF",
          nodePlacementAlignment: "BALANCED",
          cycleBreakingStrategy: "DEPTH_FIRST",
          considerModelOrder: "NODES_AND_EDGES",
          forceNodeModelOrder: false,
          keepEntryNodeOnTop: true,
          straightenEdges: true,
        },
      })
    }
    const container = document.createElement("div")
    container.className =
      "pointer-events-none fixed top-0 -left-[100000px] opacity-0"
    container.setAttribute("aria-hidden", "true")
    document.body.append(container)
    try {
      const { svg, diagramType } = await mermaid.render(
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
      if (flowchartTypes.has(diagramType)) {
        roundMermaidDiamonds(root)
      }
      const serialized = new XMLSerializer().serializeToString(root)
      return {
        url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`,
        width,
        height,
        background: appearance.background,
      }
    } finally {
      container.remove()
    }
  })
  renderQueue = pending.catch(() => undefined)
  return pending
}
