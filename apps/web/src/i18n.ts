import { workspaceUiDemoMessages } from "@/features/ui-demo/messages"
import { desktopLoginMessages } from "@/features/desktop-login/messages"
import { desktopUpdateMessages } from "@/features/desktop-update/messages"
import { desktopDevicesMessages } from "@/features/desktop-devices/messages"
import { desktopExecutionMessages } from "@/features/desktop-execution/messages"
import { desktopComputerPermissionMessages } from "@/features/desktop-computer-permissions/messages"
import { desktopComputerUseMessages } from "@/features/desktop-computer-use/messages"
import { localWorkspaceMessages } from "@/features/local-workspace/messages"
import { browserPanelMessages } from "@/features/browser-panel/messages"
import { monitoringMessages } from "@/features/automations/monitoring-messages"
import { automationNotificationMessages } from "@/features/conversations/automation-notification-messages"
import { taskReferenceMessages } from "@/features/conversations/task-reference-messages"
import { taskArtifactDownloadMessages } from "@/features/task-artifacts/messages"
import { richOutputMessages } from "@/features/conversations/rich-output-messages"
import { webSearchMessages } from "@/features/admin/web-search-messages"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import {
  auditTranslationResource,
  supportedLocales,
  type Locale,
} from "@linksense/shared"

import { enUS } from "@/i18n/en-US"
import { esES } from "@/i18n/es-ES"
import { frFR } from "@/i18n/fr-FR"
import { jaJP } from "@/i18n/ja-JP"
import { ptBR } from "@/i18n/pt-BR"
import { zhCN } from "@/i18n/zh-CN"
import { onboardingMessages } from "@/features/onboarding/messages"
import { applicationSetupMessages } from "@/features/applications/application-setup-messages"
import { accountAccessMessages } from "@/components/auth/account-access-messages"
import { workspaceHomeMessages } from "@/features/conversations/workspace-home-messages"
import { settingsInterfaceMessages } from "@/components/settings/interface-messages"
import { adminConnectionMessages } from "@/features/connections/admin-messages"

export const supportedLanguages = supportedLocales
export type SupportedLanguage = Locale

const LANGUAGE_STORAGE_KEY = "linksense.language"

export function normalizeLanguage(
  value: string | null | undefined
): SupportedLanguage | null {
  if (!value) return null
  const normalized = value.toLowerCase()
  if (normalized.startsWith("zh")) return "zh-CN"
  if (normalized.startsWith("en")) return "en-US"
  if (normalized.startsWith("es")) return "es-ES"
  if (normalized.startsWith("pt")) return "pt-BR"
  if (normalized.startsWith("fr")) return "fr-FR"
  if (normalized.startsWith("ja")) return "ja-JP"
  return null
}

export function resolveBrowserLanguage(
  languages: readonly string[] | undefined,
  language: string | null | undefined
): SupportedLanguage {
  const candidates = languages?.length ? languages : language ? [language] : []
  for (const candidate of candidates) {
    const normalized = normalizeLanguage(candidate)
    if (normalized) return normalized
  }
  return "en-US"
}

