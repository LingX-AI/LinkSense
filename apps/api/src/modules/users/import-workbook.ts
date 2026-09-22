import { supportedLocales, type Locale } from "@linksense/shared";
import ExcelJS from "exceljs";
import { fileTypeFromBuffer } from "file-type";
import { Open } from "unzipper";

import { AppError } from "../../lib/errors.js";
import { translateBackend } from "../../lib/i18n.js";

const XLSX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_IMPORT_ROWS = 10_000;
const MAX_ARCHIVE_ENTRIES = 256;
const MAX_ARCHIVE_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSION_RATIO = 200;
const PASSWORD_HEADER_PATTERN = /(password|密码|口令|hash)/iu;
const ACTIVE_CONTENT_PATH_PATTERN =
  /(?:^|\/)(?:activeX|embeddings|oleObjects)(?:\/|$)|(?:^|\/)vbaProject\.bin$/iu;
const LIGHT_GRAY_HEADER = "FFE4E4E7";
const LIGHT_GRAY_ACCENT = "FFF4F4F5";
const LIGHT_GRAY_SUBTLE = "FFFAFAFA";
const LIGHT_GRAY_TAB = "FFD4D4D8";
const LIGHTER_GRAY_TAB = "FFE4E4E7";
const DARK_GRAY_TEXT = "FF3F3F46";

const importFields = ["name", "email", "role", "user_groups"] as const;
type ImportField = (typeof importFields)[number];

export type ParsedUserImportRow = Record<ImportField, string> & {
  rowNumber: number;
};

export async function buildUserImportTemplate(locale: Locale): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.views = [
    {
      x: 0,
      y: 0,
      width: 12_000,
      height: 8_000,
      firstSheet: 0,
      activeTab: 1,
      visibility: "visible",
    },
  ];

  addImportSheet(workbook, locale);
  addInstructionsSheet(workbook, locale);

  const output = await workbook.xlsx.writeBuffer();
  return Buffer.from(output);
}

export async function parseUserImportWorkbook(
  bytes: Buffer,
): Promise<ParsedUserImportRow[]> {
  await assertSafeXlsxArchive(bytes);

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(bytes).buffer);
  } catch {
    throw invalidWorkbook();
  }
  if (workbook.worksheets.length === 0 || workbook.worksheets.length > 10) {
    throw invalidWorkbook();
  }

  const importSheets = workbook.worksheets.filter((worksheet) =>
    hasSupportedHeaders(worksheet),
  );
  if (importSheets.length !== 1) throw invalidWorkbookWithHeaders();

  const worksheet = importSheets[0];
  if (!worksheet || worksheet.rowCount > MAX_IMPORT_ROWS + 1) {
    throw invalidWorkbook();
  }

  const rows: ParsedUserImportRow[] = [];
  const errors: Array<{ row: number; field: string; code: string }> = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const parsedCells = importFields.map((field, index) => ({
      field,
      ...readImportCell(row.getCell(index + 1)),
    }));
    const unexpectedColumn = rowHasUnexpectedValue(row);
    const isEmpty = parsedCells.every((cell) => cell.value.length === 0);
    const invalidCells = parsedCells.filter((cell) => !cell.valid);

    if (isEmpty && invalidCells.length === 0 && !unexpectedColumn) continue;
    for (const cell of invalidCells) {
      errors.push({
        row: rowNumber,
        field: cell.field,
        code: "invalid_cell_type",
      });
    }
    if (unexpectedColumn) {
      errors.push({ row: rowNumber, field: "row", code: "unexpected_column" });
    }
    if (invalidCells.length > 0 || unexpectedColumn) continue;

    rows.push({
      rowNumber,
      name: parsedCells[0]?.value ?? "",
      email: parsedCells[1]?.value ?? "",
      role: parsedCells[2]?.value ?? "",
      user_groups: parsedCells[3]?.value ?? "",
    });
  }

  if (errors.length > 0) {
    throw new AppError("VALIDATION_ERROR", { errors });
  }
  if (rows.length === 0 || rows.length > MAX_IMPORT_ROWS) {
    throw invalidWorkbook();
  }
  return rows;
}

