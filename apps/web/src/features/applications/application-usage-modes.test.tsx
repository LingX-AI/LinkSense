import { useState } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { supportedLocales, type ApplicationUsageMode } from "@linksense/shared"
import i18n from "@/i18n"
import {
  ApplicationUsageModeBadges,
  ApplicationUsageModes,
} from "./application-usage-modes"

afterEach(cleanup)
function Options() {
  const [modes, setModes] = useState<ApplicationUsageMode[]>(["install"])
  return <ApplicationUsageModes value={modes} onChange={setModes} />
}

describe("application usage options", () => {
  const localizedCopy = [
    {
      locale: "zh-CN",
      service: "在线应用服务",
      installDescription:
        "用户安装为自己的应用，自行配置应用可能需要的凭据，使用者能够看到应用源码。",
      serviceDescription:
        "发布应用为在线服务，用户无需安装为自己的本地应用，将使用你已配置的凭据在线使用应用。",
    },
    {
      locale: "en-US",
      service: "Online application service",
      installDescription:
        "Users install their own copy of the application, configure any credentials it may need, and can view its source code.",
      serviceDescription:
        "Publish the application as an online service. Users access it online with your configured credentials, without installing their own local copy.",
    },
    {
      locale: "es-ES",
      service: "Servicio de aplicación en línea",
      installDescription:
        "Los usuarios instalan su propia copia de la aplicación, configuran las credenciales que pueda necesitar y pueden ver su código fuente.",
      serviceDescription:
        "Publica la aplicación como un servicio en línea. Los usuarios la utilizan en línea con las credenciales que has configurado, sin instalar su propia copia local.",
    },
    {
      locale: "pt-BR",
      service: "Serviço de aplicativo online",
      installDescription:
        "Os usuários instalam sua própria cópia do aplicativo, configuram as credenciais que ele possa precisar e podem ver seu código-fonte.",
      serviceDescription:
        "Publique o aplicativo como um serviço online. Os usuários o utilizam online com as credenciais que você configurou, sem instalar sua própria cópia local.",
    },
    {
      locale: "fr-FR",
      service: "Service d’application en ligne",
      installDescription:
        "Les utilisateurs installent leur propre copie de l’application, configurent les identifiants dont elle peut avoir besoin et peuvent consulter son code source.",
      serviceDescription:
        "Publiez l’application sous forme de service en ligne. Les utilisateurs y accèdent en ligne avec les identifiants que vous avez configurés, sans installer leur propre copie locale.",
    },
    {
      locale: "ja-JP",
      service: "オンラインアプリケーションサービス",
      installDescription:
        "ユーザーは自分用のアプリケーションをインストールし、必要に応じて認証情報を自分で設定します。アプリケーションのソースコードも閲覧できます。",
      serviceDescription:
        "アプリケーションをオンラインサービスとして公開します。ユーザーは自分用のローカルアプリケーションをインストールせずに、あなたが設定した認証情報でオンライン利用できます。",
    },
  ] as const

  it.each(localizedCopy)(
    "shows the online service name and both usage descriptions in $locale",
    async ({ locale, service, installDescription, serviceDescription }) => {
      await i18n.changeLanguage(locale)
      render(<Options />)
      expect(
        screen.getByRole("checkbox", {
          name: i18n.t("applications.distribution.modes.install"),
        })
      ).toHaveAccessibleDescription(installDescription)
      expect(
        screen.getByRole("checkbox", { name: service })
      ).toHaveAccessibleDescription(serviceDescription)
    }
  )

  it.each(localizedCopy)(
    "uses the online service name in usage badges in $locale",
    async ({ locale, service }) => {
      await i18n.changeLanguage(locale)
      render(<ApplicationUsageModeBadges modes={["service"]} />)
      expect(screen.getByText(service)).toBeVisible()
    }
  )

  it("uses a form-label-sized legend and two rounded choice cards on one row", async () => {
    await i18n.changeLanguage("zh-CN")
    render(<Options />)
    const legend = screen.getByText(
      i18n.t("applications.distribution.usageModes")
    )
    expect(legend).toHaveAttribute("data-variant", "label")
    const cards = screen
      .getAllByRole("checkbox")
      .map((checkbox) => checkbox.closest("label"))
    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expect(card).toHaveClass(
        "has-[>[data-slot=field]]:rounded-2xl",
        "has-[>[data-slot=field]]:border",
        "border-divider"
      )
      expect(card?.querySelector(':scope > [data-slot="field"]')).not.toBeNull()
    }
    expect(cards[0]?.parentElement).toBe(cards[1]?.parentElement)
    expect(cards[0]?.parentElement).toHaveClass("grid", "grid-cols-2")
  })

  it("toggles from the card description or keyboard without changing the other option", async () => {
    await i18n.changeLanguage("zh-CN")
    render(<Options />)
    const service = screen.getByRole("checkbox", { name: "在线应用服务" })
    const description = i18n.t(
      "applications.distribution.modeDescriptions.service"
    )
    expect(service).toHaveAccessibleDescription(description)
    await userEvent.click(screen.getByText(description))
    expect(service).toBeChecked()
    expect(service).toHaveFocus()
    await userEvent.keyboard(" ")
    expect(service).not.toBeChecked()
    expect(screen.getByRole("checkbox", { name: "应用安装包" })).toBeChecked()
  })

  it("does not change disabled options when clicking their cards", async () => {
    await i18n.changeLanguage("zh-CN")
    const onChange = vi.fn()
    render(
      <ApplicationUsageModes value={["install"]} onChange={onChange} disabled />
    )
    for (const mode of ["install", "service"] as const) {
      const checkbox = screen.getByRole("checkbox", {
        name: i18n.t(`applications.distribution.modes.${mode}`),
      })
      expect(checkbox).toHaveAttribute("aria-disabled", "true")
      await userEvent.click(
        screen.getByText(
          i18n.t(`applications.distribution.modeDescriptions.${mode}`)
        )
      )
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each(supportedLocales)(
    "lets users select either option or both in %s",
    async (locale) => {
      await i18n.changeLanguage(locale)
      render(<Options />)
      const install = screen.getByRole("checkbox", {
        name: i18n.t("applications.distribution.modes.install"),
      })
      const service = screen.getByRole("checkbox", {
        name: i18n.t("applications.distribution.modes.service"),
      })
      expect(install).toBeChecked()
      expect(service).not.toBeChecked()
      await userEvent.click(service)
      expect(install).toBeChecked()
      expect(service).toBeChecked()
      await userEvent.click(install)
      expect(install).not.toBeChecked()
      expect(service).toBeChecked()
    }
  )

  it("falls back to Chinese for an unsupported language", async () => {
    await i18n.changeLanguage("de")
    render(<Options />)
    expect(screen.getByRole("checkbox", { name: "应用安装包" })).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "在线应用服务" })).toBeVisible()
  })

  it("falls back to the Chinese usage copy when a translation is missing", async () => {
    const fallback = i18n.cloneInstance({ forkResourceStore: true })
    fallback.removeResourceBundle("en-US", "translation")
    const chinese = localizedCopy[0]
    expect(
      fallback.t("applications.distribution.modes.service", { lng: "en-US" })
    ).toBe(chinese.service)
    expect(
      fallback.t("applications.distribution.modeDescriptions.install", {
        lng: "en-US",
      })
    ).toBe(chinese.installDescription)
    expect(
      fallback.t("applications.distribution.modeDescriptions.service", {
        lng: "en-US",
      })
    ).toBe(chinese.serviceDescription)
  })
})
