// @vitest-environment node
import { describe, expect, it } from "vitest"

import type { ConversationFile } from "@/api/contracts"
import { resolveConversationDeliveryFiles } from "@/features/conversations/conversation-delivery-references"

const image: ConversationFile = {
  id: "30000000-0000-4000-8000-0000000000ab",
  name: "草地小狗.png",
  kind: "artifact",
  turn_id: "turn-1",
  mime_type: "image/png",
  size: 2048,
  download_available: true,
}

describe("rendered inline image references", () => {
  it("recognizes validated rich resource deliveries without hiding fallback cards before rendering", () => {
    const document = {
      version: 1,
      summary: "Delivered result",
      spec: {
        root: "panel",
        elements: {
          panel: {
            type: "Panel",
            props: { title: "Delivery" },
            children: ["gallery"],
          },
          gallery: {
            type: "MediaGallery",
            props: {
              title: "Images",
              items: [{ fileId: image.id.toUpperCase(), alt: "Landscape" }],
            },
          },
        },
      },
    }
    const block = `\`\`\`json-render\n${JSON.stringify(document)}\n\`\`\``
    expect(resolveConversationDeliveryFiles(block, [image])).toEqual([image])
    expect(
      resolveConversationDeliveryFiles(block, [image], {
        inlineImagesOnly: true,
      })
    ).toEqual([])
    expect(resolveConversationDeliveryFiles(block, [])).toEqual([])
    expect(
      resolveConversationDeliveryFiles(block.replace("json-render", "json"), [
        image,
      ])
    ).toEqual([])
    expect(
      resolveConversationDeliveryFiles(
        block.replace('"MediaGallery"', '"Unknown"'),
        [image]
      )
    ).toEqual([])
  })

  it("resolves rendered images and image references by exact artifact ID", () => {
    expect(
      resolveConversationDeliveryFiles(
        `![小狗][result]\n\n[result]: linksense-artifact:${image.id.toUpperCase()}`,
        [image],
        { inlineImagesOnly: true }
      )
    ).toEqual([image])
  })

  it("does not hide downloads for links, code, unused definitions, or local images the renderer cannot load", () => {
    const content = [
      `[下载](linksense-artifact:${image.id})`,
      `\`![代码中的图片](linksense-artifact:${image.id})\``,
      `\`\`\`text\n![代码块中的图片](linksense-artifact:${image.id})\n\`\`\``,
      `![本地路径](artifacts/${image.name})`,
      `[unused]: linksense-artifact:${image.id}`,
    ].join("\n\n")
    expect(
      resolveConversationDeliveryFiles(content, [image], {
        inlineImagesOnly: true,
      })
    ).toEqual([])
    expect(resolveConversationDeliveryFiles(content, [image])).toEqual([image])
  })

  it("finds an image inside a link without treating the outer link as an inline image", () => {
    const second = { ...image, id: "30000000-0000-4000-8000-0000000000ac" }
    expect(
      resolveConversationDeliveryFiles(
        `[![小狗](linksense-artifact:${image.id})](linksense-artifact:${second.id})`,
        [image, second],
        { inlineImagesOnly: true }
      )
    ).toEqual([image])
  })
})
