import type { Locale } from "@linksense/shared"

type DesktopComputerPermissionMessages = {
  title: string
  accessibility: string
  screenRecording: string
  accessibilityDescription: string
  screenRecordingDescription: string
  checking: string
  statusGranted: string
  statusNotGranted: string
  statusUnknown: string
  statusFailed: string
  statusUnsupported: string
  statusNotPackaged: string
  guideCanceled: string
  guideClosed: string
  guideTimedOut: string
  guideUnknown: string
  guideFailed: string
  guideAction: string
  guideHint: string
  waiting: string
  cancelGuide: string
  checkAgain: string
  manualAction: string
  manualHint: string
  manualFailed: string
  restartConfirm: string
  restartHint: string
  continueWithoutGui: string
  close: string
}

export const desktopComputerPermissionMessages: Record<
  Locale,
  DesktopComputerPermissionMessages
> = {
  "zh-CN": {
    title: "允许{{permission}}",
    accessibility: "辅助功能",
    screenRecording: "屏幕录制",
    accessibilityDescription:
      "允许后，LinkSense 可以在你启动的 GUI 任务中操控这台 Mac 上的应用。",
    screenRecordingDescription:
      "允许后，LinkSense 可以在你启动的 GUI 任务中截取这台 Mac 的屏幕。",
    checking: "正在检查{{permission}}权限…",
    statusGranted: "已允许{{permission}}。",
    statusNotGranted: "尚未允许{{permission}}。",
    statusUnknown: "无法确认{{permission}}权限状态。",
    statusFailed: "无法检查{{permission}}权限。",
    statusUnsupported: "此应用无法提供权限引导。",
    statusNotPackaged: "权限引导需要在已打包的 LinkSense 应用中使用。",
    guideCanceled: "已取消引导。",
    guideClosed: "引导已关闭，尚未确认权限。",
    guideTimedOut: "引导等待超时。",
    guideUnknown: "引导结束，但未能确认权限。",
    guideFailed: "无法打开权限引导。",
    guideAction: "打开系统设置引导",
    guideHint:
      "LinkSense 会打开对应的“系统设置”页面，并显示包含当前应用的拖拽面板。请在系统设置中打开开关。",
    waiting: "请在“系统设置”中按引导操作。返回 LinkSense 后会重新检查。",
    cancelGuide: "取消引导",
    checkAgain: "重新检查",
    manualAction: "打开系统设置",
    manualHint:
      "如果没有看到引导面板，请在“系统设置”中手动添加 LinkSense，然后重新检查。",
    manualFailed: "无法打开系统设置。",
    restartConfirm: "我已在系统设置中打开屏幕录制",
    restartHint:
      "请退出并重新打开 LinkSense，然后重新检查。LinkSense 不会自动重启。",
    continueWithoutGui: "不使用 GUI 继续",
    close: "关闭",
  },
  "en-US": {
    title: "Allow {{permission}}",
    accessibility: "Accessibility",
    screenRecording: "Screen Recording",
    accessibilityDescription:
      "This lets LinkSense control apps on this Mac for the GUI task you started.",
    screenRecordingDescription:
      "This lets LinkSense capture the screen on this Mac for the GUI task you started.",
    checking: "Checking {{permission}}…",
    statusGranted: "{{permission}} is allowed.",
    statusNotGranted: "{{permission}} is not allowed yet.",
    statusUnknown: "LinkSense could not confirm {{permission}}.",
    statusFailed: "Could not check {{permission}}.",
    statusUnsupported: "Permission guidance is not available in this app.",
    statusNotPackaged:
      "Permission guidance requires the packaged LinkSense app.",
    guideCanceled: "The guide was canceled.",
    guideClosed: "The guide closed before the permission was confirmed.",
    guideTimedOut: "The guide timed out.",
    guideUnknown: "The guide ended without confirming the permission.",
    guideFailed: "Could not open the permission guide.",
    guideAction: "Open System Settings guide",
    guideHint:
      "LinkSense opens the matching System Settings page and shows a panel with the app to drag into the list. Turn on the switch there.",
    waiting:
      "Follow the guide in System Settings. LinkSense checks again when you return.",
    cancelGuide: "Cancel guide",
    checkAgain: "Check again",
    manualAction: "Open System Settings",
    manualHint:
      "If the guide does not appear, add LinkSense to the list in System Settings manually, then check again.",
    manualFailed: "Could not open System Settings.",
    restartConfirm: "I turned on Screen Recording in System Settings",
    restartHint:
      "Quit and reopen LinkSense, then check again. LinkSense does not restart automatically.",
    continueWithoutGui: "Continue without GUI",
    close: "Close",
  },
  "es-ES": {
    title: "Permitir {{permission}}",
    accessibility: "Accesibilidad",
    screenRecording: "Grabación de pantalla",
    accessibilityDescription:
      "Esto permite que LinkSense controle aplicaciones de este Mac para la tarea GUI que has iniciado.",
    screenRecordingDescription:
      "Esto permite que LinkSense capture la pantalla de este Mac para la tarea GUI que has iniciado.",
    checking: "Comprobando {{permission}}…",
    statusGranted: "{{permission}} está permitido.",
    statusNotGranted: "{{permission}} aún no está permitido.",
    statusUnknown: "LinkSense no pudo confirmar {{permission}}.",
    statusFailed: "No se pudo comprobar {{permission}}.",
    statusUnsupported:
      "La guía de permisos no está disponible en esta aplicación.",
    statusNotPackaged:
      "La guía de permisos requiere la aplicación LinkSense empaquetada.",
    guideCanceled: "Se canceló la guía.",
    guideClosed: "La guía se cerró antes de confirmar el permiso.",
    guideTimedOut: "La guía agotó el tiempo de espera.",
    guideUnknown: "La guía terminó sin confirmar el permiso.",
    guideFailed: "No se pudo abrir la guía de permisos.",
    guideAction: "Abrir la guía de Ajustes del Sistema",
    guideHint:
      "LinkSense abre la página correspondiente de Ajustes del Sistema y muestra un panel con la aplicación para arrastrarla a la lista. Activa el interruptor allí.",
    waiting:
      "Sigue la guía en Ajustes del Sistema. LinkSense volverá a comprobar cuando regreses.",
    cancelGuide: "Cancelar guía",
    checkAgain: "Comprobar de nuevo",
    manualAction: "Abrir Ajustes del Sistema",
    manualHint:
      "Si la guía no aparece, añade LinkSense manualmente a la lista en Ajustes del Sistema y vuelve a comprobar.",
    manualFailed: "No se pudo abrir Ajustes del Sistema.",
    restartConfirm:
      "He activado Grabación de pantalla en Ajustes del Sistema",
    restartHint:
      "Sal y vuelve a abrir LinkSense, luego comprueba de nuevo. LinkSense no se reinicia automáticamente.",
    continueWithoutGui: "Continuar sin GUI",
    close: "Cerrar",
  },
  "pt-BR": {
    title: "Permitir {{permission}}",
    accessibility: "Acessibilidade",
    screenRecording: "Gravação de Tela",
    accessibilityDescription:
      "Isso permite que o LinkSense controle aplicativos neste Mac para a tarefa GUI que você iniciou.",
    screenRecordingDescription:
      "Isso permite que o LinkSense capture a tela deste Mac para a tarefa GUI que você iniciou.",
    checking: "Verificando {{permission}}…",
    statusGranted: "{{permission}} está permitida.",
    statusNotGranted: "{{permission}} ainda não está permitida.",
    statusUnknown: "O LinkSense não conseguiu confirmar {{permission}}.",
    statusFailed: "Não foi possível verificar {{permission}}.",
    statusUnsupported:
      "A orientação de permissões não está disponível neste aplicativo.",
    statusNotPackaged:
      "A orientação de permissões exige o aplicativo LinkSense empacotado.",
    guideCanceled: "A orientação foi cancelada.",
    guideClosed: "A orientação foi fechada antes de confirmar a permissão.",
    guideTimedOut: "A orientação expirou.",
    guideUnknown: "A orientação terminou sem confirmar a permissão.",
    guideFailed: "Não foi possível abrir a orientação de permissões.",
    guideAction: "Abrir orientação em Ajustes do Sistema",
    guideHint:
      "O LinkSense abre a página correspondente em Ajustes do Sistema e mostra um painel com o aplicativo para arrastar para a lista. Ative o interruptor lá.",
    waiting:
      "Siga a orientação em Ajustes do Sistema. O LinkSense verifica novamente quando você voltar.",
    cancelGuide: "Cancelar orientação",
    checkAgain: "Verificar novamente",
    manualAction: "Abrir Ajustes do Sistema",
    manualHint:
      "Se a orientação não aparecer, adicione o LinkSense manualmente à lista em Ajustes do Sistema e verifique novamente.",
    manualFailed: "Não foi possível abrir Ajustes do Sistema.",
    restartConfirm: "Ativei Gravação de Tela em Ajustes do Sistema",
    restartHint:
      "Saia e abra o LinkSense novamente, depois verifique outra vez. O LinkSense não reinicia automaticamente.",
    continueWithoutGui: "Continuar sem GUI",
    close: "Fechar",
  },
  "fr-FR": {
    title: "Autoriser {{permission}}",
    accessibility: "Accessibilité",
    screenRecording: "Enregistrement de l’écran",
    accessibilityDescription:
      "Cela permet à LinkSense de contrôler des applications de ce Mac pour la tâche GUI que vous avez lancée.",
    screenRecordingDescription:
      "Cela permet à LinkSense de capturer l’écran de ce Mac pour la tâche GUI que vous avez lancée.",
    checking: "Vérification de {{permission}}…",
    statusGranted: "{{permission}} est autorisée.",
    statusNotGranted: "{{permission}} n’est pas encore autorisée.",
    statusUnknown: "LinkSense n’a pas pu confirmer {{permission}}.",
    statusFailed: "Impossible de vérifier {{permission}}.",
    statusUnsupported:
      "Le guide des autorisations n’est pas disponible dans cette application.",
    statusNotPackaged:
      "Le guide des autorisations nécessite l’application LinkSense empaquetée.",
    guideCanceled: "Le guide a été annulé.",
    guideClosed: "Le guide s’est fermé avant la confirmation de l’autorisation.",
    guideTimedOut: "Le guide a expiré.",
    guideUnknown: "Le guide s’est terminé sans confirmer l’autorisation.",
    guideFailed: "Impossible d’ouvrir le guide des autorisations.",
    guideAction: "Ouvrir le guide dans Réglages Système",
    guideHint:
      "LinkSense ouvre la page correspondante de Réglages Système et affiche un panneau avec l’application à faire glisser dans la liste. Activez l’interrupteur sur place.",
    waiting:
      "Suivez le guide dans Réglages Système. LinkSense vérifie de nouveau à votre retour.",
    cancelGuide: "Annuler le guide",
    checkAgain: "Vérifier à nouveau",
    manualAction: "Ouvrir Réglages Système",
    manualHint:
      "Si le guide n’apparaît pas, ajoutez LinkSense manuellement à la liste dans Réglages Système, puis vérifiez à nouveau.",
    manualFailed: "Impossible d’ouvrir Réglages Système.",
    restartConfirm:
      "J’ai activé Enregistrement de l’écran dans Réglages Système",
    restartHint:
      "Quittez puis rouvrez LinkSense, puis vérifiez à nouveau. LinkSense ne redémarre pas automatiquement.",
    continueWithoutGui: "Continuer sans GUI",
    close: "Fermer",
  },
  "ja-JP": {
    title: "{{permission}}を許可",
    accessibility: "アクセシビリティ",
    screenRecording: "画面収録",
    accessibilityDescription:
      "開始した GUI タスクで、LinkSense がこの Mac のアプリを操作できるようにします。",
    screenRecordingDescription:
      "開始した GUI タスクで、LinkSense がこの Mac の画面をキャプチャできるようにします。",
    checking: "{{permission}}を確認しています…",
    statusGranted: "{{permission}}は許可されています。",
    statusNotGranted: "{{permission}}はまだ許可されていません。",
    statusUnknown: "{{permission}}を確認できませんでした。",
    statusFailed: "{{permission}}の確認に失敗しました。",
    statusUnsupported: "このアプリでは権限ガイドを利用できません。",
    statusNotPackaged: "権限ガイドにはパッケージ版の LinkSense アプリが必要です。",
    guideCanceled: "ガイドをキャンセルしました。",
    guideClosed: "権限を確認する前にガイドが閉じられました。",
    guideTimedOut: "ガイドがタイムアウトしました。",
    guideUnknown: "ガイドは終了しましたが、権限を確認できませんでした。",
    guideFailed: "権限ガイドを開けませんでした。",
    guideAction: "システム設定のガイドを開く",
    guideHint:
      "LinkSense が該当するシステム設定のページを開き、リストにドラッグするアプリのパネルを表示します。そこでスイッチをオンにしてください。",
    waiting:
      "システム設定のガイドに従ってください。戻ると LinkSense が再確認します。",
    cancelGuide: "ガイドをキャンセル",
    checkAgain: "再確認",
    manualAction: "システム設定を開く",
    manualHint:
      "ガイドが表示されない場合は、システム設定のリストに LinkSense を手動で追加してから再確認してください。",
    manualFailed: "システム設定を開けませんでした。",
    restartConfirm: "システム設定で画面収録をオンにしました",
    restartHint:
      "LinkSense を終了して開き直し、再確認してください。LinkSense は自動で再起動しません。",
    continueWithoutGui: "GUI なしで続行",
    close: "閉じる",
  },
}
