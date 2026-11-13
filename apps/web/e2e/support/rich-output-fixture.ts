import type { RichOutput } from "@linksense/shared"

export const richOutputFixture: RichOutput = {
  version: 1,
  summary: "示例数据显示不同团队的情况，建议先验证核心流程。",
  spec: {
    root: "result",
    elements: {
      result: {
        type: "Panel",
        props: {
          title: "分析结果与建议",
          description: "用于界面验证的虚构数据。",
        },
        children: ["finding", "evidence", "comparison", "chart"],
      },
      finding: {
        type: "Callout",
        props: {
          title: "主要发现",
          text: "需要区分零值和未提供的数据，再决定下一步。",
          tone: "info",
        },
      },
      evidence: {
        type: "Evidence",
        props: {
          title: "查看分析依据",
          detail: "三个团队的数据分别为 12、0 和缺失值。缺失值没有被计为零。",
        },
      },
      comparison: {
        type: "Comparison",
        props: {
          title: "比较实施方式",
          options: [
            {
              id: "pilot",
              title: "先做验证",
              description: "先验证核心流程，再决定后续范围。",
              benefits: ["更早得到反馈"],
              tradeoffs: ["覆盖场景有限"],
            },
            {
              id: "complete",
              title: "完整建设",
              description: "在需求清晰后统一建设完整流程。",
              benefits: [
                "统一规划",
                "建立清晰的交付节奏",
                "减少各阶段之间的重复工作",
              ],
              tradeoffs: ["投入较集中"],
            },
          ],
        },
      },
      chart: {
        type: "Chart",
        props: {
          title: "团队数据",
          kind: "bar",
          unit: "项",
          points: [
            { id: "a", label: "团队 A", value: 12 },
            { id: "b", label: "团队 B", value: 0 },
            { id: "c", label: "团队 C", value: null },
          ],
        },
      },
    },
  },
}

export const richOutputFixtureMarkdown = [
  "这是分析结论，下面可以查看依据、比较方案并核对数据。",
  "```json-render",
  JSON.stringify(richOutputFixture),
  "```",
  "以上为界面测试数据，不代表真实业务指标。",
].join("\n\n")
