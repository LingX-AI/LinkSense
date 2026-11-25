import type { Locale } from "@linksense/shared"

const en = {
  title: "Sensitive data handling",
  adminDescription:
    "Choose when to check task content and which local models can process sensitive data.",
  userDescription:
    "Choose a local model and how you want to select it when a task needs protection.",
  enabled: "Enable sensitive data handling",
  saved: "Sensitive data settings saved.",
  enabledHelp: "Tasks that already use an approved local model run directly.",
  localModels: "Local models",
  localModelsHelp: "Select models hosted on your trusted network.",
  noModels: "Add a conversation model in Model settings first.",
  defaultModel: "Default local model",
  systemDefault: "Use the administrator’s default",
  chooseDefault: "Choose a default local model",
  timing: "When to check",
  atTurnStart: "At the start of each turn",
  atTurnStartHelp:
    "Check content available at the start of each turn. Files, knowledge base content, and tool results read during the turn may reach an external model without a check.",
  everyRequest: "Before each request to an external model",
  everyRequestHelp:
    "Check the content before each external request, including information read during a task. Tasks may take longer.",
  decisionModel: "Decision model",
  detectionPrompt: "Custom detection prompt",
  organizationPromptHelp:
    "Describe extra data to protect for everyone in your organization. This field is optional.",
  personalPromptHelp:
    "Describe extra data to protect in your tasks, such as internal project codenames. Leave blank to use the organization-wide rules.",
  endpoint: "Decision model service URL",
  endpointHelp: "Only System One compatible interfaces are supported.",
  modelId: "Decision model ID",
  key: "API_KEY",
  keySaved:
    "An API key is saved. Leave this blank to keep it for the same service and model.",
  keyOptional: "Enter the API key if the decision model service requires one.",
  invalidSettings:
    "Choose a local default model and fill in the decision service details.",
  disabled: "Your administrator has turned off sensitive data handling.",
  selection: "When a task needs a local model",
  ask: "Ask every time",
  askHelp: "Choose a model the first time each task needs local processing.",
  useDefault: "Use the default model",
  useDefaultHelp:
    "Use your preferred model, or the administrator’s default if yours is unavailable.",
  dialogTitle: "Choose a local model",
  dialogDescription:
    "To protect this task’s content, choose a local model to continue.",
  remember: "Remember my choice for future tasks",
  choose: "Continue with this model",
  later: "Choose later",
  processingLocally: "Sensitive · {{model}}",
  switchLocalModel: "Switch local model. Currently using {{model}}",
  nextTurnLocalModel: "The next turn will use {{model}}",
  localModelNoticeTitle: "This task requires handling sensitive data",
  switchedToLocalModel: "Switched to the local model {{model}}",
  hideLocalModelNotice: "Don’t show again",
}

