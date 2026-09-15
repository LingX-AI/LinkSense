import { describe, expect, it } from "vitest"
import mermaid from "mermaid"
import { normalizeMermaidSource } from "@/features/conversations/mermaid-renderer"

// Exercise the installed Mermaid parser with the original Chinese example.
const source = `graph LR
&#x20;   A[确认上游API合规性] --> B[启动ICP备案]
&#x20;   B --> C[准备AI服务登记材料]
&#x20;   C --> D[提交生成式AI服务登记]
&#x20;   D --> E{是否收费?}
&#x20;   E -- 是 --> F[同步申请ICP经营许可证]
&#x20;   E -- 否 --> G[完成公安联网备案]
&#x20;   F --> G
&#x20;   G --> H[产品上线 & 公示备案号]`

describe("installed Mermaid flowchart syntax", () => {
  it("accepts the supplied Chinese graph, branches, and encoded indentation", async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
    })
    await expect(
      mermaid.parse(normalizeMermaidSource(source))
    ).resolves.toMatchObject({ diagramType: "flowchart-v2" })
  })
  it("rejects unfinished nodes", async () => {
    await expect(mermaid.parse("graph LR\n A[未完成")).rejects.toThrow()
  })
})
