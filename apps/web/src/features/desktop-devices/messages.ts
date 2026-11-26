import type { Locale } from "@linksense/shared"

type DesktopDevicesMessages = {
  title: string
  description: string
  statusDisabled: string
  statusPreparing: string
  statusConnecting: string
  statusOnline: string
  statusOffline: string
  statusRevoked: string
  statusRevokedHint: string
  statusUnavailable: string
  toggleLabel: string
  toggleDescription: string
  toggleFailed: string
  toggleDescriptionDisabled: string
  signOutRevoke: string
  signOutRevokeFailed: string
  signOutRevokeUnconfirmed: string
  signOutDeviceChanged: string
}

export const desktopDevicesMessages = {
  "zh-CN": {
    title: "本机工具",
    description:
      "云端任务可以按任务使用这台 Mac 的文件、窗口和浏览器。每次使用都需要在任务中明确授权。",
    statusDisabled: "已停用",
    statusPreparing: "正在准备",
    statusConnecting: "正在连接",
    statusOnline: "已连接",
    statusOffline: "离线",
    statusRevoked: "已停用",
    statusRevokedHint: "本机工具已在此 Mac 上停用。打开下方开关即可重新启用。",
    statusUnavailable: "无法读取本机工具状态。",
    toggleLabel: "允许云端任务使用本机工具",
    toggleDescription:
      "开启后，这台 Mac 会在登录后自动连接。关闭后立即断开，且不会在下次启动时自动恢复。",
    toggleFailed: "无法更新本机工具设置。请重试。",
    toggleDescriptionDisabled:
      "这台 Mac 当前不会连接。重新开启会清除此前的停用状态，并在登录后自动连接。",
    signOutRevoke: "同时撤销这台 Mac 的授权",
    signOutRevokeFailed:
      "无法确认已撤销这台 Mac 的授权。请重试，或取消勾选后只退出登录。",
    signOutRevokeUnconfirmed:
      "之前的撤销结果尚未确认。退出登录不会再次尝试撤销。",
    signOutDeviceChanged:
      "这台 Mac 的本机工具状态已变更。请重新选择，或只退出登录。",
  },
  "en-US": {
    title: "Local tools",
    description:
      "Cloud tasks can use this Mac’s files, windows, and browser when a task explicitly allows it.",
    statusDisabled: "Disabled",
    statusPreparing: "Preparing",
    statusConnecting: "Connecting",
    statusOnline: "Connected",
    statusOffline: "Offline",
    statusRevoked: "Disabled",
    statusRevokedHint:
      "Local tools are disabled on this Mac. Turn on the switch below to re-enable them.",
    statusUnavailable: "Could not read the local-tools status.",
    toggleLabel: "Allow cloud tasks to use local tools",
    toggleDescription:
      "When on, this Mac connects automatically after sign-in. Turning it off disconnects now and stays off after the next launch.",
    toggleFailed: "Could not update the local-tools setting. Try again.",
    toggleDescriptionDisabled:
      "This Mac is not connected. Turning it back on clears the earlier disabled state and connects automatically after sign-in.",
    signOutRevoke: "Also revoke access for this Mac",
    signOutRevokeFailed:
      "Could not confirm that access was revoked for this Mac. Try again, or uncheck the option to just sign out.",
    signOutRevokeUnconfirmed:
      "The previous revocation was not confirmed. Signing out will not retry it.",
    signOutDeviceChanged:
      "This Mac’s local-tools status has changed. Make a new selection, or just sign out.",
  },
  "es-ES": {
    title: "Herramientas locales",
    description:
      "Las tareas en la nube pueden usar los archivos, las ventanas y el navegador de este Mac cuando una tarea lo autoriza explícitamente.",
    statusDisabled: "Desactivadas",
    statusPreparing: "Preparando",
    statusConnecting: "Conectando",
    statusOnline: "Conectadas",
    statusOffline: "Sin conexión",
    statusRevoked: "Desactivadas",
    statusRevokedHint:
      "Las herramientas locales están desactivadas en este Mac. Activa el interruptor de abajo para volver a habilitarlas.",
    statusUnavailable: "No se pudo leer el estado de las herramientas locales.",
    toggleLabel: "Permitir que las tareas en la nube usen herramientas locales",
    toggleDescription:
      "Cuando está activado, este Mac se conecta automáticamente tras iniciar sesión. Al desactivarlo se desconecta ahora y permanece así en el próximo inicio.",
    toggleFailed:
      "No se pudo actualizar la configuración de herramientas locales. Inténtalo de nuevo.",
    toggleDescriptionDisabled:
      "Este Mac no está conectado. Volver a activarlas borra el estado desactivado anterior y conecta automáticamente tras iniciar sesión.",
    signOutRevoke: "Revocar también el acceso de este Mac",
    signOutRevokeFailed:
      "No se pudo confirmar la revocación del acceso de este Mac. Inténtalo de nuevo o desmarca la opción para cerrar sesión sin repetir la revocación.",
    signOutRevokeUnconfirmed:
      "La revocación anterior no se ha confirmado. Al cerrar sesión no se volverá a intentar.",
    signOutDeviceChanged:
      "Cambió el estado de las herramientas locales de este Mac. Vuelve a elegir o cierra sesión sin revocar el acceso.",
  },
  "pt-BR": {
    title: "Ferramentas locais",
    description:
      "Tarefas na nuvem podem usar os arquivos, as janelas e o navegador deste Mac quando a tarefa permitir explicitamente.",
    statusDisabled: "Desativadas",
    statusPreparing: "Preparando",
    statusConnecting: "Conectando",
    statusOnline: "Conectadas",
    statusOffline: "Offline",
    statusRevoked: "Desativadas",
    statusRevokedHint:
      "As ferramentas locais estão desativadas neste Mac. Ative o botão abaixo para habilitá-las novamente.",
    statusUnavailable: "Não foi possível ler o status das ferramentas locais.",
    toggleLabel: "Permitir que tarefas na nuvem usem ferramentas locais",
    toggleDescription:
      "Quando ativado, este Mac se conecta automaticamente após o login. Ao desativar, a conexão é encerrada agora e permanece assim no próximo início.",
    toggleFailed:
      "Não foi possível atualizar a configuração de ferramentas locais. Tente novamente.",
    toggleDescriptionDisabled:
      "Este Mac não está conectado. Reativar remove o estado desativado anterior e conecta automaticamente após o login.",
    signOutRevoke: "Revogar também o acesso deste Mac",
    signOutRevokeFailed:
      "Não foi possível confirmar a revogação do acesso deste Mac. Tente novamente ou desmarque a opção para apenas sair.",
    signOutRevokeUnconfirmed:
      "A revogação anterior não foi confirmada. Sair da conta não fará outra tentativa.",
    signOutDeviceChanged:
      "O estado das ferramentas locais deste Mac mudou. Faça uma nova seleção ou apenas saia.",
  },
  "fr-FR": {
    title: "Outils locaux",
    description:
      "Les tâches cloud peuvent utiliser les fichiers, les fenêtres et le navigateur de ce Mac lorsqu’une tâche l’autorise explicitement.",
    statusDisabled: "Désactivés",
    statusPreparing: "Préparation",
    statusConnecting: "Connexion",
    statusOnline: "Connectés",
    statusOffline: "Hors ligne",
    statusRevoked: "Désactivés",
    statusRevokedHint:
      "Les outils locaux sont désactivés sur ce Mac. Activez l’interrupteur ci-dessous pour les réactiver.",
    statusUnavailable: "Impossible de lire l’état des outils locaux.",
    toggleLabel: "Autoriser les tâches cloud à utiliser les outils locaux",
    toggleDescription:
      "Lorsque cette option est activée, ce Mac se connecte automatiquement après la connexion. La désactiver coupe la connexion maintenant et la maintient coupée au prochain démarrage.",
    toggleFailed:
      "Impossible de mettre à jour le réglage des outils locaux. Réessayez.",
    toggleDescriptionDisabled:
      "Ce Mac n’est pas connecté. La réactivation efface l’état désactivé précédent et reconnecte automatiquement après la connexion.",
    signOutRevoke: "Révoquer aussi l’accès de ce Mac",
    signOutRevokeFailed:
      "Impossible de confirmer la révocation de l’accès de ce Mac. Réessayez ou décochez l’option pour simplement vous déconnecter.",
    signOutRevokeUnconfirmed:
      "La révocation précédente n’a pas été confirmée. Vous déconnecter ne relancera pas la révocation.",
    signOutDeviceChanged:
      "L’état des outils locaux de ce Mac a changé. Faites un nouveau choix ou déconnectez-vous simplement.",
  },
  "ja-JP": {
    title: "ローカルツール",
    description:
      "クラウドタスクは、タスクで明示的に許可された場合に、この Mac のファイル、ウィンドウ、ブラウザを使用できます。",
    statusDisabled: "無効",
    statusPreparing: "準備中",
    statusConnecting: "接続中",
    statusOnline: "接続済み",
    statusOffline: "オフライン",
    statusRevoked: "無効",
    statusRevokedHint:
      "この Mac ではローカルツールが無効になっています。下のスイッチをオンにすると再度有効になります。",
    statusUnavailable: "ローカルツールの状態を読み取れませんでした。",
    toggleLabel: "クラウドタスクにローカルツールの使用を許可する",
    toggleDescription:
      "オンにすると、この Mac はログイン後に自動で接続します。オフにすると現在の接続を切断し、次回起動時もオフのままになります。",
    toggleFailed:
      "ローカルツールの設定を更新できませんでした。もう一度お試しください。",
    toggleDescriptionDisabled:
      "この Mac は接続されていません。再度有効にすると以前の無効状態が解除され、ログイン後に自動で接続します。",
    signOutRevoke: "この Mac のアクセス権も取り消す",
    signOutRevokeFailed:
      "この Mac のアクセス権が取り消されたことを確認できませんでした。もう一度お試しいただくか、チェックを外してログアウトのみ行ってください。",
    signOutRevokeUnconfirmed:
      "前回の取り消しは確認できていません。ログアウトしても取り消しは再試行されません。",
    signOutDeviceChanged:
      "この Mac のローカルツールの状態が変わりました。選び直すか、ログアウトのみ行ってください。",
  },
} satisfies Record<Locale, DesktopDevicesMessages>