export const sensitiveDataMessages = {
  "en-US": en,
  "zh-CN": {
    title: "敏感数据处理",
    adminDescription:
      "设置任务内容的检测时机，以及可以处理敏感数据的本地模型。",
    userDescription: "设置个人默认的本地模型，以及任务触发保护时的选模方式。",
    enabled: "启用敏感数据处理",
    saved: "敏感数据处理设置已保存。",
    enabledHelp: "已经使用获准本地模型的任务会直接运行。",
    localModels: "本地模型",
    localModelsHelp: "请选择部署在可信网络内的模型。",
    noModels: "请先在模型设置中添加对话模型。",
    defaultModel: "默认本地模型",
    systemDefault: "使用管理员设置的默认模型",
    chooseDefault: "请选择默认本地模型",
    timing: "检测时机",
    atTurnStart: "每轮开始前",
    atTurnStartHelp:
      "检查每轮开始时已有的内容。任务随后读取的文件、知识库资料和工具结果，可能未经检查就发送给外部模型。",
    everyRequest: "每次发送给外部模型前",
    everyRequestHelp:
      "每次发送前都检查内容，包括任务运行中读取的新资料。任务可能需要更长时间。",
    decisionModel: "决策模型",
    detectionPrompt: "自定义检测提示词",
    organizationPromptHelp: "补充组织内所有用户都需要保护的数据。此项可留空。",
    personalPromptHelp:
      "补充你希望在自己的任务中保护的数据，例如项目内部代号。留空时沿用全站规则。",
    endpoint: "决策模型服务地址",
    endpointHelp: "仅支持 System One 兼容接口。",
    modelId: "决策模型ID",
    key: "API_KEY",
    keySaved: "已保存 API_KEY。服务和模型相同时，留空即可保留原密钥。",
    keyOptional: "如果决策模型服务要求提供 API_KEY，请填写。",
    invalidSettings: "请选择默认本地模型，并填写决策服务信息。",
    disabled: "管理员当前关闭了敏感数据处理。",
    selection: "任务需要使用本地模型时",
    ask: "每次询问",
    askHelp: "每个任务首次需要本地处理时，由你选择模型。",
    useDefault: "使用默认模型",
    useDefaultHelp:
      "优先使用你的默认模型。该模型不可用时，使用管理员设置的默认模型。",
    dialogTitle: "选择本地模型",
    dialogDescription: "为了保护这项任务的内容，请选择一个本地模型继续。",
    remember: "以后记住这个选择",
    choose: "使用此模型继续",
    later: "稍后选择",
    processingLocally: "敏感 · {{model}}",
    switchLocalModel: "切换本地模型，当前使用 {{model}}",
    nextTurnLocalModel: "下一轮使用 {{model}}",
    localModelNoticeTitle: "检测到当前任务需要处理敏感数据",
    switchedToLocalModel: "已切换到本地模型 {{model}}",
    hideLocalModelNotice: "以后不再提示",
  },
  "es-ES": {
    title: "Tratamiento de datos sensibles",
    adminDescription:
      "Elige cuándo comprobar el contenido de las tareas y qué modelos locales pueden tratar datos sensibles.",
    userDescription:
      "Elige tu modelo local y cómo quieres seleccionarlo cuando una tarea necesite protección.",
    enabled: "Activar el tratamiento de datos sensibles",
    saved: "Se han guardado los ajustes de datos sensibles.",
    enabledHelp:
      "Las tareas que ya usan un modelo local autorizado se ejecutan directamente.",
    localModels: "Modelos locales",
    localModelsHelp: "Selecciona modelos alojados en una red de confianza.",
    noModels:
      "Añade primero un modelo de conversación en la configuración de modelos.",
    defaultModel: "Modelo local predeterminado",
    systemDefault: "Usar el modelo predeterminado del administrador",
    chooseDefault: "Elige un modelo local predeterminado",
    timing: "Cuándo comprobar",
    atTurnStart: "Al inicio de cada turno",
    atTurnStartHelp:
      "Comprueba el contenido disponible al inicio del turno. Los archivos, el contenido de bases de conocimiento y los resultados de herramientas obtenidos durante el turno podrían enviarse a un modelo externo sin comprobarse.",
    everyRequest: "Antes de cada solicitud a un modelo externo",
    everyRequestHelp:
      "Comprueba el contenido antes de cada solicitud externa, incluida la información obtenida durante la tarea. La tarea puede tardar más.",
    decisionModel: "Modelo de decisión",
    detectionPrompt: "Instrucciones de detección personalizadas",
    organizationPromptHelp:
      "Indica qué otros datos deben protegerse en toda la organización. Puedes dejar este campo vacío.",
    personalPromptHelp:
      "Indica qué otros datos quieres proteger en tus tareas, como los nombres en clave de proyectos. Si dejas el campo vacío, se aplicarán las reglas de la organización.",
    endpoint: "URL del servicio del modelo de decisión",
    endpointHelp: "Solo se admiten interfaces compatibles con System One.",
    modelId: "ID del modelo de decisión",
    key: "API_KEY",
    keySaved:
      "Hay una clave de API guardada. Deja el campo vacío para conservarla con el mismo servicio y modelo.",
    keyOptional:
      "Introduce la clave de API si el servicio del modelo de decisión la requiere.",
    invalidSettings:
      "Elige un modelo local predeterminado y completa los datos del servicio de decisión.",
    disabled:
      "El administrador ha desactivado el tratamiento de datos sensibles.",
    selection: "Cuando una tarea necesite un modelo local",
    ask: "Preguntar siempre",
    askHelp:
      "Elige un modelo la primera vez que cada tarea se deba procesar localmente.",
    useDefault: "Usar el modelo predeterminado",
    useDefaultHelp:
      "Usa tu modelo preferido. Si no está disponible, se usa el predeterminado del administrador.",
    dialogTitle: "Elige un modelo local",
    dialogDescription:
      "Para proteger el contenido de esta tarea, elige un modelo local para continuar.",
    remember: "Recordar mi elección en futuras tareas",
    choose: "Continuar con este modelo",
    later: "Elegir más tarde",
    processingLocally: "Datos sensibles · {{model}}",
    switchLocalModel:
      "Cambiar el modelo local. Actualmente se usa {{model}}",
    nextTurnLocalModel: "El próximo turno usará {{model}}",
    localModelNoticeTitle: "Esta tarea requiere tratar datos sensibles",
    switchedToLocalModel: "Se cambió al modelo local {{model}}",
    hideLocalModelNotice: "No volver a mostrar",
  },
  "pt-BR": {
    title: "Tratamento de dados sensíveis",
    adminDescription:
      "Defina quando verificar o conteúdo das tarefas e quais modelos locais podem tratar dados sensíveis.",
    userDescription:
      "Escolha seu modelo local e como selecioná-lo quando uma tarefa precisar de proteção.",
    enabled: "Ativar o tratamento de dados sensíveis",
    saved: "As configurações de dados sensíveis foram salvas.",
    enabledHelp:
      "Tarefas que já usam um modelo local aprovado são executadas diretamente.",
    localModels: "Modelos locais",
    localModelsHelp: "Selecione modelos hospedados na sua rede de confiança.",
    noModels:
      "Primeiro, adicione um modelo de conversa nas configurações de modelos.",
    defaultModel: "Modelo local padrão",
    systemDefault: "Usar o modelo padrão do administrador",
    chooseDefault: "Escolha um modelo local padrão",
    timing: "Quando verificar",
    atTurnStart: "No início de cada rodada",
    atTurnStartHelp:
      "Verifica o conteúdo disponível no início da rodada. Arquivos, conteúdo da base de conhecimento e resultados de ferramentas obtidos durante a rodada podem chegar a um modelo externo sem verificação.",
    everyRequest: "Antes de cada solicitação a um modelo externo",
    everyRequestHelp:
      "Verifica o conteúdo antes de cada solicitação externa, incluindo informações lidas durante a tarefa. A execução pode demorar mais.",
    decisionModel: "Modelo de decisão",
    detectionPrompt: "Instruções de detecção personalizadas",
    organizationPromptHelp:
      "Acrescente dados que devem ser protegidos em toda a organização. Este campo é opcional.",
    personalPromptHelp:
      "Acrescente dados que deseja proteger nas suas tarefas, como codinomes de projetos. Se deixar em branco, serão aplicadas as regras da organização.",
    endpoint: "URL do serviço do modelo de decisão",
    endpointHelp: "Apenas interfaces compatíveis com System One são aceitas.",
    modelId: "ID do modelo de decisão",
    key: "API_KEY",
    keySaved:
      "Uma chave de API está salva. Deixe o campo em branco para mantê-la no mesmo serviço e modelo.",
    keyOptional:
      "Informe a chave de API se o serviço do modelo de decisão exigir.",
    invalidSettings:
      "Escolha um modelo local padrão e preencha os dados do serviço de decisão.",
    disabled: "Seu administrador desativou o tratamento de dados sensíveis.",
    selection: "Quando uma tarefa precisar de um modelo local",
    ask: "Perguntar sempre",
    askHelp:
      "Escolha um modelo na primeira vez que cada tarefa precisar ser processada localmente.",
    useDefault: "Usar o modelo padrão",
    useDefaultHelp:
      "Usa o modelo que você preferir. Se ele estiver indisponível, usa o padrão do administrador.",
    dialogTitle: "Escolha um modelo local",
    dialogDescription:
      "Para proteger o conteúdo desta tarefa, escolha um modelo local para continuar.",
    remember: "Lembrar minha escolha para tarefas futuras",
    choose: "Continuar com este modelo",
    later: "Escolher mais tarde",
    processingLocally: "Dados sensíveis · {{model}}",
    switchLocalModel: "Trocar o modelo local. O modelo atual é {{model}}",
    nextTurnLocalModel: "A próxima rodada usará {{model}}",
    localModelNoticeTitle: "Esta tarefa precisa lidar com dados sensíveis",
    switchedToLocalModel: "O modelo local {{model}} está em uso",
    hideLocalModelNotice: "Não mostrar novamente",
  },
  "fr-FR": {
    title: "Traitement des données sensibles",
    adminDescription:
      "Définissez quand vérifier le contenu des tâches et quels modèles locaux peuvent traiter les données sensibles.",
    userDescription:
      "Choisissez votre modèle local et son mode de sélection lorsqu’une tâche doit être protégée.",
    enabled: "Activer le traitement des données sensibles",
    saved: "Les paramètres de données sensibles ont été enregistrés.",
    enabledHelp:
      "Les tâches qui utilisent déjà un modèle local autorisé sont exécutées directement.",
    localModels: "Modèles locaux",
    localModelsHelp:
      "Sélectionnez des modèles hébergés sur votre réseau de confiance.",
    noModels:
      "Ajoutez d’abord un modèle de conversation dans les paramètres des modèles.",
    defaultModel: "Modèle local par défaut",
    systemDefault: "Utiliser le modèle par défaut de l’administrateur",
    chooseDefault: "Choisissez un modèle local par défaut",
    timing: "Quand vérifier",
    atTurnStart: "Au début de chaque tour",
    atTurnStartHelp:
      "Vérifie le contenu disponible au début du tour. Les fichiers, les contenus de la base de connaissances et les résultats d’outils obtenus pendant le tour peuvent être envoyés à un modèle externe sans vérification.",
    everyRequest: "Avant chaque requête à un modèle externe",
    everyRequestHelp:
      "Vérifie le contenu avant chaque requête externe, y compris les informations lues pendant la tâche. L’exécution peut prendre plus de temps.",
    decisionModel: "Modèle de décision",
    detectionPrompt: "Instructions de détection personnalisées",
    organizationPromptHelp:
      "Indiquez les autres données à protéger dans toute l’organisation. Ce champ est facultatif.",
    personalPromptHelp:
      "Indiquez les autres données à protéger dans vos tâches, par exemple les noms de code des projets. Si ce champ est vide, les règles de l’organisation s’appliquent.",
    endpoint: "URL du service du modèle de décision",
    endpointHelp:
      "Seules les interfaces compatibles avec System One sont prises en charge.",
    modelId: "ID du modèle de décision",
    key: "API_KEY",
    keySaved:
      "Une clé d’API est enregistrée. Laissez ce champ vide pour la conserver avec le même service et le même modèle.",
    keyOptional:
      "Saisissez la clé d’API si le service du modèle de décision en exige une.",
    invalidSettings:
      "Choisissez un modèle local par défaut et renseignez le service de décision.",
    disabled:
      "Votre administrateur a désactivé le traitement des données sensibles.",
    selection: "Lorsqu’une tâche nécessite un modèle local",
    ask: "Toujours demander",
    askHelp:
      "Choisissez un modèle la première fois que chaque tâche doit être traitée localement.",
    useDefault: "Utiliser le modèle par défaut",
    useDefaultHelp:
      "Utilise votre modèle préféré, ou le modèle par défaut de l’administrateur si le vôtre est indisponible.",
    dialogTitle: "Choisir un modèle local",
    dialogDescription:
      "Pour protéger le contenu de cette tâche, choisissez un modèle local pour continuer.",
    remember: "Mémoriser mon choix pour les prochaines tâches",
    choose: "Continuer avec ce modèle",
    later: "Choisir plus tard",
    processingLocally: "Données sensibles · {{model}}",
    switchLocalModel: "Changer de modèle local. Le modèle actuel est {{model}}",
    nextTurnLocalModel: "Le prochain tour utilisera {{model}}",
    localModelNoticeTitle:
      "Cette tâche nécessite de traiter des données sensibles",
    switchedToLocalModel: "Modèle local {{model}} activé",
    hideLocalModelNotice: "Ne plus afficher",
  },
  "ja-JP": {
    title: "機密データの取り扱い",
    adminDescription:
      "タスクの内容を確認するタイミングと、機密データを扱えるローカルモデルを設定します。",
    userDescription:
      "保護が必要なタスクで使うローカルモデルと、その選択方法を設定します。",
    enabled: "機密データの保護を有効にする",
    saved: "機密データの設定を保存しました。",
    enabledHelp:
      "承認済みのローカルモデルをすでに使っているタスクは、そのまま実行されます。",
    localModels: "ローカルモデル",
    localModelsHelp:
      "信頼できるネットワークで稼働しているモデルを選択してください。",
    noModels: "先にモデル設定で対話モデルを追加してください。",
    defaultModel: "既定のローカルモデル",
    systemDefault: "管理者が設定した既定のモデルを使う",
    chooseDefault: "既定のローカルモデルを選択してください",
    timing: "確認のタイミング",
    atTurnStart: "各ターンの開始前",
    atTurnStartHelp:
      "ターン開始時点の内容を確認します。その後に読み取ったファイル、ナレッジベースの情報、ツールの結果は、確認されずに外部モデルへ送信されることがあります。",
    everyRequest: "外部モデルへの送信前に毎回",
    everyRequestHelp:
      "タスク中に読み取った情報も含め、外部モデルへ送信するたびに内容を確認します。処理に時間がかかる場合があります。",
    decisionModel: "判定モデル",
    detectionPrompt: "カスタム検出プロンプト",
    organizationPromptHelp:
      "組織全体で保護するデータを追加できます。入力は任意です。",
    personalPromptHelp:
      "プロジェクトの内部コード名など、自分のタスクで保護したいデータを追加できます。空欄の場合は組織のルールが適用されます。",
    endpoint: "判定モデルのサービスURL",
    endpointHelp: "System One 互換のインターフェースのみ利用できます。",
    modelId: "判定モデルのID",
    key: "API_KEY",
    keySaved:
      "API キーは保存済みです。同じサービスとモデルで引き続き使う場合は空欄にしてください。",
    keyOptional:
      "判定モデルのサービスで必要な場合は API キーを入力してください。",
    invalidSettings:
      "既定のローカルモデルを選び、判定サービスの情報を入力してください。",
    disabled: "管理者が機密データの保護を無効にしています。",
    selection: "タスクでローカルモデルが必要なとき",
    ask: "毎回確認する",
    askHelp:
      "各タスクで初めてローカル処理が必要になったときに、モデルを選びます。",
    useDefault: "既定のモデルを使う",
    useDefaultHelp:
      "自分の既定のモデルを使います。使えない場合は、管理者が設定した既定のモデルを使います。",
    dialogTitle: "ローカルモデルを選択",
    dialogDescription:
      "タスクの内容を保護するため、続行に使うローカルモデルを選んでください。",
    remember: "今後のタスクにこの選択を保存する",
    choose: "このモデルで続行",
    later: "後で選ぶ",
    processingLocally: "機密 · {{model}}",
    switchLocalModel: "ローカルモデルを切り替える。現在は {{model}} を使用中",
    nextTurnLocalModel: "次のターンでは {{model}} を使用します",
    localModelNoticeTitle: "このタスクには機密データの取り扱いが必要です",
    switchedToLocalModel: "ローカルモデル {{model}} に切り替えました",
    hideLocalModelNotice: "今後表示しない",
  },
} satisfies Record<Locale, Record<keyof typeof en, string>>
