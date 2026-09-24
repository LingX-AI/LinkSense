import type { Locale } from "@linksense/shared"

export const connectionMessages = {
  "zh-CN": {
    gmail: "Gmail",
    google_docs: "Google 文档",
    outlook: "Outlook 邮箱",
    google_docsDescription:
      "搜索、读取、创建和编辑 Google 文档，导出为 Word、PDF 或文本。",
    gmailDescription: "搜索和阅读 Gmail 邮件，管理草稿、收发邮件及附件。",
    outlookDescription: "搜索和阅读 Outlook 邮件，管理草稿、收发邮件及附件。",

    onedrive: "OneDrive",
    sharepoint: "SharePoint",
    onedriveDescription: "搜索、读取和编辑个人或工作账号的 OneDrive 文件。",
    sharepointDescription: "使用工作或学校账号搜索站点、浏览文档库并读写文件。",
    connect: "连接",
    reconnect: "重新连接",
    tabBlocked: "未能打开授权标签页，请允许本站打开新标签页后重试。",
    disconnect: "解绑",
    connected: "已连接",
    connectedAccount: "连接账号",
    disconnected: "未连接",
    reconnect_required: "需要重新授权",
    notConfigured: "尚未配置",
    upgrade: "启用读写",
    upgradeHelp:
      "当前授权仅允许读取。启用读写后，可让 AI 在此服务中创建和修改内容。",
    success: "连接成功，可以在任务中使用了。",
    failure:
      "未能完成连接。请重新授权；如果是组织账号，可能需要管理员允许访问。",
    setupHelp: "请联系管理员完成此服务的配置后再连接。",
    disconnectTitle: "解绑 {{provider}}？",
    disconnectDescription:
      "AI 将无法继续访问或修改此账号的内容。任务中已有的内容会保留，你可以随时重新连接。",
    errors: {
      fileConflict: "文件已被修改或存在同名文件，请重新读取文件状态后再操作。",
      writeRequired:
        "当前连接仅有读取权限，请在插件中心的「连接器」中启用读写并重新授权。",
      notConfigured: "管理员尚未配置此连接。",
      authFailed: "授权未完成或已失效，请重新连接。",
      required: "请先在插件中心的「连接器」中连接此服务。",
      unavailable: "暂时无法访问此服务，请稍后重试。",
      accessDenied: "当前账号无法访问此内容，请检查账号和权限。",
      fileTooLarge:
        "内容或附件超过此操作允许的大小，请缩小范围或选择较小的文件。",
    },
  },
  "en-US": {
    gmail: "Gmail",
    google_docs: "Google Docs",
    outlook: "Outlook Mail",
    google_docsDescription:
      "Search, read, create and edit Google documents, and export them as Word, PDF or text.",
    gmailDescription:
      "Search and read Gmail, manage drafts, and send and receive messages and attachments.",
    outlookDescription:
      "Search and read Outlook mail, manage drafts, and send and receive messages and attachments.",

    onedrive: "OneDrive",
    sharepoint: "SharePoint",
    onedriveDescription:
      "Search, read and edit OneDrive files from your personal or work account.",
    sharepointDescription:
      "Search sites, browse libraries and read or write files using work or school accounts.",
    connect: "Connect",
    reconnect: "Reconnect",
    tabBlocked:
      "The authorization tab could not be opened. Allow this site to open new tabs, then try again.",
    disconnect: "Unlink",
    connected: "Connected",
    connectedAccount: "Connected account",
    disconnected: "Not connected",
    reconnect_required: "Authorization required",
    notConfigured: "Not configured",
    upgrade: "Enable read and write",
    upgradeHelp:
      "Your current authorization only allows reading. Enable read and write to let AI create and change content in this service.",
    success: "Connected. You can now use this service in your tasks.",
    failure:
      "Connection could not be completed. Try authorizing again; your organization account may require administrator approval.",
    setupHelp:
      "Ask an administrator to configure this service before connecting.",
    disconnectTitle: "Unlink {{provider}}?",
    disconnectDescription:
      "AI will no longer access or change content in this account. Content already in your tasks will remain. You can reconnect at any time.",
    errors: {
      fileConflict:
        "The file has changed or a file with this name already exists. Read its current state before trying again.",
      writeRequired:
        "This connection only allows reading. Enable read and write in Plugin Center → Connectors and authorize again.",
      notConfigured: "An administrator must configure this connection first.",
      authFailed: "Authorization failed or expired. Connect again.",
      required: "Connect this service in Plugin Center → Connectors first.",
      unavailable: "This service is temporarily unavailable. Try again later.",
      accessDenied:
        "This account cannot access this content. Check your account and permissions.",
      fileTooLarge:
        "The content or attachments exceed the size allowed for this action. Narrow the request or choose smaller files.",
    },
  },
  "es-ES": {
    gmail: "Gmail",
    google_docs: "Documentos de Google",
    outlook: "Correo de Outlook",
    google_docsDescription:
      "Busca, lee, crea y edita documentos de Google y expórtalos a Word, PDF o texto.",
    gmailDescription:
      "Busca y lee Gmail, gestiona borradores y envía y recibe mensajes y archivos adjuntos.",
    outlookDescription:
      "Busca y lee el correo de Outlook, gestiona borradores y envía y recibe mensajes y archivos adjuntos.",

    onedrive: "OneDrive",
    sharepoint: "SharePoint",
    onedriveDescription:
      "Busca, lee y edita archivos de OneDrive de tu cuenta personal o de trabajo.",
    sharepointDescription:
      "Usa una cuenta de trabajo o educativa para buscar sitios, explorar bibliotecas y leer o escribir archivos.",
    connect: "Conectar",
    reconnect: "Volver a conectar",
    tabBlocked:
      "No se pudo abrir la pestaña de autorización. Permite que este sitio abra nuevas pestañas y vuelve a intentarlo.",
    disconnect: "Desvincular",
    connected: "Conectado",
    connectedAccount: "Cuenta conectada",
    disconnected: "Sin conectar",
    reconnect_required: "Se requiere autorización",
    notConfigured: "Sin configurar",
    upgrade: "Permitir lectura y escritura",
    upgradeHelp:
      "Tu autorización actual solo permite leer. Activa la lectura y escritura para que la IA cree y modifique contenido en este servicio.",
    success: "Conectado. Ya puedes usar el servicio en tus conversaciones.",
    failure:
      "No se pudo completar la conexión. Autoriza de nuevo; una cuenta de trabajo o educativa puede requerir aprobación del administrador.",
    setupHelp:
      "Pide a un administrador que configure este servicio antes de conectarlo.",
    disconnectTitle: "¿Desvincular {{provider}}?",
    disconnectDescription:
      "La IA dejará de acceder o modificar el contenido de esta cuenta. Se conservará el contenido de tus tareas y podrás volver a conectarte.",
    errors: {
      fileConflict:
        "El archivo ha cambiado o ya existe otro con ese nombre. Consulta su estado actual antes de volver a intentarlo.",
      writeRequired:
        "Esta conexión solo permite leer. Activa la lectura y escritura en Centro de plugins → Conectores y autoriza de nuevo.",
      notConfigured: "Un administrador debe configurar esta conexión.",
      authFailed: "La autorización falló o caducó. Vuelve a conectar.",
      required: "Conecta este servicio en Centro de plugins → Conectores.",
      unavailable:
        "Este servicio no está disponible temporalmente. Inténtalo más tarde.",
      accessDenied:
        "Esta cuenta no puede acceder a este contenido. Revisa la cuenta y sus permisos.",
      fileTooLarge:
        "El contenido o los adjuntos superan el tamaño permitido para esta acción. Reduce la solicitud o elige archivos más pequeños.",
    },
  },
  "pt-BR": {
    gmail: "Gmail",
    google_docs: "Documentos Google",
    outlook: "Email do Outlook",
    google_docsDescription:
      "Pesquise, leia, crie e edite documentos do Google e exporte para Word, PDF ou texto.",
    gmailDescription:
      "Pesquise e leia o Gmail, gerencie rascunhos e envie e receba mensagens e anexos.",
    outlookDescription:
      "Pesquise e leia emails do Outlook, gerencie rascunhos e envie e receba mensagens e anexos.",

    onedrive: "OneDrive",
    sharepoint: "SharePoint",
    onedriveDescription:
      "Pesquise, leia e edite arquivos do OneDrive da sua conta pessoal ou de trabalho.",
    sharepointDescription:
      "Use uma conta corporativa ou escolar para encontrar sites, explorar bibliotecas e ler ou gravar arquivos.",
    connect: "Conectar",
    reconnect: "Reconectar",
    tabBlocked:
      "Não foi possível abrir a aba de autorização. Permita que este site abra novas abas e tente novamente.",
    disconnect: "Desvincular",
    connected: "Conectado",
    connectedAccount: "Conta conectada",
    disconnected: "Não conectado",
    reconnect_required: "Autorização necessária",
    notConfigured: "Não configurado",
    upgrade: "Permitir leitura e gravação",
    upgradeHelp:
      "Sua autorização atual permite apenas leitura. Ative a leitura e gravação para a IA criar e alterar conteúdo neste serviço.",
    success: "Conectado. Agora você pode usar o serviço nas conversas.",
    failure:
      "Não foi possível concluir a conexão. Autorize novamente; uma conta corporativa ou escolar pode exigir aprovação do administrador.",
    setupHelp:
      "Peça a um administrador para configurar este serviço antes de conectar.",
    disconnectTitle: "Desvincular {{provider}}?",
    disconnectDescription:
      "A IA deixará de acessar ou alterar o conteúdo desta conta. O conteúdo das tarefas será mantido e você poderá reconectar quando quiser.",
    errors: {
      fileConflict:
        "O arquivo mudou ou já existe outro com esse nome. Consulte o estado atual antes de tentar novamente.",
      writeRequired:
        "Esta conexão permite apenas leitura. Ative a leitura e gravação em Central de plugins → Conectores e autorize novamente.",
      notConfigured: "Um administrador precisa configurar esta conexão.",
      authFailed: "A autorização falhou ou expirou. Conecte novamente.",
      required: "Conecte este serviço em Central de plugins → Conectores.",
      unavailable:
        "Este serviço está temporariamente indisponível. Tente mais tarde.",
      accessDenied:
        "Esta conta não pode acessar este conteúdo. Verifique a conta e as permissões.",
      fileTooLarge:
        "O conteúdo ou os anexos excedem o tamanho permitido para esta ação. Reduza a solicitação ou escolha arquivos menores.",
    },
  },
  "fr-FR": {
    gmail: "Gmail",
    google_docs: "Google Docs",
    outlook: "Messagerie Outlook",
    google_docsDescription:
      "Recherchez, lisez, créez et modifiez des documents Google, puis exportez-les en Word, PDF ou texte.",
    gmailDescription:
      "Recherchez et lisez Gmail, gérez les brouillons, envoyez et recevez des messages et des pièces jointes.",
    outlookDescription:
      "Recherchez et lisez les e-mails Outlook, gérez les brouillons, envoyez et recevez des messages et des pièces jointes.",

    onedrive: "OneDrive",
    sharepoint: "SharePoint",
    onedriveDescription:
      "Recherchez, lisez et modifiez les fichiers OneDrive de votre compte personnel ou professionnel.",
    sharepointDescription:
      "Utilisez un compte professionnel ou scolaire pour rechercher des sites, parcourir les bibliothèques et lire ou modifier des fichiers.",
    connect: "Connecter",
    reconnect: "Reconnecter",
    tabBlocked:
      "L’onglet d’autorisation n’a pas pu s’ouvrir. Autorisez ce site à ouvrir de nouveaux onglets, puis réessayez.",
    disconnect: "Dissocier",
    connected: "Connecté",
    connectedAccount: "Compte connecté",
    disconnected: "Non connecté",
    reconnect_required: "Autorisation requise",
    notConfigured: "Non configuré",
    upgrade: "Autoriser la lecture et l’écriture",
    upgradeHelp:
      "Votre autorisation actuelle permet uniquement la lecture. Activez l’écriture pour que l’IA crée et modifie du contenu dans ce service.",
    success:
      "Connexion réussie. Vous pouvez utiliser ce service dans vos conversations.",
    failure:
      "La connexion n’a pas abouti. Réessayez ; un compte professionnel ou scolaire peut nécessiter l’accord d’un administrateur.",
    setupHelp:
      "Demandez à un administrateur de configurer ce service avant de le connecter.",
    disconnectTitle: "Dissocier {{provider}} ?",
    disconnectDescription:
      "L’IA ne pourra plus accéder au contenu de ce compte ni le modifier. Le contenu de vos tâches sera conservé et vous pourrez vous reconnecter.",
    errors: {
      fileConflict:
        "Le fichier a été modifié ou un fichier de ce nom existe déjà. Consultez son état actuel avant de réessayer.",
      writeRequired:
        "Cette connexion permet uniquement la lecture. Activez l’écriture dans Centre de plugins → Connecteurs et autorisez à nouveau l’accès.",
      notConfigured: "Un administrateur doit configurer cette connexion.",
      authFailed: "L’autorisation a échoué ou a expiré. Reconnectez-vous.",
      required: "Connectez ce service dans Centre de plugins → Connecteurs.",
      unavailable:
        "Ce service est temporairement indisponible. Réessayez plus tard.",
      accessDenied:
        "Ce compte ne peut pas accéder à ce contenu. Vérifiez le compte et ses autorisations.",
      fileTooLarge:
        "Le contenu ou les pièces jointes dépassent la taille autorisée pour cette action. Réduisez la demande ou choisissez des fichiers plus petits.",
    },
  },
  "ja-JP": {
    gmail: "Gmail",
    google_docs: "Google ドキュメント",
    outlook: "Outlook メール",
    google_docsDescription:
      "Google ドキュメントの検索、閲覧、作成、編集と、Word、PDF、テキストへの書き出しができます。",
    gmailDescription:
      "Gmail の検索・閲覧、下書きの管理、メールや添付ファイルの送受信ができます。",
    outlookDescription:
      "Outlook メールの検索・閲覧、下書きの管理、メールや添付ファイルの送受信ができます。",

    onedrive: "OneDrive",
    sharepoint: "SharePoint",
    onedriveDescription:
      "個人用または職場のアカウントの OneDrive ファイルを検索、閲覧、編集します。",
    sharepointDescription:
      "職場または学校のアカウントでサイトやライブラリを検索し、ファイルを読み書きします。",
    connect: "接続",
    reconnect: "再接続",
    tabBlocked:
      "認証用のタブを開けませんでした。このサイトで新しいタブを開くことを許可してから、もう一度お試しください。",
    disconnect: "連携を解除",
    connected: "接続済み",
    connectedAccount: "接続中のアカウント",
    disconnected: "未接続",
    reconnect_required: "再認証が必要",
    notConfigured: "未設定",
    upgrade: "書き込みを許可",
    upgradeHelp:
      "現在の認証は読み取り専用です。書き込みを許可すると、AI がこのサービス内の内容を作成・変更できます。",
    success: "接続しました。会話でこのサービスを使用できます。",
    failure:
      "接続を完了できませんでした。再認証してください。職場または学校のアカウントでは管理者の承認が必要な場合があります。",
    setupHelp: "接続する前に、管理者にこのサービスの設定を依頼してください。",
    disconnectTitle: "{{provider}} との連携を解除しますか？",
    disconnectDescription:
      "AI はこのアカウントの内容にアクセスしたり変更したりできなくなります。タスク内の内容は保持され、いつでも再接続できます。",
    errors: {
      fileConflict:
        "ファイルが変更されたか、同じ名前のファイルが存在します。最新の状態を確認してから再試行してください。",
      writeRequired:
        "この接続は読み取り専用です。プラグインセンターの「コネクター」で書き込みを許可し、再認証してください。",
      notConfigured: "管理者による接続設定が必要です。",
      authFailed:
        "認証が完了しなかったか、有効期限が切れました。再接続してください。",
      required:
        "先にプラグインセンターの「コネクター」でこのサービスに接続してください。",
      unavailable:
        "現在このサービスにアクセスできません。しばらくしてから再試行してください。",
      accessDenied:
        "このアカウントではアクセスできません。アカウントと権限を確認してください。",
      fileTooLarge:
        "内容または添付ファイルがこの操作のサイズ上限を超えています。対象を絞るか、小さいファイルを選択してください。",
    },
  },
} satisfies Record<Locale, Record<string, string | Record<string, string>>>
