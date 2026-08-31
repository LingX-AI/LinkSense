import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FileTypeIcon } from "@/components/media/file-type-icon"
import { fileIconAssets } from "@/lib/file-icons"

describe("FileTypeIcon", () => {
  it("renders the resolved 128px asset as a decorative image", () => {
    const { container } = render(
      <FileTypeIcon className="size-5" filename="budget.xlsx" />
    )
    const image = container.querySelector("img")

    expect(image).toHaveAttribute("alt", "")
    expect(image).toHaveAttribute("aria-hidden", "true")
    expect(image).toHaveAttribute("data-file-icon-kind", "excel")
    expect(image).toHaveAttribute("width", "128")
    expect(image).toHaveAttribute("height", "128")
    expect(image).toHaveClass("file-type-icon", "size-5")
    expect(image).toHaveAttribute("src", fileIconAssets.excel)
  })
})
