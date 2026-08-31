import { describe, expect, it } from "vitest"

import {
  projectKnowledgeCitations,
  type TurnKnowledgeSource,
} from "../src/modules/events/knowledge-citations.js"

const SOURCE_A_REF = "source_ref_aaaaaaaaaaaaaaaa"
const SOURCE_A_SECOND_REF = "source_ref_aaaaaaaaaaaaaaab"
const SOURCE_B_REF = "source_ref_bbbbbbbbbbbbbbbb"

const sourceA: TurnKnowledgeSource = {
  knowledgeBaseId: "00000000-0000-4000-8000-000000000001",
  documentId: "00000000-0000-4000-8000-000000000002",
  documentVersionId: "00000000-0000-4000-8000-000000000003",
  parentId: "parent-a",
  titlePath: ["第一章"],
  matchedChildIds: ["child-a"],
  pageNumbers: [1, 2],
}

const sourceB: TurnKnowledgeSource = {
  knowledgeBaseId: "00000000-0000-4000-8000-000000000004",
  documentId: "00000000-0000-4000-8000-000000000005",
  documentVersionId: "00000000-0000-4000-8000-000000000006",
  parentId: "parent-b",
  titlePath: ["Summary"],
  matchedChildIds: ["child-b"],
  pageNumbers: [],
}

describe("projectKnowledgeCitations", () => {
  it("removes private markers and assigns citations in first-use order", () => {
    const result = projectKnowledgeCitations(
      `甲[[kb-source:${SOURCE_A_REF}]]乙[[kb-source:${SOURCE_B_REF}]]丙[[kb-source:${SOURCE_A_REF}]]`,
      new Map([
        [SOURCE_A_REF, sourceA],
        [SOURCE_B_REF, sourceB],
      ]),
    )

    expect(result.contentText).toBe("甲乙丙")
    expect(result.citations).toEqual([
      {
        ...sourceA,
        citationNo: 1,
        anchors: [
          { occurrenceNo: 1, anchorAfterOffsetUtf16: 1 },
          { occurrenceNo: 3, anchorAfterOffsetUtf16: 3 },
        ],
      },
      {
        ...sourceB,
        citationNo: 2,
        anchors: [{ occurrenceNo: 2, anchorAfterOffsetUtf16: 2 }],
      },
    ])
  })

  it("coalesces different handles for the same complete parent source", () => {
    const result = projectKnowledgeCitations(
      `A[[kb-source:${SOURCE_A_REF}]]B[[kb-source:${SOURCE_A_SECOND_REF}]]`,
      new Map([
        [SOURCE_A_REF, sourceA],
        [SOURCE_A_SECOND_REF, sourceA],
      ]),
    )

    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]).toMatchObject({
      citationNo: 1,
      anchors: [
        { occurrenceNo: 1, anchorAfterOffsetUtf16: 1 },
        { occurrenceNo: 2, anchorAfterOffsetUtf16: 2 },
      ],
    })
  })

  it("keeps citations separate when the same parent matched different children", () => {
    const result = projectKnowledgeCitations(
      `A[[kb-source:${SOURCE_A_REF}]]B[[kb-source:${SOURCE_A_SECOND_REF}]]`,
      new Map([
        [SOURCE_A_REF, sourceA],
        [
          SOURCE_A_SECOND_REF,
          { ...sourceA, matchedChildIds: ["child-a-second"] },
        ],
      ]),
    )

    expect(result.citations).toHaveLength(2)
    expect(result.citations.map((citation) => citation.matchedChildIds)).toEqual([
      ["child-a"],
      ["child-a-second"],
    ])
  })

  it("uses UTF-16 code-unit offsets for Unicode message text", () => {
    const result = projectKnowledgeCitations(
      `😀结论[[kb-source:${SOURCE_A_REF}]]`,
      new Map([[SOURCE_A_REF, sourceA]]),
    )

    expect(result.citations[0]?.anchors[0]?.anchorAfterOffsetUtf16).toBe(4)
  })

  it("removes unknown, malformed and partial source markers", () => {
    const result = projectKnowledgeCitations(
      [
        `有效[[kb-source:${SOURCE_A_REF}]]`,
        "未知[[kb-source:source_ref_xxxxxxxxxxxxxxxx]]",
        "格式错误[[kb-source:too short]]",
        "残缺[[kb-source:private_handle",
        "下一段仍保留",
      ].join("\n"),
      new Map([[SOURCE_A_REF, sourceA]]),
    )

    expect(result.contentText).toBe(
      ["有效", "未知", "格式错误", "残缺", "下一段仍保留"].join("\n"),
    )
    expect(result.citations).toHaveLength(1)
    expect(result.contentText).not.toContain("kb-source")
    expect(result.contentText).not.toContain("private_handle")
  })

  it("scrubs a known raw handle even when the model omits the marker wrapper", () => {
    const result = projectKnowledgeCitations(
      `不应显示 ${SOURCE_A_REF} 私有句柄`,
      new Map([[SOURCE_A_REF, sourceA]]),
    )

    expect(result.contentText).toBe("不应显示  私有句柄")
    expect(result.citations).toEqual([])
  })

  it("does not create duplicate anchors for adjacent repeated source markers", () => {
    const result = projectKnowledgeCitations(
      `结论[[kb-source:${SOURCE_A_REF}]][[kb-source:${SOURCE_A_REF}]]`,
      new Map([[SOURCE_A_REF, sourceA]]),
    )

    expect(result.citations[0]?.anchors).toEqual([
      { occurrenceNo: 1, anchorAfterOffsetUtf16: 2 },
    ])
  })
})
