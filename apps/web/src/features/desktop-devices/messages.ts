import type { Locale } from "@linksense/shared"

type DesktopDevicesMessages = {
  title: string
  description: string
  statusUnpaired: string
  statusConnecting: string
  statusOnline: string
  statusOffline: string
  statusRevoked: string
  statusRevokedHint: string
  statusUnavailable: string
  executionReady: string
  executionNotReady: string
  pairTitle: string
  pairDescription: string
  pairNameLabel: string
  pairNameHint: string
  pairNamePlaceholder: string
  pairNameRequired: string
  pairNameInvalid: string
  pairAction: string
  pairing: string
  pairFailed: string
  devicesTitle: string
  devicesDescription: string
  devicesEmptyTitle: string
  devicesEmptyDescription: string
  devicesLoadFailed: string
  thisMac: string
  appVersion: string
  lastSeen: string
  neverSeen: string
  platformDarwin: string
  platformWindows: string
  rename: string
  renameTitle: string
  renameDescription: string
  renameNameLabel: string
  renameNameHint: string
  renameFailed: string
  revoke: string
  revokeTitle: string
  revokeDescription: string
  revokeConfirm: string
  revoking: string
  revokeFailed: string
  signOutRevoke: string
  signOutRevokeFailed: string
  signOutRevokeUnconfirmed: string
  signOutDeviceChanged: string
}

