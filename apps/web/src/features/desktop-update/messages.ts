import type { Locale } from "@linksense/shared"

type UpdateMessages = {
  title: string
  check: string
  attachmentRequired: string
  available: string
  current: string
  unavailable: string
  failed: string
  checking: string
  updateAvailable: string
  install: string
  installing: string
  openInstaller: string
  restart: string
  restartFailed: string
  installerFailed: string
  busy: string
  downloading: string
  preparing: string
  staged: string
  installFailed: string
  channel: string
  channelStable: string
  channelBeta: string
  channelBetaUnavailable: string
  channelFailed: string
  progressLabel: string
  noticeAction: string
  releaseNotes: string
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
    checking: "正在检查更新…",
    updateAvailable: "有新版本 {{version}} 可用。",
    install: "安装更新",
    installing: "正在安装…",
    openInstaller: "打开安装页面",
    restart: "重启以完成更新",
    restartFailed: "无法重启应用。请退出并重新打开 LinkSense 以完成更新。",
    installerFailed: "无法打开安装页面。请稍后重试。",
    busy: "这台 Mac 上正在运行本地任务。请先完成或停止该任务，再安装更新。",
    downloading: "正在下载更新…",
    preparing: "正在准备更新…",
    staged: "更新已就绪。重启 LinkSense 即可完成更新。",
    installFailed: "无法安装更新。请重试。",
    channel: "更新渠道",
    channelStable: "稳定版",
    channelBeta: "测试版",
    channelBetaUnavailable: "此安装没有可用的测试版。",
    channelFailed: "无法更改更新渠道。请重试。",
    progressLabel: "更新下载进度",
    noticeAction: "有可用更新",
    releaseNotes: "发布说明",
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
    checking: "Checking for updates…",
    updateAvailable: "Version {{version}} is available.",
    install: "Install update",
    installing: "Installing…",
    openInstaller: "Open installer page",
    restart: "Restart to update",
    restartFailed:
      "Could not restart the app. Quit and reopen LinkSense to finish updating.",
    installerFailed: "Could not open the installer page. Try again later.",
    busy: "A local task is running on this Mac. Finish or stop it before installing the update.",
    downloading: "Downloading the update…",
    preparing: "Preparing the update…",
    staged: "The update is ready. Restart LinkSense to finish updating.",
    installFailed: "The update could not be installed. Try again.",
    channel: "Update channel",
    channelStable: "Stable",
    channelBeta: "Beta",
    channelBetaUnavailable:
      "Beta versions are not available for this installation.",
    channelFailed: "Could not change the update channel. Try again.",
    progressLabel: "Update download progress",
    noticeAction: "Update available",
    releaseNotes: "Release notes",
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
    checking: "Buscando actualizaciones…",
    updateAvailable: "La versión {{version}} está disponible.",
    install: "Instalar actualización",
    installing: "Instalando…",
    openInstaller: "Abrir página del instalador",
    restart: "Reiniciar para actualizar",
    restartFailed:
      "No se pudo reiniciar la aplicación. Sal y vuelve a abrir LinkSense para terminar la actualización.",
    installerFailed:
      "No se pudo abrir la página del instalador. Inténtalo más tarde.",
    busy: "Hay una tarea local en ejecución en este Mac. Termínala o detenla antes de instalar la actualización.",
    downloading: "Descargando la actualización…",
    preparing: "Preparando la actualización…",
    staged: "La actualización está lista. Reinicia LinkSense para terminar.",
    installFailed: "No se pudo instalar la actualización. Inténtalo de nuevo.",
    channel: "Canal de actualizaciones",
    channelStable: "Estable",
    channelBeta: "Beta",
    channelBetaUnavailable:
      "No hay versiones beta disponibles para esta instalación.",
    channelFailed:
      "No se pudo cambiar el canal de actualizaciones. Inténtalo de nuevo.",
    progressLabel: "Progreso de descarga de la actualización",
    noticeAction: "Actualización disponible",
    releaseNotes: "Notas de la versión",
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
    checking: "Verificando atualizações…",
    updateAvailable: "A versão {{version}} está disponível.",
    install: "Instalar atualização",
    installing: "Instalando…",
    openInstaller: "Abrir página do instalador",
    restart: "Reiniciar para atualizar",
    restartFailed:
      "Não foi possível reiniciar o aplicativo. Saia e abra o LinkSense novamente para concluir a atualização.",
    installerFailed:
      "Não foi possível abrir a página do instalador. Tente novamente mais tarde.",
    busy: "Há uma tarefa local em execução neste Mac. Conclua ou pare a tarefa antes de instalar a atualização.",
    downloading: "Baixando a atualização…",
    preparing: "Preparando a atualização…",
    staged: "A atualização está pronta. Reinicie o LinkSense para concluir.",
    installFailed: "Não foi possível instalar a atualização. Tente novamente.",
    channel: "Canal de atualizações",
    channelStable: "Estável",
    channelBeta: "Beta",
    channelBetaUnavailable:
      "Não há versões beta disponíveis para esta instalação.",
    channelFailed:
      "Não foi possível alterar o canal de atualizações. Tente novamente.",
    progressLabel: "Progresso do download da atualização",
    noticeAction: "Atualização disponível",
    releaseNotes: "Notas da versão",
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
    checking: "Recherche de mises à jour…",
    updateAvailable: "La version {{version}} est disponible.",
    install: "Installer la mise à jour",
    installing: "Installation…",
    openInstaller: "Ouvrir la page d’installation",
    restart: "Redémarrer pour mettre à jour",
    restartFailed:
      "Impossible de redémarrer l’application. Quittez puis rouvrez LinkSense pour terminer la mise à jour.",
    installerFailed:
      "Impossible d’ouvrir la page d’installation. Réessayez plus tard.",
    busy: "Une tâche locale est en cours sur ce Mac. Terminez-la ou arrêtez-la avant d’installer la mise à jour.",
    downloading: "Téléchargement de la mise à jour…",
    preparing: "Préparation de la mise à jour…",
    staged: "La mise à jour est prête. Redémarrez LinkSense pour terminer.",
    installFailed: "Impossible d’installer la mise à jour. Réessayez.",
    channel: "Canal de mise à jour",
    channelStable: "Stable",
    channelBeta: "Bêta",
    channelBetaUnavailable:
      "Aucune version bêta n’est disponible pour cette installation.",
    channelFailed: "Impossible de modifier le canal de mise à jour. Réessayez.",
    progressLabel: "Progression du téléchargement de la mise à jour",
    noticeAction: "Mise à jour disponible",
    releaseNotes: "Notes de version",
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
    checking: "更新を確認しています…",
    updateAvailable: "バージョン {{version}} が利用可能です。",
    install: "更新をインストール",
    installing: "インストール中…",
    openInstaller: "インストーラーページを開く",
    restart: "再起動して更新",
    restartFailed:
      "アプリを再起動できませんでした。LinkSense を終了して再度開き、更新を完了してください。",
    installerFailed:
      "インストーラーページを開けませんでした。しばらくしてから再試行してください。",
    busy: "この Mac でローカルタスクが実行中です。タスクを完了または停止してから更新をインストールしてください。",
    downloading: "更新をダウンロードしています…",
    preparing: "更新を準備しています…",
    staged: "更新の準備ができました。LinkSense を再起動して完了してください。",
    installFailed: "更新をインストールできませんでした。再試行してください。",
    channel: "更新チャネル",
    channelStable: "安定版",
    channelBeta: "ベータ版",
    channelBetaUnavailable: "このインストールではベータ版を利用できません。",
    channelFailed: "更新チャネルを変更できませんでした。再試行してください。",
    progressLabel: "更新のダウンロード進行状況",
    noticeAction: "更新が利用可能",
    releaseNotes: "リリースノート",
  },
}
