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
// GHSA-wq5f-xc86-pv6w: verify the actual native SVG decoder, not just its JS pin.
const [rsvgMajor, rsvgMinor, rsvgPatch] = sharp.versions.rsvg.split(".").map(Number);
assert.ok(rsvgMajor > 2 || (rsvgMajor === 2 && (rsvgMinor > 63 || (rsvgMinor === 63 && rsvgPatch >= 2))),
  "The shared runtime must use patched librsvg 2.63.2 or later");
const renderedSvg = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="white"/></svg>')).png().toBuffer();
assert.equal((await sharp(renderedSvg).metadata()).width, 16);
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
