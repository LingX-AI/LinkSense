import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { setAccessToken } from "@/api/session"
import i18n from "@/i18n"
import { SamlSettingsForm } from "./settings-form"
import { SamlLoginButton } from "./login-button"
import { samlSettingsFixture } from "./test-fixture"
import { samlKeys } from "./api"
import { createInstance } from "i18next"
import { samlzhCN, samlenUS } from "./messages"
import {
  expectRequiredLabel,
  formLabelPattern,
} from "@/features/admin/required-field-label.test-helper"

const configured = {
  ...samlSettingsFixture,
  enabled: true,
  revision: 1,
  status: "configured" as const,
  idp_entity_id: "urn:example:identity",
  idp_sso_url: "https://idp.example.test/sso",
  idp_certificate: "public-test-certificate",
  sign_requests: true,
  signing_certificate: "public-signing-certificate",
  signing_private_key_configured: true,
}
function response(data: unknown, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { success: true, data }
        : { success: false, error_code: "VALIDATION_ERROR" }
    ),
    { status, headers: { "content-type": "application/json" } }
  )
}
function mount(element: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>
    ),
  }
}
beforeEach(async () => {
  setAccessToken("test-saml-token")
  await i18n.changeLanguage("zh-CN")
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAccessToken(null)
})

