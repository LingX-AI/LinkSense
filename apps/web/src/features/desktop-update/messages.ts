import type { Locale } from "@linksense/shared"

type UpdateMessages = {
  title: string
  check: string
  attachmentRequired: string
  available: string
  current: string
  unavailable: string
  failed: string
}

export const desktopUpdateMessages: Record<Locale, UpdateMessages> = {
  "zh-CN": {
    title: "客户端更新",
    check: "检查更新",
    attachmentRequired:
      "请更新运行此任务的 Mac 上的 LinkSense 以发送附件。移除附件后仍可发送文字。",
    available: "有新版本 {{version}}。请向管理员获取安装包。",
    current: "客户端已是最新版。",
    unavailable: "此安装包不支持检查更新。请联系管理员。",
    failed: "无法检查更新。请稍后重试。",
  },
  "en-US": {
    title: "Desktop updates",
    check: "Check for updates",
    attachmentRequired:
      "Update LinkSense on the Mac running this task to send attachments. You can still send text after removing the attachments.",
    available:
      "Version {{version}} is available. Contact your administrator for the installer.",
    current: "The desktop app is up to date.",
    unavailable:
      "This installation cannot check for updates. Contact your administrator.",
    failed: "Could not check for updates. Try again later.",
  },
  "es-ES": {
    title: "Actualizaciones de la aplicación",
    check: "Buscar actualizaciones",
    attachmentRequired:
      "Actualiza LinkSense en el Mac que ejecuta esta tarea para enviar archivos adjuntos. Puedes seguir enviando texto si quitas los archivos.",
    available:
      "La versión {{version}} está disponible. Solicita el instalador a tu administrador.",
    current: "La aplicación está actualizada.",
    unavailable:
      "Esta instalación no puede buscar actualizaciones. Contacta con tu administrador.",
    failed: "No se pudieron buscar actualizaciones. Inténtalo más tarde.",
  },
  "pt-BR": {
    title: "Atualizações do aplicativo",
    check: "Verificar atualizações",
    attachmentRequired:
      "Atualize o LinkSense no Mac que executa esta tarefa para enviar anexos. Remova os anexos para enviar apenas texto.",
    available:
      "A versão {{version}} está disponível. Solicite o instalador ao administrador.",
    current: "O aplicativo está atualizado.",
    unavailable:
      "Esta instalação não consegue verificar atualizações. Fale com o administrador.",
    failed:
      "Não foi possível verificar atualizações. Tente novamente mais tarde.",
  },
  "fr-FR": {
    title: "Mises à jour de l’application",
    check: "Rechercher des mises à jour",
    attachmentRequired:
      "Mettez à jour LinkSense sur le Mac qui exécute cette tâche pour envoyer des pièces jointes. Vous pouvez toujours envoyer du texte en retirant les pièces jointes.",
    available:
      "La version {{version}} est disponible. Demandez le programme d’installation à votre administrateur.",
    current: "L’application est à jour.",
    unavailable:
      "Cette installation ne peut pas rechercher de mises à jour. Contactez votre administrateur.",
    failed: "Impossible de rechercher des mises à jour. Réessayez plus tard.",
  },
  "ja-JP": {
    title: "アプリの更新",
    check: "更新を確認",
    attachmentRequired:
      "添付ファイルを送信するには、このタスクを実行する Mac の LinkSense を更新してください。添付ファイルを削除すればテキストは送信できます。",
    available:
      "バージョン {{version}} が利用できます。管理者からインストーラーを入手してください。",
    current: "アプリは最新バージョンです。",
    unavailable:
      "このインストールでは更新を確認できません。管理者にお問い合わせください。",
    failed: "更新を確認できませんでした。しばらくしてから再試行してください。",
  },
}
