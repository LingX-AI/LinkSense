import { describe, expect, it } from "vitest";
import { parseRichOutput, richOutputMarkdownToText, richOutputMaximumCharacters, richOutputText } from "../src/rich-output.js";

const example = () => ({
  version: 1,
  summary: "Verified research summary",
  spec: {
    root: "panel",
    elements: {
      panel: { type: "Panel", props: { title: "Findings" }, children: ["evidence"] },
      evidence: { type: "Evidence", props: { title: "Observation", detail: "Source excerpt", citations: [1] } },
    },
  },
});
const parse = (value: unknown) => parseRichOutput(JSON.stringify(value));

describe("rich output boundary", () => {
  it("accepts a versioned literal spec and produces a readable text snapshot", () => {
    const output = parse(example());
    expect(output).not.toBeNull();
    expect(output && richOutputText(output)).toContain("Source excerpt");
  });

  it.each([
    { version: 2 },
    { initialActions: [{ action: "delete" }] },
    { spec: { root: "panel", elements: { panel: { type: "Unknown", props: {} } } } },
    { spec: { root: "panel", elements: { panel: { type: "Panel", props: { title: { $state: "/secret" } } } } } },
    { spec: { root: "panel", elements: { panel: { type: "Panel", props: { title: "Result", className: "fixed" } } } } },
    { spec: { root: "panel", elements: { panel: { type: "Panel", props: { title: "Result" }, on: { press: { action: "navigate" } } } } } },
    { spec: { root: "panel", elements: { panel: { type: "Panel", props: { title: "Result" }, children: ["constructor"] } } } },
    { spec: { root: "panel", elements: { panel: { type: "Panel", props: { title: "Result" }, children: ["panel"] } } } },
  ])("rejects unsupported versions, executable extensions, props, or broken references: %j", (change) => {
    expect(parse({ ...example(), ...change })).toBeNull();
  });

  it("rejects shared children, unreachable nodes, excessive depth and element count", () => {
    const value = example();
    expect(parse({ ...value, spec: { ...value.spec, elements: {
      ...value.spec.elements, panel: { ...value.spec.elements.panel, children: ["evidence", "evidence"] },
    } } })).toBeNull();
    expect(parse({ ...value, spec: { ...value.spec, elements: {
      ...value.spec.elements, unused: { type: "Text", props: { text: "Unused" } },
    } } })).toBeNull();
    const chain = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, index) =>
      [`node${index}`, { type: index === 0 ? "Panel" : "Grid", props: index === 0 ? { title: "Result" } : { columns: 2 }, children: index < count - 1 ? [`node${index + 1}`] : [] }]));
    expect(parse({ ...value, spec: { root: "node0", elements: chain(8) } })).toBeNull();
    expect(parse({ ...value, spec: { root: "node0", elements: chain(41) } })).toBeNull();
  });

  it("rejects malformed, oversized and empty input before rendering", () => {
    expect(parseRichOutput("{")).toBeNull();
    expect(parseRichOutput(" ".repeat(richOutputMaximumCharacters + 1))).toBeNull();
    expect(parse({ ...example(), spec: { root: "panel", elements: {} } })).toBeNull();
  });

  it("reduces rich output to literal summaries for text channels and preserves surrounding prose and ordinary code", () => {
    const valid = JSON.stringify({ ...example(), summary: "Verified [result](https://example.test)" });
    const code = "```json\n{\"example\":true}\n```";
    const input = `Before\n\n\`\`\`json-render\n${valid}\n\`\`\`\n\n${code}\n\n\`\`\`json-render\nbad JSON\n\`\`\`\n\nAfter`;
    const summary = richOutputMarkdownToText(input, "markdown-summary");
    expect(summary).toContain("Verified \\[result\\]\\(https://example.test\\)");
    expect(summary).toContain(code);
    expect(summary).toMatch(/^Before[\s\S]*After$/u);
    expect(summary).not.toMatch(/bad JSON|"elements"|json-render/u);
    expect(richOutputMarkdownToText(input, "summary")).toContain("Verified [result](https://example.test)");
    expect(richOutputMarkdownToText(input, "text")).toContain("Source excerpt");
  });

  it("checks table row widths and stable IDs, preserving zero and missing chart data", () => {
    const withChild = (type: string, props: unknown) => ({
      ...example(), spec: { root: "panel", elements: {
        panel: { type: "Panel", props: { title: "Data" }, children: ["data"] },
        data: { type, props },
      } },
    });
    expect(parse(withChild("DataTable", { title: "Data", columns: [{ id: "a", label: "A" }], rows: [{ id: "row", values: [1, 2] }] }))).toBeNull();
    expect(parse(withChild("Comparison", { title: "Choices", options: [1, 2].map(() => ({ id: "same", title: "Option", description: "Description", benefits: [], tradeoffs: [] })) }))).toBeNull();
    const chart = parse(withChild("Chart", { title: "Data", kind: "line", unit: "items", points: [
      { id: "a", label: "A", value: 0 }, { id: "b", label: "B", value: null },
    ] }));
    expect(chart && richOutputText(chart)).toContain("A: 0 items");
    expect(chart && richOutputText(chart)).toContain("B: —");
  });
});