function readStoredLanguage(): string | null {
  try {
    return window.localStorage?.getItem(LANGUAGE_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function readNativeLanguage(): string | null {
  const native = window.mygo
  if (native?.platform !== "darwin") return null
  return typeof native.locale === "string" ? native.locale : null
}

export function resolveInitialLanguage(input: {
  stored?: string | null
  native?: string | null
  languages?: readonly string[]
  language?: string | null
}): SupportedLanguage {
  const stored = normalizeLanguage(input.stored)
  if (stored) return stored
  const native = normalizeLanguage(input.native)
  if (native) return native
  return resolveBrowserLanguage(input.languages, input.language)
}

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": {
      translation: {
        webSearch: webSearchMessages["zh-CN"],
        ...zhCN,
        desktopLogin: desktopLoginMessages["zh-CN"],
        desktopUpdate: desktopUpdateMessages["zh-CN"],
        desktopDevices: desktopDevicesMessages["zh-CN"],
        desktopExecution: desktopExecutionMessages["zh-CN"],
        desktopComputerPermissions:
          desktopComputerPermissionMessages["zh-CN"],
        desktopComputerUse: desktopComputerUseMessages["zh-CN"],
        localWorkspace: localWorkspaceMessages["zh-CN"],
        accountAccess: accountAccessMessages["zh-CN"],
        workspaceHome: workspaceHomeMessages["zh-CN"],
        settingsInterface: settingsInterfaceMessages["zh-CN"],
        browserPanel: browserPanelMessages["zh-CN"],
        monitoring: monitoringMessages["zh-CN"],
        taskReferences: taskReferenceMessages["zh-CN"],
        taskArtifacts: taskArtifactDownloadMessages["zh-CN"],
        richOutput: richOutputMessages["zh-CN"],
        automationNotifications: automationNotificationMessages["zh-CN"],
        applicationSetup: applicationSetupMessages["zh-CN"],
        adminConnections: adminConnectionMessages["zh-CN"],
        onboarding: onboardingMessages["zh-CN"],
        workspaceUiDemo: workspaceUiDemoMessages["zh-CN"],
        auditValues: auditTranslationResource("zh-CN"),
      },
    },
    "en-US": {
      translation: {
        webSearch: webSearchMessages["en-US"],
        ...enUS,
        desktopLogin: desktopLoginMessages["en-US"],
        desktopUpdate: desktopUpdateMessages["en-US"],
        desktopDevices: desktopDevicesMessages["en-US"],
        desktopExecution: desktopExecutionMessages["en-US"],
        desktopComputerPermissions:
          desktopComputerPermissionMessages["en-US"],
        desktopComputerUse: desktopComputerUseMessages["en-US"],
        localWorkspace: localWorkspaceMessages["en-US"],
        accountAccess: accountAccessMessages["en-US"],
        workspaceHome: workspaceHomeMessages["en-US"],
        settingsInterface: settingsInterfaceMessages["en-US"],
        browserPanel: browserPanelMessages["en-US"],
        monitoring: monitoringMessages["en-US"],
        taskReferences: taskReferenceMessages["en-US"],
        taskArtifacts: taskArtifactDownloadMessages["en-US"],
        richOutput: richOutputMessages["en-US"],
        automationNotifications: automationNotificationMessages["en-US"],
        applicationSetup: applicationSetupMessages["en-US"],
        adminConnections: adminConnectionMessages["en-US"],
        onboarding: onboardingMessages["en-US"],
        workspaceUiDemo: workspaceUiDemoMessages["en-US"],
        auditValues: auditTranslationResource("en-US"),
      },
    },
    "es-ES": {
      translation: {
        webSearch: webSearchMessages["es-ES"],
        ...esES,
        desktopLogin: desktopLoginMessages["es-ES"],
        desktopUpdate: desktopUpdateMessages["es-ES"],
        desktopDevices: desktopDevicesMessages["es-ES"],
        desktopExecution: desktopExecutionMessages["es-ES"],
        desktopComputerPermissions:
          desktopComputerPermissionMessages["es-ES"],
        desktopComputerUse: desktopComputerUseMessages["es-ES"],
        localWorkspace: localWorkspaceMessages["es-ES"],
        accountAccess: accountAccessMessages["es-ES"],
        workspaceHome: workspaceHomeMessages["es-ES"],
        settingsInterface: settingsInterfaceMessages["es-ES"],
        browserPanel: browserPanelMessages["es-ES"],
        monitoring: monitoringMessages["es-ES"],
        taskReferences: taskReferenceMessages["es-ES"],
        taskArtifacts: taskArtifactDownloadMessages["es-ES"],
        richOutput: richOutputMessages["es-ES"],
        automationNotifications: automationNotificationMessages["es-ES"],
        applicationSetup: applicationSetupMessages["es-ES"],
        adminConnections: adminConnectionMessages["es-ES"],
        onboarding: onboardingMessages["es-ES"],
        workspaceUiDemo: workspaceUiDemoMessages["es-ES"],
        auditValues: auditTranslationResource("es-ES"),
      },
    },
    "pt-BR": {
      translation: {
        webSearch: webSearchMessages["pt-BR"],
        ...ptBR,
        desktopLogin: desktopLoginMessages["pt-BR"],
        desktopUpdate: desktopUpdateMessages["pt-BR"],
        desktopDevices: desktopDevicesMessages["pt-BR"],
        desktopExecution: desktopExecutionMessages["pt-BR"],
        desktopComputerPermissions:
          desktopComputerPermissionMessages["pt-BR"],
        desktopComputerUse: desktopComputerUseMessages["pt-BR"],
        localWorkspace: localWorkspaceMessages["pt-BR"],
        accountAccess: accountAccessMessages["pt-BR"],
        workspaceHome: workspaceHomeMessages["pt-BR"],
        settingsInterface: settingsInterfaceMessages["pt-BR"],
        browserPanel: browserPanelMessages["pt-BR"],
        monitoring: monitoringMessages["pt-BR"],
        taskReferences: taskReferenceMessages["pt-BR"],
        taskArtifacts: taskArtifactDownloadMessages["pt-BR"],
        richOutput: richOutputMessages["pt-BR"],
        automationNotifications: automationNotificationMessages["pt-BR"],
        applicationSetup: applicationSetupMessages["pt-BR"],
        adminConnections: adminConnectionMessages["pt-BR"],
        onboarding: onboardingMessages["pt-BR"],
        workspaceUiDemo: workspaceUiDemoMessages["pt-BR"],
        auditValues: auditTranslationResource("pt-BR"),
      },
    },
    "fr-FR": {
      translation: {
        webSearch: webSearchMessages["fr-FR"],
        ...frFR,
        desktopLogin: desktopLoginMessages["fr-FR"],
        desktopUpdate: desktopUpdateMessages["fr-FR"],
        desktopDevices: desktopDevicesMessages["fr-FR"],
        desktopExecution: desktopExecutionMessages["fr-FR"],
        desktopComputerPermissions:
          desktopComputerPermissionMessages["fr-FR"],
        desktopComputerUse: desktopComputerUseMessages["fr-FR"],
        localWorkspace: localWorkspaceMessages["fr-FR"],
        accountAccess: accountAccessMessages["fr-FR"],
        workspaceHome: workspaceHomeMessages["fr-FR"],
        settingsInterface: settingsInterfaceMessages["fr-FR"],
        browserPanel: browserPanelMessages["fr-FR"],
        monitoring: monitoringMessages["fr-FR"],
        taskReferences: taskReferenceMessages["fr-FR"],
        taskArtifacts: taskArtifactDownloadMessages["fr-FR"],
        richOutput: richOutputMessages["fr-FR"],
        automationNotifications: automationNotificationMessages["fr-FR"],
        applicationSetup: applicationSetupMessages["fr-FR"],
        adminConnections: adminConnectionMessages["fr-FR"],
        onboarding: onboardingMessages["fr-FR"],
        workspaceUiDemo: workspaceUiDemoMessages["fr-FR"],
        auditValues: auditTranslationResource("fr-FR"),
      },
    },
    "ja-JP": {
      translation: {
        webSearch: webSearchMessages["ja-JP"],
        ...jaJP,
        desktopLogin: desktopLoginMessages["ja-JP"],
        desktopUpdate: desktopUpdateMessages["ja-JP"],
        desktopDevices: desktopDevicesMessages["ja-JP"],
        desktopExecution: desktopExecutionMessages["ja-JP"],
        desktopComputerPermissions:
          desktopComputerPermissionMessages["ja-JP"],
        desktopComputerUse: desktopComputerUseMessages["ja-JP"],
        localWorkspace: localWorkspaceMessages["ja-JP"],
        accountAccess: accountAccessMessages["ja-JP"],
        workspaceHome: workspaceHomeMessages["ja-JP"],
        settingsInterface: settingsInterfaceMessages["ja-JP"],
        browserPanel: browserPanelMessages["ja-JP"],
        monitoring: monitoringMessages["ja-JP"],
        taskReferences: taskReferenceMessages["ja-JP"],
        taskArtifacts: taskArtifactDownloadMessages["ja-JP"],
        richOutput: richOutputMessages["ja-JP"],
        automationNotifications: automationNotificationMessages["ja-JP"],
        applicationSetup: applicationSetupMessages["ja-JP"],
        adminConnections: adminConnectionMessages["ja-JP"],
        onboarding: onboardingMessages["ja-JP"],
        workspaceUiDemo: workspaceUiDemoMessages["ja-JP"],
        auditValues: auditTranslationResource("ja-JP"),
      },
    },
  },
  lng: resolveInitialLanguage({
    stored: readStoredLanguage(),
    native: readNativeLanguage(),
    languages: window.navigator.languages,
    language: window.navigator.language,
  }),
  fallbackLng: "zh-CN",
  supportedLngs: supportedLanguages,
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on("languageChanged", (language) => {
  const normalized = normalizeLanguage(language) ?? "zh-CN"
  document.documentElement.lang = normalized
})

document.documentElement.lang =
  normalizeLanguage(i18n.resolvedLanguage) ?? "zh-CN"

type NativeLanguageSync = (language: SupportedLanguage) => void

let nativeLanguageSync: NativeLanguageSync | null = null
let appLanguageRevision = 0

/**
 * Registers the macOS shell bridge that makes the native app language follow
 * an explicit Web choice. Only the main document installs it; embedded pages
 * keep their configured locale without touching native state.
 */
export function setNativeLanguageSync(handler: NativeLanguageSync | null) {
  nativeLanguageSync = handler
}

async function changeDisplayedLanguage(language: SupportedLanguage) {
  const currentLanguage = normalizeLanguage(
    i18n.language ?? i18n.resolvedLanguage
  )
  if (currentLanguage !== language) {
    await i18n.changeLanguage(language)
  } else if (document.documentElement.lang !== language) {
    document.documentElement.lang = language
  }
}

export async function setAppLanguage(
  language: SupportedLanguage,
  options: { persist?: boolean } = {}
) {
  // Only the installed macOS bridge follows persisted choices. A revision
  // keeps an overlapping older choice from persisting or reaching the shell
  // after a newer one; browsers and Windows keep writing as they did.
  const revision =
    options.persist === false || nativeLanguageSync === null
      ? null
      : ++appLanguageRevision
  await changeDisplayedLanguage(language)
  if (options.persist === false) return
  if (revision !== null && revision !== appLanguageRevision) return
  try {
    window.localStorage?.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Language switching remains available when browser storage is disabled.
  }
  try {
    nativeLanguageSync?.(language)
  } catch {
    // A native bridge failure must not break sign-in, Settings, or the page.
  }
}

export function getStoredLanguagePreference(): SupportedLanguage | null {
  return normalizeLanguage(readStoredLanguage())
}

export function hasStoredLanguagePreference() {
  try {
    return window.localStorage?.getItem(LANGUAGE_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

export default i18n
