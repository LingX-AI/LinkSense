import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"

import { modelTokenPricingSchema } from "../src/index.js"

describe("model token pricing contract", () => {
  it("normalizes long fractional zero runs without backtracking", { timeout: 10_000 }, () => {
    const modelSource = new URL("../src/model-pricing.ts", import.meta.url).href
    const imageSource = new URL("../src/image-generation.ts", import.meta.url).href
    execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", `
      import assert from "node:assert/strict";
      import { normalizeModelTokenPrice } from ${JSON.stringify(modelSource)};
      import { normalizeImageGenerationPrice } from ${JSON.stringify(imageSource)};
      const value = "0." + "0".repeat(200_000) + "1";
      for (const normalize of [normalizeModelTokenPrice, normalizeImageGenerationPrice]) {
        assert.equal(normalize(value), value);
        assert.equal(normalize("4.000000"), "4");
        assert.equal(normalize("4.300000"), "4.3");
      }
    `], { timeout: 3000, stdio: "pipe" })
  })

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
