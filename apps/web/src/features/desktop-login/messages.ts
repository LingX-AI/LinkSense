import type { Locale } from "@linksense/shared"

type DesktopLoginMessages = {
  title: string
  description: string
  openBrowser: string
  waiting: string
  failed: string
  authorizing: string
  authorizeDescription: string
  invalid: string
  returnToApp: string
  browserConfirmed: string
}

export const desktopLoginMessages: Record<Locale, DesktopLoginMessages> = {
  "zh-CN": {
    title: "登录 LinkSense",
    description: "在浏览器中安全登录。已有登录会话将自动用于客户端。",
    openBrowser: "在浏览器中登录",
    waiting: "已打开浏览器，请完成登录。完成后将自动回到客户端。",
    failed:
      "登录未完成或已过期。请返回客户端重试，并确认浏览器可以访问 LinkSense。",
    authorizing: "正在登录客户端",
    authorizeDescription:
      "正在使用当前浏览器会话，完成后将自动返回 LinkSense 客户端。",
    invalid: "登录请求无效。请从 LinkSense 客户端重新发起登录。",
    returnToApp: "返回客户端",
    browserConfirmed:
      "浏览器已确认登录。如果客户端没有自动打开，请点击下方按钮。",
  },
  "en-US": {
    title: "Sign in to LinkSense",
    description:
      "Sign in securely in your browser. An existing session will be used automatically for the app.",
    openBrowser: "Sign in with browser",
    waiting:
      "Your browser is open. Finish signing in to return to the app automatically.",
    failed:
      "Sign-in did not finish or expired. Try again from the app and check that your browser can reach LinkSense.",
    authorizing: "Signing in to the app",
    authorizeDescription:
      "Using your current browser session. You will return to the LinkSense app automatically.",
    invalid:
      "This sign-in request is invalid. Start again from the LinkSense app.",
    returnToApp: "Return to the app",
    browserConfirmed:
      "Your browser session is ready. If LinkSense doesn’t open automatically, use the button below.",
  },
  "es-ES": {
    title: "Iniciar sesión en LinkSense",
    description:
      "Inicia sesión de forma segura en el navegador. La aplicación utilizará automáticamente una sesión existente.",
    openBrowser: "Iniciar sesión en el navegador",
    waiting:
      "El navegador está abierto. Completa el inicio de sesión para volver automáticamente a la aplicación.",
    failed:
      "El inicio de sesión no se completó o caducó. Inténtalo de nuevo desde la aplicación y comprueba que el navegador puede acceder a LinkSense.",
    authorizing: "Iniciando sesión en la aplicación",
    authorizeDescription:
      "Se está utilizando tu sesión del navegador. Volverás automáticamente a la aplicación LinkSense.",
    invalid:
      "La solicitud de inicio de sesión no es válida. Vuelve a iniciarla desde la aplicación LinkSense.",
    returnToApp: "Volver a la aplicación",
    browserConfirmed:
      "Tu sesión del navegador está lista. Si LinkSense no se abre automáticamente, usa el botón de abajo.",
  },
  "pt-BR": {
    title: "Entrar no LinkSense",
    description:
      "Entre com segurança pelo navegador. Uma sessão existente será usada automaticamente no aplicativo.",
    openBrowser: "Entrar pelo navegador",
    waiting:
      "O navegador foi aberto. Conclua o login para voltar automaticamente ao aplicativo.",
    failed:
      "O login não foi concluído ou expirou. Tente novamente pelo aplicativo e verifique se o navegador consegue acessar o LinkSense.",
    authorizing: "Entrando no aplicativo",
    authorizeDescription:
      "Usando sua sessão atual do navegador. Você voltará automaticamente ao aplicativo LinkSense.",
    invalid:
      "Esta solicitação de login é inválida. Inicie novamente pelo aplicativo LinkSense.",
    returnToApp: "Voltar ao aplicativo",
    browserConfirmed:
      "Sua sessão no navegador está pronta. Se o LinkSense não abrir automaticamente, use o botão abaixo.",
  },
  "fr-FR": {
    title: "Se connecter à LinkSense",
    description:
      "Connectez-vous en toute sécurité dans votre navigateur. Une session existante sera automatiquement utilisée pour l’application.",
    openBrowser: "Se connecter dans le navigateur",
    waiting:
      "Le navigateur est ouvert. Terminez la connexion pour revenir automatiquement à l’application.",
    failed:
      "La connexion a échoué ou a expiré. Réessayez depuis l’application et vérifiez que votre navigateur peut accéder à LinkSense.",
    authorizing: "Connexion à l’application",
    authorizeDescription:
      "Votre session de navigateur est utilisée. Vous reviendrez automatiquement dans l’application LinkSense.",
    invalid:
      "Cette demande de connexion est invalide. Relancez-la depuis l’application LinkSense.",
    returnToApp: "Revenir à l’application",
    browserConfirmed:
      "Votre session est prête. Si LinkSense ne s’ouvre pas automatiquement, utilisez le bouton ci-dessous.",
  },
  "ja-JP": {
    title: "LinkSense にログイン",
    description:
      "ブラウザーで安全にログインします。既存のログインセッションはアプリでも自動的に使用されます。",
    openBrowser: "ブラウザーでログイン",
    waiting:
      "ブラウザーを開きました。ログインを完了すると、自動的にアプリに戻ります。",
    failed:
      "ログインが完了しなかったか、有効期限が切れました。ブラウザーから LinkSense に接続できることを確認し、アプリから再試行してください。",
    authorizing: "アプリにログインしています",
    authorizeDescription:
      "現在のブラウザーセッションを使用しています。完了すると LinkSense アプリに自動的に戻ります。",
    invalid:
      "ログインリクエストが無効です。LinkSense アプリからもう一度ログインしてください。",
    returnToApp: "アプリに戻る",
    browserConfirmed:
      "ブラウザーでのログインを確認しました。LinkSense が自動で開かない場合は、下のボタンを押してください。",
  },
}
