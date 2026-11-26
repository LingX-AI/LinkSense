import type { Locale } from "@linksense/shared"

type DesktopActivityMessages = {
  title: string
  description: string
  emptyTitle: string
  emptyDescription: string
  loadFailed: string
  unavailable: string
  attempt: string
  attemptOutcome: string
  deliveryConfirmed: string
  deliveryUnconfirmed: string
  decision: string
  decisionAccept: string
  decisionDecline: string
  decisionCancel: string
  request: string
  requestStatus: string
  requestObserve: string
  requestAct: string
  requestWait: string
  action: string
  actionClick: string
  actionType: string
}

export const desktopActivityMessages: Record<Locale, DesktopActivityMessages> =
  {
    "zh-CN": {
      title: "最近的桌面活动",
      description: "显示此账号最近的桌面活动。",
      emptyTitle: "暂无桌面活动",
      emptyDescription: "此账号的桌面活动会显示在这里。",
      loadFailed: "无法加载最近的桌面活动。",
      unavailable: "当前服务器版本暂不提供桌面活动记录。",
      attempt: "尝试",
      attemptOutcome: "尝试结果：{{result}}",
      deliveryConfirmed: "送达已确认",
      deliveryUnconfirmed: "送达未确认",
      decision: "决定：{{decision}}",
      decisionAccept: "允许",
      decisionDecline: "拒绝",
      decisionCancel: "取消",
      request: "请求：{{request}}",
      requestStatus: "状态",
      requestObserve: "观察",
      requestAct: "操作",
      requestWait: "等待",
      action: "动作：{{action}}",
      actionClick: "点击",
      actionType: "键入",
    },
    "en-US": {
      title: "Recent desktop activity",
      description: "Recent desktop activity for this account.",
      emptyTitle: "No recent desktop activity",
      emptyDescription: "Desktop activity for this account will appear here.",
      loadFailed: "Could not load recent desktop activity.",
      unavailable:
        "Recent desktop activity isn’t available on this server version.",
      attempt: "Attempt",
      attemptOutcome: "Attempt result: {{result}}",
      deliveryConfirmed: "Delivery confirmed",
      deliveryUnconfirmed: "Delivery unconfirmed",
      decision: "Decision: {{decision}}",
      decisionAccept: "Allow",
      decisionDecline: "Deny",
      decisionCancel: "Cancel",
      request: "Request: {{request}}",
      requestStatus: "Status",
      requestObserve: "Observe",
      requestAct: "Act",
      requestWait: "Wait",
      action: "Action: {{action}}",
      actionClick: "Click",
      actionType: "Type",
    },
    "es-ES": {
      title: "Actividad reciente en el escritorio",
      description: "Actividad reciente del escritorio de esta cuenta.",
      emptyTitle: "No hay actividad reciente en el escritorio",
      emptyDescription:
        "La actividad de escritorio de esta cuenta aparecerá aquí.",
      loadFailed: "No se pudo cargar la actividad reciente del escritorio.",
      unavailable:
        "La actividad reciente del escritorio no está disponible en esta versión del servidor.",
      attempt: "Intento",
      attemptOutcome: "Resultado del intento: {{result}}",
      deliveryConfirmed: "Entrega confirmada",
      deliveryUnconfirmed: "Entrega no confirmada",
      decision: "Decisión: {{decision}}",
      decisionAccept: "Permitir",
      decisionDecline: "Denegar",
      decisionCancel: "Cancelar",
      request: "Solicitud: {{request}}",
      requestStatus: "Estado",
      requestObserve: "Observar",
      requestAct: "Actuar",
      requestWait: "Esperar",
      action: "Acción: {{action}}",
      actionClick: "Clic",
      actionType: "Escribir",
    },
    "pt-BR": {
      title: "Atividade recente do desktop",
      description: "Atividade recente do desktop desta conta.",
      emptyTitle: "Nenhuma atividade recente do desktop",
      emptyDescription: "A atividade de desktop desta conta aparecerá aqui.",
      loadFailed: "Não foi possível carregar a atividade recente do desktop.",
      unavailable:
        "A atividade recente do desktop não está disponível nesta versão do servidor.",
      attempt: "Tentativa",
      attemptOutcome: "Resultado da tentativa: {{result}}",
      deliveryConfirmed: "Entrega confirmada",
      deliveryUnconfirmed: "Entrega não confirmada",
      decision: "Decisão: {{decision}}",
      decisionAccept: "Permitir",
      decisionDecline: "Negar",
      decisionCancel: "Cancelar",
      request: "Solicitação: {{request}}",
      requestStatus: "Status",
      requestObserve: "Observar",
      requestAct: "Agir",
      requestWait: "Aguardar",
      action: "Ação: {{action}}",
      actionClick: "Clique",
      actionType: "Digitar",
    },
    "fr-FR": {
      title: "Activité récente du bureau",
      description: "Activité récente du bureau de ce compte.",
      emptyTitle: "Aucune activité récente du bureau",
      emptyDescription: "L’activité de bureau de ce compte apparaîtra ici.",
      loadFailed: "Impossible de charger l’activité récente du bureau.",
      unavailable:
        "L’activité récente du bureau n’est pas disponible dans cette version du serveur.",
      attempt: "Tentative",
      attemptOutcome: "Résultat de la tentative : {{result}}",
      deliveryConfirmed: "Transmission confirmée",
      deliveryUnconfirmed: "Transmission non confirmée",
      decision: "Décision : {{decision}}",
      decisionAccept: "Autoriser",
      decisionDecline: "Refuser",
      decisionCancel: "Annuler",
      request: "Demande : {{request}}",
      requestStatus: "État",
      requestObserve: "Observer",
      requestAct: "Agir",
      requestWait: "Attendre",
      action: "Action : {{action}}",
      actionClick: "Cliquer",
      actionType: "Saisir",
    },
    "ja-JP": {
      title: "最近のデスクトップアクティビティ",
      description: "このアカウントの最近のデスクトップアクティビティです。",
      emptyTitle: "最近のデスクトップアクティビティはありません",
      emptyDescription:
        "このアカウントのデスクトップアクティビティがここに表示されます。",
      loadFailed: "最近のデスクトップアクティビティを読み込めませんでした。",
      unavailable:
        "このサーバーバージョンでは最近のデスクトップアクティビティを利用できません。",
      attempt: "試行",
      attemptOutcome: "試行結果：{{result}}",
      deliveryConfirmed: "送信確認済み",
      deliveryUnconfirmed: "送信未確認",
      decision: "決定：{{decision}}",
      decisionAccept: "許可",
      decisionDecline: "拒否",
      decisionCancel: "キャンセル",
      request: "リクエスト：{{request}}",
      requestStatus: "ステータス",
      requestObserve: "観察",
      requestAct: "操作",
      requestWait: "待機",
      action: "アクション：{{action}}",
      actionClick: "クリック",
      actionType: "入力",
    },
  }