function addImportSheet(workbook: ExcelJS.Workbook, locale: Locale): void {
  const worksheet = workbook.addWorksheet(
    t(locale, "userImport.sheets.import"),
    {
      views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
      properties: { tabColor: { argb: LIGHT_GRAY_TAB } },
    },
  );
  const headers = localizedHeaders(locale);
  worksheet.columns = [
    { key: "name", header: headers[0], width: 22 },
    { key: "email", header: headers[1], width: 34 },
    { key: "role", header: headers[2], width: 16 },
    { key: "user_groups", header: headers[3], width: 34 },
  ];
  worksheet.autoFilter = "A1:D1";
  worksheet.getRow(1).height = 28;
  styleHeader(worksheet, 1, 1, 1, 4);

  const descriptions = [
    t(locale, "userImport.fields.name.description"),
    t(locale, "userImport.fields.email.description"),
    t(locale, "userImport.fields.role.description"),
    t(locale, "userImport.fields.userGroups.description"),
  ];
  descriptions.forEach((description, index) => {
    worksheet.getCell(1, index + 1).note = description;
    worksheet.getColumn(index + 1).numFmt = "@";
  });
  worksheet.getCell("C2").dataValidation = {
    type: "list",
    allowBlank: false,
    formulae: ['"user,admin"'],
    showErrorMessage: true,
    errorStyle: "stop",
    errorTitle: t(locale, "userImport.validation.roleTitle"),
    error: t(locale, "userImport.validation.roleMessage"),
  };
}

function addInstructionsSheet(
  workbook: ExcelJS.Workbook,
  locale: Locale,
): void {
  const worksheet = workbook.addWorksheet(
    t(locale, "userImport.sheets.instructions"),
    {
      views: [{ state: "frozen", ySplit: 2, showGridLines: false }],
      properties: { tabColor: { argb: LIGHTER_GRAY_TAB } },
    },
  );
  worksheet.columns = [
    { width: 20 },
    { width: 32 },
    { width: 32 },
    { width: 56 },
  ];

  worksheet.mergeCells("A1:D1");
  worksheet.getCell("A1").value = t(locale, "userImport.instructions.title");
  worksheet.getCell("A1").font = {
    bold: true,
    color: { argb: DARK_GRAY_TEXT },
    size: 18,
  };
  worksheet.getCell("A1").fill = solidFill(LIGHT_GRAY_ACCENT);
  worksheet.getCell("A1").alignment = { vertical: "middle" };
  worksheet.getRow(1).height = 36;

  worksheet.mergeCells("A2:D2");
  worksheet.getCell("A2").value = t(locale, "userImport.instructions.intro");
  worksheet.getCell("A2").fill = solidFill(LIGHT_GRAY_SUBTLE);
  worksheet.getCell("A2").font = { color: { argb: DARK_GRAY_TEXT } };
  worksheet.getCell("A2").alignment = {
    vertical: "middle",
    wrapText: true,
  };
  worksheet.getRow(2).height = 48;

  setRangeValues(worksheet, 4, 1, [
    [
      t(locale, "userImport.instructions.field"),
      t(locale, "userImport.instructions.required"),
      t(locale, "userImport.instructions.example"),
      t(locale, "userImport.instructions.description"),
    ],
  ]);
  styleHeader(worksheet, 4, 4, 1, 4);
  const fieldRows = [
    [
      t(locale, "userImport.headers.name"),
      t(locale, "userImport.instructions.yes"),
      t(locale, "userImport.examples.name"),
      t(locale, "userImport.fields.name.description"),
    ],
    [
      t(locale, "userImport.headers.email"),
      t(locale, "userImport.instructions.yes"),
      "zhangsan@example.com",
      t(locale, "userImport.fields.email.description"),
    ],
    [
      t(locale, "userImport.headers.role"),
      t(locale, "userImport.instructions.yes"),
      "user",
      t(locale, "userImport.fields.role.description"),
    ],
    [
      t(locale, "userImport.headers.userGroups"),
      t(locale, "userImport.instructions.no"),
      t(locale, "userImport.examples.groups"),
      t(locale, "userImport.fields.userGroups.description"),
    ],
  ];
  setRangeValues(worksheet, 5, 1, fieldRows);
  styleBodyTable(worksheet, 5, 8, 1, 4);

  worksheet.mergeCells("A10:D10");
  worksheet.getCell("A10").value = t(
    locale,
    "userImport.instructions.examplesTitle",
  );
  worksheet.getCell("A10").font = {
    bold: true,
    color: { argb: DARK_GRAY_TEXT },
  };
  worksheet.getCell("A10").fill = solidFill(LIGHT_GRAY_ACCENT);
  worksheet.getCell("A10").alignment = { vertical: "middle" };
  worksheet.getRow(10).height = 26;

  setRangeValues(worksheet, 11, 1, [localizedHeaders(locale)]);
  styleHeader(worksheet, 11, 11, 1, 4);
  setRangeValues(worksheet, 12, 1, [
    [
      t(locale, "userImport.examples.name"),
      "zhangsan@example.com",
      "user",
      t(locale, "userImport.examples.groups"),
    ],
    [
      t(locale, "userImport.examples.adminName"),
      "lihua@example.com",
      "admin",
      null,
    ],
  ]);
  styleBodyTable(worksheet, 12, 13, 1, 4, LIGHT_GRAY_SUBTLE);
  worksheet.getRow(12).height = 28;
  worksheet.getRow(13).height = 28;

  worksheet.mergeCells("A15:D15");
  worksheet.getCell("A15").value = t(
    locale,
    "userImport.instructions.passwordNote",
  );
  worksheet.getCell("A15").font = { color: { argb: DARK_GRAY_TEXT } };
  worksheet.getCell("A15").fill = solidFill(LIGHT_GRAY_SUBTLE);
  worksheet.getCell("A15").alignment = {
    vertical: "middle",
    wrapText: true,
  };
  worksheet.getRow(15).height = 40;
  forEachCell(worksheet, 1, 15, 1, 4, (cell) => {
    cell.alignment = { ...cell.alignment, vertical: "middle" };
  });
  forEachCell(worksheet, 5, 15, 1, 4, (cell) => {
    cell.alignment = { ...cell.alignment, vertical: "middle", wrapText: true };
  });
  for (let row = 5; row <= 8; row += 1) worksheet.getRow(row).height = 40;
}

