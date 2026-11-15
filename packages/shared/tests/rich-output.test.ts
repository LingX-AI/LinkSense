import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";
import { parseRichOutput, projectRichOutputResourcesForShare, remapRichOutputFileReferences, richOutputChartData, richOutputComponents, richOutputFileIds, richOutputMarkdownToText, richOutputMaximumCharacters, richOutputText } from "../src/rich-output.js";

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
const withChild = (type: string, props: unknown) => ({
  ...example(), spec: { root: "panel", elements: {
    panel: { type: "Panel", props: { title: "Data" }, children: ["data"] },
    data: { type, props },
  } },
});
const readingExample = () => ({
  ...example(),
  spec: {
    root: "panel",
    elements: {
      panel: { type: "Panel", props: { title: "Handoff" }, children: ["views"] },
      views: {
        type: "Tabs",
        props: { title: "Read the report", tabs: [{ id: "summary", label: "Overview" }, { id: "notes", label: "Preparation" }] },
        children: ["summary", "notes"],
      },
      summary: { type: "Text", props: { text: "Keep the main finding visible." } },
      notes: { type: "Details", props: { title: "Before the handoff" }, children: ["checklist"] },
      checklist: { type: "Checklist", props: { title: "Review list", items: [{ id: "input", label: "Verify the input", detail: "Use the original source." }] } },
    },
  },
});

