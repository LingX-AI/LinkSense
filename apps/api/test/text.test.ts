import { describe, expect, it } from "vitest"

import { containsControlCharacter } from "../src/lib/text.js"

describe("containsControlCharacter", () => {
  it.each(["\0", "\r", "\n", "\u007f", "\u0085"])(
    "detects the control character %#",
    (value) => {
      expect(containsControlCharacter(`/models/${value}/tokenizer`)).toBe(true)
    },
  )

  it("accepts a normal model path and non-ASCII text", () => {
    expect(
      containsControlCharacter("/models/tokenizers/中文-Qwen3-Embedding-4B"),
    ).toBe(false)
  })
})
