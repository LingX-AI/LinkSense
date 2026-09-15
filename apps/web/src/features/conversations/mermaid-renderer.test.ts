import { beforeEach, describe, expect, it, vi } from "vitest"
import mermaid from "mermaid"
import {
  normalizeMermaidSource,
  renderMermaidDiagram,
} from "@/features/conversations/mermaid-renderer"

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), parse: vi.fn(), render: vi.fn() },
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
    expect(mermaid.initialize).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
