// @vitest-environment node

import { describe, expect, it } from "vitest"

import {
  embedExternalApplicationSessionFromMessage,
  embedLocaleFromMessage,
} from "./external-application-session-message"

const APP_ID = "lsa_application_identifier"

describe("external embed application session messages", () => {
  it("accepts locale only from dedicated locale messages", () => {
    expect(
      embedLocaleFromMessage(
        { type: "linksense:locale", appId: APP_ID, locale: "en-US" },
        APP_ID
      )
    ).toBe("en-US")
    expect(
      embedLocaleFromMessage(
        { type: "linksense:locale", appId: APP_ID, locale: "zh-CN" },
        APP_ID
      )
    ).toBe("zh-CN")
    expect(
      embedLocaleFromMessage(
        { type: "linksense:locale", appId: APP_ID, locale: "fr-FR" },
        APP_ID
      )
    ).toBeUndefined()
    expect(
      embedLocaleFromMessage(
        { type: "linksense:locale", appId: "other", locale: "en-US" },
        APP_ID
      )
    ).toBeUndefined()
    expect(
      embedLocaleFromMessage(
        { type: "linksense:ticket", appId: APP_ID, locale: "en-US" },
        APP_ID
      )
    ).toBeUndefined()
    expect(
      embedLocaleFromMessage(
        { type: "linksense:context", appId: APP_ID, locale: "en-US" },
        APP_ID
      )
    ).toBeUndefined()
  })

  it("accepts an optional sessionId on ticket messages", () => {
    expect(
      embedExternalApplicationSessionFromMessage(
        {
          type: "linksense:ticket",
          appId: APP_ID,
          sessionId: "business-session-a",
        },
        APP_ID
      )
    ).toEqual({ sessionId: "business-session-a" })
    expect(
      embedExternalApplicationSessionFromMessage(
        { type: "linksense:ticket", appId: APP_ID },
        APP_ID
      )
    ).toEqual({ sessionId: null })
  })

  it("accepts dedicated updates and explicit clearing", () => {
    expect(
      embedExternalApplicationSessionFromMessage(
        {
          type: "linksense:session-id",
          appId: APP_ID,
          sessionId: "business-session-b",
        },
        APP_ID
      )
    ).toEqual({ sessionId: "business-session-b" })
    expect(
      embedExternalApplicationSessionFromMessage(
        {
          type: "linksense:session-id",
          appId: APP_ID,
          sessionId: null,
        },
        APP_ID
      )
    ).toEqual({ sessionId: null })
  })

  it("rejects malformed or cross-application values", () => {
    expect(
      embedExternalApplicationSessionFromMessage(
        {
          type: "linksense:ticket",
          appId: "lsa_another_application",
          sessionId: "business-session-b",
        },
        APP_ID
      )
    ).toBeUndefined()
    expect(
      embedExternalApplicationSessionFromMessage(
        {
          type: "linksense:ticket",
          appId: APP_ID,
          sessionId: "x".repeat(16_385),
        },
        APP_ID
      )
    ).toBeUndefined()
    expect(
      embedExternalApplicationSessionFromMessage(
        {
          type: "linksense:ticket",
          appId: APP_ID,
          sessionId: "invalid\r\nsession",
        },
        APP_ID
      )
    ).toBeUndefined()
  })
})
