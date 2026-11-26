import type { Locale } from "@linksense/shared"

type DesktopExecutionMessages = {
  cloudTargetUnavailable: string
  noTargetAvailable: string
  deviceChanged: string
}

export const desktopExecutionMessages = {
  "zh-CN": {
    cloudTargetUnavailable: "云端任务入口当前不可用，暂时无法新建任务。",
    noTargetAvailable: "云端任务当前不可用，暂时无法新建任务。",
    deviceChanged: "所选内容或任务页面已变化。请重试。",
  },
  "en-US": {
    cloudTargetUnavailable:
      "The cloud task entry point isn’t available right now, so new tasks can’t be started.",
    noTargetAvailable:
      "Cloud tasks aren’t available right now, so new tasks can’t be started.",
    deviceChanged: "The selection or task page changed. Try again.",
  },
  "es-ES": {
    cloudTargetUnavailable:
      "El acceso a las tareas en la nube no está disponible ahora mismo, así que no se pueden iniciar tareas nuevas.",
    noTargetAvailable:
      "Las tareas en la nube no están disponibles ahora mismo, así que no se pueden iniciar tareas nuevas.",
    deviceChanged: "La selección o la página de la tarea ha cambiado. Inténtalo de nuevo.",
  },
  "pt-BR": {
    cloudTargetUnavailable:
      "A entrada de tarefas na nuvem não está disponível no momento, então não é possível iniciar novas tarefas.",
    noTargetAvailable:
      "As tarefas na nuvem não estão disponíveis no momento, então não é possível iniciar novas tarefas.",
    deviceChanged: "A seleção ou a página da tarefa mudou. Tente novamente.",
  },
  "fr-FR": {
    cloudTargetUnavailable:
      "L’accès aux tâches cloud n’est pas disponible pour le moment, il est donc impossible de démarrer de nouvelles tâches.",
    noTargetAvailable:
      "Les tâches cloud ne sont pas disponibles pour le moment, il est donc impossible de démarrer de nouvelles tâches.",
    deviceChanged: "La sélection ou la page de la tâche a changé. Réessayez.",
  },
  "ja-JP": {
    cloudTargetUnavailable:
      "クラウドタスクの入口は現在利用できないため、新しいタスクを開始できません。",
    noTargetAvailable:
      "クラウドタスクは現在利用できないため、新しいタスクを開始できません。",
    deviceChanged: "選択内容またはタスクページが変更されました。もう一度お試しください。",
  },
} satisfies Record<Locale, DesktopExecutionMessages>
