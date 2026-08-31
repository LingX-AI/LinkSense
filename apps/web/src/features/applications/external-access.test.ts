import { describe, expect, it } from "vitest"

import type { ApplicationExternalAccess } from "@linksense/shared"

import {
  externalAccessSecurityConfigurationChanged,
  externalIframeSnippet,
  externalIframeUrl,
} from "./external-access"

const PARENT_ORIGIN = "https://partner.example.test"

describe("application external access embed code", () => {
  it("creates a public iframe URL scoped to the selected parent origin", () => {
    const access = externalAccess("public")

    expect(externalIframeUrl(access, PARENT_ORIGIN, "en-US")).toBe(
      `https://linksense.example.test/api/v1/embed/frame/${access.app_id}?parent_origin=${encodeURIComponent(PARENT_ORIGIN)}&locale=en-US`
    )
    const snippet = externalIframeSnippet(access, PARENT_ORIGIN, {
      title: "Partner assistant",
      ticketComment: "Request a ticket from your backend.",
    })
    expect(snippet).toContain("<iframe")
    expect(snippet).toContain("<script")
    expect(snippet).toContain("locale=zh-CN")
    expect(snippet).toContain('type: "linksense:locale"')
    expect(snippet).toContain("locale")
    expect(snippet).not.toContain("ticket")
    expect(snippet).not.toContain("token")
    expect(snippet).not.toContain("public-sessions")
    expect(snippet).not.toContain("linksense:ticket")
  })

  it("keeps App credentials on the backend and delivers only a one-time ticket", () => {
    const access = externalAccess("required")
    const snippet = externalIframeSnippet(access, PARENT_ORIGIN, {
      title: "Partner assistant",
      ticketComment: "Request a ticket from your backend.",
    })

    expect(snippet).toContain('fetch("/your-backend/linksense-ticket"')
    expect(snippet).toContain(
      'event.origin !== "https://linksense.example.test"'
    )
    expect(snippet).toContain("event.source !== frame.contentWindow")
    expect(snippet).not.toContain("linksense:reauthentication-required")
    expect(snippet).not.toContain("resume_session_id")
    expect(snippet).toContain('type: "linksense:ticket"')
    expect(snippet).toContain("locale=zh-CN")
    expect(snippet).toContain('type: "linksense:locale"')
    expect(snippet).not.toMatch(
      /type: "linksense:ticket"[\s\S]*ticket,[\s\S]*locale,/u
    )
    expect(snippet).not.toContain("userId")
    expect(snippet).toContain("sessionId")
    expect(snippet).toContain(`appId: "${access.app_id}"`)
    expect(snippet).not.toContain(access.app_secret ?? "missing-app-secret")
    expect(snippet).not.toContain("app_secret")
  })

  it("detects changes to an existing external security boundary", () => {
    const access = externalAccess("required")

    expect(
      externalAccessSecurityConfigurationChanged(access, {
        enabled: access.enabled,
        auth_mode: access.auth_mode,
        allowed_origins: access.allowed_origins,
        starter_questions_by_origin: access.starter_questions_by_origin,
      })
    ).toBe(false)
    expect(
      externalAccessSecurityConfigurationChanged(access, {
        enabled: access.enabled,
        auth_mode: access.auth_mode,
        allowed_origins: access.allowed_origins,
        starter_questions_by_origin: [
          { origin: PARENT_ORIGIN, questions: ["How do I apply?"] },
        ],
      })
    ).toBe(false)
    expect(
      externalAccessSecurityConfigurationChanged(access, {
        enabled: false,
        auth_mode: access.auth_mode,
        allowed_origins: access.allowed_origins,
        starter_questions_by_origin: access.starter_questions_by_origin,
      })
    ).toBe(true)
    expect(
      externalAccessSecurityConfigurationChanged(access, {
        enabled: access.enabled,
        auth_mode: "public",
        allowed_origins: access.allowed_origins,
        starter_questions_by_origin: access.starter_questions_by_origin,
      })
    ).toBe(true)
    expect(
      externalAccessSecurityConfigurationChanged(access, {
        enabled: access.enabled,
        auth_mode: access.auth_mode,
        allowed_origins: ["https://replacement.example.test"],
        starter_questions_by_origin: [],
      })
    ).toBe(true)
  })
})

function externalAccess(
  authMode: "required" | "public"
): ApplicationExternalAccess {
  return {
    application_id: "20000000-0000-4000-8000-000000000001",
    enabled: true,
    auth_mode: authMode,
    app_id: "lsa_application_identifier_1234",
    app_secret:
      authMode === "required"
        ? "lss_application_secret_with_sufficient_entropy"
        : null,
    allowed_origins: [PARENT_ORIGIN],
    starter_questions_by_origin: [],
    iframe_url:
      "https://linksense.example.test/api/v1/embed/frame/lsa_application_identifier_1234",
    access_token_ttl_seconds: 7_200,
    renewal_token_ttl_seconds: 28_800,
    absolute_session_ttl_seconds: 604_800,
    created_at: "2026-08-13T00:00:00.000Z",
    updated_at: "2026-08-13T00:00:00.000Z",
  }
}
