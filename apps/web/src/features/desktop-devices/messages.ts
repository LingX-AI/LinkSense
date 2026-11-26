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
  foldersTitle: string
  foldersDescription: string
  foldersEmpty: string
  addFolder: string
  addFolderMode: string
  folderModeLabel: string
  modeRead: string
  modeWrite: string
  removeFolder: string
  removeFolderTitle: string
  removeFolderDescription: string
  removeFolderConfirm: string
  removeFolderCancel: string
  folderAccessHint: string
  foldersUnavailable: string
  folderAddFailed: string
  folderRemoveFailed: string
  folderModeFailed: string
  desktopPermissionTitle: string
  desktopPermissionDescription: string
  desktopPermissionGranted: string
  desktopPermissionMissing: string
  desktopPermissionUnavailable: string
  desktopPermissionAction: string
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
    foldersTitle: "共享文件夹",
    foldersDescription:
      "云端任务只能使用你在这里共享的文件夹，并且需要任务明确允许使用本机工具。",
    foldersEmpty: "尚未共享任何文件夹。",
    addFolder: "添加文件夹",
    addFolderMode: "新文件夹权限",
    folderModeLabel: "访问权限",
    modeRead: "只读",
    modeWrite: "读写",
    removeFolder: "移除文件夹",
    removeFolderTitle: "移除共享文件夹？",
    removeFolderDescription:
      "云端任务会立即失去对“{{name}}”的访问权限，文件夹本身不会被修改。",
    removeFolderConfirm: "移除",
    removeFolderCancel: "取消",
    folderAccessHint: "文件夹的绝对路径只保留在这台 Mac 上，不会上传。",
    foldersUnavailable: "无法加载共享文件夹。",
    folderAddFailed: "无法添加文件夹，请重试。",
    folderRemoveFailed: "无法移除文件夹，请重试。",
    folderModeFailed: "无法修改文件夹权限，请重试。",
    desktopPermissionTitle: "桌面控制权限",
    desktopPermissionDescription:
      "云端任务操作本机窗口前，需要 macOS 的辅助功能权限。授权后不会自动选择窗口。",
    desktopPermissionGranted: "已授权",
    desktopPermissionMissing: "需要授权",
    desktopPermissionUnavailable: "不可用",
    desktopPermissionAction: "检查并授权",
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
    foldersTitle: "Shared folders",
    foldersDescription:
      "Cloud tasks can use only the folders you share here, and only when a task allows local tools.",
    foldersEmpty: "No folders shared yet.",
    addFolder: "Add folder",
    addFolderMode: "New folder access",
    folderModeLabel: "Access",
    modeRead: "Read only",
    modeWrite: "Read and write",
    removeFolder: "Remove folder",
    removeFolderTitle: "Remove shared folder?",
    removeFolderDescription:
      "Cloud tasks will immediately lose access to “{{name}}”. The folder itself is not changed.",
    removeFolderConfirm: "Remove",
    removeFolderCancel: "Cancel",
    folderAccessHint: "Absolute paths stay on this Mac and are never uploaded.",
    foldersUnavailable: "Could not load shared folders.",
    folderAddFailed: "Could not add the folder. Try again.",
    folderRemoveFailed: "Could not remove the folder. Try again.",
    folderModeFailed: "Could not change folder access. Try again.",
    desktopPermissionTitle: "Desktop control permission",
    desktopPermissionDescription:
      "macOS Accessibility permission is required before a cloud task can act on a local window. Granting it does not select a window.",
    desktopPermissionGranted: "Granted",
    desktopPermissionMissing: "Permission needed",
    desktopPermissionUnavailable: "Unavailable",
    desktopPermissionAction: "Check and grant",
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
    foldersTitle: "Carpetas compartidas",
    foldersDescription:
      "Las tareas en la nube solo pueden usar las carpetas que compartas aquí y cuando la tarea permita herramientas locales.",
    foldersEmpty: "Aún no hay carpetas compartidas.",
    addFolder: "Añadir carpeta",
    addFolderMode: "Acceso de la nueva carpeta",
    folderModeLabel: "Acceso",
    modeRead: "Solo lectura",
    modeWrite: "Lectura y escritura",
    removeFolder: "Quitar carpeta",
    removeFolderTitle: "¿Quitar la carpeta compartida?",
    removeFolderDescription:
      "Las tareas en la nube perderán inmediatamente el acceso a «{{name}}». La carpeta no se modifica.",
    removeFolderConfirm: "Quitar",
    removeFolderCancel: "Cancelar",
    folderAccessHint: "Las rutas absolutas permanecen en este Mac y nunca se suben.",
    foldersUnavailable: "No se pudieron cargar las carpetas compartidas.",
    folderAddFailed: "No se pudo añadir la carpeta. Inténtalo de nuevo.",
    folderRemoveFailed: "No se pudo quitar la carpeta. Inténtalo de nuevo.",
    folderModeFailed: "No se pudo cambiar el acceso. Inténtalo de nuevo.",
    desktopPermissionTitle: "Permiso de control del escritorio",
    desktopPermissionDescription:
      "Se requiere el permiso de Accesibilidad de macOS para que una tarea en la nube actúe en una ventana local. Concederlo no selecciona ninguna ventana.",
    desktopPermissionGranted: "Concedido",
    desktopPermissionMissing: "Falta el permiso",
    desktopPermissionUnavailable: "No disponible",
    desktopPermissionAction: "Comprobar y conceder",
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
    foldersTitle: "Pastas compartilhadas",
    foldersDescription:
      "Tarefas na nuvem só podem usar as pastas compartilhadas aqui e quando a tarefa permitir ferramentas locais.",
    foldersEmpty: "Nenhuma pasta compartilhada ainda.",
    addFolder: "Adicionar pasta",
    addFolderMode: "Acesso da nova pasta",
    folderModeLabel: "Acesso",
    modeRead: "Somente leitura",
    modeWrite: "Leitura e escrita",
    removeFolder: "Remover pasta",
    removeFolderTitle: "Remover pasta compartilhada?",
    removeFolderDescription:
      "As tarefas na nuvem perderão imediatamente o acesso a “{{name}}”. A pasta em si não é alterada.",
    removeFolderConfirm: "Remover",
    removeFolderCancel: "Cancelar",
    folderAccessHint: "Os caminhos absolutos ficam neste Mac e nunca são enviados.",
    foldersUnavailable: "Não foi possível carregar as pastas compartilhadas.",
    folderAddFailed: "Não foi possível adicionar a pasta. Tente novamente.",
    folderRemoveFailed: "Não foi possível remover a pasta. Tente novamente.",
    folderModeFailed: "Não foi possível alterar o acesso. Tente novamente.",
    desktopPermissionTitle: "Permissão de controle da área de trabalho",
    desktopPermissionDescription:
      "A permissão de Acessibilidade do macOS é necessária para uma tarefa na nuvem agir em uma janela local. Concedê-la não seleciona uma janela.",
    desktopPermissionGranted: "Concedida",
    desktopPermissionMissing: "Permissão necessária",
    desktopPermissionUnavailable: "Indisponível",
    desktopPermissionAction: "Verificar e conceder",
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
    foldersTitle: "Dossiers partagés",
    foldersDescription:
      "Les tâches cloud ne peuvent utiliser que les dossiers partagés ici, et uniquement lorsqu’une tâche autorise les outils locaux.",
    foldersEmpty: "Aucun dossier partagé pour l’instant.",
    addFolder: "Ajouter un dossier",
    addFolderMode: "Accès du nouveau dossier",
    folderModeLabel: "Accès",
    modeRead: "Lecture seule",
    modeWrite: "Lecture et écriture",
    removeFolder: "Retirer le dossier",
    removeFolderTitle: "Retirer le dossier partagé ?",
    removeFolderDescription:
      "Les tâches cloud perdront immédiatement l’accès à « {{name}} ». Le dossier lui-même n’est pas modifié.",
    removeFolderConfirm: "Retirer",
    removeFolderCancel: "Annuler",
    folderAccessHint: "Les chemins absolus restent sur ce Mac et ne sont jamais envoyés.",
    foldersUnavailable: "Impossible de charger les dossiers partagés.",
    folderAddFailed: "Impossible d’ajouter le dossier. Réessayez.",
    folderRemoveFailed: "Impossible de retirer le dossier. Réessayez.",
    folderModeFailed: "Impossible de modifier l’accès. Réessayez.",
    desktopPermissionTitle: "Autorisation de contrôle du bureau",
    desktopPermissionDescription:
      "L’autorisation Accessibilité de macOS est requise pour qu’une tâche cloud agisse sur une fenêtre locale. L’accorder ne sélectionne aucune fenêtre.",
    desktopPermissionGranted: "Accordée",
    desktopPermissionMissing: "Autorisation requise",
    desktopPermissionUnavailable: "Indisponible",
    desktopPermissionAction: "Vérifier et accorder",
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
    foldersTitle: "共有フォルダー",
    foldersDescription:
      "クラウドタスクは、ここで共有したフォルダーのみ使用でき、タスクでローカルツールが許可されている場合に限ります。",
    foldersEmpty: "共有フォルダーはまだありません。",
    addFolder: "フォルダーを追加",
    addFolderMode: "新しいフォルダーのアクセス",
    folderModeLabel: "アクセス",
    modeRead: "読み取りのみ",
    modeWrite: "読み取りと書き込み",
    removeFolder: "フォルダーを削除",
    removeFolderTitle: "共有フォルダーを削除しますか？",
    removeFolderDescription:
      "クラウドタスクは「{{name}}」へのアクセスをすぐに失います。フォルダー自体は変更されません。",
    removeFolderConfirm: "削除",
    removeFolderCancel: "キャンセル",
    folderAccessHint: "絶対パスはこの Mac にのみ保持され、アップロードされません。",
    foldersUnavailable: "共有フォルダーを読み込めませんでした。",
    folderAddFailed: "フォルダーを追加できませんでした。もう一度お試しください。",
    folderRemoveFailed: "フォルダーを削除できませんでした。もう一度お試しください。",
    folderModeFailed: "アクセスを変更できませんでした。もう一度お試しください。",
    desktopPermissionTitle: "デスクトップ操作の権限",
    desktopPermissionDescription:
      "クラウドタスクがローカルウィンドウを操作するには、macOS のアクセシビリティ権限が必要です。許可してもウィンドウは選択されません。",
    desktopPermissionGranted: "許可済み",
    desktopPermissionMissing: "権限が必要",
    desktopPermissionUnavailable: "利用不可",
    desktopPermissionAction: "確認して許可",
    signOutRevoke: "この Mac のアクセス権も取り消す",
    signOutRevokeFailed:
      "この Mac のアクセス権が取り消されたことを確認できませんでした。もう一度お試しいただくか、チェックを外してログアウトのみ行ってください。",
    signOutRevokeUnconfirmed:
      "前回の取り消しは確認できていません。ログアウトしても取り消しは再試行されません。",
    signOutDeviceChanged:
      "この Mac のローカルツールの状態が変わりました。選び直すか、ログアウトのみ行ってください。",
  },
} satisfies Record<Locale, DesktopDevicesMessages>
