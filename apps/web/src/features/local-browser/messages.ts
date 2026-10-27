import type { Locale } from "@linksense/shared"

export const localBrowserMessages = {
  "zh-CN": {
    supportedBrowsers: "目前仅支持桌面版 Chrome / Edge",
    unsupportedTitle: "请使用 Chrome 或 Edge",
    unsupportedDescription:
      "当前浏览器暂不支持 Browser Use。请用桌面版 Chrome 或 Edge 打开 LinkSense，再安装并启用扩展。",
    getChrome: "下载 Chrome",
    getEdge: "下载 Edge",
    copyAppAddress: "复制 LinkSense 地址",
    previewTitle: "Browser Use",
    setupTitle: "让助手操作你的本机浏览器",
    setupMissing:
      "还未检测到 Browser Use 扩展。安装后，助手可操作这台电脑的 Chrome / Edge，查看已打开的网页，并复用你的登录状态。",
    setupDisconnected:
      "已检测到 Browser Use 扩展，当前浏览器尚未连接。连接并授权后，助手就能操作你共享的网页。",
    setupOptional: "这是可选能力，云端浏览器仍可照常使用。",
    setupInstall: "前往安装",
    setupConnect: "前往连接",
    setupDismiss: "暂不需要",
    previewMove: "拖动预览到四角，或使用方向键移动",
    previewClose: "隐藏浏览器预览",
    previewActivate: "切换到标签页：{{title}}",
    previewUnavailable: "无法切换到此页，请确认浏览器已连接且页面仍在共享。",
    activityRunning: "正在使用 Browser Use",
    activityFinished: "Browser Use 操作已结束",
    secureConnection:
      "本地浏览器连接需要通过 HTTPS 或 localhost 访问 LinkSense。",
    title: "Browser Use",
    description:
      "云端浏览器无需安装。连接扩展后，助手还可操作这台电脑的 Chrome / Edge，复用你已有的登录态。",
    privacy:
      "仅共享你授权的网页。页面信息和截图会发送给 LinkSense 及配置的模型；你可随时断开。连接此浏览器会替换此账号之前的浏览器连接。",
    examples:
      "可以试试：“总结我已经打开的页面”或“使用我的本地浏览器，在已登录的网站里整理资料”。",
    install: "安装与使用",
    steps:
      "<step><download>下载扩展</download>并<strong>解压</strong>。</step><step>打开 <extensions>{{address}}</extensions>，启用<strong>开发者模式</strong>，选择“<strong>加载已解压的扩展程序</strong>”。<hint>点击优先在新标签页打开；若浏览器限制或扩展不可用，会复制地址，请粘贴到浏览器地址栏。</hint></step><step><strong>选择解压后的文件夹</strong>，然后<reload>刷新本页面</reload>。</step><step>打开 LinkSense，扩展会自动发起连接。<strong>首次在扩展弹窗中确认</strong>，之后自动连接和重连。可勾选<strong>允许新建标签页</strong>。</step><step>在需要共享的网页点击扩展图标，选择“<strong>授权当前网页</strong>”。</step>",
    copyAddress: "复制 {{address}}",
    openAddress: "在新标签页打开 {{address}}",
    extensionAddressCopied: "已复制 {{address}}，请粘贴到浏览器地址栏打开。",
    addressCopyFailed: "复制失败，请手动选择地址并复制。",
    download: "下载浏览器扩展",
    connect: "连接此浏览器",
    disconnect: "断开浏览器",
    connected: "已连接 · {{browser}}",
    disconnected: "Browser Use 未连接",
    detecting: "正在检测扩展…",
    notDetected: "未检测到扩展。安装后请刷新页面。",
    ready: "已检测到扩展，可以连接。",
    pending: "请在浏览器工具栏打开扩展并确认连接，然后授权需要操作的网页。",
    failed: "无法完成操作，请检查连接后重试。",
    cloudName: "{{productName}} 云端浏览器",
    cloudDescription:
      "在 LinkSense 云端隔离环境中访问网页、交互和截图，不使用本机登录态。",
    localName: "{{productName}} Browser Use",
    localDescription:
      "通过浏览器扩展操作已授权的 Chrome/Edge 页面，复用用户本机登录态。",
  },
  "en-US": {
    supportedBrowsers: "Currently supports desktop Chrome / Edge only",
    unsupportedTitle: "Please use Chrome or Edge",
    unsupportedDescription:
      "Browser Use is not supported in this browser. Open LinkSense in desktop Chrome or Edge, then install and enable the extension.",
    getChrome: "Get Chrome",
    getEdge: "Get Edge",
    copyAppAddress: "Copy LinkSense address",
    previewTitle: "Browser Use",
    setupTitle: "Let the assistant use your browser",
    setupMissing:
      "Browser Use is not detected. Install the extension to let the assistant use Chrome / Edge on this computer, work with open pages, and use your existing login sessions.",
    setupDisconnected:
      "Browser Use is installed, but this browser is not connected. Connect and authorize pages so the assistant can work with them.",
    setupOptional: "This is optional. The cloud browser remains available.",
    setupInstall: "Set up extension",
    setupConnect: "Connect browser",
    setupDismiss: "Not now",
    previewMove: "Drag the preview to a corner, or move it with arrow keys",
    previewClose: "Hide browser preview",
    previewActivate: "Switch to tab: {{title}}",
    previewUnavailable:
      "Cannot switch to this tab. Check that the browser is connected and the page is still shared.",
    activityRunning: "Using Browser Use",
    activityFinished: "Browser Use operation finished",
    secureConnection:
      "Open LinkSense over HTTPS or localhost to connect the local browser.",
    title: "Browser Use",
    description:
      "The cloud browser needs no installation. Connect the extension to let the assistant use Chrome / Edge on this computer with your existing login sessions.",
    privacy:
      "Only share pages you authorize. Page content and screenshots are sent to LinkSense and its configured model. You can disconnect at any time. Connecting replaces this account’s previous browser connection.",
    examples:
      "Try: “Summarize the page I already have open” or “Use my local browser to organize information on the website I’m signed in to.”",
    install: "Install and use",
    steps:
      "<step><download>Download the extension</download> and <strong>extract it</strong>.</step><step>Open <extensions>{{address}}</extensions>, enable <strong>Developer mode</strong>, and choose “<strong>Load unpacked</strong>”.<hint>Click to open a new tab. If the browser blocks it or the extension is unavailable, the address is copied instead; paste it into the browser’s address bar.</hint></step><step><strong>Select the extracted folder</strong>, then <reload>reload this page</reload>.</step><step>Open LinkSense to connect automatically. <strong>Confirm once in the extension popup</strong>; later connections and reconnections are automatic. You may <strong>allow new tabs</strong>.</step><step>On a page you want to share, open the extension and choose “<strong>Allow this page</strong>”.</step>",
    copyAddress: "Copy {{address}}",
    openAddress: "Open {{address}} in a new tab",
    extensionAddressCopied:
      "Copied {{address}}. Paste it into your browser’s address bar to open it.",
    addressCopyFailed: "Copy failed. Select and copy the address manually.",
    download: "Download browser extension",
    connect: "Connect this browser",
    disconnect: "Disconnect browser",
    connected: "Connected · {{browser}}",
    disconnected: "Browser Use disconnected",
    detecting: "Detecting extension…",
    notDetected: "Extension not detected. Reload this page after installation.",
    ready: "Extension detected. Ready to connect.",
    pending:
      "Open the extension in your browser toolbar, confirm the connection, then authorize the pages to operate.",
    failed:
      "The action could not be completed. Check the connection and try again.",
    cloudName: "{{productName}} Cloud Browser",
    cloudDescription:
      "Browse, interact and capture screenshots in LinkSense’s isolated cloud environment without local login sessions.",
    localName: "{{productName}} Browser Use",
    localDescription:
      "Use the extension to operate authorized Chrome/Edge pages with the user’s existing local login sessions.",
  },
  "es-ES": {
    supportedBrowsers: "Por ahora, solo Chrome / Edge de escritorio",
    unsupportedTitle: "Usa Chrome o Edge",
    unsupportedDescription:
      "Browser Use no es compatible con este navegador. Abre LinkSense en Chrome o Edge de escritorio e instala y activa la extensión.",
    getChrome: "Descargar Chrome",
    getEdge: "Descargar Edge",
    copyAppAddress: "Copiar dirección de LinkSense",
    previewTitle: "Browser Use",
    setupTitle: "Permite al asistente usar tu navegador",
    setupMissing:
      "No se ha detectado Browser Use. Instala la extensión para que el asistente use Chrome / Edge en este equipo, trabaje con páginas abiertas y aproveche tus sesiones existentes.",
    setupDisconnected:
      "Browser Use está instalado, pero este navegador no está conectado. Conéctalo y autoriza páginas para que el asistente pueda utilizarlas.",
    setupOptional: "Es opcional. El navegador en la nube sigue disponible.",
    setupInstall: "Instalar extensión",
    setupConnect: "Conectar navegador",
    setupDismiss: "Ahora no",
    previewMove: "Arrastra la vista a una esquina o muévela con las flechas",
    previewClose: "Ocultar vista del navegador",
    previewActivate: "Cambiar a la pestaña: {{title}}",
    previewUnavailable:
      "No se puede cambiar a esta pestaña. Comprueba la conexión y que la página siga compartida.",
    activityRunning: "Usando Browser Use",
    activityFinished: "Operación de Browser Use finalizada",
    secureConnection:
      "Abre LinkSense mediante HTTPS o localhost para conectar el navegador local.",
    title: "Browser Use",
    description:
      "El navegador en la nube no requiere instalación. Conecta la extensión para que el asistente utilice Chrome / Edge en este equipo con tus sesiones existentes.",
    privacy:
      "Comparte solo páginas que autorices. El contenido y las capturas se envían a LinkSense y su modelo configurado. Puedes desconectarte cuando quieras. La conexión reemplaza la anterior de esta cuenta.",
    examples:
      "Prueba: «Resume la página que ya tengo abierta» o «Usa mi navegador local para organizar información en el sitio donde ya inicié sesión».",
    install: "Instalación y uso",
    steps:
      "<step><download>Descarga la extensión</download> y <strong>descomprímela</strong>.</step><step>Abre <extensions>{{address}}</extensions>, activa el <strong>modo de desarrollador</strong> y elige «<strong>Cargar descomprimida</strong>».<hint>Haz clic para abrir una pestaña nueva. Si el navegador lo bloquea o la extensión no está disponible, se copiará la dirección; pégala en la barra de direcciones del navegador.</hint></step><step><strong>Selecciona la carpeta extraída</strong> y <reload>recarga esta página</reload>.</step><step>Abre LinkSense para conectar automáticamente. <strong>Confirma una vez en la extensión</strong>; las próximas conexiones y reconexiones serán automáticas. Puedes <strong>permitir pestañas nuevas</strong>.</step><step>En una página que quieras compartir, abre la extensión y elige «<strong>Autorizar esta página</strong>».</step>",
    copyAddress: "Copiar {{address}}",
    openAddress: "Abrir {{address}} en una pestaña nueva",
    extensionAddressCopied:
      "Se copió {{address}}. Pégala en la barra de direcciones del navegador para abrirla.",
    addressCopyFailed:
      "No se pudo copiar. Selecciona y copia la dirección manualmente.",
    download: "Descargar extensión",
    connect: "Conectar este navegador",
    disconnect: "Desconectar navegador",
    connected: "Conectado · {{browser}}",
    disconnected: "Browser Use desconectado",
    detecting: "Detectando extensión…",
    notDetected: "Extensión no detectada. Recarga esta página tras instalarla.",
    ready: "Extensión detectada. Lista para conectar.",
    pending:
      "Abre la extensión en la barra del navegador, confirma la conexión y autoriza las páginas que se utilizarán.",
    failed:
      "No se pudo completar la acción. Comprueba la conexión e inténtalo de nuevo.",
    cloudName: "Navegador en la nube de {{productName}}",
    cloudDescription:
      "Navega, interactúa y captura imágenes en el entorno aislado de LinkSense sin sesiones locales.",
    localName: "{{productName}} Browser Use",
    localDescription:
      "Utiliza la extensión para operar páginas autorizadas de Chrome/Edge con las sesiones locales existentes.",
  },
  "pt-BR": {
    supportedBrowsers: "No momento, apenas Chrome / Edge para computador",
    unsupportedTitle: "Use o Chrome ou o Edge",
    unsupportedDescription:
      "O Browser Use não é compatível com este navegador. Abra o LinkSense no Chrome ou Edge para computador e instale e ative a extensão.",
    getChrome: "Baixar Chrome",
    getEdge: "Baixar Edge",
    copyAppAddress: "Copiar endereço do LinkSense",
    previewTitle: "Browser Use",
    setupTitle: "Deixe o assistente usar seu navegador",
    setupMissing:
      "O Browser Use não foi detectado. Instale a extensão para o assistente usar o Chrome / Edge deste computador, trabalhar com páginas abertas e aproveitar suas sessões existentes.",
    setupDisconnected:
      "O Browser Use está instalado, mas este navegador não está conectado. Conecte e autorize páginas para o assistente poder usá-las.",
    setupOptional: "É opcional. O navegador na nuvem continua disponível.",
    setupInstall: "Instalar extensão",
    setupConnect: "Conectar navegador",
    setupDismiss: "Agora não",
    previewMove: "Arraste a prévia para um canto ou mova-a com as setas",
    previewClose: "Ocultar prévia do navegador",
    previewActivate: "Ir para a aba: {{title}}",
    previewUnavailable:
      "Não foi possível abrir esta aba. Confira a conexão e se a página ainda está compartilhada.",
    activityRunning: "Usando o Browser Use",
    activityFinished: "Operação do Browser Use encerrada",
    secureConnection:
      "Abra o LinkSense por HTTPS ou localhost para conectar o navegador local.",
    title: "Browser Use",
    description:
      "O navegador na nuvem não exige instalação. Conecte a extensão para o assistente usar o Chrome / Edge deste computador com suas sessões existentes.",
    privacy:
      "Compartilhe apenas páginas autorizadas. O conteúdo e as capturas são enviados ao LinkSense e ao modelo configurado. Você pode desconectar a qualquer momento. Esta conexão substitui a anterior da conta.",
    examples:
      "Experimente: “Resuma a página que já abri” ou “Use meu navegador local para organizar informações no site em que já entrei”.",
    install: "Instalação e uso",
    steps:
      "<step><download>Baixe a extensão</download> e <strong>extraia os arquivos</strong>.</step><step>Abra <extensions>{{address}}</extensions>, ative o <strong>modo do desenvolvedor</strong> e escolha “<strong>Carregar sem compactação</strong>”.<hint>Clique para abrir uma nova aba. Se o navegador bloquear a ação ou a extensão não estiver disponível, o endereço será copiado; cole-o na barra de endereços do navegador.</hint></step><step><strong>Selecione a pasta extraída</strong> e <reload>recarregue esta página</reload>.</step><step>Abra o LinkSense para conectar automaticamente. <strong>Confirme uma vez na extensão</strong>; as próximas conexões e reconexões serão automáticas. Você pode <strong>permitir novas abas</strong>.</step><step>Em uma página que deseja compartilhar, abra a extensão e escolha “<strong>Autorizar esta página</strong>”.</step>",
    copyAddress: "Copiar {{address}}",
    openAddress: "Abrir {{address}} em uma nova aba",
    extensionAddressCopied:
      "Endereço {{address}} copiado. Cole-o na barra de endereços do navegador para abrir.",
    addressCopyFailed:
      "Não foi possível copiar. Selecione e copie o endereço manualmente.",
    download: "Baixar extensão",
    connect: "Conectar este navegador",
    disconnect: "Desconectar navegador",
    connected: "Conectado · {{browser}}",
    disconnected: "Browser Use desconectado",
    detecting: "Detectando extensão…",
    notDetected:
      "Extensão não detectada. Recarregue a página após a instalação.",
    ready: "Extensão detectada. Pronta para conectar.",
    pending:
      "Abra a extensão na barra do navegador, confirme a conexão e autorize as páginas a serem utilizadas.",
    failed:
      "Não foi possível concluir a ação. Verifique a conexão e tente novamente.",
    cloudName: "Navegador na nuvem do {{productName}}",
    cloudDescription:
      "Navegue, interaja e capture imagens no ambiente isolado do LinkSense, sem sessões locais.",
    localName: "{{productName}} Browser Use",
    localDescription:
      "Use a extensão para operar páginas autorizadas do Chrome/Edge com as sessões locais existentes.",
  },
  "fr-FR": {
    supportedBrowsers: "Actuellement, Chrome / Edge sur ordinateur uniquement",
    unsupportedTitle: "Utilisez Chrome ou Edge",
    unsupportedDescription:
      "Browser Use n’est pas compatible avec ce navigateur. Ouvrez LinkSense dans Chrome ou Edge sur ordinateur, puis installez et activez l’extension.",
    getChrome: "Télécharger Chrome",
    getEdge: "Télécharger Edge",
    copyAppAddress: "Copier l’adresse de LinkSense",
    previewTitle: "Browser Use",
    setupTitle: "Laissez l’assistant utiliser votre navigateur",
    setupMissing:
      "Browser Use n’est pas détecté. Installez l’extension pour que l’assistant utilise Chrome / Edge sur cet ordinateur, travaille sur les pages ouvertes et réutilise vos sessions existantes.",
    setupDisconnected:
      "Browser Use est installé, mais ce navigateur n’est pas connecté. Connectez-le et autorisez les pages pour que l’assistant puisse les utiliser.",
    setupOptional: "C’est facultatif. Le navigateur cloud reste disponible.",
    setupInstall: "Installer l’extension",
    setupConnect: "Connecter le navigateur",
    setupDismiss: "Plus tard",
    previewMove:
      "Faites glisser l’aperçu vers un coin ou déplacez-le avec les flèches",
    previewClose: "Masquer l’aperçu du navigateur",
    previewActivate: "Aller à l’onglet : {{title}}",
    previewUnavailable:
      "Impossible d’ouvrir cet onglet. Vérifiez la connexion et que la page est toujours partagée.",
    activityRunning: "Utilisation de Browser Use",
    activityFinished: "Opération de Browser Use terminée",
    secureConnection:
      "Ouvrez LinkSense via HTTPS ou localhost pour connecter le navigateur local.",
    title: "Browser Use",
    description:
      "Le navigateur cloud ne nécessite aucune installation. Connectez l’extension pour que l’assistant utilise Chrome / Edge sur cet ordinateur avec vos sessions existantes.",
    privacy:
      "Partagez uniquement les pages autorisées. Le contenu et les captures sont transmis à LinkSense et au modèle configuré. Vous pouvez vous déconnecter à tout moment. La connexion remplace celle précédemment associée à ce compte.",
    examples:
      "Essayez : « Résume la page que j’ai déjà ouverte » ou « Utilise mon navigateur local pour organiser des informations sur le site auquel je suis connecté ».",
    install: "Installation et utilisation",
    steps:
      "<step><download>Téléchargez l’extension</download> et <strong>décompressez-la</strong>.</step><step>Ouvrez <extensions>{{address}}</extensions>, activez le <strong>mode développeur</strong> et choisissez « <strong>Charger l’extension non empaquetée</strong> ».<hint>Cliquez pour ouvrir un nouvel onglet. Si le navigateur bloque l’ouverture ou si l’extension est indisponible, l’adresse est copiée ; collez-la dans la barre d’adresse du navigateur.</hint></step><step><strong>Sélectionnez le dossier extrait</strong>, puis <reload>rechargez cette page</reload>.</step><step>Ouvrez LinkSense pour lancer la connexion. <strong>Confirmez une fois dans l’extension</strong> ; les connexions et reconnexions suivantes seront automatiques. Vous pouvez <strong>autoriser de nouveaux onglets</strong>.</step><step>Sur la page à partager, ouvrez l’extension et choisissez « <strong>Autoriser cette page</strong> ».</step>",
    copyAddress: "Copier {{address}}",
    openAddress: "Ouvrir {{address}} dans un nouvel onglet",
    extensionAddressCopied:
      "Adresse {{address}} copiée. Collez-la dans la barre d’adresse du navigateur pour l’ouvrir.",
    addressCopyFailed:
      "Échec de la copie. Sélectionnez et copiez l’adresse manuellement.",
    download: "Télécharger l’extension",
    connect: "Connecter ce navigateur",
    disconnect: "Déconnecter le navigateur",
    connected: "Connecté · {{browser}}",
    disconnected: "Browser Use déconnecté",
    detecting: "Détection de l’extension…",
    notDetected:
      "Extension non détectée. Rechargez la page après l’installation.",
    ready: "Extension détectée. Connexion possible.",
    pending:
      "Ouvrez l’extension dans la barre du navigateur, confirmez la connexion et autorisez les pages à utiliser.",
    failed: "L’action n’a pas abouti. Vérifiez la connexion et réessayez.",
    cloudName: "Navigateur cloud {{productName}}",
    cloudDescription:
      "Naviguez, interagissez et prenez des captures dans l’environnement isolé de LinkSense sans sessions locales.",
    localName: "{{productName}} Browser Use",
    localDescription:
      "Utilisez l’extension pour agir sur les pages Chrome/Edge autorisées avec les sessions locales existantes.",
  },
  "ja-JP": {
    supportedBrowsers: "現在はデスクトップ版 Chrome / Edge のみ対応",
    unsupportedTitle: "Chrome または Edge をご利用ください",
    unsupportedDescription:
      "このブラウザーは Browser Use に対応していません。デスクトップ版 Chrome または Edge で LinkSense を開き、拡張機能をインストールして有効にしてください。",
    getChrome: "Chrome をダウンロード",
    getEdge: "Edge をダウンロード",
    copyAppAddress: "LinkSense のアドレスをコピー",
    previewTitle: "Browser Use",
    setupTitle: "アシスタントにブラウザーの操作を任せる",
    setupMissing:
      "Browser Use が検出されません。拡張機能をインストールすると、このパソコンの Chrome / Edge で、開いているページや既存のログイン状態を使って操作できます。",
    setupDisconnected:
      "Browser Use はインストール済みですが、このブラウザーは未接続です。接続してページを許可すると、アシスタントが操作できるようになります。",
    setupOptional:
      "インストールは任意です。クラウドブラウザーも引き続き使えます。",
    setupInstall: "拡張機能を設定",
    setupConnect: "ブラウザーを接続",
    setupDismiss: "後で",
    previewMove: "プレビューを四隅にドラッグするか、矢印キーで移動",
    previewClose: "ブラウザープレビューを非表示",
    previewActivate: "タブに切り替え：{{title}}",
    previewUnavailable:
      "このタブに切り替えられません。ブラウザーの接続とページの共有状態を確認してください。",
    activityRunning: "Browser Use を使用中",
    activityFinished: "Browser Use の操作が終了しました",
    secureConnection:
      "ローカルブラウザーを接続するには、HTTPS または localhost で LinkSense を開いてください。",
    title: "Browser Use",
    description:
      "クラウドブラウザーはインストール不要です。拡張機能を接続すると、このパソコンの Chrome / Edge を既存のログイン状態で操作できます。",
    privacy:
      "許可したページだけを共有します。ページの内容と画像は LinkSense と設定されたモデルに送信されます。いつでも切断できます。接続すると、このアカウントの以前のブラウザー接続が置き換わります。",
    examples:
      "「すでに開いているページを要約して」「ローカルブラウザーで、ログイン済みのサイトから情報を整理して」と依頼できます。",
    install: "インストールと使い方",
    steps:
      "<step><download>拡張機能をダウンロード</download>して<strong>解凍</strong>します。</step><step><extensions>{{address}}</extensions> を開き、<strong>デベロッパーモード</strong>を有効にして「<strong>パッケージ化されていない拡張機能を読み込む</strong>」を選びます。<hint>クリックすると新しいタブで開きます。ブラウザーの制限や拡張機能が利用できない場合は、アドレスがコピーされます。ブラウザーのアドレスバーに貼り付けてください。</hint></step><step><strong>解凍したフォルダーを選択</strong>し、<reload>このページを再読み込み</reload>します。</step><step>LinkSense を開くと自動で接続が始まります。<strong>初回のみ拡張機能で確認</strong>すると、次回から接続・再接続は自動です。<strong>新しいタブの作成</strong>も許可できます。</step><step>共有するページで拡張機能を開き、「<strong>このページを許可</strong>」を選びます。</step>",
    copyAddress: "{{address}} をコピー",
    openAddress: "{{address}} を新しいタブで開く",
    extensionAddressCopied:
      "{{address}} をコピーしました。ブラウザーのアドレスバーに貼り付けて開いてください。",
    addressCopyFailed:
      "コピーできませんでした。アドレスを選択して手動でコピーしてください。",
    download: "拡張機能をダウンロード",
    connect: "このブラウザーを接続",
    disconnect: "ブラウザーを切断",
    connected: "接続済み · {{browser}}",
    disconnected: "Browser Use 未接続",
    detecting: "拡張機能を検出中…",
    notDetected:
      "拡張機能を検出できません。インストール後に再読み込みしてください。",
    ready: "拡張機能を検出しました。接続できます。",
    pending:
      "ブラウザーのツールバーから拡張機能を開いて接続を確認し、操作するページを許可してください。",
    failed: "操作を完了できませんでした。接続を確認して再試行してください。",
    cloudName: "{{productName}} クラウドブラウザー",
    cloudDescription:
      "ローカルのログイン状態を使用せず、LinkSense の分離された環境で閲覧・操作・画面取得を行います。",
    localName: "{{productName}} Browser Use",
    localDescription:
      "拡張機能を通じて許可された Chrome/Edge のページを既存のログイン状態で操作します。",
  },
} satisfies Record<
  Locale,
  Record<
    | "previewTitle"
    | "supportedBrowsers"
    | "unsupportedTitle"
    | "unsupportedDescription"
    | "getChrome"
    | "getEdge"
    | "copyAppAddress"
    | "setupTitle"
    | "setupMissing"
    | "setupDisconnected"
    | "setupOptional"
    | "setupInstall"
    | "setupConnect"
    | "setupDismiss"
    | "previewMove"
    | "previewClose"
    | "previewActivate"
    | "previewUnavailable"
    | "title"
    | "description"
    | "privacy"
    | "examples"
    | "install"
    | "steps"
    | "copyAddress"
    | "openAddress"
    | "extensionAddressCopied"
    | "addressCopyFailed"
    | "download"
    | "connect"
    | "disconnect"
    | "connected"
    | "disconnected"
    | "detecting"
    | "notDetected"
    | "ready"
    | "pending"
    | "failed"
    | "cloudName"
    | "cloudDescription"
    | "localName"
    | "localDescription"
    | "secureConnection"
    | "activityRunning"
    | "activityFinished",
    string
  >
>
