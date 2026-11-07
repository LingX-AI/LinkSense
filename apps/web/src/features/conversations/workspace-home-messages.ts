import type { Locale } from "@linksense/shared"

type WorkspaceHomeMessages = {
  greeting: string
  greetingName: string
  description: string
  workspace: string
  emptyTasksTitle: string
  emptyTasksHint: string
  pauseMotion: string
  resumeMotion: string
}

export const workspaceHomeMessages: Record<Locale, WorkspaceHomeMessages> = {
  "zh-CN": {
    greeting: "准备好开始了吗？",
    greetingName: "你好，{{name}}",
    description: "你的 AI 伙伴，助你处理知识、分析与日常工作。",
    workspace: "工作区",
    emptyTasksTitle: "暂无任务",
    emptyTasksHint: "从输入框开始你的第一个任务。",
    pauseMotion: "暂停粒子动效",
    resumeMotion: "继续粒子动效",
  },
  "en-US": {
    greeting: "Ready when you are.",
    greetingName: "Hello, {{name}}",
    description: "Your AI partner for knowledge, analysis, and everyday work.",
    workspace: "Workspace",
    emptyTasksTitle: "No tasks yet",
    emptyTasksHint: "Start your first task from the message box.",
    pauseMotion: "Pause particle animation",
    resumeMotion: "Resume particle animation",
  },
  "es-ES": {
    greeting: "Todo listo para empezar.",
    greetingName: "Hola, {{name}}",
    description:
      "Tu compañero de IA para el conocimiento, el análisis y el trabajo diario.",
    workspace: "Espacio de trabajo",
    emptyTasksTitle: "Aún no hay tareas",
    emptyTasksHint: "Inicia tu primera tarea desde el cuadro de mensajes.",
    pauseMotion: "Pausar la animación de partículas",
    resumeMotion: "Reanudar la animación de partículas",
  },
  "pt-BR": {
    greeting: "Pronto quando você estiver.",
    greetingName: "Olá, {{name}}",
    description:
      "Seu parceiro de IA para conhecimento, análise e trabalho diário.",
    workspace: "Espaço de trabalho",
    emptyTasksTitle: "Nenhuma tarefa ainda",
    emptyTasksHint: "Inicie sua primeira tarefa na caixa de mensagens.",
    pauseMotion: "Pausar animação de partículas",
    resumeMotion: "Retomar animação de partículas",
  },
  "fr-FR": {
    greeting: "Tout est prêt pour commencer.",
    greetingName: "Bonjour, {{name}}",
    description:
      "Votre partenaire IA pour les connaissances, l’analyse et le travail quotidien.",
    workspace: "Espace de travail",
    emptyTasksTitle: "Aucune tâche pour le moment",
    emptyTasksHint: "Lancez votre première tâche depuis la zone de saisie.",
    pauseMotion: "Mettre l’animation de particules en pause",
    resumeMotion: "Reprendre l’animation de particules",
  },
  "ja-JP": {
    greeting: "いつでも始められます。",
    greetingName: "{{name}}さん、こんにちは",
    description: "知識の活用、分析、日々の仕事を支える AI パートナー。",
    workspace: "ワークスペース",
    emptyTasksTitle: "まだタスクがありません",
    emptyTasksHint: "入力欄から最初のタスクを始めましょう。",
    pauseMotion: "パーティクルの動きを一時停止",
    resumeMotion: "パーティクルの動きを再開",
  },
}