function localizedHeaders(locale: Locale): [string, string, string, string] {
  return [
    t(locale, "userImport.headers.name"),
    t(locale, "userImport.headers.email"),
    t(locale, "userImport.headers.role"),
    t(locale, "userImport.headers.userGroups"),
  ];
}

function hasSupportedHeaders(worksheet: ExcelJS.Worksheet): boolean {
  const headerValues = readHeaderValues(worksheet);
  if (headerValues.some((header) => PASSWORD_HEADER_PATTERN.test(header))) {
    return false;
  }
  if (headerValues.length !== importFields.length) return false;
  return supportedLocales.some((locale) => {
    const expected = localizedHeaders(locale);
    return expected.every((header, index) => header === headerValues[index]);
  });
}

function readHeaderValues(worksheet: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  worksheet
    .getRow(1)
    .eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      while (values.length < columnNumber - 1) values.push("");
      const parsed = readImportCell(cell);
      values.push(parsed.valid ? parsed.value : "");
    });
  while (values.at(-1) === "") values.pop();
  return values;
}

function readImportCell(cell: ExcelJS.Cell): { value: string; valid: boolean } {
  const value = cell.value;
  if (value === null || value === undefined) return { value: "", valid: true };
  if (typeof value === "string") return { value: value.trim(), valid: true };
  if (
    typeof value === "object" &&
    "richText" in value &&
    Array.isArray(value.richText) &&
    value.richText.every(
      (part) =>
        typeof part === "object" &&
        part !== null &&
        typeof part.text === "string",
    )
  ) {
    return {
      value: value.richText
        .map((part) => part.text)
        .join("")
        .trim(),
      valid: true,
    };
  }
  if (
    typeof value === "object" &&
    "text" in value &&
    typeof value.text === "string" &&
    "hyperlink" in value &&
    typeof value.hyperlink === "string"
  ) {
    return { value: value.text.trim(), valid: true };
  }
  return { value: "", valid: false };
}