describe("rich output boundary", () => {
  const fileId = "10000000-0000-4000-8000-0000000000ab";
  it.each([
    ["MediaGallery", { fileId, alt: "A landscape", caption: "Design candidate" }],
    ["ResourceList", { fileId, label: "Analysis report", detail: "The final deliverable" }],
  ])("validates %s references and projects descriptions without resource IDs or access links", (type, item) => {
    const output = parse(withChild(type, { title: "Deliverables", items: [item] }));
    expect(output).not.toBeNull();
    if (!output) throw new Error("Expected valid resource output");
    expect(richOutputFileIds(output)).toEqual([fileId]);
    const snapshot = richOutputText(output);
    expect(snapshot).toContain("Deliverables");
    expect(snapshot).toContain("alt" in item ? item.alt : item.label);
    expect(snapshot).toContain("caption" in item ? item.caption : item.detail);
    expect(snapshot).not.toContain(fileId);
    expect(snapshot).not.toMatch(/https?:|linksense-artifact:/u);
  });

  it.each(["MediaGallery", "ResourceList"])("rejects unbounded, duplicate or executable %s references", (type) => {
    const item = type === "MediaGallery" ? { fileId, alt: "Landscape" } : { fileId, label: "Report" };
    for (const items of [
      [], [item, { ...item, fileId: fileId.toUpperCase() }],
      [{ ...item, fileId: "https://example.test/private.png" }],
      [{ ...item, fileId: "../private.png" }],
      [{ ...item, src: "data:image/png;base64,AAAA" }],
      [{ ...item, url: "https://example.test/download" }],
      [{ ...item, onClick: "download" }],
      Array.from({ length: 21 }, (_, index) => ({ ...item, fileId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}` })),
    ]) expect(parse(withChild(type, { title: "Deliverables", items }))).toBeNull();
  });

  it("remaps only validated resource references when copying messages to a fork", () => {
    const targetId = "20000000-0000-4000-8000-000000000001";
    const output = withChild("MediaGallery", { title: "Gallery", items: [{ fileId: fileId.toUpperCase(), alt: fileId }] });
    const ordinaryCode = `\`\`\`json\n{"fileId":"${fileId}"}\n\`\`\``;
    const block = `\`\`\`json-render\n${JSON.stringify(output)}\n\`\`\``;
    const remapped = remapRichOutputFileReferences(`Before ${fileId}\n\n${block}\n\n${ordinaryCode}`, new Map([[fileId, targetId]]));
    expect(remapped).toContain(`Before ${fileId}`);
    expect(remapped).toContain(ordinaryCode);
    expect(remapped).toContain(`"fileId":"${targetId}"`);
    expect(remapped).toContain(`"alt":"${fileId}"`);
    expect(remapRichOutputFileReferences(block, new Map())).toBe(block);
    expect(remapRichOutputFileReferences("```json-render\nbad JSON\n```", new Map([[fileId, targetId]]))).toBe("```json-render\nbad JSON\n```");
  });

  it("keeps resource blocks inside their Markdown containers when copying to a fork", () => {
    const targetId = "20000000-0000-4000-8000-000000000001";
    const output = withChild("ResourceList", { title: "Files", items: [{ fileId, label: "Analysis" }] });
    const quoted = `- > ~~~json-render\r\n  > ${JSON.stringify(output)}\r\n  > ~~~\r\n\r\nAfter`;
    const remapped = remapRichOutputFileReferences(quoted, new Map([[fileId, targetId]]));
    expect(remapped).toContain(`\n  > {"version":1`);
    expect(remapped).toContain(`"fileId":"${targetId}"`);
    const originalTree = fromMarkdown(quoted).children;
    expect(fromMarkdown(remapped).children.map((node) => node.type)).toEqual(originalTree.map((node) => node.type));
    expect(richOutputMarkdownToText(remapped, "summary")).toContain("Verified research summary");
    expect(remapped).toMatch(/After$/u);
  });

  it("projects resource descriptions as literal Markdown on public snapshots without changing old blocks", () => {
    const alt = "![Description](https://example.test/sample.png)";
    const gallery = withChild("MediaGallery", { title: "Gallery", items: [{ fileId, alt, caption: "Notes\n    ### Sample" }] });
    const old = `\`\`\`json-render\n${JSON.stringify(example())}\n\`\`\``;
    const input = `> \`\`\`json-render\n> ${JSON.stringify(gallery)}\n> \`\`\`\n\n${old}`;
    const shared = projectRichOutputResourcesForShare(input);
    expect(shared).not.toContain(fileId);
    expect(shared).toContain("> Gallery");
    expect(shared).toContain("> Notes");
    expect(shared).toContain(old);
    const [quote, oldBlock] = fromMarkdown(shared).children;
    expect(quote?.type).toBe("blockquote");
    expect(oldBlock?.type).toBe("code");
    if (quote?.type !== "blockquote") throw new Error("Expected a quote");
    expect(quote.children.every((node) => node.type === "paragraph")).toBe(true);
    expect(quote.children.flatMap((node) => node.type === "paragraph" ? node.children : [])
      .filter((node) => node.type === "text").map((node) => node.value)).toContain(alt);
  });
  it("accepts a versioned literal spec and produces a readable text snapshot", () => {
    const output = parse(example());
    expect(output).not.toBeNull();
    expect(output && richOutputText(output)).toContain("Source excerpt");
  });

  it("projects every tab and folded child in reading order and retains an external-channel summary", () => {
    const block = `\`\`\`json-render\n${JSON.stringify(readingExample())}\n\`\`\``;
    expect(richOutputMarkdownToText(block, "text")).toBe([
      "Verified research summary", "Handoff", "Read the report", "Overview",
      "Keep the main finding visible.", "Preparation", "Before the handoff",
      "Review list", "- Verify the input\nUse the original source.",
    ].join("\n\n"));
    expect(richOutputMarkdownToText(block, "summary")).toBe("Verified research summary");
  });

  it.each([
    ["missing child", ["summary"]],
    ["reordered child", ["notes", "summary"]],
    ["unrelated reference", ["summary", "missing"]],
    ["shared child", ["summary", "summary"]],
  ])("rejects a tab with a %s", (_description, children) => {
    const output = readingExample();
    output.spec.elements.views.children = children;
    expect(parse(output)).toBeNull();
  });

  it("rejects ambiguous tabs, empty details and checklist controls that could supply state or actions", () => {
    const spec = readingExample();
    const { elements } = spec.spec;
    const replace = (replacement: Record<string, unknown>) => parse({
      ...spec,
      spec: { ...spec.spec, elements: { ...elements, ...replacement } },
    });
    expect(replace({ views: { ...elements.views, props: {
      title: "Report",
      tabs: [{ id: "summary", label: "Same" }, { id: "notes", label: " Same " }],
    } } })).toBeNull();
    expect(replace({ notes: { ...elements.notes, children: [] } })).toBeNull();
    expect(replace({ notes: { ...elements.notes, children: ["views"] } })).toBeNull();
    for (const extra of [{ checked: true }, { action: "submit" }, { label: { $state: "/value" } }]) {
      expect(replace({ checklist: {
        ...elements.checklist,
        props: { title: "Review list", items: [{ id: "input", label: "Verify", ...extra }] },
      } })).toBeNull();
    }
    const item = { id: "input", label: "Verify" };
    for (const items of [[], [item, item], Array.from({ length: 31 }, (_, index) => ({ ...item, id: `task${index}` }))]) {
      expect(replace({ checklist: { ...elements.checklist, props: { title: "Review list", items } } })).toBeNull();
    }
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
    expect(parse(withChild("DataTable", { title: "Data", columns: [{ id: "a", label: "A" }], rows: [{ id: "row", values: [1, 2] }] }))).toBeNull();
    expect(parse(withChild("Comparison", { title: "Choices", options: [1, 2].map(() => ({ id: "same", title: "Option", description: "Description", benefits: [], tradeoffs: [] })) }))).toBeNull();
    const chart = parse(withChild("Chart", { title: "Data", kind: "line", unit: "items", points: [
      { id: "a", label: "A", value: 0 }, { id: "b", label: "B", value: null },
    ] }));
    expect(chart && richOutputText(chart)).toContain("A: 0 items");
    expect(chart && richOutputText(chart)).toContain("B: —");
  });

  it.each([
    ["KeyValue", { title: "Facts", items: [{ id: "a", label: "Count", value: 0 }, { id: "b", label: "Unknown", value: null }] }, ["Count: 0", "Unknown: —"]],
    ["Timeline", { title: "History", items: [{ id: "a", time: "Morning, exact time unknown", title: "First event", detail: "Observed evidence" }, { id: "b", title: "Unscheduled event" }] }, ["Morning, exact time unknown", "Observed evidence", "Unscheduled event"]],
    ["Steps", { title: "Proposed plan", items: [{ id: "a", title: "Inspect", detail: "Read the input" }, { id: "b", title: "Verify" }] }, ["1. Inspect", "Read the input", "2. Verify"]],
    ["Metric", { label: "Errors", value: 0, unit: "errors", period: "November", comparison: { label: "Compared with October", change: -2, unit: "errors" } }, ["0 errors", "November", "Compared with October: -2 errors"]],
  ] as const)("preserves %s details in copying, sharing, and channel summaries", (type, props, expected) => {
    const output = parse(withChild(type, props));
    expect(output).not.toBeNull();
    const markdown = `Before\n\n\`\`\`json-render\n${JSON.stringify(output)}\n\`\`\`\n\nAfter`;
    for (const text of expected) expect(richOutputMarkdownToText(markdown, "text")).toContain(text);
    expect(richOutputMarkdownToText(markdown, "summary")).toBe("Before\n\nVerified research summary\n\nAfter");
  });

  it.each(["KeyValue", "Timeline", "Steps"] as const)("bounds %s entries and rejects duplicate IDs, arbitrary props and actions", (type) => {
    const item = type === "KeyValue" ? { id: "a", label: "A", value: 1 } : { id: "a", title: "A" };
    expect(parse(withChild(type, { title: "Result", items: [] }))).not.toBeNull();
    expect(parse(withChild(type, { title: "Result", items: [item, item] }))).toBeNull();
    expect(parse(withChild(type, { title: "Result", items: [{ ...item, onClick: "run" }] }))).toBeNull();
    expect(parse(withChild(type, { title: "Result", items: Array.from({ length: 31 }, (_, i) => ({ ...item, id: `item${i}` })) }))).toBeNull();
  });

  it("validates typed table cells without requiring new metadata on persisted tables", () => {
    const columns = [{ id: "name", label: "Name", type: "text" }, { id: "value", label: "Value", type: "number", unit: "items" }, { id: "date", label: "Date", type: "date" }];
    const valid = { title: "Records", columns, rows: [{ id: "a", values: ["First", 0, "2026-11-14"] }, { id: "b", values: [null, null, null] }], filterable: true };
    const output = parse(withChild("DataTable", valid));
    expect(output).not.toBeNull();
    expect(output && richOutputText(output)).toContain("Name | Value (items) | Date");
    expect(parse(withChild("DataTable", { title: "Old", columns: [{ id: "name", label: "Name" }], rows: [{ id: "a", values: [12] }] }))).not.toBeNull();
    for (const values of [[12, 0, "2026-11-14"], ["First", "12", "2026-11-14"], ["First", 0, "2026-02-30"], ["First", 0, "2026-11-14T10:00:00"]]) {
      expect(parse(withChild("DataTable", { ...valid, rows: [{ id: "a", values }] }))).toBeNull();
    }
  });

  it("preserves old chart points and projects all new series with zeros and missing values", () => {
    const old = richOutputComponents.Chart.props.parse({ title: "Old", kind: "line", unit: "items", points: [{ id: "a", label: "A", value: null }] });
    expect(richOutputChartData(old)).toEqual({ series: [{ id: "value", label: "items" }], points: [{ id: "a", label: "A", values: [null] }], stacked: false });
    const props = { title: "Quarterly", kind: "bar", unit: "items", stacked: true, series: [{ id: "actual", label: "Actual" }, { id: "target", label: "Target" }], points: [{ id: "a", label: "November", values: [0, null] }] };
    const output = parse(withChild("Chart", props));
    expect(output).not.toBeNull();
    expect(output && richOutputText(output)).toContain("November: Actual: 0 items; Target: —");
    expect(richOutputChartData(richOutputComponents.Chart.props.parse(props)).stacked).toBe(true);
    for (const change of [
      { points: [{ id: "a", label: "November", values: [1, 2, 3] }] },
      { series: [{ id: "a", label: "A" }, { id: "a", label: "B" }] },
      { kind: "line" },
      { points: [{ id: "a", label: "November", value: 1 }] },
      { series: [{ id: "constructor", label: "A", color: "red" }, { id: "b", label: "B" }] },
    ]) expect(parse(withChild("Chart", { ...props, ...change }))).toBeNull();
  });
});
