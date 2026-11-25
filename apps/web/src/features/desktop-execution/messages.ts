import type { Locale } from "@linksense/shared"

type DesktopExecutionMessages = {
  defaultTarget: string
  defaultTargetDescription: string
  defaultTargetSaveFailed: string
  targetSelectorTitle: string
  targetSelectorDescription: string
  cloud: string
  cloudDescription: string
  cloudTargetUnavailable: string
  local: string
  localDescription: string
  localComputerUnavailable: string
  noTargetAvailable: string
  targetBadge: string
  deviceChecking: string
  deviceConnecting: string
  deviceOffline: string
  deviceUnpaired: string
  deviceRevoked: string
  deviceNotReady: string
  deviceStatusUnavailable: string
  deviceChanged: string
  deviceUnavailable: string
  manageDevices: string
  continueInCloud: string
  continueOnThisMac: string
  continuationTitle: string
  continuationDescription: string
  continuationOriginalAndFiles: string
  continuationReferenceNote: string
  continuationAuditAndReturn: string
  continuationDestinationCloud: string
  continuationDestinationLocal: string
  continuationConfirm: string
  continuationPending: string
  continuationFailed: string
  continuationUnsupported: string
  continuationReferenceUnavailable: string
  continuationInvalidResponse: string
}

export const desktopExecutionMessages: Record<
  Locale,
  DesktopExecutionMessages
