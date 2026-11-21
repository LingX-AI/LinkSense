import { afterEach, describe, expect, it } from "vitest"
import {
  applicationAnnotationRuntimeLocation,
  desktopApplicationAnnotationConfigGlobal,
  desktopApplicationAnnotationConfigSchema,
  desktopApplicationAnnotationParentOrigin,
  desktopApplicationAnnotationReadyMessageType,
  desktopApplicationAnnotationReadySchema,
  isDesktopApplicationAnnotationParentEvent,
  readDesktopApplicationAnnotationConfig,
} from "./application-annotation-bridge"

const ticket = "a".repeat(43)
const prefix = "/api/v1/interactive-app-runtime/"

afterEach(() => {
  Reflect.deleteProperty(window, desktopApplicationAnnotationConfigGlobal)
})

describe("desktop application annotation bridge contracts", () => {
  it("reads only the page path below the selected runtime ticket", () => {
    expect(
      applicationAnnotationRuntimeLocation(`${prefix}${ticket}/index.html`)
    ).toEqual({
      ticket,
      path: "index.html",
    })
    expect(
      applicationAnnotationRuntimeLocation(
        `${prefix}${ticket}/pages/detail.htm`
      )
    ).toEqual({ ticket, path: "pages/detail.htm" })
  })

  it.each([
    `/other/${ticket}/index.html`,
    `${prefix}short/index.html`,
    `${prefix}${"a".repeat(44)}/index.html`,
    `${prefix}${ticket}/`,
    `${prefix}${ticket}/index.js`,
    `${prefix}${ticket}/%2e%2e/index.html`,
    `${prefix}${ticket}/../index.html`,
    `${prefix}${ticket}/pages//index.html`,
  ])("rejects a location outside the runtime HTML contract: %s", (pathname) => {
    expect(applicationAnnotationRuntimeLocation(pathname)).toBeNull()
  })

  it("accepts only an exact HTTPS or loopback HTTP packaged origin", () => {
    expect(
      desktopApplicationAnnotationConfigSchema.safeParse({
        version: 1,
        serverOrigin: "https://example.com",
        parentOrigin: desktopApplicationAnnotationParentOrigin,
      }).success
    ).toBe(true)
    expect(
      desktopApplicationAnnotationConfigSchema.safeParse({
        version: 1,
        serverOrigin: "http://127.0.0.1:4000",
        parentOrigin: desktopApplicationAnnotationParentOrigin,
      }).success
    ).toBe(true)
    for (const serverOrigin of [
      "https://example.com:443",
      "https://example.com/",
      "http://example.com",
      "mygo://localhost",
      "null",
    ]) {
      expect(
        desktopApplicationAnnotationConfigSchema.safeParse({
          version: 1,
          serverOrigin,
          parentOrigin: desktopApplicationAnnotationParentOrigin,
        }).success
      ).toBe(false)
    }
    expect(
      desktopApplicationAnnotationConfigSchema.safeParse({
        version: 1,
        serverOrigin: "https://example.com",
        parentOrigin: "https://example.com",
      }).success
    ).toBe(false)
  })

  it("removes the host configuration before any page script can read it", () => {
    Reflect.set(window, desktopApplicationAnnotationConfigGlobal, {
      version: 1,
      serverOrigin: "https://example.com",
      parentOrigin: desktopApplicationAnnotationParentOrigin,
    })
    expect(readDesktopApplicationAnnotationConfig(window)).toEqual({
      version: 1,
      serverOrigin: "https://example.com",
      parentOrigin: desktopApplicationAnnotationParentOrigin,
    })
    expect(Reflect.has(window, desktopApplicationAnnotationConfigGlobal)).toBe(
      false
    )

    Reflect.set(window, desktopApplicationAnnotationConfigGlobal, {
      version: 1,
      serverOrigin: "http://example.com",
      parentOrigin: desktopApplicationAnnotationParentOrigin,
    })
    expect(readDesktopApplicationAnnotationConfig(window)).toBeNull()
    expect(Reflect.has(window, desktopApplicationAnnotationConfigGlobal)).toBe(
      false
    )
  })

  it("requires a trusted real parent at the exact native origin", () => {
    const event = {
      isTrusted: true,
      origin: desktopApplicationAnnotationParentOrigin,
      source: window,
    }
    expect(
      isDesktopApplicationAnnotationParentEvent(
        event,
        window,
        desktopApplicationAnnotationParentOrigin
      )
    ).toBe(true)
    expect(
      isDesktopApplicationAnnotationParentEvent(
        { ...event, isTrusted: false },
        window,
        desktopApplicationAnnotationParentOrigin
      )
    ).toBe(false)
    expect(
      isDesktopApplicationAnnotationParentEvent(
        { ...event, origin: "https://example.com" },
        window,
        desktopApplicationAnnotationParentOrigin
      )
    ).toBe(false)
    expect(
      isDesktopApplicationAnnotationParentEvent(
        { ...event, source: null },
        window,
        desktopApplicationAnnotationParentOrigin
      )
    ).toBe(false)
    expect(
      isDesktopApplicationAnnotationParentEvent(event, window, "null")
    ).toBe(false)
  })

  it("accepts only a ready report whose ticket and page path already exist", () => {
    const ready = {
      type: desktopApplicationAnnotationReadyMessageType,
      ticket,
      path: "index.html",
    }
    expect(desktopApplicationAnnotationReadySchema.safeParse(ready).success).toBe(
      true
    )
    for (const candidate of [
      { ...ready, ticket: "short" },
      { ...ready, ticket: `${ticket}b` },
      { ...ready, path: "" },
      { ...ready, path: "../index.html" },
      { ...ready, path: "index.js" },
      { ...ready, path: "pages//index.html" },
      { ...ready, extra: "value" },
      { type: desktopApplicationAnnotationReadyMessageType, ticket },
    ]) {
      expect(
        desktopApplicationAnnotationReadySchema.safeParse(candidate).success
      ).toBe(false)
    }
  })
})
