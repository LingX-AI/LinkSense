import type { Locale } from "@linksense/shared"

type Messages = {
  title: string
  description: string
  enabled: string
  enabledHint: string
  provider: string
  endpoint: string
  endpointHint: string
  apiKey: string
  apiKeyHint: string
  engineId: string
  maxResults: string
  timeoutSeconds: string
  testQuery: string
  testHint: string
  test: string
  testSuccess: string
  saved: string
}

export const webSearchMessages = {
  "zh-CN": {
    title: "联网搜索",
    description: "配置任务中使用的搜索服务。用户无需单独提供密钥。",
    enabled: "启用联网搜索",
    enabledHint: "启用后，助手可以按需搜索公开网页。",
    provider: "搜索服务商",
    endpoint: "API 地址",
    endpointHint:
      "填写搜索服务的 HTTPS 地址。更换服务商或地址后，请重新填写密钥。",
    apiKey: "API Key",
    apiKeyHint:
      "圆点表示已保存密钥。留空可保留当前服务的密钥，输入新密钥可替换。",
    engineId: "搜索引擎 ID",
    maxResults: "默认返回条数",
    timeoutSeconds: "请求超时（秒）",
    testQuery: "测试搜索词",
    testHint:
      "测试会发送一次真实搜索请求，可能产生服务商费用；不会保存当前修改。",
    test: "测试连接",
    testSuccess: "测试完成，返回结果数：{{count}}。",
    saved: "联网搜索设置已保存。",
  },
  "en-US": {
    title: "Web search",
    description:
      "Configure the search service used in tasks. Users do not need their own API keys.",
    enabled: "Enable web search",
    enabledHint: "Let the assistant search public webpages when needed.",
    provider: "Search provider",
    endpoint: "API endpoint",
    endpointHint:
      "Enter the search service’s HTTPS address. Enter a new key after changing the provider or address.",
    apiKey: "API key",
    apiKeyHint:
      "Dots indicate a saved key. Leave blank to keep this service’s key, or enter a new key to replace it.",
    engineId: "Search engine ID",
    maxResults: "Default result limit",
    timeoutSeconds: "Request timeout (seconds)",
    testQuery: "Test query",
    testHint:
      "This sends a real search request and may incur provider charges. Your changes will not be saved.",
    test: "Test connection",
    testSuccess: "Test completed. Results returned: {{count}}.",
    saved: "Web search settings saved.",
  },
  "es-ES": {
    title: "Búsqueda web",
    description:
      "Configura el servicio de búsqueda de las tareas. Los usuarios no necesitan sus propias claves.",
    enabled: "Activar la búsqueda web",
    enabledHint:
      "Permite que el asistente busque páginas públicas cuando sea necesario.",
    provider: "Proveedor de búsqueda",
    endpoint: "Dirección de la API",
    endpointHint:
      "Introduce la dirección HTTPS del servicio. Si cambias el proveedor o la dirección, introduce una nueva clave.",
    apiKey: "Clave de API",
    apiKeyHint:
      "Los puntos indican que hay una clave guardada. Deja el campo vacío para conservar la clave de este servicio o introduce una nueva para sustituirla.",
    engineId: "ID del motor de búsqueda",
    maxResults: "Límite de resultados predeterminado",
    timeoutSeconds: "Tiempo de espera (segundos)",
    testQuery: "Consulta de prueba",
    testHint:
      "Envía una búsqueda real que puede generar cargos del proveedor. Los cambios no se guardarán.",
    test: "Probar conexión",
    testSuccess: "Prueba completada. Resultados devueltos: {{count}}.",
    saved: "Ajustes de búsqueda web guardados.",
  },
  "pt-BR": {
    title: "Pesquisa na web",
    description:
      "Configure o serviço de pesquisa das tarefas. Os usuários não precisam de suas próprias chaves.",
    enabled: "Ativar pesquisa na web",
    enabledHint:
      "Permita que o assistente pesquise páginas públicas quando necessário.",
    provider: "Provedor de pesquisa",
    endpoint: "Endereço da API",
    endpointHint:
      "Informe o endereço HTTPS do serviço. Ao alterar o provedor ou endereço, informe uma nova chave.",
    apiKey: "Chave de API",
    apiKeyHint:
      "Os pontos indicam uma chave salva. Deixe em branco para manter a chave deste serviço ou informe uma nova para substituí-la.",
    engineId: "ID do mecanismo de pesquisa",
    maxResults: "Limite padrão de resultados",
    timeoutSeconds: "Tempo limite (segundos)",
    testQuery: "Consulta de teste",
    testHint:
      "Envia uma pesquisa real e pode gerar cobranças do provedor. As alterações não serão salvas.",
    test: "Testar conexão",
    testSuccess: "Teste concluído. Resultados retornados: {{count}}.",
    saved: "Configurações de pesquisa na web salvas.",
  },
  "fr-FR": {
    title: "Recherche web",
    description:
      "Configurez le service de recherche des tâches. Les utilisateurs n’ont pas besoin de leur propre clé.",
    enabled: "Activer la recherche web",
    enabledHint:
      "Autorisez l’assistant à rechercher des pages publiques si nécessaire.",
    provider: "Fournisseur de recherche",
    endpoint: "Adresse de l’API",
    endpointHint:
      "Saisissez l’adresse HTTPS du service. Après un changement de fournisseur ou d’adresse, saisissez une nouvelle clé.",
    apiKey: "Clé API",
    apiKeyHint:
      "Les points indiquent qu’une clé est enregistrée. Laissez ce champ vide pour conserver la clé de ce service ou saisissez-en une nouvelle pour la remplacer.",
    engineId: "Identifiant du moteur de recherche",
    maxResults: "Nombre maximal de résultats par défaut",
    timeoutSeconds: "Délai d’attente (secondes)",
    testQuery: "Requête de test",
    testHint:
      "Ce test envoie une vraie recherche et peut entraîner des frais. Vos modifications ne seront pas enregistrées.",
    test: "Tester la connexion",
    testSuccess: "Test terminé. Nombre de résultats : {{count}}.",
    saved: "Paramètres de recherche web enregistrés.",
  },
  "ja-JP": {
    title: "ウェブ検索",
    description:
      "タスクで使う検索サービスを設定します。ユーザー自身のキーは不要です。",
    enabled: "ウェブ検索を有効にする",
    enabledHint: "必要に応じて、アシスタントが公開ウェブページを検索します。",
    provider: "検索プロバイダー",
    endpoint: "API アドレス",
    endpointHint:
      "検索サービスの HTTPS アドレスを入力してください。プロバイダーやアドレスを変更した場合は、新しいキーを入力してください。",
    apiKey: "API キー",
    apiKeyHint:
      "丸印はキーが保存済みであることを示します。空欄のままならこのサービスのキーを保持し、新しいキーを入力すると置き換えます。",
    engineId: "検索エンジン ID",
    maxResults: "既定の最大検索件数",
    timeoutSeconds: "タイムアウト（秒）",
    testQuery: "テスト検索語",
    testHint:
      "実際に検索するため、サービスの料金が発生する場合があります。変更内容は保存されません。",
    test: "接続をテスト",
    testSuccess: "テストが完了しました。検索結果数：{{count}}。",
    saved: "ウェブ検索設定を保存しました。",
  },
} satisfies Record<Locale, Messages>
