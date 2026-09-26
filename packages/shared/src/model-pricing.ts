import { z } from "zod"

const modelTokenPricePattern = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/u

export const modelTokenPricePerMillionSchema = z
  .string()
  .trim()
  .regex(modelTokenPricePattern)
  .transform(normalizeModelTokenPrice)

export const modelTokenPricingSchema = z.strictObject({
  input_price_per_million: modelTokenPricePerMillionSchema.default("0"),
  cached_input_price_per_million: modelTokenPricePerMillionSchema.default("0"),
  output_price_per_million: modelTokenPricePerMillionSchema.default("0"),
})

export type ModelTokenPricing = z.infer<typeof modelTokenPricingSchema>

export function normalizeModelTokenPrice(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".")
  const normalizedFraction = fraction.replace(/0+$/u, "")
  return normalizedFraction === "" ? whole : `${whole}.${normalizedFraction}`
}
