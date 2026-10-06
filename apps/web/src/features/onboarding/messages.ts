import type { Locale } from "@linksense/shared"

type Messages = {
  title: string
  description: string
  accountReady: string
  modelNeeded: string
  adminHelp: string
  configureModel: string
  dismiss: string
  reopen: string
}

export const onboardingMessages: Record<Locale, Messages> = {
  "zh-CN": {
    title: "开始使用",
    description: "准备好模型，就可以开始你的第一个任务。",
    accountReady: "账号已就绪",
    modelNeeded: "需要配置模型",
    adminHelp: "添加模型并测试连接，保存后即可开始任务。",
    configureModel: "配置模型",
    dismiss: "关闭引导",
    reopen: "开始使用引导",
  },
  "en-US": {
    title: "Get started",
    description: "Set up a model to start your first task.",
    accountReady: "Your account is ready",
    modelNeeded: "Set up a model",
    adminHelp: "Add a model, test the connection, and save to start a task.",
    configureModel: "Configure model",
    dismiss: "Dismiss guide",
    reopen: "Getting started guide",
  },
  "es-ES": {
    title: "Primeros pasos",
    description: "Configura un modelo para comenzar tu primera tarea.",
    accountReady: "Tu cuenta está lista",
    modelNeeded: "Configura un modelo",
    adminHelp:
      "Añade un modelo, prueba la conexión y guarda para iniciar una tarea.",
    configureModel: "Configurar modelo",
    dismiss: "Cerrar guía",
    reopen: "Guía de primeros pasos",
  },
  "pt-BR": {
    title: "Primeiros passos",
    description: "Configure um modelo para começar sua primeira tarefa.",
    accountReady: "Sua conta está pronta",
    modelNeeded: "Configure um modelo",
    adminHelp:
      "Adicione um modelo, teste a conexão e salve para iniciar uma tarefa.",
    configureModel: "Configurar modelo",
    dismiss: "Fechar guia",
    reopen: "Guia de primeiros passos",
  },
  "fr-FR": {
    title: "Premiers pas",
    description: "Configurez un modèle pour commencer votre première tâche.",
    accountReady: "Votre compte est prêt",
    modelNeeded: "Configurez un modèle",
    adminHelp:
      "Ajoutez un modèle, testez la connexion et enregistrez pour lancer une tâche.",
    configureModel: "Configurer un modèle",
    dismiss: "Fermer le guide",
    reopen: "Guide de démarrage",
  },
  "ja-JP": {
    title: "はじめに",
    description: "モデルを設定して、最初のタスクを始めましょう。",
    accountReady: "アカウントの準備ができました",
    modelNeeded: "モデルの設定が必要です",
    adminHelp:
      "モデルを追加し、接続をテストして保存すると、タスクを開始できます。",
    configureModel: "モデルを設定",
    dismiss: "ガイドを閉じる",
    reopen: "スタートガイド",
  },
}
