import { describe, expect, it } from "vitest"

import { modelTokenPricingSchema } from "../src/index.js"

describe("model token pricing contract", () => {
  it("normalizes three USD prices per million tokens", () => {
    expect(
      modelTokenPricingSchema.parse({
        input_price_per_million: "12.340000",
        cached_input_price_per_million: "2.5",
        output_price_per_million: "30.000001",
      })
    ).toEqual({
      input_price_per_million: "12.34",
      cached_input_price_per_million: "2.5",
      output_price_per_million: "30.000001",
    })
  })

  it("defaults legacy models to zero prices and rejects negative values", () => {
    expect(modelTokenPricingSchema.parse({})).toEqual({
      input_price_per_million: "0",
      cached_input_price_per_million: "0",
      output_price_per_million: "0",
    })
    expect(
      modelTokenPricingSchema.safeParse({
        input_price_per_million: "-1",
      }).success
    ).toBe(false)
  })
})
