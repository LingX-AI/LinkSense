import type {
  Locale,
  UsageAnalyticsReport,
  UsageCostBreakdown,
  UsageMeasurementMethod,
  UsageMetrics,
  UsageModelBreakdown,
  UsageModelKind,
  UsageTokenBreakdown,
  UsageWorkload,
} from "@linksense/shared";
import {
  CNY,
  add,
  allocate,
  dinero,
  equal,
  halfUp,
  toSnapshot,
  transformScale,
} from "dinero.js/bigint";
import ExcelJS from "exceljs";

import { translateBackend } from "../../lib/i18n.js";

const cnyTransportScale = 12n;
const cnyDisplayScale = 2n;
const cnyTransportFactor = 10n ** cnyTransportScale;
const cnyNumberFormat = '"¥"#,##0.00';
const integerNumberFormat = "#,##0";
const usageWorkloads: UsageWorkload[] = [
  "assistant_response",
  "memory_generation",
  "document_embedding",
  "query_embedding",
  "rerank",
  "image_generation",
];

const costFields = [
  "total_cost",
  "input_cost",
  "cached_input_cost",
  "output_cost",
] as const;

type CostField = (typeof costFields)[number];
type AllocatedCosts = Record<CostField, bigint>;
type WorkbookCellValue = ExcelJS.CellValue;

type ColumnDefinition = {
  header: string;
  width: number;
  numberFormat?: string;
};

export type UsageWorkbookResult = {
  buffer: Buffer;
  dataRowCount: number;
};

export async function buildUsageAnalyticsWorkbook(input: {
  report: UsageAnalyticsReport;
  locale: Locale;
  productName: string;
}): Promise<UsageWorkbookResult> {
  const { report, locale, productName } = input;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = productName;
  workbook.company = productName;
  workbook.created = new Date(report.generated_at);
  workbook.modified = new Date(report.generated_at);
  workbook.calcProperties.fullCalcOnLoad = true;

  addSummarySheet(workbook, report, locale, productName);
  const dataRowCount =
    addTrendSheet(workbook, report, locale) +
    addModelSheet(workbook, report, locale) +
    addWorkloadSheet(workbook, report, locale) +
    addApplicationSheet(workbook, report, locale) +
    addApplicationModelSheet(workbook, report, locale) +
    addGroupSheet(workbook, report, locale) +
    addGroupModelSheet(workbook, report, locale) +
    addUserSheet(workbook, report, locale) +
    addUserModelSheet(workbook, report, locale);

  const output = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(output), dataRowCount };
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
  productName: string,
): void {
  const worksheet = workbook.addWorksheet(t(locale, "sheets.summary"), {
    views: [{ showGridLines: false }],
  });
  worksheet.columns = [
    { width: 25 },
    { width: 28 },
    { width: 25 },
    { width: 28 },
  ];
  worksheet.mergeCells("A1:D1");
  const title = worksheet.getCell("A1");
  title.value = translateBackend("usageExport.workbookTitle", locale, {
    productName,
  });
  title.font = { bold: true, color: { argb: "FF27272A" }, size: 18 };
  title.fill = solidFill("FFF1F1F3");
  title.alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 34;

  addSummaryPair(
    worksheet,
    3,
    t(locale, "fields.period"),
    periodLabel(report, locale),
    t(locale, "fields.timeZone"),
    report.period.time_zone,
  );
  addSummaryPair(
    worksheet,
    4,
    t(locale, "fields.dateFrom"),
    report.period.from
      ? zonedDateCellValue(report.period.from, report.period.time_zone)
      : t(locale, "allTime"),
    t(locale, "fields.dateTo"),
    zonedDateCellValue(report.period.to, report.period.time_zone),
  );
  addSummaryPair(
    worksheet,
    5,
    t(locale, "fields.generatedAt"),
    zonedDateCellValue(report.generated_at, report.period.time_zone),
    t(locale, "fields.tokenCoverageStartedAt"),
    zonedDateCellValue(
      report.token_coverage.started_at,
      report.period.time_zone,
    ),
  );
  for (const address of ["B4", "D4", "B5", "D5"]) {
    worksheet.getCell(address).numFmt = "yyyy-mm-dd hh:mm:ss";
  }

  addSummarySection(
    worksheet,
    7,
    t(locale, "fields.tasks"),
    report.totals.task_count,
  );
  addSummarySection(
    worksheet,
    8,
    t(locale, "fields.turns"),
    report.totals.turn_count,
  );
  addSummarySection(
    worksheet,
    9,
    t(locale, "fields.requests"),
    report.totals.request_count,
  );
  addSummarySection(
    worksheet,
    10,
    t(locale, "fields.totalTokens"),
    tokenCellValue(report.totals.token_usage.total_tokens),
  );
  addSummarySection(
    worksheet,
    11,
    t(locale, "fields.inputTokens"),
    tokenCellValue(report.totals.token_usage.input_tokens),
  );
  addSummarySection(
    worksheet,
    12,
    t(locale, "fields.cachedInputTokens"),
    tokenCellValue(report.totals.token_usage.cached_input_tokens),
  );
  addSummarySection(
    worksheet,
    13,
    t(locale, "fields.outputTokens"),
    tokenCellValue(report.totals.token_usage.output_tokens),
  );
  addSummarySection(
    worksheet,
    14,
    t(locale, "fields.reasoningOutputTokens"),
    tokenCellValue(report.totals.token_usage.reasoning_output_tokens),
  );
  addSummarySection(
    worksheet,
    15,
    t(locale, "fields.totalCost"),
    costCellValue(roundCost(report.totals.cost.total_cost)),
    cnyNumberFormat,
  );
  addSummarySection(
    worksheet,
    16,
    t(locale, "fields.unpricedTokens"),
    tokenCellValue(report.totals.cost.unpriced_tokens),
  );

  const notes = [
    t(locale, "notes.tokenComposition"),
    t(locale, "notes.cost"),
    t(locale, "notes.groupSemantics"),
  ];
  notes.forEach((note, index) => {
    const row = 18 + index;
    worksheet.mergeCells(row, 1, row, 4);
    const cell = worksheet.getCell(row, 1);
    cell.value = note;
    cell.font = { color: { argb: "FF6B7280" }, size: 10 };
    cell.alignment = { wrapText: true, vertical: "top" };
    worksheet.getRow(row).height = 30;
  });
}

function addTrendSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const pointCosts = allocateCostBreakdowns(
    report.token_trend.points,
    (point) => point.cost,
    report.totals.cost,
  );
  const workloadFields = usageWorkloads.flatMap((workload) => [
    `${workloadLabel(locale, workload)} ${t(locale, "fields.totalTokens")}`,
    `${workloadLabel(locale, workload)} ${t(locale, "fields.totalCost")}`,
  ]);
  const columns: ColumnDefinition[] = [
    {
      header: t(locale, "fields.periodStart"),
      width: 15,
      numberFormat: "yyyy-mm-dd",
    },
    ...metricColumns(locale),
    ...workloadFields.map((header, index) => ({
      header,
      width: 22,
      numberFormat: index % 2 === 0 ? integerNumberFormat : cnyNumberFormat,
    })),
  ];
  const rows = report.token_trend.points.map((point, pointIndex) => {
    const allocatedWorkloadTotalCosts = allocateCostValues(
      point.workloads.map((workload) => workload.cost.total_cost),
      point.cost.total_cost,
      pointCosts[pointIndex]?.total_cost,
    );
    const workloadCells = usageWorkloads.flatMap<WorkbookCellValue>(
      (workload) => {
        const workloadIndex = point.workloads.findIndex(
          (item) => item.workload === workload,
        );
        const item = point.workloads[workloadIndex];
        return item
          ? [
              tokenCellValue(item.token_usage.total_tokens),
              costCellValue(allocatedWorkloadTotalCosts[workloadIndex] ?? 0n),
            ]
          : [0, 0];
      },
    );
    return [
      dateCellValue(point.period_start),
      ...metricsCells(
        {
          request_count: point.workloads.reduce(
            (sum, workload) => sum + workload.request_count,
            0,
          ),
          token_usage: point.token_usage,
          cost: point.cost,
        },
        pointCosts[pointIndex] ?? zeroAllocatedCosts(),
      ),
      ...workloadCells,
    ];
  });
  addDataSheet(
    workbook,
    t(locale, "sheets.trend"),
    "UsageTrend",
    columns,
    rows,
  );
  return rows.length;
}

function addModelSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const costs = allocateCostBreakdowns(
    report.models,
    (model) => model.cost,
    report.totals.cost,
  );
  const rows = report.models.map((model, index) => [
    model.display_name ?? model.model_id,
    model.model_id,
    modelKindLabel(locale, model.model_kind),
    listLabels(model.workload_types, (workload) =>
      workloadLabel(locale, workload),
    ),
    listLabels(model.measurement_methods, (method) =>
      measurementLabel(locale, method),
    ),
    ...modelMetricsCells(model, costs[index] ?? zeroAllocatedCosts()),
  ]);
  addDataSheet(
    workbook,
    t(locale, "sheets.models"),
    "UsageModels",
    modelColumns(locale),
    rows,
  );
  return rows.length;
}

function addWorkloadSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const costs = allocateCostBreakdowns(
    report.workloads,
    (workload) => workload.cost,
    report.totals.cost,
  );
  const rows = report.workloads.map((workload, index) => [
    workloadLabel(locale, workload.workload),
    listLabels(workload.measurement_methods, (method) =>
      measurementLabel(locale, method),
    ),
    ...metricsCells(workload, costs[index] ?? zeroAllocatedCosts()),
  ]);
  addDataSheet(
    workbook,
    t(locale, "sheets.workloads"),
    "UsageWorkloads",
    [
      { header: t(locale, "fields.workload"), width: 24 },
      { header: t(locale, "fields.measurementMethods"), width: 24 },
      ...metricColumns(locale),
    ],
    rows,
  );
  return rows.length;
}

function addApplicationSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const costs = allocateCostBreakdowns(
    report.applications,
    (application) => application.metrics.cost,
    report.totals.cost,
  );
  const rows = report.applications.map((application, index) => [
    applicationLabel(locale, application),
    ...metricsCells(application.metrics, costs[index] ?? zeroAllocatedCosts()),
  ]);
  addDataSheet(
    workbook,
    t(locale, "sheets.applications"),
    "UsageApplications",
    [
      { header: t(locale, "fields.application"), width: 28 },
      ...metricColumns(locale),
    ],
    rows,
  );
  return rows.length;
}

function addApplicationModelSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const applicationCosts = allocateCostBreakdowns(
    report.applications,
    (application) => application.metrics.cost,
    report.totals.cost,
  );
  const rows: WorkbookCellValue[][] = [];
  report.applications.forEach((application, applicationIndex) => {
    const modelCosts = allocateCostBreakdowns(
      application.models,
      (model) => model.cost,
      application.metrics.cost,
      applicationCosts[applicationIndex],
    );
    application.models.forEach((model, modelIndex) => {
      rows.push([
        applicationLabel(locale, application),
        model.display_name ?? model.model_id,
        model.model_id,
        modelKindLabel(locale, model.model_kind),
        listLabels(model.workload_types, (workload) =>
          workloadLabel(locale, workload),
        ),
        listLabels(model.measurement_methods, (method) =>
          measurementLabel(locale, method),
        ),
        ...modelMetricsCells(
          model,
          modelCosts[modelIndex] ?? zeroAllocatedCosts(),
        ),
      ]);
    });
  });
  addDataSheet(
    workbook,
    t(locale, "sheets.applicationModels"),
    "UsageApplicationModels",
    [
      { header: t(locale, "fields.application"), width: 28 },
      ...modelColumns(locale),
    ],
    rows,
  );
  return rows.length;
}

function addGroupSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const rows = report.groups.map((group) => [
    group.is_ungrouped ? t(locale, "ungrouped") : group.group_name,
    group.member_count,
    ...metricsCells(group.metrics, roundCostBreakdown(group.metrics.cost)),
  ]);
  addDataSheet(
    workbook,
    t(locale, "sheets.groups"),
    "UsageGroups",
    [
      { header: t(locale, "fields.group"), width: 28 },
      {
        header: t(locale, "fields.memberCount"),
        width: 14,
        numberFormat: integerNumberFormat,
      },
      ...metricColumns(locale),
    ],
    rows,
  );
  return rows.length;
}

function addGroupModelSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const rows: WorkbookCellValue[][] = [];
  for (const group of report.groups) {
    const costs = allocateCostBreakdowns(
      group.models,
      (model) => model.cost,
      group.metrics.cost,
    );
    group.models.forEach((model, index) => {
      rows.push([
        group.is_ungrouped ? t(locale, "ungrouped") : group.group_name,
        model.display_name ?? model.model_id,
        model.model_id,
        modelKindLabel(locale, model.model_kind),
        listLabels(model.workload_types, (workload) =>
          workloadLabel(locale, workload),
        ),
        listLabels(model.measurement_methods, (method) =>
          measurementLabel(locale, method),
        ),
        ...modelMetricsCells(model, costs[index] ?? zeroAllocatedCosts()),
      ]);
    });
  }
  addDataSheet(
    workbook,
    t(locale, "sheets.groupModels"),
    "UsageGroupModels",
    [{ header: t(locale, "fields.group"), width: 28 }, ...modelColumns(locale)],
    rows,
  );
  return rows.length;
}

function addUserSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const costs = allocateCostBreakdowns(
    report.users,
    (user) => user.metrics.cost,
    report.totals.cost,
  );
  const rows = report.users.map((user, index) => [
    user.name,
    user.email,
    roleLabel(locale, user.role),
    statusLabel(locale, user.status),
    user.groups.map((group) => group.name).join(", "),
    ...metricsCells(user.metrics, costs[index] ?? zeroAllocatedCosts()),
  ]);
  addDataSheet(
    workbook,
    t(locale, "sheets.users"),
    "UsageUsers",
    [
      { header: t(locale, "fields.user"), width: 24 },
      { header: t(locale, "fields.email"), width: 34 },
      { header: t(locale, "fields.role"), width: 16 },
      { header: t(locale, "fields.status"), width: 14 },
      { header: t(locale, "fields.groups"), width: 30 },
      ...metricColumns(locale),
    ],
    rows,
  );
  return rows.length;
}

function addUserModelSheet(
  workbook: ExcelJS.Workbook,
  report: UsageAnalyticsReport,
  locale: Locale,
): number {
  const userCosts = allocateCostBreakdowns(
    report.users,
    (user) => user.metrics.cost,
    report.totals.cost,
  );
  const rows: WorkbookCellValue[][] = [];
  report.users.forEach((user, userIndex) => {
    const modelCosts = allocateCostBreakdowns(
      user.models,
      (model) => model.cost,
      user.metrics.cost,
      userCosts[userIndex],
    );
    user.models.forEach((model, modelIndex) => {
      rows.push([
        user.name,
        user.email,
        model.display_name ?? model.model_id,
        model.model_id,
        modelKindLabel(locale, model.model_kind),
        listLabels(model.workload_types, (workload) =>
          workloadLabel(locale, workload),
        ),
        listLabels(model.measurement_methods, (method) =>
          measurementLabel(locale, method),
        ),
        ...modelMetricsCells(
          model,
          modelCosts[modelIndex] ?? zeroAllocatedCosts(),
        ),
      ]);
    });
  });
  addDataSheet(
    workbook,
    t(locale, "sheets.userModels"),
    "UsageUserModels",
    [
      { header: t(locale, "fields.user"), width: 24 },
      { header: t(locale, "fields.email"), width: 34 },
      ...modelColumns(locale),
    ],
    rows,
  );
  return rows.length;
}

function addDataSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  tableName: string,
  columns: ColumnDefinition[],
  rows: WorkbookCellValue[][],
): void {
  const worksheet = workbook.addWorksheet(name, {
    views: [
      {
        state: "frozen",
        xSplit: 1,
        ySplit: 1,
        topLeftCell: "B2",
        showGridLines: false,
      },
    ],
  });
  worksheet.addTable({
    name: tableName,
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleLight1", showRowStripes: false },
    columns: columns.map((column) => ({
      name: column.header,
      filterButton: true,
    })),
    rows,
  });
  columns.forEach((column, index) => {
    const worksheetColumn = worksheet.getColumn(index + 1);
    worksheetColumn.width = column.width;
    if (column.numberFormat) worksheetColumn.numFmt = column.numberFormat;
  });
  worksheet.getRow(1).height = 28;
  worksheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  worksheet.getRow(1).eachCell((cell) => {
    cell.fill = solidFill("FFF4F4F5");
    cell.font = { bold: true, color: { argb: "FF3F3F46" } };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFD4D4D8" } },
    };
  });
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber % 2 === 1) {
      row.eachCell((cell) => {
        cell.fill = solidFill("FFFAFAFA");
      });
    }
  });
}

