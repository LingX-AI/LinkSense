import type { Locale } from "@linksense/shared"
export const automationNotificationMessages = {
  "zh-CN": {
    label: "结果通知发送到",
    description:
      "完成后发送通知和有限结果摘要。只可选择现有绑定中已验证的会话；群聊沿用渠道授权。关闭后取消待发通知。",
    none: "仅站内和浏览器通知",
    unavailable: "原接收会话已不可用，请重新选择或关闭",
    empty: "请先连接 IM，并通过该渠道发送一条消息。",
  },
  "en-US": {
    label: "Send result notices to",
    description:
      "Send a notice and a short result summary after completion. Choose a verified conversation from an existing connection; group permissions still apply. Turning this off cancels queued notices.",
    none: "In-app and browser notifications only",
    unavailable:
      "The saved conversation is unavailable. Choose another or turn notices off.",
    empty: "Connect an IM account and send it a message first.",
  },
  "es-ES": {
    label: "Enviar avisos de resultados a",
    description:
      "Envía un aviso y un breve resumen al finalizar. Elige una conversación verificada de una conexión existente; se respetan los permisos de grupo. Desactivarlo cancela los avisos pendientes.",
    none: "Solo avisos en la aplicación y el navegador",
    unavailable:
      "La conversación guardada no está disponible. Elige otra o desactiva los avisos.",
    empty: "Conecta una cuenta de mensajería y envíale un mensaje primero.",
  },
  "pt-BR": {
    label: "Enviar avisos de resultados para",
    description:
      "Envie um aviso e um breve resumo ao concluir. Escolha uma conversa verificada de uma conexão existente; as permissões de grupo continuam válidas. Desativar cancela os avisos pendentes.",
    none: "Somente notificações no aplicativo e navegador",
    unavailable:
      "A conversa salva não está disponível. Escolha outra ou desative os avisos.",
    empty: "Conecte uma conta de mensagens e envie uma mensagem primeiro.",
  },
  "fr-FR": {
    label: "Envoyer les résultats à",
    description:
      "Envoyez un avis et un bref résumé après exécution. Choisissez une conversation vérifiée d’une connexion existante ; les autorisations de groupe restent applicables. La désactivation annule les avis en attente.",
    none: "Notifications dans l’application et le navigateur uniquement",
    unavailable:
      "La conversation enregistrée est indisponible. Choisissez-en une autre ou désactivez les avis.",
    empty:
      "Connectez un compte de messagerie et envoyez-lui d’abord un message.",
  },
  "ja-JP": {
    label: "結果通知の送信先",
    description:
      "完了後に通知と短い結果要約を送信します。既存の接続で確認済みの会話のみ選択でき、グループの権限も適用されます。無効にすると未送信の通知は取り消されます。",
    none: "アプリ内・ブラウザー通知のみ",
    unavailable:
      "保存された会話を利用できません。別の会話を選ぶか通知を無効にしてください。",
    empty:
      "IM アカウントを接続し、そのチャネルからメッセージを送ってください。",
  },
} satisfies Record<Locale, Record<string, string>>
