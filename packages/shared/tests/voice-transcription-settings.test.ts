import { describe, expect, it } from "vitest"

import { voiceTranscriptionAvailabilitySchema } from "../src/index.js"

describe("voice transcription settings contracts", () => {
  it("accepts only the public availability flag", () => {
    expect(
      voiceTranscriptionAvailabilitySchema.parse({ available: false }),
    ).toEqual({ available: false })
    expect(
      voiceTranscriptionAvailabilitySchema.safeParse({
        available: true,
        api_key: "secret",
      }).success,
    ).toBe(false)
  })
})
