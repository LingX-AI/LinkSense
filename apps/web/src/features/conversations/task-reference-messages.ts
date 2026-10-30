import type { Locale } from "@linksense/shared"

export const taskReferenceMessages = {
  "zh-CN": {
    active: "查看未归档任务",
    archived: "查看已归档任务",
    title: "引用其他任务",
    description:
      "本次消息允许 AI 按需只读所选任务的对话。最多选择 3 个，不包含附件或工具记录。",
    search: "搜索任务",
    empty: "没有可引用的任务",
    remove: "移除引用：{{title}}",
    source: "引用任务",
    limit: "已选择 {{count}} / 3 个任务",
    more: "加载更多",
  },
  "en-US": {
    active: "Show active tasks",
    archived: "Show archived tasks",
    title: "Reference other tasks",
    description:
      "Allow AI to read the selected conversations for this message. Select up to 3; attachments and tool logs are excluded.",
    search: "Search tasks",
    empty: "No tasks available",
    remove: "Remove reference: {{title}}",
    source: "Referenced tasks",
    limit: "{{count}} / 3 tasks selected",
    more: "Load more",
  },
  "es-ES": {
    active: "Mostrar tareas activas",
    archived: "Mostrar tareas archivadas",
    title: "Referenciar otras tareas",
    description:
      "Permite a la IA leer las conversaciones seleccionadas para este mensaje. Hasta 3; sin archivos adjuntos ni registros de herramientas.",
    search: "Buscar tareas",
    empty: "No hay tareas disponibles",
    remove: "Quitar referencia: {{title}}",
    source: "Tareas referenciadas",
    limit: "{{count}} / 3 tareas seleccionadas",
    more: "Cargar más",
  },
  "pt-BR": {
    active: "Mostrar tarefas ativas",
    archived: "Mostrar tarefas arquivadas",
    title: "Referenciar outras tarefas",
    description:
      "Permita que a IA leia as conversas selecionadas para esta mensagem. Até 3; anexos e registros de ferramentas não são incluídos.",
    search: "Buscar tarefas",
    empty: "Nenhuma tarefa disponível",
    remove: "Remover referência: {{title}}",
    source: "Tarefas referenciadas",
    limit: "{{count}} / 3 tarefas selecionadas",
    more: "Carregar mais",
  },
  "fr-FR": {
    active: "Afficher les tâches actives",
    archived: "Afficher les tâches archivées",
    title: "Référencer d’autres tâches",
    description:
      "Autorisez l’IA à lire les conversations sélectionnées pour ce message. Jusqu’à 3 ; pièces jointes et journaux d’outils exclus.",
    search: "Rechercher des tâches",
    empty: "Aucune tâche disponible",
    remove: "Retirer la référence : {{title}}",
    source: "Tâches référencées",
    limit: "{{count}} / 3 tâches sélectionnées",
    more: "Charger la suite",
  },
  "ja-JP": {
    active: "アーカイブされていないタスクを表示",
    archived: "アーカイブ済みのタスクを表示",
    title: "他のタスクを参照",
    description:
      "このメッセージで、選択した会話を AI が必要に応じて読み取れます。最大 3 件。添付ファイルやツール記録は含みません。",
    search: "タスクを検索",
    empty: "参照できるタスクがありません",
    remove: "参照を削除：{{title}}",
    source: "参照タスク",
    limit: "{{count}} / 3 件を選択",
    more: "さらに読み込む",
  },
} satisfies Record<Locale, Record<string, string>>
