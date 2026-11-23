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
    localComputerUnavailable: "这台 Mac 的本地任务当前不可用，暂时无法新建本地任务。",
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
  },
}
