export const applicationSetupJaJP = {
  title: "アプリ設定ガイド",
  description: "{{name}} に必要な機能を設定して、利用を開始しましょう。",
  progress: "{{total}} 項目中 {{completed}} 項目が準備完了",
  required: "必須",
  unnamed: "{{type}} {{number}}",
  selected: "現在の設定：{{name}}",
  choose: "自分のリソースを選択",
  chooseNamed: "{{name}} に使用する自分のリソースを選択",
  search: "利用可能なリソースを検索",
  manage: "リソースを作成・管理",
  credentials: "個人の認証情報を設定",
  modelDefault: "自分のモデル設定を使用",
  modelHelp:
    "アプリで使うモデルを選択するか、自分のモデル設定を使用してください。利用可能なモデルがない場合は管理者に連絡してください。",
  check: "再確認",
  later: "後で続ける",
  complete: "保存して設定を完了",
  use: "利用を開始",
  completed: "アプリの設定が完了しました。",
  ready: "必要な機能の準備が整いました。アプリを利用できます。",
  pending:
    "以下の必須項目を設定してください。選択するたびに保存されるので、後から続けられます。",
  activate:
    "必要な機能の準備が整いました。設定を完了すると、このアプリに反映されます。",
  note: "現在のリソースと認証設定を確認しています。外部サービスへの実際のアクセスは、サービスの稼働状況とアカウントの権限にも依存します。",
  newTab:
    "設定ページは新しいタブで開きます。設定後に戻ると状態が自動更新されます。「再確認」でも更新できます。",
  types: {
    plugin: "プラグイン",
    skill: "Skill",
    knowledge_base: "ナレッジベース",
    mcp_server: "MCP 接続",
    model: "モデル",
  },
  statuses: {
    configured: "準備完了",
    unconfigured: "未設定",
    unavailable: "現在利用不可",
    credentials_required: "認証情報の設定が必要",
  },
  purposes: {
    plugin:
      "このプラグインはアプリに操作機能を提供します。自分のアカウントの認証情報で、必要な認証を設定してください。",
    skill: "この Skill は、アプリのタスクに必要な手順や方法を提供します。",
    knowledge_base:
      "アプリが回答時に参照する資料を提供します。必要な資料を含む個人のナレッジベースを選択してください。",
    mcp_server:
      "アプリが必要な外部サービスやツールを利用できるようにします。設定済みの対応する接続を選択してください。",
  },
} as const
