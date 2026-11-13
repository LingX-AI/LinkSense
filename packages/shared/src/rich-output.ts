import { fromMarkdown } from "mdast-util-from-markdown";
import { z } from "zod";

export const richOutputLanguage = "json-render";
export const richOutputMaximumCharacters = 65_536;
const text = z.string().trim().min(1).max(4_000);
const label = z.string().trim().min(1).max(160);
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u);
const cell = z.union([z.string().max(2_000), z.number().finite(), z.null()]);
const uniqueIds = (items: ReadonlyArray<{ id: string }>): boolean =>
  new Set(items.map((item) => item.id)).size === items.length;
const uniqueValues = (items: readonly (number | string)[]): boolean =>
  new Set(items).size === items.length;
const comparisonPoints = z.array(label).max(8).refine(uniqueValues);

export const richOutputComponents = {
  Panel: {
    props: z.strictObject({ title: label, description: text.optional() }),
    slots: ["default"],
    description: "Root result panel with a title and child elements.",
  },
  Grid: {
    props: z.strictObject({ columns: z.union([z.literal(2), z.literal(3)]) }),
    slots: ["default"],
    description: "Responsive grid of child elements; stacks on narrow screens.",
  },
  Text: {
    props: z.strictObject({ text }),
    description: "Plain explanatory text, without HTML or Markdown.",
  },
  Callout: {
    props: z.strictObject({
      title: label,
      text,
      tone: z.enum(["info", "warning"]),
    }),
    description: "A key finding or a clearly stated limitation.",
  },
  Evidence: {
    props: z.strictObject({
      title: label,
      detail: text,
      citations: z.array(z.number().int().positive().max(10_000)).max(8)
        .refine(uniqueValues).optional(),
    }),
    description: "Expandable evidence. Citation numbers must already exist in this answer's verified sources; never invent source URLs.",
  },
  Comparison: {
    props: z.strictObject({
      title: label,
      options: z.array(z.strictObject({
        id,
        title: label,
        description: text,
        benefits: comparisonPoints,
        tradeoffs: comparisonPoints,
      })).min(2).max(5).refine(uniqueIds, "duplicate_option_id"),
    }),
    description: "Compare 2–5 options; the user locally selects one to inspect its benefits and tradeoffs. Selection is not consent.",
  },
  Metric: {
    props: z.strictObject({
      label,
      value: z.union([z.string().max(160), z.number().finite()]),
      unit: z.string().max(40).optional(),
      detail: text.optional(),
    }),
    description: "A verified metric, with its unit and context.",
  },
  DataTable: {
    props: z.strictObject({
      title: label,
      columns: z.array(z.strictObject({ id, label })).min(1).max(8)
        .refine(uniqueIds, "duplicate_column_id"),
      rows: z.array(z.strictObject({
        id,
        values: z.array(cell).max(8),
      })).max(100).refine(uniqueIds, "duplicate_row_id"),
    }).refine(
      (value) => value.rows.every((row) => row.values.length === value.columns.length),
      "invalid_row_width",
    ),
    description: "Locally sortable table. Each row's values follow column order; use null for missing data.",
  },
  Chart: {
    props: z.strictObject({
      title: label,
      kind: z.enum(["bar", "line"]),
      unit: label,
      points: z.array(z.strictObject({
        id,
        label,
        value: z.number().finite().nullable(),
      })).max(100).refine(uniqueIds, "duplicate_point_id"),
    }),
    description: "Bar or line chart with an accessible data-table view. Only use verified numerical data, preserve ordering and missing values.",
  },
};

// Object.keys loses the literal keys of this module-owned catalog.
const componentName = z.enum(
  Object.keys(richOutputComponents) as Array<keyof typeof richOutputComponents>,
);
const elementSchema = z.strictObject({
  type: componentName,
  props: z.record(z.string(), z.unknown()),
  children: z.array(id).max(40).optional(),
});

