import type { Locale } from "@linksense/shared"

type DesktopComputerUseMessages = {
  title: string
  descriptionIdle: string
  descriptionActive: string
  descriptionPaused: string
  descriptionRetiring: string
  descriptionStopped: string
  descriptionExpired: string
  descriptionUnavailable: string
  statusIdle: string
  statusActive: string
  statusPaused: string
  statusRetiring: string
  statusStopped: string
  statusExpired: string
  statusUnavailable: string
  statusChecking: string
  checking: string
  selectAction: string
  selecting: string
  pauseAction: string
  pausing: string
  resumeAction: string
  resuming: string
  renewAction: string
  renewing: string
  stopAction: string
  stopping: string
  expiresIn: string
  windowHint: string
  controlHint: string
  approvalQuestion: string
  approvalClickQuestion: string
  approvalTypeQuestion: string
  permissionChecking: string
  permissionFailed: string
  permissionUnsupported: string
  permissionNotPackaged: string
  errorBusy: string
  errorTimeout: string
  errorForbidden: string
  errorTargetChanged: string
  errorStaleScope: string
  errorUnavailable: string
  errorUnsupported: string
  errorInvalidResponse: string
  errorFailed: string
  retry: string
}

export const desktopComputerUseMessages: Record<
  Locale,
  DesktopComputerUseMessages
