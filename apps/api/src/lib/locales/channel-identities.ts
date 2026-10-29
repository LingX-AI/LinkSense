import type { Locale } from "@linksense/shared";
export const channelIdentityMessages: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    "botChannels.identity.linked":
      "已关联你的 LinkSense 账号，现在可以发送任务了。",
    "botChannels.identity.unlinked":
      "请先登录已有的 LinkSense 账号，在「消息渠道」中关联此渠道后再使用。未注册或已停用的账号无法发起任务。",
    "botChannels.identity.private_only":
      "这条确认消息已失效，请重新获取确认消息并在与机器人的私聊中发送。",
    "botChannels.identity.link_failed":
      "关联未完成。请在 LinkSense 的「消息渠道」中重新获取确认消息；如果已关联其他账号，请先解除原关联。",
  },
  "en-US": {
    "botChannels.identity.linked":
      "Your LinkSense account is linked. You can now send tasks.",
    "botChannels.identity.unlinked":
      "Sign in to an existing LinkSense account and link this channel in Message channels before using it. Unregistered or disabled accounts cannot start tasks.",
    "botChannels.identity.private_only":
      "This confirmation message is now invalid. Get a new one in LinkSense and send it in a private chat with the bot.",
    "botChannels.identity.link_failed":
      "Linking was not completed. Get a new confirmation message in LinkSense Message channels. If this identity is linked to another account, unlink it there first.",
  },
  "es-ES": {
    "botChannels.identity.linked":
      "Tu cuenta de LinkSense está vinculada. Ya puedes enviar tareas.",
    "botChannels.identity.unlinked":
      "Inicia sesión en una cuenta existente de LinkSense y vincula este canal en Canales de mensajes. Las cuentas no registradas o desactivadas no pueden iniciar tareas.",
    "botChannels.identity.private_only":
      "Este mensaje de confirmación ya no es válido. Obtén uno nuevo en LinkSense y envíalo al bot en un chat privado.",
    "botChannels.identity.link_failed":
      "No se completó la vinculación. Obtén un nuevo mensaje de confirmación en Canales de mensajes de LinkSense. Si esta identidad está vinculada a otra cuenta, desvincúlala allí primero.",
  },
  "pt-BR": {
    "botChannels.identity.linked":
      "Sua conta do LinkSense foi vinculada. Agora você pode enviar tarefas.",
    "botChannels.identity.unlinked":
      "Entre em uma conta existente do LinkSense e vincule este canal em Canais de mensagens. Contas não cadastradas ou desativadas não podem iniciar tarefas.",
    "botChannels.identity.private_only":
      "Esta mensagem de confirmação não é mais válida. Obtenha uma nova no LinkSense e envie ao bot em uma conversa privada.",
    "botChannels.identity.link_failed":
      "O vínculo não foi concluído. Obtenha uma nova mensagem de confirmação em Canais de mensagens do LinkSense. Se esta identidade estiver vinculada a outra conta, remova o vínculo nela primeiro.",
  },
  "fr-FR": {
    "botChannels.identity.linked":
      "Votre compte LinkSense est associé. Vous pouvez maintenant envoyer des tâches.",
    "botChannels.identity.unlinked":
      "Connectez-vous à un compte LinkSense existant, puis associez ce canal dans Canaux de messagerie. Les comptes non inscrits ou désactivés ne peuvent pas lancer de tâches.",
    "botChannels.identity.private_only":
      "Ce message de confirmation n’est plus valable. Obtenez-en un nouveau dans LinkSense et envoyez-le au bot dans une conversation privée.",
    "botChannels.identity.link_failed":
      "L’association n’a pas abouti. Obtenez un nouveau message de confirmation dans Canaux de messagerie de LinkSense. Si cette identité est associée à un autre compte, dissociez-la d’abord de ce compte.",
  },
  "ja-JP": {
    "botChannels.identity.linked":
      "LinkSense アカウントを連携しました。タスクを送信できます。",
    "botChannels.identity.unlinked":
      "登録済みの LinkSense アカウントでログインし、「メッセージチャネル」でこのチャネルを連携してください。未登録または無効化されたアカウントではタスクを開始できません。",
    "botChannels.identity.private_only":
      "この確認メッセージは無効になりました。LinkSense で再取得し、ボットとの個別チャットに送信してください。",
    "botChannels.identity.link_failed":
      "連携できませんでした。LinkSense の「メッセージチャネル」で確認メッセージを再取得してください。別のアカウントに連携済みの場合は、先にその連携を解除してください。",
  },
};
