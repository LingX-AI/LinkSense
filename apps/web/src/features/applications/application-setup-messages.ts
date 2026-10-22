import type { Locale } from "@linksense/shared"
import { applicationSetupZhCN } from "@/i18n/zh-CN/application-setup"
import { applicationSetupEnUS } from "@/i18n/en-US/application-setup"
import { applicationSetupEsES } from "@/i18n/es-ES/application-setup"
import { applicationSetupPtBR } from "@/i18n/pt-BR/application-setup"
import { applicationSetupFrFR } from "@/i18n/fr-FR/application-setup"
import { applicationSetupJaJP } from "@/i18n/ja-JP/application-setup"

type Source = typeof applicationSetupZhCN
type SetupMessages = {
  [K in keyof Source]: Source[K] extends string
    ? string
    : { [P in keyof Source[K]]: string }
}

export const applicationSetupMessages = {
  "zh-CN": applicationSetupZhCN,
  "en-US": applicationSetupEnUS,
  "es-ES": applicationSetupEsES,
  "pt-BR": applicationSetupPtBR,
  "fr-FR": applicationSetupFrFR,
  "ja-JP": applicationSetupJaJP,
} satisfies Record<Locale, SetupMessages>
