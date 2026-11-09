export const modelSetupMessages = {
  "zh-CN": {
    discoveryCredentialsChanged:
      "连接设置已变更，请输入当前连接的 API Key 后获取模型列表。",
    imageDiscoveryHint:
      "从服务提供的模型列表中选择，或手动输入模型 ID。部分服务会返回其他类型的模型，请确认所选模型支持图片生成。",
    voiceDiscoveryHint:
      "从服务提供的模型列表中选择，或手动输入模型 ID。部分服务会返回其他类型的模型，请确认所选模型支持语音转文字。",
    protocolUnsupported:
      "当前地址没有匹配的协议，请确认 Base URL 或手动选择协议。",
    protocolProbeResults: "协议检测结果",
    protocolProbeSuccess: "{{seconds}} 秒",
    protocolProbeUnsupported: "不支持",
    protocolProbeInvalidResponse: "响应无效",
    protocolProbeFailed: "检测失败",
    detectProtocol: "检测协议",
    detectingProtocol: "正在检测协议…",
    protocolDetectionHint:
      "填写 Base URL 和 API Key 后自动检测；未指定模型时从模型列表选择。会发送最小请求，可能产生少量费用。",
    protocolDetected:
      "已选择 {{protocol}}（测试模型：{{model}}），保存后生效。",
    protocolModelRequired:
      "无法自动获取聊天模型，请填写用于测试的模型 ID 后重新检测。",
    advanced: "高级设置",
    advancedHint: "仅在需要调整协议、模型能力或计费时修改。",
    discover: "获取可用模型",
    discovering: "正在获取模型…",
    selectModel: "选择可用模型",
    searchModels: "搜索模型名称或 ID",
    noMatches: "没有匹配的模型",
    manual: "手动输入模型",
    discoveryHint: "先获取此服务提供的模型，或手动输入模型 ID。",
    manualRequired: "此服务不提供可用的模型列表，请手动输入模型 ID。",
    noModels: "服务未返回可用模型，请确认配置或手动输入。",
    truncated: "仅显示部分模型；找不到时可手动输入模型 ID。",
    metadataHint: "仅填入服务提供的信息；未提供的模型能力需要您确认。",
    contextKnown: "上下文长度：{{count}} Token",
    contextUnknown: "上下文长度：未提供",
    imagesKnown: "图片输入：{{value}}",
    imagesUnknown: "图片输入能力：未提供",
    yes: "支持",
    no: "不支持",
    pricingHint:
      "服务未提供价格。默认零价仅用于本地用量估算，请按实际费用核实并填写。",
    test: "测试模型连接",
    testing: "正在测试模型…",
    testModel: "用于测试的模型 ID",
    testHint:
      "发送一条简短消息，模型正常回复即表示连接成功。可能产生少量费用；测试不会保存设置。",
    testSuccess: "模型 {{model}} 已成功响应。此结果仅适用于当前设置。",
    testUnsupported: "此模型类型暂不支持连接测试。",
    credentialsChanged:
      "连接地址或供应商已更改，请输入此连接的密钥后再保存或测试。",
    compatibleEndpoint:
      "请填写可供任务使用的兼容服务地址，并使用模型测试确认可用。",
    retry: "重试",
  },
  "en-US": {
    discoveryCredentialsChanged:
      "The connection settings changed. Enter the API key for this connection to fetch its models.",
    imageDiscoveryHint:
      "Select a model from the service's list or enter its ID manually. Some services also list other model types; confirm that your selection supports image generation.",
    voiceDiscoveryHint:
      "Select a model from the service's list or enter its ID manually. Some services also list other model types; confirm that your selection supports speech-to-text.",
    protocolUnsupported:
      "No matching protocol found for this address. Check the base URL or select a protocol manually.",
    protocolProbeResults: "Protocol check results",
    protocolProbeSuccess: "{{seconds}} s",
    protocolProbeUnsupported: "Not supported",
    protocolProbeInvalidResponse: "Invalid response",
    protocolProbeFailed: "Check failed",
    detectProtocol: "Detect protocol",
    detectingProtocol: "Detecting protocol…",
    protocolDetectionHint:
      "Detection starts after you finish entering the Base URL and API key. If no model is specified, one is chosen from the model list. Minimal requests may incur a small charge.",
    protocolDetected: "Selected {{protocol}} using {{model}}. Save to apply.",
    protocolModelRequired:
      "A chat model could not be selected automatically. Enter a model ID to test, then detect again.",
    advanced: "Advanced settings",
    advancedHint:
      "Adjust only when you need to change the protocol, model capabilities, or billing.",
    discover: "Get available models",
    discovering: "Getting models…",
    selectModel: "Select an available model",
    searchModels: "Search model names or IDs",
    noMatches: "No matching models",
    manual: "Enter a model manually",
    discoveryHint:
      "Get the models offered by this service, or enter a model ID manually.",
    manualRequired:
      "This service does not offer an available model list. Enter a model ID manually.",
    noModels:
      "The service returned no available models. Check the settings or enter a model manually.",
    truncated:
      "Only some models are shown. Enter the model ID manually if it is missing.",
    metadataHint:
      "Only information supplied by the service is filled in. Confirm any unspecified model capabilities.",
    contextKnown: "Context length: {{count}} tokens",
    contextUnknown: "Context length: not provided",
    imagesKnown: "Image input: {{value}}",
    imagesUnknown: "Image input support: not provided",
    yes: "Supported",
    no: "Not supported",
    pricingHint:
      "The service did not provide prices. Default zero prices are for local usage estimates only. Check and enter the actual rates.",
    test: "Test model connection",
    testing: "Testing model…",
    testModel: "Model ID to test",
    testHint:
      "Send a short message. A normal reply confirms the connection works. A small charge may apply. Testing does not save settings.",
    testSuccess:
      "Model {{model}} responded successfully. This result applies only to the current settings.",
    testUnsupported: "Connection testing is not supported for this model type.",
    credentialsChanged:
      "The address or provider has changed. Enter the key for this connection before saving or testing.",
    compatibleEndpoint:
      "Enter a compatible service address for tasks, then run a model test to confirm it works.",
    retry: "Retry",
  },
  "es-ES": {
    discoveryCredentialsChanged:
      "Los ajustes de conexión cambiaron. Introduzca la clave API de esta conexión para obtener sus modelos.",
    imageDiscoveryHint:
      "Seleccione un modelo de la lista del servicio o introduzca su ID manualmente. Algunos servicios incluyen otros tipos de modelos; confirme que el elegido permite generar imágenes.",
    voiceDiscoveryHint:
      "Seleccione un modelo de la lista del servicio o introduzca su ID manualmente. Algunos servicios incluyen otros tipos de modelos; confirme que el elegido permite transcribir voz.",
    protocolUnsupported:
      "No se encontró ningún protocolo compatible con esta dirección. Comprueba la URL base o selecciona un protocolo manualmente.",
    protocolProbeResults: "Resultados de comprobación de protocolos",
    protocolProbeSuccess: "{{seconds}} s",
    protocolProbeUnsupported: "No compatible",
    protocolProbeInvalidResponse: "Respuesta no válida",
    protocolProbeFailed: "Error de comprobación",
    detectProtocol: "Detectar protocolo",
    detectingProtocol: "Detectando protocolo…",
    protocolDetectionHint:
      "La detección comienza al terminar de introducir la URL base y la clave API. Si no especifica un modelo, se elige uno de la lista. Las solicitudes mínimas pueden generar un pequeño coste.",
    protocolDetected:
      "Se seleccionó {{protocol}} con {{model}}. Guarde para aplicar.",
    protocolModelRequired:
      "No se pudo seleccionar un modelo de chat automáticamente. Introduzca un ID de modelo y vuelva a detectar.",
    advanced: "Ajustes avanzados",
    advancedHint:
      "Modifique estos ajustes solo para cambiar el protocolo, las capacidades del modelo o la facturación.",
    discover: "Obtener modelos disponibles",
    discovering: "Obteniendo modelos…",
    selectModel: "Seleccionar un modelo disponible",
    searchModels: "Buscar nombres o ID de modelos",
    noMatches: "No hay modelos coincidentes",
    manual: "Introducir un modelo manualmente",
    discoveryHint:
      "Obtenga los modelos de este servicio o introduzca un ID manualmente.",
    manualRequired:
      "Este servicio no ofrece una lista de modelos disponibles. Introduzca un ID manualmente.",
    noModels:
      "El servicio no devolvió modelos disponibles. Revise los ajustes o introduzca un modelo manualmente.",
    truncated:
      "Solo se muestran algunos modelos. Si falta el suyo, introduzca su ID manualmente.",
    metadataHint:
      "Solo se completa la información proporcionada por el servicio. Confirme las capacidades no especificadas.",
    contextKnown: "Longitud del contexto: {{count}} tokens",
    contextUnknown: "Longitud del contexto: no proporcionada",
    imagesKnown: "Entrada de imágenes: {{value}}",
    imagesUnknown: "Compatibilidad con imágenes: no proporcionada",
    yes: "Compatible",
    no: "No compatible",
    pricingHint:
      "El servicio no proporcionó precios. Los precios cero predeterminados solo sirven para estimaciones locales. Verifique e introduzca las tarifas reales.",
    test: "Probar conexión del modelo",
    testing: "Probando modelo…",
    testModel: "ID del modelo que se probará",
    testHint:
      "Envíe un mensaje breve. Una respuesta normal confirma que la conexión funciona. Puede tener un coste pequeño. La prueba no guarda los ajustes.",
    testSuccess:
      "El modelo {{model}} respondió correctamente. El resultado solo se aplica a los ajustes actuales.",
    testUnsupported: "Este tipo de modelo no admite pruebas de conexión.",
    credentialsChanged:
      "La dirección o el proveedor cambió. Introduzca la clave de esta conexión antes de guardarla o probarla.",
    compatibleEndpoint:
      "Introduzca una dirección de servicio compatible con las tareas y pruebe el modelo para confirmar que funciona.",
    retry: "Reintentar",
  },
  "pt-BR": {
    discoveryCredentialsChanged:
      "As configurações de conexão mudaram. Informe a chave API desta conexão para obter os modelos.",
    imageDiscoveryHint:
      "Selecione um modelo da lista do serviço ou informe seu ID manualmente. Alguns serviços também listam outros tipos de modelos; confirme que o escolhido permite gerar imagens.",
    voiceDiscoveryHint:
      "Selecione um modelo da lista do serviço ou informe seu ID manualmente. Alguns serviços também listam outros tipos de modelos; confirme que o escolhido permite transcrever áudio.",
    protocolUnsupported:
      "Nenhum protocolo compatível encontrado para este endereço. Verifique a URL base ou selecione um protocolo manualmente.",
    protocolProbeResults: "Resultados da verificação de protocolos",
    protocolProbeSuccess: "{{seconds}} s",
    protocolProbeUnsupported: "Não suportado",
    protocolProbeInvalidResponse: "Resposta inválida",
    protocolProbeFailed: "Falha na verificação",
    detectProtocol: "Detectar protocolo",
    detectingProtocol: "Detectando protocolo…",
    protocolDetectionHint:
      "A detecção começa após preencher a URL base e a chave API. Se nenhum modelo for informado, um será escolhido da lista. As solicitações mínimas podem gerar uma pequena cobrança.",
    protocolDetected:
      "{{protocol}} selecionado usando {{model}}. Salve para aplicar.",
    protocolModelRequired:
      "Não foi possível selecionar um modelo de chat automaticamente. Informe um ID de modelo para teste e detecte novamente.",
    advanced: "Configurações avançadas",
    advancedHint:
      "Altere apenas quando precisar ajustar o protocolo, os recursos do modelo ou a cobrança.",
    discover: "Obter modelos disponíveis",
    discovering: "Obtendo modelos…",
    selectModel: "Selecionar um modelo disponível",
    searchModels: "Buscar nomes ou IDs de modelos",
    noMatches: "Nenhum modelo correspondente",
    manual: "Inserir um modelo manualmente",
    discoveryHint:
      "Obtenha os modelos deste serviço ou insira um ID manualmente.",
    manualRequired:
      "Este serviço não oferece uma lista de modelos disponíveis. Insira um ID manualmente.",
    noModels:
      "O serviço não retornou modelos disponíveis. Verifique as configurações ou insira um modelo manualmente.",
    truncated:
      "Apenas alguns modelos são exibidos. Se o desejado não aparecer, insira o ID manualmente.",
    metadataHint:
      "Somente as informações fornecidas pelo serviço são preenchidas. Confirme os recursos não especificados.",
    contextKnown: "Tamanho do contexto: {{count}} tokens",
    contextUnknown: "Tamanho do contexto: não informado",
    imagesKnown: "Entrada de imagens: {{value}}",
    imagesUnknown: "Suporte a imagens: não informado",
    yes: "Compatível",
    no: "Não compatível",
    pricingHint:
      "O serviço não informou preços. Os valores zero padrão servem apenas para estimativas locais. Confira e informe as tarifas reais.",
    test: "Testar conexão do modelo",
    testing: "Testando modelo…",
    testModel: "ID do modelo para teste",
    testHint:
      "Envie uma mensagem curta. Uma resposta normal confirma que a conexão funciona. Pode haver uma pequena cobrança. O teste não salva as configurações.",
    testSuccess:
      "O modelo {{model}} respondeu com sucesso. O resultado vale apenas para as configurações atuais.",
    testUnsupported: "Este tipo de modelo não permite testes de conexão.",
    credentialsChanged:
      "O endereço ou provedor mudou. Informe a chave desta conexão antes de salvar ou testar.",
    compatibleEndpoint:
      "Informe o endereço de um serviço compatível com tarefas e teste o modelo para confirmar que funciona.",
    retry: "Tentar novamente",
  },
  "fr-FR": {
    discoveryCredentialsChanged:
      "Les paramètres de connexion ont changé. Saisissez la clé API de cette connexion pour obtenir ses modèles.",
    imageDiscoveryHint:
      "Sélectionnez un modèle dans la liste du service ou saisissez son ID. Certains services proposent aussi d’autres types de modèles ; vérifiez que le modèle choisi permet de générer des images.",
    voiceDiscoveryHint:
      "Sélectionnez un modèle dans la liste du service ou saisissez son ID. Certains services proposent aussi d’autres types de modèles ; vérifiez que le modèle choisi permet de transcrire la parole.",
    protocolUnsupported:
      "Aucun protocole compatible trouvé pour cette adresse. Vérifiez l’URL de base ou sélectionnez un protocole manuellement.",
    protocolProbeResults: "Résultats de détection des protocoles",
    protocolProbeSuccess: "{{seconds}} s",
    protocolProbeUnsupported: "Non pris en charge",
    protocolProbeInvalidResponse: "Réponse invalide",
    protocolProbeFailed: "Échec de la vérification",
    detectProtocol: "Détecter le protocole",
    detectingProtocol: "Détection du protocole…",
    protocolDetectionHint:
      "La détection commence après la saisie de l’URL de base et de la clé API. Si aucun modèle n’est indiqué, un modèle est choisi dans la liste. Ces requêtes minimales peuvent entraîner un faible coût.",
    protocolDetected:
      "{{protocol}} sélectionné avec {{model}}. Enregistrez pour appliquer.",
    protocolModelRequired:
      "Impossible de sélectionner automatiquement un modèle de chat. Saisissez un ID de modèle à tester, puis relancez la détection.",
    advanced: "Paramètres avancés",
    advancedHint:
      "Modifiez-les uniquement pour ajuster le protocole, les capacités du modèle ou la facturation.",
    discover: "Obtenir les modèles disponibles",
    discovering: "Récupération des modèles…",
    selectModel: "Sélectionner un modèle disponible",
    searchModels: "Rechercher un nom ou un ID de modèle",
    noMatches: "Aucun modèle correspondant",
    manual: "Saisir un modèle manuellement",
    discoveryHint:
      "Récupérez les modèles de ce service ou saisissez un ID manuellement.",
    manualRequired:
      "Ce service ne fournit pas de liste de modèles disponibles. Saisissez un ID manuellement.",
    noModels:
      "Le service n'a renvoyé aucun modèle disponible. Vérifiez les paramètres ou saisissez un modèle manuellement.",
    truncated:
      "Seuls certains modèles sont affichés. Si le vôtre manque, saisissez son ID manuellement.",
    metadataHint:
      "Seules les informations fournies par le service sont renseignées. Confirmez les capacités non précisées.",
    contextKnown: "Longueur du contexte : {{count}} tokens",
    contextUnknown: "Longueur du contexte : non fournie",
    imagesKnown: "Entrée d'images : {{value}}",
    imagesUnknown: "Prise en charge des images : non fournie",
    yes: "Prise en charge",
    no: "Non prise en charge",
    pricingHint:
      "Le service n'a pas fourni de tarifs. Les valeurs nulles par défaut servent uniquement aux estimations locales. Vérifiez et saisissez les tarifs réels.",
    test: "Tester la connexion du modèle",
    testing: "Test du modèle…",
    testModel: "ID du modèle à tester",
    testHint:
      "Envoyez un court message. Une réponse normale confirme que la connexion fonctionne. Des frais minimes peuvent s'appliquer. Le test n'enregistre pas les paramètres.",
    testSuccess:
      "Le modèle {{model}} a répondu. Ce résultat s'applique uniquement aux paramètres actuels.",
    testUnsupported: "Ce type de modèle ne permet pas de tester la connexion.",
    credentialsChanged:
      "L'adresse ou le fournisseur a changé. Saisissez la clé de cette connexion avant d'enregistrer ou de tester.",
    compatibleEndpoint:
      "Saisissez l'adresse d'un service compatible avec les tâches, puis testez le modèle pour vérifier son fonctionnement.",
    retry: "Réessayer",
  },
  "ja-JP": {
    discoveryCredentialsChanged:
      "接続設定が変更されました。この接続の API キーを入力してモデル一覧を取得してください。",
    imageDiscoveryHint:
      "サービスのモデル一覧から選ぶか、ID を手動で入力してください。他の種類のモデルも含まれる場合があるため、画像生成に対応しているか確認してください。",
    voiceDiscoveryHint:
      "サービスのモデル一覧から選ぶか、ID を手動で入力してください。他の種類のモデルも含まれる場合があるため、音声文字起こしに対応しているか確認してください。",
    protocolUnsupported:
      "このアドレスに一致するプロトコルが見つかりません。ベース URL を確認するか、プロトコルを手動で選択してください。",
    protocolProbeResults: "プロトコル検出結果",
    protocolProbeSuccess: "{{seconds}} 秒",
    protocolProbeUnsupported: "非対応",
    protocolProbeInvalidResponse: "応答が無効",
    protocolProbeFailed: "検出失敗",
    detectProtocol: "プロトコルを検出",
    detectingProtocol: "プロトコルを検出中…",
    protocolDetectionHint:
      "Base URL と API キーの入力完了後に自動検出します。モデル未指定の場合は一覧から選択します。最小限のリクエストでも少額の料金が発生する場合があります。",
    protocolDetected:
      "{{protocol}} を選択しました（テストモデル：{{model}}）。保存すると反映されます。",
    protocolModelRequired:
      "チャットモデルを自動選択できませんでした。テストするモデル ID を入力して再検出してください。",
    advanced: "詳細設定",
    advancedHint:
      "プロトコル、モデルの機能、料金を調整する場合のみ変更してください。",
    discover: "利用可能なモデルを取得",
    discovering: "モデルを取得中…",
    selectModel: "利用可能なモデルを選択",
    searchModels: "モデル名または ID を検索",
    noMatches: "一致するモデルがありません",
    manual: "モデルを手動で入力",
    discoveryHint:
      "このサービスのモデルを取得するか、モデル ID を手動で入力してください。",
    manualRequired:
      "このサービスはモデル一覧を提供していません。モデル ID を手動で入力してください。",
    noModels:
      "利用可能なモデルが返されませんでした。設定を確認するか、手動で入力してください。",
    truncated:
      "一部のモデルのみ表示しています。見つからない場合は ID を手動で入力してください。",
    metadataHint:
      "サービスが提供した情報のみ入力します。不明な機能はご確認ください。",
    contextKnown: "コンテキスト長：{{count}} トークン",
    contextUnknown: "コンテキスト長：情報なし",
    imagesKnown: "画像入力：{{value}}",
    imagesUnknown: "画像入力の対応状況：情報なし",
    yes: "対応",
    no: "非対応",
    pricingHint:
      "サービスは料金情報を提供していません。初期値のゼロはローカルの利用量見積もり用です。実際の料金を確認して入力してください。",
    test: "モデルの接続をテスト",
    testing: "モデルをテスト中…",
    testModel: "テストするモデル ID",
    testHint:
      "短いメッセージを送信し、モデルが正常に返信すれば接続成功です。少額の料金が発生する場合があります。設定は保存されません。",
    testSuccess:
      "モデル {{model}} が正常に応答しました。この結果は現在の設定にのみ有効です。",
    testUnsupported: "このモデルの種類では接続テストに対応していません。",
    credentialsChanged:
      "接続先またはプロバイダーが変更されました。保存またはテストする前に、この接続のキーを入力してください。",
    compatibleEndpoint:
      "タスクに対応した互換サービスの接続先を入力し、モデルをテストして利用できるか確認してください。",
    retry: "再試行",
  },
} as const
