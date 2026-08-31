import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  buildUserImportTemplate,
  parseUserImportWorkbook,
} from "../src/modules/users/import-workbook.js";

describe("user import Excel workbook", () => {
  it("builds a localized template with a blank import sheet plus instructions and sample data", async () => {
    const buffer = await buildUserImportTemplate("zh-CN");
    const workbook = await loadWorkbook(buffer);

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "用户导入",
      "填写说明",
    ]);
    expect(workbook.views[0]).toMatchObject({ activeTab: 1 });

    const importSheet = workbook.getWorksheet("用户导入");
    const instructions = workbook.getWorksheet("填写说明");
    expect(importSheet?.getRow(1).values).toEqual([
      undefined,
      "姓名",
      "邮箱",
      "角色",
      "用户组",
    ]);
    expect(importSheet?.getRow(2).values).toEqual([]);
    expect(importSheet?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(importSheet?.getCell("A1").note).toContain("不能为空");
    expect(importSheet?.getCell("A1").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFE4E4E7" },
    });
    expect(importSheet?.getCell("A1").font).toMatchObject({
      bold: true,
      color: { argb: "FF3F3F46" },
    });
    expect(importSheet?.properties.tabColor).toEqual({ argb: "FFD4D4D8" });
    expect(importSheet?.getCell("C2").dataValidation).toMatchObject({
      type: "list",
      formulae: ['"user,admin"'],
    });
    expect(instructions?.properties.tabColor).toEqual({ argb: "FFE4E4E7" });
    expect(instructions?.getCell("A2").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFAFAFA" },
    });
    expect(instructions?.getCell("A12").fill).toMatchObject({
      type: "pattern",
      fgColor: { argb: "FFFAFAFA" },
    });
    expect(instructions?.getCell("A2").value).toContain(
      "本页示范数据不会参与导入",
    );
    expect(instructions?.getCell("A12").value).toBe("张三");
    expect(instructions?.getCell("B12").value).toBe("zhangsan@example.com");
    expect(instructions?.getColumn(2).width).toBe(32);
    expect(instructions?.getRow(12).height).toBe(28);
    expect(instructions?.getCell("D13").value).toBeNull();
    expect(instructions?.getCell("A15").value).toContain("不包含密码");
  });

  it("uses English labels and examples for an English template", async () => {
    const workbook = await loadWorkbook(await buildUserImportTemplate("en-US"));

    expect(workbook.worksheets.map((worksheet) => worksheet.name)).toEqual([
      "User Import",
      "Instructions",
    ]);
    expect(workbook.getWorksheet("User Import")?.getRow(1).values).toEqual([
      undefined,
      "Name",
      "Email",
      "Role",
      "User groups",
    ]);
    expect(workbook.getWorksheet("Instructions")?.getCell("A12").value).toBe(
      "Alex Chen",
    );
  });

  it("parses only rows entered on the import sheet and keeps their Excel row numbers", async () => {
    const workbook = await loadWorkbook(await buildUserImportTemplate("zh-CN"));
    const importSheet = workbook.getWorksheet("用户导入");
    if (!importSheet) throw new Error("missing import sheet");
    importSheet.getRow(2).values = [
      "王敏",
      "wangmin@example.com",
      "user",
      "运营组;华东区",
    ];
    importSheet.getRow(4).values = [
      "赵明",
      "zhaoming@example.com",
      "admin",
      "",
    ];

    const rows = await parseUserImportWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );

    expect(rows).toEqual([
      {
        rowNumber: 2,
        name: "王敏",
        email: "wangmin@example.com",
        role: "user",
        user_groups: "运营组;华东区",
      },
      {
        rowNumber: 4,
        name: "赵明",
        email: "zhaoming@example.com",
        role: "admin",
        user_groups: "",
      },
    ]);
  });

  it("rejects formulas and non-Excel uploads without exposing cell contents", async () => {
    const workbook = await loadWorkbook(await buildUserImportTemplate("en-US"));
    const importSheet = workbook.getWorksheet("User Import");
    if (!importSheet) throw new Error("missing import sheet");
    importSheet.getCell("A2").value = {
      formula: '="Sensitive User"',
      result: "Sensitive User",
    };
    importSheet.getCell("B2").value = "secret@example.com";
    importSheet.getCell("C2").value = "user";

    const error = await parseUserImportWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      params: {
        errors: [{ row: 2, field: "name", code: "invalid_cell_type" }],
      },
    });
    expect(JSON.stringify(error)).not.toContain("Sensitive User");
    expect(JSON.stringify(error)).not.toContain("secret@example.com");

    await expect(
      parseUserImportWorkbook(
        Buffer.from("name,email,role,user_groups\nUser,u@example.com,user,"),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

async function loadWorkbook(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  return workbook;
}
