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

console.log("LinkSense shared Node.js runtime imports succeeded.");
