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

  it("localizes historical gateway JSON instead of showing its body", () => {
    const body = JSON.stringify({
      error: {
        type: "model_gateway_error",
        code: "model_provider_error",
        message: "private-diagnostic",
      },
    })
    expect(
      getPublicRuntimeMessage(
        body,
        "Execution failed",
        (key) => `translated:${key}`
      )
    ).toBe("translated:errors.modelGateway.model_provider_error")
    expect(
      getPublicRuntimeMessage(
        `HTTP 502: ${body}`,
        "Execution failed",
        (key) => `translated:${key}`
      )
    ).toBe("translated:errors.modelGateway.model_provider_error")
  })

  it.each([
    '{"error":{"message":"private-diagnostic"}}',
    '{"error":',
    '[{"token":"private-diagnostic"}]',
  ])("hides unknown or malformed structured errors: %s", (value) => {
    expect(getPublicRuntimeMessage(value, "Execution failed")).toBe(
      "Execution failed"
    )
  })
})
