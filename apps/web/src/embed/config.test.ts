// @vitest-environment node

import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import { embedFrameConfigSchema } from "./config"

describe("embedded application configuration", () => {
  it.each(["es-ES", "pt-BR", "fr-FR", "ja-JP"])(
    "accepts the %s locale",
    (locale) => {
      const parsed = embedFrameConfigSchema.safeParse({
        app_id: "lsa_application_identifier_1234",
        parent_origin: "https://partner.example.test",
        auth_mode: "public",
        locale,
        starter_questions: [],
        application: {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Partner operations",
          description: null,
          icon: { type: "preset", preset: "bot" },
          allows_user_model_selection: false,
        },
      })

      expect(parsed.success).toBe(true)
    }
  )

  it("keeps the application model-selection policy in the trusted frame configuration", () => {
    expect(
      embedFrameConfigSchema.parse({
        app_id: "lsa_application_identifier_1234",
        parent_origin: "https://partner.example.test",
        auth_mode: "required",
        locale: "en-US",
        starter_questions: ["How do I apply?"],
        application: {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Partner operations",
          description: null,
          icon: { type: "preset", preset: "bot" },
          allows_user_model_selection: true,
        },
      }).application.allows_user_model_selection
    ).toBe(true)
  })

  it("rejects more than four starter questions", () => {
    expect(
      embedFrameConfigSchema.safeParse({
        app_id: "lsa_application_identifier_1234",
        parent_origin: "https://partner.example.test",
        auth_mode: "public",
        locale: "zh-CN",
        starter_questions: ["1", "2", "3", "4", "5"],
        application: {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Partner operations",
          description: null,
          icon: { type: "preset", preset: "bot" },
          allows_user_model_selection: true,
        },
      }).success
    ).toBe(false)
  })

  it("constrains the embedded grid and keeps a single message scroller", async () => {
    const css = await readFile("src/embed/embed.css", "utf8")

    expect(css).toMatch(
      /\.embed-app\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su
    )
    expect(css).toMatch(
      /\.embed-thread\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/su
    )
    expect(css).toMatch(
      /\.embed-thread \.conversation-scroll-embedded\s*\{[^}]*min-height:\s*0;[^}]*height:\s*100%;/su
    )
  })

  it("styles built-in questions as subtle left-aligned cards", async () => {
    const css = await readFile("src/embed/embed.css", "utf8")

    expect(css).toMatch(
      /\.embed-starter-question\s*\{[^}]*border:\s*1px solid var\(--app-border\);[^}]*border-radius:\s*16px;[^}]*text-align:\s*left;/su
    )
    expect(css).toMatch(
      /\.embed-starter-question > span:last-child\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*text-align:\s*left;/su
    )
    expect(css).toMatch(
      /\.embed-starter-question:hover,\s*\.embed-starter-question:focus-visible\s*\{[^}]*background:\s*var\(--app-hover-subtle\);/su
    )
  })
})
