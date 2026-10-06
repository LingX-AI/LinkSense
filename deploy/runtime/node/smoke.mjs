const packages = [
  "archiver",
  "axios",
  "cheerio",
  "csv-parse",
  "csv-stringify",
  "dayjs",
  "docx",
  "exceljs",
  "fast-xml-parser",
  "glob",
  "pdf-lib",
  "pptxgenjs",
  "sharp",
  "yaml",
  "zod",
];

for (const packageName of packages) {
  await import(packageName);
}

const assert = (await import("node:assert/strict")).default;
const ExcelJS = (await import("exceljs")).default;
const workbook = new ExcelJS.Workbook();
workbook.addWorksheet("security").addRow(["runtime", 42]);
const restored = new ExcelJS.Workbook();
await restored.xlsx.load(await workbook.xlsx.writeBuffer());
assert.equal(restored.getWorksheet("security").getCell("B1").value, 42);

const sharp = (await import("sharp")).default;
const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "white" } }).png().toBuffer();
assert.equal((await sharp(png).metadata()).width, 16);
const PptxGenJS = (await import("pptxgenjs")).default;
const presentation = new PptxGenJS();
presentation.addSlide().addImage({ data: `image/png;base64,${png.toString("base64")}`, x: 1, y: 1, w: 1, h: 1 });
assert.ok((await presentation.write({ outputType: "nodebuffer" })).length > 0);
const { PDFDocument } = await import("pdf-lib");
const pdf = await PDFDocument.create();
pdf.addPage();
assert.equal((await PDFDocument.load(await pdf.save())).getPageCount(), 1);
console.log("LinkSense shared Node.js runtime imports and document operations succeeded.");
