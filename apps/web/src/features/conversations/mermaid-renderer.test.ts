import { beforeEach, describe, expect, it, vi } from "vitest"
import mermaid from "mermaid"
import { roundMermaidDiamonds } from "@/features/conversations/mermaid-rounded-diamonds"
import {
  normalizeMermaidSource,
  renderMermaidDiagram,
} from "@/features/conversations/mermaid-renderer"

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn(),
    render: vi.fn(),
  },
}))
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 800 240" style="max-width:800px"><style>.node {fill:#fff}</style><text>确认</text></svg>'
beforeEach(() => {
  vi.mocked(mermaid.initialize).mockReset()
  vi.mocked(mermaid.parse)
    .mockReset()
    .mockResolvedValue({ diagramType: "flowchart-v2", config: {} })
  vi.mocked(mermaid.render)
    .mockReset()
    .mockResolvedValue({ svg, diagramType: "flowchart-v2" })
})

describe("Mermaid renderer boundary", () => {
  it.each(["flowchart-v2", "flowchart-elk"])(
    "uses the built-in orthogonal layout and straightened attachments for %s",
    async (diagramType) => {
      vi.mocked(mermaid.parse).mockResolvedValue({ diagramType, config: {} })
      await renderMermaidDiagram("graph LR; A --> B", "light")
      expect(mermaid.initialize).toHaveBeenLastCalledWith(
        expect.objectContaining({
          layout: "elk",
          elk: expect.objectContaining({
            mergeEdges: false,
            forceNodeModelOrder: false,
            keepEntryNodeOnTop: true,
            straightenEdges: true,
          }),
          secure: expect.arrayContaining(["layout", "elk", "flowchart"]),
        })
      )
    }
  )
  it("does not switch sequence diagrams to the flowchart layout after rendering a flowchart", async () => {
    await renderMermaidDiagram("graph LR; A --> B", "light")
    vi.mocked(mermaid.parse).mockResolvedValue({
      diagramType: "sequence",
      config: {},
    })
    vi.mocked(mermaid.render).mockResolvedValue({
      svg,
      diagramType: "sequence",
    })
    await renderMermaidDiagram("sequenceDiagram\n A->>B: message", "light")
    expect(
      vi.mocked(mermaid.initialize).mock.calls.at(-1)?.[0]?.layout
    ).toBeUndefined()
  })
  it.each([
    "0,0 100,0 100,80 0,80",
    "0,0 80,0 100,50 80,100 0,100 -20,50",
    "0,0 0,0 0,0 0,0",
    "NaN,0 100,0 100,80 0,80",
    "",
  ])("leaves non-diamond or invalid polygons unchanged: %s", (points) => {
    const document = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg"><g class="node"><polygon class="label-container" points="${points}"/></g></svg>`,
      "image/svg+xml"
    )
    roundMermaidDiamonds(document.documentElement)
    expect(document.querySelector("polygon")?.getAttribute("points")).toBe(
      points
    )
    expect(document.querySelector("path")).toBeNull()
  })
  it("bounds rounding on tiny diamonds and keeps arrowheads sharp", () => {
    const document = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><g class="node"><polygon class="label-container" points="1,0 2,1 1,2 0,1"/></g><marker><polygon points="1,0 2,1 1,2 0,1"/></marker></svg>',
      "image/svg+xml"
    )
    roundMermaidDiamonds(document.documentElement)
    expect(document.querySelector(".node path")?.getAttribute("d")).toBe(
      "M 1.25 0.25 L 1.75 0.75 Q 2 1 1.75 1.25 L 1.25 1.75 Q 1 2 0.75 1.75 L 0.25 1.25 Q 0 1 0.25 0.75 L 0.75 0.25 Q 1 0 1.25 0.25 Z"
    )
    expect(document.querySelector("marker polygon")).not.toBeNull()
  })
  it.each(["light", "dark"] as const)(
    "rounds decision corners in the %s exported SVG while preserving colors and connections",
    async (theme) => {
      vi.mocked(mermaid.render).mockResolvedValue({
        svg: svg.replace(
          "<text>确认</text>",
          '<g class="node warning"><polygon class="label-container" points="50,0 100,-50 50,-100 0,-50" transform="translate(-49.5,50)" style="fill:#fff4dd;stroke:#f6b94c"/><text>库存是否充足？</text></g><path class="flowchart-link" d="M 50 0 L 50 20"/>'
        ),
        diagramType: "flowchart-v2",
      })
      const diagram = await renderMermaidDiagram(
        "graph TD; A{库存是否充足？} --> B",
        theme
      )
      const result = new DOMParser().parseFromString(
        decodeURIComponent(diagram.url.split(",")[1]!),
        "image/svg+xml"
      )
      const shape = result.querySelector(".node .label-container")
      expect(shape?.localName).toBe("path")
      expect(shape?.getAttribute("d")?.match(/Q/gu)).toHaveLength(4)
      expect(shape?.getAttribute("transform")).toBe("translate(-49.5,50)")
      expect(shape?.getAttribute("style")).toBe("fill:#fff4dd;stroke:#f6b94c")
      expect(result.querySelector("text")?.textContent).toBe("库存是否充足？")
      expect(result.querySelector(".flowchart-link")?.getAttribute("d")).toBe(
        "M 50 0 L 50 20"
      )
      expect(diagram).toMatchObject({ width: 800, height: 240 })
    }
  )
  it.each(["light", "dark"] as const)(
    "embeds the %s card theme in standalone images without changing the diagram source",
    async (theme) => {
      const source =
        "flowchart TD\nsubgraph delivery[配送与签收]\nA[物流配送] --> B{用户是否签收?}\nend\nclassDef warning fill:#fff4dd,stroke:#f6b94c\nclass B warning"
      vi.mocked(mermaid.render).mockImplementation(async () => {
        const config = vi.mocked(mermaid.initialize).mock.calls.at(-1)?.[0]
        return {
          svg: svg.replace(".node {fill:#fff}", config?.themeCSS ?? ""),
          diagramType: "flowchart-v2",
        }
      })
      const diagram = await renderMermaidDiagram(source, theme)
      expect(mermaid.parse).toHaveBeenCalledWith(source)
      expect(mermaid.render).toHaveBeenCalledWith(
        expect.any(String),
        source,
        expect.any(HTMLElement)
      )
      expect(mermaid.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: "base",
          themeVariables: expect.objectContaining({
            darkMode: theme === "dark",
            primaryColor: theme === "dark" ? "#232b35" : "#ffffff",
            primaryTextColor: theme === "dark" ? "#e8eef5" : "#17283d",
            fontSize: "16px",
          }),
          flowchart: expect.objectContaining({
            curve: "rounded",
            nodeSpacing: 40,
            rankSpacing: 56,
            subGraphTitleMargin: { top: 20, bottom: 24 },
          }),
        })
      )
      const result = decodeURIComponent(diagram.url.split(",")[1]!)
      expect(result).toContain("drop-shadow")
      expect(result).toContain("rx: 12px")
      expect(result).toContain("font-weight: 550")
      expect(result).toContain(theme === "dark" ? "#1d2b3b" : "#eef6fd")
      expect(result).not.toContain("!important")
      expect(result).not.toContain("foreignObject")
    }
  )
  it("repairs only encoded indentation, preserving source label entities", () => {
    expect(
      normalizeMermaidSource(
        "graph LR\n&#x20;   A[&#x20;] --> B\n &#32; B --> C"
      )
    ).toBe("graph LR\n    A[&#x20;] --> B\n   B --> C")
  })
  it("returns a standalone full-size SVG image and removes its temporary render container", async () => {
    const diagram = await renderMermaidDiagram("graph LR\n A --> B", "light")
    expect(diagram).toMatchObject({
      width: 800,
      height: 240,
      background: "#ffffff",
    })
    const result = decodeURIComponent(diagram.url.split(",")[1]!)
    expect(result).toContain('viewBox="-10 -20 800 240"')
    expect(result).toContain('width="800"')
    expect(result).toContain("<style>")
    expect(result).toContain("确认")
    expect(result).not.toContain("max-width")
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull()
  })
  it("locks security and HTML settings and strips executable or external SVG content", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: svg.replace(
        "<text>",
        '<script>alert(1)</script><foreignObject><div>html</div></foreignObject><image href="https://example.com/a.png"/><text onclick="alert(1)">'
      ),
      diagramType: "flowchart-v2",
    })
    const diagram = await renderMermaidDiagram("graph LR\n A --> B", "dark")
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        htmlLabels: false,
        suppressErrorRendering: true,
        secure: expect.arrayContaining([
          "securityLevel",
          "htmlLabels",
          "themeCSS",
          "dompurifyConfig",
        ]),
      })
    )
    const result = decodeURIComponent(diagram.url)
    expect(result).not.toMatch(
      /<script|foreignObject|onclick|<image|https:\/\/example/u
    )
    expect(diagram.background).toBe("#141414")
  })
  it("rejects invalid dimensions", async () => {
    vi.mocked(mermaid.render).mockResolvedValue({
      svg: svg.replace("800 240", "0 NaN"),
      diagramType: "flowchart-v2",
    })
    await expect(renderMermaidDiagram("graph LR", "light")).rejects.toThrow()
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull()
  })
  it("serializes theme changes and allows the next render after a failure", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("invalid"))
    const first = renderMermaidDiagram("graph LR\n A --> B", "dark")
    const second = renderMermaidDiagram("graph LR\n B --> C", "light")
    await expect(first).rejects.toThrow("invalid")
    await expect(second).resolves.toMatchObject({ background: "#ffffff" })
    expect(mermaid.initialize).toHaveBeenCalledTimes(4)
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
