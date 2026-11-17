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
const uniqueFileIds = (items: ReadonlyArray<{ fileId: string }>): boolean =>
  uniqueValues(items.map((item) => item.fileId.toLowerCase()));
const comparisonPoints = z.array(label).max(8).refine(uniqueValues);
const tabsPropsSchema = z.strictObject({
  title: label,
  tabs: z.array(z.strictObject({ id, label })).min(2).max(5)
    .refine(uniqueIds, "duplicate_tab_id")
    .refine((tabs) => uniqueValues(tabs.map((tab) => tab.label)), "duplicate_tab_label"),
});
const chartShape = {
  title: label,
  kind: z.enum(["bar", "line"]),
  unit: label,
};
const chartPointShape = { id, label };
const chartSeriesSchema = z.array(z.strictObject({ id, label }))
  .min(2).max(6).refine(uniqueIds, "duplicate_series_id");
const numericCell = z.number().finite().nullable();
const multiSeriesChartSchema = z.strictObject({
  ...chartShape,
  series: chartSeriesSchema,
  points: z.array(z.strictObject({
    ...chartPointShape,
    values: z.array(numericCell).min(2).max(6),
  })).max(100).refine(uniqueIds, "duplicate_point_id"),
  stacked: z.boolean().optional(),
}).refine(
  (value) => value.points.every((point) => point.values.length === value.series.length),
  "invalid_series_width",
).refine((value) => !value.stacked || value.kind === "bar", "invalid_stacked_chart");