> = {
  "zh-CN": {
    title: "电脑操作",
    descriptionIdle:
      "为此任务操作这台 Mac 上的一个应用窗口。请在 LinkSense 选择器中选择窗口。",
    descriptionActive:
      "助手可以使用你批准的窗口。暂停只会停止 GUI 操作，任务会继续运行。",
    descriptionPaused:
      "GUI 操作已暂停，任务会在不使用应用的情况下继续运行。恢复时会重新检查窗口。",
    descriptionRetiring:
      "正在停止这台 Mac 上的 GUI 操作。完成后会显示最终状态。",
    descriptionStopped: "这台 Mac 上的 GUI 操作已停止。",
    descriptionExpired: "5 分钟授权已过期。请重新选择窗口以继续。",
    descriptionUnavailable: "此任务在这台 Mac 上无法使用电脑操作。",
    statusIdle: "未开始",
    statusActive: "进行中",
    statusPaused: "已暂停",
    statusRetiring: "正在停止…",
    statusStopped: "已停止",
    statusExpired: "已过期",
    statusUnavailable: "不可用",
    statusChecking: "检查中",
    checking: "正在检查电脑操作…",
    selectAction: "选择窗口…",
    selecting: "正在等待 LinkSense 窗口选择器…",
    pauseAction: "暂停",
    pausing: "正在暂停…",
    resumeAction: "恢复",
    resuming: "正在恢复…",
    renewAction: "续期 5 分钟",
    renewing: "正在续期…",
    stopAction: "停止",
    stopping: "正在停止…",
    expiresIn: "剩余 {{time}}",
    windowHint: "窗口在 LinkSense 应用中选择。此聊天不会列出或截取窗口。",
    controlHint:
      "暂停只会停止 GUI 操作。停止会结束此任务在这台 Mac 上的电脑操作。",
    approvalQuestion: "允许执行这次电脑操作吗？",
    approvalClickQuestion: "允许在已批准的窗口中进行点击吗？",
    approvalTypeQuestion: "允许在已批准的窗口中键入文字吗？",
    permissionChecking: "正在检查辅助功能权限…",
    permissionFailed: "无法检查辅助功能权限。请重试。",
    permissionUnsupported:
      "此版本的 LinkSense 无法引导辅助功能权限。请更新 LinkSense 后重试。",
    permissionNotPackaged: "权限引导需要在已打包的 LinkSense 应用中使用。",
    errorBusy: "另一个任务正在这台 Mac 上使用电脑操作。请在其结束后重试。",
    errorTimeout: "无法确认电脑操作的结果。显示的状态可能不是最新。",
    errorForbidden: "此任务无权使用电脑操作。",
    errorTargetChanged: "所选窗口已变化。请重新选择窗口。",
    errorStaleScope: "此控制已不适用于当前任务。",
    errorUnavailable: "此任务在这台 Mac 上无法使用电脑操作。",
    errorUnsupported: "请更新 LinkSense 以使用电脑操作。",
    errorInvalidResponse: "无法读取电脑操作状态。请重试。",
    errorFailed: "电脑操作没有响应。请重试。",
    retry: "重试",
  },
  "en-US": {
    title: "Computer Use",
    descriptionIdle:
      "Control one app window on this Mac for this task. Choose the window in the LinkSense picker.",
    descriptionActive:
      "The assistant can use the window you approved. Pause stops GUI control only; the task keeps running.",
    descriptionPaused:
      "GUI control is paused. The task keeps running without using your apps. Resume checks the window again.",
    descriptionRetiring:
      "Stopping GUI control on this Mac. The final state appears when it completes.",
    descriptionStopped: "GUI control stopped on this Mac.",
    descriptionExpired:
      "The 5-minute authorization expired. Select the window again to continue.",
    descriptionUnavailable:
      "Computer Use isn’t available for this task on this Mac.",
    statusIdle: "Not started",
    statusActive: "Active",
    statusPaused: "Paused",
    statusRetiring: "Stopping…",
    statusStopped: "Stopped",
    statusExpired: "Expired",
    statusUnavailable: "Unavailable",
    statusChecking: "Checking",
    checking: "Checking Computer Use…",
    selectAction: "Select window…",
    selecting: "Waiting for the LinkSense window picker…",
    pauseAction: "Pause",
    pausing: "Pausing…",
    resumeAction: "Resume",
    resuming: "Resuming…",
    renewAction: "Renew for 5 minutes",
    renewing: "Renewing…",
    stopAction: "Stop",
    stopping: "Stopping…",
    expiresIn: "{{time}} left",
    windowHint:
      "The window is chosen in the LinkSense app. This chat never lists or captures windows.",
    controlHint:
      "Pause stops GUI control only. Stop ends Computer Use for this task on this Mac.",
    approvalQuestion: "Allow this Computer Use action?",
    approvalClickQuestion: "Allow clicking in the approved window?",
    approvalTypeQuestion: "Allow typing in the approved window?",
    permissionChecking: "Checking Accessibility permission…",
    permissionFailed: "Couldn’t check the Accessibility permission. Try again.",
    permissionUnsupported:
      "This version of LinkSense can’t guide Accessibility permission. Update LinkSense and try again.",
    permissionNotPackaged:
      "Permission guidance requires the packaged LinkSense app.",
    errorBusy:
      "Another task is using Computer Use on this Mac. Try again after it finishes.",
    errorTimeout:
      "Couldn’t confirm the Computer Use result. The status shown may be out of date.",
    errorForbidden: "This task isn’t allowed to use Computer Use.",
    errorTargetChanged: "The selected window changed. Select the window again.",
    errorStaleScope: "This control no longer applies to the current task.",
    errorUnavailable: "Computer Use isn’t available for this task on this Mac.",
    errorUnsupported: "Update LinkSense to use Computer Use.",
    errorInvalidResponse:
      "LinkSense couldn’t read the Computer Use state. Try again.",
    errorFailed: "Computer Use didn’t respond. Try again.",
    retry: "Try again",
  },
  "es-ES": {
    title: "Uso del equipo",
    descriptionIdle:
      "Controla una ventana de aplicación en este Mac para esta tarea. Elige la ventana en el selector de LinkSense.",
    descriptionActive:
      "El asistente puede usar la ventana que aprobaste. Pausar solo detiene el control de la interfaz; la tarea continúa.",
    descriptionPaused:
      "El control de la interfaz está en pausa. La tarea continúa sin usar tus aplicaciones. Reanudar vuelve a comprobar la ventana.",
    descriptionRetiring:
      "Se está deteniendo el control de la interfaz en este Mac. El estado final aparecerá al terminar.",
    descriptionStopped:
      "El control de la interfaz está detenido en este Mac.",
    descriptionExpired:
      "La autorización de 5 minutos caducó. Selecciona la ventana de nuevo para continuar.",
    descriptionUnavailable:
      "Uso del equipo no está disponible para esta tarea en este Mac.",
    statusIdle: "Sin iniciar",
    statusActive: "Activo",
    statusPaused: "En pausa",
    statusRetiring: "Deteniendo…",
    statusStopped: "Detenido",
    statusExpired: "Caducado",
    statusUnavailable: "No disponible",
    statusChecking: "Comprobando",
    checking: "Comprobando Uso del equipo…",
    selectAction: "Seleccionar ventana…",
    selecting: "Esperando al selector de ventanas de LinkSense…",
    pauseAction: "Pausar",
    pausing: "Pausando…",
    resumeAction: "Reanudar",
    resuming: "Reanudando…",
    renewAction: "Renovar por 5 minutos",
    renewing: "Renovando…",
    stopAction: "Detener",
    stopping: "Deteniendo…",
    expiresIn: "Quedan {{time}}",
    windowHint:
      "La ventana se elige en la aplicación LinkSense. Este chat nunca enumera ni captura ventanas.",
    controlHint:
      "Pausar solo detiene el control de la interfaz. Detener finaliza el Uso del equipo de esta tarea en este Mac.",
    approvalQuestion: "¿Permitir esta acción de Uso del equipo?",
    approvalClickQuestion: "¿Permitir hacer clic en la ventana aprobada?",
    approvalTypeQuestion: "¿Permitir escribir en la ventana aprobada?",
    permissionChecking: "Comprobando el permiso de Accesibilidad…",
    permissionFailed:
      "No se pudo comprobar el permiso de Accesibilidad. Inténtalo de nuevo.",
    permissionUnsupported:
      "Esta versión de LinkSense no puede guiarte con el permiso de Accesibilidad. Actualiza LinkSense e inténtalo de nuevo.",
    permissionNotPackaged:
      "La guía de permisos requiere la aplicación LinkSense empaquetada.",
    errorBusy:
      "Otra tarea está usando Uso del equipo en este Mac. Inténtalo de nuevo cuando termine.",
    errorTimeout:
      "No se pudo confirmar el resultado de Uso del equipo. Es posible que el estado mostrado no esté actualizado.",
    errorForbidden: "Esta tarea no tiene permiso para usar Uso del equipo.",
    errorTargetChanged:
      "La ventana seleccionada cambió. Selecciona la ventana de nuevo.",
    errorStaleScope: "Este control ya no se aplica a la tarea actual.",
    errorUnavailable:
      "Uso del equipo no está disponible para esta tarea en este Mac.",
    errorUnsupported: "Actualiza LinkSense para usar Uso del equipo.",
    errorInvalidResponse:
      "LinkSense no pudo leer el estado de Uso del equipo. Inténtalo de nuevo.",
    errorFailed: "Uso del equipo no respondió. Inténtalo de nuevo.",
    retry: "Reintentar",
  },
  "pt-BR": {
    title: "Uso do computador",
    descriptionIdle:
      "Controle uma janela de aplicativo neste Mac para esta tarefa. Escolha a janela no seletor do LinkSense.",
    descriptionActive:
      "O assistente pode usar a janela que você aprovou. Pausar interrompe apenas o controle da interface; a tarefa continua.",
    descriptionPaused:
      "O controle da interface está pausado. A tarefa continua sem usar seus aplicativos. Retomar verifica a janela novamente.",
    descriptionRetiring:
      "Interrompendo o controle da interface neste Mac. O estado final aparecerá quando terminar.",
    descriptionStopped:
      "O controle da interface está interrompido neste Mac.",
    descriptionExpired:
      "A autorização de 5 minutos expirou. Selecione a janela novamente para continuar.",
    descriptionUnavailable:
      "Uso do computador não está disponível para esta tarefa neste Mac.",
    statusIdle: "Não iniciado",
    statusActive: "Ativo",
    statusPaused: "Pausado",
    statusRetiring: "Parando…",
    statusStopped: "Parado",
    statusExpired: "Expirado",
    statusUnavailable: "Indisponível",
    statusChecking: "Verificando",
    checking: "Verificando Uso do computador…",
    selectAction: "Selecionar janela…",
    selecting: "Aguardando o seletor de janelas do LinkSense…",
    pauseAction: "Pausar",
    pausing: "Pausando…",
    resumeAction: "Retomar",
    resuming: "Retomando…",
    renewAction: "Renovar por 5 minutos",
    renewing: "Renovando…",
    stopAction: "Parar",
    stopping: "Parando…",
    expiresIn: "Restam {{time}}",
    windowHint:
      "A janela é escolhida no aplicativo LinkSense. Este chat nunca lista nem captura janelas.",
    controlHint:
      "Pausar interrompe apenas o controle da interface. Parar encerra o Uso do computador desta tarefa neste Mac.",
    approvalQuestion: "Permitir esta ação de Uso do computador?",
    approvalClickQuestion: "Permitir clicar na janela aprovada?",
    approvalTypeQuestion: "Permitir digitar na janela aprovada?",
    permissionChecking: "Verificando a permissão de Acessibilidade…",
    permissionFailed:
      "Não foi possível verificar a permissão de Acessibilidade. Tente novamente.",
    permissionUnsupported:
      "Esta versão do LinkSense não pode orientar a permissão de Acessibilidade. Atualize o LinkSense e tente novamente.",
    permissionNotPackaged:
      "A orientação de permissões exige o aplicativo LinkSense empacotado.",
    errorBusy:
      "Outra tarefa está usando Uso do computador neste Mac. Tente novamente quando ela terminar.",
    errorTimeout:
      "Não foi possível confirmar o resultado do Uso do computador. O estado exibido pode estar desatualizado.",
    errorForbidden:
      "Esta tarefa não tem permissão para usar o Uso do computador.",
    errorTargetChanged:
      "A janela selecionada mudou. Selecione a janela novamente.",
    errorStaleScope: "Este controle não se aplica mais à tarefa atual.",
    errorUnavailable:
      "Uso do computador não está disponível para esta tarefa neste Mac.",
    errorUnsupported: "Atualize o LinkSense para usar Uso do computador.",
    errorInvalidResponse:
      "O LinkSense não conseguiu ler o estado de Uso do computador. Tente novamente.",
    errorFailed: "Uso do computador não respondeu. Tente novamente.",
    retry: "Tentar novamente",
  },
  "fr-FR": {
    title: "Utilisation de l’ordinateur",
    descriptionIdle:
      "Contrôlez une fenêtre d’application sur ce Mac pour cette tâche. Choisissez la fenêtre dans le sélecteur LinkSense.",
    descriptionActive:
      "L’assistant peut utiliser la fenêtre que vous avez approuvée. La pause arrête uniquement le contrôle de l’interface ; la tâche continue.",
    descriptionPaused:
      "Le contrôle de l’interface est en pause. La tâche continue sans utiliser vos applications. La reprise vérifie à nouveau la fenêtre.",
    descriptionRetiring:
      "Arrêt du contrôle de l’interface sur ce Mac. L’état final apparaîtra une fois terminé.",
    descriptionStopped:
      "Le contrôle de l’interface est arrêté sur ce Mac.",
    descriptionExpired:
      "L’autorisation de 5 minutes a expiré. Sélectionnez à nouveau la fenêtre pour continuer.",
    descriptionUnavailable:
      "L’utilisation de l’ordinateur n’est pas disponible pour cette tâche sur ce Mac.",
    statusIdle: "Non démarré",
    statusActive: "Actif",
    statusPaused: "En pause",
    statusRetiring: "Arrêt…",
    statusStopped: "Arrêté",
    statusExpired: "Expiré",
    statusUnavailable: "Indisponible",
    statusChecking: "Vérification",
    checking: "Vérification de l’utilisation de l’ordinateur…",
    selectAction: "Sélectionner une fenêtre…",
    selecting: "En attente du sélecteur de fenêtres LinkSense…",
    pauseAction: "Mettre en pause",
    pausing: "Mise en pause…",
    resumeAction: "Reprendre",
    resuming: "Reprise…",
    renewAction: "Renouveler pour 5 minutes",
    renewing: "Renouvellement…",
    stopAction: "Arrêter",
    stopping: "Arrêt…",
    expiresIn: "Reste {{time}}",
    windowHint:
      "La fenêtre est choisie dans l’application LinkSense. Ce chat ne liste ni ne capture jamais les fenêtres.",
    controlHint:
      "La pause arrête uniquement le contrôle de l’interface. L’arrêt met fin à l’utilisation de l’ordinateur pour cette tâche sur ce Mac.",
    approvalQuestion: "Autoriser cette action d’utilisation de l’ordinateur ?",
    approvalClickQuestion: "Autoriser les clics dans la fenêtre approuvée ?",
    approvalTypeQuestion: "Autoriser la saisie dans la fenêtre approuvée ?",
    permissionChecking: "Vérification de l’autorisation Accessibilité…",
    permissionFailed:
      "Impossible de vérifier l’autorisation Accessibilité. Réessayez.",
    permissionUnsupported:
      "Cette version de LinkSense ne peut pas guider l’autorisation Accessibilité. Mettez LinkSense à jour et réessayez.",
    permissionNotPackaged:
      "Le guide des autorisations nécessite l’application LinkSense empaquetée.",
    errorBusy:
      "Une autre tâche utilise l’utilisation de l’ordinateur sur ce Mac. Réessayez lorsqu’elle sera terminée.",
    errorTimeout:
      "Impossible de confirmer le résultat de l’utilisation de l’ordinateur. L’état affiché peut être obsolète.",
    errorForbidden:
      "Cette tâche n’est pas autorisée à utiliser l’utilisation de l’ordinateur.",
    errorTargetChanged:
      "La fenêtre sélectionnée a changé. Sélectionnez à nouveau la fenêtre.",
    errorStaleScope: "Ce contrôle ne s’applique plus à la tâche actuelle.",
    errorUnavailable:
      "L’utilisation de l’ordinateur n’est pas disponible pour cette tâche sur ce Mac.",
    errorUnsupported:
      "Mettez LinkSense à jour pour utiliser l’utilisation de l’ordinateur.",
    errorInvalidResponse:
      "LinkSense n’a pas pu lire l’état d’utilisation de l’ordinateur. Réessayez.",
    errorFailed: "L’utilisation de l’ordinateur n’a pas répondu. Réessayez.",
    retry: "Réessayer",
  },
  "ja-JP": {
    title: "コンピューター操作",
    descriptionIdle:
      "このタスクでこの Mac のアプリウィンドウを 1 つ操作します。LinkSense の選択画面でウィンドウを選んでください。",
    descriptionActive:
      "承認したウィンドウをアシスタントが使用できます。一時停止は GUI 操作だけを止め、タスクは続行します。",
    descriptionPaused:
      "GUI 操作は一時停止中です。タスクはアプリを使用せずに続行します。再開時にウィンドウを再確認します。",
    descriptionRetiring:
      "この Mac での GUI 操作を停止しています。完了すると最終状態が表示されます。",
    descriptionStopped: "この Mac での GUI 操作は停止しました。",
    descriptionExpired:
      "5 分間の承認が期限切れになりました。続行するにはウィンドウを選び直してください。",
    descriptionUnavailable:
      "この Mac ではこのタスクにコンピューター操作を利用できません。",
    statusIdle: "未開始",
    statusActive: "実行中",
    statusPaused: "一時停止中",
    statusRetiring: "停止しています…",
    statusStopped: "停止済み",
    statusExpired: "期限切れ",
    statusUnavailable: "利用不可",
    statusChecking: "確認中",
    checking: "コンピューター操作を確認しています…",
    selectAction: "ウィンドウを選択…",
    selecting: "LinkSense のウィンドウ選択画面を待っています…",
    pauseAction: "一時停止",
    pausing: "一時停止しています…",
    resumeAction: "再開",
    resuming: "再開しています…",
    renewAction: "5 分間の承認を更新",
    renewing: "承認を更新しています…",
    stopAction: "停止する",
    stopping: "停止しています…",
    expiresIn: "残り {{time}}",
    windowHint:
      "ウィンドウは LinkSense アプリで選択します。このチャットはウィンドウを一覧表示したりキャプチャしたりしません。",
    controlHint:
      "一時停止は GUI 操作だけを止めます。停止すると、この Mac でのこのタスクのコンピューター操作が終了します。",
    approvalQuestion: "このコンピューター操作を許可しますか？",
    approvalClickQuestion: "承認したウィンドウでのクリックを許可しますか？",
    approvalTypeQuestion: "承認したウィンドウでの文字入力を許可しますか？",
    permissionChecking: "アクセシビリティ権限を確認しています…",
    permissionFailed:
      "アクセシビリティ権限を確認できませんでした。もう一度お試しください。",
    permissionUnsupported:
      "このバージョンの LinkSense ではアクセシビリティ権限を案内できません。LinkSense を更新して再試行してください。",
    permissionNotPackaged:
      "権限の案内にはパッケージ版の LinkSense アプリが必要です。",
    errorBusy:
      "別のタスクがこの Mac でコンピューター操作を使用しています。終了してから再試行してください。",
    errorTimeout:
      "コンピューター操作の結果を確認できませんでした。表示されている状態が最新でない可能性があります。",
    errorForbidden: "このタスクにはコンピューター操作の権限がありません。",
    errorTargetChanged:
      "選択したウィンドウが変わりました。ウィンドウを選び直してください。",
    errorStaleScope: "このコントロールは現在のタスクには適用されません。",
    errorUnavailable:
      "この Mac ではこのタスクにコンピューター操作を利用できません。",
    errorUnsupported:
      "コンピューター操作を使用するには LinkSense を更新してください。",
    errorInvalidResponse:
      "コンピューター操作の状態を読み取れませんでした。再試行してください。",
    errorFailed: "コンピューター操作から応答がありません。再試行してください。",
    retry: "再試行",
  },
}
