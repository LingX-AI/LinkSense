import JSZip from "jszip"
import { describe, expect, it } from "vitest"

import {
  normalizeXlsxRelationshipTargetsForPreview,
  prepareXlsxPreviewBuffer,
} from "@/components/media/spreadsheet-preview/xlsx-preview-relationship-normalizer"

const relationshipsNamespace =
  "http://schemas.openxmlformats.org/package/2006/relationships"

function relationshipsXml(
  relationships: ReadonlyArray<
    Readonly<{
      id: string
      target: string
      targetMode?: "External"
      type: string
    }>
  >
) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${relationshipsNamespace}">
${relationships
  .map(
    ({ id, target, targetMode, type }) =>
      `<Relationship Id="${id}" Type="${type}" Target="${target}"${targetMode ? ` TargetMode="${targetMode}"` : ""}/>`
  )
  .join("\n")}
</Relationships>`
}

async function createChartWorkbook(targetStyle: "absolute" | "relative") {
  const absolute = targetStyle === "absolute"
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`
  )
  zip.file(
    "_rels/.rels",
    relationshipsXml([
      {
        id: "rId1",
        target: absolute ? "/xl/workbook.xml" : "xl/workbook.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
      },
    ])
  )
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="饼图" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
  )
  zip.file(
    "xl/_rels/workbook.xml.rels",
    relationshipsXml([
      {
        id: "rId1",
        target: absolute
          ? "/xl/worksheets/sheet1.xml"
          : "worksheets/sheet1.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
      },
    ])
  )
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>项目</t></is></c></row></sheetData>
  <drawing r:id="rId1"/>
</worksheet>`
  )
  zip.file(
    "xl/worksheets/_rels/sheet1.xml.rels",
    relationshipsXml([
      {
        id: "rId1",
        target: absolute
          ? "/xl/drawings/drawing1.xml"
          : "../drawings/drawing1.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing",
      },
      {
        id: "rId2",
        target: "https://example.com/report",
        targetMode: "External",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      },
      {
        id: "rId3",
        target: "/../../outside.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml",
      },
    ])
  )
  zip.file(
    "xl/drawings/drawing1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor>
    <xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:ext cx="9144000" cy="5143500"/>
    <xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`
  )
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    relationshipsXml([
      {
        id: "rId1",
        target: absolute ? "/xl/charts/chart1.xml" : "../charts/chart1.xml",
        type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart",
      },
    ])
  )
  zip.file(
    "xl/charts/chart1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:pieChart><c:varyColors val="1"/></c:pieChart></c:plotArea></c:chart></c:chartSpace>`
  )

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
  })
}

async function readZipText(content: ArrayBuffer | Uint8Array, path: string) {
  const zip = await JSZip.loadAsync(content)
  const entry = zip.file(path)
  expect(entry, `Missing ${path}`).not.toBeNull()
  return entry!.async("string")
}

describe("XLSX preview relationship normalizer", () => {
  it("rewrites openpyxl-style absolute drawing and chart targets in a preview copy", async () => {
    const original = await createChartWorkbook("absolute")
    const normalized =
      await normalizeXlsxRelationshipTargetsForPreview(original)

    expect(
      await readZipText(normalized, "xl/_rels/workbook.xml.rels")
    ).toContain('Target="worksheets/sheet1.xml"')
    const sheetRelationships = await readZipText(
      normalized,
      "xl/worksheets/_rels/sheet1.xml.rels"
    )
    expect(sheetRelationships).toContain('Target="../drawings/drawing1.xml"')
    expect(sheetRelationships).toContain(
      'Target="https://example.com/report" TargetMode="External"'
    )
    expect(sheetRelationships).toContain('Target="/../../outside.xml"')
    expect(
      await readZipText(normalized, "xl/drawings/_rels/drawing1.xml.rels")
    ).toContain('Target="../charts/chart1.xml"')
    expect(await readZipText(normalized, "xl/charts/chart1.xml")).toContain(
      "<c:pieChart>"
    )

    expect(
      await readZipText(original, "xl/worksheets/_rels/sheet1.xml.rels")
    ).toContain('Target="/xl/drawings/drawing1.xml"')
  })

  it("returns byte-identical content when all relationship targets are already relative", async () => {
    const original = await createChartWorkbook("relative")
    const normalized =
      await normalizeXlsxRelationshipTargetsForPreview(original)

    expect(new Uint8Array(normalized)).toEqual(original)
  })

  it("falls back to the original bytes when a ZIP-looking workbook is invalid", async () => {
    const invalid = Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 0x00, 0x01)

    expect(new Uint8Array(await prepareXlsxPreviewBuffer(invalid))).toEqual(
      invalid
    )
  })
})
