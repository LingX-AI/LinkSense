// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  containsInternalPlatformName,
  formatPublicTechnicalIdentifier,
  getPublicRuntimeMessage,
} from "@/lib/public-copy"

describe("public copy safeguards", () => {
  it.each(["Codex", "codex", "CodeX", "CODEX_TURN_FAILED"])(
    "detects the internal platform name in %s",
    (value) => {
      expect(containsInternalPlatformName(value)).toBe(true)
    }
  )

  it("uses neutral runtime terminology for technical identifiers", () => {
    expect(formatPublicTechnicalIdentifier("CODEX_TURN_FAILED")).toBe(
      "RUNTIME_TURN_FAILED"
    )
    expect(
      formatPublicTechnicalIdentifier("codex_thread_recovery_failed")
    ).toBe("runtime_thread_recovery_failed")
  })

  it("falls back instead of showing an internal platform error", () => {
    expect(
      getPublicRuntimeMessage(
        "Codex app-server failed to start",
        "Execution failed"
      )
    ).toBe("Execution failed")
    expect(
      getPublicRuntimeMessage("Model quota exceeded", "Execution failed")
    ).toBe("Model quota exceeded")
  })
})
