import { describe, expect, it } from "vitest"

import {
  discoveredModelCatalogSchema,
  modelCatalogDiscoveryProviderValues,
} from "../src/model-provider.js"

describe("model provider catalog contracts", () => {
  it("accepts normalized discovered model metadata", () => {
    expect(
      discoveredModelCatalogSchema.parse({
        provider_id: "provider-1",
        models: [
          {
            id: "model-a",
            display_name: "Model A",
            kind: "chat",
            context_window: 128_000,
            supports_image_input: true,
            supported_reasoning_efforts: ["low", "medium", "high"],
            default_reasoning_effort: "medium",
          },
        ],
      })
    ).toMatchObject({ provider_id: "provider-1", models: [{ id: "model-a" }] })
  })

  it("rejects incomplete reasoning metadata", () => {
    expect(
      discoveredModelCatalogSchema.safeParse({
        provider_id: "provider-1",
        models: [
          {
            id: "model-a",
            display_name: "Model A",
            kind: null,
            context_window: null,
            supports_image_input: null,
            supported_reasoning_efforts: ["high"],
            default_reasoning_effort: null,
          },
        ],
      }).success
    ).toBe(false)
  })

  it("keeps Google Vertex on the manual-entry path", () => {
    expect(modelCatalogDiscoveryProviderValues).not.toContain("google_vertex")
  })
})