function metricColumns(locale: Locale): ColumnDefinition[] {
  return [
    {
      header: t(locale, "fields.tasks"),
      width: 13,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.turns"),
      width: 13,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.requests"),
      width: 16,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.totalTokens"),
      width: 18,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.inputTokens"),
      width: 18,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.cachedInputTokens"),
      width: 21,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.outputTokens"),
      width: 18,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.reasoningOutputTokens"),
      width: 22,
      numberFormat: integerNumberFormat,
    },
    {
      header: t(locale, "fields.totalCost"),
      width: 16,
      numberFormat: cnyNumberFormat,
    },
    {
      header: t(locale, "fields.inputCost"),
      width: 16,
      numberFormat: cnyNumberFormat,
    },
    {
      header: t(locale, "fields.cachedInputCost"),
      width: 19,
      numberFormat: cnyNumberFormat,
    },
    {
      header: t(locale, "fields.outputCost"),
      width: 16,
      numberFormat: cnyNumberFormat,
    },
    {
      header: t(locale, "fields.unpricedTokens"),
      width: 20,
      numberFormat: integerNumberFormat,
    },
  ];
}

function modelColumns(locale: Locale): ColumnDefinition[] {
  return [
    { header: t(locale, "fields.model"), width: 28 },
    { header: t(locale, "fields.modelId"), width: 32 },
    { header: t(locale, "fields.modelKind"), width: 18 },
    { header: t(locale, "fields.workloads"), width: 32 },
    { header: t(locale, "fields.measurementMethods"), width: 24 },
    ...metricColumns(locale),
  ];
}

function modelMetricsCells(
  model: UsageModelBreakdown,
  costs: AllocatedCosts,
): WorkbookCellValue[] {
  return [
    0,
    model.turn_count,
    model.request_count,
    ...tokenCells(model.token_usage),
    ...costCells(costs),
    tokenCellValue(model.cost.unpriced_tokens),
  ];
}

function metricsCells(
  metrics:
    | Pick<
        UsageMetrics,
        "task_count" | "turn_count" | "request_count" | "token_usage" | "cost"
      >
    | {
        request_count: number;
        token_usage: UsageTokenBreakdown;
        cost: UsageCostBreakdown;
      },
  costs: AllocatedCosts,
): WorkbookCellValue[] {
  return [
    "task_count" in metrics ? metrics.task_count : 0,
    "turn_count" in metrics ? metrics.turn_count : 0,
    metrics.request_count,
    ...tokenCells(metrics.token_usage),
    ...costCells(costs),
    tokenCellValue(metrics.cost.unpriced_tokens),
  ];
}

function tokenCells(tokens: UsageTokenBreakdown): WorkbookCellValue[] {
  return [
    tokenCellValue(tokens.total_tokens),
    tokenCellValue(tokens.input_tokens),
    tokenCellValue(tokens.cached_input_tokens),
    tokenCellValue(tokens.output_tokens),
    tokenCellValue(tokens.reasoning_output_tokens),
  ];
}

function costCells(costs: AllocatedCosts): WorkbookCellValue[] {
  return costFields.map((field) => costCellValue(costs[field]));
}

function allocateCostBreakdowns<T>(
  rows: readonly T[],
  getCost: (row: T) => UsageCostBreakdown,
  expectedTotal: UsageCostBreakdown,
  target?: AllocatedCosts,
): AllocatedCosts[] {
  const allocatedByField = Object.fromEntries(
    costFields.map((field) => [
      field,
      allocateCostValues(
        rows.map((row) => getCost(row)[field]),
        expectedTotal[field],
        target?.[field],
      ),
    ]),
  ) as Record<CostField, bigint[]>;
  return rows.map(
    (_, index) =>
      Object.fromEntries(
        costFields.map((field) => [
          field,
          allocatedByField[field][index] ?? 0n,
        ]),
      ) as AllocatedCosts,
  );
}

function allocateCostValues(
  values: readonly string[],
  expectedTotal: string,
  targetMinorUnits?: bigint,
): bigint[] {
  const parts = values.map(parseCost);
  const total = parseCost(expectedTotal);
  if (!total || parts.some((part) => part === null)) {
    return values.map(roundCost);
  }
  const preciseParts = parts.filter((part) => part !== null);
  const preciseSum = preciseParts.reduce(
    (sum, part) => add(sum, part),
    dinero({ amount: 0n, currency: CNY, scale: cnyTransportScale }),
  );
  if (!equal(preciseSum, total)) return values.map(roundCost);

  const roundedTotal =
    targetMinorUnits === undefined
      ? transformScale(total, cnyDisplayScale, halfUp)
      : dinero({ amount: targetMinorUnits, currency: CNY });
  if (preciseParts.length === 0) return [];
  const ratios = preciseParts.map((part) => toSnapshot(part).amount);
  if (ratios.every((ratio) => ratio === 0n)) return ratios.map(() => 0n);
  return allocate(roundedTotal, ratios).map((part) => toSnapshot(part).amount);
}