> = {
  "zh-CN": {
    defaultTarget: "默认运行位置",
    defaultTargetDescription:
      "适用于在这台 Mac 上新建的任务。创建任务前仍可更改运行位置。",
    defaultTargetSaveFailed: "无法保存默认运行位置。请重试。",
    targetSelectorTitle: "运行位置",
    targetSelectorDescription: "选择新任务的运行位置。任务创建后不能再更改。",
    cloud: "云电脑",
    cloudDescription: "在云端隔离环境中运行任务。",
    cloudTargetUnavailable: "云电脑当前不可用，暂时无法新建云端任务。",
    local: "本地电脑",
    localDescription: "在这台 Mac 上运行任务。",
    localComputerUnavailable:
      "这台 Mac 的本地任务当前不可用，暂时无法新建本地任务。",
    noTargetAvailable: "云电脑和本地电脑当前都不可用，暂时无法新建任务。",
    targetBadge: "运行位置：{{target}}",
    deviceChecking: "正在检查这台 Mac 是否可用…",
    deviceConnecting: "正在连接这台 Mac…",
    deviceOffline: "这台 Mac 当前离线。请检查网络后重试。",
    deviceUnpaired: "这台 Mac 尚未配对。请先在设置中完成设备配对。",
    deviceRevoked: "此设备的访问权限已撤销。请在设置中重新配对。",
    deviceNotReady: "此版本的客户端无法运行本地任务。请更新 LinkSense 后重试。",
    deviceStatusUnavailable: "无法读取这台 Mac 的设备状态。请重试。",
    deviceChanged: "所选设备或任务页面已变化。请重试。",
    deviceUnavailable: "这台 Mac 当前无法运行本地任务。请检查设备状态后重试。",
    manageDevices: "管理设备",
    continueInCloud: "在云电脑中继续",
    continueOnThisMac: "在这台 Mac 上继续",
    continuationTitle: "在{{destination}}继续这个任务？",
    continuationDescription:
      "将在{{destination}}创建独立的新任务。当前任务保持原样。",
    continuationOriginalAndFiles:
      "原任务及其文件和产物仍保留在这里，不会同步到新任务。",
    continuationReferenceNote:
      "新任务从空白开始。如需让它读取你可见的文字，请把原任务作为引用发送。",
    continuationAuditAndReturn:
      "此次切换会写入审计日志。你可以随时返回原任务。",
    continuationDestinationCloud: "云电脑中",
    continuationDestinationLocal: "这台 Mac 上",
    continuationConfirm: "在{{destination}}继续",
    continuationPending: "正在创建新任务…",
    continuationFailed: "无法创建新任务。你的草稿和原任务均未更改。请重试。",
    continuationUnsupported:
      "此 LinkSense 版本不支持在其他运行位置继续任务。请更新 LinkSense 后重试。",
    continuationReferenceUnavailable:
      "这台 Mac 暂时无法读取原任务作为引用。请更新 Mac 上的 LinkSense 后重试。",
    continuationInvalidResponse:
      "服务器返回的任务与此请求不匹配，因此未打开。你的草稿和原任务均未更改。",
  },
  "en-US": {
    defaultTarget: "Default run location",
    defaultTargetDescription:
      "Applies to new tasks you create from this Mac. You can still change the run location before creating a task.",
    defaultTargetSaveFailed:
      "Couldn’t save the default run location. Try again.",
    targetSelectorTitle: "Run location",
    targetSelectorDescription:
      "Choose where new tasks run. This cannot be changed after the task is created.",
    cloud: "Cloud computer",
    cloudDescription: "Run tasks in an isolated cloud environment.",
    cloudTargetUnavailable:
      "Cloud computers aren’t available right now, so new cloud tasks can’t be started.",
    local: "This Mac",
    localDescription: "Run tasks on this Mac.",
    localComputerUnavailable:
      "Local tasks on this Mac aren’t available right now, so new local tasks can’t be started.",
    noTargetAvailable:
      "Neither cloud nor local tasks are available right now, so new tasks can’t be started.",
    targetBadge: "Run location: {{target}}",
    deviceChecking: "Checking whether this Mac is available…",
    deviceConnecting: "Connecting to this Mac…",
    deviceOffline: "This Mac is offline. Check the connection and try again.",
    deviceUnpaired: "This Mac isn’t paired yet. Pair it in settings first.",
    deviceRevoked:
      "Access for this device was revoked. Pair it again in settings.",
    deviceNotReady:
      "This version of the app can’t run local tasks. Update LinkSense and try again.",
    deviceStatusUnavailable:
      "Couldn’t read this Mac’s device status. Try again.",
    deviceChanged: "The selected device or task page changed. Try again.",
    deviceUnavailable:
      "This Mac can’t run local tasks right now. Check the device status and try again.",
    manageDevices: "Manage devices",
    continueInCloud: "Continue on the cloud computer",
    continueOnThisMac: "Continue on this Mac",
    continuationTitle: "Continue this task on {{destination}}?",
    continuationDescription:
      "A separate task will be created on {{destination}}. The current task stays exactly as it is.",
    continuationOriginalAndFiles:
      "The original task, its files, and its artifacts stay available here. They are not synchronized to the new task.",
    continuationReferenceNote:
      "The new task starts empty. Send the original task as a reference if you want it to read the text visible to you.",
    continuationAuditAndReturn:
      "The move is recorded in the audit log. You can return to the original task at any time.",
    continuationDestinationCloud: "the cloud computer",
    continuationDestinationLocal: "this Mac",
    continuationConfirm: "Continue on {{destination}}",
    continuationPending: "Creating new task…",
    continuationFailed:
      "Couldn’t create the new task. Your draft and the original task are unchanged. Try again.",
    continuationUnsupported:
      "This LinkSense version can’t continue tasks in another run location. Update LinkSense and try again.",
    continuationReferenceUnavailable:
      "This Mac can’t read the original task as a reference yet. Update LinkSense on the Mac, then try again.",
    continuationInvalidResponse:
      "The server returned a task that didn’t match this request, so it wasn’t opened. Your draft and the original task are unchanged.",
  },
  "es-ES": {
    defaultTarget: "Ubicación de ejecución predeterminada",
    defaultTargetDescription:
      "Se aplica a las tareas nuevas que crees desde este Mac. Puedes cambiar la ubicación antes de crear cada tarea.",
    defaultTargetSaveFailed:
      "No se pudo guardar la ubicación de ejecución predeterminada. Inténtalo de nuevo.",
    targetSelectorTitle: "Ubicación de ejecución",
    targetSelectorDescription:
      "Elige dónde se ejecutan las tareas nuevas. No se puede cambiar después de crear la tarea.",
    cloud: "Equipo en la nube",
    cloudDescription: "Ejecuta las tareas en un entorno aislado en la nube.",
    cloudTargetUnavailable:
      "Los equipos en la nube no están disponibles ahora mismo, así que no se pueden iniciar tareas nuevas en la nube.",
    local: "Este Mac",
    localDescription: "Ejecuta las tareas en este Mac.",
    localComputerUnavailable:
      "Las tareas locales en este Mac no están disponibles ahora mismo, así que no se pueden iniciar tareas locales nuevas.",
    noTargetAvailable:
      "Ni la nube ni las tareas locales están disponibles ahora mismo, así que no se pueden iniciar tareas nuevas.",
    targetBadge: "Ubicación de ejecución: {{target}}",
    deviceChecking: "Comprobando si este Mac está disponible…",
    deviceConnecting: "Conectando con este Mac…",
    deviceOffline:
      "Este Mac está desconectado. Comprueba la conexión e inténtalo de nuevo.",
    deviceUnpaired:
      "Este Mac aún no está vinculado. Vincula el dispositivo en Ajustes.",
    deviceRevoked:
      "Se ha revocado el acceso de este dispositivo. Vuelve a vincularlo en Ajustes.",
    deviceNotReady:
      "Esta versión de la aplicación no puede ejecutar tareas locales. Actualiza LinkSense e inténtalo de nuevo.",
    deviceStatusUnavailable:
      "No se pudo leer el estado de este Mac. Inténtalo de nuevo.",
    deviceChanged:
      "El dispositivo seleccionado o la página de la tarea ha cambiado. Inténtalo de nuevo.",
    deviceUnavailable:
      "Este Mac no puede ejecutar tareas locales ahora mismo. Comprueba el estado del dispositivo e inténtalo de nuevo.",
    manageDevices: "Gestionar dispositivos",
    continueInCloud: "Continuar en el equipo en la nube",
    continueOnThisMac: "Continuar en este Mac",
    continuationTitle: "¿Continuar esta tarea con {{destination}}?",
    continuationDescription:
      "Se creará una tarea independiente con {{destination}}. La tarea actual no cambiará.",
    continuationOriginalAndFiles:
      "La tarea original, sus archivos y sus artefactos siguen disponibles aquí. No se sincronizan con la tarea nueva.",
    continuationReferenceNote:
      "La tarea nueva empieza vacía. Envía la tarea original como referencia si quieres que lea el texto que ves.",
    continuationAuditAndReturn:
      "El cambio se registra en el registro de auditoría. Puedes volver a la tarea original en cualquier momento.",
    continuationDestinationCloud: "el equipo en la nube",
    continuationDestinationLocal: "este Mac",
    continuationConfirm: "Continuar con {{destination}}",
    continuationPending: "Creando la tarea nueva…",
    continuationFailed:
      "No se pudo crear la tarea nueva. Tu borrador y la tarea original no han cambiado. Inténtalo de nuevo.",
    continuationUnsupported:
      "Esta versión de LinkSense no puede continuar tareas en otra ubicación de ejecución. Actualiza LinkSense e inténtalo de nuevo.",
    continuationReferenceUnavailable:
      "Este Mac aún no puede leer la tarea original como referencia. Actualiza LinkSense en el Mac e inténtalo de nuevo.",
    continuationInvalidResponse:
      "El servidor devolvió una tarea que no coincide con esta solicitud, así que no se abrió. Tu borrador y la tarea original no han cambiado.",
  },
  "pt-BR": {
    defaultTarget: "Local de execução padrão",
    defaultTargetDescription:
      "Aplica-se às novas tarefas que você criar neste Mac. Você pode mudar o local de execução antes de criar cada tarefa.",
    defaultTargetSaveFailed:
      "Não foi possível salvar o local de execução padrão. Tente novamente.",
    targetSelectorTitle: "Local de execução",
    targetSelectorDescription:
      "Escolha onde as novas tarefas serão executadas. Isso não pode ser alterado depois que a tarefa é criada.",
    cloud: "Computador na nuvem",
    cloudDescription: "Execute tarefas em um ambiente isolado na nuvem.",
    cloudTargetUnavailable:
      "Os computadores na nuvem não estão disponíveis no momento, então não é possível iniciar novas tarefas na nuvem.",
    local: "Este Mac",
    localDescription: "Execute tarefas neste Mac.",
    localComputerUnavailable:
      "As tarefas locais neste Mac não estão disponíveis no momento, então não é possível iniciar novas tarefas locais.",
    noTargetAvailable:
      "Nem a nuvem nem as tarefas locais estão disponíveis no momento, então não é possível iniciar novas tarefas.",
    targetBadge: "Local de execução: {{target}}",
    deviceChecking: "Verificando se este Mac está disponível…",
    deviceConnecting: "Conectando a este Mac…",
    deviceOffline:
      "Este Mac está offline. Verifique a conexão e tente novamente.",
    deviceUnpaired:
      "Este Mac ainda não foi pareado. Pareie o dispositivo nas configurações.",
    deviceRevoked:
      "O acesso deste dispositivo foi revogado. Pareie-o novamente nas configurações.",
    deviceNotReady:
      "Esta versão do aplicativo não consegue executar tarefas locais. Atualize o LinkSense e tente novamente.",
    deviceStatusUnavailable:
      "Não foi possível ler o status deste Mac. Tente novamente.",
    deviceChanged:
      "O dispositivo selecionado ou a página da tarefa mudou. Tente novamente.",
    deviceUnavailable:
      "Este Mac não consegue executar tarefas locais agora. Verifique o status do dispositivo e tente novamente.",
    manageDevices: "Gerenciar dispositivos",
    continueInCloud: "Continuar no computador na nuvem",
    continueOnThisMac: "Continuar neste Mac",
    continuationTitle: "Continuar esta tarefa com {{destination}}?",
    continuationDescription:
      "Uma tarefa separada será criada com {{destination}}. A tarefa atual permanece exatamente como está.",
    continuationOriginalAndFiles:
      "A tarefa original, seus arquivos e artefatos continuam disponíveis aqui. Eles não são sincronizados com a nova tarefa.",
    continuationReferenceNote:
      "A nova tarefa começa vazia. Envie a tarefa original como referência se quiser que ela leia o texto visível para você.",
    continuationAuditAndReturn:
      "A mudança é registrada no log de auditoria. Você pode voltar à tarefa original a qualquer momento.",
    continuationDestinationCloud: "o computador na nuvem",
    continuationDestinationLocal: "este Mac",
    continuationConfirm: "Continuar com {{destination}}",
    continuationPending: "Criando nova tarefa…",
    continuationFailed:
      "Não foi possível criar a nova tarefa. Seu rascunho e a tarefa original não foram alterados. Tente novamente.",
    continuationUnsupported:
      "Esta versão do LinkSense não consegue continuar tarefas em outro local de execução. Atualize o LinkSense e tente novamente.",
    continuationReferenceUnavailable:
      "Este Mac ainda não consegue ler a tarefa original como referência. Atualize o LinkSense no Mac e tente novamente.",
    continuationInvalidResponse:
      "O servidor retornou uma tarefa que não corresponde a esta solicitação, então ela não foi aberta. Seu rascunho e a tarefa original não foram alterados.",
  },
  "fr-FR": {
    defaultTarget: "Emplacement d’exécution par défaut",
    defaultTargetDescription:
      "S’applique aux nouvelles tâches créées depuis ce Mac. Vous pouvez modifier l’emplacement avant de créer chaque tâche.",
    defaultTargetSaveFailed:
      "Impossible d’enregistrer l’emplacement d’exécution par défaut. Réessayez.",
    targetSelectorTitle: "Emplacement d’exécution",
    targetSelectorDescription:
      "Choisissez où les nouvelles tâches s’exécutent. Ce choix ne peut plus être modifié après la création de la tâche.",
    cloud: "Ordinateur cloud",
    cloudDescription: "Exécutez les tâches dans un environnement cloud isolé.",
    cloudTargetUnavailable:
      "Les ordinateurs cloud ne sont pas disponibles pour le moment, il est donc impossible de démarrer de nouvelles tâches cloud.",
    local: "Ce Mac",
    localDescription: "Exécutez les tâches sur ce Mac.",
    localComputerUnavailable:
      "Les tâches locales sur ce Mac ne sont pas disponibles pour le moment, il est donc impossible de démarrer de nouvelles tâches locales.",
    noTargetAvailable:
      "Ni le cloud ni les tâches locales ne sont disponibles pour le moment, il est donc impossible de démarrer de nouvelles tâches.",
    targetBadge: "Emplacement d’exécution : {{target}}",
    deviceChecking: "Vérification de la disponibilité de ce Mac…",
    deviceConnecting: "Connexion à ce Mac…",
    deviceOffline: "Ce Mac est hors ligne. Vérifiez la connexion et réessayez.",
    deviceUnpaired:
      "Ce Mac n’est pas encore associé. Associez l’appareil dans les réglages.",
    deviceRevoked:
      "L’accès de cet appareil a été révoqué. Réassociez-le dans les réglages.",
    deviceNotReady:
      "Cette version de l’application ne peut pas exécuter de tâches locales. Mettez LinkSense à jour et réessayez.",
    deviceStatusUnavailable: "Impossible de lire l’état de ce Mac. Réessayez.",
    deviceChanged:
      "L’appareil sélectionné ou la page de la tâche a changé. Réessayez.",
    deviceUnavailable:
      "Ce Mac ne peut pas exécuter de tâches locales pour le moment. Vérifiez l’état de l’appareil et réessayez.",
    manageDevices: "Gérer les appareils",
    continueInCloud: "Continuer sur l’ordinateur cloud",
    continueOnThisMac: "Continuer sur ce Mac",
    continuationTitle: "Continuer cette tâche avec {{destination}} ?",
    continuationDescription:
      "Une tâche distincte sera créée avec {{destination}}. La tâche actuelle reste inchangée.",
    continuationOriginalAndFiles:
      "La tâche d’origine, ses fichiers et ses artefacts restent disponibles ici. Ils ne sont pas synchronisés avec la nouvelle tâche.",
    continuationReferenceNote:
      "La nouvelle tâche commence vide. Envoyez la tâche d’origine comme référence si vous voulez qu’elle lise le texte que vous voyez.",
    continuationAuditAndReturn:
      "Ce changement est enregistré dans le journal d’audit. Vous pouvez revenir à la tâche d’origine à tout moment.",
    continuationDestinationCloud: "l’ordinateur cloud",
    continuationDestinationLocal: "ce Mac",
    continuationConfirm: "Continuer avec {{destination}}",
    continuationPending: "Création de la nouvelle tâche…",
    continuationFailed:
      "Impossible de créer la nouvelle tâche. Votre brouillon et la tâche d’origine sont inchangés. Réessayez.",
    continuationUnsupported:
      "Cette version de LinkSense ne peut pas poursuivre des tâches dans un autre emplacement d’exécution. Mettez LinkSense à jour et réessayez.",
    continuationReferenceUnavailable:
      "Ce Mac ne peut pas encore lire la tâche d’origine comme référence. Mettez LinkSense à jour sur le Mac, puis réessayez.",
    continuationInvalidResponse:
      "Le serveur a renvoyé une tâche qui ne correspond pas à cette demande ; elle n’a donc pas été ouverte. Votre brouillon et la tâche d’origine sont inchangés.",
  },
  "ja-JP": {
    defaultTarget: "デフォルトの実行場所",
    defaultTargetDescription:
      "この Mac から作成する新しいタスクに適用されます。タスクを作成する前なら実行場所を変更できます。",
    defaultTargetSaveFailed:
      "デフォルトの実行場所を保存できませんでした。もう一度お試しください。",
    targetSelectorTitle: "実行場所",
    targetSelectorDescription:
      "新しいタスクの実行場所を選択します。タスクの作成後は変更できません。",
    cloud: "クラウド PC",
    cloudDescription: "クラウドの分離された環境でタスクを実行します。",
    cloudTargetUnavailable:
      "クラウド PC は現在利用できないため、新しいクラウドタスクを開始できません。",
    local: "この Mac",
    localDescription: "この Mac でタスクを実行します。",
    localComputerUnavailable:
      "この Mac のローカルタスクは現在利用できないため、新しいローカルタスクを開始できません。",
    noTargetAvailable:
      "クラウド PC とローカルタスクのどちらも現在利用できないため、新しいタスクを開始できません。",
    targetBadge: "実行場所：{{target}}",
    deviceChecking: "この Mac が利用可能か確認しています…",
    deviceConnecting: "この Mac に接続しています…",
    deviceOffline:
      "この Mac はオフラインです。接続を確認して再試行してください。",
    deviceUnpaired:
      "この Mac はまだペアリングされていません。設定でデバイスをペアリングしてください。",
    deviceRevoked:
      "このデバイスのアクセスは取り消されました。設定で再ペアリングしてください。",
    deviceNotReady:
      "このバージョンのアプリではローカルタスクを実行できません。LinkSense を更新して再試行してください。",
    deviceStatusUnavailable:
      "この Mac のデバイス状態を読み取れませんでした。再試行してください。",
    deviceChanged:
      "選択したデバイスまたはタスクページが変更されました。再試行してください。",
    deviceUnavailable:
      "この Mac は現在ローカルタスクを実行できません。デバイスの状態を確認して再試行してください。",
    manageDevices: "デバイスを管理",
    continueInCloud: "クラウド PC で続行",
    continueOnThisMac: "この Mac で続行",
    continuationTitle: "{{destination}} でこのタスクを続行しますか？",
    continuationDescription:
      "{{destination}} に別のタスクを作成します。現在のタスクは変更されません。",
    continuationOriginalAndFiles:
      "元のタスクとそのファイル、成果物はここに残ります。新しいタスクには同期されません。",
    continuationReferenceNote:
      "新しいタスクは空の状態で始まります。表示されているテキストを読ませたい場合は、元のタスクを参照として送信してください。",
    continuationAuditAndReturn:
      "この移動は監査ログに記録されます。元のタスクにはいつでも戻れます。",
    continuationDestinationCloud: "クラウド PC",
    continuationDestinationLocal: "この Mac",
    continuationConfirm: "{{destination}} で続行",
    continuationPending: "新しいタスクを作成しています…",
    continuationFailed:
      "新しいタスクを作成できませんでした。下書きと元のタスクは変更されていません。再試行してください。",
    continuationUnsupported:
      "このバージョンの LinkSense では、別の実行場所でタスクを続行できません。LinkSense を更新して再試行してください。",
    continuationReferenceUnavailable:
      "この Mac ではまだ元のタスクを参照として読み取れません。Mac の LinkSense を更新して再試行してください。",
    continuationInvalidResponse:
      "サーバーから返されたタスクがこのリクエストと一致しないため、開きませんでした。下書きと元のタスクは変更されていません。",
  },
}