export const richOutputComponents = {
  Panel: {
    props: z.strictObject({ title: label, description: text.optional() }),
    slots: ["default"],
    description: "Root result panel with a title and child elements. A Panel nested inside another Panel renders as a titled section.",
  },
  Grid: {
    props: z.strictObject({ columns: z.union([z.literal(2), z.literal(3)]) }),
    slots: ["default"],
    description: "Responsive grid of child elements; stacks on narrow screens.",
  },
  Tabs: {
    props: tabsPropsSchema,
    slots: ["default"],
    description: "Switch between 2–5 distinct views of supplied content. The first view is selected by default. Give tabs short, distinct labels. Provide one child per tab in the same order. Keep the main conclusion visible outside the tabs.",
  },
  Details: {
    props: z.strictObject({ title: label }),
    slots: ["default"],
    description: "A collapsible section with at least one child, closed initially. Use it for optional detail such as calculations or worked examples; use Evidence for citations.",
  },
  Text: {
    props: z.strictObject({ text }),
    description: "Plain explanatory text, without HTML or Markdown.",
  },
  KeyValue: {
    props: z.strictObject({
      title: label,
      items: z.array(z.strictObject({ id, label, value: cell }))
        .max(30).refine(uniqueIds, "duplicate_item_id"),
    }),
    description: "A compact list of labelled facts or metadata. Use null for missing values; use Metric for prominent numbers and DataTable for repeated records.",
  },
  Timeline: {
    props: z.strictObject({
      title: label,
      items: z.array(z.strictObject({
        id,
        title: label,
        time: label.optional(),
        detail: text.optional(),
      })).max(30).refine(uniqueIds, "duplicate_item_id"),
    }),
    description: "Read-only events or milestones in the supplied order. time is a human-readable label preserving known precision and timezone; never invent dates or execution status.",
  },
  Steps: {
    props: z.strictObject({
      title: label,
      items: z.array(z.strictObject({
        id,
        title: label,
        detail: text.optional(),
      })).max(30).refine(uniqueIds, "duplicate_item_id"),
    }),
    description: "Numbered instructions or proposed steps, without execution buttons or progress state. Prefer ordinary prose for a short, simple answer.",
  },
  Checklist: {
    props: z.strictObject({
      title: label,
      items: z.array(z.strictObject({ id, label, detail: text.optional() }))
        .min(1).max(30).refine(uniqueIds, "duplicate_item_id"),
    }),
    description: "A temporary checklist for the reader, initially unchecked. Ticks stay in the mounted card, are not submitted, and do not represent task progress.",
  },
  MediaGallery: {
    props: z.strictObject({
      title: label,
      items: z.array(z.strictObject({
        fileId: z.uuid(),
        alt: label,
        caption: text.optional(),
      })).min(1).max(12).refine(uniqueFileIds, "duplicate_file_id"),
    }),
    description: "A thumbnail grid of 1–12 registered image artifacts from this conversation. Use the returned file_id, never artifact_id, a path, URL or base64. alt describes the image and caption explains its relevance. Preview and download use existing resource authorization; unavailable files show a fallback.",
  },
  ResourceList: {
    props: z.strictObject({
      title: label,
      items: z.array(z.strictObject({
        fileId: z.uuid(),
        label,
        detail: text.optional(),
      })).min(1).max(20).refine(uniqueFileIds, "duplicate_file_id"),
    }),
    description: "A list of 1–20 registered file artifacts from this conversation. Use the file_id returned by register_artifact or generate_image, never artifact_id or an attachment/path/URL. label and detail describe the deliverable; filenames, sizes, preview and download come from authorized records. A valid UUID grants no access.",
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
      period: label.optional(),
      comparison: z.strictObject({
        label,
        change: z.number().finite(),
        unit: z.string().max(40).optional(),
      }).optional(),
    }),
    description: "A verified metric, with its unit, optional period, and optional signed comparison.change with an explicit comparison label/unit. A change is not automatically good or bad; never invent baselines or percentages.",
  },
  DataTable: {
    props: z.strictObject({
      title: label,
      columns: z.array(z.strictObject({
        id,
        label,
        type: z.enum(["text", "number", "date"]).optional(),
        unit: z.string().max(40).optional(),
      })).min(1).max(8)
        .refine(uniqueIds, "duplicate_column_id"),
      rows: z.array(z.strictObject({
        id,
        values: z.array(cell).max(8),
      })).max(100).refine(uniqueIds, "duplicate_row_id"),
      filterable: z.boolean().optional(),
    }).refine(
      (value) => value.rows.every((row) => row.values.length === value.columns.length),
      "invalid_row_width",
    ).superRefine((value, context) => {
      for (const row of value.rows) {
        row.values.forEach((cell, index) => {
          const type = value.columns[index]?.type;
          if (cell === null || type === undefined) return;
          if (
            (type === "number" && typeof cell !== "number") ||
            (type === "text" && typeof cell !== "string") ||
            (type === "date" && !z.iso.date().safeParse(cell).success)
          ) context.addIssue({ code: "custom", message: "invalid_cell_type" });
        });
      }
    }),
    description: "Locally sortable table with optional local filtering. Row values follow column order. Optional column types require matching raw values; date means YYYY-MM-DD without time conversion. Put units in column metadata; null means missing. Filtering never queries more records.",
  },
  Chart: {
    props: z.union([
      z.strictObject({
        ...chartShape,
        points: z.array(z.strictObject({
          ...chartPointShape,
          value: numericCell,
        })).max(100).refine(uniqueIds, "duplicate_point_id"),
      }),
      multiSeriesChartSchema,
    ]),
    description: "Bar/line chart with a data-table view. Single series uses points[].value. Multiple series uses 2–6 unique series[{id,label}] and points[{id,label,values}], with values in series order; optional stacked=true is only for bars. All series share one explicit unit. Preserve null and ordering; use verified data only.",
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
    const children = element.children ?? [];
    if (element.type === "Tabs") {
      const tabs = tabsPropsSchema.safeParse(element.props);
      // Views pair with tabs by position; tab IDs only label the switch.
      if (tabs.success && tabs.data.tabs.length !== children.length) {
        context.addIssue({ code: "custom", path: ["spec", "elements", elementId, "children"], message: "invalid_tab_children" });
      }
    } else if (element.type === "Details") {
      if (children.length === 0) {
        context.addIssue({ code: "custom", path: ["spec", "elements", elementId, "children"], message: "missing_details_children" });
      }
    } else if (element.type !== "Panel" && element.type !== "Grid" && children.length) {
      context.addIssue({ code: "custom", path: ["spec", "elements", elementId, "children"], message: "unexpected_children" });
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
    if (!element || (next.depth === 0 && element.type !== "Panel")) {
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

export function richOutputFileIds(output: RichOutput): string[] {
  return [...new Set(Object.values(output.spec.elements).flatMap((element) =>
    element.type === "MediaGallery" || element.type === "ResourceList"
      ? richOutputComponents[element.type].props.parse(element.props).items.map(
          (item) => item.fileId.toLowerCase(),
        )
      : [],
  ))];
}

/** A fork keeps descriptions intact and changes only validated resource bindings. */
export function remapRichOutputFileReferences(
  content: string,
  replacements: ReadonlyMap<string, string>,
): string {
  if (replacements.size === 0) return content;
  return replaceRichOutputBlocks(content, (output, continuation) => {
    if (!output) return undefined;
    let changed = false;
    for (const element of Object.values(output.spec.elements)) {
      if (element.type !== "MediaGallery" && element.type !== "ResourceList") continue;
      element.props.items = richOutputComponents[element.type].props.parse(element.props).items.map((item) => {
        const fileId = replacements.get(item.fileId.toLowerCase());
        if (!fileId || fileId === item.fileId) return item;
        changed = true;
        return { ...item, fileId };
      });
    }
    return changed
      ? [`\`\`\`${richOutputLanguage}`, JSON.stringify(output), "```"].join(`\n${continuation}`)
      : undefined;
  });
}

/** Keep resource descriptions in public snapshots without serializing private file bindings. */
export function projectRichOutputResourcesForShare(content: string): string {
  return replaceRichOutputBlocks(content, (output, continuation) => {
    if (!output || richOutputFileIds(output).length === 0) return undefined;
    // In Markdown channels these values still need to be treated as literal text.
    return richOutputText(output).split(/\r\n?|\n/u).map((line) => {
      const text = line.trim().replace(/[!-/:-@[-`{-~]/gu, "\\$&");
      return text ? `${text}  ` : "";
    }).join(`\n${continuation}`).trimEnd();
  });
}

export function richOutputChartData(props: RichOutputProps<"Chart">): {
  series: Array<{ id: string; label: string }>;
  points: Array<{ id: string; label: string; values: Array<number | null> }>;
  stacked: boolean;
} {
  return "series" in props
    ? { series: props.series, points: props.points, stacked: props.stacked ?? false }
    : {
        series: [{ id: "value", label: props.unit }],
        points: props.points.map(({ id, label, value }) => ({ id, label, values: [value] })),
        stacked: false,
      };
}

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
    if (element.type === "KeyValue") {
      const { items } = richOutputComponents.KeyValue.props.parse(props);
      lines.push(...items.map((item) => `${item.label}: ${item.value ?? "—"}`));
    }
    if (element.type === "Timeline") {
      const { items } = richOutputComponents.Timeline.props.parse(props);
      lines.push(...items.map((item) =>
        [item.time, item.title, item.detail].filter((part) => part !== undefined).join("\n"),
      ));
    }
    if (element.type === "Steps") {
      const { items } = richOutputComponents.Steps.props.parse(props);
      lines.push(...items.map((item, index) =>
        [`${index + 1}. ${item.title}`, item.detail].filter((part) => part !== undefined).join("\n"),
      ));
    }
    if (element.type === "Checklist") {
      const { items } = richOutputComponents.Checklist.props.parse(props);
      lines.push(...items.map(({ label, detail }) => detail ? `- ${label}\n${detail}` : `- ${label}`));
    }
    if (element.type === "MediaGallery") {
      const { items } = richOutputComponents.MediaGallery.props.parse(props);
      lines.push(...items.map(({ alt, caption }) => caption ? `${alt}\n${caption}` : alt));
    }
    if (element.type === "ResourceList") {
      const { items } = richOutputComponents.ResourceList.props.parse(props);
      lines.push(...items.map(({ label, detail }) => detail ? `${label}\n${detail}` : label));
    }
    if (element.type === "Metric") {
      const { period, comparison } = richOutputComponents.Metric.props.parse(props);
      if (period) lines.push(period);
      if (comparison) lines.push(
        `${comparison.label}: ${comparison.change > 0 ? "+" : ""}${comparison.change}${comparison.unit ? ` ${comparison.unit}` : ""}`,
      );
    }
    if (element.type === "Comparison") {
      const { options } = richOutputComponents.Comparison.props.parse(props);
      for (const option of options) {
        lines.push(option.title, option.description, ...option.benefits, ...option.tradeoffs);
      }
    }
    if (element.type === "DataTable") {
      const { columns, rows } = richOutputComponents.DataTable.props.parse(props);
      lines.push(columns.map((column) => column.unit ? `${column.label} (${column.unit})` : column.label).join(" | "));
      lines.push(...rows.map((row) => row.values.map((value) => value ?? "—").join(" | ")));
    }
    if (element.type === "Chart") {
      const chart = richOutputComponents.Chart.props.parse(props);
      const { points, series } = richOutputChartData(chart);
      lines.push(...points.map((point) => `${point.label}: ${point.values.map((value, index) =>
        `${series.length > 1 ? `${series[index]?.label}: ` : ""}${value === null ? "—" : `${value} ${chart.unit}`}`,
      ).join("; ")}`));
    }
    if (element.type === "Tabs") {
      const { tabs } = tabsPropsSchema.parse(props);
      // Views pair with tab labels by position, not by ID.
      (element.children ?? []).forEach((child, index) => {
        const label = tabs[index]?.label;
        if (label) lines.push(label);
        visit(child);
      });
    } else {
      for (const child of element.children ?? []) visit(child);
    }
  };
  visit(output.spec.root);
  return lines.join("\n\n");
}

/** Keep prose and ordinary code fences untouched on text-only delivery paths. */
export function richOutputMarkdownToText(
  content: string,
  mode: "text" | "summary" | "markdown-summary",
): string {
  return replaceRichOutputBlocks(content, (output) => {
    const summary = output?.summary ?? "";
    // Keep the summary literal when it is inserted into a Markdown channel.
    return mode === "markdown-summary"
      ? summary.replace(/[\\`*_{}[\]()#+!<>~|]/gu, "\\$&")
      : mode === "text" && output ? richOutputText(output) : summary;
  });
}

function replaceRichOutputBlocks(
  content: string,
  replace: (output: RichOutput | null, continuation: string) => string | undefined,
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
      const lineStart = Math.max(content.lastIndexOf("\n", start - 1), content.lastIndexOf("\r", start - 1)) + 1;
      // Continue nested quotes/lists without repeating their list item marker.
      const continuation = content.slice(lineStart, start).replace(/[^>\t ]/gu, " ");
      const text = replace(parseRichOutput(node.value), continuation);
      if (text !== undefined) replacements.push({ start, end, text });
    }
  };
  collect(tree.children);
  let output = content;
  for (const { start, end, text } of replacements.reverse()) {
    output = output.slice(0, start) + text + output.slice(end);
  }
  return output;
}
