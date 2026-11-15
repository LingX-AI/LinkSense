import { describe, expect, it } from "vitest";
import { parseRichOutput } from "@linksense/shared";

import {
  forkBaseTitle,
  forkedConversationTitle,
  isValidForkedThreadHistory,
  remapForkedJson,
} from "../src/modules/conversations/fork.js";

describe("conversation fork helpers", () => {
  it("uses ASCII parentheses and preserves the original base title", () => {
    expect(forkedConversationTitle("任务", 2)).toBe("任务(2)");
    expect(forkedConversationTitle("任务", 3)).toBe("任务(3)");
    expect(forkBaseTitle("任务(2)", 2)).toBe("任务");
  });

  it("keeps the suffix when truncating a long Unicode title", () => {
    const title = forkedConversationTitle("🙂".repeat(240), 12);
    expect(Array.from(title)).toHaveLength(240);
    expect(title).toMatch(/…\(12\)$/u);
  });

  it("recursively remaps copied identifiers without replacing substrings", () => {
    const sourceId = "10000000-0000-4000-8000-000000000001";
    const targetId = "20000000-0000-4000-8000-000000000001";
    expect(
      remapForkedJson(
        {
          id: sourceId,
          nested: [sourceId, `prefix:${sourceId}`],
        },
        new Map([[sourceId, targetId]]),
      ),
    ).toEqual({
      id: targetId,
      nested: [targetId, `prefix:${sourceId}`],
    });
  });

  it("remaps explicit image references inside copied native message text while preserving ordinary identifier text", () => {
    const sourceId = "10000000-0000-4000-8000-000000000001";
    const targetId = "20000000-0000-4000-8000-000000000001";
    expect(remapForkedJson({ text: `![image](linksense-artifact:${sourceId})\nReference ${sourceId}` }, new Map([[sourceId, targetId]]))).toEqual({
      text: `![image](linksense-artifact:${targetId})\nReference ${sourceId}`,
    });
  });

  it("rebinds gallery and file cards to the copied files without changing prose or labels", () => {
    const sourceId = "10000000-0000-4000-8000-000000000001";
    const targetId = "20000000-0000-4000-8000-000000000001";
    const output = {
      version: 1, summary: "Delivered files",
      spec: { root: "panel", elements: {
        panel: { type: "Panel", props: { title: sourceId }, children: ["gallery", "files"] },
        gallery: { type: "MediaGallery", props: { title: "Images", items: [{ fileId: sourceId, alt: "Landscape" }] } },
        files: { type: "ResourceList", props: { title: "Files", items: [{ fileId: sourceId, label: sourceId }] } },
      } },
    };
    const text = remapForkedJson(`\`\`\`json-render\n${JSON.stringify(output)}\n\`\`\``, new Map([[sourceId, targetId]]));
    expect(typeof text).toBe("string");
    if (typeof text !== "string") throw new Error("Expected a copied message");
    const parsed = parseRichOutput(text.split("\n")[1] ?? "");
    expect(parsed?.spec.elements.gallery?.props.items).toEqual([{ fileId: targetId, alt: "Landscape" }]);
    expect(parsed?.spec.elements.files?.props.items).toEqual([{ fileId: targetId, label: sourceId }]);
    expect(parsed?.spec.elements.panel?.props.title).toBe(sourceId);
  });

  it("accepts internal native turns while preserving every visible turn through the target", () => {
    expect(
      isValidForkedThreadHistory(
        ["visible-1", "internal-resume", "visible-2"],
        ["visible-1", "visible-2"],
      ),
    ).toBe(true);
  });

  it.each([
    {
      native: ["visible-1", "visible-2"],
      persisted: ["visible-1", "missing", "visible-2"],
    },
    {
      native: ["visible-2", "visible-1"],
      persisted: ["visible-1", "visible-2"],
    },
    {
      native: ["visible-1", "visible-2", "later-internal"],
      persisted: ["visible-1", "visible-2"],
    },
    { native: [], persisted: [] },
  ])("rejects an invalid forked native history %#", ({ native, persisted }) => {
    expect(isValidForkedThreadHistory(native, persisted)).toBe(false);
  });
});
