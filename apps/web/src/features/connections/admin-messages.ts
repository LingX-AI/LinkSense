import {
  localizedErrorMessage,
  type ConnectionProvider,
  type Locale,
} from "@linksense/shared"

type Messages = {
  title: string
  description: string
  configure: string
  configureProvider: string
  configured: string
  notConfigured: string
  clientId: string
  clientIdHelp: string
  clientIdRequired: string
  clientSecret: string
  secretSavedHelp: string
  secretNewHelp: string
  secretRequired: string
  redirectUri: string
  redirectHelp: string
  copyCallback: string
  callbackCopied: string
  copyFailed: string
  requiredPermissions: string
  permissionsHelp: string
  openConsole: string
  saved: string
  reauthorizationRequired: string
  acknowledgeReauthorization: string
  changeClientHelp: string
  emptyTitle: string
  emptyDescription: string
  setup: Record<ConnectionProvider, string>
}

export const adminConnectionMessages = {
  "zh-CN": {
    title: "连接器",
    description:
      "配置外部服务的应用信息。完成配置后，用户可在插件中心连接自己的账号。",
    configure: "配置",
    configureProvider: "配置 {{provider}}",
    configured: "已配置",
    notConfigured: "尚未配置",
    clientId: "应用 ID",
    clientIdHelp: "填写在对应服务平台创建的应用 ID。每个连接器分别保存配置。",
    clientIdRequired: "请填写应用 ID。",
    clientSecret: "应用密钥",
    secretSavedHelp: "已保存密钥。留空可保持现有密钥，填写新值可更新密钥。",
    secretNewHelp: "填写此应用对应的密钥。密钥保存后不会显示。",
    secretRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_SECRET_REQUIRED",
      "zh-CN"
    ),
    redirectUri: "授权回调地址",
    redirectHelp: "将此地址完整登记到服务平台的应用授权设置中。",
    copyCallback: "复制回调地址",
    callbackCopied: "回调地址已复制。",
    copyFailed: "复制失败，请手动复制回调地址。",
    requiredPermissions: "所需授权权限",
    permissionsHelp:
      "在服务平台配置以下权限。用户连接时仍需授权，组织策略可能要求管理员批准。",
    openConsole: "打开应用管理平台",
    saved: "连接器配置已保存。",
    reauthorizationRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION",
      "zh-CN"
    ),
    acknowledgeReauthorization:
      "我已知晓：更换应用 ID 后，已授权用户需要重新连接。",
    changeClientHelp:
      "更新同一应用的密钥通常无需重新连接。更换应用 ID 后，已有账号需要重新授权。",
    emptyTitle: "暂无可配置的连接器",
    emptyDescription: "当前没有可管理的外部服务，请稍后重试。",
    setup: {
      onedrive:
        "在 Microsoft Entra 中创建支持个人账号及工作或学校账号的 Web 应用，并配置文件读写委托权限。",
      sharepoint:
        "在 Microsoft Entra 中创建支持工作或学校账号的 Web 应用，并配置站点读取和文件读写委托权限。",
      outlook:
        "在 Microsoft Entra 中创建支持个人账号及工作或学校账号的 Web 应用，并配置邮件读写及发送委托权限。",
      google_docs:
        "在 Google Cloud 中创建 Web 应用客户端，启用 Google Docs API 和 Google Drive API，并配置授权同意页面。",
      gmail:
        "在 Google Cloud 中创建 Web 应用客户端，启用 Gmail API 并配置授权同意页面；测试阶段需登记测试用户。",
    },
  },
  "en-US": {
    title: "Connectors",
    description:
      "Configure external service apps so users can connect their own accounts in Plugin Center.",
    configure: "Configure",
    configureProvider: "Configure {{provider}}",
    configured: "Configured",
    notConfigured: "Not configured",
    clientId: "App ID",
    clientIdHelp:
      "Enter the app ID created in the service's console. Settings are saved separately for each connector.",
    clientIdRequired: "Enter an app ID.",
    clientSecret: "App secret",
    secretSavedHelp:
      "A secret is saved. Leave blank to keep it, or enter a new value to replace it.",
    secretNewHelp:
      "Enter this app's secret. Saved secrets are never displayed.",
    secretRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_SECRET_REQUIRED",
      "en-US"
    ),
    redirectUri: "Authorization callback URL",
    redirectHelp:
      "Register this exact URL in the service's app authorization settings.",
    copyCallback: "Copy callback URL",
    callbackCopied: "Callback URL copied.",
    copyFailed: "Could not copy. Copy the callback URL manually.",
    requiredPermissions: "Required permissions",
    permissionsHelp:
      "Configure these permissions in the service's console. Users must still authorize access; organization policies may require admin approval.",
    openConsole: "Open app console",
    saved: "Connector configuration saved.",
    reauthorizationRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION",
      "en-US"
    ),
    acknowledgeReauthorization:
      "I understand that changing the app ID requires authorized users to reconnect.",
    changeClientHelp:
      "Rotating the same app's secret usually keeps accounts connected. Changing the app ID requires existing accounts to authorize again.",
    emptyTitle: "No connectors to configure",
    emptyDescription:
      "There are no external services to manage. Try again later.",
    setup: {
      onedrive:
        "Create a Web app in Microsoft Entra that supports personal and work or school accounts, and configure delegated file read/write permissions.",
      sharepoint:
        "Create a Web app in Microsoft Entra that supports work or school accounts, and configure delegated site read and file read/write permissions.",
      outlook:
        "Create a Web app in Microsoft Entra that supports personal and work or school accounts, and configure delegated mail read/write and send permissions.",
      google_docs:
        "Create a Web application client in Google Cloud, enable the Google Docs and Google Drive APIs, and configure the consent screen.",
      gmail:
        "Create a Web application client in Google Cloud, enable the Gmail API and configure the consent screen. Register test users while the app is in testing.",
    },
  },
  "es-ES": {
    title: "Conectores",
    description:
      "Configura las aplicaciones de servicios externos para que los usuarios conecten sus cuentas en el Centro de complementos.",
    configure: "Configurar",
    configureProvider: "Configurar {{provider}}",
    configured: "Configurado",
    notConfigured: "Sin configurar",
    clientId: "ID de la aplicación",
    clientIdHelp:
      "Introduce el ID creado en la consola del servicio. Cada conector guarda su propia configuración.",
    clientIdRequired: "Introduce el ID de la aplicación.",
    clientSecret: "Secreto de la aplicación",
    secretSavedHelp:
      "Ya hay un secreto guardado. Déjalo vacío para conservarlo o introduce uno nuevo para sustituirlo.",
    secretNewHelp:
      "Introduce el secreto de esta aplicación. Los secretos guardados no se muestran.",
    secretRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_SECRET_REQUIRED",
      "es-ES"
    ),
    redirectUri: "URL de retorno de autorización",
    redirectHelp:
      "Registra esta URL exacta en los ajustes de autorización de la aplicación del servicio.",
    copyCallback: "Copiar URL de retorno",
    callbackCopied: "URL de retorno copiada.",
    copyFailed: "No se pudo copiar. Copia la URL de retorno manualmente.",
    requiredPermissions: "Permisos necesarios",
    permissionsHelp:
      "Configura estos permisos en la consola del servicio. Los usuarios deben autorizar el acceso; la organización puede exigir la aprobación de un administrador.",
    openConsole: "Abrir consola de aplicaciones",
    saved: "Configuración del conector guardada.",
    reauthorizationRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION",
      "es-ES"
    ),
    acknowledgeReauthorization:
      "Entiendo que cambiar el ID obliga a los usuarios autorizados a volver a conectarse.",
    changeClientHelp:
      "Renovar el secreto de la misma aplicación normalmente mantiene las conexiones. Cambiar su ID exige volver a autorizar las cuentas existentes.",
    emptyTitle: "No hay conectores que configurar",
    emptyDescription:
      "No hay servicios externos que gestionar. Inténtalo más tarde.",
    setup: {
      onedrive:
        "Crea una aplicación web en Microsoft Entra que admita cuentas personales, de trabajo o educativas y configura permisos delegados de lectura y escritura de archivos.",
      sharepoint:
        "Crea una aplicación web en Microsoft Entra que admita cuentas de trabajo o educativas y configura permisos delegados para leer sitios y leer y escribir archivos.",
      outlook:
        "Crea una aplicación web en Microsoft Entra que admita cuentas personales, de trabajo o educativas y configura permisos delegados para leer, escribir y enviar correo.",
      google_docs:
        "Crea un cliente de aplicación web en Google Cloud, activa Google Docs API y Google Drive API y configura la pantalla de consentimiento.",
      gmail:
        "Crea un cliente de aplicación web en Google Cloud, activa Gmail API y configura la pantalla de consentimiento. Registra usuarios de prueba durante la fase de pruebas.",
    },
  },
  "pt-BR": {
    title: "Conectores",
    description:
      "Configure os aplicativos de serviços externos para que os usuários conectem suas contas na Central de plugins.",
    configure: "Configurar",
    configureProvider: "Configurar {{provider}}",
    configured: "Configurado",
    notConfigured: "Não configurado",
    clientId: "ID do aplicativo",
    clientIdHelp:
      "Informe o ID criado no console do serviço. Cada conector mantém sua própria configuração.",
    clientIdRequired: "Informe o ID do aplicativo.",
    clientSecret: "Segredo do aplicativo",
    secretSavedHelp:
      "Já existe um segredo salvo. Deixe em branco para mantê-lo ou informe um novo valor para substituí-lo.",
    secretNewHelp:
      "Informe o segredo deste aplicativo. Segredos salvos nunca são exibidos.",
    secretRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_SECRET_REQUIRED",
      "pt-BR"
    ),
    redirectUri: "URL de retorno da autorização",
    redirectHelp:
      "Cadastre esta URL exata nas configurações de autorização do aplicativo no serviço.",
    copyCallback: "Copiar URL de retorno",
    callbackCopied: "URL de retorno copiada.",
    copyFailed: "Não foi possível copiar. Copie a URL de retorno manualmente.",
    requiredPermissions: "Permissões necessárias",
    permissionsHelp:
      "Configure estas permissões no console do serviço. Os usuários ainda precisam autorizar o acesso; a organização pode exigir aprovação de um administrador.",
    openConsole: "Abrir console de aplicativos",
    saved: "Configuração do conector salva.",
    reauthorizationRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION",
      "pt-BR"
    ),
    acknowledgeReauthorization:
      "Entendo que alterar o ID exige que os usuários autorizados se conectem novamente.",
    changeClientHelp:
      "Atualizar o segredo do mesmo aplicativo geralmente mantém as contas conectadas. Alterar o ID exige nova autorização das contas existentes.",
    emptyTitle: "Nenhum conector para configurar",
    emptyDescription:
      "Não há serviços externos para gerenciar. Tente novamente mais tarde.",
    setup: {
      onedrive:
        "Crie um aplicativo Web no Microsoft Entra que aceite contas pessoais, corporativas ou escolares e configure permissões delegadas de leitura e gravação de arquivos.",
      sharepoint:
        "Crie um aplicativo Web no Microsoft Entra que aceite contas corporativas ou escolares e configure permissões delegadas para ler sites e ler e gravar arquivos.",
      outlook:
        "Crie um aplicativo Web no Microsoft Entra que aceite contas pessoais, corporativas ou escolares e configure permissões delegadas para ler, gravar e enviar emails.",
      google_docs:
        "Crie um cliente de aplicativo Web no Google Cloud, ative Google Docs API e Google Drive API e configure a tela de consentimento.",
      gmail:
        "Crie um cliente de aplicativo Web no Google Cloud, ative Gmail API e configure a tela de consentimento. Cadastre usuários de teste enquanto o aplicativo estiver em teste.",
    },
  },
  "fr-FR": {
    title: "Connecteurs",
    description:
      "Configurez les applications des services externes pour permettre aux utilisateurs de connecter leurs comptes dans le Centre de plugins.",
    configure: "Configurer",
    configureProvider: "Configurer {{provider}}",
    configured: "Configuré",
    notConfigured: "Non configuré",
    clientId: "Identifiant de l’application",
    clientIdHelp:
      "Saisissez l’identifiant créé dans la console du service. Chaque connecteur possède sa propre configuration.",
    clientIdRequired: "Saisissez l’identifiant de l’application.",
    clientSecret: "Secret de l’application",
    secretSavedHelp:
      "Un secret est enregistré. Laissez ce champ vide pour le conserver ou saisissez une nouvelle valeur pour le remplacer.",
    secretNewHelp:
      "Saisissez le secret de cette application. Les secrets enregistrés ne sont jamais affichés.",
    secretRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_SECRET_REQUIRED",
      "fr-FR"
    ),
    redirectUri: "URL de retour d’autorisation",
    redirectHelp:
      "Enregistrez cette URL exacte dans les paramètres d’autorisation de l’application du service.",
    copyCallback: "Copier l’URL de retour",
    callbackCopied: "URL de retour copiée.",
    copyFailed: "La copie a échoué. Copiez l’URL de retour manuellement.",
    requiredPermissions: "Autorisations nécessaires",
    permissionsHelp:
      "Configurez ces autorisations dans la console du service. Les utilisateurs doivent autoriser l’accès ; leur organisation peut exiger l’accord d’un administrateur.",
    openConsole: "Ouvrir la console des applications",
    saved: "Configuration du connecteur enregistrée.",
    reauthorizationRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION",
      "fr-FR"
    ),
    acknowledgeReauthorization:
      "Je comprends que changer l’identifiant impose aux utilisateurs autorisés de se reconnecter.",
    changeClientHelp:
      "Renouveler le secret de la même application conserve généralement les connexions. Changer son identifiant impose une nouvelle autorisation des comptes existants.",
    emptyTitle: "Aucun connecteur à configurer",
    emptyDescription:
      "Aucun service externe n’est disponible à la gestion. Réessayez plus tard.",
    setup: {
      onedrive:
        "Créez une application Web dans Microsoft Entra acceptant les comptes personnels, professionnels ou scolaires et configurez les autorisations déléguées de lecture et d’écriture des fichiers.",
      sharepoint:
        "Créez une application Web dans Microsoft Entra acceptant les comptes professionnels ou scolaires et configurez les autorisations déléguées de lecture des sites et de lecture et d’écriture des fichiers.",
      outlook:
        "Créez une application Web dans Microsoft Entra acceptant les comptes personnels, professionnels ou scolaires et configurez les autorisations déléguées de lecture, d’écriture et d’envoi des messages.",
      google_docs:
        "Créez un client d’application Web dans Google Cloud, activez Google Docs API et Google Drive API et configurez l’écran de consentement.",
      gmail:
        "Créez un client d’application Web dans Google Cloud, activez Gmail API et configurez l’écran de consentement. Inscrivez des utilisateurs de test pendant la phase de test.",
    },
  },
  "ja-JP": {
    title: "コネクタ",
    description:
      "外部サービスのアプリを設定すると、ユーザーがプラグインセンターで自分のアカウントを接続できます。",
    configure: "設定",
    configureProvider: "{{provider}} を設定",
    configured: "設定済み",
    notConfigured: "未設定",
    clientId: "アプリ ID",
    clientIdHelp:
      "サービスの管理画面で作成したアプリ ID を入力してください。設定はコネクタごとに保存されます。",
    clientIdRequired: "アプリ ID を入力してください。",
    clientSecret: "アプリのシークレット",
    secretSavedHelp:
      "シークレットは保存済みです。変更しない場合は空欄のまま、更新する場合は新しい値を入力してください。",
    secretNewHelp:
      "このアプリのシークレットを入力してください。保存後は表示されません。",
    secretRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_SECRET_REQUIRED",
      "ja-JP"
    ),
    redirectUri: "認可コールバック URL",
    redirectHelp:
      "サービスのアプリ認可設定に、この URL をそのまま登録してください。",
    copyCallback: "コールバック URL をコピー",
    callbackCopied: "コールバック URL をコピーしました。",
    copyFailed:
      "コピーできませんでした。コールバック URL を手動でコピーしてください。",
    requiredPermissions: "必要なアクセス許可",
    permissionsHelp:
      "サービスの管理画面で以下の権限を設定してください。ユーザー自身の認可も必要です。組織の方針により管理者の承認が必要な場合があります。",
    openConsole: "アプリ管理画面を開く",
    saved: "コネクタ設定を保存しました。",
    reauthorizationRequired: localizedErrorMessage(
      "CONNECTION_CLIENT_CHANGE_REQUIRES_CONFIRMATION",
      "ja-JP"
    ),
    acknowledgeReauthorization:
      "アプリ ID を変更すると、認可済みユーザーの再接続が必要になることを確認しました。",
    changeClientHelp:
      "同じアプリのシークレットの更新では、通常は接続が維持されます。アプリ ID を変更すると、既存アカウントの再認可が必要です。",
    emptyTitle: "設定できるコネクタがありません",
    emptyDescription:
      "管理できる外部サービスがありません。しばらくしてから再試行してください。",
    setup: {
      onedrive:
        "Microsoft Entra で個人、職場または学校のアカウントに対応する Web アプリを作成し、ファイルの読み書きに必要な委任されたアクセス許可を設定してください。",
      sharepoint:
        "Microsoft Entra で職場または学校のアカウントに対応する Web アプリを作成し、サイトの読み取りとファイルの読み書きに必要な委任されたアクセス許可を設定してください。",
      outlook:
        "Microsoft Entra で個人、職場または学校のアカウントに対応する Web アプリを作成し、メールの読み書きと送信に必要な委任されたアクセス許可を設定してください。",
      google_docs:
        "Google Cloud で Web アプリのクライアントを作成し、Google Docs API と Google Drive API を有効にして、同意画面を設定してください。",
      gmail:
        "Google Cloud で Web アプリのクライアントを作成し、Gmail API を有効にして同意画面を設定してください。テスト中はテストユーザーの登録が必要です。",
    },
  },
} satisfies Record<Locale, Messages>