function rowHasUnexpectedValue(row: ExcelJS.Row): boolean {
  let unexpected = false;
  row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
    if (
      columnNumber > importFields.length &&
      readImportCell(cell).value.length > 0
    ) {
      unexpected = true;
    }
  });
  return unexpected;
}

async function assertSafeXlsxArchive(bytes: Buffer): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > 5 * 1024 * 1024) {
    throw invalidWorkbook();
  }
  const detected = await fileTypeFromBuffer(bytes);
  if (detected?.ext !== "xlsx" || detected.mime !== XLSX_MIME_TYPE) {
    throw invalidWorkbook();
  }

  let archive: Awaited<ReturnType<typeof Open.buffer>>;
  try {
    archive = await Open.buffer(bytes);
  } catch {
    throw invalidWorkbook();
  }
  if (
    archive.files.length === 0 ||
    archive.files.length > MAX_ARCHIVE_ENTRIES
  ) {
    throw invalidWorkbook();
  }

  const paths = new Set<string>();
  let expandedBytes = 0;
  for (const entry of archive.files) {
    const path = normalizedArchivePath(entry.path);
    if (
      paths.has(path) ||
      isZipSymlink(entry.externalFileAttributes) ||
      (entry.flags & 0x1) !== 0 ||
      ACTIVE_CONTENT_PATH_PATTERN.test(path)
    ) {
      throw invalidWorkbook();
    }
    paths.add(path);
    if (entry.uncompressedSize > MAX_ARCHIVE_ENTRY_BYTES) {
      throw invalidWorkbook();
    }
    if (
      entry.uncompressedSize > 0 &&
      (entry.compressedSize === 0 ||
        entry.uncompressedSize / entry.compressedSize >
          MAX_ARCHIVE_COMPRESSION_RATIO)
    ) {
      throw invalidWorkbook();
    }
    expandedBytes += entry.uncompressedSize;
    if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) throw invalidWorkbook();
  }
  if (!paths.has("[Content_Types].xml") || !paths.has("xl/workbook.xml")) {
    throw invalidWorkbook();
  }
}

function normalizedArchivePath(path: string): string {
  const raw = path.replaceAll("\\", "/").normalize("NFC");
  const normalized = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[a-z]:\//iu.test(normalized) ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw invalidWorkbook();
  }
  return normalized;
}

function isZipSymlink(externalFileAttributes: number): boolean {
  return ((externalFileAttributes >>> 16) & 0o170000) === 0o120000;
}

function setRangeValues(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  startColumn: number,
  values: ExcelJS.CellValue[][],
): void {
  values.forEach((row, rowOffset) => {
    row.forEach((value, columnOffset) => {
      worksheet.getCell(
        startRow + rowOffset,
        startColumn + columnOffset,
      ).value = value;
    });
  });
}

function styleHeader(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
): void {
  forEachCell(worksheet, startRow, endRow, startColumn, endColumn, (cell) => {
    cell.fill = solidFill(LIGHT_GRAY_HEADER);
    cell.font = { bold: true, color: { argb: DARK_GRAY_TEXT } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFD4D4D8" } },
    };
  });
}

function styleBodyTable(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  fill?: string,
): void {
  forEachCell(worksheet, startRow, endRow, startColumn, endColumn, (cell) => {
    if (fill) cell.fill = solidFill(fill);
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFE4E4E7" } },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function forEachCell(
  worksheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  startColumn: number,
  endColumn: number,
  callback: (cell: ExcelJS.Cell) => void,
): void {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      callback(worksheet.getCell(row, column));
    }
  }
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function invalidWorkbook(): AppError {
  return new AppError("VALIDATION_ERROR");
}

function invalidWorkbookWithHeaders(): AppError {
  return new AppError("VALIDATION_ERROR", {
    expected_headers: {
      "zh-CN": localizedHeaders("zh-CN"),
      "en-US": localizedHeaders("en-US"),
    },
  });
}

function t(locale: Locale, key: string): string {
  return translateBackend(key, locale);
}
