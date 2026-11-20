import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import JSZip from "jszip"
import { afterEach, describe, expect, it, vi } from "vitest"

import i18n from "@/i18n"
import { PresentationPreview } from "./presentation-preview"

const drawing = "http://schemas.openxmlformats.org/drawingml/2006/main"
const presentation =
  "http://schemas.openxmlformats.org/presentationml/2006/main"
const relationships =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const packageRelationships =
  "http://schemas.openxmlformats.org/package/2006/relationships"

function textBox(id: number, text: string) {
  return `<p:sp>
    <p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
    <p:spPr><a:xfrm><a:off x="190500" y="95250"/><a:ext cx="2286000" cy="285750"/></a:xfrm></p:spPr>
    <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody>
  </p:sp>`
}

function group(id: number, children: string) {
  return `<p:grpSp>
    <p:nvGrpSpPr><p:cNvPr id="${id}" name="Group ${id}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm>
      <a:off x="381000" y="190500"/><a:ext cx="4572000" cy="952500"/>
      <a:chOff x="0" y="0"/><a:chExt cx="4572000" cy="952500"/>
    </a:xfrm></p:grpSpPr>
    ${children}
  </p:grpSp>`
}

async function openSlide(
  elements: string,
  layout: "desktop" | "compact" = "desktop"
) {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
      <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
    </Types>`
  )
  zip.file(
    "_rels/.rels",
    `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
  )
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="${presentation}" xmlns:r="${relationships}">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000"/>
    </p:presentation>`
  )
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${relationships}/slide" Target="slides/slide1.xml"/></Relationships>`
  )
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="${presentation}" xmlns:a="${drawing}">
      <p:cSld><p:spTree>
        <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
        <p:grpSpPr/>
        ${elements}
      </p:spTree></p:cSld>
    </p:sld>`
  )
  const content = await zip.generateAsync({ type: "uint8array" })
  // JSDOM has no layout. The embedded viewer chooses its navigator by pane size.
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(
    layout === "desktop" ? 1024 : 440
  )
  vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(768)
  render(
    <PresentationPreview
      document={{ status: "ready", content }}
      fileName="thumbnails.pptx"
    />
  )
  if (layout === "compact") {
    fireEvent.click(
      await screen.findByRole("button", {
        name: i18n.t("presentation.toggleSlideNavigator"),
      })
    )
    return screen.findByRole("dialog", {
      name: i18n.t("presentation.slideNavigator"),
    })
  }
  return screen.findByRole("navigation")
}

describe("PowerPoint slide thumbnails", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each(["desktop", "compact"] as const)(
    "shows grouped and nested slide content alongside independent elements in the %s navigator",
    async (layout) => {
      const thumbnail = await openSlide(
        group(2, textBox(3, "Grouped title") + group(4, textBox(5, "90.0%"))) +
          textBox(6, "Outside the group"),
        layout
      )

      const slide = screen.getByRole("main")
      expect(slide).toHaveTextContent("Grouped title")
      expect(slide).toHaveTextContent("90.0%")
      await within(thumbnail).findByText("Outside the group")
      expect(thumbnail).toHaveTextContent("Grouped title")
      expect(thumbnail).toHaveTextContent("90.0%")
    }
  )

  it("includes the last element on slides with more than sixty objects", async () => {
    const elements = Array.from({ length: 61 }, (_, index) =>
      textBox(index + 2, `Label ${index + 1}`)
    )
    const thumbnail = await openSlide(elements.join(""))

    expect(screen.getByRole("main")).toHaveTextContent("Label 61")
    await within(thumbnail).findByText("Label 1")
    expect(thumbnail).toHaveTextContent("Label 61")
  })
})