describe("SAML login and settings", () => {
  it.each([true, false])(
    "marks required SAML fields and requires a signing key only when no saved key exists (%s)",
    async (keyConfigured) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          response({
            ...configured,
            enabled: false,
            signing_private_key_configured: keyConfigured,
          })
        )
      )
      mount(<SamlSettingsForm />)
      await screen.findByRole("textbox", { name: i18n.t("saml.idpEntityId") })
      for (const key of [
        "idpEntityId",
        "idpSsoUrl",
        "idpCertificate",
        "emailAttribute",
        "signingCertificate",
      ]) {
        expectRequiredLabel(
          screen.getByRole("textbox", { name: i18n.t(`saml.${key}`) })
        )
      }
      expectRequiredLabel(
        screen.getByRole("textbox", { name: i18n.t("saml.signingKey") }),
        !keyConfigured
      )
      for (const key of ["nameAttribute", "spEntityId", "acsUrl"]) {
        expectRequiredLabel(
          screen.getByRole("textbox", { name: i18n.t(`saml.${key}`) }),
          false
        )
      }
      fireEvent.click(
        screen.getByRole("switch", { name: i18n.t("saml.signRequests") })
      )
      expect(
        screen.queryByRole("textbox", { name: i18n.t("saml.signingKey") })
      ).not.toBeInTheDocument()
    }
  )

  it("falls back to Chinese when an English SAML key is missing", async () => {
    const isolated = createInstance()
    await isolated.init({
      lng: "en-US",
      fallbackLng: "zh-CN",
      resources: {
        "en-US": { translation: { saml: { title: samlenUS.title } } },
        "zh-CN": { translation: { saml: samlzhCN } },
      },
    })
    expect(isolated.t("saml.title")).toBe(samlenUS.title)
    expect(isolated.t("saml.login")).toBe(samlzhCN.login)
  })
  it.each(["zh-CN", "en-US", "de-DE"])(
    "renders localized settings, errors and fallback in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
        response(configured, init?.method === "PUT" ? 400 : 200)
      )
      vi.stubGlobal("fetch", fetch)
      mount(<SamlSettingsForm />)
      expect(
        await screen.findByLabelText(
          formLabelPattern(i18n.t("saml.idpEntityId"))
        )
      ).toHaveValue(configured.idp_entity_id)
      expect(
        screen.getByRole("heading", { name: i18n.t("saml.title") })
      ).toBeVisible()
      for (const textarea of document.querySelectorAll("textarea")) {
        expect(textarea.closest('[data-layout="settings"]')).toHaveAttribute(
          "data-multiline",
          "true"
        )
      }
      expect(
        screen
          .getByRole("heading", { name: i18n.t("saml.title") })
          .closest('[data-slot="card"]')
      ).toBeNull()
      expect(
        screen.getByLabelText(formLabelPattern(i18n.t("saml.spEntityId")))
      ).toHaveAttribute("readonly")
      expect(
        screen.getByRole("link", { name: i18n.t("saml.metadata") })
      ).toHaveAttribute("href", configured.metadata_url)
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("common.save") })
      )
      expect(await screen.findByRole("alert")).toHaveTextContent(
        i18n.t("errors.validation")
      )
      expect(
        screen.getByLabelText(formLabelPattern(i18n.t("saml.idpEntityId")))
      ).toHaveValue(configured.idp_entity_id)
    }
  )
  it("preserves stored keys by omission, sends only settings and refreshes provider availability", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response(
        init?.method === "PUT" ? { ...configured, revision: 2 } : configured
      )
    )
    vi.stubGlobal("fetch", fetch)
    const { client } = mount(<SamlSettingsForm />)
    client.setQueryData(samlKeys.status, { enabled: false })
    expect(
      await screen.findByLabelText(formLabelPattern(i18n.t("saml.signingKey")))
    ).toHaveValue("")
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }))
    await waitFor(() =>
      expect(client.getQueryData(samlKeys.settings)).toMatchObject({
        revision: 2,
      })
    )
    const sent = JSON.parse(
      String(
        fetch.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body
      )
    )
    expect(sent).toEqual({
      enabled: true,
      expected_revision: 1,
      idp_entity_id: configured.idp_entity_id,
      idp_sso_url: configured.idp_sso_url,
      idp_certificate: configured.idp_certificate,
      email_attribute: "email",
      name_attribute: "displayName",
      sign_requests: true,
      signing_certificate: configured.signing_certificate,
    })
    expect(client.getQueryState(samlKeys.status)?.isInvalidated).toBe(true)
  })
  it("requires missing credentials before saving and prevents enabling without HTTPS", async () => {
    const fetch = vi.fn(async () =>
      response({
        ...samlSettingsFixture,
        acs_url: "http://localhost/api/v1/auth/saml/acs",
      })
    )
    vi.stubGlobal("fetch", fetch)
    mount(<SamlSettingsForm />)
    const enabled = await screen.findByRole("switch", {
      name: i18n.t("saml.enabled"),
    })
    expect(enabled).toHaveAttribute("aria-disabled", "true")
    expect(screen.getByText(i18n.t("saml.httpsRequired"))).toBeVisible()
    expect(
      screen.queryByRole("link", { name: i18n.t("saml.metadata") })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.validation")
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("requires a private key when request signing is first enabled", async () => {
    const fetch = vi.fn(async () =>
      response({ ...configured, signing_private_key_configured: false })
    )
    vi.stubGlobal("fetch", fetch)
    mount(<SamlSettingsForm />)
    fireEvent.click(
      await screen.findByRole("button", { name: i18n.t("common.save") })
    )
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.validation")
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it("allows disabling an existing configuration after the site loses HTTPS", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response({
        ...configured,
        enabled: init?.method !== "PUT",
        acs_url: "http://localhost/api/v1/auth/saml/acs",
        status: "invalid",
      })
    )
    vi.stubGlobal("fetch", fetch)
    mount(<SamlSettingsForm />)
    const enabled = await screen.findByRole("switch", {
      name: i18n.t("saml.enabled"),
    })
    fireEvent.click(enabled)
    expect(enabled).not.toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: i18n.t("common.save") }))
    await waitFor(() =>
      expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(
        true
      )
    )
    expect(
      JSON.parse(
        String(
          fetch.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body
        )
      )
    ).toMatchObject({ enabled: false })
  })
  it("disables duplicate saves while retaining edits after a failed save", async () => {
    let finish: (value: Response) => void = () => {
      throw new Error("Save not started")
    }
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : response(configured)
    )
    vi.stubGlobal("fetch", fetch)
    mount(<SamlSettingsForm />)
    const input = await screen.findByLabelText(
      formLabelPattern(i18n.t("saml.idpEntityId"))
    )
    fireEvent.change(input, { target: { value: "urn:edited" } })
    const save = screen.getByRole("button", { name: i18n.t("common.save") })
    fireEvent.click(save)
    await waitFor(() => expect(save).toBeDisabled())
    fireEvent.click(save)
    expect(
      fetch.mock.calls.filter(([, init]) => init?.method === "PUT")
    ).toHaveLength(1)
    finish(response(null, 400))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(input).toHaveValue("urn:edited")
    expect(save).toBeEnabled()
  })
  it("hides disabled login, retries a status failure, and prevents repeated login starts", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Promise<Response>(() => {})
        : response(null, 400)
    )
    vi.stubGlobal("fetch", fetch)
    const { client, container } = mount(<SamlLoginButton />)
    const retry = await screen.findByRole("button", {
      name: i18n.t("saml.retry"),
    })
    fetch.mockImplementation(async () => response({ enabled: false }))
    fireEvent.click(retry)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    client.setQueryData(samlKeys.status, { enabled: true })
    fetch.mockImplementation(async () => new Promise<Response>(() => {}))
    const login = await screen.findByRole("button", {
      name: i18n.t("saml.login"),
    })
    fireEvent.click(login)
    await waitFor(() => expect(login).toBeDisabled())
  })
  it("shows login-start errors and allows retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? response(null, 400)
          : response({ enabled: true })
      )
    )
    mount(<SamlLoginButton />)
    const login = await screen.findByRole("button", {
      name: i18n.t("saml.login"),
    })
    fireEvent.click(login)
    expect(await screen.findByRole("alert")).toHaveTextContent(
      i18n.t("errors.validation")
    )
    expect(login).toBeEnabled()
  })
})
