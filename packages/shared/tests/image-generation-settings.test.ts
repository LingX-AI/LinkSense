import { describe, expect, it } from "vitest"

import {
  imageGenerationProviderDefinitions,
  imageGenerationProviderSchema,
  imageGenerationRequestSchema,
  updateImageGenerationSettingsSchema,
} from "../src/image-generation.js"

const settings = {
  expected_revision: 0,
  enabled: true,
  provider: "openai_compatible",
  api_key: "synthetic-image-key",
  model: "custom-image-model",
  price_per_image: "0.25",
}

describe("generated image names", () => {
  it("requires a scene name and preserves names in the user's language", () => {
    expect(imageGenerationRequestSchema.safeParse({ prompt: "A sleeping corgi" }).success).toBe(false)
    expect(imageGenerationRequestSchema.parse({
      prompt: "A sleeping corgi on a sunny windowsill",
      image_name: "  午后窗台上的柯基  ",
    }).image_name).toBe("午后窗台上的柯基")
  })

  it.each(["", "   ", "../corgi", "folder/corgi", "folder\\corgi", "corgi\u0000", ".", "..", "corgi.", "a".repeat(101)])(
    "rejects unsafe or empty image names: %j",
    (imageName) => {
      expect(imageGenerationRequestSchema.safeParse({ prompt: "A corgi", image_name: imageName }).success).toBe(false)
    },
  )

  it.each(["草地上的柯基", "Corgi on the lawn", "Corgi en el jardín", "Corgi no gramado", "Corgi dans le jardin", "芝生の上のコーギー"])(
    "preserves the scene name in each supported language: %s", (imageName) => {
      expect(imageGenerationRequestSchema.parse({ prompt: "A corgi", image_name: imageName }).image_name).toBe(imageName)
    },
  )
})

describe("image generation connection settings", () => {
  it("accepts the OpenAI-compatible provider and publishes its defaults", () => {
    expect(imageGenerationProviderSchema.parse("openai_compatible")).toBe(
      "openai_compatible",
    )
    expect(imageGenerationProviderDefinitions).toContainEqual(
      expect.objectContaining({
        key: "openai_compatible",
        base_url: "https://api.openai.com/v1",
        max_images: 10,
      }),
    )
  })

  it.each(imageGenerationProviderDefinitions)(
    "accepts and normalizes a custom HTTP service address for $key",
    ({ key }) => {
      const parsed = updateImageGenerationSettingsSchema.parse({
        ...settings,
        provider: key,
        provider_options: {
          workspace_id: key === "alibaba_bailian" ? "workspace" : null,
          region: key === "alibaba_bailian" ? "cn-beijing" : null,
        },
        base_url: "http://image-service.example.test:8080/api/v1///",
      })
      expect(parsed.base_url).toBe(
        "http://image-service.example.test:8080/api/v1",
      )
    },
  )

  it.each([
    "",
    "not-a-url",
    "file:///etc/passwd",
    "ftp://image-service.example.test/v1",
    "https://user:password@image-service.example.test/v1",
    "https://image-service.example.test/v1?api_key=secret",
    "https://image-service.example.test/v1#fragment",
  ])("rejects an invalid or credential-bearing service address: %s", (baseUrl) => {
    expect(
      updateImageGenerationSettingsSchema.safeParse({
        ...settings,
        base_url: baseUrl,
      }).success,
    ).toBe(false)
  })

  it("allows provider defaults without a custom address", () => {
    expect(updateImageGenerationSettingsSchema.parse(settings).base_url).toBeUndefined()
    expect(
      updateImageGenerationSettingsSchema.parse({ ...settings, base_url: null })
        .base_url,
    ).toBeNull()
  })
})
