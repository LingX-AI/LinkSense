import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ModelTokenPriceInput } from "@/components/forms/model-token-price-input"

describe("ModelTokenPriceInput", () => {
  it("renders the price unit as an inline-end suffix", () => {
    render(
      <ModelTokenPriceInput
        aria-label="输入单价"
        unitLabel="美元 / 百万 Token"
        value="12.5"
        readOnly
      />
    )

    const input = screen.getByRole("textbox", { name: "输入单价" })
    const group = input.closest('[data-slot="input-group"]')
    expect(group).not.toBeNull()
    expect(
      within(group as HTMLElement).getByText("美元 / 百万 Token")
    ).toBeVisible()
    expect(
      input.compareDocumentPosition(
        within(group as HTMLElement).getByText("美元 / 百万 Token")
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})
