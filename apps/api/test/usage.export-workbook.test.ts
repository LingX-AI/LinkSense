import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { buildUsageAnalyticsWorkbook } from "../src/modules/usage/export-workbook.js";
import { usageReportFixture } from "./fixtures/usage-report.js";

describe("usage analytics workbook export", () => {
  it("creates a localized workbook with typed values and cent-balanced costs", async () => {
    const result = await buildUsageAnalyticsWorkbook({
      report: usageReportFixture(),
      locale: "zh-CN",
      productName: "示例系统",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(result.buffer));

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "概览",
      "趋势",
      "按模型",
      "按用途",
      "按应用",
      "应用模型明细",
      "按用户组",
      "用户组模型明细",
      "按用户",
      "用户模型明细",
    ]);
    expect(result.dataRowCount).toBe(17);

    const summary = workbook.getWorksheet("概览");
    const models = workbook.getWorksheet("按模型");
    expect(summary?.getCell("A1").value).toBe("示例系统 用量统计");
    expect(summary?.getCell("A1").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFF1F1F3" },
    });
    expect(summary?.getCell("B10").value).toBe(12);
    expect(summary?.getCell("B15").value).toBe(0.01);
    expect(summary?.getCell("B4").value).toBeInstanceOf(Date);
    expect((summary?.getCell("B4").value as Date).toISOString()).toBe(
      "2026-07-29T00:00:00.000Z",
    );
    expect(summary?.getCell("B15").numFmt).toBe('"¥"#,##0.00');
    expect(models?.getCell("I2").value).toBe(5);
    expect(models?.getCell("N2").value).toBe(0);
    expect(models?.getCell("N3").value).toBe(0.01);
    expect(models?.getCell("A1").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFF4F4F5" },
    });
    expect(
      Number(models?.getCell("N2").value) + Number(models?.getCell("N3").value),
    ).toBe(summary?.getCell("B15").value);
    expect(models?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("uses English workbook labels when requested", async () => {
    const result = await buildUsageAnalyticsWorkbook({
      report: usageReportFixture(),
      locale: "en-US",
      productName: "Example Hub",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(result.buffer));

    expect(workbook.getWorksheet("Summary")?.getCell("A1").value).toBe(
      "Example Hub Usage analytics",
    );
    expect(workbook.getWorksheet("By model")?.getCell("A1").value).toBe(
      "Model",
    );
  });

  it("exports a valid workbook when the selected period has no usage", async () => {
    const fixture = usageReportFixture();
    const result = await buildUsageAnalyticsWorkbook({
      report: {
        ...fixture,
        totals: {
          task_count: 0,
          turn_count: 0,
          request_count: 0,
          token_usage: {
            total_tokens: "0",
            input_tokens: "0",
            cached_input_tokens: "0",
            output_tokens: "0",
            reasoning_output_tokens: "0",
          },
          cost: {
            currency: "CNY",
            total_cost: "0",
            input_cost: "0",
            cached_input_cost: "0",
            output_cost: "0",
            unpriced_tokens: "0",
          },
        },
        token_trend: { ...fixture.token_trend, points: [] },
        workloads: [],
        models: [],
        applications: [],
        groups: [],
        users: [],
      },
      locale: "zh-CN",
      productName: "示例系统",
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(result.buffer));

    expect(result.dataRowCount).toBe(0);
    expect(workbook.worksheets).toHaveLength(10);
    expect(workbook.getWorksheet("按模型")?.rowCount).toBe(1);
  });
});

function toArrayBuffer(buffer: Uint8Array): ArrayBuffer {
  return Uint8Array.from(buffer).buffer;
}
