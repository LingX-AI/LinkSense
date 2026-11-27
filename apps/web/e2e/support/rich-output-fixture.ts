import type { RichOutput } from "@linksense/shared"
import type { ConversationFile } from "../../src/api/contracts"

const galleryFileId = "40000000-0000-4000-8000-000000000071"
const reportFileId = "40000000-0000-4000-8000-000000000072"
export const richOutputResourceFiles: ConversationFile[] = [
  {
    id: galleryFileId,
    name: "design-a.png",
    mime_type: "image/png",
    size: 2048,
    kind: "artifact",
    turn_id: "rich-turn",
    download_available: true,
  },
  {
    id: reportFileId,
    name: "analysis.txt",
    mime_type: "text/plain",
    size: 64,
    kind: "artifact",
    turn_id: "rich-turn",
    download_available: true,
  },
]
export const richOutputResourceFixture: RichOutput = {
  version: 1,
  summary: "交付一张设计图和一份分析说明。",
  spec: {
    root: "result",
    elements: {
      result: {
        type: "Panel",
        props: { title: "设计与分析交付" },
        children: ["gallery", "files"],
      },
      gallery: {
        type: "MediaGallery",
        props: {
          title: "设计候选",
          items: [
            {
              fileId: galleryFileId,
              alt: "设计方案 A",
              caption: "来自当前会话的测试图片。",
            },
            {
              fileId: "40000000-0000-4000-8000-000000000073",
              alt: "已移除的候选",
              caption: "文件不可用时仍保留说明。",
            },
          ],
        },
      },
      files: {
        type: "ResourceList",
        props: {
          title: "交付文件",
          items: [
            {
              fileId: reportFileId,
              label: "分析说明",
              detail: "可预览和下载的测试文件。",
            },
          ],
        },
      },
    },
  },
}
export const richOutputResourceMarkdown = [
  "下面是本次交付的设计图和分析文件。",
  "```json-render",
  JSON.stringify(richOutputResourceFixture),
  "```",
].join("\n\n")

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

export const richOutputExpansionFixture: RichOutput = {
  version: 1,
  summary:
    "这是虚构的扩展组件示例，包含信息摘要、事件、建议步骤和可核对的数据。",
  spec: {
    root: "result",
    elements: {
      result: {
        type: "Panel",
        props: { title: "扩展结果示例" },
        children: [
          "facts",
          "history",
          "steps",
          "metric",
          "chart",
          "line",
          "table",
        ],
      },
      facts: {
        type: "KeyValue",
        props: {
          title: "关键信息",
          items: [
            { id: "source", label: "数据来源", value: "界面测试的虚构数据" },
            { id: "zero", label: "零值", value: 0 },
            { id: "unknown", label: "未提供", value: null },
          ],
        },
      },
      history: {
        type: "Timeline",
        props: {
          title: "事件时间线",
          items: [
            {
              id: "first",
              time: "2026-11-13，UTC+8",
              title: "记录样例输入",
              detail: "保留已知的时间精度。",
            },
            { id: "later", title: "整理后续信息", detail: "未提供精确时间。" },
          ],
        },
      },
      steps: {
        type: "Steps",
        props: {
          title: "建议步骤",
          items: [
            {
              id: "inspect",
              title: "核对输入",
              detail: "确认数字、单位和缺失值。",
            },
            {
              id: "verify",
              title: "验证结果",
              detail: "这是建议，不代表任务已经执行。",
            },
          ],
        },
      },
      metric: {
        type: "Metric",
        props: {
          label: "样例数量",
          value: 12,
          unit: "项",
          period: "2026 年 11 月",
          comparison: { label: "与上月样例相比", change: 2, unit: "项" },
        },
      },
      chart: {
        type: "Chart",
        props: {
          title: "多系列堆叠柱图",
          kind: "bar",
          unit: "项",
          stacked: true,
          series: [
            { id: "actual", label: "已处理" },
            { id: "remaining", label: "待核对" },
          ],
          points: [
            { id: "first", label: "第一组", values: [12, 3] },
            { id: "second", label: "第二组", values: [0, null] },
          ],
        },
      },
      line: {
        type: "Chart",
        props: {
          title: "多系列折线图",
          kind: "line",
          unit: "项",
          series: [
            { id: "actual", label: "已处理" },
            { id: "remaining", label: "待核对" },
          ],
          points: [
            { id: "first", label: "第一组", values: [12.123456, 3] },
            { id: "second", label: "第二组", values: [0, null] },
            { id: "third", label: "第三组", values: [8, 4] },
          ],
        },
      },
      table: {
        type: "DataTable",
        props: {
          title: "可筛选明细",
          filterable: true,
          columns: [
            { id: "name", label: "名称", type: "text" },
            { id: "count", label: "数量", type: "number", unit: "项" },
            { id: "date", label: "日期", type: "date" },
          ],
          rows: [
            { id: "first", values: ["第一组", 12, "2026-11-14"] },
            { id: "second", values: ["第二组", 0, "2026-11-13"] },
            { id: "third", values: ["第三组", null, null] },
          ],
        },
      },
    },
  },
}
export const richOutputExpansionMarkdown = [
  "以下内容用于验证扩展后的富内容，全部为虚构资料。",
  "```json-render",
  JSON.stringify(richOutputExpansionFixture),
  "```",
].join("\n\n")

export const richOutputReadingMarkdown = [
  "以下为交付前核对示例，使用虚构资料。",
  "```json-render",
  JSON.stringify({
    version: 1,
    summary: "先看摘要，再核对交付资料。",
    spec: {
      root: "result",
      elements: {
        result: {
          type: "Panel",
          props: { title: "交付前核对" },
          children: ["views"],
        },
        views: {
          type: "Tabs",
          props: {
            title: "阅读视图",
            tabs: [
              { id: "overview", label: "摘要与主要结论" },
              { id: "notes", label: "交付准备及逐项核对" },
              { id: "limits", label: "数据口径与使用限制" },
            ],
          },
          children: ["overview", "notes", "limits"],
        },
        overview: {
          type: "Text",
          props: { text: "摘要：确认数据口径后再交付。" },
        },
        notes: {
          type: "Grid",
          props: { columns: 2 },
          children: ["instructions", "details"],
        },
        instructions: {
          type: "Text",
          props: {
            text: "先对照本次报告使用的原始资料，确认统计范围、比较周期和单位。标记缺失数据，避免把空值当成零。下面可以展开核对项目。",
          },
        },
        details: {
          type: "Details",
          props: { title: "查看核对要求" },
          children: ["checklist", "calculation"],
        },
        checklist: {
          type: "Checklist",
          props: {
            title: "交付检查清单",
            items: [
              {
                id: "source",
                label: "确认资料来源",
                detail: "与原始文件核对。",
              },
              { id: "period", label: "确认统计周期" },
              { id: "gaps", label: "说明缺失数据" },
            ],
          },
        },
        calculation: {
          type: "Text",
          props: { text: "所列单位只适用于本次示例。" },
        },
        limits: {
          type: "Text",
          props: { text: "本次不包含跨季度数据。" },
        },
      },
    },
  } satisfies RichOutput),
  "```",
].join("\n\n")