function roundCostBreakdown(cost: UsageCostBreakdown): AllocatedCosts {
  return Object.fromEntries(
    costFields.map((field) => [field, roundCost(cost[field])]),
  ) as AllocatedCosts;
}

function roundCost(value: string): bigint {
  const parsed = parseCost(value);
  return parsed
    ? toSnapshot(transformScale(parsed, cnyDisplayScale, halfUp)).amount
    : 0n;
}

function parseCost(value: string) {
  const match = /^(\d+)(?:\.(\d{1,12}))?$/u.exec(value);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  return dinero({
    amount:
      BigInt(whole) * cnyTransportFactor +
      BigInt(fraction.padEnd(Number(cnyTransportScale), "0")),
    currency: CNY,
    scale: cnyTransportScale,
  });
}

function tokenCellValue(value: string): number | string {
  const parsed = BigInt(value);
  return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : value;
}

function costCellValue(minorUnits: bigint): number | string {
  return minorUnits <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(minorUnits) / 100
    : `${minorUnits / 100n}.${(minorUnits % 100n).toString().padStart(2, "0")}`;
}

function dateCellValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function zonedDateCellValue(value: string, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
  return new Date(
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ),
  );
}

function zeroAllocatedCosts(): AllocatedCosts {
  return {
    total_cost: 0n,
    input_cost: 0n,
    cached_input_cost: 0n,
    output_cost: 0n,
  };
}

function addSummaryPair(
  worksheet: ExcelJS.Worksheet,
  row: number,
  leftLabel: string,
  leftValue: WorkbookCellValue,
  rightLabel: string,
  rightValue: WorkbookCellValue,
): void {
  worksheet.getCell(row, 1).value = leftLabel;
  worksheet.getCell(row, 2).value = leftValue;
  worksheet.getCell(row, 3).value = rightLabel;
  worksheet.getCell(row, 4).value = rightValue;
  for (const column of [1, 3]) {
    worksheet.getCell(row, column).font = {
      bold: true,
      color: { argb: "FF475569" },
    };
  }
}

function addSummarySection(
  worksheet: ExcelJS.Worksheet,
  row: number,
  label: string,
  value: WorkbookCellValue,
  numberFormat = integerNumberFormat,
): void {
  worksheet.getCell(row, 1).value = label;
  worksheet.getCell(row, 1).font = { bold: true, color: { argb: "FF475569" } };
  worksheet.getCell(row, 2).value = value;
  worksheet.getCell(row, 2).numFmt = numberFormat;
}

function periodLabel(report: UsageAnalyticsReport, locale: Locale): string {
  if (report.range === "all") return t(locale, "allTime");
  if (report.range === "7d") return t(locale, "ranges.sevenDays");
  if (report.range === "30d") return t(locale, "ranges.thirtyDays");
  return `${report.period.from?.slice(0, 10) ?? ""} – ${report.period.to.slice(0, 10)}`;
}

function modelKindLabel(locale: Locale, value: UsageModelKind): string {
  return t(locale, `modelKinds.${value}`);
}

function workloadLabel(locale: Locale, value: UsageWorkload): string {
  return t(locale, `workloads.${value}`);
}

function measurementLabel(
  locale: Locale,
  value: UsageMeasurementMethod,
): string {
  return t(locale, `measurementMethods.${value}`);
}

function roleLabel(locale: Locale, value: "user" | "admin"): string {
  return t(locale, `roles.${value}`);
}

function statusLabel(locale: Locale, value: "active" | "disabled"): string {
  return t(locale, `statuses.${value}`);
}

function applicationLabel(
  locale: Locale,
  application: UsageAnalyticsReport["applications"][number],
): string {
  return application.is_unattributed
    ? t(locale, "unattributedApplication")
    : application.application_name;
}

function listLabels<T>(
  values: readonly T[],
  label: (value: T) => string,
): string {
  return values.map(label).join(", ");
}

function t(locale: Locale, key: string): string {
  return translateBackend(`usageExport.${key}`, locale);
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}
