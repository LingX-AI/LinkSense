import type { Locale } from "@linksense/shared"

export const workspaceUiDemoMessages = {
  "zh-CN": {
    readOnly:
      "本地 UI 测试数据 · 自动化、插件中心和资料库均为虚构示例，仅供浏览，不会执行任务或修改真实数据。",
    exit: "退出示例",
  },
  "en-US": {
    readOnly:
      "Local UI samples · Automations, capabilities, and knowledge bases contain fictional, read-only data. Tasks will not run and live data will not change.",
    exit: "Exit samples",
  },
  "es-ES": {
    readOnly:
      "Ejemplos locales de interfaz · Las automatizaciones, capacidades y bases de conocimiento contienen datos ficticios de solo lectura. No se ejecutan tareas ni se modifican datos reales.",
    exit: "Salir de los ejemplos",
  },
  "pt-BR": {
    readOnly:
      "Exemplos locais de interface · Automações, recursos e bases de conhecimento usam dados fictícios, somente para leitura. Nenhuma tarefa será executada e nenhum dado real será alterado.",
    exit: "Sair dos exemplos",
  },
  "fr-FR": {
    readOnly:
      "Exemples locaux d’interface · Les automatisations, capacités et bases de connaissances utilisent des données fictives en lecture seule. Aucune tâche ne sera exécutée et aucune donnée réelle ne sera modifiée.",
    exit: "Quitter les exemples",
  },
  "ja-JP": {
    readOnly:
      "ローカル UI サンプル · 自動化、機能、ナレッジベースは閲覧専用の架空データです。タスクの実行や実データの変更は行いません。",
    exit: "サンプルを終了",
  },
} satisfies Record<Locale, { readOnly: string; exit: string }>
