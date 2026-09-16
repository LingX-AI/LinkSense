import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { renderMermaidDiagram } from "@/features/conversations/mermaid-renderer"

const pointsSchema = z.array(z.object({ x: z.number(), y: z.number() })).min(2)
const orderFlow = `flowchart TD
  A[创建支付订单] --> B{支付是否成功?}
  B -- 是 --> C[生成发货单]
  B -- 否 --> D{是否达到重试次数?}
  D -- 否 --> E[等待一段时间]
  E --> A
  D -- 是 --> F[关闭订单]
  C --> G[仓库拣货]
  G --> H{商品是否完整?}
  H -- 是 --> I[物流配送]
  H -- 否 --> J[异常人工处理]
  J --> G`

beforeEach(() => {
  // JSDOM has no SVG text metrics. Only supply measurement; run the real
  // Mermaid parser, layout engine, routing, and SVG serializer.
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value: vi.fn(function (this: SVGElement) {
      const shape = this.querySelector<SVGGraphicsElement>(
        ":scope > .label-container"
      )
      if (shape) return shape.getBBox()
      if (this.tagName === "rect") {
        return {
          x: Number(this.getAttribute("x")),
          y: Number(this.getAttribute("y")),
          width: Number(this.getAttribute("width")),
          height: Number(this.getAttribute("height")),
        }
      }
      if (this.tagName === "polygon") {
        const values = (this.getAttribute("points") ?? "")
          .trim()
          .split(/[\s,]+/u)
          .map(Number)
        const xs = values.filter((_, index) => index % 2 === 0)
        const ys = values.filter((_, index) => index % 2 === 1)
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        }
      }
      return {
        x: 0,
        y: 0,
        width: Math.max(16, (this.textContent?.length ?? 0) * 8),
        height: 20,
      }
    }),
  })
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value: vi.fn(function (this: SVGElement) {
      return (this.textContent?.length ?? 0) * 8
    }),
  })
})

afterEach(() => {
  Reflect.deleteProperty(SVGElement.prototype, "getBBox")
  Reflect.deleteProperty(SVGElement.prototype, "getComputedTextLength")
})

describe("flowchart layout", () => {
  it.each([
    ["sequence", "sequenceDiagram\nAlice->>Bob: message", "message"],
    ["class", "classDiagram\nOrder --> Item", "Order"],
    ["state", "stateDiagram-v2\n[*] --> Pending\nPending --> Done", "Pending"],
    [
      "entity relationship",
      "erDiagram\nORDER ||--o{ ITEM : contains",
      "contains",
    ],
  ])(
    "still renders existing %s diagram source after the Mermaid upgrade",
    async (_type, source, label) => {
      const diagram = await renderMermaidDiagram(source, "light")
      const root = new DOMParser().parseFromString(
        decodeURIComponent(diagram.url.split(",")[1]!),
        "image/svg+xml"
      )
      expect(root.documentElement.localName).toBe("svg")
      expect(root.documentElement.textContent).toContain(label)
      expect(root.querySelector("parsererror")).toBeNull()
      expect(diagram.width).toBeGreaterThan(0)
      expect(diagram.height).toBeGreaterThan(0)
    }
  )
  it.each(["light", "dark"] as const)(
    "keeps %s retry branches orthogonal including diamond attachments and arrow approaches",
    async (theme) => {
      const diagram = await renderMermaidDiagram(orderFlow, theme)
      const root = new DOMParser().parseFromString(
        decodeURIComponent(diagram.url.slice(diagram.url.indexOf(",") + 1)),
        "image/svg+xml"
      )
      const edges = [...root.querySelectorAll("path.flowchart-link")]
      expect(root.querySelectorAll("g.node")).toHaveLength(10)
      expect(edges).toHaveLength(11)
      let corridorSegments = 0
      for (const edge of edges) {
        const points = pointsSchema.parse(
          JSON.parse(atob(edge.getAttribute("data-points") ?? ""))
        )
        // Node attachments must obey the same routing as the rest of the edge:
        // even a small diagonal becomes visibly crooked when zooming the SVG.
        for (let index = 1; index < points.length; index++) {
          corridorSegments++
          const previous = points[index - 1]!
          const point = points[index]!
          expect(
            Math.min(
              Math.abs(point.x - previous.x),
              Math.abs(point.y - previous.y)
            ),
            edge.id
          ).toBeLessThan(0.01)
        }
      }
      expect(corridorSegments).toBeGreaterThan(5)
      expect(edges.every((edge) => edge.hasAttribute("marker-end"))).toBe(true)
      expect(
        [...root.querySelectorAll(".edgeLabel .label")]
          .map((label) => label.textContent)
          .filter(Boolean)
          .sort()
      ).toEqual(["是", "是", "是", "否", "否", "否"].sort())
      expect(root.querySelectorAll(".node path.label-container")).toHaveLength(
        3
      )
      expect(root.documentElement.textContent).toContain("创建支付订单")
      expect(diagram.width).toBeGreaterThan(0)
      expect(diagram.height).toBeGreaterThan(0)
    },
    20_000
  )

  it("preserves horizontal direction, groups and explicit node colors in existing graph source", async () => {
    const source = `---
config:
  layout: dagre
---
graph LR
  subgraph payment[支付处理]
    A[创建订单] --> B[确认支付]
  end
  subgraph delivery[配送处理]
    C[仓库拣货] --> D[配送完成]
  end
  B --> C
  classDef success fill:#ecfdf5,stroke:#10b981
  class D success`
    const diagram = await renderMermaidDiagram(source, "light")
    const root = new DOMParser().parseFromString(
      decodeURIComponent(diagram.url.split(",")[1]!),
      "image/svg+xml"
    )
    expect(root.querySelectorAll(".cluster")).toHaveLength(2)
    expect(root.querySelectorAll("g.node")).toHaveLength(4)
    expect(root.querySelectorAll("path.flowchart-link")).toHaveLength(3)
    expect(
      root
        .querySelector(".node.success .label-container")
        ?.getAttribute("style")
    ).toContain("#ecfdf5")
    const start =
      root.querySelector('[id*="flowchart-A-"]')?.getAttribute("transform") ??
      ""
    const end =
      root.querySelector('[id*="flowchart-D-"]')?.getAttribute("transform") ??
      ""
    const x = (transform: string) =>
      Number(transform.match(/translate\(([-\d.]+)/u)?.[1])
    expect(x(end)).toBeGreaterThan(x(start))
    expect(root.documentElement.textContent).toContain("配送完成")
  })
})