export const desktopDevicesMessages = {
  "zh-CN": {
    title: "这台 Mac",
    description:
      "将这台 Mac 配对到你的账号后即可在本地运行任务。列表只显示当前账号的设备。",
    statusUnpaired: "未配对",
    statusConnecting: "正在连接",
    statusOnline: "已连接",
    statusOffline: "离线",
    statusRevoked: "授权已撤销",
    statusRevokedHint: "这台 Mac 的访问权限已撤销。重新配对后可运行本地任务。",
    statusUnavailable: "无法读取这台 Mac 的设备状态。",
    executionReady: "这台 Mac 已可运行本地任务。",
    executionNotReady: "本地任务执行尚未就绪。",
    pairTitle: "配对这台 Mac",
    pairDescription:
      "一次性配对码会直接发送到这台 Mac，此设置页不会显示它。本地任务以你的 macOS 用户身份运行，不使用独立容器或单独的 macOS 用户；Codex 工作区沙箱和命令审批仍然生效，桌面控制需要另外授权。",
    pairNameLabel: "设备名称",
    pairNameHint: "1–120 个字符，用于在设备列表中识别这台 Mac。",
    pairNamePlaceholder: "例如：工作用 Mac",
    pairNameRequired: "请输入设备名称。",
    pairNameInvalid: "请使用 1–120 个字符，且不要包含控制字符。",
    pairAction: "配对这台 Mac",
    pairing: "正在配对这台 Mac…",
    pairFailed: "无法配对这台 Mac。请在这台 Mac 上重试。",
    devicesTitle: "已配对设备",
    devicesDescription:
      "已连接到此账号的设备。撤销授权后，该设备将无法运行本地任务。",
    devicesEmptyTitle: "暂无已配对设备",
    devicesEmptyDescription: "配对这台 Mac 后即可在本地运行任务。",
    devicesLoadFailed: "无法加载已配对设备。",
    thisMac: "这台 Mac",
    appVersion: "版本 {{version}}",
    lastSeen: "最近连接：{{date}}",
    neverSeen: "从未连接",
    platformDarwin: "macOS",
    platformWindows: "Windows",
    rename: "重命名",
    renameTitle: "重命名设备",
    renameDescription: "为此设备设置名称。",
    renameNameLabel: "设备名称",
    renameNameHint: "1–120 个字符。",
    renameFailed: "无法重命名此设备。",
    revoke: "撤销授权",
    revokeTitle: "撤销此设备的授权？",
    revokeDescription:
      "撤销“{{name}}”的访问权限后，此设备将立即失去本地任务权限，此操作无法撤销。",
    revokeConfirm: "撤销授权",
    revoking: "正在撤销…",
    revokeFailed: "无法撤销此设备。",
    signOutRevoke: "同时撤销这台 Mac 的授权",
    signOutRevokeFailed:
      "无法确认已撤销这台 Mac 的授权。请重试，或取消勾选后只退出登录。",
    signOutRevokeUnconfirmed:
      "之前的撤销结果尚未确认。退出登录不会再次尝试撤销。",
    signOutDeviceChanged:
      "这台 Mac 的配对状态已变更。请重新选择，或只退出登录。",
  },
  "en-US": {
    title: "This Mac",
    description:
      "Pair this Mac with your account to run tasks locally. Only devices on this account are shown.",
    statusUnpaired: "Not paired",
    statusConnecting: "Connecting",
    statusOnline: "Connected",
    statusOffline: "Offline",
    statusRevoked: "Access revoked",
    statusRevokedHint:
      "Access for this Mac was revoked. Pair it again to run local tasks.",
    statusUnavailable: "Could not read this Mac's device status.",
    executionReady: "Local tasks are ready on this Mac.",
    executionNotReady: "Local task execution is not ready yet.",
    pairTitle: "Pair this Mac",
    pairDescription:
      "A one-time code is sent directly to this Mac and isn’t shown in Settings. Local tasks run under your macOS account, not in a container or a separate macOS account; Codex workspace sandboxing and command approval still apply, and desktop control needs separate authorization.",
    pairNameLabel: "Device name",
    pairNameHint:
      "1–120 characters. This name identifies this Mac in your device list.",
    pairNamePlaceholder: "e.g. Work Mac",
    pairNameRequired: "Enter a device name.",
    pairNameInvalid: "Use 1–120 characters without control characters.",
    pairAction: "Pair this Mac",
    pairing: "Pairing this Mac…",
    pairFailed: "Could not pair this Mac. Try again from this Mac.",
    devicesTitle: "Paired devices",
    devicesDescription:
      "Devices connected to this account. Revoking access stops local tasks on that device.",
    devicesEmptyTitle: "No paired devices",
    devicesEmptyDescription: "Pair this Mac to run tasks locally.",
    devicesLoadFailed: "Could not load paired devices.",
    thisMac: "This Mac",
    appVersion: "Version {{version}}",
    lastSeen: "Last seen {{date}}",
    neverSeen: "Never connected",
    platformDarwin: "macOS",
    platformWindows: "Windows",
    rename: "Rename",
    renameTitle: "Rename device",
    renameDescription: "Choose a name for this device.",
    renameNameLabel: "Device name",
    renameNameHint: "1–120 characters.",
    renameFailed: "Could not rename this device.",
    revoke: "Revoke access",
    revokeTitle: "Revoke this device?",
    revokeDescription:
      "Revoking access for {{name}} takes effect immediately. The device will lose access to local tasks, and this action cannot be undone.",
    revokeConfirm: "Revoke access",
    revoking: "Revoking…",
    revokeFailed: "Could not revoke this device.",
    signOutRevoke: "Also revoke access for this Mac",
    signOutRevokeFailed:
      "Could not confirm that access was revoked for this Mac. Try again, or uncheck the option to just sign out.",
    signOutRevokeUnconfirmed:
      "The previous revocation was not confirmed. Signing out will not retry it.",
    signOutDeviceChanged:
      "This Mac’s pairing status has changed. Make a new selection, or just sign out.",
  },
  "es-ES": {
    title: "Este Mac",
    description:
      "Vincula este Mac a tu cuenta para ejecutar tareas localmente. Solo aparecen los dispositivos de esta cuenta.",
    statusUnpaired: "Sin vincular",
    statusConnecting: "Conectando",
    statusOnline: "Conectado",
    statusOffline: "Sin conexión",
    statusRevoked: "Acceso revocado",
    statusRevokedHint:
      "Se revocó el acceso de este Mac. Vuelve a vincularlo para ejecutar tareas locales.",
    statusUnavailable: "No se pudo leer el estado de este Mac.",
    executionReady: "Las tareas locales están listas en este Mac.",
    executionNotReady: "La ejecución local aún no está lista.",
    pairTitle: "Vincular este Mac",
    pairDescription:
      "Un código de un solo uso se envía directamente a este Mac y no se muestra en esta página de ajustes. Las tareas locales se ejecutan con tu usuario de macOS, no en un contenedor ni en una cuenta de macOS aparte; el aislamiento del espacio de trabajo de Codex y la aprobación de comandos siguen aplicándose, y el control del escritorio requiere una autorización aparte.",
    pairNameLabel: "Nombre del dispositivo",
    pairNameHint:
      "De 1 a 120 caracteres. Este nombre aparece en la lista de dispositivos.",
    pairNamePlaceholder: "p. ej., Mac del trabajo",
    pairNameRequired: "Introduce un nombre para el dispositivo.",
    pairNameInvalid: "Usa de 1 a 120 caracteres sin caracteres de control.",
    pairAction: "Vincular este Mac",
    pairing: "Vinculando este Mac…",
    pairFailed:
      "No se pudo vincular este Mac. Inténtalo de nuevo desde este Mac.",
    devicesTitle: "Dispositivos vinculados",
    devicesDescription:
      "Dispositivos conectados a esta cuenta. Revocar el acceso detiene las tareas locales en ese dispositivo.",
    devicesEmptyTitle: "No hay dispositivos vinculados",
    devicesEmptyDescription:
      "Vincula este Mac para ejecutar tareas localmente.",
    devicesLoadFailed: "No se pudieron cargar los dispositivos vinculados.",
    thisMac: "Este Mac",
    appVersion: "Versión {{version}}",
    lastSeen: "Última conexión: {{date}}",
    neverSeen: "Nunca se ha conectado",
    platformDarwin: "macOS",
    platformWindows: "Windows",
    rename: "Cambiar nombre",
    renameTitle: "Cambiar nombre del dispositivo",
    renameDescription: "Elige un nombre para este dispositivo.",
    renameNameLabel: "Nombre del dispositivo",
    renameNameHint: "De 1 a 120 caracteres.",
    renameFailed: "No se pudo cambiar el nombre del dispositivo.",
    revoke: "Revocar acceso",
    revokeTitle: "¿Revocar este dispositivo?",
    revokeDescription:
      "Al revocar el acceso de {{name}}, el dispositivo perderá inmediatamente el acceso a las tareas locales. Esta acción no se puede deshacer.",
    revokeConfirm: "Revocar acceso",
    revoking: "Revocando…",
    revokeFailed: "No se pudo revocar este dispositivo.",
    signOutRevoke: "Revocar también el acceso de este Mac",
    signOutRevokeFailed:
      "No se pudo confirmar la revocación del acceso de este Mac. Inténtalo de nuevo o desmarca la opción para cerrar sesión sin repetir la revocación.",
    signOutRevokeUnconfirmed:
      "La revocación anterior no se ha confirmado. Al cerrar sesión no se volverá a intentar.",
    signOutDeviceChanged:
      "Cambió el estado de vinculación de este Mac. Vuelve a elegir o cierra sesión sin revocar el acceso.",
  },
  "pt-BR": {
    title: "Este Mac",
    description:
      "Pareie este Mac com sua conta para executar tarefas localmente. Apenas os dispositivos desta conta são exibidos.",
    statusUnpaired: "Não pareado",
    statusConnecting: "Conectando",
    statusOnline: "Conectado",
    statusOffline: "Offline",
    statusRevoked: "Acesso revogado",
    statusRevokedHint:
      "O acesso deste Mac foi revogado. Pareie-o novamente para executar tarefas locais.",
    statusUnavailable: "Não foi possível ler o status deste Mac.",
    executionReady: "As tarefas locais estão prontas neste Mac.",
    executionNotReady: "A execução local ainda não está pronta.",
    pairTitle: "Parear este Mac",
    pairDescription:
      "Um código de uso único é enviado diretamente para este Mac e não aparece nesta página de configurações. As tarefas locais são executadas com o seu usuário do macOS, não em um contêiner nem em uma conta separada do macOS; o isolamento do espaço de trabalho do Codex e a aprovação de comandos continuam valendo, e o controle da área de trabalho exige uma autorização separada.",
    pairNameLabel: "Nome do dispositivo",
    pairNameHint:
      "De 1 a 120 caracteres. Este nome aparece na lista de dispositivos.",
    pairNamePlaceholder: "ex.: Mac do trabalho",
    pairNameRequired: "Digite um nome para o dispositivo.",
    pairNameInvalid: "Use de 1 a 120 caracteres sem caracteres de controle.",
    pairAction: "Parear este Mac",
    pairing: "Pareando este Mac…",
    pairFailed: "Não foi possível parear este Mac. Tente novamente neste Mac.",
    devicesTitle: "Dispositivos pareados",
    devicesDescription:
      "Dispositivos conectados a esta conta. Revogar o acesso interrompe as tarefas locais nesse dispositivo.",
    devicesEmptyTitle: "Nenhum dispositivo pareado",
    devicesEmptyDescription:
      "Pareie este Mac para executar tarefas localmente.",
    devicesLoadFailed: "Não foi possível carregar os dispositivos pareados.",
    thisMac: "Este Mac",
    appVersion: "Versão {{version}}",
    lastSeen: "Visto por último: {{date}}",
    neverSeen: "Nunca conectado",
    platformDarwin: "macOS",
    platformWindows: "Windows",
    rename: "Renomear",
    renameTitle: "Renomear dispositivo",
    renameDescription: "Escolha um nome para este dispositivo.",
    renameNameLabel: "Nome do dispositivo",
    renameNameHint: "De 1 a 120 caracteres.",
    renameFailed: "Não foi possível renomear este dispositivo.",
    revoke: "Revogar acesso",
    revokeTitle: "Revogar este dispositivo?",
    revokeDescription:
      "Revogar o acesso de {{name}} entra em vigor imediatamente. O dispositivo perderá o acesso a tarefas locais, e esta ação não pode ser desfeita.",
    revokeConfirm: "Revogar acesso",
    revoking: "Revogando…",
    revokeFailed: "Não foi possível revogar este dispositivo.",
    signOutRevoke: "Revogar também o acesso deste Mac",
    signOutRevokeFailed:
      "Não foi possível confirmar a revogação do acesso deste Mac. Tente novamente ou desmarque a opção para apenas sair.",
    signOutRevokeUnconfirmed:
      "A revogação anterior não foi confirmada. Sair da conta não fará outra tentativa.",
    signOutDeviceChanged:
      "O estado de pareamento deste Mac mudou. Faça uma nova seleção ou apenas saia.",
  },
  "fr-FR": {
    title: "Ce Mac",
    description:
      "Associez ce Mac à votre compte pour exécuter des tâches localement. Seuls les appareils de ce compte sont affichés.",
    statusUnpaired: "Non associé",
    statusConnecting: "Connexion…",
    statusOnline: "Connecté",
    statusOffline: "Hors ligne",
    statusRevoked: "Accès révoqué",
    statusRevokedHint:
      "L’accès à ce Mac a été révoqué. Associez-le à nouveau pour exécuter des tâches locales.",
    statusUnavailable: "Impossible de lire l’état de ce Mac.",
    executionReady: "Les tâches locales sont prêtes sur ce Mac.",
    executionNotReady: "L’exécution locale n’est pas encore prête.",
    pairTitle: "Associer ce Mac",
    pairDescription:
      "Un code à usage unique est envoyé directement à ce Mac et n’apparaît pas sur cette page de réglages. Les tâches locales s’exécutent sous votre compte utilisateur macOS, pas dans un conteneur ni sous un autre compte macOS ; le bac à sable de l’espace de travail Codex et l’approbation des commandes s’appliquent toujours, et le contrôle du bureau nécessite une autorisation distincte.",
    pairNameLabel: "Nom de l’appareil",
    pairNameHint:
      "De 1 à 120 caractères. Ce nom apparaît dans la liste des appareils.",
    pairNamePlaceholder: "ex. : Mac professionnel",
    pairNameRequired: "Saisissez un nom pour l’appareil.",
    pairNameInvalid:
      "Utilisez de 1 à 120 caractères sans caractères de contrôle.",
    pairAction: "Associer ce Mac",
    pairing: "Association de ce Mac…",
    pairFailed: "Impossible d’associer ce Mac. Réessayez depuis ce Mac.",
    devicesTitle: "Appareils associés",
    devicesDescription:
      "Appareils connectés à ce compte. Révoquer l’accès arrête les tâches locales sur cet appareil.",
    devicesEmptyTitle: "Aucun appareil associé",
    devicesEmptyDescription:
      "Associez ce Mac pour exécuter des tâches localement.",
    devicesLoadFailed: "Impossible de charger les appareils associés.",
    thisMac: "Ce Mac",
    appVersion: "Version {{version}}",
    lastSeen: "Dernière connexion : {{date}}",
    neverSeen: "Jamais connecté",
    platformDarwin: "macOS",
    platformWindows: "Windows",
    rename: "Renommer",
    renameTitle: "Renommer l’appareil",
    renameDescription: "Choisissez un nom pour cet appareil.",
    renameNameLabel: "Nom de l’appareil",
    renameNameHint: "De 1 à 120 caractères.",
    renameFailed: "Impossible de renommer cet appareil.",
    revoke: "Révoquer l’accès",
    revokeTitle: "Révoquer cet appareil ?",
    revokeDescription:
      "La révocation de l’accès de {{name}} prend effet immédiatement. L’appareil perdra l’accès aux tâches locales, et cette action est irréversible.",
    revokeConfirm: "Révoquer l’accès",
    revoking: "Révocation…",
    revokeFailed: "Impossible de révoquer cet appareil.",
    signOutRevoke: "Révoquer aussi l’accès de ce Mac",
    signOutRevokeFailed:
      "Impossible de confirmer la révocation de l’accès de ce Mac. Réessayez ou décochez l’option pour simplement vous déconnecter.",
    signOutRevokeUnconfirmed:
      "La révocation précédente n’a pas été confirmée. Vous déconnecter ne relancera pas la révocation.",
    signOutDeviceChanged:
      "L’état du jumelage de ce Mac a changé. Faites un nouveau choix ou déconnectez-vous simplement.",
  },
  "ja-JP": {
    title: "この Mac",
    description:
      "この Mac をアカウントにペアリングすると、ローカルでタスクを実行できます。表示されるのはこのアカウントのデバイスだけです。",
    statusUnpaired: "未ペアリング",
    statusConnecting: "接続中",
    statusOnline: "接続済み",
    statusOffline: "オフライン",
    statusRevoked: "アクセスを取り消し済み",
    statusRevokedHint:
      "この Mac のアクセスは取り消されました。ローカルタスクを実行するには、もう一度ペアリングしてください。",
    statusUnavailable: "この Mac のデバイス状態を読み取れませんでした。",
    executionReady: "この Mac でローカルタスクを実行できます。",
    executionNotReady: "ローカル実行の準備ができていません。",
    pairTitle: "この Mac をペアリング",
    pairDescription:
      "1 回限りのコードはこの Mac に直接送信され、この設定ページには表示されません。ローカルタスクはお使いの macOS ユーザーとして実行され、独立したコンテナや別の macOS アカウントは使用しません。Codex のワークスペースサンドボックスとコマンド承認は引き続き適用され、デスクトップ操作には別途の許可が必要です。",
    pairNameLabel: "デバイス名",
    pairNameHint: "1〜120 文字。デバイス一覧に表示される名前です。",
    pairNamePlaceholder: "例：仕事用 Mac",
    pairNameRequired: "デバイス名を入力してください。",
    pairNameInvalid: "制御文字を含まない 1〜120 文字で入力してください。",
    pairAction: "この Mac をペアリング",
    pairing: "この Mac をペアリングしています…",
    pairFailed:
      "この Mac をペアリングできませんでした。この Mac から再試行してください。",
    devicesTitle: "ペアリング済みデバイス",
    devicesDescription:
      "このアカウントに接続されているデバイスです。アクセスを取り消すと、そのデバイスではローカルタスクを実行できなくなります。",
    devicesEmptyTitle: "ペアリング済みデバイスはありません",
    devicesEmptyDescription:
      "この Mac をペアリングすると、ローカルでタスクを実行できます。",
    devicesLoadFailed: "ペアリング済みデバイスを読み込めませんでした。",
    thisMac: "この Mac",
    appVersion: "バージョン {{version}}",
    lastSeen: "最終接続：{{date}}",
    neverSeen: "未接続",
    platformDarwin: "macOS",
    platformWindows: "Windows",
    rename: "名前を変更",
    renameTitle: "デバイス名を変更",
    renameDescription: "このデバイスの名前を入力してください。",
    renameNameLabel: "デバイス名",
    renameNameHint: "1〜120 文字。",
    renameFailed: "デバイス名を変更できませんでした。",
    revoke: "アクセスを取り消す",
    revokeTitle: "このデバイスのアクセスを取り消しますか？",
    revokeDescription:
      "「{{name}}」のアクセスを取り消すと、このデバイスは直ちにローカルタスクへアクセスできなくなります。この操作は取り消せません。",
    revokeConfirm: "アクセスを取り消す",
    revoking: "取り消しています…",
    revokeFailed: "このデバイスのアクセスを取り消せませんでした。",
    signOutRevoke: "この Mac のアクセス権も取り消す",
    signOutRevokeFailed:
      "この Mac のアクセス権が取り消されたことを確認できませんでした。もう一度お試しいただくか、チェックを外してログアウトのみ行ってください。",
    signOutRevokeUnconfirmed:
      "前回の取り消しは確認できていません。ログアウトしても取り消しは再試行されません。",
    signOutDeviceChanged:
      "この Mac のペアリング状態が変わりました。選び直すか、ログアウトのみ行ってください。",
  },
} satisfies Record<Locale, DesktopDevicesMessages>
