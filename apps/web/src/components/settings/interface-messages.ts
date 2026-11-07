import type { Locale } from "@linksense/shared"

export const settingsInterfaceMessages: Record<
  Locale,
  { title: string; preferences: string; description: string }
> = {
  "zh-CN": {
    title: "个人与设置",
    preferences: "界面偏好",
    description: "设置界面语言和任务处理方式。",
  },
  "en-US": {
    title: "Personal & settings",
    preferences: "Interface preferences",
    description: "Choose your language and how tasks behave.",
  },
  "es-ES": {
    title: "Personal y ajustes",
    preferences: "Preferencias de interfaz",
    description: "Elige el idioma y cómo se gestionan las tareas.",
  },
  "pt-BR": {
    title: "Pessoal e configurações",
    preferences: "Preferências da interface",
    description: "Escolha o idioma e como as tarefas são tratadas.",
  },
  "fr-FR": {
    title: "Espace personnel et paramètres",
    preferences: "Préférences de l’interface",
    description: "Choisissez votre langue et le comportement des tâches.",
  },
  "ja-JP": {
    title: "個人設定",
    preferences: "インターフェース設定",
    description: "表示言語とタスクの処理方法を設定します。",
  },
}
