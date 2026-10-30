export const monitoringMessages = {
  "zh-CN": {
    title: "结束规则与会话",
    stopCondition: "满足此条件后停止",
    stopHint: "由 Agent 判断；本次运行结束后暂停后续调度。留空不按条件停止。",
    maxRuns: "最多自动触发次数",
    maxHint: "留空不限次数。手动试跑不计入；自动派发失败也计一次。",
    freshTask: "每次使用新会话",
    freshHint:
      "保留用户及所选模型配置，不复制旧聊天记录；关闭则继续使用绑定任务。",
    count: "已自动触发 {{count}} 次",
    condition_met: "已满足停止条件",
    run_limit_reached: "已达到次数上限",
    runLimitReached: "自动运行次数已用尽，请先提高或取消次数上限。",
  },
  "en-US": {
    title: "Stop rules and context",
    stopCondition: "Stop when this condition is met",
    stopHint:
      "The agent evaluates this criterion. Future scheduling pauses after this run ends. Leave blank to disable.",
    maxRuns: "Maximum automatic triggers",
    maxHint:
      "Blank means unlimited. Manual previews do not count; failed automatic dispatches count once.",
    freshTask: "Use a new conversation for each run",
    freshHint:
      "Keep user and selected model settings without copying chat history. When off, reuse the linked task.",
    count: "{{count}} automatic triggers",
    condition_met: "Stop condition met",
    run_limit_reached: "Run limit reached",
    runLimitReached:
      "Increase or remove the automatic run limit before resuming.",
  },
  "es-ES": {
    title: "Reglas de parada y contexto",
    stopCondition: "Detener al cumplirse esta condición",
    stopHint:
      "El agente evalúa el criterio. La programación se pausa al finalizar esta ejecución. Déjalo vacío para desactivarlo.",
    maxRuns: "Máximo de activaciones automáticas",
    maxHint:
      "Vacío significa sin límite. Las pruebas manuales no cuentan; los envíos automáticos fallidos cuentan una vez.",
    freshTask: "Usar una conversación nueva en cada ejecución",
    freshHint:
      "Conserva la configuración del usuario y modelo sin copiar el historial. Si está desactivado, reutiliza la tarea vinculada.",
    count: "{{count}} activaciones automáticas",
    condition_met: "Condición de parada cumplida",
    run_limit_reached: "Límite de ejecuciones alcanzado",
    runLimitReached:
      "Aumenta o elimina el límite automático antes de reanudar.",
  },
  "pt-BR": {
    title: "Regras de parada e contexto",
    stopCondition: "Parar quando esta condição for atendida",
    stopHint:
      "O agente avalia o critério. O agendamento pausa após esta execução. Deixe em branco para desativar.",
    maxRuns: "Máximo de acionamentos automáticos",
    maxHint:
      "Em branco significa sem limite. Testes manuais não contam; despachos automáticos com falha contam uma vez.",
    freshTask: "Usar uma nova conversa a cada execução",
    freshHint:
      "Mantém as configurações do usuário e modelo sem copiar o histórico. Desativado, reutiliza a tarefa vinculada.",
    count: "{{count}} acionamentos automáticos",
    condition_met: "Condição de parada atendida",
    run_limit_reached: "Limite de execuções atingido",
    runLimitReached: "Aumente ou remova o limite automático antes de retomar.",
  },
  "fr-FR": {
    title: "Règles d’arrêt et contexte",
    stopCondition: "Arrêter lorsque cette condition est remplie",
    stopHint:
      "L’agent évalue ce critère. La planification s’arrête après l’exécution en cours. Laissez vide pour désactiver.",
    maxRuns: "Nombre maximal de déclenchements automatiques",
    maxHint:
      "Vide signifie illimité. Les essais manuels ne comptent pas ; un envoi automatique échoué compte une fois.",
    freshTask: "Utiliser une nouvelle conversation à chaque exécution",
    freshHint:
      "Conserve les réglages utilisateur et modèle sans copier l’historique. Sinon, réutilise la tâche liée.",
    count: "{{count}} déclenchements automatiques",
    condition_met: "Condition d’arrêt remplie",
    run_limit_reached: "Limite d’exécutions atteinte",
    runLimitReached:
      "Augmentez ou supprimez la limite automatique avant de reprendre.",
  },
  "ja-JP": {
    title: "終了条件とコンテキスト",
    stopCondition: "この条件を満たしたら終了",
    stopHint:
      "Agent が条件を判定します。今回の実行終了後に今後のスケジュールを停止します。空欄で無効になります。",
    maxRuns: "自動起動回数の上限",
    maxHint:
      "空欄は無制限です。手動テストは含めず、自動起動に失敗した場合も1回と数えます。",
    freshTask: "実行ごとに新しい会話を使用",
    freshHint:
      "ユーザーと選択したモデルの設定を維持し、過去の会話はコピーしません。オフの場合は紐づくタスクを再利用します。",
    count: "自動起動 {{count}} 回",
    condition_met: "終了条件を達成",
    run_limit_reached: "実行回数の上限に到達",
    runLimitReached:
      "再開する前に自動実行回数の上限を増やすか解除してください。",
  },
} as const
