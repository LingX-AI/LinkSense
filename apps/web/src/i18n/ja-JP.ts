import { samljaJP } from "@/features/saml/messages"
import type { enUS } from "@/i18n/en-US"
import type { TranslationResource } from "@/i18n/types"

export const jaJP = {
  saml: samljaJP,
  social: {
    disableHelp:
      "このプロバイダーを無効にすると、すべてのユーザーがこの方法でログインできなくなります。事前に別のログイン方法があることを確認してください。",
    setupPassword: "メールでパスワードを設定・再設定",
    title: "外部アカウント",
    configure: "設定する",
    configureProvider: "{{provider}} を設定",
    providerDescription: "{{provider}} で登録またはログインします。",
    statusEnabled: "有効",
    statusDisabled: "無効",
    statusNotConfigured: "未設定",
    description:
      "Google や Apple などのアカウントで登録・ログインできます。登録が許可されている場合、メール確認後に管理者の有効化なしで利用できます。既存ユーザーは先にログインしてアカウントを連携してください。",
    providers: {
      google: "Google",
      apple: "Apple",
      microsoft: "Microsoft 個人用アカウント",
      facebook: "Facebook",
      github: "GitHub",
    },
    continueWith: "{{provider}} で続行",
    available: "またはソーシャルアカウントを使用",
    enabled: "このプロバイダーでのログインを許可",
    clientId: "アプリ ID",
    clientSecret: "アプリシークレット",
    privateKey: "Apple 秘密鍵（.p8 ファイルの内容）",
    teamId: "Apple チーム ID",
    keyId: "Apple キー ID",
    graphVersion: "Facebook API バージョン",
    redirectUri: "認証コールバック URL",
    redirectHelp:
      "このアドレスをそのままプロバイダーの開発者コンソールにコピーしてください。",
    secretSaved: "保存済み。変更しない場合は空欄にしてください",
    secretEmpty: "プラットフォームから発行されたシークレットを入力",
    saved: "設定を保存しました",
    guide: "開発者コンソールを開く",
    credentialsHelp:
      "シークレットはログインの検証にのみ使用され、保存後は表示されません。公開前にテスト用アカウントで動作を確認してください。",
    microsoftHelp:
      "個人の Microsoft アカウントを許可するアカウントの種類を選択してください。職場アカウントには企業向け SSO を使用してください。",
    appleHelp:
      "Services ID をアプリ ID として使用し、チーム ID、キー ID、秘密鍵を設定してください。HTTPS 対応のウェブサイトが必要です。",
    facebookHelp:
      "Facebook Login を有効にし、開発者コンソールで選択中の API バージョン（vXX.0）を入力してください。",
    googleHelp:
      "ウェブアプリケーション用の OAuth クライアントを作成し、認証コールバック URL を設定してください。",
    githubHelp:
      "GitHub の開発者設定で OAuth App を作成し、Client ID と Client Secret を入力してください。このコールバックアドレスを Authorization callback URL に設定してください。",
    bindings: "連携済みのソーシャルアカウント",
    bindingsHelp:
      "アカウントを連携すると、既存のプロフィールにログインできます。メールアドレスが一致していても自動的には統合されません。",
    link: "{{provider}} を連携",
    unlink: "連携を解除",
    linked: "連携済み",
    unavailable: "現在、連携できるプロバイダーはありません。",
    unlinkTitle: "このソーシャルアカウントの連携を解除しますか？",
    unlinkDescription:
      "再ログインが必要になります。パスワードまたは別の利用可能なログイン方法があることを確認してください。",
    verifyTitle: "メールアドレスを確認",
    verifyDescription:
      "アカウント通知とパスワード復旧に使用するメールアドレスを確認します。この操作は初回登録時のみ必要です。",
    sendEmail: "確認メールを送信",
    emailSent:
      "メールを送信しました。15 分以内にこのブラウザーでリンクを開き、登録を完了してください。",
    finish: "確認して登録を完了",
    callbackTitle: "ソーシャルログインを完了",
    returnSettings: "アカウントのセキュリティに戻る",
    errors: {
      failed:
        "認証が完了していないか、有効期限が切れています。ログイン画面に戻って再試行してください。",
      disabled:
        "このアカウントは無効になっています。管理者にお問い合わせください。",
      email_exists:
        "このメールアドレスは既に使用されています。既存の方法でログインし、アカウントのセキュリティ設定からソーシャルアカウントを連携してください。",
      registration_disabled:
        "現在、新規登録は受け付けていません。アカウントをお持ちの場合は、ログインしてからこのソーシャルアカウントを連携してください。",
      last_method:
        "先にパスワードを設定するか、別の利用可能なログイン方法を連携してください。",
      already_linked:
        "このソーシャルアカウントは既に連携されているか、このプロバイダーの別のアカウントを連携済みです。",
      configuration_changed:
        "ログイン設定が変更されました。ログインを最初からやり直してください。",
    },
  },
  personalQuota: {
    title: "クレジット使用量",
    description: "クレジットの残高と使用量を確認します。",
    overview: "概要",
    analytics: "分析",
    weekly: "週間利用枠",
    weeklyDescription:
      "利用枠はシステムのタイムゾーンで毎週月曜日にリセットされます。リセット後も過去の使用状況を確認できます。",
    remaining: "残りのクレジット",
    used: "今週の使用量",
    limit: "週間上限",
    unlimited: "無制限",
    percentage: "{{value}}% 使用済み",
    reset: "次回のリセット：{{time}}（{{zone}}）",
    updated: "更新日時：{{time}} · {{zone}}",
    range: "期間",
    days: "{{count}} 日間",
    history: "クレジット使用履歴",
    historyDescription:
      "日ごとに消費したクレジットを用途またはモデル別に表示します。",
    group: "集計単位",
    byWorkload: "用途別",
    byModel: "モデル別",
    other: "その他",
    unknown: "不明",
    ranking: "タスク別使用量ランキング",
    rankingDescription:
      "この期間の使用クレジット順に表示します。タスクを展開すると詳細を確認できます。",
    task: "タスク",
    credits: "使用クレジット",
    unit: "クレジット",
    unattributed: "その他の使用量または削除済みタスク",
    openTask: "タスクを開く",
    more: "さらに表示",
    empty: "この期間の記録はありません",
    tools: "プラグインと MCP の呼び出し",
    toolsDescription:
      "失敗を含む完了したツール呼び出しを、プラグインまたは MCP サーバー別に集計します。課金額ではなく実行回数を示します。",
    skills: "スキルの使用状況",
    skillsDescription:
      "スキルごとの使用回数です。同じスキルは 1 ターンにつき 1 回として数えます。",
    messages: "メッセージ",
    messagesDescription:
      "タスクのターンで送信されたユーザーメッセージをモデル別に集計します。AI の返信、待機中のメッセージ、分岐先にコピーされた履歴は含みません。",
  },
  webSites: {
    title: "マイサイト",
    description:
      "公開済みサイトの管理、コンテンツの更新、公開の停止をいつでも行えます。",
    share: "サイトとして公開",
    dialog: {
      share: "サイトとして公開",
      edit: "サイトを編集",
      publish: "更新を公開",
      delete: "サイトを削除",
    },
    shareDescription:
      "公開すると、リンクを知っているすべての人がこのサイトを閲覧できます。",
    deleteDescription:
      "サイトと公開済みバージョンは完全に削除されます。このアドレスは誰でも再利用できるようになります。元のタスクとファイルは保持されます。",
    name: "サイト名",
    summary: "説明",
    slug: "リンク名",
    slugPlaceholder: "空欄の場合は自動生成",
    slugHelp: "英数字またはハイフンで 3～80 文字にしてください。",
    slugChanged: "変更すると、古いリンクは直ちに無効になります。",
    url: "サイトのリンク",
    publishMode: "公開方法",
    updateExisting: "既存のサイトを更新",
    existingSite: "サイトを選択",
    selectExistingSite: "更新するサイトを選択",
    currentTask: "このタスクから",
    noUpdateTargets:
      "更新できるサイトはありません。「新しいサイト」を選択してください。",
    updateDescription:
      "既存のリンクを維持したまま、このウェブページでサイトを更新します。",
    updateDisabledDescription:
      "更新後もサイトは非公開のままです。「マイサイト」から再公開できます。",
    updatedDescription:
      "サイトのコンテンツを更新しました。既存のリンクは変更されません。",
    updateSite: "サイトを更新",
    newSite: "新しいサイト",
    sourceFile: "ウェブページ",
    latestSource: "最新：{{name}} · {{date}}",
    currentSource: "現在公開中：{{name}} · {{date}}",
    datedSource: "{{name}} · {{date}}",
    selectSource: "このタスクのウェブページを選択",
    noSources:
      "利用できるウェブページがありません。先に元のタスクで新しいバージョンを生成してください。",
    publishedTitle: "サイトを公開しました",
    updatedTitle: "サイトを更新しました",
    publishedDescription:
      "リンクをコピーしてサイトを共有できます。後から「マイサイト」で管理できます。",
    stillDisabled:
      "コンテンツを更新しましたが、サイトは非公開のままです。「マイサイト」から再公開してください。",
    copy: "リンクをコピー",
    copied: "リンクをコピーしました",
    copyFailed: "リンクをコピーできませんでした。手動でコピーしてください。",
    done: "完了",
    cancel: "キャンセル",
    delete: "サイトを削除",
    save: "保存",
    publish: "サイトを公開",
    search: "サイト名またはリンクを検索",
    filter: "公開状況",
    status: {
      all: "すべてのステータス",
      published: "公開済み",
      disabled: "非公開",
    },
    empty: "公開済みサイトはまだありません",
    emptyDescription:
      "タスクで生成したウェブページを開いて「サイトとして公開」を選択すると、ここで管理できます。",
    noResults: "一致するサイトがありません",
    sourceTask: "作成元：{{title}}",
    sourceDeleted: "作成元のタスクは削除済みです",
    publishedAt: "公開日：{{date}}",
    resources: "{{count}} ファイル · {{size}}",
    visit: "サイトを開く",
    copyNamed: "{{name}} のリンクをコピー",
    actions: "{{name}} を管理",
    edit: "編集",
    update: "更新を公開",
    disable: "公開を停止",
    enable: "再公開",
    download: "ウェブサイトをダウンロード",
    loadMore: "さらに読み込む",
    invalidSlug:
      "英数字またはハイフンで 3～80 文字を入力してください。先頭と末尾にハイフンは使用できません。",
  },
  clientUpdate: {
    title: "システムが更新されました",
    description:
      "システムの更新があります。ページを再読み込みして続行してください。",
    update: "ページを更新",
    updating: "更新を確認中…",
    later: "後で更新",
    forceRefreshTitle: "キャッシュを無視して再読み込みする方法",
    windowsLabel: "Windows / Linux",
    windowsHelp: "Ctrl + Shift + R",
    macLabel: "Mac",
    macHelp: "⌘ + Shift + R または ⌘ + ⌥ + R",
    mobileLabel: "スマートフォン / タブレット",
    mobileHelp:
      "ページを開き直すか、このサイトのキャッシュを消去してください。",
    notReady:
      "更新を完了できませんでした。接続を確認し、少し待ってから再試行してください。現在のページは開いたままになっています。",
    loadFailed:
      "このページを読み込めませんでした。接続を確認して再試行してください。更新通知が表示されている場合は、先にページを更新してください。",
  },
  common: {
    dateRange: {
      label: "日付範囲",
      createdLabel: "作成日の範囲",
      lastRunLabel: "最終実行日の範囲",
      value: "{{from}} ～ {{to}}",
      clear: "{{label}}をクリア",
      selectStart: "開始日を選択し、次に終了日を選択してください。",
      selectEnd: "開始日：{{date}}。終了日を選択してください。",
    },
    close: "閉じる",
    notifications: "通知",
    cancel: "キャンセル",
    save: "保存",
    saving: "保存中…",
    create: "作成",
    update: "更新",
    delete: "削除",
    edit: "編集",
    confirm: "確認",
    gotIt: "了解",
    retry: "再試行",
    loadMore: "さらに読み込む",
    continue: "続行",
    search: "検索",
    loading: "読み込み中…",
    pageLoading: "読み込み中…",
    actions: "操作",
    status: "ステータス",
    name: "名前",
    description: "説明",
    view: "表示",
    email: "メールアドレス",
    type: "種類",
    scope: "範囲",
    createdAt: "作成日時",
    updatedAt: "更新日時",
    language: "言語",
    chinese: "简体中文",
    english: "English",
    spanish: "Español",
    portuguese: "Português (Brasil)",
    french: "Français",
    japanese: "日本語",
    settings: "設定",
    signOut: "ログアウト",
    empty: "データがありません",
    notAvailable: "利用できません",
    back: "戻る",
    details: "詳細",
    more: "その他の操作",
    moreActionsNamed: "{{name}}のその他の操作",
    enabled: "有効",
    disabled: "無効",
    active: "有効",
    system: "システム",
    user: "ユーザー",
    admin: "管理者",
    upload: "アップロード",
    download: "ダウンロード",
    previous: "前へ",
    next: "次へ",
    refresh: "更新",
    all: "すべて",
    select: "選択",
    notFound: "ページが見つかりません。",
    configured: "設定済み",
    notConfigured: "未設定",
    enable: "有効にする",
    disable: "無効にする",
    yes: "はい",
    no: "いいえ",
    copy: "コピー",
    copied: "コピーしました。",
    copyNamed: "{{name}}をコピー",
    clear: "クリア",
  },
  reasoningEffort: {
    minimal: "最小",
    low: "軽量",
    medium: "中",
    high: "高",
    xhigh: "非常に高い",
    max: "最大",
    ultra: "最高",
  },
  embed: {
    defaultDescription:
      "このアプリケーションと会話し、設定済みのすべての業務機能を利用できます。",
    waitingForHost: "ホストシステムによるアクセス許可を待っています…",
    authenticating: "安全なセッションを確立中…",
    startingPublicSession: "公開アクセス用セッションを作成中…",
    reconnecting: "再接続中…",
    starterQuestionsLabel: "おすすめの質問",
    history: "タスク一覧",
    historyEmpty: "タスクがありません",
    newConversation: "新しいタスク",
    deleteTaskLabel: "タスク「{{name}}」を削除",
    deleteTaskTitle: "タスクを完全に削除しますか？",
    deleteTaskDescription:
      "「{{name}}」のメッセージ、添付ファイル、結果は完全に削除され、復元できません。",
    deleteTaskConfirm: "完全に削除",
    deletingTask: "削除中…",
    inputLabel: "アプリケーションにメッセージを送信",
    inputPlaceholder: "メッセージを入力し、Enter キーで送信",
    attachFiles: "ファイルを添付",
    removeAttachment: "添付ファイル {{name}} を削除",
    uploading: "アップロード中…",
    send: "メッセージを送信",
    stop: "生成を停止",
    errors: {
      systemUnavailable:
        "システムの状態を一時的に取得できません。接続を確認して再試行してください。",
      requestFailed: "セッションを更新できませんでした。再試行してください。",
      authenticationFailed:
        "外部セッションを確立できませんでした。ホストシステムで再認証してください。",
      hostAuthenticationFailed:
        "外部ページのアクセスを確認できませんでした。アプリ ID とアプリシークレットを確認して再試行してください。",
      publicSessionFailed:
        "公開アクセス用セッションを作成できませんでした。アプリケーションが認証不要に設定されていることを確認してください。",
      submitFailed: "メッセージを送信できませんでした。再試行してください。",
      interruptFailed: "生成を停止できませんでした。再試行してください。",
      uploadFailed:
        "添付ファイルをアップロードできませんでした。ファイルを確認して再試行してください。",
      removeAttachmentFailed:
        "添付ファイルを削除できませんでした。再試行してください。",
      downloadFailed:
        "ファイルをダウンロードできませんでした。再試行してください。",
      answerFailed: "回答を送信できませんでした。再試行してください。",
      switchConversationFailed:
        "前のタスクを開けませんでした。再試行してください。",
      createConversationFailed:
        "新しいタスクを作成できませんでした。再試行してください。",
      deleteTaskFailed:
        "タスクを完全に削除できませんでした。再試行してください。",
    },
  },
  nav: {
    navigationLabel: "{{productName}}のナビゲーション",
    newConversation: "新しいタスク",
    automations: "自動化",
    conversations: "タスク",
    archived: "アーカイブ済みタスク",
    capabilities: "プラグインセンター",
    knowledgeBases: "リソースライブラリ",
    pinned: "ピン留め",
    projects: "プロジェクト",
    recent: "最近",
    administration: "管理",
    usage: "利用状況分析",
    users: "ユーザー",
    roles: "ロールと権限",
    groups: "ユーザーグループ",
    adminCapabilities: "プラグインセンター",
    adminKnowledgeBases: "ナレッジベース",
    adminKnowledgeSources: "ナレッジソース",
    audit: "監査ログ",
    feedback: "ユーザーフィードバック",
    usersAndGroups: "ユーザーとグループ",
    productSettings: "システム設定",
    health: "システム状態",
    open: "ナビゲーションを開く",
    collapseSidebar: "サイドバーを折りたたむ",
    expandSidebar: "サイドバーを展開",
    resizeSidebar: "サイドバーの幅を変更",
    helpCenter: "ヘルプセンター",
    helpCenterNewTab: "ヘルプセンターを新しいタブで開く",
    automationNotifications: "自動化通知",
    automationNotificationsUnread: "未読の完了タスクがある自動化通知",
    automationTask: "自動化タスク",
    unreadCompletion: "完了後、まだ確認されていないタスク",
    unreadFailure: "失敗後、まだ確認されていないタスク",
    creditQuotaRemainingTitle: "クレジット",
    creditQuotaRemaining: "{{weekly}}",
  },
  support: {
    menuLabel: "フィードバックとヘルプ",
    feedback: "フィードバック",
    help: "ヘルプ",
    feedbackTitle: "フィードバックを送信",
    feedbackDescription: "発生した問題や改善のご要望をお知らせください。",
    feedbackLabel: "フィードバック",
    feedbackPlaceholder:
      "フィードバックを入力するか、テキストや画像を貼り付けてください…",
    feedbackImagesLabel: "画像",
    feedbackImagesHint:
      "任意です。PNG、JPEG、WebP、GIF 形式で、1 枚 {{size}} MB 以下の画像を {{count}} 枚まで追加できます。入力欄に画像を直接貼り付けることもできます。",
    addFeedbackImages: "画像を追加",
    selectedFeedbackImages: "選択したフィードバック画像",
    removeFeedbackImage: "画像 {{name}} を削除",
    feedbackImageInvalid: "形式とサイズの条件を満たす画像を選択してください。",
    feedbackImageCountError: "画像は {{count}} 枚までアップロードできます。",
    submitFeedback: "送信",
    submittingFeedback: "送信中…",
    feedbackSubmitted: "フィードバックをお寄せいただき、ありがとうございます。",
  },
  automation: {
    title: "自動化",
    description:
      "繰り返しタスクやリマインダーを設定し、重要な情報を確認できます。",
    create: "新しい自動化",
    createTitle: "新しい自動化",
    editTitle: "自動化を編集",
    editorDescription: "実行する指示、使用するタスク、実行間隔を設定します。",
    resizeEditor: "自動化エディターのサイズを変更",
    empty: "自動化はまだありません",
    emptyDescription:
      "自動化を作成すると、指定したタスクで予定に沿って新しい実行を開始できます。",
    suggestions: {
      title: "おすすめ",
      useTemplateNamed: "「{{name}}」テンプレートを使用",
      dailyBrief: {
        title: "毎日のダイジェスト",
        schedule: "平日 08:00",
        description: "予定、未読メール、優先事項のまとめで平日の朝を始めます",
        instruction:
          "予定表、未読メール、優先事項を確認し、今日の予定、返信が必要なメッセージ、特に重要なタスクを簡潔な日次ダイジェストにまとめてください。",
      },
      weeklyReview: {
        title: "週間レビュー",
        schedule: "金曜日 16:00",
        description: "毎週金曜日に、その週の仕事を簡潔な進捗報告にまとめます",
        instruction:
          "今週の進捗、完了した作業、未完了の項目、来週の優先事項を確認し、簡潔な進捗報告にまとめてください。",
      },
      followUpMonitor: {
        title: "フォローアップの確認",
        schedule: "平日 09:00",
        description: "最近のメールと予定を確認し、対応が必要な項目を見つけます",
        instruction:
          "最近のメールと予定を確認してください。フォローアップが必要な項目、期限が近い項目、注意が必要な項目を見つけ、優先度別にまとめてください。",
      },
    },
    filterLabel: "自動化を絞り込む",
    filter: {
      all: "すべて",
      active: "有効",
      paused: "一時停止中",
    },
    filteredEmpty: "{{filter}}の自動化はありません",
    filteredEmptyDescription:
      "フィルターを切り替えると、ほかの自動化を確認できます。",
    name: "自動化のタイトル",
    instruction: "自動化の指示",
    instructionHint: "実行のたびに行うタスクの内容をすべて記述してください。",
    runIn: "実行先",
    task: "タスク",
    targetTask: "タスク",
    existingTask: "既存のタスク",
    newTask: "新しいタスク",
    existingTaskHint:
      "自分のアカウントが所有する、ピン留め済みで有効なタスクのみ選択できます。",
    newTaskHint:
      "最初にタスクを作成してピン留めし、それ以降の実行でも同じタスクを使用します。",
    noPinnedTasks:
      "選択できるタスクがありません。先にタスクをピン留めするか、「新しいタスク」を選択してください。",
    selectTask: "ピン留め済みタスクを選択",
    repeat: "繰り返し",
    interval: "間隔",
    intervalHint: "1～999 の数値を指定し、その{{unit}}間隔で実行します。",
    minuteOfHour: "実行する分",
    minuteOfHourHint:
      "0～59 を入力してください。例えば 15 を指定すると、各周期の 15 分に実行します。",
    time: "時刻",
    hour: "時",
    minute: "分",
    weekdays: "実行日",
    dayOfMonth: "日",
    monthOfYear: "月",
    invalidMonthDayHint: "指定した日がない月は実行しません。",
    monthOption: "{{month}}月",
    dayOption: "{{day}}日",
    expiresEnabled: "終了日を設定",
    expiresEnabledHint:
      "終了日当日は実行される場合があります。翌日から実行を停止します。",
    expiresOn: "終了日",
    expiresOnPlaceholder: "終了日を選択",
    clearExpiresOn: "終了日を解除",
    timeZone: "タイムゾーン {{timeZone}} で実行します。",
    modelOverride: "モデルと推論の強度を指定",
    modelOverrideHint:
      "有効にすると、選択したモデルと推論の強度で実行します。無効の場合はアカウントの既定設定を使用します。",
    modelOverrideUnavailable:
      "利用できるモデルがありません。管理設定でモデルプロバイダーを設定してください。",
    modelOverrideLoading: "利用可能なモデルを読み込み中…",
    modelLabel: "モデル",
    modelNotSelected: "モデルを選択",
    reasoningEffortLabel: "推論の強度",
    reasoningEffortNotSelected: "推論の強度を選択",
    nextRun: "次回の実行",
    lastRun: "前回の実行",
    nextRunRelative: "次回の実行：{{relative}}",
    lastRunRelative: "前回の実行：{{relative}}",
    lastRunFailed: "前回の実行に失敗しました",
    lastRunEmptyResult: "前回の実行に失敗しました：出力がありません",
    pause: "一時停止",
    resume: "再開",
    pauseNamed: "{{name}} を一時停止",
    resumeNamed: "{{name}} を再開",
    runNow: "今すぐ実行",
    runNowLoading: "自動化を実行中…",
    runNowStarted: "「{{name}}」を開始しました。",
    runNowQueued: "「{{name}}」をタスクの実行待ちに追加しました。",
    openTask: "タスクを開く",
    moreActionsNamed: "{{name}} のその他の操作",
    editNamed: "{{name}} を編集",
    deleteNamed: "{{name}} を削除",
    deleteTitle: "自動化を削除",
    deleteDescription:
      "「{{name}}」を削除しますか？関連するタスクと履歴は保持されます。",
    validation:
      "自動化の設定を入力し、数値、日付、時刻をすべて確認してください。",
    weekdaySeparator: "、",
    status: {
      active: "有効",
      paused: "一時停止中",
    },
    frequency: {
      hourly: "毎時",
      daily: "毎日",
      weekly: "毎週",
      monthly: "毎月",
      yearly: "毎年",
    },
    unit: {
      hourly: "時間",
      daily: "日",
      weekly: "週",
      monthly: "か月",
      yearly: "年",
    },
    weekday: {
      "1": "月",
      "2": "火",
      "3": "水",
      "4": "木",
      "5": "金",
      "6": "土",
      "7": "日",
    },
    schedule: {
      hourly: "{{interval}} 時間ごとの {{minute}} 分に実行",
      daily: "{{interval}} 日ごとの {{time}} に実行",
      weekly: "{{interval}} 週間ごと、{{weekdays}}の {{time}} に実行",
      monthly: "{{interval}} か月ごと、{{day}} 日の {{time}} に実行",
      yearly: "{{interval}} 年ごと、{{month}} 月 {{day}} 日の {{time}} に実行",
    },
  },
  quotaManagement: {
    save: "設定を保存",
    title: "利用枠の管理",
    description:
      "全メンバー共通の週間利用枠とクレジットの換算単価を管理します。",
    conversionTitle: "クレジット換算",
    conversionDescription:
      "モデルの利用料金をクレジットに換算します。単価の変更は変更後の使用分にのみ適用され、既存の消費量は変わりません。",
    creditPrice: "1 クレジットあたりの金額（人民元）",
    conversionExample:
      "例えば 1 クレジットが 0.01 元の場合、0.25 元の利用で 25 クレジットを消費します。",
    members: {
      actions: "メンバーの利用枠操作",
      reset: "全員の利用枠をリセット",
      resetDescription:
        "既存の全メンバーの週間利用枠を、それぞれの現在の上限の 100% に戻します。無制限のメンバーは無制限のままです。このフォームで未保存の上限は適用されません。使用履歴は保持され、その後の使用分は通常どおり差し引かれます。",
      title: "メンバーの週間利用枠",
      description:
        "今後、作成・インポート・自己登録されるメンバーの既定の週間利用枠です。右上のメニューから既存の全メンバーに適用できます。ユーザー管理から個別または一括で変更することもできます。",
    },
    weekly_credit_limit: "週間利用枠（クレジット）",
    weekly_credit_limit_hint:
      "システムのタイムゾーンで月曜日の午前 0 時にリセットされます。",
    unlimited: "無制限",
    invalidAmount:
      "小数点以下 6 桁以内、9,223,372,036,854.775807 以下の正の金額を入力してください。",
    applyMembers: "全員に上限を適用",
    applyDescription:
      "週間 {{weekly}} をメンバーの既定値として保存し、個別設定を含む既存の全メンバーの週間利用枠を上書きします。使用済みクレジットはリセットされず、フォームのほかの設定も変わりません。",
    confirmReset: "利用枠のリセットを確認",
    resetHint:
      "確定すると利用可能なクレジットが直ちに回復します。使用履歴は保持されます。",
    confirmApply: "保存して適用することを確認",
    resetSuccess: "{{count}} 人のメンバーの利用枠をリセットしました。",
    applySuccess: "新しい上限を保存し、{{count}} 人のメンバーに適用しました。",
    refreshFailed:
      "操作は完了しましたが、ページを更新できませんでした。再読み込みして最新の利用枠を確認してください。",
    saved: "利用枠の設定を保存しました。",
    enforcementHint:
      "空欄の場合は無制限です。週間上限に達すると新しいタスクを開始できませんが、実行中のタスクは継続します。消費量は 0.000001 クレジット単位で切り上げます。",
  },
  settings: {
    navigationLabel: "{{productName}}設定のナビゲーション",
    navigation: "設定ナビゲーション",
    backToApp: "{{productName}}に戻る",
    search: "設定を検索",
    personalGroup: "個人",
    administrationGroup: "管理",
    usageDescription: "タスク、ターン、トークンの使用量をモデル別に確認",
    general: "一般",
    generalDescription: "表示言語、メッセージ処理、ブラウザ通知",
    profile: "プロフィール",
    profileDescription: "プロフィールと個人の使用状況",
    personalization: "パーソナライズ",
    personalizationDescription: "カスタム指示とメモリ",
    appearance: "外観",
    appearanceDescription: "画面のテーマと文字サイズ",
    security: "セキュリティ",
    securityDescription: "ログインパスワードを変更",
    credentials: "プラグインの認証情報",
    credentialsDescription: "個人のプラグイン認証情報を管理",
    mcp: "MCP",
    mcpDescription: "個人の HTTP・STDIO MCP サーバーを管理",
    channelAccess: "メッセージチャネル",
    channelAccessDescription:
      "Weixin、WeCom、DingTalk、Teams、Feishu などのチャネルを管理",
    capabilitiesDescription:
      "プラグインセンターを閲覧し、個人のプラグインとスキルを管理",
    archivedDescription: "アーカイブ済みタスクを表示",
    usersDescription: "ユーザーアカウント、ロール、ステータスを管理",
    rolesDescription: "固定ロールと権限の範囲を確認",
    groupsDescription: "ユーザーグループとメンバーを管理",
    usersAndGroupsDescription:
      "ユーザーアカウント、ロール、ステータス、所属グループを管理",
    adminCapabilitiesDescription: "公開申請を審査し、プラグインセンターを管理",
    adminKnowledgeBasesDescription:
      "全ユーザーのナレッジベースを管理し、外部ソースを設定",
    adminKnowledgeSourcesDescription:
      "SharePoint などの外部ナレッジソースを設定",
    auditDescription: "全ユーザーの監査ログを検索",
    feedbackDescription:
      "ユーザーのフィードバックと問題のスクリーンショットを確認",
    modelSettings: "モデル設定",
    modelSettingsDescription: "モデルサービス、モデル、推論の強度を管理",
    systemSettings: "システム設定",
    systemSettingsDescription: "製品と認証の設定",
    systemHealth: "システム状態",
    systemHealthDescription: "サービスと依存サービスの状態",
    systemUpdate: "システム更新",
    systemUpdateDescription: "新しいリリースを確認し、安全な更新手順を確認",
    noResults: "検索条件に一致する設定はありません。",
    generalPageDescription:
      "自分のアカウントにのみ適用される表示設定を管理します。",
    interfaceLanguage: "表示言語",
    interfaceLanguageDescription: "アプリの表示言語",
    runningMessageAction: "実行中の新しいメッセージ",
    runningMessageActionDescription:
      "タスクの実行中に新しいメッセージを送信した場合、選択ダイアログを開かず、この設定に従って自動的に処理します。",
    runningMessageActionSteer: "現在の実行に指示を追加",
    runningMessageActionQueue: "次のリクエストとして待機",
    profilePageDescription: "表示名とアバターを更新します。",
    taskAutoNaming: "タスクの自動命名",
    taskAutoNamingDescription:
      "最初のメッセージでタスク名を付けるか、新しいメッセージごとに更新します。手動で編集した名前は変更されません。",
    taskAutoNamingFrequency: "命名の頻度",
    taskAutoNamingFirstMessage: "最初のメッセージ",
    taskAutoNamingEveryMessage: "すべてのメッセージ",
    taskAutoNamingSaved: "タスク名の設定を保存しました。",
    personalizationPageDescription:
      "タスク名、カスタム指示、メモリの設定を行います。",
    customInstructions: "カスタム指示",
    customInstructionsDescription:
      "今後のすべてのタスクに適用する補足の指示や背景情報を記述します。タスクのプラットフォームルールと安全上の制約が常に優先されます。",
    customInstructionsPlaceholder:
      "例：簡潔に回答し、最初に結論を述べてから必要な詳細を補足してください。",
    customInstructionsCount: "{{count}} / {{max}}",
    customInstructionsSaved: "カスタム指示を保存しました",
    unsavedChangesTitle: "未保存の変更を破棄しますか？",
    unsavedChangesDescription:
      "このページを離れると、未保存のカスタム指示は失われます。",
    stayOnPage: "ページにとどまる",
    discardChanges: "変更を破棄",
    memory: "メモリ",
    memoryDescription: "個人用メモリの作成、保持、利用方法を設定します。",
    enableMemories: "メモリを有効にする",
    enableMemoriesDescription:
      "タスクからメモリを作成し、今後のタスクで既存のメモリを利用します。外部ツールやウェブ情報を扱うタスクからはメモリを作成しません。",
    resetMemories: "メモリをリセット",
    resetMemoriesDescription:
      "すべてのメモリを削除します。タスク、カスタム指示、プラグイン、スキルは削除されません。",
    reset: "リセット",
    resetMemoriesConfirmTitle: "すべてのメモリをリセットしますか？",
    resetMemoriesConfirmDescription:
      "この操作は取り消せません。タスク、カスタム指示、プラグイン、スキルは保持されます。",
    resettingMemories: "メモリをリセット中…",
    memoriesReset: "メモリをリセットしました",
    appearancePageDescription:
      "{{productName}} の画面テーマと基本の文字サイズを設定します。",
    theme: "テーマ",
    themeSystem: "システム",
    themeLight: "軽量",
    themeDark: "ダーク",
    uiFontSize: "画面の文字サイズ",
    uiFontSizeDescription:
      "{{productName}} 全体の基本文字サイズを {{min}}～{{max}} px の範囲で調整します。",
    uiFontSizeUnit: "px",
    securityPageDescription:
      "ローカルログイン用のパスワードを変更し、既存のログインセッションを無効にします。",
  },
  botChannels: {
    connectionError:
      "アプリの認証情報、メッセージの権限、ネットワークを確認して再試行してください。",
    connect: "接続",
    disconnect: "{{name}} の接続を解除",
    settings: "設定を表示",
    setupTitle: "{{name}} に接続",
    save: "設定を保存",
    cancel: "キャンセル",
    confirmDisconnect: "接続を解除",
    retry: "再試行",
    account: "アプリまたはボットのアカウント",
    botId: "ボット ID",
    clientId: "アプリのクライアント ID",
    secret: "アプリシークレット",
    tenantId: "テナント ID",
    sender: "許可するメンバーの ID",
    groups:
      "このメンバーがグループでボットにメンションしてタスクを開始することを許可",
    callback: "メッセージングエンドポイント",
    callbackHelp:
      "この URL を Azure Bot のメッセージングエンドポイントに設定してください。HTTPS で外部からアクセスできる必要があります。",
    replaceHelp:
      "アプリまたはシークレットを変更するには、接続を解除してチャネルを再設定してください。",
    disconnectHelp:
      "接続を解除すると、このチャネルでの受信と返信が停止し、待機中のメッセージと返信が削除されます。既存の LinkSense タスクは保持されます。",
    invalid:
      "必須項目をすべて確認してください。Teams のアプリ ID、テナント ID、メンバー ID は有効な UUID である必要があります。",
    status: {
      connecting: "接続中",
      online: "オンライン",
      waiting_message: "メッセージを待機中",
      error: "接続エラー",
      disconnected: "未接続",
    },
    description: {
      wecom:
        "WeCom のインテリジェントボットで、ダイレクトメッセージとグループのメンションを受信します。",
      dingtalk:
        "DingTalk のアプリボットで、ダイレクトメッセージとグループのメンションを受信します。",
      teams:
        "Teams ボットで、ダイレクトメッセージとグループのメンションを受信します。",
    },
    setup: {
      wecom:
        "WeCom で API モードと常時接続を使用するインテリジェントボットを作成し、ID、シークレット、許可するメンバーを入力してください。",
      dingtalk:
        "DingTalk 開発者プラットフォームで組織内アプリを作成し、Stream ボットを有効にして公開し、個別・グループメッセージの権限を付与してください。",
      teams:
        "単一テナントの Azure Bot を作成し、Microsoft Teams を有効にしてください。保存後、Azure でメッセージングエンドポイントを設定し、Teams にボットアプリをインストールしてください。",
    },
    senderHelp: {
      wecom:
        "WeCom の連絡先一覧にあるメンバーの userid を入力してください。このメンバーのみがあなたの LinkSense アシスタントを使用できます。",
      dingtalk:
        "DingTalk 組織のメンバーの UserId を入力してください。このメンバーのみがあなたの LinkSense アシスタントを使用できます。",
      teams:
        "Microsoft Entra のユーザーオブジェクト ID を入力してください。このユーザーのみがあなたの LinkSense アシスタントを使用できます。",
    },
  },
  channelAccess: {
    title: "メッセージチャネル",
    description:
      "Weixin、WeCom、DingTalk、Teams、Feishu などのメッセージチャネルを接続・管理します。既定では LinkSense アシスタントがメッセージを処理します。",
    channelsLabel: "利用可能なチャネル",
    weixin: {
      name: "Weixin",
      description:
        "個人の Weixin 接続でメッセージを受信し、LinkSense アシスタントに渡します。",
      notConnected: "Weixin アカウントは接続されていません",
      accountConnected: "接続中のアカウント：{{account}}",
      scopeValue: "スキャンしたアカウントのみ · テキストと文字起こしされた音声",
      iconLabel: "Weixin のアイコン",
      connect: "接続",
      reconnect: "再接続",
      disconnect: "接続を解除",
      successDescription: "Weixin が LinkSense に接続されました。",
      connectedNotice: "Weixin に接続しました",
      disconnectedNotice: "Weixin の接続を解除しました",
      loginTitle: "Weixin に接続",
      loginDescription:
        "スマートフォンの Weixin でスキャンして確認してください。LinkSense はスキャンしたアカウントからのメッセージのみ処理します。",
      generatingQr: "Weixin の QR コードを生成中",
      qrCodeLabel: "Weixin 接続用 QR コード",
      verificationLabel: "Weixin に表示されたペアリングコード",
      submitVerification: "ペアリングコードを送信",
      generateAgain: "再生成",
      finish: "完了",
      disconnectTitle: "Weixin の接続を解除しますか？",
      disconnectDescription:
        "LinkSense は Weixin メッセージの受信と返信を停止します。既存の LinkSense タスクは保持されます。",
    },
    wecom: {
      name: "WeCom",
      description:
        "WeCom のメンバーや顧客からのメッセージを受信し、LinkSense アシスタントに渡します。",
    },
    dingtalk: {
      name: "DingTalk",
      description:
        "DingTalk の組織メッセージと共同作業の通知を受信し、LinkSense アシスタントに渡します。",
    },
    teams: {
      name: "Microsoft Teams",
      description:
        "Teams の個人またはチームのメッセージを受信し、LinkSense アシスタントに渡します。",
      scopeValue: "Teams のチャットとチャネルメッセージ",
    },
    feishu: {
      name: "Feishu",
      description:
        "Feishu ボットでメッセージを受信し、LinkSense アシスタントに渡します。",
      notConnected: "個人用 Feishu ボットは未作成です",
      scopeValue: "所有者のみ · 個別のテキストメッセージ",
      iconLabel: "Feishu のアイコン",
      connect: "接続",
      reconnect: "アクセス権を更新",
      disconnect: "接続を解除",
      successDescription:
        "ボットの認証情報を安全に保存しました。メッセージ接続を確立しています。",
      botCreated:
        "ボット「{{bot}}」を作成しました。メッセージ接続を確立しています",
      appUpdated:
        "Feishu アプリのアクセス権を更新しました。メッセージ接続を確立しています。",
      connectedNotice: "Feishu ボットを作成しました",
      updatedNotice: "Feishu アプリのアクセス権を更新しました",
      pendingApprovalNotice:
        "Feishu アプリを作成しました。管理者の承認を待っています",
      pendingApprovalUpdatedNotice:
        "Feishu アプリを更新しました。管理者の承認を待っています",
      pendingApprovalDescription:
        "再スキャンは不要です。管理者がアプリを承認すると、LinkSense が自動的に接続します。",
      disconnectedNotice: "Feishu の接続を解除しました",
      registrationTitle: "個人用 Feishu ボットを作成",
      registrationDescription:
        "Feishu でスキャンし、アクセスを許可してください。LinkSense が公式ボットを作成し、認証情報を安全に保存します。開発者コンソールでの設定は不要です。",
      reauthorizationTitle: "Feishu ボットのアクセス権を更新",
      reauthorizationDescription:
        "Feishu でスキャンし、追加のメッセージアクセスを許可してください。LinkSense は現在のボットを更新してメッセージ接続を設定します。重複するボットは作成しません。",
      generatingQr: "Feishu に作成用 QR コードをリクエスト中",
      qrCodeLabel: "Feishu ボット作成用 QR コード",
      generateAgain: "再生成",
      recoverExisting: "作成済みボットを接続",
      createWhenMissing: "アプリを削除しましたか？新しいアプリを作成",
      finish: "完了",
      disconnectTitle: "Feishu の接続を解除しますか？",
      disconnectDescription:
        "LinkSense は Feishu メッセージの受信と返信を停止します。公式ボットと既存の LinkSense タスクは保持されます。",
      registrationStatus: {
        generating_qr: "QR コードを生成中",
        waiting_scan: "Feishu でスキャンし、アクセスを許可してください",
        pending_approval: "アプリを作成しました。管理者の承認待ちです",
        pending_approval_update: "アプリを更新しました。管理者の承認待ちです",
        connected: "ボットを作成しました",
        updated: "Feishu アプリを更新しました",
        expired: "QR コードの有効期限が切れました",
        failed:
          "ボットは作成済みの可能性がありますが、接続設定が完了していません。再スキャンし、先ほど作成したボットを選択してください",
        update_failed:
          "Feishu アプリの更新が完了しませんでした。再スキャンしてやり直してください",
      },
    },
    scopeLabel: "メッセージの対象範囲",
    entryLabel: "接続方法",
    weixinEntryValue: "QR コードで接続",
    upcomingEntryValue: "公開待ち",
    unavailableAction: "まだ利用できません",
    status: {
      available: "利用可能",
      comingSoon: "近日公開",
      online: "オンライン",
      connecting: "接続中",
      pending_approval: "管理者の承認待ち",
      error: "接続エラー",
      reauthorization_required: "再接続が必要です",
    },
    loginStatus: {
      waiting_scan: "QR コードのスキャン待ち",
      scanned: "スキャン済みです。Weixin で接続を確認してください",
      verification_required:
        "Weixin に表示されたペアリングコードを入力してください",
      connected: "接続済み",
      expired: "QR コードの有効期限が切れました",
      failed: "接続が完了しませんでした。新しい QR コードを生成してください",
    },
  },
  browserNotifications: {
    settingsTitle: "ブラウザー通知",
    settingsDescription:
      "LinkSense を操作していないときに、通常のタスクや自動化が成功、失敗、中断すると、このブラウザーから通知します。",
    promptMessage: "タスク完了時にブラウザー通知と通知音でお知らせします。",
    promptDismiss: "今はしない",
    promptEnable: "有効にする",
    promptEnabling: "有効にしています",
    enable: "ブラウザー通知を有効にする",
    unsupported:
      "このブラウザーまたはホスト環境はブラウザー通知に対応していません。対応するブラウザーで安全な接続の LinkSense ページを開いてください。",
    permissionDenied:
      "ブラウザーが通知をブロックしています。ブラウザーのサイト権限で通知を許可してから、ここに戻って再試行してください。",
    permissionDismissed:
      "通知が許可されていません。もう一度有効にし、ブラウザーの確認画面で「許可」を選択してください。",
    permissionRequired:
      "有効にする設定は保存されていますが、ブラウザーの権限がリセットされました。ブラウザー通知を一度オフにし、再びオンにして権限を付与してください。",
    permissionError:
      "ブラウザー通知の許可を要求できませんでした。しばらくしてから再試行してください。",
    storageError:
      "このブラウザーに通知設定を保存できませんでした。このページの通知は停止しています。再読み込みし、スイッチの状態を確認してください。",
    deliveryError:
      "ブラウザーがシステム通知を作成できなかったため、通知はオフのままです。このサイトの権限と、OS におけるこのブラウザーの通知設定を確認してください。",
    feedError:
      "タスク完了通知サービスに接続できなかったため、通知はオフのままです。接続を確認して再試行してください。",
    testTitle: "{{productName}} · ブラウザー通知のテスト",
    testBody:
      "通知の接続が完了しました。タスクまたは自動化の結果が出ると、ここで通知します。",
    testSent:
      "システムにテスト通知を送信しました。表示されなかった場合は、OS におけるこのブラウザーの通知設定を確認してください。",
    notificationTitle: "{{productName}} · {{taskTitle}}",
    statusCompletedBody: "処理が完了しました",
    statusFailedBody: "処理に失敗しました",
    statusInterruptedBody: "処理が中断されました",
  },
  mcp: {
    title: "MCP サーバー",
    description:
      "個人用の Streamable HTTP・STDIO MCP サーバーを接続・管理します。有効な設定はすべて新しいタスクに自動で追加されます。",
    add: "サーバーを追加",
    empty: "個人用 MCP サーバーは設定されていません",
    emptyDescription:
      "リモートの Streamable HTTP エンドポイント、またはコンテナー内で動作する STDIO MCP サーバーを追加できます。",
    createTitle: "カスタム MCP に接続",
    editTitle: "MCP サーバーを編集",
    editorDescription:
      "MCP はプラグインとは独立しています。有効な設定は新しいタスクに自動で追加されます。",
    transportLabel: "接続の種類",
    transport: {
      streamable_http: "HTTP",
      stdio: "STDIO",
    },
    name: "名前",
    url: "サーバー URL",
    urlHint:
      "HTTP および HTTPS の Streamable HTTP MCP エンドポイントに対応しています。",
    stdioConfiguration: "STDIO 設定（JSON）",
    stdioConfigurationHint:
      "command、args、env を直接入力するか、サーバーを 1 つだけ含む mcpServers の JSON オブジェクトを貼り付けてください。env の値は暗号化されます。npx -y はタスクコンテナー内で管理される pnpm dlx に安全に変換されます。",
    stdioConfigurationEditHint:
      "保存済みの env の値は表示されません。env を省略すると保持され、指定すると置き換えられ、空のオブジェクトを指定すると削除されます。",
    stdioConfigurationInvalid:
      "サーバーを 1 つ含む有効な STDIO JSON を入力してください。command は必須です。args は文字列の配列、env は文字列の値を持つオブジェクトにしてください。",
    currentEnvironmentKeys: "現在の変数：{{keys}}",
    environmentCount: "環境変数 {{count}} 個",
    authentication: "認証",
    apiKeyHeader: "API キーのヘッダー",
    credential: "認証情報",
    credentialHint: "認証情報は暗号化して保存され、保存後は表示されません。",
    keepCredentialHint: "現在の認証情報を保持する場合は空欄にしてください。",
    startupTimeout: "起動タイムアウト（秒）",
    toolTimeout: "ツールのタイムアウト（秒）",
    httpWarningTitle: "HTTP 接続は安全ではありません",
    httpWarningDescription:
      "Bearer トークン、API キー、ツールの引数と結果は暗号化されずに送信されるため、通信途中で読み取られたり改ざんされたりするおそれがあります。",
    httpAcknowledgement:
      "暗号化されていない HTTP のリスクを理解し、同意します。",
    testConnection: "接続をテスト",
    testing: "{{name}} をテスト中",
    testSucceeded:
      "{{serverName}} に接続し、{{count}} 個のツールが見つかりました。",
    testStatus: {
      succeeded: "テスト成功",
      failed: "テスト失敗",
      untested: "未テスト",
    },
    testStatusLabel: "{{name}}：{{status}}",
    auth: {
      none: "認証なし",
      bearer: "Bearer トークン",
      api_key: "API キー",
    },
    toggle: "{{name}} を有効・無効にする",
    saved: "MCP サーバーを保存しました。",
    deleted: "MCP サーバーを削除しました。",
    deleteTitle: "この MCP サーバーを削除しますか？",
    deleteDescription:
      "サーバー設定、暗号化された認証情報と環境変数は完全に削除されます。新しいタスクからこのサーバーに接続できなくなります。",
  },
  bootstrap: {
    unavailableTitle: "{{productName}}は一時的に利用できません",
    unavailableDescription:
      "{{productName}}に接続できません。少し待ってから再試行してください。",
  },
  maintenance: {
    title: "システムメンテナンス",
    indicatorLabel: "システムメンテナンス中",
    dialogTitle: "システムメンテナンス中",
    dialogDescription:
      "現在、一般ユーザーはシステムにアクセスできません。管理者は引き続き利用および管理できます。作業が終わったらメンテナンスモードを解除してください。",
    reasonLabel: "メンテナンスの詳細",
    doNotShowAgain: "今後表示しない",
    rememberFailed:
      "設定を保存できませんでした。ブラウザでサイトデータが許可されているか確認してください。この通知は右上のボタンで閉じられます。",
    openSettings: "メンテナンス設定",
    defaultReason: "システムは定期メンテナンス中です。",
    description:
      "メンテナンスが終了すると、このページは自動的に復旧します。後でもう一度お試しください。",
    windowLabel: "メンテナンス予定時間",
    windowValue: "{{start}}～{{end}}",
    adminEntry: "管理者ログイン",
  },
  auth: {
    loginTitle: "{{productName}}にログイン",
    loginDescription: "利用可能なログイン方法を選んで続行してください。",
    passwordLogin: "メールアドレスとパスワード",
    password: "パスワード",
    signIn: "ログイン",
    signOutTitle: "ログアウトしますか？",
    signOutDescription:
      "{{productName}}を引き続き利用するには、再度ログインする必要があります。",
    forgotPassword: "パスワードを忘れた、または初めて設定する",
    forgotTitle: "パスワードの設定または再設定",
    forgotDescription:
      "メールアドレスを入力してください。対象のアカウントには安全なリンクが送信されます。",
    sendResetLink: "安全なリンクを送信",
    resetRequestSubmitted: "安全なリンクをリクエストしました",
    resetRequestFailed: "安全なリンクを送信できませんでした",
    resetAccepted:
      "対象のアカウントである場合、パスワード設定または再設定用のメールが送信されます。",
    resetTitle: "新しいパスワードを設定",
    resetDescription:
      "安全なリンクは一度だけ使用できます。ポリシーを満たすパスワードを設定してください。",
    newPassword: "新しいパスワード",
    currentPassword: "現在のパスワード",
    confirmPassword: "新しいパスワードを確認",
    showPassword: "{{field}}を表示",
    hidePassword: "{{field}}を非表示",
    resetPassword: "新しいパスワードを保存",
    resetCompleted: "パスワードを設定しました。もう一度ログインしてください。",
    changePassword: "パスワードを変更",
    passwordPolicy:
      "8～16文字で、大文字、小文字、数字、句読点または記号をそれぞれ含めてください。",
    oidc: "シングルサインオンを使用",
    teamsSigningIn: "Microsoft Teamsで自動ログイン中…",
    teamsNotConfigured:
      "Teamsのシングルサインオンが設定されていません。{{productName}}にログインしてください。",
    teamsFailed:
      "Teamsでログインできませんでした。再試行するか、別の方法を使用してください。",
    callbackTitle: "シングルサインオンを完了しています",
    oidcAccountPendingApproval:
      "シングルサインオンに成功しました。アカウントは作成され、管理者の承認待ちです。管理者に連絡し、有効化された後でもう一度ログインしてください。",
    externalAccountPendingApproval:
      "ログインに成功しました。アカウントは作成され、管理者の承認待ちです。管理者に連絡し、有効化された後でもう一度ログインしてください。",
    oidcCallbackFailed:
      "シングルサインオンを完了できませんでした。ログインページに戻って再試行してください。",
    oidcCallbackSessionFailed:
      "シングルサインオンは完了しましたが、{{productName}}のセッションを作成できませんでした。ログインページに戻って再試行してください。",
    backToLogin: "ログインに戻る",
    sessionExpired:
      "セッションの有効期限が切れました。もう一度ログインしてください。",
    sessionRestoreFailed:
      "ログインセッションを復元できませんでした。接続を確認して再試行してください。",
    registration: {
      createAccount: "アカウントを作成",
      title: "{{productName}}アカウントを作成",
      description:
        "メールアドレスを入力してください。対象の場合はアカウント有効化リンクを送信します。",
      closed: "現在、新規登録は受け付けていません。",
      disabled: "現在、新規登録は受け付けていません。",
      sendActivationLink: "有効化メールを送信",
      requestSubmitted: "有効化メールをリクエストしました",
      requestFailed: "有効化メールを送信できませんでした",
      requestAccepted:
        "対象のメールアドレスである場合、アカウント有効化メールが送信されます。",
      emailUnavailable:
        "有効化メールは一時的に利用できません。後でもう一度お試しください。",
      deliveryFailed:
        "有効化メールを送信できませんでした。後でもう一度お試しください。",
      activateTitle: "パスワードを設定してアカウントを有効化",
      activateDescription:
        "有効化リンクは一度だけ使用できます。ポリシーを満たすログインパスワードを設定してください。",
      activate: "アカウントを有効化してログイン",
      invalidOrExpired:
        "アカウント有効化リンクが無効か、有効期限が切れています。新しいリンクをリクエストしてください。",
      emailAlreadyRegistered:
        "このメールアドレスのアカウントは既に存在します。ログインするか、パスワードを再設定してください。",
    },
  },
  initialize: {
    title: "{{productName}} を初期設定",
    description:
      "最初の管理者を作成します。インフラとシークレットは引き続きデプロイ環境で管理します。",
    adminName: "管理者名",
    credential: "初期設定用のワンタイム認証情報",
    credentialHint:
      "インストール後にターミナルに表示されたワンタイム認証情報を入力してください。管理者が作成されると無効になります。",
    systemName: "システム名",
    submit: "管理者を作成して設定を完了",
    completed:
      "初期設定が完了しました。管理者アカウントでログインしてください。",
  },
  knowledgeSources: {
    title: "ナレッジソース",
    description:
      "外部ナレッジソースへの接続を一元管理します。外部ソースを使用するナレッジベースの作成・管理は管理者のみ行えます。",
    saved: "SharePoint ソースの設定を保存し、認証を確認しました。",
    secretConfigured:
      "シークレット設定済み。変更しない場合は空欄にしてください",
    sharepoint: {
      title: "Microsoft SharePoint",
      description:
        "Microsoft Graph のアプリ認証を使用し、許可されたサイトフォルダーのドキュメントを同期します。",
      enable: "SharePoint ソースを有効にする",
      enableDescription:
        "管理者はナレッジベース作成時に SharePoint フォルダーの URL を貼り付けられます。",
      tenantId: "ディレクトリ（テナント）ID",
      clientId: "アプリケーション（クライアント）ID",
      tenantDomain: "SharePoint テナントのドメイン",
      tenantDomainDescription:
        "このホストと完全一致するフォルダー URL のみ使用できます。例：contoso.sharepoint.com。",
      clientSecret: "クライアントシークレット",
      secretDescription:
        "シークレットは暗号化して保存され、応答やログには出力されません。",
      permissionTitle: "最小権限の要件",
      permissionDescription:
        "Sites.Selected を使用し、Microsoft 365 管理者に承認済みのサイトだけの読み取り権限を付与してもらってください。保存時にアプリの認証を検証し、ナレッジベース作成時には実際のフォルダーへのアクセスも検証します。",
    },
  },
  library: {
    title: "リソースライブラリ",
    description: "ナレッジとタスクの実行中に生成されたファイルを管理します。",
    tabsLabel: "リソースライブラリの内容",
    tabs: {
      knowledge: "ナレッジベース",
      artifacts: "タスクの成果物",
    },
    artifacts: {
      title: "タスクの成果物",
      description:
        "タスクで生成されたファイルをタスク別・時系列で閲覧し、ダウンロードしたり対応形式をプレビューしたりできます。",
      searchPlaceholder: "タスク名またはファイル名を検索…",
      fileTypeLabel: "ファイル形式で絞り込む",
      fileTypes: {
        all: "すべての種類",
        image: "画像",
        word: "Word",
        excel: "Excel",
        powerpoint: "PPT",
        html: "HTML",
        pdf: "PDF",
        archive: "アーカイブ",
        text: "テキスト",
        audio: "音声",
        video: "動画",
        other: "その他",
      },
      empty: "タスクの成果物はありません",
      emptyDescription:
        "タスクがダウンロード可能な成果物を生成して登録すると、ここに表示されます。",
      searchEmpty: "一致するタスクの成果物はありません",
      listLabel: "タスク成果物のタイムライン",
      archivedTask: "アーカイブ済み",
      previewAvailable: "プレビュー可能",
      downloadNamed: "{{name}} をダウンロード",
      loadingMore: "さらに読み込み中…",
      resizePreview: "タスク成果物のプレビューサイズを変更",
    },
  },
  knowledge: {
    title: "ナレッジベース",
    description: "アクセスできるドキュメントを整理・共有・検索します。",
    searchCapability: {
      notInstalledTitle: "Core にはナレッジベース機能が含まれていません",
      notInstalledDescription:
        "この環境は LinkSense Core を使用しています。ドキュメント解析とナレッジ検索を利用するには Full エディションをインストールしてください。",
      unavailableTitle: "ナレッジ検索を利用できません",
      unavailableDescription:
        "現在、ナレッジ検索を利用できません。プラグイン、スキル、添付ファイル、タスクの送信は通常どおり利用できます。しばらくしてから再試行してください。",
      dimensionMismatch:
        "ナレッジのインデックスが現在のデプロイ設定と一致していません。管理者が設定を確認し、手動で全体を再構築する必要があります。",
    },
    creationCapability: {
      unreadyTitle: "現在、ナレッジベースを作成できません",
      unreadyDescription:
        "ナレッジベースを作成するには、以下の条件が復旧する必要があります：",
      requestFailedTitle: "ナレッジベースの利用条件を確認できませんでした",
      requestFailedDescription:
        "サービスの確認が完了していません。ナレッジベースを作成する前に再確認してください。",
      notInstalledTitle:
        "このエディションにはナレッジベース機能が含まれていません",
      notInstalledDescription:
        "ナレッジベースを作成するには、この機能を含むエディションをインストールしてください。",
      retry: "再確認",
      checks: {
        objectStorageUnavailable: "ファイルストレージを一時的に利用できません",
        documentParsingUnavailable: "ドキュメント解析を一時的に利用できません",
        embeddingNotConfigured: "管理者が埋め込みモデルを設定していません",
        embeddingUnavailable: "埋め込みモデルサービスを一時的に利用できません",
        searchAndIndexingUnavailable:
          "ナレッジの検索とインデックス作成を一時的に利用できません",
      },
    },
    searchPlaceholder: "ナレッジベース名または説明を検索…",
    empty: "ナレッジベースがありません",
    loadMore: "さらに読み込む",
    noDescription: "説明なし",
    backToList: "ナレッジベースに戻る",
    overview: "ナレッジベースの概要",
    documents: "ドキュメント",
    documentsDescription:
      "ドキュメントをアップロードし、解析、分割、ベクトル化、インデックス作成の進行状況を確認します。",
    documentsEmpty: "ドキュメントがありません",
    directory: {
      breadcrumb: "ナレッジベースのディレクトリパス",
      root: "ルート",
      empty: "このフォルダーにドキュメントはありません",
      flatEmpty: "このナレッジベースとそのフォルダーにドキュメントはありません",
      viewMode: "ドキュメントの表示方法",
      directoryView: "フォルダー",
      flatView: "一覧",
      openFolder: "フォルダー {{name}} を開く",
      expandFolder: "フォルダー {{name}} を展開",
      collapseFolder: "フォルダー {{name}} を折りたたむ",
      showFolders: "フォルダーを表示",
      open: "開く",
      folder: "フォルダー",
    },
    documentCount: "{{count}} 件のドキュメント",
    readyCount: "{{count}} 件が検索可能",
    ownerNamed: "所有者：{{name}}",
    ownerNamedSelf: "所有者：{{name}}（自分）",
    updated: "更新日：{{date}}",
    sourceType: {
      label: "ソース：{{source}}",
      local: "ローカル",
      sharepoint: "SharePoint",
    },
    disabled: "ナレッジベースは無効になっています",
    disabledDescription:
      "このナレッジベースは現在利用できません。所有者または管理者にお問い合わせください。",
    archivedReadOnly:
      "このナレッジベースはアーカイブ済みで、読み取り専用です。ドキュメントや共有を管理するには復元してください。",
    lifecycle: {
      label: "ステータス",
      current: "現在",
      archived: "アーカイブ済み",
    },
    filter: {
      label: "ナレッジベースを絞り込む",
      all: "すべて",
    },
    scope: {
      label: "ナレッジベースの範囲",
      all: "すべて",
      owned: "自分が作成",
      shared: "自分と共有",
    },
    access: {
      owner: "自分が作成",
      direct: "自分に直接共有",
      group: "{{name}} 経由の共有",
      multiple: "{{count}} 件の共有元",
      shared: "自分と共有",
      unknownGroup: "不明なグループ",
      detailsAction: "共有元の詳細を表示",
      detailsTitle: "アクセス権の付与元",
      detailsDescription: "現在、以下の有効な共有元を通じてアクセスできます。",
      directSource: "個人への直接共有",
      groupSource: "ユーザーグループ：{{name}}",
    },
    create: {
      action: "ナレッジベースを作成",
      title: "ナレッジベースを作成",
      description:
        "作成後にドキュメントをアップロードし、必要に応じてユーザーやグループに共有できます。",
      name: "ナレッジベース名",
      optionalDescription: "説明（任意）",
      nameRequired: "ナレッジベース名を入力してください。",
      sourceType: "データソース",
      sourceLocal: "ローカルアップロード",
      sourceLocalDescription:
        "作成後にローカルのドキュメントをアップロードして管理します。",
      sourceSharePoint: "SharePoint フォルダー",
      sourceSharePointDescription:
        "SharePoint フォルダーを接続し、定期的に同期します。",
      sourceUnavailable: "有効になっていません",
      sharePointNotConfigured:
        "管理者が SharePoint ソースを有効にしていません。",
      sharePointUrl: "SharePoint フォルダーの URL",
      sharePointUrlHint:
        "SharePoint フォルダーの共有リンクと、サイト内フォルダーの直接 URL に対応しています。",
      sharePointUrlPlaceholder:
        "https://contoso.sharepoint.com/:f:/s/team/share-token",
      syncFrequencyLabel: "同期の頻度",
      syncFrequency: {
        daily: "毎日",
        weekly: "毎週",
        monthly: "毎月",
      },
      syncWeekdayLabel: "曜日",
      syncWeekday: {
        "1": "月",
        "2": "火",
        "3": "水",
        "4": "木",
        "5": "金",
        "6": "土",
        "7": "日",
      },
      syncDayOfMonth: "日",
      syncInvalidMonthDayHint: "指定した日がない月は実行しません。",
      syncDayOption: "{{day}}日",
      syncTime: "時刻",
      syncHour: "時",
      syncMinute: "分",
      syncTimeZone: "タイムゾーン {{timeZone}} で同期します。",
    },
    source: {
      title: "SharePoint の同期",
      syncNow: "今すぐ同期",
      retrySync: "同期を再試行",
      syncAccepted: "SharePoint の同期ジョブを送信しました。",
      status: {
        pending: "フォルダー {{folder}} は同期待ちです。",
        syncing: "フォルダー {{folder}} を同期中です。",
        ready: "フォルダー {{folder}} は同期済みです。",
        failed:
          "フォルダー {{folder}} の一部またはすべてのコンテンツを同期できませんでした。",
      },
      phase: {
        scanning: "SharePoint フォルダーをスキャン中",
        syncing: "SharePoint ファイルを同期中",
        processing: "ナレッジのドキュメントを処理中",
        completed: "同期が完了しました",
      },
      progress: {
        scanning: "フォルダーをスキャン中：{{count}} 件を検出",
        syncing: "ファイルを同期中（{{processed}}/{{total}}）",
        processing: "ドキュメントを処理中（{{processed}}/{{total}}）",
        completed: "同期が完了しました（{{processed}}/{{total}}）",
        discovered: "{{count}} 件を検出",
        summary:
          "{{processed}}/{{total}} 件を処理：作成 {{created}} 件、更新 {{updated}} 件、削除 {{deleted}} 件、スキップ {{skipped}} 件、再開 {{retried}} 件、失敗 {{failed}} 件。",
      },
      retryHint:
        "「同期を再試行」を選択すると、失敗したスキャンページまたはファイル処理の再開地点から続行します。",
    },
    edit: {
      title: "ナレッジベースの詳細を編集",
      description: "既存のドキュメントを再処理せずに、名前と説明を更新します。",
    },
    actions: {
      archive: "アーカイブ",
      restore: "復元",
      retryNamed: "{{name}} の処理を再試行",
      reprocessNamed: "{{name}} を再処理",
      rebuildNamed: "{{name}} のインデックスを再構築",
      cancelProcessing: "処理をキャンセル",
      reprocess: "再処理",
      rebuild: "インデックスを再構築",
      rebuildSelected: "選択項目を再構築",
      rebuildSelectedShort: "選択済み",
      rebuildAll: "すべてのドキュメントを再構築",
      rebuildAllShort: "すべて",
      rename: "名前を変更",
      removeDirectShare: "自分への直接共有を解除",
      documentMenu: "ドキュメント {{name}} を管理",
    },
    confirm: {
      archive: {
        title: "ナレッジベースをアーカイブしますか？",
        description:
          "アーカイブ後は読み取り専用になります。後から復元できます。",
      },
      restore: {
        title: "ナレッジベースを復元しますか？",
        description: "復元すると、アップロード、処理、共有を再び利用できます。",
      },
      delete_base: {
        title: "ナレッジベースを完全に削除しますか？",
        description:
          "この操作は取り消せません。削除できるのはアーカイブ済みのナレッジベースのみです。",
      },
      delete_document: {
        title: "ドキュメントを削除しますか？",
        description:
          "「{{name}}」、解析済みコンテンツ、インデックスデータを削除します。",
      },
      reprocess: {
        title: "ドキュメントを再処理しますか？",
        description: "「{{name}}」を現在の設定で再度解析・処理します。",
      },
      rebuild: {
        title: "ドキュメントのインデックスを再構築しますか？",
        description:
          "「{{name}}」を再度分割・ベクトル化し、現在のインデックスを置き換えます。",
      },
      rebuild_selected: {
        title: "選択したドキュメントのインデックスを再構築しますか？",
        description:
          "準備完了のドキュメントは再度分割・ベクトル化してインデックスを置き換えます。失敗したドキュメントは既存の失敗した候補から再開し、インデックスを完成させます。{{count}} 件のドキュメントを処理します。",
      },
      rebuild_all: {
        title:
          "このナレッジベースのすべてのドキュメントのインデックスを再構築しますか？",
        description:
          "準備完了のドキュメントは再度分割・ベクトル化してインデックスを置き換えます。失敗したドキュメントは既存の失敗した候補から再開し、インデックスを完成させます。",
      },
      remove_direct_share: {
        title: "自分への直接共有を解除しますか？",
        description:
          "自分に直接付与された個人向け共有を解除します。{{remainingAccess}}",
      },
    },
    deleteBlocked: {
      title: "現在、このナレッジベースは削除できません",
      description:
        "以下のアプリケーションからこのナレッジベースを解除してから、再度削除してください。",
      usagesTitle: "このナレッジベースを使用中のアプリケーション（{{count}}）",
      openApplications: "アプリケーションセンターを開く",
    },
    storage: {
      title: "ストレージ",
      description:
        "現行バージョン、アーカイブ済みコンテンツ、引用用または 30 日間保持される旧バージョン、処理失敗した元ファイル、削除待ちのオブジェクトはすべて容量を使用します。削除済みの表示でも、容量が解放済みとは限りません。",
      reserved: "{{size}} 予約済み",
    },
    events: {
      reconnecting:
        "進行状況のリアルタイム接続が中断され、再接続中です。定期更新は引き続き動作しています。",
    },
    document: {
      name: "ドキュメント",
      size: "サイズ",
      rebuildRequired: "再構築が必要",
      retryAt: "次回の再試行予定：{{date}}",
      retryWaitingFirst: "1 回目の自動再試行は {{date}} に再開します",
      retryWaitingSecond: "2 回目の自動再試行は {{date}} に再開します",
      selectAll: "現在読み込まれているすべてのドキュメントを選択",
      selectNamed: "ドキュメント {{name}} を選択",
      selectedCount: "{{count}} 件のドキュメントを選択中",
      rebuildBatchResult:
        "{{accepted}} 件のドキュメントを処理に送信しました。{{rejected}} 件は送信できませんでした。",
      candidateFailure:
        "この候補の処理は失敗しました。現在利用可能なバージョンは引き続き使用できます。",
      failureDetailsNamed: "ドキュメント {{name}} の処理失敗の詳細を表示",
      renameTitle: "ドキュメント名を変更",
      renameDescription:
        "表示名のみ変更します。ドキュメントの再解析や再ベクトル化は行いません。",
      displayName: "ドキュメント名",
      failure: {
        cancelled: "このタスクの処理は停止されました。",
        encrypted:
          "ドキュメントがパスワードで保護または暗号化されているため、処理できません。",
        unsupportedFormat: "このドキュメント形式の処理には対応していません。",
        officeConversionFailed:
          "ドキュメントを解析可能な形式に変換できませんでした。一般的なオフィスソフトで正常に開けるか確認してください。",
        tooLarge:
          "ドキュメントがファイルごとのサイズ上限を超えているため、処理できません。",
        storageQuota:
          "ナレッジベースのストレージ容量が不足しているため、処理を続行できません。",
        structureInvalid:
          "ドキュメントの構造または元データの網羅性の検証に失敗しました。",
        imageConfigurationChanged:
          "画像理解の設定が変更されました。現在の設定でドキュメントを再処理してください。",
        imageModelNotFound:
          "設定された画像理解モデルは存在しません。別の画像理解モデルを選択し、ドキュメントを再処理してください。",
        imageOutputInvalid:
          "画像理解モデルが有効な構造化説明を返しませんでした。モデルを確認して再試行してください。",
        imageThinkingNotDisabled:
          "画像モデルの思考機能が無効であることを確認できなかったため、安全のため処理を停止しました。",
        parsingServiceFailed:
          "ドキュメント解析サービスから利用可能な結果を取得できませんでした。再試行し、問題が続く場合は管理者にお問い合わせください。",
        parsingTaskExpired:
          "ドキュメント解析タスクの有効期限が切れ、自動再送信にも失敗しました。再試行し、問題が続く場合は管理者にお問い合わせください。",
        parsingInvalid:
          "解析済みドキュメントが整合性または安全性の検証に合格しませんでした。",
        configuration:
          "埋め込みまたはインデックスの設定がこのドキュメントと一致しません。デプロイ設定を確認して再試行してください。",
        serviceAuthentication:
          "外部処理サービスへの認証に失敗しました。管理者にデプロイ設定の確認を依頼してください。",
        serviceUnavailable:
          "ドキュメント処理に必要なサービスを利用できません。しばらくしてから再試行してください。",
        indexingFailed:
          "ナレッジのインデックスの書き込みまたは検証に失敗しました。しばらくしてから再試行してください。",
        busy: "別のタスクがこのドキュメントを処理中です。しばらくしてから再試行してください。",
        unknown:
          "ドキュメントの処理に失敗しました。再試行し、問題が続く場合は管理者にお問い合わせください。",
      },
      status: {
        processing: "処理中",
        ready: "検索可能",
        failed: "処理に失敗しました",
        deleted: "削除済み",
      },
      stage: {
        queued: "処理待ち",
        uploading: "アップロード中",
        validating: "検証中",
        parsing: "解析中",
        chunking: "子チャンクを生成中",
        image_understanding: "ドキュメント内の画像を解析中",
        parenting: "親チャンクを構築中",
        embedding: "埋め込みを生成中",
        indexing: "インデックスを書き込み中",
        activating: "新しいインデックスを有効化中",
        processing: "処理中",
      },
    },
    upload: {
      action: "ドキュメントをアップロード",
      title: "ドキュメントをアップロード",
      ocrLabel: "OCR を有効にする",
      ocrDescription:
        "スキャンや画像内の文字を認識します。OCR を有効にすると処理時間が長くなります。",
      ocrRecommendedForImages:
        "選択したファイルに画像が含まれています。画像内の文字を認識するには、このバッチの OCR を有効にしてください。",
      enableOcrForBatch: "このバッチの OCR を有効にする",
      sourceType: "アップロード元",
      sourceTypeDescription:
        "1 つ以上のファイルを選択するか、ローカルフォルダーの階層を保持してアップロードできます。",
      filesMode: "ファイル",
      folderMode: "フォルダー",
      chooseFiles: "ドキュメントを選択",
      chooseFolder: "ローカルフォルダーを選択",
      limits:
        "1 ファイルあたり {{maxFileSize}} まで、1 回の選択で {{maxFiles}} 件まで指定できます。",
      loadingLimits: "この環境のアップロード上限を読み込み中です。",
      queue: "アップロード待ち一覧",
      queueSummary: "{{total}} ファイル、{{waiting}} 件待機中",
      start: "アップロードを開始（{{count}}）",
      locateExisting: "既存のドキュメントを表示",
      replace: "既存のドキュメントを置き換え",
      keepBoth: "両方を保持",
      resolveConflict: "名前の重複を解決",
      conflictTitle: "ドキュメント名の重複を解決",
      conflictDescription:
        "「{{incoming}}」は「{{existing}}」と同じ名前ですが、内容が異なります。このファイルの処理方法を選択してください。",
      confirmedName: "サーバーで確認済みの名前：{{name}}",
      batch: {
        runningTitle: "ドキュメントをアップロード・処理中",
        attentionTitle: "確認が必要なドキュメントがあります",
        completedTitle: "ドキュメントの一括処理が終了しました",
        summary: "{{completed}} / {{total}} 件のドキュメントを処理済み",
        issues: "{{count}} 件のドキュメントが正常に完了しませんでした",
        viewDetails: "詳細を表示",
      },
      state: {
        waiting: "アップロード待ち",
        uploading: "アップロード中",
        processing: "アップロード済み・処理中",
        ready: "処理完了",
        duplicate: "内容が重複しています",
        conflict: "名前が重複しています",
        skipped: "スキップ済み",
        failed: "アップロード失敗",
      },
      errors: {
        unsupportedFormat: "このファイル形式には対応していません。",
        emptyFile: "空のファイルはアップロードできません。",
        fileTooLarge:
          "ファイルが 1 ファイルあたりの上限 {{maxFileSize}} を超えています。",
        tooManyFiles: "1 回に選択できるファイルは {{maxFiles}} 件までです。",
      },
    },
    share: {
      action: "共有",
      title: "ナレッジベースを共有",
      description:
        "ユーザーまたはユーザーグループに、このナレッジベースへのアクセス権を付与します。",
      targetType: "共有先",
      permissionDescription:
        "共有先はコンテンツの表示・検索ができますが、ドキュメントや共有の管理はできません。",
      user: "ユーザー",
      group: "ユーザーグループ",
      selectTarget: "共有先を選択",
      searchUserPlaceholder: "名前またはメールアドレスでユーザーを検索…",
      searchGroupPlaceholder: "名前でユーザーグループを検索…",
      loadingTargets: "共有先を読み込み中",
      noTargets: "一致する共有先がありません",
      removeTarget: "共有先 {{name}} を削除",
      additionalTargets: "ほか {{count}} 件を選択",
      active: "現在の共有",
      permissionUse: "利用権限",
      empty: "ユーザーまたはグループへの共有はありません",
      revokeNamed: "{{name}} のアクセス権を取り消す",
      revokeUserRemoved:
        "{{name}} のアクセス権を取り消しました。このユーザーには、ほかに有効なアクセス権の付与元はありません。",
      revokeUserRetained:
        "{{name}} のアクセス権を取り消しました。このユーザーは引き続き {{sources}} を通じてアクセスできます。",
      revokeGroupNone:
        "ユーザーグループ {{name}} のアクセス権を取り消しました。現在、有効なグループメンバーの中に別の付与元からアクセス権を保持している人はいません。",
      revokeGroupSome:
        "ユーザーグループ {{name}} のアクセス権を取り消しました。一部の有効なメンバーは引き続き {{sources}} を通じてアクセスできます。メンバーの詳細は表示しません。",
      revokeGroupAll:
        "ユーザーグループ {{name}} のアクセス権を取り消しました。すべての有効なメンバーは引き続き {{sources}} を通じてアクセスできます。メンバーの詳細は表示しません。",
      remainingSource: {
        owner: "ナレッジベースの所有権",
        direct: "別の直接共有",
        user_group: "別のユーザーグループへの共有",
      },
      submit: "共有を追加",
      removeDirectSuccess: "個人への直接共有を解除しました。",
      removeDirectStillAccessible:
        "個人への直接共有を解除しました。別の有効な付与元を通じて、このナレッジベースに引き続きアクセスできます。",
      noRemainingAccess:
        "解除後はこのナレッジベースにアクセスできなくなります。",
      remainingAccess:
        "別の有効な付与元を通じて、このナレッジベースに引き続きアクセスできます。",
    },
    preview: {
      title: "ドキュメントのプレビュー",
      views: "プレビューモード",
      original: "原本",
      parsed: "解析済みコンテンツ",
      parsedDescription:
        "表示中のドキュメントバージョンから解析された Markdown です。",
      sameVersionDescription:
        "原本と解析済み表示は、同じ現行ドキュメントバージョンを参照しています。",
      exactVersionDescription:
        "この引用に使用された過去のドキュメントバージョンを表示しています。",
      citationExcerpt: "引用箇所",
      unsupportedOriginal:
        "このファイル形式では原本をプレビューできません。解析済みコンテンツを表示するか、原本をダウンロードしてください。",
      loadingOriginal: "原本のプレビューを読み込み中",
      loadingParsed: "解析済みコンテンツを読み込み中",
      assetLoading: "ドキュメントの画像を読み込み中",
      assetLoadingNamed: "ドキュメントの画像「{{name}}」を読み込み中",
      assetUnavailable: "ドキュメントの画像を利用できません",
      assetUnavailableNamed: "ドキュメントの画像「{{name}}」を利用できません",
      parsedEmpty: "表示できる解析済みコンテンツがありません",
      downloadOriginal: "原本をダウンロード",
      expand: "拡大表示",
      expandImage: "{{name}} を拡大表示",
      openNamed: "ドキュメント {{name}} をプレビュー",
      backToKnowledgeBase: "ナレッジベースに戻る",
    },
    citation: {
      title: "ナレッジの引用",
      loading: "ナレッジの引用を取得中",
      back: "タスクに戻る",
      source: "引用 [{{number}}] · {{knowledgeBase}}",
      location: "引用元の位置：{{location}}",
      historicalUnavailableTitle: "過去の引用内容を利用できません",
      historicalUnavailableDescription:
        "引用元のナレッジベースまたはドキュメントが削除されています。内容の表示、原本のプレビュー、ダウンロードは利用できません。回答時に記録された名前と引用元の位置の概要のみ残っています。",
      inlinePreviewUnavailable:
        "引用箇所を読み込めませんでした。マーカーを選択して引用の詳細を開いてください。",
      pages: "{{values}} ページ",
      documentLevel: "ドキュメント全体の出典",
    },
  },
  adminKnowledge: {
    title: "ナレッジベース",
    description:
      "全ユーザーのナレッジベースの情報とナレッジソースを管理します。ドキュメント内容の閲覧、プレビュー、ダウンロードはできません。",
    tabsLabel: "ナレッジベースのセクション",
    tabs: {
      knowledgeBases: "ナレッジベース",
      sources: "ナレッジソース",
    },
    search: "ナレッジベースまたは所有者を検索",
    empty: "一致するナレッジベースがありません",
    ownerDisabled: "所有者は無効になっています",
    lifecycle: {
      label: "ライフサイクル",
      all: "すべてのライフサイクル",
      active: "有効",
      archived: "アーカイブ済み",
      deleted: "削除済み",
    },
    availability: {
      label: "利用可否",
      all: "すべての利用状態",
      enabled: "有効",
      disabled: "無効",
    },
    columns: {
      knowledgeBase: "ナレッジベース",
      owner: "所有者",
      documents: "ドキュメント",
      storage: "ストレージ",
      shares: "共有権限",
      diagnostics: "診断",
    },
    documentSummary: "合計 {{total}} 件 · 検索可能 {{ready}} 件",
    documentIssues: "処理中 {{processing}} 件 · 失敗 {{failed}} 件",
    shareCount: "有効な共有権限 {{count}} 件",
    pagination: {
      label: "ナレッジベース一覧のページ切り替え",
      page: "{{page}} ページ",
    },
    revokeNamed: "{{name}} への共有権限を取り消す",
    cleanup: "クリーンアップ：{{status}}",
    cleanupStatus: {
      pending: "保留中",
      running: "実行中",
      failed: "失敗",
      completed: "完了",
    },
    noDiagnostics: "問題なし",
    actionsFor: "ナレッジベース {{name}} を管理",
    archiveBeforeDelete:
      "アーカイブ後に削除するには、別途確認が必要です。この操作ではナレッジベースは削除されません。",
    reason: "理由",
    reasonHint: "必須です。理由は機密情報を除いた監査記録に保存されます。",
    actions: {
      disable: "無効にする",
      enable: "有効にする",
      archive: "アーカイブ",
      transferOwner: "所有者を変更",
      retryCleanup: "クリーンアップを再試行",
      delete: "完全に削除",
    },
    feedback: {
      disable: "ナレッジベースを無効にしました。",
      enable: "ナレッジベースを有効にしました。",
      archive: "ナレッジベースをアーカイブしました。",
      delete: "ナレッジベースの削除を受け付けました。",
      cleanup_retry: "クリーンアップの再試行を受け付けました。",
      revoke_grant: "共有権限を取り消しました。",
      transfer_owner: "ナレッジベースの所有者を変更しました。",
    },
    confirm: {
      disable: {
        title: "ナレッジベースを無効にしますか？",
        description:
          "無効になっている間、ユーザーは「{{name}}」のコンテンツを検索・利用できません。",
        action: "無効にする",
      },
      enable: {
        title: "ナレッジベースを有効にしますか？",
        description:
          "「{{name}}」の既存の有効な共有権限が再び利用可能になります。",
        action: "有効にする",
      },
      archive: {
        title: "ナレッジベースをアーカイブしますか？",
        description: "アーカイブ後、「{{name}}」は読み取り専用になります。",
        action: "アーカイブ",
      },
      delete: {
        title: "ナレッジベースを完全に削除しますか？",
        description:
          "アーカイブ済みナレッジベース「{{name}}」を完全に削除します。この操作は取り消せません。",
        action: "完全に削除",
      },
      cleanup_retry: {
        title: "リソースのクリーンアップを再試行しますか？",
        description:
          "ナレッジベース「{{name}}」で失敗したクリーンアップを再実行します。",
        action: "クリーンアップを再試行",
      },
      revoke_grant: {
        title: "共有権限を取り消しますか？",
        description: "「{{name}}」のナレッジベースへのアクセス権を削除します。",
        action: "取り消す",
      },
    },
    transfer: {
      title: "ナレッジベースの所有者を変更",
      description:
        "ナレッジベース「{{name}}」の新しい所有者として、有効なユーザーを選択してください。",
      owner: "新しい所有者",
      search: "ユーザーを検索",
      select: "新しい所有者を選択",
      action: "所有者を変更",
    },
  },
  presentation: {
    previewTitle: "プレゼンテーション {{name}} をプレビュー",
    loading: "プレゼンテーションを読み込み中",
    loadFailed:
      "このプレゼンテーションをプレビューできませんでした。再試行してください。",
    close: "プレゼンテーションのプレビューを閉じる",
    download: "ダウンロード",
    downloadNamed: "プレゼンテーション {{name}} をダウンロード",
    zoomOut: "プレゼンテーションを縮小",
    zoomIn: "プレゼンテーションを拡大",
    resetZoom: "プレゼンテーションの表示倍率をリセット",
    enterFullscreen: "プレゼンテーションを全画面でプレビュー",
    exitFullscreen: "全画面プレビューを終了",
    resizePreview: "プレゼンテーションのプレビューサイズを変更",
    slideCount: "{{current}} / {{total}}",
    toggleSlideNavigator: "スライドのサムネイルを表示・非表示",
    slideNavigator: "スライドのサムネイル",
    goToSlide: "スライド {{slide}} に移動",
    selectElement: "プレゼンテーションの要素を選択",
    askLinkSense: "{{productName}} に質問",
    askShortcut: "⌘I",
    selectionPromptLabel: "選択した要素について {{productName}} に質問",
    selectionPromptPlaceholder: "変更内容または質問を入力",
    selectionPromptSubmit: "注釈を追加",
    selectionPromptError: "注釈を追加できませんでした。再試行してください。",
    selectionStatus: "スライド {{slide}} の {{count}} 個の要素を選択中",
  },
  officePreview: {
    previewTitle: "ドキュメント {{name}} をプレビュー",
    loading: "ドキュメントを読み込み中",
    loadFailed:
      "このドキュメントをプレビューできませんでした。再試行してください。",
    close: "ドキュメントのプレビューを閉じる",
    download: "ダウンロード",
    downloadNamed: "ドキュメント {{name}} をダウンロード",
    enterFullscreen: "ドキュメントを全画面でプレビュー",
    exitFullscreen: "全画面プレビューを終了",
    resizePreview: "ドキュメントのプレビューサイズを変更",
    updateAvailable: "更新して最新の内容を表示",
    update: "プレビューを更新",
    dismissUpdate: "更新通知を閉じる",
    annotate: "注釈を追加",
    annotating: "注釈モード",
    enterAnnotationMode: "ファイルの注釈モードに切り替え",
    exitAnnotationMode: "ファイルの注釈モードを終了",
    askLinkSense: "{{productName}} に質問",
    askShortcut: "⌘I",
    selectionUnavailableWhileBusy: "選択内容を送信中です。お待ちください。",
    selectionPromptLabel: "選択内容について {{productName}} に質問",
    selectionPromptPlaceholder: "変更内容または質問を入力",
    selectionPromptSubmit: "注釈を追加",
    selectionPromptError: "注釈を追加できませんでした。再試行してください。",
    annotationBatch: {
      regionLabel: "未送信の注釈",
      triggerLabel: "未送信の注釈 {{count}} 件を表示",
      count_one: "{{count}} 件の注釈",
      count_other: "{{count}} 件の注釈",
      title: "未送信の注釈",
      listLabel: "未送信の注釈一覧",
      presentationLocation: "スライド {{slide}} · {{count}} 個の要素",
      wordPageLocation: "{{page}} ページ",
      wordParagraphLocation: "段落 {{paragraph}}",
      spreadsheetLocation: "{{sheet}} · {{selection}}",
      htmlLocation: "{{count}} 個の HTML 要素",
      locate: "注釈 {{index}} に移動",
      remove: "注釈 {{index}} を削除",
      clear: "クリア",
      sendAll: "送信",
      sendError:
        "注釈を送信できませんでした。再試行できるように保持しています。",
      limitReached: "一度に追加できる注釈は 20 件までです。",
    },
  },
  wordPreview: {
    zoomOut: "Word ドキュメントを縮小",
    zoomIn: "Word ドキュメントを拡大",
    resetZoom: "Word ドキュメントの表示倍率をリセット",
    pageCount: "{{current}} / {{total}} ページ",
    selectionStatus: "テキストを選択中",
  },
  htmlPreview: {
    frameTitle: "HTML ドキュメント {{name}}",
    annotate: "注釈を付ける",
    annotating: "注釈モード",
    enterAnnotationMode: "HTML 注釈モードに切り替え",
    exitAnnotationMode: "HTML 注釈モードを終了",
    interactionModeStatus:
      "HTML 操作モードです。ページ内のボタンなどを操作できます。",
    annotationModeStatus:
      "HTML 注釈モードです。要素を選択して {{productName}} に質問できます。",
    zoomOut: "HTML ドキュメントを縮小",
    zoomIn: "HTML ドキュメントを拡大",
    resetZoom: "HTML ドキュメントの表示倍率をリセット",
    selectionStatus: "{{count}} 個の HTML 要素を選択中",
  },
  archivePreview: {
    loading: "アーカイブの内容を読み込み中",
    loadFailed:
      "このアーカイブを読み込めませんでした。ダウンロードして開いてください。",
    summary: "{{files}} ファイル · {{folders}} フォルダー",
    root: "ルート",
    breadcrumb: "アーカイブのパス",
    folderTreeLabel: "アーカイブ内のフォルダー",
    listLabel: "アーカイブ内のファイル一覧",
    searchLabel: "アーカイブ内を検索",
    searchPlaceholder: "ファイル名またはフォルダー名を検索…",
    name: "名前",
    type: "種類",
    compressedSize: "圧縮後",
    originalSize: "原本",
    modifiedAt: "更新日時",
    folder: "フォルダー",
    file: "ファイル",
    encrypted: "暗号化済み",
    emptyFolder: "このフォルダーは空です",
    noSearchResults: "一致するファイルまたはフォルダーがありません",
    skippedEntries:
      "安全でないアーカイブ項目 {{count}} 件を非表示にしています。",
    previewFile: "{{name}} をプレビュー",
    backToFiles: "ファイル一覧に戻る",
    entryLoading: "{{name}} を読み込み中",
    entryLoadFailed:
      "アーカイブ内のこのファイルを読み込めませんでした。再試行してください。",
    entryPreview: "{{name}} の読み取り専用プレビュー",
  },
  filePreview: {
    loading: "プレビューを読み込み中",
    loadFailed:
      "このファイルをプレビューできませんでした。再試行してください。",
    readOnly: "読み取り専用",
    codeContent: "{{name}} の読み取り専用コード",
    wrap: "行を折り返す",
    enableWrap: "行の折り返しを有効にする",
    disableWrap: "行の折り返しを無効にする",
    contentTruncated:
      "プレビューの動作を快適に保つため、ファイルの先頭部分のみ表示しています。",
    binaryContent:
      "このファイルにはテキストとして表示できないバイナリデータが含まれています。",
    contentUnavailable: "プレビュー内容を利用できません。",
    csvFailed: "この表を読み込めませんでした。",
    csvSummary: "{{rows}} 行 · {{columns}} 列",
    tableTruncated:
      "プレビューの動作を快適に保つため、表の一部のみ表示しています。",
    emptyTable: "この表は空です。",
    unnamedColumn: "列 {{index}}",
    pdfLoading: "PDF を描画中",
    pdfFailed: "この PDF を描画できませんでした。",
    imageFailed: "この画像を読み込めませんでした。",
    mediaFailed: "このメディアファイルを読み込めませんでした。",
    mediaUnsupported:
      "このブラウザーでは、このメディアファイルを再生できません。",
  },
  spreadsheetPreview: {
    zoomOut: "Excel ブックを縮小",
    zoomIn: "Excel ブックを拡大",
    resetZoom: "Excel ブックの表示倍率をリセット",
    sheetTabsLabel: "ワークシート",
    selectionStatus: {
      range: "シート {{sheet}} の {{address}} を選択中",
      image: "シート {{sheet}} の画像 {{name}} を選択中",
      chart: "シート {{sheet}} のグラフ {{name}} を選択中",
    },
  },
  projects: {
    nameExists:
      "同名のプロジェクトが既に存在します。別の名前を指定してください",
    notFound:
      "このプロジェクトは利用できません。別のプロジェクトを選択してください",
    taskActive:
      "タスクを移動したりプロジェクトを削除したりする前に、実行中のタスクを完了してください",
    empty: "タスクはまだありません",
    create: "新しいプロジェクト",
    createDescription:
      "プロジェクト内のタスクはファイルを共有し、メッセージ履歴はそれぞれ個別に保持します。",
    edit: "プロジェクトを編集",
    editAction: "編集",
    appearance: {
      choose: "プロジェクトのアイコンと色を選択",
      icon: "プロジェクトのアイコン",
      color: "アイコンの色",
      done: "完了",
      colors: {
        default: "既定",
        red: "赤",
        orange: "オレンジ",
        yellow: "黄",
        green: "緑",
        blue: "青",
        purple: "紫",
        pink: "ピンク",
        teal: "青緑",
        cyan: "シアン",
        brown: "茶",
        gray: "グレー",
      },
      icons: {
        folder: "フォルダー",
        coins: "金融",
        book: "読書",
        "graduation-cap": "学習",
        pencil: "執筆",
        "pen-tool": "デザイン",
        braces: "コード",
        terminal: "ターミナル",
        music: "音楽",
        popcorn: "映画",
        brush: "絵画",
        palette: "アート",
        stethoscope: "健康",
        asterisk: "アスタリスク",
        flower: "花",
        briefcase: "仕事",
        "chart-column": "データ",
        medal: "メダル",
        dumbbell: "フィットネス",
        notebook: "メモ",
        scale: "法律",
        globe: "地球儀",
        plane: "旅行",
        earth: "世界",
        wrench: "ツール",
        "paw-print": "ペット",
        flask: "科学",
        brain: "思考",
        heart: "ハート",
        sprout: "植物",
      },
    },
    reorderHandle:
      "キーボードでプロジェクト「{{title}}」の順序を変更します。現在の位置は {{position}} です",
    sidebarDragInstructions:
      "Space キーでタスクまたはプロジェクトを選択し、上下の矢印キーで位置を変更して、Space キーで保存します。Escape キーでキャンセルします。タスクはほかのプロジェクトにも移動できます。",
    reorderStarted:
      "位置 {{position}} のプロジェクト「{{title}}」を選択しました。",
    reorderOver: "プロジェクト「{{title}}」を位置 {{position}} に移動します。",
    reorderCompleted:
      "プロジェクト「{{title}}」を位置 {{position}} に移動しました。",
    reorderCancelled: "プロジェクトのドラッグをキャンセルしました。",
    dragSaving: "プロジェクトの順序を保存しています。",
    dragSaveFailed:
      "プロジェクトの順序を保存できませんでした。再試行してください。",
    delete: "プロジェクトを削除",
    move: "プロジェクトに移動",
    moveNamed: "「{{title}}」をプロジェクトに移動",
    name: "プロジェクト名",
    namePlaceholder: "プロジェクト名を入力",
    search: "プロジェクトを検索",
    noResults: "一致するプロジェクトがありません",
    choose: "プロジェクト",
    projectless: "共通ワークスペース",
    selectPlaceholder: "プロジェクトを選択",
    clearSelection: "プロジェクトの選択を解除",
    unavailable: "プロジェクトを利用できません",
    loadError: "タスクのプロジェクトを読み込めません",
    deleteDescription:
      "「{{name}}」を削除すると、そのタスクは共通ワークスペースに移動します。会話と元のプロジェクトファイルは保持されます。以後の作業では共通ワークスペースを使用します。",
  },
  conversation: {
    untitled: "無題のタスク",
    title: "タスク",
    taskSort: {
      open: "{{section}} のタスクの順序を設定",
      label: "タスクの順序",
      priority: "優先順位",
      priorityDescription: "入力が必要なタスクと未読のタスクを先に表示します。",
      updated_at: "最終更新",
      manual: "手動の順序",
    },
    share: {
      action: "共有",
      title: "{{title}} を共有",
      description:
        "以下のプレビューに表示された内容のみを、あなたの名前を含めずに共有します。その後のメッセージや新しい共有によって、このリンクの内容は変わりません。",
      previewLabel: "共有するタスクのプレビュー",
      anyoneWithLink: "このリンクを知っているすべての人がタスクを閲覧できます",
      copyLink: "リンクをコピー",
      copied: "コピーしました",
      copyFailed:
        "リンクをコピーできませんでした。ブラウザーの権限を確認して再試行してください。",
      unavailable: "この共有リンクは存在しないか、利用できなくなっています。",
      continueInProduct: "{{productName}} で続行",
    },
    rename: "名前を変更",
    archive: "タスクをアーカイブ",
    archivedNotification: "タスクをアーカイブしました",
    undoArchive: "元に戻す",
    undoingArchive: "アーカイブを取り消し中…",
    archiveUndone: "アーカイブを取り消しました",
    archiveNamed: "タスク「{{title}}」をアーカイブ",
    pin: "タスクをピン留め",
    pinNamed: "タスク「{{title}}」をピン留め",
    unpin: "ピン留めを解除",
    unpinNamed: "タスク「{{title}}」のピン留めを解除",
    reorderHandle:
      "キーボードでタスク「{{title}}」の順序を変更します。現在の位置は {{position}} です",
    reorderInstructions:
      "Space キーでタスクを選択し、上下の矢印キーで順序やカテゴリを変更して、Space キーで保存します。Escape キーでキャンセルします。",
    reorderStarted: "位置 {{position}} のタスク「{{title}}」を選択しました。",
    reorderOver: "タスク「{{title}}」を位置 {{position}} に移動します。",
    reorderCompleted: "タスク「{{title}}」を位置 {{position}} に移動しました。",
    reorderCancelled: "タスクのドラッグをキャンセルしました。",
    dragProjectOver:
      "タスク「{{title}}」をプロジェクト「{{project}}」にドロップします。",
    dragProjectCompleted:
      "タスク「{{title}}」をプロジェクト「{{project}}」に移動しました。",
    dragSaving: "タスクの位置を保存しています。",
    dragSaveFailed: "タスクの位置を保存できませんでした。再試行してください。",
    unpinBlockedTitle: "タスクのピン留めを解除できません",
    unarchive: "アーカイブを解除",
    unarchiveNamed: "タスク「{{title}}」のアーカイブを解除",
    delete: "タスクを削除",
    deleteNamed: "タスク「{{title}}」を削除",
    deleteTitle: "このタスクを完全に削除しますか？",
    deleteDescription:
      "タスクの内容は復元できません。成果物と最小限の追跡情報は恒久的に保持されますが、再度の復元やダウンロードはできません。",
    clearArchived: "すべて消去",
    clearArchivedTitle: "アーカイブ済みタスクをすべて消去しますか？",
    clearArchivedDescription:
      "すべてのアーカイブ済みタスクが完全に削除され、復元できません。アプリケーション、開発中の下書き、デバッグの会話履歴は「マイアプリケーション」に残り、開発の続行や削除ができます。ほかの有効なタスクには影響しません。成果物と最小限の追跡情報は、システムの方針に従って保持されます。",
    clearingArchived: "アーカイブ済みタスクを消去中…",
    clearArchivedPartial:
      "{{deleted}} 件のタスクを消去しました。{{remaining}} 件はまだ消去できませんでした。",
    clearArchivedBusy:
      "このタスクは処理中または停止中です。少し待ってから再試行してください。",
    clearArchivedSuccess: "アーカイブ済みタスク {{count}} 件を消去しました。",
    searchTitle: "検索",
    searchPlaceholder:
      "タイトル、メッセージ、添付ファイル、成果物、プラグイン、スキルを検索…",
    archivedSearchPlaceholder:
      "アーカイブ済みタスクのタイトル、メッセージ、添付ファイルを検索…",
    archivedSortLabel: "アーカイブ済みタスクを並べ替え",
    archivedSortNewest: "更新が新しい順",
    archivedSortOldest: "更新が古い順",
    archivedProjectLabel: "プロジェクトで絞り込む",
    archivedAllProjects: "すべてのプロジェクト",
    archivedSearchEmpty: "条件に一致するアーカイブ済みタスクはありません。",
    searchEmpty: "検索結果がありません",
    listEmpty: "タスクはまだありません。入力欄から直接始められます。",
    newTaskWelcome: "{{productName}} で何を一緒に進めましょうか？",
    creditQuotaBlocked: {
      title: "トークンの利用上限に達しました",
      description:
        "利用可能なクレジットを使い切りました。現在、新しいタスクや追加のリクエストは開始できません。実行中のタスクには影響しません。",
      dismiss: "使用量の通知を閉じる",
    },
    starterQuestions: {
      label: "よく使うタスクの例",
      analyzeFile: {
        title: "ファイルを分析",
        description: "要点、リスク、対応事項を抽出",
        prompt:
          "アップロードしたファイルを分析し、主要な結論、重要なリスク、対応事項を重要度順に抽出してください。",
      },
      searchKnowledge: {
        title: "社内ナレッジを検索",
        description: "ナレッジベースから出典付きで回答",
        prompt:
          "選択したナレッジベースを使って、次の質問に回答してください。根拠となる出典を引用し、情報が不足している場合は明確に伝えてください：",
      },
      analyzeData: {
        title: "表計算データを分析",
        description: "傾向や異常を見つけ、グラフを作成",
        prompt:
          "アップロードした Excel または CSV ファイルを分析してください。主要な指標、傾向、異常を特定し、考えられる原因を説明して、簡潔な要約とグラフを作成してください。",
      },
      createDeliverable: {
        title: "業務用の成果物を作成",
        description: "計画、レポート、プレゼンテーションを作成",
        prompt:
          "提供する資料を使い、[対象者] 向けに [テーマ] について、明確ですぐに使える [計画書/レポート/プレゼンテーション] を作成してください。",
      },
    },
    archivedTaskCount_one: "{{count}} 件のタスク",
    archivedTaskCount_other: "{{count}} 件のタスク",
    archivedEmpty: "アーカイブ済みタスクはありません。",
    unavailable: "タスクを読み込めませんでした。再試行してください。",
    messageInput: "タスクの入力欄",
    messageNavigation: "タスクのメッセージナビゲーション",
    awaitingAssistant: "AI が回答中…",
    historyLoading: "メッセージを読み込み中…",
    historyExchange: "やり取り {{count}}",
    historyViewExchange: "クリックしてこのやり取りを表示",
    historyRetry: "メッセージを読み込めませんでした。再試行",
    scrollToBottom: "一番下へスクロール",
    placeholder: "{{productName}} にしてほしいことを入力してください…",
    followUpPlaceholder: "追加の依頼を入力…",
    send: "送信",
    model: "モデル",
    modelSelector: "モデルと推論の強度を選択",
    resetReasoningEffort: "推論の強度を既定値に戻す",
    modelNotConfigured: "モデルサービスは未設定です",
    reasoningEffort: "推論の強度",
    modelContextUsageUnknown: "使用量はまだありません",
    modelContextBadgeLabel: "背景コンテキストの上限：{{value}}",
    modelContextTitle: "背景コンテキストの上限：",
    modelContextUsagePercent: "{{percent}}% 使用済み",
    modelContextUsageDetail: "{{used}} 使用済み / 合計 {{total}}",
    modelContextUnavailable: "コンテキストの使用量はまだありません",
    stop: "停止",
    interrupting: "中断中…",
    attach: "ファイルを添付",
    attachFolder: "フォルダーを添付",
    dropFilesToAttach: "ドロップしてファイルをアップロード",
    removeAttachment: "添付ファイル {{name}} を削除",
    attachmentUploading: "添付ファイルをアップロード中…",
    attachmentUploadingName: "添付ファイル {{name}} をアップロード中",
    attachmentUploadingShort: "アップロード中",
    attachmentOverflowLabel: "すべての添付ファイル {{count}} 件を表示",
    attachmentListTitle: "すべての添付ファイル（{{count}}）",
    clearAllAttachments: "すべて消去",
    pastedTextFilePrefix: "貼り付けたテキスト",
    pastedTextAttachmentUploading:
      "貼り付けたテキストを添付ファイルとして追加中…",
    pastedTextAttachmentMeta: "{{characters}} 文字 · {{size}}",
    pastedTextAttachmentPlaceholder:
      "この添付ファイルをどのように扱うか入力してください…",
    pastedTextAttachmentPreview: "貼り付けた内容 {{name}} をプレビュー",
    previewImage: "画像 {{name}} をプレビュー",
    imagePreviewTitle: "画像のプレビュー",
    imagePreviewDescription: "アップロードした添付画像をプレビューします。",
    previousImage: "前の画像",
    nextImage: "次の画像",
    zoomOut: "縮小",
    zoomIn: "拡大",
    previewLoading: "画像 {{name}} を読み込み中",
    previewLoadFailed: "画像 {{name}} をプレビューできません",
    inlineImage: "メッセージの画像",
    inlineImageUnavailable: "画像を利用できません",
    openKnowledgeCitation: "ナレッジの引用 {{number}} を開く",
    previewPresentation: "プレゼンテーション {{name}} をプレビュー",
    previewDocument: "ドキュメント {{name}} をプレビュー",
    previewHtml: "HTML ドキュメント {{name}} をプレビュー",
    previewArchive: "アーカイブ {{name}} をプレビュー",
    previewFile: "ファイル {{name}} をプレビュー",
    openPreview: "プレビューを開く",
    presentationAnnotation: "プレゼンテーションの注釈：{{name}}",
    presentationAnnotationCount_one: "{{count}} 件の注釈",
    presentationAnnotationCount_other: "{{count}} 件の注釈",
    officeAnnotation: "ドキュメントの注釈：{{name}}",
    officeAnnotationCount_one: "{{count}} 件の注釈",
    officeAnnotationCount_other: "{{count}} 件の注釈",
    applicationAnnotation: "アプリの注釈：{{name}}",
    htmlAnnotation: "HTML の注釈：{{name}}",
    htmlAnnotationCount_one: "{{count}} 件の注釈",
    htmlAnnotationCount_other: "{{count}} 件の注釈",
    voice: "音声入力",
    voiceChecking: "音声文字起こしサービスを確認中…",
    voiceNotConfigured: "音声文字起こしは未設定です",
    voiceServiceUnavailable:
      "音声文字起こしを一時的に利用できません。しばらくしてから再試行してください。",
    voiceStop: "音声入力を停止",
    voiceRecording: "録音中",
    voiceDuration: "録音時間",
    voiceTranscribing: "音声を文字起こし中…",
    voiceUnavailable:
      "音声入力を利用できません。ブラウザーの対応状況とマイクの権限を確認してください。",
    voiceUnsupported:
      "このブラウザーでは録音できません。マイク録音に対応したブラウザーを使用してください。",
    voicePermissionDenied:
      "マイクの権限が無効です。このページへのマイクアクセスを許可して再試行してください。",
    voiceDeviceNotFound:
      "マイクが見つかりませんでした。デバイスを確認して再試行してください。",
    voiceDeviceUnavailable:
      "マイクを利用できません。システムの権限や、別のアプリで使用中かどうかを確認してください。",
    voiceRecordingFailed:
      "録音に失敗しました。マイクを確認して再試行してください。",
    voiceRecordingTimeout:
      "録音の保存がタイムアウトしました。再試行してください。",
    voiceTooShort: "録音が短すぎます。1 秒以上録音してください。",
    voiceTooLarge: "録音データが大きすぎます。短くして再試行してください。",
    voiceTimeout: "音声認識がタイムアウトしました。再試行してください。",
    voiceNoContent:
      "音声を認識できませんでした。再試行するか、テキストを手動で入力してください。",
    slashCommands: {
      menuLabel: "操作メニュー",
      back: "操作に戻る",
      noMatches: "一致する操作がありません",
      newTask: "新しいタスク",
      newTaskDescription: "新しい空のタスクを開始",
      compact: "コンテキストを圧縮",
      compactDescription: "現在のタスクの停止後にコンテキストを圧縮",
      plugins: "プラグイン一覧",
      pluginsDescription: "利用可能なプラグインを表示・選択",
      pluginsTitle: "プラグイン",
      skills: "スキル一覧",
      skillsDescription: "利用可能なスキルを表示・選択",
      skillsTitle: "スキル",
      applications: "アプリケーション一覧",
      applicationsDescription: "アプリケーションを選択してタスクを開始",
      applicationsTitle: "アプリケーション",
      knowledgeBases: "ナレッジベース一覧",
      knowledgeBasesDescription: "利用可能なナレッジベースを表示・選択",
      knowledgeBasesTitle: "ナレッジベース",
      mcp: "MCP の状態",
      mcpDescription: "個人用 MCP サーバーの状態を表示",
      mcpTitle: "MCP",
      applicationManagedDescription:
        "このリソースはアプリケーションが管理しています",
      emptyCapabilities: "利用可能な{{type}}はありません",
      selected: "選択済み",
      personal: "個人",
      available: "利用可能",
      owned: "自分のもの",
      shared: "共有済み",
      unavailable: "利用不可",
      enabled: "有効",
      disabled: "無効",
      mcpNoAuthentication: "認証なし",
      mcpCredentialMissing: "認証情報がありません",
      mcpAuthenticationConfigured: "{{method}} 認証を設定済み",
      mcpStdioConfigured: "STDIO · 環境変数 {{count}} 個",
    },
    skillCommands: {
      menuLabel: "スキル選択メニュー",
      noMatches: "一致するスキルがありません",
    },
    addMenu: "追加",
    addMenuTitle: "コンテンツを追加",
    addGroup: "追加",
    attachFileMenuLabel: "ファイル",
    attachFileMenuSearchValue: "ファイル 添付 アップロード",
    attachFolderMenuLabel: "フォルダー",
    attachFolderMenuSearchValue: "フォルダー ディレクトリ 添付 アップロード",
    capabilitySearch: "利用可能なプラグインまたはスキルを検索…",
    pluginGroup: "プラグイン",
    skillGroup: "スキル",
    noCapabilities: "利用可能なプラグインまたはスキルがありません",
    capabilityUnavailable:
      "利用可能なプラグインまたはスキルを読み込めませんでした。再試行してください。",
    goal: {
      regionLabel: "目標の状態",
      menuLabel: "目標",
      menuSearchValue: "目標 長時間実行タスク 自動継続",
      menuDescription: "完了するか対応が必要になるまで作業を続行",
      modeLabel: "目標",
      disableMode: "目標モードを終了",
      placeholder:
        "目標と測定可能な成果を明確に記述すると、より良い結果につながります。",
      startUnavailable: "このタスクには既に目標があるか、実行が継続中です。",
      statusLabel: {
        active: "目標に向けて実行中",
        paused: "目標を一時停止中",
        blocked: "目標の続行には対応が必要です",
        usageLimited: "利用上限により目標を停止",
        budgetLimited: "予算上限により目標を停止",
        complete: "目標達成",
      },
      statusDescription: {
        active:
          "目標を達成するまで、各実行の終了後にシステムが自動的に作業を続行します。",
        paused: "目標は一時停止中です。現在の実行が終了しても続行しません。",
        blocked:
          "目標を続行するには、外部の状況の変化またはあなたの入力が必要です。",
        usageLimited: "現在の利用上限に達したため、目標の実行を停止しました。",
        budgetLimited: "目標に設定されたトークン予算に達しました。",
        complete: "システムがこの目標を達成済みと判定しました。",
      },
      elapsedLabel: "使用時間",
      edit: "目標を編集",
      pause: "目標を一時停止",
      resume: "目標を再開",
      clear: "目標を消去",
      details: "目標の詳細を表示",
      editTitle: "目標を編集",
      editDescription:
        "目標を編集しても、使用済みの時間とトークンは保持されます。",
      detailsTitle: "目標の詳細",
      objective: "達成したいこと",
      tokenBudget: "トークン予算",
      noTokenBudget: "上限なし",
      tokensUsed: "使用済みトークン",
      completedInline: "{{duration}} で目標を達成しました",
      clearTitle: "この目標を消去しますか？",
      clearDescription:
        "このタスクから目標の状態と使用量の記録を削除します。現在の実行は強制停止されません。",
    },
    plan: {
      menuLabel: "計画モード",
      menuSearchValue: "計画モード 分析 計画立案",
      menuDescription: "実装前に分析し、計画を作成",
      modeLabel: "計画",
      disableMode: "計画モードを終了",
      placeholder:
        "分析・計画したいタスクを記述してください。LinkSense がまず質問し、計画を作成します。",
    },
    proposedPlan: {
      title: "計画",
    },
    planDecision: {
      title: "この計画を実装しますか？",
      description:
        "今すぐ実装する、修正を依頼する、または今回はスキップすることができます。",
      implement: "はい、この計画を実装",
      implementDescription: "既定モードに切り替えて実装を開始します。",
      implementing: "実装を開始中",
      revise: "いいえ、先に計画を修正",
      reviseInline: "いいえ、変更してほしい点を LinkSense に伝える",
      reviseDescription: "変更してほしい点を LinkSense に伝えてください。",
      revisionForm: "計画を修正",
      revisionLabel: "修正内容",
      revisionDescription:
        "LinkSense は計画モードのまま、フィードバックをもとに完全な修正版の計画を作成します。",
      revisionPlaceholder: "変更してほしい内容を入力",
      submitRevision: "修正内容を送信",
      submittingRevision: "修正内容を送信中",
      back: "戻る",
      dismiss: "スキップ",
      dismissing: "スキップ中",
      dismissDescription: "今回はスキップし、計画モードを維持",
      exit: "計画モードを終了",
      exiting: "計画モードを終了中",
      exitDescription: "実装を開始せずに計画モードを終了",
    },
    userInput: {
      asyncDescription:
        "回答中も LinkSense は作業を続けられます。作業が終わった後に回答することもできます。",
      title: "回答が必要です",
      formTitle: "以下の内容をご確認ください",
      formResultTitle: "回答済みフォーム",
      description: "LinkSense が計画を続行できるよう、質問に回答してください。",
      autoResolveDescription:
        "お早めに回答してください。制限時間が過ぎると、この質問は自動的に閉じます。",
      other: "その他",
      answerPlaceholder: "回答を入力",
      secretDescription: "入力した値はタスク画面に再表示されません。",
      submit: "回答を送信",
      submitting: "送信中",
      cancel: "キャンセル",
      selectPlaceholder: "選択肢を選ぶ",
      datePlaceholder: "日付を選択",
      clearDate: "日付を解除",
      hour: "時",
      minute: "分",
      booleanYes: "はい",
      booleanNo: "いいえ",
      status: {
        pending: "保留中",
        submitting: "送信中",
        submitted: "送信済み",
        approved: "承認済み",
        rejected: "却下",
        cancelled: "キャンセル済み",
        expired: "期限切れ",
        terminated: "終了済み",
      },
      validation: {
        required: "この項目は必須です。",
        invalid: "値が無効です。",
        invalidEmail: "有効なメールアドレスを入力してください。",
        invalidUri: "プロトコルを含む有効な URL を入力してください。",
        invalidDate: "有効な日付を選択してください。",
        invalidDateTime: "有効な日時を選択してください。",
        invalidNumber: "有効な数値を入力してください。",
        integer: "整数を入力してください。",
        minimum: "{{value}} 以上である必要があります。",
        maximum: "{{value}} 以下である必要があります。",
        minimumSelections: "{{count}} 個以上の選択肢を選んでください。",
        maximumSelections: "選択肢は {{count}} 個以内で選んでください。",
        minimumLength: "{{count}} 文字以上入力してください。",
        maximumLength: "{{count}} 文字以内で入力してください。",
      },
    },
    priorityHint: "このターンで指定",
    selectedCapabilities: "選択したプラグインまたはスキル",
    selectedKnowledgeBases: "このターンのナレッジベース",
    selectedResources: "選択したナレッジベース、プラグイン、スキル",
    moreSelectedResources_one: "ほか {{count}} 件を選択中",
    moreSelectedResources_other: "ほか {{count}} 件を選択中",
    additionalSelectedResources: "追加の選択項目",
    removeCapability: "{{name}} を解除",
    requiredCapability: "このタスクに必須",
    addKnowledgeBase: "ナレッジベースを追加",
    knowledgeBaseTitle: "ナレッジベースを選択",
    knowledgeBaseSearch: "利用可能なナレッジベースを検索…",
    noKnowledgeBases: "利用可能なナレッジベースがありません",
    knowledgeBasesUnavailable:
      "利用可能なナレッジベースを読み込めませんでした。再試行してください。",
    knowledgeBaseUnavailable: "ナレッジベースを利用できません",
    applicationManagedKnowledgeBase: "アプリケーションが管理するナレッジベース",
    knowledgeBaseVerificationUnavailable:
      "ナレッジベースの状態を確認できませんでした。再試行してください。",
    removeKnowledgeBase: "ナレッジベース {{name}} を解除",
    pendingKnowledgeBases: "ナレッジベース",
    runningChoiceTitle: "追加の依頼をどのように扱いますか？",
    runningChoiceDescription:
      "このタスクは実行中です。現在の実行に指示を追加するか、次のリクエストとして保存できます。",
    steer: "現在の実行に指示を追加",
    steerContextUnavailable:
      "現在の実行への指示追加ではテキストのみ追加され、添付ファイルや優先プラグイン・スキルは再読み込みされません。この操作を使うにはそれらを解除してください。",
    steerFallbackQueued:
      "この追加依頼には添付ファイルまたは選択したプラグイン・スキルが含まれるため、次のリクエストとして待機一覧に追加しました。",
    addPending: "次のリクエストとして追加",
    pendingQueued: "待機中",
    pendingGuide: "指示を追加",
    pendingGuideTooltip: "実行中のタスクを中断せずに送信",
    pendingReorderHandle: "待機中のリクエスト {{position}} の順序を変更",
    pendingReorderTooltip: "上下にドラッグして並べ替え",
    pendingReorderInstructions:
      "Space キーで並べ替えを開始し、上下の矢印キーで移動して、Space キーで確定します。Escape キーでキャンセルできます。",
    pendingReorderStarted: "待機中のリクエスト {{position}} を選択しました。",
    pendingReorderOver: "現在の位置は {{position}} です。",
    pendingReorderCompleted: "位置 {{position}} に移動しました。",
    pendingReorderCancelled: "並べ替えをキャンセルしました。",
    pendingDetails: "待機中のリクエストの詳細を表示",
    editPending: "情報を編集",
    closePending: "待機一覧を閉じる",
    pendingTitle: "待機中のリクエスト",
    pendingPriorityCapabilities: "優先プラグイン・スキル",
    pendingAttachmentCount: "待機中の添付ファイル {{count}} 件",
    pendingAttachments: "待機中の添付ファイル",
    pendingBlockedOverload:
      "システムが混み合っています。「続行」を選択して再試行してください。",
    pendingBlockedPreflight:
      "実行前の確認に失敗しました。問題を解決して続行するか、管理者にお問い合わせください。",
    pendingUnknownBlock:
      "実行前の確認に失敗しました。管理者にお問い合わせください。",
    cancelPending: "待機中のリクエストをキャンセル",
    maxPending:
      "待機中のリクエストは 5 件までです。先に既存のリクエストを処理してください。",
    pendingCancelled:
      "待機中のリクエストをキャンセルし、添付ファイルを入力欄に戻しました。",
    pendingContinued:
      "{{productName}} に先頭の待機中リクエストの続行を依頼しました。",
    pendingGuided:
      "先頭の待機中リクエストを現在の実行への指示として追加しました。",
    reconnecting: "接続を復旧中",
    planTitle: "実行計画",
    planProgress: "ステップ {{current}} / {{total}}",
    planChangedFiles_one: "{{count}} 個のファイルを変更",
    planChangedFiles_other: "{{count}} 個のファイルを変更",
    planExpand: "実行計画を展開",
    planCollapse: "実行計画を折りたたむ",
    planStepPending: "保留中",
    planStepInProgress: "進行中",
    planStepCompleted: "完了",
    activity: "作業の概要",
    expandActivity: "作業の詳細を展開",
    collapseActivity: "作業の詳細を折りたたむ",
    intermediateMessage: "途中の応答",
    currentActivity: "現在の作業",
    reasoningActivity: {
      label: "推論",
      expand: "推論を展開",
      collapse: "推論を折りたたむ",
    },
    thinking: "思考",
    processing: "処理中",
    elapsed: "所要時間",
    processingDuration: "処理時間 {{duration}}",
    userMessage: "ユーザーメッセージ",
    assistantMessage: "アシスタントの回答",
    messageActions: "メッセージの操作",
    messageSentAt: "送信日時：{{time}}",
    messageModel: "使用モデル：{{model}}",
    timeSeparator: {
      today: "今日 {{time}}",
      yesterday: "昨日 {{time}}",
      sameYear: "{{date}}、{{time}}",
      otherYear: "{{date}}、{{time}}",
      accessibleLabel: "メッセージの時刻：{{time}}",
    },
    modelChanged:
      "モデルを {{previousModel}} から {{currentModel}} に変更しました。",
    copyMessage: "メッセージをコピー",
    showMore: "さらに表示",
    showLess: "表示を減らす",
    messageSending: "送信中…",
    messageCopied: "メッセージをコピーしました",
    copyMessageFailed:
      "メッセージをコピーできませんでした。再試行してください。",
    forkMessage: "新しいチャットに分岐",
    forkingMessage: "分岐を作成中…",
    forkMessageFailed:
      "分岐したタスクを作成できませんでした。再試行してください。",
    forkSource: {
      continueFromChat: "チャットから続行",
      openSourceTask: "元のタスクを開く：{{title}}",
      unavailable: "元のタスクを利用できません",
    },
    diagram: {
      title: "フローチャート",
      actions: "フローチャートの操作",
      copy: "コードをコピー",
      export: "画像をエクスポート",
      expand: "図を拡大",
      close: "閉じる",
      zoomIn: "拡大",
      zoomOut: "縮小",
      resetZoom: "表示倍率をリセット",
      filename: "フローチャート.png",
      streaming: "図を生成中…",
      loading: "図を描画中…",
      error:
        "この図を表示できません。コードをコピーして確認し、再試行してください。",
      exportFailed: "画像のエクスポートに失敗しました。再試行してください。",
    },
    copyCode: "コードをコピー",
    codeCopied: "コードをコピーしました",
    previewHtmlCode: "HTML コードをプレビュー",
    showHtmlCode: "HTML コードを表示",
    htmlCodePreviewFileName: "HTMLコードのプレビュー.html",
    inlineHtmlPreview: {
      cardLabel: "操作可能な HTML プレビュー",
      frameTitle: "AI が生成した操作可能な HTML ページ",
      generating: "操作可能なコンポーネントを生成中…",
      generatingHint: "生成しています。少し時間がかかる場合があります",
      loading: "操作可能なプレビューを読み込み中…",
      loadFailedTitle: "操作可能なプレビューを一時的に利用できません",
      loadFailedDescription:
        "操作可能なコンポーネントを読み込めませんでした。再試行してください。",
      actions: "HTML プレビューの操作",
      downloadHtml: "HTML ファイルをダウンロード",
      copyImage: "画像としてコピー",
      fullscreen: "全画面でプレビュー",
      exitFullscreen: "全画面プレビューを終了",
      imageCopied: "プレビューを画像としてコピーしました",
      copyImageFailed:
        "プレビューを画像としてコピーできませんでした。再試行してください。",
      fullscreenFailed:
        "全画面プレビューへの切り替えまたは解除ができませんでした。再試行してください。",
    },
    waitingGame: {
      title: "スネークゲーム",
      enter: "クリックするか Enter キーを押すと、スネークゲームで遊べます。",
      controls:
        "矢印キー、WASD、スワイプで方向を変えられます。ダブルクリックまたは Escape キーで待機画面に戻ります。",
    },
    imageGeneration: {
      loading: "画像を生成中…",
    },
    copyTable: "表をコピー",
    tableCopied: "表をコピーしました",
    tableActions: "表の操作",
    tableScrollHint: "横にスクロールすると表全体を確認できます",
    scrollTable: "横スクロール可能な表",
    expandTable: "表を拡大表示",
    tableDialogTitle: "表全体",
    tableDialogDescription: "縦横にスクロールしてすべての内容を確認できます。",
    scrollExpandedTable: "表の全内容",
    copyContentFailed: "コピーできませんでした。再試行してください。",
    editMessage: "メッセージを編集",
    editMessageInput: "メッセージ内容を編集",
    cancelEdit: "キャンセル",
    regenerating: "送信中",
    regenerateFailed: "回答を再生成できませんでした。再試行してください。",
    downloadArtifact: "{{name}} をダウンロード",
    downloadPreparing: "安全なダウンロードリンクを準備中…",
    taskOverview: {
      sources: "出典",
      noSources: "出典はまだありません",
      sourcesError: "出典を読み込めませんでした。再試行してください。",
      open: "タスクの概要を開く",
      close: "タスクの概要を閉じる",
      title: "タスクの概要",
      subagents: "サブエージェント",
      subagentsUsed: "{{count}} 個のサブエージェントを使用",
      subagentsCompleted: "{{count}} 件完了",
      subagentsProgress: "{{completed}} / {{count}} 件完了",
      outputFiles: "出力ファイル",
      noOutputFiles: "出力ファイルはまだありません",
    },
    capabilitiesUsed: "ターンのプラグイン・スキル",
    loaded: "読み込み済み",
    used: "実際に使用",
    priority: "ユーザー指定の優先項目",
    saved: "下書きを保存しました",
    followUpAction: "追加依頼を処理",
    submitFollowUp: "追加依頼を送信",
    pendingBlockCodes: {
      priority_capability_unavailable:
        "選択した優先プラグインまたはスキルが利用できなくなりました。選択し直してください。",
      required_credential_unavailable:
        "必要なプラグイン認証情報がありません。先に関連付けてください。",
      credential_binding_ambiguous:
        "認証情報の関連付けが競合しています。使用する認証情報を明示してください。",
      attachment_unavailable:
        "添付ファイルを利用できません。削除して再アップロードしてください。",
      agents_template_unavailable:
        "実行ルールを利用できません。管理者にお問い合わせください。",
      workspace_invalid:
        "タスクのワークスペースを利用できません。管理者にお問い合わせください。",
      runner_unavailable:
        "実行サービスを利用できません。管理者にお問い合わせください。",
      deployment_stopped:
        "システム更新によりこのリクエストは一時停止しました。進行状況を確認してから、手動で続行してください。",
      execution_environment_invalid:
        "実行環境の準備ができていません。管理者にお問い合わせください。",
      credit_limit_exceeded:
        "このユーザーの利用可能なクレジットを使い切ったため、現在は新しいタスクを開始できません。",
    },
    activities: {
      analysis: "リクエストを分析中",
      analyzing: "リクエストを分析中",
      attachment_read: "添付ファイルを読み込み中",
      plugin_use: "プラグインを使用中",
      skill_use: "スキルを使用中",
      file_write: "ファイルを作成・更新中",
      external_access: "外部サービスにアクセス中",
      step_started: "ステップを開始しました",
      step_completed: "ステップが完了しました",
      tool_started: "ツールを呼び出し中",
      tool_completed: "ツールの呼び出しが完了しました",
      working_in_workspace: "ワークスペースの内容を操作中",
      registering_artifact: "ダウンロード可能な成果物を登録中",
      using_platform_tool: "プラットフォームツールを使用中",
      working: "作業中",
      capability_use: "プラグインまたはスキルを使用中",
      system_capability_used: "ファイルサービスを使用しました",
      reconnecting: "再接続中",
      reconnectingAttempt: "再接続中 {{attempt}}/{{total}}",
      error: "実行中に復旧可能な問題が発生しました",
    },
    streamDisconnectedBeforeCompletion: "完了前にストリームが切断されました。",
    streamDisconnectedWarning:
      "応答ストリームが切断されたためタスクを停止しました",
    nativeActivities: {
      fileChangeRunning_one: "{{count}} 個のファイルを更新中",
      fileChangeRunning_other: "{{count}} 個のファイルを更新中",
      fileChangeCompleted_one: "{{count}} 個のファイルを更新しました",
      fileChangeCompleted_other: "{{count}} 個のファイルを更新しました",
      fileChangeRunningGeneric: "ファイルを更新中",
      fileChangeCompletedGeneric: "ファイルを更新しました",
      webSearchRunning: "ウェブを検索中",
      webSearchCompleted: "ウェブを検索しました",
      knowledgeSearchRunning: "選択したナレッジベースを検索中",
      knowledgeSearchCompleted: "ナレッジベースの検索が完了しました",
      knowledgeSearchFailed: "ナレッジベースの検索に失敗しました",
      knowledgeSearchNoAvailableBases:
        "この実行で利用可能なナレッジベースはありません",
      imageViewRunning: "画像を確認中",
      imageViewCompleted: "画像を確認しました",
      imageGenerationRunning: "画像を生成中",
      imageGenerationCompleted: "画像を生成しました",
      enteredReviewMode: "レビューモードを開始しました",
      exitedReviewMode: "レビューモードを終了しました",
      contextCompactionRunning: "コンテキストを圧縮中",
      contextCompactionCompleted: "コンテキストを圧縮しました",
      contextCompactionIncomplete: "コンテキストの圧縮が完了しませんでした",
      collabAgentRunning: "サブエージェントを調整中",
      collabAgentCompleted: "サブエージェントを調整しました",
      subAgentStarted: "サブエージェントが作業を開始しました",
      subAgentUpdated: "サブエージェントを更新しました",
      subAgentCompleted: "サブエージェントが完了しました",
      subAgentInterrupted: "サブエージェントを中断しました",
      summary: {
        separator: " · ",
        loadedTools: {
          leading_one: "ツールを読み込みました",
          leading_other: "ツールを読み込みました",
          following_one: "ツールを読み込みました",
          following_other: "ツールを読み込みました",
          running_one: "ツールを読み込み中",
          running_other: "ツールを読み込み中",
        },
        calledTools: {
          leading_one: "ツールを呼び出しました",
          leading_other: "ツールを呼び出しました",
          following_one: "ツールを呼び出しました",
          following_other: "ツールを呼び出しました",
          running_one: "ツールを呼び出し中",
          running_other: "ツールを呼び出し中",
        },
        editedFiles: {
          leading_one: "ファイルを編集しました",
          leading_other: "ファイルを編集しました",
          following_one: "ファイルを編集しました",
          following_other: "ファイルを編集しました",
          running_one: "ファイルを編集中",
          running_other: "ファイルを編集中",
        },
        readFiles: {
          leading: "ファイルを読み込みました",
          following: "ファイルを読み込みました",
          running: "ファイルを読み込み中",
        },
        commands: {
          leading_one: "コマンドを実行しました",
          leading_other: "コマンドを実行しました",
          following_one: "コマンドを実行しました",
          following_other: "コマンドを実行しました",
          running_one: "コマンドを実行中",
          running_other: "コマンドを実行中",
        },
        webSearch: {
          leading: "ウェブを検索しました",
          following: "ウェブを検索しました",
          running: "ウェブを検索中",
        },
        dynamicTool: "{{tool}}",
      },
    },
    subAgentActivities: {
      agentList: "{{count}} 個のサブエージェント",
      agentFallback: "サブエージェント {{number}}",
      agentStatus: "{{name}}：{{status}}",
      openAgent: "サブエージェント {{name}} を開く",
      detailPanelLabel: "{{name}} の詳細",
      closeDetails: "サブエージェントの詳細を閉じる",
      resizeDetails: "サブエージェントの詳細表示のサイズを変更",
      loadingDetails: "サブエージェントの作業履歴を読み込み中",
      detailLoadFailed: "サブエージェントの詳細を読み込めませんでした。",
      noDetails: "作業の詳細はまだありません。",
      continuedAfterInterruption: "サブエージェントは中断後に続行しました。",
      continuedAfterFailure: "サブエージェントは失敗後に続行しました。",
      status: {
        pendingInit: "準備中",
        running: "作業中",
        started: "作業を開始しました",
        updated: "更新日時",
        interrupted: "中断",
        completed: "完了",
        errored: "失敗",
        shutdown: "停止済み",
        notFound: "見つかりません",
      },
    },
    nativeActivityDetails: {
      expand: "{{activity}} の詳細を展開",
      collapse: "{{activity}} の詳細を折りたたむ",
      commands: "コマンドの詳細",
      fileChanges: "ファイル変更の詳細",
      queries: "検索クエリの詳細",
      fields: {
        duration: "所要時間",
        server: "サーバー",
        tool: "ツール",
        plugin: "プラグイン",
        namespace: "名前空間",
        result: "結果",
        action: "操作",
        url: "URL",
        pattern: "パターン",
        path: "パス",
        prompt: "プロンプト",
        review: "レビュー",
      },
      actions: {
        read: "読み取り",
        listFiles: "ファイル一覧",
        search: "検索",
        unknown: "その他",
        openPage: "ページを開く",
        findInPage: "ページ内を検索",
        other: "その他",
      },
      fileKinds: {
        add: "追加済み",
        delete: "削除済み",
        update: "更新日時",
      },
      values: {
        succeeded: "成功",
        failed: "失敗",
      },
    },
  },
  applications: {
    opening: {
      expired:
        "この起動セッションは利用できなくなっています。アプリケーション一覧に戻って開き直してください。",
      back: "アプリケーションに戻る",
    },
    editMetadata: "アプリの詳細を編集",
    editMetadataPublishDescription:
      "アプリのアイコン、名前、説明を編集します。保存すると反映されます。共有版とアプリケーションセンターのバージョンは別途更新します。",
    editMetadataDescription: "アプリのアイコン、名前、説明を変更します。",
    editDraftMetadataDescription:
      "開発中のアプリに保存します。「マイアプリケーション」に変更を反映するには公開してください。",
    distribution: {
      versionNumber: "バージョン番号",
      editVersionLower:
        "既存の最新バージョン v{{version}} より低いバージョンは指定できません。",
      editVersionHint:
        "既存のバージョンを維持するか、1.0.0 の形式で上位のバージョンを入力してください。",
      versionHint:
        "推奨バージョンを入力済みです。変更する場合は 1.0.0 のような形式を使用してください。",
      publishFirst:
        "このアプリケーションを共有・掲載するには、先にバージョンを公開してください。",
      publishedVersionHint:
        "この公開済みバージョンを共有・掲載します。新しい変更は先に公開してください。",
      serviceInstallationHint:
        "インストールすると、作成者のアプリケーションリソースを利用できます。新しいバージョンへの更新は手動で行います。会話と作業ファイルは保持されます。",
      availableVersion: "利用可能 · v{{version}}",
      versionInvalid: "1.0.0 のような有効なバージョンを入力してください。",
      versionSame:
        "バージョン v{{version}} は既に存在します。より高いバージョンを入力してください。",
      versionLower:
        "既存の最新バージョン v{{version}} より高いバージョンを指定してください。",
      saveSharing: "共有設定を保存",
      applyListing: "掲載を申請",
      completeSetup: "設定を完了",
      installedVersion: "インストール済み · v{{version}}",
      editModes: "利用方法を編集",
      direct: "組織に共有",
      center: "アプリケーションセンター",
      myApplications: "マイアプリケーション",
      sharedApplications: "自分と共有",
      usageModes: "利用方法",
      usageModesHint:
        "少なくとも 1 つ選択してください。両方を提供することもできます。",
      modes: {
        install: "アプリケーションパッケージ",
        service: "アプリケーションサービス",
      },
      modeDescriptions: {
        install:
          "ユーザーが自分用のアプリケーションをインストールし、自分の認証情報を設定して個別に管理します。",
        service:
          "ユーザーがアプリケーションサービスを手動でインストールし、あなたが設定したリソースと認証情報を利用します。",
      },
      install: "アプリケーションをインストール",
      useService: "利用する",
      installationName: "インストールするアプリケーション名",
      installationHint:
        "アプリケーションと付属のプラグイン・スキルをアカウントに保存します。認証情報、ナレッジベース、外部接続はご自身で設定してください。",
      installed:
        "アプリケーションをインストールしました。必要な設定を確認して完了してください。",
      installedLabel: "インストール済み",
      openInstalled: "自分のアプリケーションを開く",
      configure: "アプリケーションを設定",
      guide: "利用ガイド",
      version: "v{{version}}",
      submit: "承認を申請",
      submitHint:
        "管理者がこのバージョンと利用方法を審査します。その後の変更は再申請が必要で、承認済みバージョンが自動で置き換わることはありません。",
      releaseNotes: "リリースノート",
      submitted: "管理者に承認を申請しました。",
      withdraw: "申請を取り下げる",
      withdrawn: "申請を取り下げました。",
      unlist: "掲載を停止",
      relist: "再掲載",
      statusSaved: "掲載状況を更新しました。",
      noReleases: "申請済みのバージョンはまだありません。",
      noCenterApplications: "センターにアプリケーションはまだありません",
      centerSearch: "アプリケーションセンターを検索",
      centerUnavailable:
        "このアプリケーションは現在、利用またはインストールできません。",
      updateAvailable: "更新があります",
      checkUpdate: "更新を確認",
      updateTitle: "インストール済みアプリケーションを更新",
      update: "アプリケーションを更新",
      updateHint:
        "更新すると、アプリケーションへの変更が置き換えられます。会話、作業ファイル、個人の認証情報は保持されます。先にこのアプリケーションの通常のタスクをすべて完了してください。",
      upToDate: "利用可能な最新バージョンです。",
      updateUnavailable:
        "現在、更新を利用できません。インストール済みのアプリケーションは保持されます。",
      updated: "アプリケーションを更新しました。個人設定は保持されています。",
      setupRequired: "設定が必要",
      preserved: "以下の個人による変更は保持されます：{{fields}}",
      fields: {
        name: "アプリケーション名",
        instructions: "アプリケーションの指示",
        model: "モデル",
        reasoning_effort: "推論の強度",
        capabilities: "プラグインとスキル",
        resources: "ナレッジベースと外部接続",
      },
      review: "アプリケーションを審査",
      approve: "承認",
      reject: "却下",
      reviewComment: "審査コメント",
      reviewed: "審査結果を保存しました。",
      reviewInstructions: "アプリケーションの指示",
      suspend: "アプリケーションの掲載を停止",
      resume: "アプリケーションを再掲載",
      governanceReason: "理由",
      revokeHint:
        "アクセス権を取り消すと、新規インストールやサービス利用ができなくなります。既存の独立したインストールと履歴は保持されます。",
      saveModes: "利用方法を保存",
      modesSaved: "利用方法を更新しました。",
    },
    publication: {
      noGuide: "作成者は利用ガイドを提供していません。",
    },
    scopeLabel: "アプリケーションの範囲",
    scope: {
      all: "すべてのアプリケーション",
      owned: "自分が作成",
      shared: "自分と共有",
    },
    search: "アプリケーションを検索",
    searchPlaceholder: "アプリケーション名または説明を検索…",
    create: "アプリケーションを作成",
    createTypeDescription: "アプリケーションの作成方法を選択してください。",
    creation: {
      recommended: "おすすめ",
      interactiveTitle: "会話で操作可能なアプリを作成",
      interactiveDescription: "アイデアを伝えると、LinkSense が形にします。",
      start: "作成を開始",
    },
    createStandardApp: "標準アプリを作成",
    createStandardAppDescription:
      "いつも使うツールやリソースを備えた個人用アシスタントを設定します。",
    interactiveApp: "操作可能なアプリケーション",
    importInteractiveApp: "操作可能なアプリをインポート",
    importInteractiveAppDescription:
      "既存のアプリパッケージをアップロードし、「マイアプリケーション」に追加します。",
    updateInteractivePackage: "アプリケーションパッケージを更新",
    interactivePackageUpdated: "更新しました。",
    interactiveAppImported: "インポートしました。",
    interactivePackageRequirements:
      "ルートに manifest.json と index.html を含む ZIP 形式のアプリケーションパッケージをアップロードしてください。",
    applicationPackage: "アプリケーションパッケージ",
    interactivePackageHint:
      "ZIP 形式のみ、最大 {{size}}。更新時は既存のバージョンを維持するか、上位のバージョンを指定できます。",
    interactivePackageSizeInvalid:
      "アプリケーションパッケージが空か、サイズ上限を超えています。",
    importPackageAction: "インポート",
    updatePackageAndPublish: "更新",
    interactivePackageVersionInvalid:
      "パッケージのバージョンは 0.0.1 のような 3 つの数値にしてください。バージョンを更新して再アップロードしてください。",
    importPublicationRetry:
      "インポートが完了していません。必要なリソースを確認して再試行してください。アプリケーションが重複して作成されることはありません。",
    createAndPublish: "作成",
    editAndPublish: "保存",
    editedAndPublished: "保存しました。",
    createPublicationRetry:
      "作成が完了していません。設定を確認して再試行してください。アプリケーションが重複して作成されることはありません。",
    declaration: {
      title: "リソース宣言一覧",
      purpose:
        "操作可能なアプリの作成時に、この一覧を使って必要なプラグイン、スキル、MCP サーバー、ナレッジベースを manifest.json に記述します。",
      search: "リソース名で検索",
      selectAll: "すべて選択",
      selectResults: "検索結果をすべて選択",
      selectType: "{{type}}をすべて選択",
      selectTypeResults: "{{type}}の検索結果をすべて選択",
      selected: "{{count}} 件選択中",
      groupSelected: "{{count}} / {{total}} 件選択中",
      empty: "宣言できるリソースがありません",
      preview: "宣言のプレビュー",
      mergeHint:
        "コピー後、manifest.json の name や version と同じ階層に dependencies フィールドを追加してください。既存の dependencies は置き換え、ファイル全体は上書きしないでください。",
      invalid:
        "有効な宣言を生成できません。プラグインとスキルは合計 50 個、MCP サーバーは 20 個、ナレッジベースは 20 個まで選択できます。リソース名は 1～160 文字にしてください。選択内容または名前を調整してください。",
      copy: "dependencies の JSON をコピー",
      copyFailed:
        "コピーに失敗しました。再試行するか、宣言プレビューのテキストを選択して手動でコピーしてください。",
    },
    dependencies: {
      preview: "必要なリソースを確認",
      hint: "アプリパッケージには、以下のプラグイン、スキルなどのリソースが指定されています。アプリが正常に動作するよう、インポート前にリソースの設定を完了することをおすすめします。",
      empty: "このアプリには必要なリソースの指定がありません。",
      search: "リソースを検索して選択",
      matched: "設定済み",
      unmatched: "未設定",
      clear: "選択を解除",
      serviceOnly:
        "操作可能なアプリはオンラインでのみ利用でき、コピーはできません。作成者が接続したリソースを利用者が再設定する必要はありません。",
      types: {
        plugin: "プラグイン",
        skill: "スキル",
        mcp_server: "MCP サーバー",
        knowledge_base: "ナレッジベース",
      },
    },
    nativeChatPanel: "LinkSense チャット",
    hideNativeChat: "チャットを非表示",
    showNativeChat: "会話を表示",
    resizeNativeChat: "チャットパネルのサイズを変更",
    interactiveRuntimeUnavailable:
      "この操作可能なアプリケーションは現在利用できません。作成者にお問い合わせください。",
    created: "作成しました。",
    updated:
      "アプリケーションを更新しました。今後のタスクのターンでは、最新の設定が自動で使用されます。",
    deleted: "アプリケーションを削除しました。",
    emptyTitle: "利用可能なアプリケーションはまだありません",
    createdByMe: "自分が作成",
    createdBy: "作成者：{{name}}",
    status: {
      active: "有効",
      disabled: "無効",
    },
    noDescription: "説明なし",
    card: {
      capabilityCount: "プラグイン / スキル {{count}} 個",
      knowledgeBaseCount: "ナレッジベース {{count}} 個",
      mcpServerCount: "MCP {{count}} 個",
    },
    capabilityCount: "プラグイン・スキル {{count}} 個",
    knowledgeBaseCount: "ナレッジベース {{count}} 個",
    mcpServerCount: "MCP サーバー {{count}} 個",
    shareTargets: "共有済み · {{targets}}",
    dependencyUnavailable:
      "一部の依存リソースが無効か、利用できません。新しいタスクを開始する前に復旧してください。",
    dependencyUnavailableShort: "現在利用できません。削除できます",
    usesPluginCredentials: "プラグインの認証情報を使用",
    share: "共有",
    shareWithinOrganization: "組織内で共有",
    usage: {
      action: "利用状況分析",
      title: "アプリケーションの使用状況",
      description:
        "選択した期間における「{{name}}」の使用状況とモデル料金を確認します。",
      backToApplications: "アプリケーションに戻る",
      activeUsers: "アクティブユーザー",
      activeUsersHint:
        "選択期間にタスクを作成したか、実際のターンを開始したユーザーの人数（重複なし）",
      coverageTitle: "トークンと料金のデータは収集開始時点以降が対象です",
      coverageDescription:
        "集計対象は {{date}} 以降です。それ以前のタスクとターンも件数には含みますが、過去のトークンや料金を現在の単価で推定することはありません。",
      tokenBreakdownTitle: "トークンの内訳",
      costBreakdownTitle: "料金の内訳",
      unpricedTokens: "未計価トークン",
      modelBreakdownDescription:
        "呼び出し、ターン、トークン、料金をモデル別に確認します。",
      workloadBreakdownDescription:
        "呼び出し、トークン、料金をモデルの用途別に確認します。",
    },
    startChat: "今すぐ試す",
    deleteAction: "アプリケーションを削除",
    deleteTitle: "このアプリケーションを削除しますか？",
    deleteDescription:
      "アプリケーションはプラグインセンターから非表示になり、新しいタスクを開始できなくなります。既存の非公開タスクの履歴は保持されます。",
    editTitle: "アプリケーションを編集",
    createTitle: "アプリケーションを作成",
    editorDescription:
      "モデル、プラグイン・スキル、ナレッジベース、アプリケーションの指示を設定します。バージョン番号を入力し、保存すると反映されます。共有版と掲載版は別途更新します。",
    basicInformation: "基本情報",
    details: {
      title: "アプリケーションの詳細",
      open: "{{name}} の詳細を表示",
      creator: "作成者",
      kinds: {
        standard: "標準アプリケーション",
        interactive: "操作可能なアプリケーション",
      },
      views: {
        configuration: "現在の設定",
        published: "公開済みバージョン",
      },
      resources: "アプリケーションのリソース",
      noResources:
        "このアプリケーションには、設定済みまたは指定済みのリソースがありません。",
      emptyGroup: "この種類のリソースはありません",
      unknownResource: "このリソースは利用できなくなっています",
      resourceGroup: "{{type}}（{{count}}）",
      declaredResource: "アプリケーションによる指定：{{name}}",
      resourceStatus: {
        configured: "設定済み",
        unconfigured: "未設定",
        unavailable: "利用不可",
      },
    },
    runtimeConfiguration: "実行設定",
    icon: "アプリケーションのアイコン",
    iconPresetLabel: "組み込みのアプリケーションアイコン",
    uploadIcon: "画像をアップロード",
    replaceIcon: "画像を置き換え",
    iconHint:
      "PNG、JPEG、WebP 形式。{{size}} 以下、最大 {{dimension}}×{{dimension}} px。",
    iconFileInvalid:
      "形式、ファイルサイズ、画像寸法の上限を満たす画像を選択してください。",
    iconPresets: {
      bot: "ボット",
      search: "調査と検索",
      "book-open": "ナレッジベース",
      "graduation-cap": "教育と研修",
      "briefcase-business": "ビジネスと事務",
      "chart-column": "データ分析",
      "code-xml": "ソフトウェア開発",
      "pen-line": "コンテンツ作成",
      sparkles: "クリエイティブデザイン",
      lightbulb: "企画とイノベーション",
      headset: "カスタマーサービス",
      "file-text": "文書処理",
      landmark: "金融",
      scale: "法務とコンプライアンス",
      "heart-pulse": "医療・ヘルスケア",
      "shield-check": "セキュリティとリスク",
      workflow: "業務の自動化",
      "calendar-clock": "スケジュール管理",
      users: "チームの共同作業",
      "globe-2": "グローバルビジネス",
    },
    instructions: "アプリケーションの指示",
    instructionsDescription:
      "これらの指示はアプリケーションレベルの開発者指示として適用され、共有先には表示されません。",
    model: "モデル",
    userSelectedModel: "チャットでユーザーが選択",
    modelOptionalDescription:
      "モデルを指定しない場合、ユーザーがチャットでモデルと推論の強度を選択できます。",
    reasoningEffort: "推論の強度",
    plugins: "プラグイン",
    pluginsDescription:
      "自分が管理するプラグインを選択します。アプリケーションは各プラグインに関連付け済みの認証情報をそのまま使用します。",
    noPlugins: "利用可能なプラグインがありません。",
    pluginSelectPlaceholder: "プラグインを選択…",
    pluginSearchPlaceholder: "プラグインを検索…",
    skills: "スキル",
    skillsDescription: "自分が管理するスキルを選択します。",
    noSkills: "利用可能なスキルがありません。",
    skillSelectPlaceholder: "スキルを選択…",
    skillSearchPlaceholder: "スキルを検索…",
    knowledgeBases: "ナレッジベース",
    knowledgeBasesDescription:
      "共有先はアプリケーションのタスク内でのみ、このナレッジベースを検索できます。閲覧、プレビュー、ダウンロード、管理はできません。",
    noKnowledgeBases: "利用可能なナレッジベースがありません。",
    knowledgeBaseSelectPlaceholder: "ナレッジベースを選択…",
    knowledgeBaseSearchPlaceholder: "ナレッジベースを検索…",
    mcpServers: "MCP サーバー",
    mcpServersDescription:
      "このアプリケーションで利用する MCP サーバーを選択します。外部への変更を伴うツールを含む全ツールに、現在の実行ポリシーが適用されます。",
    noMcpServers: "利用可能な MCP サーバーがありません。",
    mcpServerSelectPlaceholder: "MCP サーバーを選択…",
    mcpServerSearchPlaceholder: "MCP サーバーを検索…",
    resourceSearchEmpty: "一致する選択肢がありません。",
    removeResource: "{{name}} を解除",
    additionalResources: "ほか {{count}} 件を選択",
    shareTitle: "アプリケーションを共有",
    shareDescription:
      "組織内の指定したユーザーやグループに共有します。iframe で組み込む場合は「外部アクセス」を使用してください。",
    shareTargetType: "共有先",
    shareToUsers: "ユーザー",
    shareToGroups: "ユーザーグループ",
    shareUserTarget: "共有先ユーザー",
    shareGroupTarget: "共有先ユーザーグループ",
    shareUserSearchPlaceholder: "名前またはメールアドレスでユーザーを検索…",
    shareGroupSearchPlaceholder: "名前でユーザーグループを検索…",
    shareSaved: "共有しました。",
    shareGrantType: {
      user: "ユーザー",
      user_group: "ユーザーグループ",
    },
    currentShares: "現在の共有先",
    noShares: "このアプリケーションはまだ誰にも共有されていません。",
    revoke: "取り消す",
    taskUnavailable:
      "このアプリは利用できません。現在、メッセージを送信できません。",
    conversationManaged: "このタスクは「{{name}}」が管理しています",
    conversationManagedDescription:
      "モデル、プラグイン、スキル、ナレッジベースは、アプリケーションの作成者が管理します。",
    conversationManagedUserModelDescription:
      "プラグイン、スキル、ナレッジベース、指示を使用",
    externalAccess: {
      action: "外部アクセス",
      title: "アプリケーションの外部アクセス",
      description:
        "「{{name}}」を許可済みのウェブサイトに埋め込み、外部ユーザーがこのアプリケーションのみを利用できるようにします。",
      backToApplications: "アプリケーションに戻る",
      accessTab: "アクセスと埋め込み",
      accessSettingsSection: "アクセス設定",
      originSettingsSection: "埋め込み元の設定",
      starterQuestionsSection: "定型の質問",
      credentialSettingsSection: "サーバー認証",
      embedSettingsSection: "埋め込み設定",
      enabled: "外部アクセスを有効にする",
      enabledDescription:
        "オフにすると、埋め込みページは利用できなくなり、開いているセッションも失効します。",
      authMode: "認証",
      authRequirementLabel: "認証の要否",
      authModeRequired: "認証が必要",
      authModePublic: "認証なし",
      authRequiredDescription:
        "連携先システム限定の利用に適しています。連携先のサーバーがリクエストを検証してからアプリケーションを開きます。",
      authPublicDescription:
        "公開ページでの利用に適しています。許可済みのウェブサイトは、サーバーでの別途の検証なしにアプリケーションを直接開けます。",
      allowedOrigins: "許可する埋め込み元",
      allowedOriginsPlaceholder:
        "https://portal.example.com\nhttps://ops.example.com",
      allowedOriginsDescription:
        "1 行に 1 つウェブサイトのアドレスを入力してください。保存後、各アドレスに専用の iframe URL と埋め込み例が生成されます。本番環境では HTTPS を使用してください。ローカルテストでは localhost を使用できます。",
      starterQuestions: "定型の質問",
      starterQuestionsDescription:
        "埋め込み元ごとに、おすすめの質問を 4 件まで設定できます。入力したとおりに表示され、選択するとメッセージ欄に入力されます。自動送信はされません。",
      starterQuestionOriginsTabsLabel: "定型の質問を設定する埋め込み元",
      starterQuestionsNeedOrigin:
        "先に許可する埋め込み元を 1 件以上追加してください。",
      starterQuestionsEmpty: "この埋め込み元に定型の質問は設定されていません。",
      starterQuestionLabel: "質問 {{index}}",
      starterQuestionPlaceholder: "ユーザーがすぐに選べる質問を入力",
      starterQuestionDuplicate:
        "同じ埋め込み元では質問を重複させないでください。",
      starterQuestionCount: "{{count}} / {{max}} 件設定済み",
      addStarterQuestion: "質問を追加",
      removeStarterQuestion: "質問 {{index}} を削除",
      appId: "アプリ ID",
      appSecret: "アプリシークレット",
      secretUnavailableValue: "再生成してコピー",
      secretUnavailable:
        "セキュリティのため、保存済みのシークレットは再表示されません。完全な値が必要な場合は再生成し、連携先システムに渡してください。",
      rotateSecret: "再生成",
      rotateConfirmTitle: "アプリシークレットを再生成しますか？",
      rotateConfirmDescription:
        "再生成後は、連携先システムで新しいシークレットを使用する必要があります。開いている埋め込みページは失効します。",
      changeConfirmTitle: "外部アクセスのセキュリティ設定を保存しますか？",
      changeConfirmDescription:
        "保存後、開いている埋め込みページは新しい設定で検証されるため、開き直しが必要になる場合があります。",
      secretRotated:
        "アプリシークレットを再生成しました。既存の外部セッションは無効になりました。",
      embedOrigin: "埋め込み元",
      embedOriginsTabsLabel: "埋め込み元の一覧",
      embedOriginTab: "埋め込み元 {{index}}",
      currentEmbedOrigin: "現在の埋め込み元",
      iframeUrl: "iframe URL",
      embedCode: "埋め込み例",
      serverCredentialWarning:
        "認証が必要な場合は、連携先システムのサーバーで検証を行ってください。フロントエンドのコードにアプリシークレットを含めないでください。",
      saved: "外部アクセスの設定を保存しました。",
      copyFailed: "コピーに失敗しました。内容を手動で選択してください。",
      snippetTitle: "埋め込みアプリケーション",
      snippetTicketComment:
        "今回のアクセス用認証情報をバックエンドから取得してください。ここにアプリシークレットを公開しないでください。",
    },
  },
  skillUpdate: {
    description:
      "現在のスキルを編集するか、完全なスキルパッケージをアップロードします。変更内容を確認してから更新を確定してください。",
    loading: "現在のスキルを読み込み中…",
    loadFailed: "現在のスキルを読み込めませんでした。再試行してください。",
    mode: "更新方法",
    edit: "スキル内容を編集",
    replace: "スキルパッケージ全体を置き換え",
    preserveNotice:
      "表示名、説明、指示のみを変更します。既存のスクリプト、テンプレート、画像などのファイルは保持されます。それらを変更するには、完全なパッケージをダウンロードして編集し、「スキルパッケージ全体を置き換え」を選択してください。",
    replaceNotice:
      "新しいパッケージで現在のスキルを置き換えます。新しいパッケージに含まれない既存ファイルは削除されます。スキルに必要なファイルをすべて含む完全なパッケージをアップロードしてください。",
    identifierHint: "更新してもスキルの識別子は変わりません。",
    content: "スキルの指示",
    contentRequired: "スキルの指示を入力してください。",
    contentTooLarge:
      "指示が長すぎるため、オンラインでは編集できません。完全なスキルパッケージをダウンロードして編集し、再アップロードしてください。",
    noChanges: "変更はまだありません。",
    files: "現在のスキルファイル",
    download: "完全なスキルパッケージをダウンロード",
    selectedFile: "選択済み：{{name}}",
    uploading: "アップロード中：{{percentage}}%",
    checking: "変更とリスクを確認中…",
    check: "変更とリスクを確認",
    confirm: "更新を確定",
    changes: "ファイルの変更",
    changeSummary:
      "追加 {{added}}、変更 {{modified}}、削除 {{deleted}}、変更なし {{unchanged}} ファイル。",
    added: "追加するファイル",
    modified: "変更するファイル",
    deleted: "削除するファイル",
    deleteNotice:
      "これらのファイルは新しいパッケージに含まれていないため、確定すると削除されます。スキルに必要ないか確認してください。",
    confirmDeletions:
      "これら {{count}} 個のファイルを削除することを確認しました",
  },
  marketplace: {
    title: "プラグインセンター",
    description:
      "公開プラグインとスキルを閲覧し、インストール済みコンテンツ、個人用コンテンツ、MCP 接続を一元管理します。",
    personalAccountDescription:
      "インストール済みコンテンツ、個人用コンテンツ、スキルリポジトリ、MCP 接続を管理します。",
    adminTitle: "プラグインセンター",
    adminDescription:
      "変更不可のリリーススナップショットを審査し、プラグインセンターへの表示を管理します。リスクが見つかった場合は直ちに掲載を停止できます。",
    adminTabsLabel: "プラグインセンターの管理セクション",
    tabs: {
      store: "プラグインセンター",
      mine: "マイプラグイン・スキル",
      publishing: "自分の公開コンテンツ",
      reviews: "掲載審査",
      listings: "すべての掲載項目",
    },
    catalogTabsLabel: "プラグインセンターのカテゴリ",
    catalogTabs: {
      plugin: "プラグイン",
      skill: "スキル",
      mcp: "MCP",
      application: "アプリケーション",
    },
    catalogDescriptions: {
      application:
        "アプリケーションを作成・管理し、利用可能なアプリを探します。",
      plugin: "プラグインを閲覧・管理し、タスクにツールや接続を追加します。",
      skill:
        "スキルリポジトリを閲覧し、さまざまなタスク向けのスキルをインストール・管理します。",
      mcp: "MCP 接続とプラグインを管理し、タスクで必要なツールやデータを利用できるようにします。",
    },
    catalogScopesLabel: "コンテンツの範囲",
    scopes: {
      public: "公開",
      personal: "個人",
    },
    installedTitle: "インストール済み",
    loadingInstalled: "インストール済みコンテンツを読み込み中…",
    installedEmpty: "{{category}}はまだインストールされていません。",
    installedListLabel: "インストール済みの{{category}}",
    expandInstalled: "インストール済みの{{category}}を展開",
    collapseInstalled: "インストール済みの{{category}}を折りたたむ",
    searchCategory: "{{category}}を検索",
    publicCatalogLabel: "公開{{category}}",
    personalCatalogLabel: "個人用{{category}}",
    personalCatalogEmpty: "この条件に一致する個人用{{category}}はありません。",
    personalMcpConnections: "MCP 接続",
    personalMcpPackages: "MCP 拡張パッケージ",
    includesMcp: "MCP を含む",
    manageMcp: "MCP を管理",
    status: {
      draft: "下書き",
      published: "公開済み",
      unlisted: "掲載停止中",
      suspended: "掲載停止中",
      pending: "審査待ち",
      approved: "承認済み",
      rejected: "未承認",
      withdrawn: "取り下げ済み",
    },
    search: "プラグインセンターを検索",
    searchPlaceholder: "名前、説明、公開者で検索…",
    capabilityType: "種類",
    itemType: "種類",
    catalogEmpty: "この条件に一致する公開済みの{{category}}はありません。",
    byPublisher: "公開者：{{publisher}}",
    publisher: "公開者",
    noDescription: "説明なし",
    noKnownRisks:
      "既知のリスク宣言は検出されませんでした。インストールする前に、信頼できる公開者か確認してください。",
    releaseNumber: "リリース {{number}}",
    installCount: "{{count}} 件のインストール",
    riskSummary: "リスクの概要",
    manifest: "マニフェストのスナップショット",
    releaseNotes: "リリースノート",
    noReleaseNotes: "リリースノートはありません。",
    contentHash: "コンテンツの SHA-256",
    viewDetails: "{{name}} の詳細を表示",
    install: "インストール",
    installing: "インストール中",
    installingPluginStatus: "プラグインをインストール中…",
    installingSkillStatus: "スキルをインストール中…",
    installingMcpStatus: "MCP をインストール中…",
    update: "更新",
    updatingPluginStatus: "プラグインを更新中…",
    updatingSkillStatus: "スキルを更新中…",
    updatingMcpStatus: "MCP を更新中…",
    updateAvailable: "更新があります",
    updateInstallation: "最新リリースに更新",
    installed:
      "プラグインセンターから個人用プラグイン・スキルとしてインストールしました。",
    installedPlugin:
      "プラグインセンターから個人用プラグインとしてインストールしました。",
    installedSkill:
      "プラグインセンターから個人用スキルとしてインストールしました。",
    installedMcp:
      "プラグインセンターから個人用 MCP としてインストールしました。",
    installationUpdated:
      "インストール済みコンテンツを現在の承認済みリリースに更新しました。",
    installationUpdatedPlugin:
      "プラグインセンターのプラグインを現在の承認済みリリースに更新しました。",
    installationUpdatedSkill:
      "プラグインセンターのスキルを現在の承認済みリリースに更新しました。",
    installationUpdatedMcp:
      "プラグインセンターの MCP を現在の承認済みリリースに更新しました。",
    installedState: "インストール済み",
    storeOrigin: "プラグインセンターからインストール",
    uninstall: "アンインストール",
    uninstalling: "アンインストール中",
    uninstallingPluginStatus: "プラグインをアンインストール中…",
    uninstallingSkillStatus: "スキルをアンインストール中…",
    uninstallingMcpStatus: "MCP をアンインストール中…",
    uninstallTitle:
      "プラグインセンターのこのプラグイン・スキルをアンインストールしますか？",
    uninstallPluginTitle:
      "プラグインセンターのこのプラグインをアンインストールしますか？",
    uninstallSkillTitle:
      "プラグインセンターのこのスキルをアンインストールしますか？",
    uninstallMcpTitle:
      "プラグインセンターのこの MCP をアンインストールしますか？",
    uninstallDescription:
      "個人用のインストールと関連する個人設定を削除します。プラグインセンターの公開内容には影響しません。",
    uninstalled:
      "プラグインセンターのプラグイン・スキルをアンインストールしました。",
    uninstalledPlugin:
      "プラグインセンターのプラグインをアンインストールしました。",
    uninstalledSkill: "プラグインセンターのスキルをアンインストールしました。",
    uninstalledMcp: "プラグインセンターの MCP をアンインストールしました。",
    ownedCapabilitiesEmpty: "個人用のプラグインまたはスキルはまだありません。",
    preferenceUpdated: "有効・無効の設定を更新しました。",
    personalCapabilityDeleted: "個人用プラグイン・スキルを完全に削除しました。",
    personalPluginDeleted: "個人用プラグインを完全に削除しました。",
    personalMcpDeleted: "個人用 MCP を完全に削除しました。",
    updatePersonalCapability: "個人用プラグイン・スキルを更新",
    updatePersonalPlugin: "個人用プラグインを更新",
    updatePersonalSkill: "個人用スキルを更新",
    updatePersonalMcp: "個人用 MCP を更新",
    personalImportDescription:
      "まずソースを解析し、リスクを表示します。再確認後にのみインストールまたは置き換えを行います。",
    personalPluginImportDescription:
      "まずソースを解析し、リスクを表示します。再確認後にのみ個人用プラグインをインストールまたは置き換えます。",
    personalSkillImportDescription:
      "まずソースを解析し、リスクを表示します。再確認後にのみ個人用スキルをインストールまたは置き換えます。",
    importSources: {
      local: "ローカル ZIP パッケージ",
      manualSkill: "スキルを手動で作成",
    },
    zipPackage: "ZIP 形式のプラグイン・スキルパッケージ",
    zipPackageHint:
      "プラグインまたはスキルのパッケージ仕様に準拠した ZIP ファイルのみ使用できます。",
    zipPluginPackage: "ZIP 形式のプラグインパッケージ",
    zipPluginPackageHint:
      "プラグインのパッケージ仕様に準拠した ZIP ファイルのみ使用できます。",
    zipSkillPackage: "ZIP 形式のスキルパッケージ",
    zipSkillPackageHint:
      "スキルのパッケージ仕様に準拠した ZIP ファイルのみ使用できます。",
    skillMarkdown: "SKILL.md の内容",
    skillIdentifier: "スキルの識別子",
    skillNameRequired: "スキルの識別子を入力してください。",
    skillNameTooLong: "スキルの識別子は 64 文字以内にしてください。",
    skillNameInvalid:
      "英小文字、数字、ハイフン（-）のみ使用できます。先頭・末尾のハイフンや連続するハイフンは使用できません。",
    skillNameReserved:
      "このスキル識別子はシステム用に予約されています。別の識別子を指定してください。",
    skillDisplayName: "表示名（任意）",
    skillDisplayNameHint:
      "スキルの識別子から生成されます。編集または空欄にすることもできます。中国語の文字やスペースも使用できます。",
    skillNameHint:
      "英小文字、数字、ハイフン（-）で 1～64 文字にしてください。先頭・末尾のハイフンや連続するハイフン、組み込みスキル名は使用できません。例：my-skill。",
    skillPreview: "スキル内容のプレビュー",
    applyForListing: "掲載を申請",
    pendingReviewAction: "掲載審査待ち",
    publishNew: "新規掲載を申請",
    submitUpdate: "新しいリリースを申請",
    publishDialogDescription:
      "現在の個人用プラグインまたはスキルを変更不可のスナップショットとしてコピーし、管理者に審査を申請します。",
    sourceCapability: "個人用プラグイン・スキルのソース",
    noPublishableSource:
      "この掲載項目と同じ名前・種類の公開可能な個人用プラグインまたはスキルがありません。先にプラグインセンターでソースをインポートまたは更新してください。",
    immutableSnapshotNotice:
      "審査対象は独立した変更不可のスナップショットです。後から個人用プラグインやスキルを編集しても、この審査中のリリースは変わりません。",
    submitForReview: "審査を申請",
    submitted: "リリーススナップショットの審査を管理者に申請しました。",
    submittedAt: "申請日：{{date}}",
    reviewPolicyNotice:
      "新しいリリースは毎回審査されます。承認済みリリースが既存のインストールを自動更新することはありません。",
    publicationsEmpty:
      "アプリケーション、プラグイン、スキルの申請はまだありません。",
    publicationsDescription:
      "申請済みのアプリケーション、プラグイン、スキルを管理し、審査状況を確認して更新を公開します。",
    backToCenter: "プラグインセンターに戻る",
    manageApplicationListing: "掲載項目を管理",
    selectApplication: "掲載するアプリケーションを選択",
    selectApplicationDescription:
      "アプリケーションを選び、バージョンと利用方法を設定して管理者に審査を申請します。",
    noPublishableApplication:
      "条件を満たすアプリケーションがありません。検索条件を変更するか、先に「マイアプリケーション」でアプリを作成して有効にしてください。",
    withdraw: "審査申請を取り下げる",
    withdrawn: "審査待ちのリリースを取り下げました。",
    unlist: "プラグインセンターでの掲載を停止",
    unlisting: "掲載を停止しています…",
    unlistConfirmTitle: "「{{name}}」の掲載を停止しますか？",
    unlistConfirmDescription:
      "このコンテンツはプラグインセンターに表示されなくなり、新しいユーザーはインストールできなくなります。既存のインストールは引き続き実行・更新できます。",
    relist: "再掲載",
    unlisted:
      "掲載を停止しました。既存のインストールは引き続き実行・更新できます。",
    relisted: "プラグインセンターで再び表示されるようになりました。",
    releaseDetail: "リリースの詳細",
    releaseDetailDescription:
      "スナップショットのファイル、リスク宣言、スキル内容、コンテンツハッシュを確認します。",
    packageFiles: "スナップショットのファイル",
    adminTitleShort: "プラグインセンター",
    reviewsEmpty: "審査待ちのリリースはありません。",
    listingsEmpty: "プラグインセンターの掲載項目はまだありません。",
    review: "レビュー",
    reviewRelease: "「{{name}}」を審査",
    reviewDescription:
      "判断はこの変更不可のリリースにのみ適用されます。却下する場合は明確な理由が必要です。",
    reviewDecision: "審査結果",
    reviewComment: "審査コメント",
    approvalCommentOptional: "承認時のコメントは任意です。",
    rejectionCommentRequired: "却下時は理由が必須です。",
    approve: "承認",
    reject: "却下",
    submitReview: "審査結果を送信",
    reviewApproved:
      "リリースを承認し、プラグインセンターの現行リリースに設定しました。",
    reviewRejected: "リリースを却下し、理由を公開者に送信しました。",
    suspendListing: "掲載を停止",
    resumeListing: "再掲載",
    suspendListingTitle: "「{{name}}」の掲載を停止しますか？",
    suspendListingDescription:
      "プラグインセンターから非表示になり、インストール済みのすべてのコピーで新しいタスクを開始できなくなります。",
    resumeListingTitle: "「{{name}}」を再掲載しますか？",
    resumeListingDescription:
      "プラグインセンターに再表示され、インストール済みのコピーを新しいタスクで再び使用できます。",
    suspensionReason: "掲載停止の理由",
    listingSuspended:
      "掲載を停止しました。すべてのインストールで新しいタスクの開始がブロックされました。",
    listingResumed: "再掲載しました。",
    risks: {
      contains_mcp_server: "MCP サーバーを含む",
      contains_scripts: "実行可能なスクリプトを含む",
      contains_external_connections:
        "外部サービスにアクセスする可能性があります",
      requires_environment_variables: "環境変数が必要です",
      requires_credentials: "認証情報が必要です",
      contains_dependency_download_commands:
        "依存パッケージをダウンロードする可能性があります",
      declaredEnvironmentKeys: "環境変数：{{values}}",
      mcpEnvironmentReferences: "MCP の環境変数",
      mcpEnvironmentReference: "{{server}} · {{source}}",
      environmentSource: {
        local: "個人の認証情報から取得",
        remote: "リモート環境から取得",
      },
    },
  },
  clawHub: {
    sourceName: "ClawHub",
    repository: "スキルリポジトリ",
    catalogLabel: "ClawHub スキルリポジトリ",
    search: "スキルリポジトリを検索",
    loading: "スキルリポジトリを読み込み中…",
    refreshing: "更新中…",
    empty: "利用可能なスキルがありません",
    emptyDescription:
      "利用可能な ClawHub スキルの情報はまだ同期されていません。",
    noSearchResults: "一致するスキルがありません",
    noSearchResultsDescription: "「{{search}}」に一致するスキルがありません。",
    sourceNotice:
      "スキル情報は ClawHub から取得しています。LinkSense は ClawHub の代理ではなく、これらのスキルの審査や推奨も行っていません。インストール前に提供元とリスクを確認してください。",
    listLabel: "スキルリポジトリの検索結果",
    sortLabel: "スキルを並べ替え",
    sort: {
      downloads: "ダウンロード数",
      stars: "スター数",
    },
    totalCount: "合計：{{count}}",
    byOwner: "作成者：{{owner}}",
    version: "バージョン {{version}}",
    downloads: "{{count}} 回ダウンロード",
    stars: "{{count}} スター",
    owner: "所有者",
    latestVersion: "最新バージョン",
    downloadCount: "ダウンロード数",
    starCount: "スター数",
    updatedAt: "ClawHub での更新日時",
    syncedAt: "最終同期",
    topics: "トピック",
    platformRequirements: "プラットフォーム要件",
    changelog: "変更履歴",
    openCanonical: "ClawHub で表示",
    installedState: "インストール済み",
    unavailableState: "利用不可",
    viewDetails: "{{name}} の詳細を表示",
    preparing: "準備中…",
    paginationLabel: "スキルリポジトリのページ",
    pageNumber: "{{page}} ページ",
    installTitle: "「{{name}}」をインストールしますか？",
    updateTitle: "「{{name}}」を更新しますか？",
    installPreviewDescription:
      "ClawHub のバージョン、提供元、リスクを確認してください。確定後にのみ個人用スキルに追加されます。",
    packageIdentity: "スキルの提供元",
    versionToInstall: "インストールするバージョン",
    installFailedTitle: "インストールに失敗しました",
    installing: "インストール中…",
    installingStatus: "スキルをインストール中…",
    updatingStatus: "スキルを更新中…",
    confirmInstall: "インストールを確定",
    confirmUpdate: "更新を確定",
    installed: "スキルリポジトリから個人用スキルとしてインストールしました。",
    updated: "スキルリポジトリからのインストールを最新に更新しました。",
    origin: "ClawHub からインストール",
    uninstall: "アンインストール",
    uninstalling: "アンインストール中",
    uninstallingStatus: "スキルをアンインストール中…",
    uninstallTitle: "この ClawHub スキルをアンインストールしますか？",
    uninstallDescription:
      "個人用のインストールと関連する個人設定を削除します。同期済みのリポジトリ情報には影響しません。",
    uninstalled: "ClawHub スキルをアンインストールしました。",
    securityNoticeTitle: "セキュリティに関するお知らせ",
    security: {
      clean: "セキュリティ確認に合格",
      warning: "セキュリティ上の警告",
      flagged: "リスクが検出されました",
      unknown: "インストール時に確認済み",
      warningDescription:
        "このスキルのセキュリティ状態には注意が必要です。提供元を信頼できる場合にのみインストールしてください。",
    },
    installability: {
      unavailable: "このスキルは現在利用できません。",
      missingVersion: "このスキルにインストール可能なバージョンはありません。",
      alreadyInstalled: "このバージョンは既にインストールされています。",
    },
  },
  applicationDevelopment: {
    aiWorking: "{{productName}} がアプリを自動開発中",
    actions: "アプリケーションの操作",
    annotations: {
      start: "注釈を付ける",
      finish: "注釈モードを終了",
      unavailable:
        "現在、このページに注釈を付けられません。アプリのプレビューを開き直してください。",
      changed:
        "ページが変更されました。注釈を消去して注釈モードを終了し、プレビューが更新されてから選択し直してください。",
    },
    metadata: {
      name: "アプリケーション名",
      description: "アプリケーションの説明",
      editName: "アプリケーション名を編集",
      editDescription: "アプリケーションの説明を編集",
      addDescription: "アプリケーションの説明を追加",
      invalidName: "アプリケーション名を 1～160 文字で入力してください。",
      invalidDescription: "説明は 4,000 文字以内にしてください。",
      changed:
        "アプリケーションが変更されました。再読み込みしてから編集してください。",
      reload: "再読み込み",
    },
    publish: {
      draft: "下書き",
      action: "公開",
      update: "更新を公開",
      done: "公開済み",
      pending: "公開中…",
      title: "アプリケーションを公開",
      confirm: "公開",
      successTitle: "公開しました",
      successDescription:
        "「{{name}}」v{{version}} を公開しました。「マイアプリケーション」から利用できます。",
      description:
        "公開すると「{{name}}」を利用できるようになります。\n「マイアプリケーション」から開けます。",
      updateDescription:
        "公開後は「{{name}}」の新しいバージョンを使用します。\n共有アプリ：再共有し、共有先に手動での更新を依頼してください。\n掲載アプリ：アプリケーションセンターへ別途更新を申請してください。\n公開前に、このアプリで実行中のタスクがないことを確認してください。",
      checking: "実行中のタスクを確認中…",
      activeTasks:
        "このアプリには実行中のタスクがあります。完了してから公開してください。状態は自動更新されます。",
      checkFailed: "タスクの状態を確認できません。公開前に再試行してください。",
      changed:
        "アプリに新しい変更があります。公開ウィンドウを閉じて開き直してください。",
    },
    deleteDescription:
      "アプリケーション、開発中の下書き、デバッグの会話履歴を削除します。開発用の会話、通常のタスク、ワークスペースのファイルは保持されます。",
    tests: {
      title: "デバッグの会話履歴",
      empty: "デバッグの会話はまだありません",
      emptyHint:
        "アプリのプレビューでタスクを送信すると、入力、結果、進行状況がここに表示されます。",
      current: "現在のデバッグの会話",
      restart: "新しいデバッグの会話",
      summary: "実行回数：{{count}}",
      submitted: "デバッグのリクエストを送信しました",
      view: "履歴を表示",
      more: "履歴をさらに読み込む",
      detailHint:
        "入力、出力、ファイル、作業履歴を確認できます。ここで現在のデバッグの会話を停止したり、対応待ちのリクエストを処理したりできます。",
      delete: "デバッグの会話を削除",
      deleteHint:
        "このデバッグの会話を完全に削除し、実行用リソースをクリーンアップします。",
      deleteDevelopmentHint:
        "この開発用の会話を完全に削除します。アプリケーション、下書き、デバッグの会話履歴は「マイアプリケーション」に残り、開発の続行や削除ができます。",
      status: {
        idle: "送信済み",
        running: "進行中",
        completed: "完了",
        failed: "失敗",
        interrupted: "停止済み",
      },
    },
    resizePreview: "アプリケーションのプレビューサイズを変更",
    developmentTask: "アプリケーション開発タスク",
    previewTask: "アプリケーションのデバッグの会話",
    catalog: {
      newDevelopment: "新しい開発バージョン",
      continueDevelopment: "開発を続行",
      developNewVersion: "新しいバージョンを開発",
      deleteDraft: "開発中の下書きを削除",
      deleteDraftDescription:
        "下書きとそのデバッグの会話を削除します。公開済みアプリケーション、開発用の会話、通常のタスク、ワークスペースのファイルは保持されます。",
      draftDetails: "開発中の下書き",
      savedAt: "最終保存：{{time}}",
      unpublishedHint:
        "これらの変更はまだ公開されていません。アプリケーションの利用時は引き続き公開済みバージョンが開きます。",
      filter: "アプリケーションを絞り込む",
      all: "すべてのアプリケーション",
      developing: "開発中",
      standard: "標準アプリケーション",
      interactive: "操作可能なアプリケーション",
      draftDescription:
        "このアプリケーションは未公開です。メニューから開発を続行してください。",
      empty: "一致するアプリケーションがありません",
      loadMore: "アプリケーションをさらに読み込む",
    },
    create: "操作可能なアプリケーションを作成",
    createHint:
      "会話で作成し、作業中に変更をプレビューして、準備ができたらインストールします。",
    name: "アプリケーション名",
    start: "作成を開始",
    creating: "準備中…",
    continue: "開発",
    workspace: "アプリケーション開発ワークスペース",
    waitingForTest:
      "デバッグの会話はまだ実行中です。完了すると、最新の変更が自動的に表示されます。",
    debug: "デバッグ",
    preview: "プレビュー",
    diagnostics: "デバッグログ（{{count}}）",
    capabilities: "機能を設定",
    capabilitiesHint:
      "このアプリケーションが使用できる機能を選択します。保存した選択は開発プレビューに適用され、インストールや更新時にも含まれます。",
    capabilitySearch: "検索して選択…",
    reloadCapabilities: "設定を再読み込み",
    capabilitiesChanged:
      "アプリケーションが変更されました。保存前に設定を再読み込みしてください。",
    capabilityUnavailable: "利用不可",
    capabilitiesUnavailable:
      "選択した機能の一部を利用できません。保存前に置き換えるか解除してください。",
    capabilityLimits:
      "プラグインとスキルは合計 50 個、ナレッジベースは 20 個、MCP サーバーは 20 個まで選択できます。",
    capabilityHints: {
      plugin: "このアプリケーションに必要なサービスとツールを接続します。",
      skill: "アプリケーションのタスクで使用するスキルを選択します。",
      knowledge_base:
        "このアプリケーションが参照できるナレッジベースを選択します。",
      mcp_server: "このアプリケーションが呼び出せる MCP サーバーを選択します。",
    },
    sourceError:
      "現在の変更はまだ実行できません。アシスタントにアプリケーションの修正を依頼してください。プレビューには最後に正常に動作したバージョンが表示されています。",
    preparing: "プレビューを準備しています",
    preparingHint:
      "準備ができると、ここにアプリケーションが表示されます。先に必要なプラグインやナレッジベースを設定してください。",
    noErrors: "デバッグログはまだありません",
    noErrorsHint:
      "プレビューでアプリケーションを試してください。実行時のエラーはここに記録され、アシスタントが確認して問題の解決を支援できます。",
  },
  capability: {
    title: "プラグインとスキル",
    description:
      "個人用プラグイン、スキル、プラグインセンターのソース、実行状況を管理します。",
    builtIn: "組み込み",
    builtInReadOnly:
      "プラットフォームが自動で追加します。選択、無効化、編集、削除はできません。",
    builtIns: {
      browser: {
        name: "{{productName}} ブラウザー",
        description:
          "分離された管理対象ブラウザーで、ページの閲覧、サイトの操作、スクリーンショットの撮影を行います。",
      },
      documentReader: {
        name: "{{productName}} ドキュメントリーダー",
        description:
          "タスク内の一般的なオフィス文書、電子書籍、CSV、テキスト型 PDF を Markdown に変換し、AI が安全に読み取れるようにします。",
      },
      docs: {
        name: "{{productName}} ドキュメント",
        description:
          "公式の中英 2 言語のヘルプ文書に基づき、製品の利用方法や管理に関する質問に回答します。",
      },
      coreMcp: {
        name: "{{productName}} コア MCP",
        description:
          "1 つの組み込み MCP で、ドキュメント変換、成果物の登録、画像生成、ナレッジ検索、スキル作成を提供します。",
      },
      fileService: {
        name: "{{productName}} ファイルサービス",
        description:
          "現在のタスクで作成した納品用ファイルを、ダウンロード可能な成果物として登録します。",
      },
      imageGeneration: {
        name: "{{productName}} 画像生成",
        description:
          "管理者が設定したモデルを使用し、組み込み MCP で画像の成果物を生成します。",
      },
      knowledgeBase: {
        name: "{{productName}} ナレッジ",
        description:
          "選択したナレッジベースを検索し、タスクに必要なドキュメントを読み取ります。",
      },
      applicationBuilder: {
        name: "{{productName}} 対話型アプリケーション開発",
        description:
          "会話を通じてアプリケーションを作成・編集し、リアルタイムのプレビュー、デバッグ、インストールを行います。",
      },
      skillCreator: {
        name: "{{productName}} スキル作成",
        description:
          "確認済みの作業手順を、完全で再利用可能な個人用スキルに変換します。",
      },
    },
    pluginTitle: "プラグイン",
    pluginDescription:
      "個人用プラグイン、プラグインセンターのソース、実行状況を管理します。",
    skillTitle: "スキル",
    skillDescription:
      "個人用スキル、プラグインセンターのソース、実行状況を管理します。",
    typeTabsLabel: "プラグインとスキルの種類",
    tabs: {
      plugin: "プラグイン",
      skill: "スキル",
    },
    searchPlaceholder: "{{type}}の名前または説明を検索…",
    installed: "インストール済み",
    sourceTabsLabel: "提供元",
    viewMore: "ほか {{count}} 件を表示",
    viewMorePreview: "{{names}} を表示",
    viewMorePreviewWithCount: "{{names}} とほか {{count}} 件を表示",
    collapseList: "表示を減らす",
    noSearchResults: "一致する{{type}}が見つかりません。",
    add: "プラグイン・スキルを追加",
    addPlugin: "プラグインを追加",
    addSkill: "スキルを追加",
    install: "プラグイン・スキルをインストール",
    importType: "インポート方法",
    localImport: "ローカルアーカイブ",
    manualSkill: "スキルを手動で作成",
    packageFile: "プラグイン・スキルパッケージ",
    skillContent: "SKILL.md の内容",
    skillContentPreview: "SKILL.md 本文",
    skillContentEmpty: "SKILL.md の本文が空です。",
    skillContentTruncated:
      "SKILL.md の本文が長いため、プレビューは一部を省略しています。インストール時には全文が使用されます。",
    descriptionLabel: "説明",
    riskTitle: "提供元とリスクを確認",
    riskDescription:
      "インストールする内容には、スクリプト、MCP サーバー、外部接続、環境変数、認証情報の要件が含まれる場合があります。提供元を信頼できる場合にのみ続行してください。",
    riskConfirm: "提供元とリスクに関する注意事項を確認しました",
    installSubmit: "インストールを確定",
    previewSubmit: "ソースとリスクを確認",
    previewing: "確認中…",
    uploading: "アップロード中",
    parsing: "アップロード完了。確認中…",
    importingPluginStatus: "プラグインをインポート中…",
    importingSkillStatus: "スキルをインポート中…",
    updatingPluginStatus: "プラグインを更新中…",
    updatingSkillStatus: "スキルを更新中…",
    deletingPluginStatus: "プラグインを削除中…",
    uninstallingSkillStatus: "スキルをアンインストール中…",
    previewConfirmDescription:
      "以下の解析結果を確認してください。確認欄にチェックして送信した後にのみ、プラグインまたはスキルをインストール・更新します。",
    previewExpires: "プレビューの有効期限",
    importKind: "インポート内容",
    logoIncluded: "ロゴを含む",
    declaredCapabilities: "宣言",
    declaredEnvironmentKeys: "宣言された環境変数名",
    manifestSummary: "マニフェストの概要",
    noneDeclared: "宣言なし",
    noRisksDetected:
      "既知のリスク項目は検出されませんでした。それでも提供元を信頼できるか確認してください。",
    sourceTypes: {
      local: "ローカルからインポート",
      url: "URL からインポート",
      clawhub: "ClawHub スキルリポジトリ",
    },
    importKinds: {
      manual_skill: "手動作成のスキル",
      zip: "ローカル ZIP パッケージ",
    },
    declarations: {
      mcp_server: "MCP サーバー",
      scripts: "実行可能なスクリプト",
      external_connections: "外部サービスへの接続",
      environment_variables: "環境変数",
      credentials: "認証情報",
      dependency_download_commands:
        "依存パッケージをダウンロードする可能性のあるコマンド",
    },
    installCompleted: "プラグイン・スキルをインストールしました。",
    installSkillCompleted: "スキルをインストールしました。",
    updateCompleted: "プラグイン・スキルを更新しました。",
    updatePluginCompleted: "プラグインを更新しました。",
    updateSkillCompleted: "スキルを更新しました。",
    pluginSavedForNextTurn:
      "プラグインを保存しました。次のタスクのターン開始前に自動で更新されます。",
    statusUpdated: "有効・無効の設定を更新しました。",
    empty: "プラグインまたはスキルはインストールされていません。",
    pluginEmpty: "プラグインはインストールされていません。",
    skillEmpty: "スキルはインストールされていません。",
    source: "提供元",
    owner: "所有者",
    personal: "個人",
    plugin: "プラグイン",
    skill: "スキル",
    enable: "有効にする",
    disable: "無効にする",
    personallyDisable: "自分の利用を無効にする",
    personallyEnable: "自分の利用を有効にする",
    personallyDisabledMessage:
      "このプラグインまたはスキルの個人利用を無効にしました。",
    personallyEnabledMessage:
      "このプラグインまたはスキルの個人利用を有効にしました。",
    uninstall: "アンインストール",
    uninstalling: "アンインストール中",
    skillUninstalled: "スキルをアンインストールしました。",
    logo: "ロゴを置き換え",
    deleteTitle: "このプラグイン・スキルを完全に削除しますか？",
    deletePluginTitle: "このプラグインを完全に削除しますか？",
    deleteMcpTitle: "この MCP を完全に削除しますか？",
    deleteDescription:
      "関連する個人設定と認証情報の関連付けを完全に削除します。この操作は取り消せません。",
    uninstallSkillTitle: "このスキルをアンインストールしますか？",
    uninstallSkillDescription:
      "このスキルと、関連する個人設定および認証情報の関連付けを削除します。この操作は取り消せません。",
    updatePlugin: "プラグインを更新",
    updateSkill: "スキルを更新",
    updateSubmit: "更新を確定",
    riskDetected:
      "このプラグインまたはスキルには、注意が必要な実行時のリスクが宣言されています。",
    riskDetails: "リスク項目",
    risks: {
      contains_mcp_server: "MCP サーバーを含みます。",
      contains_scripts: "実行可能なスクリプトを含みます。",
      contains_external_connections: "外部サービスに接続する可能性があります。",
      requires_environment_variables: "環境変数の要件が宣言されています。",
      requires_credentials: "認証情報の要件が宣言されています。",
      contains_dependency_download_commands:
        "依存パッケージをダウンロードする可能性のある起動コマンドを含みます。",
      declared_environment_keys: "環境変数名：{{values}}",
      dependency_commands: "依存パッケージのコマンド：{{values}}",
    },
  },
  credential: {
    title: "プラグインの認証情報",
    add: "認証情報を追加",
    personal: "個人の認証情報",
    capabilityId: "プラグイン ID",
    credentialId: "認証情報 ID",
    deleteTitle: "この認証情報を完全に削除しますか？",
    edit: "認証情報を編集",
    confirmCreate: "作成を確定",
    confirmUpdate: "更新を確定",
    disableTitle: "この認証情報を無効にしますか？",
    enableTitle: "この認証情報を有効にしますか？",
    providerPlaceholder: "例：openai_api",
    nameInvalid: "認証情報の名前を 160 文字以内で入力してください。",
    plugin: "プラグイン",
    description:
      "プラグインの認証情報には、外部サービスへのアクセスに使用する API キーなどの情報が含まれます。認証情報を追加してプラグインに関連付けると、実行時に自動で使用されます。",
    secret: "認証用の値",
    secretHint:
      "保存したキーや認証情報は再表示されません。名前にシークレットを含めないでください。",
    bind: "プラグインを関連付け",
    lastUsed: "最終使用",
    empty:
      "認証情報はまだありません。プラグインが外部サービスにアクセスする必要がある場合、ここでキーなどの認証情報を追加してください。",
    deleteDescription:
      "この認証情報を使用するプラグインは、これを使って外部サービスにアクセスできなくなります。認証情報と関連付けは完全に削除され、復元できません。",
    disableDescription:
      "以後の実行では、プラグインがこの認証情報を使用しなくなります。既存のプラグインとの関連付けは保持されます。",
    enableDescription:
      "関連付け済みプラグインは、以後の実行でこの認証情報を再び使用できます。",
    providerType: "サービスの識別子",
    providerTypeHint:
      "openai_api など、サービスに指定された識別子を入力してください。英小文字、数字、アンダースコア、ハイフンを使用できます。",
    providerTypeFormat:
      "サービスの識別子には、openai_api のように英小文字、数字、アンダースコア、ハイフンを使用してください。",
    secretKey: "設定項目名",
    secretKeyHint:
      "API_KEY など、プラグインが必要とする名前を入力してください。プラグインの説明に記載された名前を正確にコピーしてください。",
    secretKeyFormat:
      "設定項目名は英字またはアンダースコアで始め、英数字とアンダースコアのみを使用してください。",
    secretKeyDuplicate: "設定項目名は重複させないでください。",
    secretRequired: "保存する認証情報を入力してください。",
    keepSecretHint:
      "空欄にすると保存済みの値を保持します。新しい値を入力すると置き換えます。",
    savedSecretHint:
      "保存済みの認証情報は表示されません。新しい値を入力しない限り保持されます。",
    bindings: "関連付け済みプラグイン",
    bindingPriority:
      "プラグインを選択し、この認証情報から使用する項目を確認してください。以後の実行でプラグインが使用します。",
    mappingTitle: "使用する情報を確認",
    mappingDescription:
      "名前が一致する項目は自動選択されています。残りの項目は、この認証情報から対応する情報を選択してください。",
    pluginEnvironmentKey: "プラグインが必要とする情報",
    credentialField: "この認証情報から使用",
    notMapped: "未選択",
    bindingInProgress: "プラグインの関連付けを保存中…",
    bindingSucceeded: "プラグインの関連付けを保存しました。",
    confirmBind: "関連付けを保存",
    unbindTitle: "この情報の関連付けを解除しますか？",
    unbindDescription:
      "「{{plugin}}」は、この認証情報から「{{name}}」を読み取らなくなります。保存済みの情報は保持されます。",
    confirmUnbind: "関連付けを解除",
    unbindNamed: "{{name}} の関連付けを解除",
    addSecretField: "設定項目を追加",
    removeSecretField: "この設定項目を削除",
    noDeclaredKeys: "このプラグインに設定が必要な認証情報はありません。",
    pluginCount_one: "{{count}} 個のプラグインで使用中",
    pluginCount_other: "{{count}} 個のプラグインで使用中",
    associatedFields_one: "{{count}} 項目を関連付け済み",
    associatedFields_other: "{{count}} 項目を関連付け済み",
    notAssociated:
      "まだどのプラグインも使用していません。プラグインに関連付けると実行時に自動で使用されます。",
    unavailablePlugin: "アクセスできないプラグイン",
    credentialDetails: "認証情報の詳細",
    showDetails: "設定の詳細を表示",
    hideDetails: "設定の詳細を非表示",
    pluginActionsNamed: "{{name}} の関連付け操作",
    detailsNamed: "{{name}} の設定詳細",
    manageAssociation: "関連付けを管理",
    removeAssociation: "プラグインの関連付けを解除",
    removeAssociationTitle: "このプラグインの関連付けを解除しますか？",
    removeAssociationDescription:
      "「{{name}}」はこの認証情報のすべての項目を使用しなくなります。認証情報は保持され、後から再び関連付けられます。",
    completeConfiguration: "設定を完了",
    fixAssociation: "関連付けを修正",
    enableAction: "認証情報を有効にする",
    configurationNote:
      "保存済みの設定を表示しています。外部サービスへのアクセスを検証するものではありません。",
    usesField: "この認証情報の使用項目：",
    otherCredential: "別の認証情報から取得します。",
    removeField: "関連付けを解除",
    removeFieldNamed: "{{name}} の関連付けを削除",
    mappingSummary: "{{total}} 項目中 {{configured}} 項目を選択済み",
    unselectedFields: "未選択：",
    selectInformation: "情報を選択・調整",
    configurationStatus: {
      loading: "確認中…",
      failed: "状態を取得できません",
      unavailable: "プラグインを利用できません",
      configured: "認証情報を設定済み",
      missing: "追加情報が必要です",
      disabled: "この認証情報は無効です",
      disabledElsewhere: "認証情報の一部が無効です",
      conflict: "関連付けが競合しています",
      invalid: "設定の更新が必要です",
    },
    configurationHelp: {
      failed: "設定の状態を読み込めませんでした。再試行してください。",
      unavailable:
        "このプラグインは利用できないか、アクセス権がありません。関連付けを解除するか、管理者にお問い合わせください。",
      missing:
        "このプラグインには未設定の情報があります。詳細で不足している項目を確認し、設定を完了してください。",
      disabled:
        "プラグインが再び情報を使用できるよう、この認証情報を有効にしてください。",
      disabledElsewhere:
        "このプラグインが使用する別の認証情報が無効です。その認証情報を有効にするか、関連付けを更新してください。",
      conflict:
        "同じ項目が複数の認証情報に関連付けられています。関連付けを管理し、使用する情報を選択してください。",
      invalid:
        "関連付けた情報を使用できないか、プラグインの要件と一致しなくなっています。保存済みの値を確認し、関連付けを更新してください。",
    },
    fieldStatus: {
      configured: "設定済み",
      missing: "未設定",
      disabled: "この値の提供元の認証情報は無効です",
      conflict: "複数の認証情報に関連付けられています",
      invalid: "更新が必要です",
    },
  },
  profile: {
    title: "個人設定",
    description: "アバター、表示言語、ログインのセキュリティを管理します。",
    avatar: "アバター",
    uploadAvatar: "新しいアバターをアップロード",
    editName: "名前を編集",
    editNameTitle: "名前を編集",
    editNameDescription: "表示名を更新します。",
    role: "ロール",
    profileSaved: "個人設定を保存しました。",
    passwordChanged: "パスワードを変更しました。再度ログインしてください。",
    general: "一般",
    security: "ログインのセキュリティ",
    avatarSaved: "アバターを更新しました。",
    usageSummary: "個人の使用状況の概要",
    loadingUsage: "個人の使用状況を読み込み中…",
    totalTokens: "合計トークン",
    peakDailyTokens: "1 日の最大トークン数",
    totalTasks: "合計タスク数",
    currentStreak: "現在の連続利用日数",
    longestStreak: "最長連続利用日数",
    dayCount_one: "{{count}} 日",
    dayCount_other: "{{count}} 日間",
    tokenActivity: "トークン使用状況",
    tokenActivityDescription: "過去 365 日間の日別トークン使用量です。",
    activityChartLabel: "過去 365 日間のトークン使用量ヒートマップ",
    activityDayLabel: "{{date}}、{{tokens}} トークン使用",
    activityTooltip: "{{date}} に {{tokens}} トークン使用",
    activityLess: "少ない",
    activityMore: "多い",
    activityUnavailable: "トークン使用履歴はまだありません。",
    usageInsights: "使用状況の分析",
    totalTurns: "合計チャット数",
    modelCalls: "合計モデル呼び出し数",
    skillUses: "スキル使用回数",
    activeDays: "利用日数",
    averageTokensPerTurn: "1 ターンあたりの平均トークン数",
    mostUsedModels: "よく使うモデル",
    mostUsedSkills: "よく使うスキル",
    modelUsageShare: "{{model}} が合計トークンの {{share}}% を占めています",
    skillUsageCount_one: "{{count}} 回使用",
    skillUsageCount_other: "{{count}} 回使用",
    noModelUsage: "モデルの使用履歴はまだありません。",
    noSkillUsage: "スキルの使用履歴はまだありません。",
    passwordDescription:
      "パスワードを変更すると、既存のセッションは無効になり、再ログインが必要になります。",
  },
  usage: {
    title: "利用状況分析",
    description:
      "タスク、ターン、モデルのトークン使用量、料金を全体・アプリケーション別・現在の所属グループ別・ユーザー別に確認します。",
    sectionLabel: "利用状況分析と請求",
    sections: {
      analytics: "利用状況分析",
      billing: "請求",
    },
    billing: {
      pageDescription:
        "暦月ごとにモデル別で集計された明細を確認し、オンラインでプレビューしたり PDF に出力したりできます。",
      period: "請求期間",
      total: "明細の合計額",
      modelCount: "モデル",
      generatedAt: "生成済み",
      current: {
        title: "現在の請求期間",
        description: "明細は月末の締め後に自動生成されます。",
        open: "進行中",
        expectedGeneration: "生成予定",
      },
      history: {
        title: "月次明細",
        description:
          "モデルの使用量と料金の、変更不可の月次スナップショットです。",
        empty: "月次明細はまだ生成されていません。",
      },
      detail: {
        title: "明細の詳細",
        description: "明細の詳細を読み込み中…",
      },
      columns: {
        model: "モデル",
        input: "入力トークン",
        cached: "キャッシュ済みトークン",
        output: "出力トークン",
        totalTokens: "合計トークン",
        pricing: "料金設定",
        amount: "金額",
      },
      uniformPricing: "固定単価",
      mixedPricing: "複数の単価",
      preview: {
        action: "オンラインでプレビュー",
      },
      export: {
        action: "PDF をエクスポート",
        success: "明細 PDF をエクスポートしました。",
        filename: "{{statementNumber}}-明細.pdf",
      },
      pdf: {
        statement: "月次明細",
        accountStatement: "モデル利用明細",
        statementNumber: "明細番号",
        billingPeriod: "請求期間",
        generatedAt: "生成日時",
        currency: "通貨",
        pricePerMillion: "100 万トークンあたりの単価",
        inputShort: "入力",
        cachedShort: "キャッシュ",
        outputShort: "出力",
        totalAmount: "明細の合計額",
        unpricedNote:
          "{{tokens}} トークンには単価の記録がないため、請求金額に含まれていません。",
        page: "{{current}} / {{total}} ページ",
        footer:
          "呼び出し時に記録した単価に基づき、LinkSense が自動生成しました。",
      },
    },
    rangeLabel: "集計期間",
    ranges: {
      all: "全期間",
      sevenDays: "過去 7 日間",
      thirtyDays: "過去 30 日間",
      custom: "期間を指定",
    },
    customRange: {
      dateFrom: "開始日",
      dateTo: "終了日",
      selectDate: "日付を選択",
      clearDate: "日付を解除",
    },
    export: {
      action: "Excel をエクスポート",
      exporting: "エクスポート中…",
      success: "利用状況分析をエクスポートしました。",
      filename: "{{productPrefix}}-利用状況分析-{{date}}.xlsx",
    },
    tasks: "タスク",
    turns: "ターン数",
    modelCalls: "モデル呼び出し数",
    totalTokens: "合計トークン",
    totalCost: "合計料金",
    inputCost: "入力料金",
    cachedInputCost: "キャッシュ入力料金",
    outputCost: "出力料金",
    sort: {
      asc: "{{field}}の昇順で並べ替え",
      desc: "{{field}}の降順で並べ替え",
    },
    tasksHint:
      "選択期間中に作成されたタスク数です。後から削除しても履歴は変わりません",
    turnsHint:
      "選択期間中に作成された実際のターン数です。後から削除しても履歴は変わりません",
    tokensHint:
      "回答、ドキュメントのベクトル化、クエリのベクトル化、再ランキングを含みます",
    costHint:
      "各呼び出し時に記録した単価に基づいて合計します。後から単価を変更しても履歴は変わりません",
    unpricedTokensHint:
      "{{tokens}} トークンには単価の記録がないため、料金に含まれません",
    unpricedShort: "{{tokens}} トークン未計価",
    trend: {
      title: "トークン使用量の推移",
      description:
        "選択期間の合計トークンを{{granularity}}で集計し、モデルの用途別に積み上げて表示します。",
      empty: "選択期間のトークン使用量はありません。",
      ariaLabel: "選択期間のトークン使用量の推移",
      granularity: {
        day: "日別",
        month: "月別",
        year: "年別",
      },
    },
    costTrend: {
      title: "料金の推移",
      description:
        "呼び出し時に記録された料金を{{granularity}}で集計し、モデルの用途別に積み上げて表示します。",
      empty: "選択期間のモデル料金はありません。",
      ariaLabel: "選択期間のモデル料金の推移",
    },
    tabsLabel: "利用状況分析の集計軸",
    tabs: {
      models: "モデル別",
      workloads: "用途別",
      applications: "アプリケーション別",
      groups: "グループ別",
      users: "ユーザー別",
    },
    modelsTitle: "すべてのモデルの使用状況",
    modelsDescription:
      "生成、埋め込み、再ランキングの各モデルの呼び出し、トークン内訳、料金です。",
    tableCostUnit: "料金の単位：人民元（CNY）。",
    modelsEmpty: "選択期間のモデル使用量はありません。",
    workloadsTitle: "モデルの用途別使用状況",
    workloadsDescription:
      "AI の回答、タスクの自動命名、メモリ生成、ナレッジドキュメントのベクトル化、検索クエリのベクトル化、検索結果の再ランキングを区別します。プロバイダーが使用量を返さない場合は推定値と表示します。",
    workloadsEmpty: "選択期間のモデル用途別使用量はありません。",
    applicationsTitle: "アプリケーションの使用状況",
    applicationsDescription:
      "各タスクの作成時に関連付けられたアプリケーション別に、タスク、ターン、モデル呼び出し、トークン、料金を集計します。アプリケーション外で発生した使用量は別に表示します。",
    applicationsEmpty: "選択期間のアプリケーション使用量はありません。",
    applicationDetailDescription:
      "このアプリケーションに関連付けられたタスクのモデル使用状況",
    application: "アプリケーション",
    unattributedApplication: "アプリケーションとの関連付けなし",
    workload: "モデルの用途",
    workloads: {
      assistant_response: "AI の回答",
      memory_generation: "メモリ生成",
      task_title_generation: "タスクの自動命名",
      document_embedding: "ドキュメントのベクトル化",
      query_embedding: "クエリのベクトル化",
      rerank: "検索結果の再ランキング",
      image_generation: "画像生成",
    },
    modelKinds: {
      generation: "生成モデル",
      embedding: "埋め込みモデル",
      rerank: "再ランキングモデル",
      image: "画像モデル",
    },
    measurementMethod: "集計方法",
    measurementMethods: {
      provider: "プロバイダーから取得",
      estimated: "ローカルで推定",
    },
    groupsTitle: "グループの使用状況",
    groupsDescription:
      "現在の有効な所属関係に基づいて集計します。1 人のユーザーが複数グループに含まれる場合があるため、グループの値を足しても全体の合計にはなりません。",
    currentMembership: "現在の所属関係",
    groupDetailDescription: "現在のメンバー {{count}} 人のモデル使用状況",
    usersTitle: "ユーザーの使用状況",
    usersDescription:
      "各ユーザーのタスク、ターン、モデルのトークン使用量です。",
    searchUsers: "名前またはメールアドレスでユーザーを検索",
    usersEmpty: "一致するユーザーがいません。",
    modelBreakdown: "モデル別の内訳",
    model: "モデル",
    inputTokens: "入力トークン",
    cachedInputTokens: "キャッシュ済み入力トークン",
    outputTokens: "出力トークン",
    reasoningOutputTokens: "推論出力トークン",
    group: "グループ",
    members: "メンバー",
    ungrouped: "グループ未所属のユーザー",
    unknownModel: "不明なモデル",
    noSelection: "利用可能なデータがありません",
    tokenCompositionNote:
      "キャッシュ済み入力トークンは入力トークンに、推論出力トークンは出力トークンに含まれるため、合計に重複加算しません。タスクとターンの件数は変更不可の作成記録に基づくため、後からタスクを削除しても減りません。",
    costCompositionNote:
      "料金は精度を保って保存・集計し、小数点以下 2 桁で表示します。表示する明細の合計が表示上の総額に一致するよう、端数差を各合計内で比例配分します。通常の入力料金にはキャッシュ入力を含めず、キャッシュ入力は専用単価で計算します。単価と料金は各呼び出しの記録時に確定し、後の単価変更で履歴を再計算することはありません。",
  },
  myFeedback: {
    title: "自分のフィードバック",
    description: "送信したフィードバックと管理者からの返信を確認します。",
    empty: "フィードバックはまだありません",
    emptyDescription: "ヘルプメニューから問題や提案をお知らせください。",
    replyStatus: "返信状況",
    replied: "返信済み",
    awaitingReply: "返信待ち",
    detailsDescription: "フィードバックと返信履歴を確認します。",
    replies: "返信",
    noReplies: "返信はまだありません",
    writeReply: "ユーザーに返信",
    replyHint: "テキスト、画像、またはその両方を送信できます。",
    replyPlaceholder: "返信を入力…",
    replyImages: "返信の画像",
    replySuccess: "返信を送信しました",
    sendingReply: "送信中…",
    sendReply: "返信を送信",
  },
  adminFeedback: {
    title: "ユーザーフィードバック",
    description:
      "ユーザーが送信したフィードバックと問題のスクリーンショットを確認します。",
    empty: "ユーザーのフィードバックはまだありません。",
    submitter: "送信者",
    content: "フィードバック",
    images: "画像",
    submittedAt: "送信済み",
    imageCount: "{{count}} 枚の画像",
    imageCount_other: "{{count}} 枚の画像",
    detailsTitle: "フィードバックの詳細",
    detailsDescription: "{{name}} が {{time}} に送信",
    imageList: "フィードバックの画像",
    imageAlt: "フィードバックの画像 {{name}}",
    openImage: "{{name}} を拡大表示",
    imagePreviewTitle: "画像のプレビュー",
    imageLoading: "画像を読み込み中",
    imageUnavailable: "この画像は一時的に利用できません。",
    pagination: "ユーザーフィードバック一覧のページ切り替え",
    deleteLabel: "{{name}} のフィードバックを削除",
    deleteTitle: "このフィードバックを削除しますか？",
    deleteDescription:
      "{{name}} が送信したフィードバック、すべての返信と画像を削除します。この操作は取り消せません。",
    deleting: "削除中…",
    deleteSuccess: "フィードバックを削除しました。",
  },
  systemUpdate: {
    notice: {
      title: "LinkSense {{version}} が利用可能です",
      description:
        "管理者はリリース内容を確認し、手順に沿ってアップグレードできます。",
      action: "更新を表示",
      dismiss: "このバージョンの更新通知を閉じる",
    },
    status: {
      update_available: "更新があります",
      up_to_date: "最新です",
      check_failed: "確認に失敗",
    },
    overview: {
      title: "バージョンの状態",
      description: "公式 LinkSense GitHub リリースを自動確認します。",
    },
    currentVersion: "現在のバージョン",
    latestVersion: "最新バージョン",
    checkedAt: "最終確認",
    publishedAt: "公開済み",
    checkNow: "今すぐ確認",
    openRelease: "GitHub リリースを表示",
    releaseNotes: "リリースノート",
    refreshFailed: "更新の再確認に失敗しました",
    checkFailed: {
      title: "最新バージョンの情報を一時的に取得できません",
      GITHUB_UNAVAILABLE:
        "サーバーから GitHub に接続できませんでした。ネットワーク接続を確認して再試行してください。",
      GITHUB_RATE_LIMITED:
        "GitHub が更新確認を一時的に制限しています。しばらくしてから再試行してください。",
      GITHUB_RESPONSE_INVALID:
        "GitHub が返したリリース情報を LinkSense で認識できませんでした。しばらくしてから再試行してください。",
    },
    tutorial: {
      title: "更新ガイド",
      description:
        "アップグレードスクリプトは Core・Full エディションを判別し、実行中の作業を待機して、移行前にデータベースのバックアップを作成・検証します。",
      safetyTitle:
        "ウェブアプリケーションが自動でアップグレードを開始することはありません",
      safetyDescription:
        "LinkSense ホストのターミナルでコマンドを実行してください。事前にメンテナンス時間を確保し、管理者がサービスの状態を確認できるようにしてください。",
      linux: "Linux",
      macos: "macOS（sudo は使用しないでください）",
      steps: {
        maintenance:
          "利用の少ない時間帯にメンテナンスを予定し、利用中のユーザーに通知してください。",
        run: "LinkSense ホストにログインし、その OS 用のコマンドを実行してください。",
        backup:
          "スクリプトに表示された PostgreSQL バックアップの保存場所を控えてください。データベースの移行開始後に失敗しても、データベースは自動では元に戻りません。",
        health:
          "アップグレードが完了したら「システムの状態」を開き、すべてのサービスが復旧したことを確認してください。",
      },
    },
  },
  admin: {
    usersAndGroupsTitle: "ユーザーとグループ",
    usersAndGroupsDescription:
      "ユーザーアカウント、ロール、ステータス、グループ、メンバーを一元管理します。",
    usersAndGroupsTabsLabel: "ユーザーとグループの管理",
    usersTitle: "ユーザー",
    usersDescription:
      "利用を許可したユーザーを作成・インポート・管理します。管理者はユーザーのパスワードを閲覧・再設定できません。",
    rolesTitle: "ロールと権限",
    rolesDescription:
      "{{productName}} の現在の機能における固定ロールと権限の範囲を確認します。権限は有効なアカウントにのみ適用されます。ロールはユーザー管理から割り当ててください。",
    roleUserDescription:
      "自分のタスク、個人設定、プラグイン・スキル、認証情報を管理し、プラグインセンターを利用できます。所有するナレッジベースを作成・管理し、共有されたナレッジベースを利用できます。",
    roleAdminDescription:
      "有効な管理者はユーザー権限に加え、ユーザーとグループ、プラグインセンター、ナレッジベースの情報とソース、モデルと料金、システム設定、稼働状態、監査情報、使用状況を管理できます。管理者ロールだけでは、他のユーザーのタスクやナレッジベースの内容にアクセスできません。",
    permissionMatrix: "権限一覧",
    permission: "権限",
    roleAccountBreakdown: "ロール別アカウント数",
    roleAccountCount: "{{count}} アカウント",
    roleActiveAccountCount: "有効 {{count}} 件",
    roleDisabledAccountCount: "無効 {{count}} 件",
    rolePermissions: {
      ownConversations: "自分のタスクを管理",
      personalSettings: "プロフィール、外観、セキュリティ設定を管理",
      personalCapabilities: "個人用プラグイン・スキルを作成・インポート・管理",
      usePluginCenter: "プラグインを閲覧・インストール・更新し、掲載審査を申請",
      personalCredentials: "個人の認証情報を管理",
      personalKnowledgeBases:
        "所有するナレッジベースを管理し、共有ナレッジベースを利用",
      manageUsersAndGroups: "ユーザーとユーザーグループを管理",
      governStoreCapabilities: "プラグインセンターの掲載項目を審査・管理",
      governKnowledgeBases:
        "内容への自動アクセス権を伴わずに、ナレッジベースの情報とライフサイクルを管理",
      manageKnowledgeSources: "ナレッジソースと同期を設定",
      manageModelsAndPricing:
        "生成、画像理解、埋め込み、再ランキングのモデルとトークン単価を設定",
      manageSystemSettings: "製品設定とログインプロバイダーを管理",
      manageSystemHealth:
        "システムの状態を確認し、ナレッジベースのメンテナンスを実行",
      viewAuditMetadata:
        "内容を含まない、機密情報を除いた全ユーザーの監査情報とタスク情報を閲覧",
      viewUsageAnalytics:
        "全体・グループ別・ユーザー別のモデル使用状況と料金を閲覧",
    },
    createUser: "ユーザーを作成",
    importUsers: "Excel をインポート",
    role: "ロール",
    registrationSource: "ユーザーの登録元",
    registrationSources: {
      selfRegistration: "自己登録",
      organizationInvitation: "組織からの招待",
    },
    loginMethod: "ログイン方法",
    lastLogin: "最終ログイン",
    weeklyCreditLimit: "週間利用枠（クレジット）",
    creditLimitDisplay: "{{value}} クレジット",
    creditQuotaRemainingFilter: "残りの利用枠",
    filters: {
      allRoles: "すべてのロール",
      allStatuses: "すべての状態",
      allSources: "すべてのユーザー登録元",
      allQuotas: "すべての利用枠",
      allActions: "すべての操作",
      allResults: "すべての結果",
      allRunnerStatuses: "すべての実行環境の状態",
      allArchiveStatuses: "すべてのアーカイブ状態",
    },
    weeklyCreditQuotaRemainingZero: "今週の残りは 0",
    creditQuotaRemainingAmount: "残り {{value}} クレジット（{{percentage}}%）",
    creditQuotaRemainingUnavailable: "残りの利用枠 -",
    noCreditLimit: "無制限",
    inheritCreditLimit: "無制限",
    clearCreditLimit: "空欄でユーザー別の利用枠を解除",
    creditLimitHint:
      "正の数を入力してください。小数も使用できます。単位はクレジットです。空欄の場合、ユーザー別の利用枠は設定しません。",
    creditLimitInputInvalid:
      "小数点以下 6 桁以内の、0 より大きい数を入力してください。単位はクレジットです。",
    userCreditLimits: "ユーザー別クレジット利用枠",
    userCreditLimitsDescription:
      "週間利用枠は毎週月曜日の午前 0 時にリセットされます。使い切ると新しいタスクを開始できません。実行中のタスクには影響しません。",
    adjustCreditLimits: "利用枠を調整",
    adjustUserCreditLimits: "{{name}} の利用枠を調整",
    singleCreditLimitsTitle: "ユーザー別のクレジット利用枠を調整",
    singleCreditLimitsDescription:
      "{{name}} の週間利用枠を更新します。空欄の場合、ユーザー別の利用枠は設定しません。",
    batchCreditLimits: "利用枠を設定（{{count}}）",
    batchCreditLimitsTitle: "ユーザーのクレジット利用枠を一括設定",
    batchCreditLimitsDescription:
      "選択した {{count}} 人の週間利用枠を設定します。空欄にするとユーザー別の利用枠を解除します。",
    creditLimitFields: "週間利用枠",
    singleCreditLimitsSaved: "{{name}} のクレジット利用枠を更新しました。",
    creditLimitsSaved: "{{count}} 人のクレジット利用枠を更新しました。",
    selectVisibleUsers: "現在の一覧のユーザーを選択",
    selectUser: "ユーザー {{name}} を選択",
    groups: "ユーザーグループ",
    selectGroups: "ユーザーグループを選択",
    searchGroups: "ユーザーグループを検索",
    groupSearchEmpty: "一致するユーザーグループが見つかりません。",
    removeGroup: "ユーザーグループ {{name}} を解除",
    additionalGroups: "ほか {{count}} 個のユーザーグループ",
    userStatus: "ユーザーの状態",
    usersEmpty: "ユーザーが見つかりません。",
    groupsTitle: "ユーザーグループ",
    groupsDescription: "階層のないユーザーグループとメンバーを管理します。",
    createGroup: "ユーザーグループを作成",
    members: "メンバー",
    viewGroupMembers: "{{name}} の {{count}} 人のメンバーを表示",
    groupMembersTitle: "{{name}} のメンバー",
    groupMembersDescription: "{{count}} 人のメンバー",
    groupMembersEmpty: "このユーザーグループにメンバーはいません。",
    memberListLabel: "ユーザーグループのメンバー",
    loadMoreMembers: "メンバーをさらに読み込む",
    memberSelector: "メンバー",
    selectMembers: "メンバーを選択",
    selectedMembers: "{{count}} 人を選択中",
    memberSearchPlaceholder: "名前またはメールアドレスでメンバーを検索",
    memberSearchEmpty: "一致するメンバーが見つかりません。",
    groupsEmpty: "ユーザーグループはありません。",
    auditTitle: "監査ログ",
    auditDescription:
      "許可された全ユーザーのメタデータのみ表示します。タスクの本文、添付ファイルの内容、ダウンロードリンクは含みません。",
    action: "操作",
    actionCode: "操作コード",
    actionSearchPlaceholder: "操作を検索または選択",
    actionSearchEmpty: "一致する操作がありません。",
    actor: "操作主体",
    target: "対象",
    targetTypeCode: "対象種別コード",
    result: "結果",
    resultCode: "結果コード",
    sourceIp: "送信元 IP",
    exportCreatedAt: "作成日時",
    exportActorId: "操作主体 ID",
    exportTargetType: "対象の種類",
    exportTargetId: "対象 ID",
    exportMetadata: "メタデータ",
    auditId: "ログ ID",
    userAgent: "User-Agent",
    auditDetailsTitle: "監査ログの詳細",
    auditDetailsDescription:
      "この監査ログに記録された、機密情報を除いたすべての情報を以下に表示します。",
    auditEventInformation: "ログ情報",
    auditSubjectInformation: "操作主体と対象",
    auditRequestInformation: "リクエスト情報",
    auditMetadataTitle: "機密情報を除いたメタデータ",
    auditMetadataEmpty: "追加のメタデータはありません。",
    auditConversationDetailsTitle: "タスク実行の詳細",
    auditConversationDetailsDescription:
      "このタスクについて利用可能な、機密情報を除いたすべての実行情報を以下に表示します。",
    retainedArtifactDetailsTitle: "削除済みタスクの成果物の詳細",
    retainedArtifactDetailsDescription:
      "この削除済みタスクで恒久的に保持される成果物について、利用可能なすべての概要情報を以下に表示します。",
    auditExecutionInformation: "実行情報",
    auditArtifactInformation: "成果物情報",
    ownerId: "所有者 ID",
    ownerName: "所有者名",
    ownerEmail: "所有者のメールアドレス",
    executionDuration: "実行時間",
    executionErrorType: "エラーの種類",
    attachmentCount: "添付ファイル数",
    attachmentSize: "添付ファイルの合計サイズ",
    artifactCount: "成果物数",
    artifactSize: "成果物の合計サイズ",
    firstArtifactCreatedAt: "最初の成果物の作成日時",
    lastArtifactCreatedAt: "最後の成果物の作成日時",
    export: "CSV をエクスポート",
    exporting: "エクスポート中…",
    auditEmpty: "一致する監査記録がありません。",
    settingsTitle: "システム設定",
    managementTitle: "管理",
    settingsDescription:
      "製品の表示、タスクの同時実行数、認証メール、ログイン機能を管理します。シークレットは暗号化され、再表示されません。",
    settingsTabsLabel: "システム設定のカテゴリ",
    settingsTabs: {
      product: "製品設定",
      concurrency: "タスクの同時実行数",
      smtp: "認証メール",
      registration: "一般登録",
      login: "ログイン方法",
      maintenance: "システムメンテナンス",
    },
    concurrency: {
      title: "タスクの同時実行数",
      description:
        "システム全体とユーザーごとの実行可能なタスク数を設定します。空欄の場合はデプロイ時の既定値を使用します。",
      globalLimit: "システム全体の同時実行タスク上限",
      globalLimitDescription:
        "全ユーザー合計の実行中タスクの上限です。空欄の場合、デプロイ時の既定値 {{defaultValue}} を使用します。現在の有効値は {{effectiveValue}} です。",
      processLimit: "ユーザーごとのタスクプロセス上限",
      processLimitDescription:
        "ユーザーごとに読み込まれるタスクプロセスの最大数です。空欄の場合、デプロイ時の既定値 {{defaultValue}} を使用します。現在の有効値は {{effectiveValue}} です。",
      loweringBehavior:
        "上限を下げても実行中のタスクは停止しません。現在の使用数が新しい上限を下回ると、新しいタスクを開始できます。",
      saved: "タスクの同時実行数を更新しました。",
      errors: {
        positiveInteger:
          "0 より大きい整数を入力してください。空欄の場合はデプロイ時の既定値を使用します。",
      },
    },
    registration: {
      enabled: "ユーザーによる新規登録を許可",
      enabledDescription:
        "有効にすると、ログインページに登録へのリンクが表示されます。無効にすると、新規の登録申請と送信済みの有効化リンクが使用できなくなります。",
      saved: "一般登録の設定を更新しました。",
    },
    systemName: "システムの表示名",
    systemLogo: "システムのロゴ",
    systemLogoDescription:
      "ログインページ、サイドバー、メンテナンスページで使用します。",
    systemLogoHint:
      "PNG、JPEG、WebP、GIF に対応しています。2 MB 未満の横長で背景が透明な画像をおすすめします。",
    uploadSystemLogo: "ロゴをアップロード",
    replaceSystemLogo: "ロゴを置き換え",
    removeSystemLogo: "既定のロゴに戻す",
    deploymentStatus: "デプロイ設定の状態",
    settingsSaved: "システム設定を更新しました。",
    systemLogoSaved: "システムのロゴを更新しました。",
    systemLogoRemoved: "既定のロゴに戻しました。",
    maintenance: {
      title: "システムメンテナンス",
      description:
        "システム全体のメンテナンスを予約します。期間中、一般ユーザーにはメンテナンスページのみ表示されます。管理者は引き続きアクセスできます。",
      enabled: "予約メンテナンスを有効にする",
      enabledDescription:
        "設定した開始日時から終了日時までの間のみ、メンテナンス状態になります。",
      reason: "メンテナンスの理由",
      reasonPlaceholder:
        "任意：メンテナンスが必要な理由と利用者への影響を説明してください…",
      duration: "メンテナンスの時間",
      durationHint:
        "所要時間を選択または入力すると、開始日時から終了日時を計算します。開始・終了日時は手動でも調整できます。",
      durationPresetsLabel: "メンテナンス時間の候補",
      durationPresets: {
        "10m": "10 分",
        "30m": "30 分",
        "1h": "1 時間",
        "2h": "2 時間",
        "4h": "4 時間",
      },
      durationCustomPlaceholder: "手動で入力",
      durationUnit: "メンテナンス時間の単位",
      durationUnits: {
        minute: "分",
        hour: "時間",
      },
      startAt: "開始時刻",
      endAt: "終了時刻",
      datePlaceholder: "日付を選択",
      clearStartDate: "開始日を解除",
      clearEndDate: "終了日を解除",
      startHour: "開始時刻 · 時",
      startMinute: "開始時刻 · 分",
      endHour: "終了時刻 · 時",
      endMinute: "終了時刻 · 分",
      timezoneHint:
        "時刻は現在のデバイスのタイムゾーンで表示され、保存時にシステム時刻に変換されます。",
      save: "メンテナンス設定を保存",
      saved: "メンテナンス設定を保存しました",
      closed: "システムメンテナンスを無効にしました",
      status: {
        active: "メンテナンス中",
        scheduled: "予約済み",
        disabled: "有効になっていません",
      },
      errors: {
        startRequired:
          "メンテナンスを有効にする前に開始時刻を選択してください。",
        endRequired: "メンテナンスを有効にする前に終了時刻を選択してください。",
        endAfterStart: "終了時刻は開始時刻より後にしてください。",
      },
    },
    modelTabs: {
      label: "モデル設定のカテゴリ",
      channels: "モデルチャネル",
      conversation: "会話モデル",
      knowledge: "ナレッジ検索モデル",
      voiceTranscription: "音声文字起こしモデル",
      imageGeneration: "画像生成モデル",
    },
    modelProvider: {
      catalogDescription: "モデルの接続、料金、入力欄での表示順を管理します。",
      currentChannel: "現在のチャネル",
      editChannel: "チャネルを編集",
      connectionDescription:
        "このチャネルのモデルは、これらの接続設定を共有します。",
      channelActions: "チャネルの操作",
      channelSummaryConfigured_one:
        "このチャネルは {{provider}} 経由で接続し、{{count}} 個のモデルを含みます。API キーは設定済みです",
      channelSummaryConfigured_other:
        "このチャネルは {{provider}} 経由で接続し、{{count}} 個のモデルを含みます。API キーは設定済みです",
      channelSummaryNotConfigured_one:
        "このチャネルは {{provider}} 経由で接続し、{{count}} 個のモデルを含みます。API キーは未設定です",
      channelSummaryNotConfigured_other:
        "このチャネルは {{provider}} 経由で接続し、{{count}} 個のモデルを含みます。API キーは未設定です",
      channelSummaryEnd: "。",
      noChannels: "モデルチャネルはまだありません",
      noChannelsDescription:
        "チャネルを追加し、最初のモデルを設定してください。",
      noModelsDescription:
        "「モデルを追加」から、このチャネルのモデルを設定してください。",
      editModel: "モデル {{name}} を編集",
      modelEditorDescription:
        "チャネル：{{name}}。保存時はこのモデルのみを更新します。",
      basicInformation: "基本情報",
      pricing: "モデルの料金",
      capabilities: "機能",
      modelName: "モデル",
      priceSummary: "入力 / キャッシュ入力 / 出力の単価",
      modelActions: "モデル {{name}} の操作",
      modelAvailability: "会話で利用可能：{{name}}",
      modelOrder: "モデルの順序",
      moveUp: "上へ移動",
      moveDown: "下へ移動",
      moveChannelUp: "チャネルを上へ移動",
      moveChannelDown: "チャネルを下へ移動",
      orderHint:
        "ハンドルをドラッグするか、「上へ移動」「下へ移動」を使用してください。入力欄の利用可能なチャットモデルは、チャネルの順序、各チャネル内のモデルの順序で表示されます。",
      reorderModel: "モデル {{name}} の順序を変更",
      reorderInstructions:
        "Space キーで並べ替えを開始し、上下の矢印キーで移動して、Space キーで確定します。Escape キーでキャンセルします。",
      reorderStarted: "{{name}} の並べ替えを開始しました。",
      reorderPosition: "{{name}} を位置 {{position}} に移動しました。",
      reorderCancelled: "並べ替えをキャンセルしました。",
      discardTitle: "未保存の変更を破棄しますか？",
      discardDescription: "閉じると、この編集画面で行った変更が失われます。",
      discardAction: "変更を破棄",
      selectionsHint:
        "ユーザーがモデルを選択する前は既定の会話モデルを使用します。タスク命名モデルはタスクのタイトルを生成します。",
      title: "モデルサービス",
      description:
        "会話、ナレッジ検索などのモデルとサービスチャネルを管理します。システムは選択したモデルに対応するサービスを使用し、管理者はチャットモデルで利用できる推論の強度を設定できます。",
      readOnlyNotice:
        "モデル設定は現在読み取り専用です。既存の設定は表示できますが、モデルの追加・編集・削除や、会話での利用可否の変更はできません。",
      providers: "モデルチャネル",
      providersDescription:
        "モデルと接続を一元管理します。モデル ID は重複できないため、システムは意図したモデルを確実に選択できます。",
      addProvider: "モデルチャネルを追加",
      providerTitle: "モデルチャネル {{index}}",
      providerName: "チャネル名",
      renameProvider: "モデルチャネル {{name}} の名前を変更",
      renameProviderTitle: "モデルチャネルの名前を変更",
      renameProviderDescription:
        "チャネル名は管理者が識別するためにのみ使用し、モデル設定の保存後に反映されます。",
      renameProviderAction: "名前を変更",
      unnamedProvider: "未設定のモデルチャネル",
      deleteProvider: "チャネルを削除",
      saveProvider: "モデルチャネル {{name}} を保存",
      deleteProviderTitle: "モデルチャネル「{{name}}」を削除しますか？",
      deleteProviderDescription:
        "確定すると、このモデルチャネルと含まれるすべてのモデルを直ちに削除します。過去のタスクと使用履歴には影響しません。",
      providerDeleted: "モデルチャネルを削除しました。",
      baseUrl: "ベース URL",
      apiKey: "API_KEY",
      apiKeyConfiguredHint:
        "キーは安全に保存されています。置き換える場合にのみ新しいキーを入力してください。",
      apiKeyRequiredHint:
        "初回保存の前にキーを入力してください。保存後は再表示されません。",
      apiKeyOptionalHint:
        "プロバイダーで認証が必要な場合はキーを入力してください。保存後は表示されません。",
      protocolMode: "プロトコル互換モード",
      protocolModes: {
        native_responses: "ネイティブ Responses",
        responses_tool_compat: "Responses ツール互換",
        chat_completions_bridge: "Chat Completions ブリッジ",
      },
      protocolModeHints: {
        native_responses:
          "Responses にネイティブ対応し、会話とツールの全機能を提供するサービスに適しています。",
        responses_tool_compat:
          "Responses に対応しているものの、利用できるツールが限られるサービスに適しています。",
        chat_completions_bridge:
          "Chat Completions のみに対応した互換サービスに適しています。一部の高度な機能は利用できない場合があります。",
      },
      models: "モデル",
      modelsDescription:
        "このチャネルのモデルは接続先とキーを共有します。チャットモデルはユーザーの選択肢に表示でき、検索などのモデルは必要に応じて自動で使用されます。",
      addModel: "モデルを追加",
      noModels: "このチャネルにモデルはありません",
      newModelName: "モデル {{index}}",
      unnamedModel: "無名のモデル",
      modelId: "モデル ID",
      modelIdConflict:
        "このモデル ID はモデル一覧に既に存在します。別の ID を使用してください。",
      modelNameConflict:
        "同じ表示名のモデルが既に存在します。区別できるよう別の名前を検討してください。",
      channelNameConflict:
        "同じ名前のモデルチャネルが既に存在します。区別できるよう別の名前を検討してください。",
      displayName: "表示名",
      modelKind: "モデルの種類",
      modelKinds: {
        chat: "チャットモデル",
        embedding: "埋め込みモデル",
        reranker: "ランキングモデル",
      },
      serviceProvider: "モデルプロバイダー",
      supportsImageInput: "画像理解に対応",
      inputPrice: "入力単価",
      cachedInputPrice: "キャッシュ入力単価",
      outputPrice: "出力単価",
      contextWindow: "モデルのコンテキスト長",
      contextWindowPlaceholder: "自動検出",
      contextWindowInvalid:
        "0 より大きい整数を入力してください。空欄の場合は自動検出します。",
      priceUnit: "人民元 / 100 万トークン",
      priceUnitSummary: "。料金は {{unit}} で表示します。",
      showInComposer: "会話で利用可能",
      saveModel: "モデル {{name}} を保存",
      deleteModel: "モデルを削除",
      deleteModelTitle: "モデル「{{name}}」を削除しますか？",
      deleteModelDescription:
        "確定するとモデルを直ちに削除します。過去のタスクと使用履歴には影響しません。",
      modelDeleted: "モデルを削除しました。",
      supportedEfforts: "対応する推論の強度",
      selectedEfforts: "{{count}} 件選択中",
      defaultEffort: "既定の推論の強度",
      defaultModel: "既定の会話モデル",
      defaultModelHint:
        "ユーザーがモデルを選択していない場合や、以前のモデルを利用できない場合に使用します。",
      modelSelections: "会話とシステム用のモデル選択",
      saveModelSelections: "会話とシステム用のモデル選択を保存",
      memoryExtractionModel: "メモリ抽出モデル",
      memoryUseTaskModel: "現在のタスクのモデルを使用",
      memoryExtractionHint:
        "ユーザーがメモリを有効にした場合に適用します。専用モデルを選択しない場合、現在のタスクのモデルで抽出します。抽出には選択モデルが対応する最低の推論の強度を常に使用します。メモリ統合用モデルは変更しません。",
      titleModel: "タスクの自動命名モデル",
      titleModelHint:
        "識別しやすいタスク名を自動生成します。使用量は分析に含まれます。",
      saved: "モデルチャネルの設定を更新しました。",
    },
    knowledgeModels: {
      title: "ナレッジ検索モデル",
      description:
        "ナレッジベースのドキュメント理解、質問への回答、検索結果の改善に使用するモデルを選択します。",
      selectionDescription:
        "ドキュメント処理と検索結果の改善に使用するモデルを選択します。利用可能なモデルの追加・管理は「モデルチャネル」で行ってください。",
      noEmbeddingModels:
        "ナレッジ検索用モデルの準備ができていません。先に「モデルチャネル」で埋め込みモデルを追加・設定してください。",
      embeddingTitle: "埋め込みモデル",
      embeddingSelectionDescription:
        "この必須モデルは、ナレッジベースがドキュメントとユーザーの質問を理解するために使用します。保存時に利用可否を確認します。",
      selectEmbeddingModel: "埋め込みモデルを選択",
      embeddingModelPlaceholder: "埋め込みモデルを選択",
      embeddingDescription:
        "この必須モデルは、ナレッジベースがドキュメントとユーザーの質問を理解するために使用します。",
      rerankTitle: "ランキングモデル",
      rerankSelectionDescription:
        "関連性の高い結果を上位に表示します。無効または一時的に利用できない場合も検索結果は取得できます。",
      selectRerankerModel: "ランキングモデルを選択",
      rerankerModelPlaceholder: "ランキングモデルを選択",
      rerankDescription:
        "関連性の高い結果を上位に表示します。無効の場合もナレッジ検索は利用できます。",
      enabled: "検索時に有効にする",
      baseUrl: "ベース URL",
      embeddingBaseUrlHint:
        "プロバイダーから提供された埋め込みモデルの接続先アドレスを入力してください。",
      rerankBaseUrlHint:
        "プロバイダーから提供された結果ランキングモデルの接続先アドレスを入力してください。",
      modelId: "モデル ID",
      inputPrice: "入力単価",
      priceUnit: "人民元 / 100 万トークン",
      embeddingApiKey: "埋め込みの API キー",
      rerankApiKey: "再ランキングの API キー",
      apiKeyConfiguredHint:
        "キーは設定済みです。置き換える場合にのみ新しいキーを入力してください。",
      apiKeyEndpointChangedHint:
        "接続先アドレスが変更されたため、既存のキーは再利用しません。新しい接続先で認証が必要な場合は、対応するキーを入力してください。",
      apiKeyOptionalHint:
        "プロバイダーで認証が不要な場合は空欄にしてください。保存後はキーを表示しません。",
      embeddingRuntime:
        "システムは {{dimensions}} 次元で、1 回あたり最大 {{tokens}} トークンのコンテンツを処理します。",
      rerankRuntime:
        "1 回あたり最大 {{tokens}} トークンを処理します。サービスの応答が {{timeout}} ms を超える場合、この最適化を省略します。",
      rebuildHint:
        "埋め込みモデルを変更した場合、すべてのナレッジベースのインデックスを完全に再構築する必要があります。「システムの状態」で再構築が完了するまで検索は利用できません。",
      embeddingChangeConfirmTitle:
        "影響の大きい操作：埋め込みモデルを変更しますか？",
      embeddingChangeConfirmDescription:
        "埋め込みモデルは、ナレッジベースが内容を解釈・検索する方法を決定します。この変更を保存すると既存の全インデックスが無効になります。「システムの状態」ですべてのナレッジベースのインデックスを完全に再構築してください。完了までは全ナレッジベースの検索が利用できません。再構築は自動では開始しません。",
      embeddingChangeDangerNotice:
        "埋め込みモデルの変更は影響の大きい操作です。一部のナレッジベースだけの再構築では不十分です。",
      embeddingChangeConfirmAction: "モデルを変更して保存",
      rebuildRequiredTitle:
        "埋め込みモデルを変更しました。ナレッジベースのインデックスの再構築が必要です",
      rebuildRequiredDescription:
        "「システムの状態」で、すべてのナレッジベースのインデックスを再構築してください。完了まで検索を一時的に利用できません。",
      openSystemHealth: "システムの状態へ移動",
      validating: "確認して保存中…",
      save: "ナレッジ検索モデルを保存",
      saved: "ナレッジ検索モデルの設定を更新しました。",
      savedDescription:
        "新しいドキュメント処理と意味検索には、この設定を使用します。",
      savedAfterEmbeddingChangeDescription:
        "モデル設定を保存しました。「システムの状態」で、すべてのナレッジベースのインデックスを再構築してください。完了まで検索を一時的に利用できません。",
    },
    voiceTranscription: {
      title: "音声文字起こしモデル",
      description:
        "音声入力の文字起こしに使用するモデルサービスを設定します。有効にすると通常のタスクと埋め込みアプリに適用されます。キーは安全に保存され、再表示されません。",
      enabled: "音声文字起こしを有効にする",
      provider: "モデルプロバイダー",
      providerHint:
        "契約済みで使用したい音声文字起こしサービスを選択してください。",
      providerPlaceholder: "モデルプロバイダーを選択",
      providers: {
        dashscope: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        openai_compatible: "OpenAI 互換サービス",
        azure_openai: "Azure OpenAI",
        groq: "Groq",
        deepgram: "Deepgram",
        assemblyai: "AssemblyAI",
        elevenlabs: "ElevenLabs",
        revai: "Rev.ai",
        gladia: "Gladia",
        fal: "fal.ai",
      },
      baseUrl: "ベース URL",
      baseUrlHint:
        "プロバイダーから提供された音声文字起こしの接続先アドレスを入力してください。",
      apiVersion: "API バージョン",
      apiVersionHint:
        "Azure OpenAI デプロイで使用する API バージョンを入力してください。",
      apiKey: "API キー",
      apiKeyConfiguredHint:
        "キーは設定済みです。空欄の場合は既存のキーを保持します。",
      apiKeyRequiredHint:
        "初めて有効にするときやプロバイダーを変更した後は、キーが必要です。保存後は再表示されません。",
      model: "音声文字起こしモデル名",
      modelHint:
        "プロバイダーから提供されたモデル名またはデプロイ名を入力してください。",
      save: "音声文字起こしモデルを保存",
      saving: "保存中…",
      saved: "音声文字起こしモデルの設定を更新しました。",
    },
    imageGeneration: {
      title: "画像生成モデル",
      description:
        "画像生成に使用するモデルサービスを設定します。有効にすると、画像作成にこの設定を使用します。キーは安全に保存され、再表示されません。",
      enabled: "画像生成を有効にする",
      provider: "モデルプロバイダー",
      providerHint: "契約済みで使用したい画像生成サービスを選択してください。",
      providerPlaceholder: "モデルプロバイダーを選択",
      providers: {
        alibaba_bailian: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        google_gemini: "Google Gemini",
        stability: "Stability AI",
        fal: "fal.ai",
        replicate: "Replicate",
        together: "Together AI",
      },
      baseUrl: "ベース URL",
      baseUrlHint:
        "選択したプロバイダーに応じて自動入力されます。手動編集は不要です。",
      workspaceId: "Bailian ワークスペース ID",
      workspaceIdHint:
        "Alibaba Cloud Bailian の専用ワークスペースに接続します。",
      region: "Bailian リージョン",
      regionHint:
        "サービスを利用しているリージョンを選択してください。既定は北京です。",
      apiKey: "API キー",
      apiKeyConfiguredHint:
        "キーは設定済みです。空欄の場合は既存のキーを保持します。",
      apiKeyRequiredHint:
        "初めて有効にするときやプロバイダーを変更した後は、キーが必要です。保存後は再表示されません。",
      model: "画像生成モデル名",
      modelHint:
        "qwen-image-3.0 など、プロバイダーから提供されたモデル名を入力してください。",
      pricePerImage: "画像 1 枚あたりの単価",
      pricePerImageHint:
        "画像生成料金の集計に使用します。単位は画像 1 枚あたりの人民元です。",
      save: "画像生成モデルを保存",
      saving: "保存中…",
      saved: "画像生成モデルの設定を更新しました。",
    },
    imageUnderstanding: {
      title: "ドキュメントの画像理解",
      description:
        "有効にすると、ドキュメント内の画像を理解し、その情報をナレッジ検索に使用します。元のドキュメント内容は変更しません。",
      selectionDescription:
        "有効にすると、ドキュメント内の画像を理解し、画像に含まれる情報を検索できるようにします。画像理解に対応したチャットモデルを選択してください。",
      noImageModels:
        "画像対応モデルがありません。先に「モデルチャネル」のチャットモデルで「画像理解に対応」を有効にしてください。",
      selectModel: "画像理解モデルを選択",
      selectModelHint:
        "保存時に、選択したモデルが画像を認識できることを確認します。",
      modelPlaceholder: "画像理解モデルを選択",
      enabled: "処理時に有効にする",
      provider: "モデルプロバイダー",
      providerPlaceholder: "モデルプロバイダーを選択",
      providers: {
        openai: "OpenAI",
        azure_openai: "Azure OpenAI",
        anthropic: "Anthropic",
        google: "Google Gemini",
        google_vertex: "Google Vertex AI",
        alibaba: "Alibaba / Qwen",
        deepseek: "DeepSeek",
        openrouter: "OpenRouter",
        openai_compatible: "OpenAI 互換 / vLLM",
      },
      model: "マルチモーダルモデル ID",
      modelHint:
        "画像理解への対応が確認されたモデルを選択してください。保存時に利用可否を確認します。",
      baseUrl: "ベース URL",
      baseUrlRequiredHint:
        "プロバイダーから提供された完全な接続先アドレスを入力してください。",
      baseUrlOptionalHint:
        "空欄の場合はプロバイダーの既定のアドレスを使用します。",
      apiKey: "API キー",
      apiKeyConfiguredHint:
        "キーは設定済みです。空欄の場合は既存のキーを保持します。",
      apiKeyRequiredHint:
        "初めて有効にするときはキーが必要です。保存後は再表示されません。",
      project: "Vertex プロジェクト ID",
      location: "Vertex ロケーション",
      activeStrategy: "現在のモデルは画像理解の確認に合格しました。",
      strategyAfterValidation:
        "保存後、選択したモデルの画像理解機能を確認します。",
      validating: "確認して保存中…",
      save: "画像理解の設定を保存",
      saved:
        "画像理解の設定を更新しました。新しい処理と再構築にはこの設定を使用します。",
    },
    authSettings: {
      enterpriseTitle: "組織アカウント",
      enterpriseDescription:
        "組織が管理するアカウントでログインするか、Teams 内から直接利用できます。初回はメールアドレスで既存アカウントと照合し、新規アカウントは管理者による有効化が必要です。",
      smtpTitle: "認証メール",
      smtpDescription:
        "初回のパスワード設定とパスワード再設定メールに使用する SMTP サービスを設定します。接続確認は「システムの状態」で行えます。",
      oidcTitle: "組織のシングルサインオン（OIDC）",
      oidcDescription:
        "職場または学校アカウント向けの Microsoft Entra ID など、組織の認証サービスに接続します。",
      teamsTitle: "Teams 内でログイン",
      teamsDescription:
        "職場または学校アカウントを使って Teams 内から直接利用できます。",
      modeLabel: "設定元",
      modes: {
        inherit: "デプロイ環境を継承",
        managed: "システム設定で管理",
        disabled: "この機能を無効にする",
      },
      modeNotices: {
        inherit:
          "現在はデプロイ環境の設定を使用しています。システム設定での管理に切り替える場合はシークレットを再入力してください。",
        disabled:
          "この機能は明示的に無効化されており、デプロイ設定には切り替わりません。",
      },
      status: {
        configured: "設定済み",
        notConfigured: "未設定",
        invalid: "無効な設定",
      },
      smtpHost: "SMTP ホスト",
      smtpPort: "SMTP ポート",
      smtpSecurity: "接続のセキュリティ",
      starttls: "STARTTLS",
      tls: "直接 TLS",
      smtpFrom: "差出人アドレス",
      smtpUsername: "ユーザー名",
      smtpUsernameHint: "SMTP サービスで認証が不要な場合は空欄にしてください。",
      smtpPassword: "パスワード",
      oidcIssuer: "発行者 URL",
      oidcClientId: "クライアント ID",
      oidcClientSecret: "クライアントシークレット",
      oidcRedirectUri: "リダイレクト URI",
      oidcRedirectHint:
        "この固定 URI を OIDC プロバイダーに登録してください。ここでは変更できません。",
      teamsTenantId: "テナント ID",
      teamsClientId: "アプリケーション（クライアント）ID",
      teamsExternalHint:
        "Microsoft Entra と Teams アプリのマニフェストで同じアプリケーション ID を使用し、API を公開して必要な同意を完了してください。",
      secretPreserved: "シークレットは保存済みです。空欄の場合は保持します。",
      secretRequired:
        "システム設定での管理に切り替える場合はシークレットを再入力してください。",
      secretRequiredWhenUsed:
        "ユーザー名を設定する場合はパスワードが必要です。",
      saved: "認証設定を更新し、直ちに適用しました。",
      confirmTitle: "設定元を変更しますか？",
      confirmDescription:
        "続行すると現在の設定を使用しなくなります。ログイン方法を無効にすると、それに依存するユーザーがログインできなくなる場合があります。",
    },
    editUser: "ユーザーを編集",
    userSaved: "ユーザーを保存しました。",
    enableUserNamed: "ユーザー {{name}} を有効にする",
    disableUserNamed: "ユーザー {{name}} を無効にする",
    userEnabled: "ユーザー {{name}} を有効にしました。",
    userDisabled: "ユーザー {{name}} を無効にしました。",
    userStatusSelfLocked: "管理者は自分自身を有効・無効にできません。",
    lastEnabledAdminStatusLocked: "少なくとも 1 人の有効な管理者が必要です。",
    userStatusVerifyingAdmins:
      "有効な管理者の人数を確認しています。お待ちください。",
    emailUpdated:
      "メールアドレスを更新しました。ユーザーは再ログインが必要です。",
    accountMetadata: "アカウントとリソースの情報",
    passwordUpdated: "パスワード更新日時",
    personalPlugins: "個人用プラグイン",
    personalSkills: "個人用スキル",
    personalCredentials: "個人の認証情報",
    noPasswordNotice:
      "管理者はユーザーのパスワードの設定、閲覧、インポート、再設定を行えません。新しいユーザーは SSO、Teams、またはパスワードを忘れた場合の手順でログインできます。",
    userPrivilegeChangeWarning:
      "ユーザーのセッションは直ちに無効になります。ユーザーを無効にすると、未開始の待機中リクエストもキャンセルされます。自分自身の無効化や管理者権限の解除はできず、少なくとも 1 人の有効な管理者が必要です。",
    userSearchPlaceholder: "名前またはメールアドレスを検索…",
    downloadTemplate: "Excel テンプレートをダウンロード",
    chooseExcel: "Excel ファイルを選択",
    templateFilename: "{{productPrefix}}-ユーザーインポートテンプレート.xlsx",
    importDescription:
      "名前、メールアドレス、ロール、ユーザーグループの入力には Excel テンプレートを使用してください。「使い方」シートにはサンプルデータがあります。パスワード欄はなく、無効な行は個別に報告されます。",
    importSubmit: "インポートを開始",
    importResult: "インポート結果",
    importCounts:
      "{{imported}} 件をインポートし、{{skipped}} 件をスキップしました。",
    importErrorRow: "{{row}} 行目：{{message}}",
    editGroup: "ユーザーグループを編集",
    deleteGroupTitle: "このユーザーグループを完全に削除しますか？",
    importErrors: {
      duplicateInFile: "Excel ブック内でメールアドレスが重複しています。",
      emailExists: "このメールアドレスは既存のユーザーが使用しています。",
      groupNotFound: "指定したユーザーグループは存在しません。",
      invalidEmail: "メールアドレスの形式が無効です。",
      invalidRole: "ロールには user または admin を指定してください。",
      invalidName: "名前が未入力か無効です。",
      invalidRow: "項目の値が無効です。",
    },
    parentDeleteDescription:
      "関連する所属関係とナレッジベースの共有権限を完全に削除します。この操作は取り消せません。",
    auditSearchPlaceholder:
      "タスク ID、ユーザー、プラグイン・スキル、エラーコードを検索…",
    dateFrom: "開始日",
    dateTo: "終了日",
    auditDataSurfaces: "監査データの範囲",
    auditSurfaces: {
      events: "恒久保存の監査ログ",
      conversations: "タスク実行情報",
      retainedArtifacts: "削除済みタスクの成果物",
    },
    auditConversationDescription:
      "タイトル、メッセージ、ファイル内容、完全なイベント、ダウンロードリンクを含まない、機密情報を除いた全ユーザーの実行概要を表示します。",
    auditConversationSearchPlaceholder:
      "タスク ID、ユーザー、プラグイン・スキル、エラーコードを検索…",
    advancedFilters: "その他のフィルター",
    pluginName: "プラグイン名",
    skillName: "スキル名",
    errorCode: "エラーコード",
    runnerStatus: "実行サービスの状態",
    archiveStatus: "アーカイブ状態",
    createdFrom: "作成日時の開始",
    createdTo: "作成日時の終了",
    lastRunFrom: "最終実行日時の開始",
    lastRunTo: "最終実行日時の終了",
    auditConversationsEmpty: "一致するタスク実行情報がありません。",
    retainedArtifactsDescription:
      "削除済みタスクで恒久的に保持される成果物について、機密情報を除いた概要のみ表示します。内容の閲覧、復元、ダウンロードはできません。",
    retainedArtifactsSearchPlaceholder: "タスク ID、所有者 ID、削除日時を検索…",
    retainedArtifactsEmpty: "一致する削除済みタスクの成果物概要がありません。",
    conversation: "タスク ID",
    owner: "所有者",
    capabilitiesUsed: "使用したプラグイン・スキル",
    files: "ファイル情報",
    execution: "実行概要",
    lastRun: "前回の実行",
    activeConversation: "未アーカイブ",
    archivedConversation: "アーカイブ済み",
    attachmentsSummary: "{{count}} 件の添付ファイル · {{size}}",
    artifactsSummary: "{{count}} 件の成果物 · {{size}}",
    runnerStatuses: {
      initialized: "実行サービス初期化済み",
      not_started: "実行サービス未起動",
      available: "実行サービス利用可能",
      unavailable: "実行サービス利用不可",
    },
    executionError: "実行エラー",
    errorTypes: {
      codex_turn: "タスク実行エラー",
    },
    retainedArtifactCount: "保持された成果物",
    totalSize: "合計サイズ",
    checksum: "チェックサムあり",
    deletedAt: "タスク削除日時",
    editableSettings: "編集可能な製品設定",
    deploymentReadOnly:
      "インフラ、認証、シークレット、同時実行数、ファイル上限はデプロイ環境で管理します。ここでは機密情報を除いた状態のみ表示します。",
  },
  health: {
    title: "システム状態",
    description:
      "{{productName}} のサービスと管理対象ディレクトリの、読み取り専用の概要です。",
    overall: "全体の状態",
    checkedAt: "確認日時",
    runningTurns: "実行中のターン",
    processes: "app-server プロセス",
    concurrency: "同時実行数の上限",
    healthy: "正常",
    warning: "警告",
    unavailable: "利用不可",
    notConfigured: "未設定",
    notObserved: "未観測",
    degraded: "機能低下",
    available: "利用可能",
    cleanupFailures: "クリーンアップの失敗",
    cleanupDescription:
      "これらのリソースの自動再試行は停止しています。再試行では対象のタスクのみ処理し、ほかの実行中タスクは中断しません。",
    retryCleanup: "クリーンアップを再試行",
    retryAllCleanup: "すべて再試行",
    retryingCleanup: "クリーンアップを再試行中",
    cleanupRetryAllConfirmTitle: "失敗したクリーンアップをすべて再試行",
    cleanupRetryAllConfirmDescription:
      "システムは各項目の状態を確認して再試行します。対象タスクがまだ実行中の場合は後回しにし、ほかのタスクは中断しません。",
    cleanupAttempts: "{{current}} / {{total}} 回試行済み",
    cleanupFailed: "対応が必要",
    cleanupStages: {
      reconcile: "リソースの状態を確認中",
      stop_runtime: "対象のタスクを安全に停止中",
      delete_workspace: "タスクのファイルを削除中",
      delete_control: "タスクの実行状態を削除中",
      verify_absent: "クリーンアップを検証中",
    },
    cleanupReasons: {
      CLEANUP_RUNNER_UNAVAILABLE:
        "クリーンアップサービスを一時的に利用できません",
      CLEANUP_RUNTIME_ACTIVE:
        "対象タスクがまだ実行中のため、リソースを保護しました",
      CLEANUP_RUNTIME_STATE_UNCERTAIN:
        "タスクが安全に停止したことをまだ確認できません",
      CLEANUP_PERMISSION_DENIED:
        "リソースを削除できません。ストレージの権限を確認してください",
      CLEANUP_PATH_BOUNDARY_INVALID: "リソースの場所を検証できませんでした",
      CLEANUP_DIRECTORY_REMOVE_FAILED:
        "タスクのファイルを完全に削除できませんでした",
      CLEANUP_VERIFICATION_FAILED: "クリーンアップ結果を検証できませんでした",
      CLEANUP_QUEUE_UNAVAILABLE:
        "クリーンアップのリクエストを待機一覧に追加できませんでした",
      CLEANUP_OPERATION_FAILED: "リソースのクリーンアップが完了しませんでした",
      unknown: "リソースのクリーンアップが完了しませんでした",
    },
    resources: {
      title: "サービスのリソース使用状況",
      description:
        "Docker でデプロイされたサービスコンテナーの CPU、メモリ、プロセスの現在の使用状況です。",
      empty: "Docker サービスのリソース使用状況はまだ観測されていません。",
      cpu: "CPU",
      memory: "メモリ",
      containers: "{{running}} / {{total}} コンテナーが実行中",
      pids: "PID 数 {{count}}",
      state: "状態 {{state}}",
      checkedAt: "リソースの取得日時",
      status: {
        available: "観測日時",
        unavailable: "利用不可",
        notObserved: "未観測",
      },
      reasons: {
        unavailable:
          "Docker のリソース情報を読み取れません。実行コントローラーの Docker ソケットのマウントと権限を確認してください。",
        notObserved:
          "利用可能な Docker コンテナーのリソース情報はまだ観測されていません。",
      },
      services: {
        api: "API コンテナー",
        runner: "実行コントローラー",
        workerPool: "実行ワーカープール",
        web: "ウェブコンテナー",
        gateway: "ゲートウェイコンテナー",
        postgres: "PostgreSQL コンテナー",
        redis: "Redis コンテナー",
        postgresBackup: "PostgreSQL バックアップコンテナー",
        migrate: "移行コンテナー",
        backupInit: "バックアップ初期化コンテナー",
        storageInit: "ストレージ初期化コンテナー",
        runnerWorkerImage: "ワーカーイメージのビルドコンテナー",
      },
    },
    knowledgeRebuild: {
      title: "ナレッジのベクトルインデックスの全体再構築",
      description:
        "埋め込みモデルやベクトル次元の変更時に手動で行うメンテナンスです。デプロイ環境全体の集計された進行状況のみ表示します。",
      action: "全体の再構築を開始",
      retry: "手動で再試行",
      empty: "デプロイ環境全体のナレッジ再構築はまだ開始されていません。",
      confirmTitle: "ナレッジのベクトルインデックスの全体再構築を確認",
      confirmDescription:
        "アーカイブ済みナレッジベースを含む、未削除のすべてのドキュメントが対象です。実行中は全体のベクトル検索を一時停止します。",
      confirmWarning:
        "ナレッジのベクトルインデックスを消去して再作成します。元のファイル、Docling の結果、解析済みコンテンツは削除しません。以前のインデックスには戻せません。",
      confirmAction: "確認して再構築を開始",
      reason: "理由",
      reasonHint: "必須です。理由は機密情報を除いた監査記録に保存されます。",
      total: "合計",
      succeeded: "成功",
      failed: "失敗",
      errorSummary: "エラーコード：{{code}}",
      status: {
        pending: "保留中",
        queued: "待機中",
        running: "実行中",
        completed: "完了",
        failed: "失敗",
      },
      stage: {
        queued: "開始待ち",
        preparing: "全体再構築の準備中",
        recreating_index: "ベクトルインデックスを再作成中",
        rebuilding_documents: "すべてのドキュメントのインデックスを再構築中",
        validating: "再構築結果を検証中",
        activating: "新しいインデックスを有効化中",
        completed: "全体の再構築が完了しました",
        failed: "全体の再構築に失敗しました",
        processing: "全体の再構築を処理中",
      },
    },
    components: {
      api: "API サービス",
      public_url: "接続のセキュリティ",
      database: "データベース",
      redis: "Redis とローカルログイン保護",
      running_turn_capacity: "実行中ターンの容量",
      running_turn_recovery: "実行中ターンの復旧",
      smtp: "認証メール",
      auth_email: "パスワードメール機能",
      local_password_login: "ローカルパスワードログイン",
      runner: "実行サービス",
      workspace: "ワークスペースのルート",
      capability_root: "プラグイン・スキルのインストール先ルート",
      oidc: "OIDC ログイン",
      teams: "Teams ログイン",
      workspace_root: "ワークスペースのルート",
      document_parsing: "ナレッジドキュメントの解析",
      knowledge_search_and_indexing: "ナレッジの検索とインデックス作成",
      rerank: "ナレッジ検索結果の再ランキング",
    },
    reasons: {
      public_url_insecure:
        "このサイトは HTTP を使用しているため、ログイン情報、会話、ファイルは通信時に暗号化されません。基本機能は利用できますが、インターネットに公開する前に HTTPS を設定してください。",
      auth_https_required:
        "このサイトは HTTP を使用しています。OIDC または Teams ログインを利用するには HTTPS を設定してください。",
      not_configured: "この任意機能は未設定です。",
      not_observed: "共有の復旧処理が正常に完了した記録はまだありません。",
      connection_failed:
        "接続の確認に失敗しました。デプロイ設定とサービスを確認してください。",
      read_write_failed:
        "ディレクトリの読み書き確認に失敗しました。マウントと権限を確認してください。",
      login_protection_unavailable:
        "Redis を利用できないため、ローカルログイン保護とローカルパスワードログインを利用できません。",
      email_unavailable:
        "初回パスワード設定とパスワード再設定メールの新規リクエストを利用できません。",
      available: "確認に成功しました。",
      document_parsing_unavailable:
        "ドキュメント解析を利用できません。Docling Serve の設定とサービスを確認してください。",
      knowledge_search_and_indexing_unavailable:
        "ナレッジの検索とインデックス作成を利用できません。Elasticsearch と埋め込みモデルの設定およびサービスを確認してください。",
      embedding_dimension_mismatch:
        "埋め込みの出力次元と Elasticsearch のベクトルインデックスの次元が一致しません。設定を修正し、ベクトルインデックスを手動で再構築してください。",
      rerank_unavailable:
        "検索結果の再ランキングを利用できません。再ランキングモデルの設定とサービスを確認してください。",
    },
    cleanupTypes: {
      workspace: "タスクのワークスペース",
      codex_home: "ユーザーの実行用ディレクトリ",
      object_storage: "オブジェクトストレージのリソース",
      capability_directory: "プラグイン・スキルのディレクトリ",
    },
  },
  statuses: {
    idle: "待機中",
    running: "実行中",
    pending: "保留中",
    completed: "完了",
    failed: "失敗",
    declined: "拒否",
    interrupted: "中断",
    active: "有効",
    disabled: "無効",
    approved: "承認済み",
    rejected: "却下",
    pendingApproval: "承認待ち",
    revoked: "取り消し済み",
    cancelled: "キャンセル済み",
    success: "成功",
    failure: "失敗",
  },
  validation: {
    required: "この項目は必須です。",
    email: "有効なメールアドレスを入力してください。",
    passwordMismatch: "パスワードが一致しません。",
    riskRequired:
      "先に提供元とリスクに関する注意事項を確認し、同意してください。",
  },
  errors: {
    socialClientInUse:
      "このアプリには連携済みアカウントがあるため、アプリ ID は変更できません。シークレットの更新やログインの無効化は可能です。",
    socialLastMethod:
      "連携を解除する前に、パスワードを設定するか、別の有効なログイン方法を連携してください。",
    socialAuthFailed:
      "ソーシャルアカウントの確認を完了できませんでした。再試行してください。",
    applicationDevelopment: {
      testBusy:
        "テストがまだ実行中です。テスト履歴で停止し、対応待ちのリクエストを処理してから続行してください。",
      testChanged:
        "テストセッションが変更されました。最新のプレビューから続行してください。",
      projectNameFixed:
        "このプロジェクトはアプリ開発タスクをまとめるためのものです。名前は変更できません。",
      workspaceBound:
        "このプロジェクトにはアプリケーションのソースがあります。プロジェクトを削除する前に「マイアプリケーション」で該当アプリを削除してください。開発タスクは現在のプロジェクトに保持する必要があります。",
      notFound:
        "このアプリケーションは利用できません。「マイアプリケーション」に戻ってください。",
      sourceChanged:
        "アプリケーションが変更されました。インストール前に最新のプレビューを確認してください。",
    },
    webSites: {
      notFound: "このサイトは利用できないか、共有が停止されています",
      slugTaken:
        "このアドレスは既に使用されています。別のアドレスを選択してください",
      sourceUnavailable:
        "作成元のタスクから利用可能な HTML 成果物を選択してください",
      resourcesMissing:
        "ウェブページのリソースがありません（{{path}}）。公開前に、作成元のタスクでアシスタントにウェブページとリソースを一緒に保存するよう依頼してください",
      bundleInvalid:
        "ウェブページのパッケージが不完全か、未対応のファイルを含んでいます。作成元のタスクで更新して再試行してください",
    },
    feishu: {
      connectionNotFound: "Feishu の接続が見つかりません。再接続してください。",
      connectionConflict:
        "Feishu の接続が変更されました。更新して再試行してください。",
      registrationNotFound:
        "Feishu 接続用 QR コードの有効期限が切れました。新しく生成してください。",
      registrationUnavailable:
        "現在、Feishu でボットを自動作成できません。しばらくしてから再試行してください。",
      protocolInvalid:
        "Feishu から認識できない接続データが返されました。再接続するか、管理者にお問い合わせください。",
      coordinationUnavailable:
        "Feishu の接続状態を一時的に取得できません。しばらくしてから再試行してください。",
    },
    automationNotFound: "自動化が見つかりません。",
    automationLimitReached:
      "自動化の上限に達しました。不要な自動化を削除して再試行してください。",
    automationTaskNotPinned:
      "自動化で使用できるのは、自分のアカウントが所有する、ピン留め済みで有効なタスクだけです。",
    automationTaskInUse:
      "このタスクは自動化で使用中です。先に自動化を削除するか実行先を変更してください。",
    conversationOrderConflict:
      "タスク一覧が変更されました。更新してから並べ替えてください。",
    unknown: "操作を完了できませんでした。しばらくしてから再試行してください。",
    networkUnavailable:
      "サービスに接続できませんでした。ネットワークを確認して再試行してください。",
    invalidResponse:
      "サービスから無効なデータが返されました。管理者にお問い合わせください。",
    clientUpdateRequired:
      "システムが更新されました。このページを更新して続行してください。",
    serviceTemporarilyUnavailable:
      "システムを一時的に利用できません。少し待ってから再試行してください。",
    imageUnderstanding: {
      validationFailed:
        "画像理解モデルが、画像、構造化出力、または思考機能の無効化の検証に合格しませんでした。",
    },
    imageGeneration: {
      notConfigured: "管理者が画像生成モデルをまだ設定していません。",
      forbidden: "このタスクのターンでは画像生成を利用できません。",
      turnInactive:
        "現在のタスクのターンは終了したため、画像を生成できません。",
      providerRejected:
        "画像プロバイダーがリクエストを拒否しました。プロンプト、モデル、API キーを確認してください。",
      outputInvalid: "画像プロバイダーが未対応の結果を返しました。",
      unavailable:
        "画像生成を一時的に利用できません。しばらくしてから再試行してください。",
    },
    authInvalidCredentials:
      "メールアドレスまたはパスワードが正しくありません。",
    authRateLimited:
      "ログインの試行回数が多すぎます。しばらくしてから再試行してください。",
    authProtectionUnavailable:
      "ログイン保護を一時的に利用できません。しばらくしてから再試行してください。",
    sessionExpired:
      "セッションの有効期限が切れました。再度ログインしてください。",
    passwordPolicy:
      "パスワードは 8～16 文字で、大文字、小文字、数字、句読点または記号を含めてください。",
    passwordEmailUnavailable:
      "パスワード設定・再設定のメールサービスを一時的に利用できません。しばらくしてから再試行するか、設定済みの場合は SSO または Teams を利用してください。",
    passwordResetDeliveryFailed:
      "安全なリンクを送信できませんでした。しばらくしてから再試行してください。",
    passwordResetProtectionUnavailable:
      "パスワードリクエストの保護機能を一時的に利用できません。しばらくしてから再試行してください。",
    auth: {
      registrationProtectionUnavailable:
        "登録リクエストの保護機能を一時的に利用できません。しばらくしてから再試行してください。",
    },
    passwordResetInvalid:
      "パスワード設定リンクが無効か、有効期限が切れています。新しいリンクを取得してください。",
    concurrencyLimit:
      "現在、システムの処理上限に達しています。しばらくしてから再試行してください。",
    pendingLimit:
      "待機中リクエストの上限に達しました。先に既存のリクエストを処理してください。",
    pendingNotHead: "続行できるのは先頭の待機中リクエストのみです。",
    interruptFailed: "現在の実行を中断できませんでした。再試行してください。",
    conversation: {
      collaborationModeUnavailable:
        "タスクの実行中、待機中リクエストがある場合、有効な目標がある場合、または自動化に関連付けられている場合は、計画モードを変更できません。",
      compactionUnavailable:
        "コンテキストを圧縮できるのは、現在のタスクが停止した後だけです。",
      userInputRequestUnavailable:
        "この質問は終了したか、有効期限が切れています。タスクを更新して再試行してください。",
      planReviewPending:
        "続行する前に、現在の計画を実装・修正・スキップするか、計画モードを終了してください。",
      planReviewUnavailable:
        "この計画の確認は終了したか、利用できなくなっています。タスクを更新して再試行してください。",
      planOutputMissing:
        "計画モードで確認可能な計画が作成されませんでした。リクエストを再実行してください。",
      steerRequestFailed:
        "現在の実行に指示を追加できません。まだ実行中であることを確認して再試行してください。",
      steerRequestUncertain:
        "指示追加リクエストの結果を一時的に確認できません。現在の入力を保持し、再試行して状態を確認してください。",
    },
    composer: {
      voiceTranscriptionFailed:
        "音声文字起こしに失敗しました。再試行するか、手動でテキストを入力してください。",
      voiceTranscriptionRateLimited:
        "音声入力は 1 分間に 20 回までです。少し待ってから再試行してください。",
    },
    mcp: {
      insecureHttpAcknowledgementRequired:
        "HTTP では認証情報やツールのデータが暗号化されません。先にリスクを確認してください。",
      credentialRequired: "選択した認証方法には認証情報が必要です。",
      destinationForbidden:
        "MCP の接続先に localhost、プライベートネットワーク、クラウドのメタデータサービスは指定できません。",
      connectionFailed:
        "MCP サーバーに接続して初期化できませんでした。URL と認証情報を確認してください。",
    },
    clawhub: {
      skillNotFound: "スキルリポジトリにスキルが見つかりません。",
      skillNotInstallable:
        "このスキルは現在インストールできません。利用可否とセキュリティ状態を確認してください。",
      skillAlreadyInstalled: "このスキルは既にインストールされています。",
      serviceUnavailable:
        "ClawHub からスキルを取得できませんでした。しばらくしてから再試行してください。",
      installPreviewBusy:
        "別のスキルのインストールプレビューを準備中です。完了を待って再試行してください。",
      installPreviewRateLimited:
        "インストールプレビューのリクエストが多すぎます。しばらくしてから再試行してください。",
      installPreviewQuotaExceeded:
        "有効なスキルインストールプレビューの上限に達しました。しばらくしてから再試行してください。",
      packageIntegrityFailed:
        "ClawHub スキルファイルの整合性検証に失敗しました。インストールを中止しました。",
    },
    feedback: {
      submissionInvalid:
        "フィードバックのテキストまたは画像が条件を満たしていません。確認して再試行してください。",
      submissionFailed:
        "現在、フィードバックを送信できません。しばらくしてから再試行してください。",
    },
    knowledge: {
      archiveRequired: "削除できるのはアーカイブ済みのナレッジベースのみです。",
      inUse:
        "このナレッジベースはアプリケーションで使用中です。先に各アプリケーションから解除してください。",
      archived:
        "このナレッジベースはアーカイブ済みです。操作する前に復元してください。",
      disabled: "このナレッジベースは無効です。",
      quotaExceeded:
        "このナレッジベースには、ファイルを保存するための容量が不足しています。",
      duplicate:
        "このナレッジベースには、内容が同じドキュメントが既に存在します。",
      nameConflict:
        "このナレッジベースには同名のドキュメントが既に存在します。",
      actionConflict:
        "ドキュメントの現在の状態ではこの操作を行えません。更新して再試行してください。",
      activating:
        "新しいインデックスを有効化中です。少し待ってから再試行してください。",
      unsupportedFormat: "このドキュメント形式には対応していません。",
      fileTooLarge: "ドキュメントがファイルごとのサイズ上限を超えています。",
      processingFailed:
        "ドキュメントの処理に失敗しました。再試行するか、再処理してください。",
      previewUnavailable:
        "現在、原本のプレビューを利用できません。しばらくしてから再試行してください。",
      embeddingConfiguration:
        "埋め込みモデルの設定が無効です。管理者にお問い合わせください。",
    },
    knowledgeModel: {
      validationFailed:
        "ナレッジの埋め込みまたは再ランキングモデルの検証に失敗しました。接続先、キー、モデル ID、ベクトル次元を確認してください。",
      authenticationFailed:
        "モデルサービスが現在の API キーを受け付けませんでした。ベース URL を変更した場合は、新しい接続先で有効なキーを入力してください。",
      serviceUnavailable:
        "モデルサービスが検証リクエストを拒否したか、利用できません。ベース URL、モデル ID、ネットワーク、サービスの状態を確認してください。",
      responseInvalid:
        "モデルの応答形式に互換性がありません。API の互換性、モデル ID、埋め込みベクトルの次元を確認してください。",
      notConfigured: "管理者がナレッジの埋め込みモデルをまだ設定していません。",
    },
    knowledgeSource: {
      notConfigured: "管理者が SharePoint ナレッジソースを設定していません。",
      credentialValidationFailed:
        "SharePoint アプリの認証に失敗しました。テナント、アプリ ID、シークレットを確認してください。",
      urlInvalid:
        "SharePoint フォルダーの URL が無効か、設定済みのテナントドメインに属していません。",
      folderNotFound:
        "SharePoint フォルダーにアクセスできません。URL とサイトへの権限付与を確認してください。",
      alreadyConnected:
        "この SharePoint フォルダーは別のナレッジベースに接続済みです。",
      notFound: "ナレッジベースのソースが見つかりません。",
      syncUnavailable:
        "SharePoint の同期を一時的に利用できません。予定に沿って再試行します。",
      itemSyncFailed:
        "一部の SharePoint ドキュメントの同期に失敗しました。予定に沿って再試行します。",
    },
    application: {
      deleted: "このアプリケーションは削除されました",
      notFound:
        "アプリケーションが見つからないか、アクセスできなくなっています。",
      disabled:
        "このアプリケーションは無効のため、新しいターンを開始できません。",
      dependencyUnavailable:
        "このアプリケーションが使用するプラグイン、スキル、ナレッジベースのいずれかを利用できません。所有者に設定の更新を依頼してください。",
      grantTargetInvalid: "アプリケーションの共有先が無効か、利用できません。",
      grantConflict:
        "このユーザーまたはグループは、既にアプリケーションへのアクセス権を持っています。",
      packageInvalid:
        "操作可能なアプリケーションのパッケージが無効です。ZIP のルートに有効な manifest.json と index.html が含まれていることを確認してください。",
      runtimeBusy:
        "このアプリケーションには実行中の通常タスクがあるため、保存・更新できません。停止するか完了を待ってから再試行してください。",
      centerUnavailable:
        "このアプリケーションはアプリケーションセンターから削除されました。",
      customEventInvalid:
        "カスタムイベントの名前またはデータが、アプリケーションの仕様と一致しません。",
    },
    credentialConflict:
      "認証情報の関連付けが競合しています。続行前に使用する認証情報を明示的に選択してください。",
    credentialRequired:
      "必要な認証情報がありません。続行前に認証情報を関連付けてください。",
    avatarInvalid:
      "アバターのアップロードに失敗しました。対応する画像を選択して再試行してください。",
    applicationIconInvalid:
      "アプリケーションアイコンのアップロードに失敗しました。対応する画像を選択して再試行してください。",
    capabilityLogoInvalid:
      "ロゴのアップロードに失敗しました。対応する画像を選択して再試行してください。",
    productLogoInvalid:
      "システムロゴのアップロードに失敗しました。対応する画像を選択して再試行してください。",
    invalidPackage:
      "プラグイン・スキルのパッケージが無効か、必要なファイルがありません。",
    withReason: "{{message}} 理由：{{reason}}",
    importReasons: {
      archive_size_invalid: "アーカイブが空か、サイズ上限を超えています。",
      archive_unreadable:
        "アーカイブを読み込めませんでした。有効な ZIP ファイルであることを確認してください。",
      archive_entry_count_invalid: "アーカイブが空か、ファイル数が多すぎます。",
      archive_path_invalid:
        "アーカイブに安全でない、または無効なパスが含まれています：{{path}}。",
      archive_entry_symlink:
        "アーカイブにインポートできないシンボリックリンクが含まれています：{{path}}。",
      archive_entry_too_large:
        "アーカイブ内のファイルが大きすぎます：{{path}}。",
      archive_compression_ratio_exceeded:
        "アーカイブ内のファイルの圧縮率が異常で、安全でない可能性があります：{{path}}。",
      archive_expanded_size_exceeded:
        "アーカイブの展開後の合計サイズが上限を超えています。",
      archive_entry_read_failed:
        "アーカイブ内のファイルを読み込めませんでした：{{path}}。",
      package_manifest_count_invalid:
        "パッケージには必須のエントリーファイル SKILL.md または plugin.json を、ちょうど 1 つ含める必要があります。",
      package_multiple_roots:
        "アーカイブのルートディレクトリは 1 つである必要がありますが、複数見つかりました。",
      package_json_invalid: "プラグインのマニフェストが無効です。",
      plugin_mcp_configuration_invalid: "プラグインの MCP 設定が無効です。",
      skill_frontmatter_missing:
        "SKILL.md にフロントマターまたは必須の name フィールドがありません。",
      skill_display_name_invalid:
        "スキルの表示名が無効です。64 文字以内の 1 行で指定してください。",
      skill_name_invalid:
        "スキル名 {{value}} が無効です。英小文字、数字、ハイフンのみで、64 文字以内にしてください。",
      plugin_unsupported_component:
        "プラグインに未対応のコンポーネント形式が含まれています。",
      plugin_skills_invalid:
        "プラグインに指定されたスキルが無効か、SKILL.md がありません。",
      plugin_declared_path_invalid:
        "プラグインに無効なファイルパスが指定されています：{{path}}。",
      logo_file_invalid: "ロゴファイルが無効か、サイズ上限を超えています。",
      requested_type_mismatch:
        "選択した種類は {{expected}} ですが、アーカイブの内容は {{actual}} です。",
    },
    importFailed:
      "プラグイン・スキルのインポートに失敗しました。ソースを確認して再試行してください。",
    capabilityUpdateConflict:
      "このスキルは変更されました。更新画面を開き直し、最新の内容を確認してから送信してください。",
    capabilityUpdateUnchanged: "現在のスキルと内容が同じです。更新は不要です。",
    capabilityHomeSyncFailed:
      "プラグイン・スキルの状態を保存しましたが、ユーザーディレクトリを同期できませんでした。次のタスクのターン開始前に再試行します。",
    attachmentInvalid:
      "添付ファイルのアップロードに失敗しました。読み取り可能なファイルを選択して再試行してください。",
    attachmentTemporaryFileSkipped:
      "一時ファイルをスキップしました。必要な内容を含む別のファイルを選択してください。",
    fileLimitExceeded:
      "ファイルサイズまたは添付ファイル数が上限を超えています。",
    artifactNotFound: "成果物が見つかりません。",
    downloadForbidden: "この成果物をダウンロードする権限がありません。",
    runnerUnavailable:
      "実行サービスを利用できません。しばらくしてから再試行してください。",
    turnStartClosed:
      "前の送信は終了しています。このリクエストは実行されていません。再送信してください。",
    deploymentStopped:
      "システム更新のため、このタスクを停止しました。既存の内容は保持されています。進行状況を確認してから手動で続行してください。",
    creditLimitExceeded:
      "利用可能なクレジットを使い切ったため、現在は新しいタスクを開始できません。",
    lastAdminRequired:
      "少なくとも 1 人の有効な管理者が必要なため、この操作は完了できません。",
    lastModelRequired:
      "会話で利用できるチャットモデルを少なくとも 1 つ残してください。",
    modelProvider: {
      inUseBySystemSetting:
        "このモデルはシステム設定で使用中です。削除する前に、その選択を変更または解除してください。",
      managementDisabled:
        "モデル設定はデプロイ環境で固定されており、読み取り専用です。",
    },
    adminSelfChangeForbidden:
      "管理者は自分自身を無効にしたり、自分の管理者権限を解除したりできません。",
    emailExists: "このメールアドレスは別のユーザーが使用しています。",
    settingsInvalid: "システム設定が無効か、ここでは変更できません。",
    deploymentReadOnly:
      "この設定はデプロイ設定で管理されており、読み取り専用です。",
    systemAlreadyInitialized: "システムは既に初期設定済みです。",
    systemInitializationCredentialInvalid:
      "初期設定用の認証情報が無効です。インストール後に表示されたワンタイム認証情報を使用してください。",
    teamsFailed:
      "Teamsでログインできませんでした。再試行するか、別の方法を使用してください。",
    codexTurnFailed:
      "今回の実行に失敗しました。メッセージを確認して再試行してください。",
    turnCompletedWithoutOutput:
      "今回の実行は終了しましたが、表示可能な出力がありません。再実行してください。",
    automation: {
      emptyResult:
        "自動化は終了しましたが、表示可能な出力がありません。再実行してください。",
      expired: "この自動化の有効期限が切れたため、実行できません。",
    },
    userDisabled: "このユーザーは無効です。管理者にお問い合わせください。",
    conflict:
      "現在の状態ではこの操作を行えません。更新して再試行してください。",
    forbidden: "この操作を行う権限がありません。",
    notFound: "指定されたリソースは存在しないか、アクセスできません。",
    validation: "送信したデータが無効です。確認して再試行してください。",
  },
  loginMethods: {
    saml: "SAML 2.0",
    google: "Google",
    apple: "Apple",
    microsoft: "Microsoft",
    facebook: "Facebook",
    github: "GitHub",
    password: "ローカルパスワード",
    oidc: "シングルサインオン",
    teams: "Teams SSO",
  },
} satisfies TranslationResource<typeof enUS>
