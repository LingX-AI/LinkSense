import { describe, expect, it } from "vitest"

import { KnowledgeProcessingError } from "../src/modules/knowledge-processing/errors.js"
import {
  buildKnowledgeParents,
  type HybridChunkForParenting,
} from "../src/modules/knowledge-processing/parent-builder.js"

const VERSION_ID = "00000000-0000-4000-8000-000000000001"

describe("buildKnowledgeParents", () => {
  it("uses contextualized text only on children and composes parent text from one heading plus raw text", () => {
    const parents = buildKnowledgeParents(
      [
        child(0, {
          text: "Policy\ncontext first",
          rawText: "first",
          numTokens: 40,
        }),
        child(1, {
          text: "Policy\ncontext second",
          rawText: "second",
          numTokens: 50,
        }),
      ],
      { documentVersionId: VERSION_ID, maximumTokens: 100 },
    )

    expect(parents).toHaveLength(1)
    expect(parents[0]?.parentText).toBe("# Policy\n\nfirst\n\nsecond")
    expect(parents[0]?.parentText).not.toContain("context")
    expect(parents[0]?.children.map((item) => item.text)).toEqual([
      "Policy\ncontext first",
      "Policy\ncontext second",
    ])
    expect(parents[0]?.childCount).toBe(2)
    expect(parents[0]?.estimatedTokens).toBe(90)
  })

  it("splits on heading path, exact page set, explicit hard boundary and token budget", () => {
    const parents = buildKnowledgeParents(
      [
        child(0, { pageNumbers: [1], numTokens: 40 }),
        child(1, { pageNumbers: [1], numTokens: 40 }),
        child(2, { pageNumbers: [1], numTokens: 40 }),
        child(3, { pageNumbers: [2], numTokens: 20 }),
        child(4, {
          pageNumbers: [2],
          headings: ["Other"],
          numTokens: 20,
        }),
        child(5, {
          pageNumbers: [2],
          headings: ["Other"],
          hardBoundaryKey: "table-1",
          numTokens: 20,
        }),
      ],
      { documentVersionId: VERSION_ID, maximumTokens: 100 },
    )

    expect(parents.map((parent) => parent.children.map((item) => item.chunkIndex))).toEqual([
      [0, 1],
      [2],
      [3],
      [4],
      [5],
    ])
    expect(parents.map((parent) => parent.pageNumbers)).toEqual([
      [1],
      [1],
      [2],
      [2],
      [2],
    ])
  })

  it("keeps document-level children with an empty page list", () => {
    const parents = buildKnowledgeParents(
      [child(0, { pageNumbers: [] })],
      { documentVersionId: VERSION_ID, maximumTokens: 100 },
    )

    expect(parents[0]?.pageNumbers).toEqual([])
  })

  it("produces stable ids and digests for identical official chunks", () => {
    const input = [child(0), child(1)]
    const first = buildKnowledgeParents(input, {
      documentVersionId: VERSION_ID,
      maximumTokens: 100,
    })
    const second = buildKnowledgeParents(input, {
      documentVersionId: VERSION_ID,
      maximumTokens: 100,
    })

    expect(second).toEqual(first)
    expect(first[0]?.parentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    )
    expect(first[0]?.children[0]?.childId).toContain(`${VERSION_ID}:0:`)
  })

  it.each([
    [[child(1)]],
    [[child(0, { text: " " })]],
    [[child(0, { rawText: " " })]],
    [[child(0, { numTokens: 101 })]],
    [[child(0, { pageNumbers: [0] })]],
    [[child(0, { headings: [""] })]],
  ])("fails closed for invalid Hybrid chunks", (chunks) => {
    expect(() =>
      buildKnowledgeParents(chunks, {
        documentVersionId: VERSION_ID,
        maximumTokens: 100,
      }),
    ).toThrowError(KnowledgeProcessingError)
  })
})

function child(
  chunkIndex: number,
  overrides: Partial<HybridChunkForParenting> = {},
): HybridChunkForParenting {
  return {
    chunkIndex,
    text: `Policy\ncontext ${chunkIndex}`,
    rawText: `raw ${chunkIndex}`,
    numTokens: 40,
    headings: ["Policy"],
    captions: [],
    docItems: [`#/texts/${chunkIndex}`],
    pageNumbers: [1],
    ...overrides,
  }
}