export const richOutputSchema = z.strictObject({
  version: z.literal(1),
  summary: text,
  spec: z.strictObject({
    root: id,
    elements: z.record(id, elementSchema),
  }),
}).superRefine((value, context) => {
  const entries = Object.entries(value.spec.elements);
  if (entries.length === 0 || entries.length > 40) {
    context.addIssue({ code: "custom", message: "invalid_element_count" });
    return;
  }
  for (const [elementId, element] of entries) {
    const props = richOutputComponents[element.type].props.safeParse(element.props);
    if (!props.success) {
      context.addIssue({
        code: "custom",
        path: ["spec", "elements", elementId, "props"],
        message: "invalid_component_props",
      });
    }
    if (element.type !== "Panel" && element.type !== "Grid" && element.children?.length) {
      context.addIssue({ code: "custom", message: "unexpected_children" });
    }
  }
  const visited = new Set<string>();
  const pending = [{ elementId: value.spec.root, depth: 0 }];
  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) break;
    if (next.depth > 6 || visited.has(next.elementId) ||
      !Object.hasOwn(value.spec.elements, next.elementId)) {
      context.addIssue({ code: "custom", message: "invalid_element_tree" });
      return;
    }
    visited.add(next.elementId);
    const element = value.spec.elements[next.elementId];
    if (!element || (element.type === "Panel") !== (next.depth === 0)) {
      context.addIssue({ code: "custom", message: "invalid_root" });
      return;
    }
    for (const child of element.children ?? []) {
      pending.push({ elementId: child, depth: next.depth + 1 });
    }
  }
  if (visited.size !== entries.length) {
    context.addIssue({ code: "custom", message: "unreachable_elements" });
  }
});

export type RichOutput = z.infer<typeof richOutputSchema>;
export type RichOutputProps<K extends keyof typeof richOutputComponents> =
  z.infer<(typeof richOutputComponents)[K]["props"]>;

export function parseRichOutput(source: string): RichOutput | null {
  if (source.length > richOutputMaximumCharacters) return null;
  try {
    const result = richOutputSchema.safeParse(JSON.parse(source));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Text snapshots remain useful when copying or sharing without interactive UI. */
export function richOutputText(output: RichOutput): string {
  const lines = [output.summary];
  const visit = (elementId: string): void => {
    const element = output.spec.elements[elementId];
    if (!element) return;
    const props = element.props;
    for (const key of ["title", "label", "text", "description", "detail"]) {
      if (typeof props[key] === "string") lines.push(props[key]);
    }
    if (typeof props.value === "string" || typeof props.value === "number") {
      lines.push([props.value, props.unit].filter((part) => part !== undefined).join(" "));
    }
    if (element.type === "Comparison") {
      const { options } = richOutputComponents.Comparison.props.parse(props);
      for (const option of options) {
        lines.push(option.title, option.description, ...option.benefits, ...option.tradeoffs);
      }
    }
    if (element.type === "DataTable") {
      const { columns, rows } = richOutputComponents.DataTable.props.parse(props);
      lines.push(columns.map((column) => column.label).join(" | "));
      lines.push(...rows.map((row) => row.values.map((value) => value ?? "—").join(" | ")));
    }
    if (element.type === "Chart") {
      const { points, unit } = richOutputComponents.Chart.props.parse(props);
      lines.push(...points.map((point) => `${point.label}: ${point.value === null ? "—" : `${point.value} ${unit}`}`));
    }
    for (const child of element.children ?? []) visit(child);
  };
  visit(output.spec.root);
  return lines.join("\n\n");
}

/** Keep prose and ordinary code fences untouched on text-only delivery paths. */
export function richOutputMarkdownToText(
  content: string,
  mode: "text" | "summary" | "markdown-summary",
): string {
  if ((!content.includes("```") && !content.includes("~~~")) ||
    !content.toLowerCase().includes(richOutputLanguage)) return content;
  const tree = fromMarkdown(content);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  const collect = (nodes: typeof tree.children): void => {
    for (const node of nodes) {
      if ("children" in node) collect(node.children);
      if (node.type !== "code" || node.lang?.toLowerCase() !== richOutputLanguage) continue;
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) continue;
      const output = parseRichOutput(node.value);
      const summary = output?.summary ?? "";
      // Keep the summary literal when it is inserted into a Markdown channel.
      const text = mode === "markdown-summary"
        ? summary.replace(/[\\`*_{}[\]()#+!<>~|]/gu, "\\$&")
        : mode === "text" && output ? richOutputText(output) : summary;
      replacements.push({ start, end, text });
    }
  };
  collect(tree.children);
  let output = content;
  for (const { start, end, text } of replacements.reverse()) {
    output = output.slice(0, start) + text + output.slice(end);
  }
  return output;
}
