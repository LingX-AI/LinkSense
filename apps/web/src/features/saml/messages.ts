export const samlzhCN = {
  title: "企业统一登录（SAML 2.0）",
  description:
    "连接组织的 SAML 身份平台。请从本系统发起登录；新账号需要管理员启用。",
  enabled: "启用 SAML 企业登录",
  idpEntityId: "身份平台标识（Entity ID）",
  idpSsoUrl: "身份平台登录地址",
  idpCertificate: "身份平台签名证书（PEM）",
  emailAttribute: "邮箱属性名称",
  nameAttribute: "姓名属性名称（可选）",
  attributeHelp:
    "填写身份平台发送的属性名称；若以用户标识作为邮箱，请填写 NameID。邮箱须由组织管理并确保准确。",
  signRequests: "签名登录请求",
  signingCertificate: "本系统签名证书（PEM）",
  signingKey: "本系统签名私钥（PEM）",
  signingHelp:
    "填写与证书匹配的 RSA 私钥；已保存的私钥不会显示。关闭请求签名并保存后，将移除本系统的签名证书和私钥。",
  spEntityId: "本系统标识（Entity ID）",
  acsUrl: "登录回调地址（ACS）",
  metadata: "下载接入配置（XML）",
  metadataHelp:
    "将本系统标识和回调地址登记到身份平台，或保存并启用后下载接入配置。身份平台必须签名登录断言。",
  httpsRequired: "请先为站点配置 HTTPS，再启用 SAML 登录。",
  login: "使用 SAML 企业账号登录",
  retry: "重新加载企业登录方式",
}

export const samlenUS = {
  title: "Enterprise SSO (SAML 2.0)",
  description:
    "Connect your organization’s SAML identity provider. Start sign-in from this application; new accounts require administrator activation.",
  enabled: "Enable SAML sign-in",
  idpEntityId: "Identity provider entity ID",
  idpSsoUrl: "Identity provider sign-in URL",
  idpCertificate: "Identity provider signing certificate (PEM)",
  emailAttribute: "Email attribute name",
  nameAttribute: "Name attribute (optional)",
  attributeHelp:
    "Enter the attribute names sent by your identity provider. Use NameID if the user identifier is the email address. Email addresses must be accurate and managed by your organization.",
  signRequests: "Sign authentication requests",
  signingCertificate: "Service provider signing certificate (PEM)",
  signingKey: "Service provider signing private key (PEM)",
  signingHelp:
    "Use the RSA private key matching the certificate. Saved keys are never displayed. Saving with request signing off removes the service provider certificate and private key.",
  spEntityId: "Service provider entity ID",
  acsUrl: "Assertion consumer URL (ACS)",
  metadata: "Download metadata (XML)",
  metadataHelp:
    "Register this entity ID and callback URL with your identity provider, or save and enable SAML to download metadata. The identity provider must sign assertions.",
  httpsRequired: "Configure HTTPS for this site before enabling SAML sign-in.",
  login: "Sign in with a SAML enterprise account",
  retry: "Reload enterprise sign-in methods",
} satisfies typeof samlzhCN

export const samljaJP = {
  title: "組織のシングルサインオン（SAML 2.0）",
  description:
    "組織の SAML 認証サービスに接続します。このシステムからログインを開始してください。新規アカウントは管理者による有効化が必要です。",
  enabled: "SAML ログインを有効にする",
  idpEntityId: "認証サービスの識別子（Entity ID）",
  idpSsoUrl: "認証サービスのログイン URL",
  idpCertificate: "認証サービスの署名証明書（PEM）",
  emailAttribute: "メール属性名",
  nameAttribute: "名前属性（任意）",
  attributeHelp:
    "認証サービスが送信する属性名を入力してください。ユーザー識別子をメールとして使う場合は NameID を指定します。メールは組織が正確に管理する必要があります。",
  signRequests: "認証要求に署名する",
  signingCertificate: "本システムの署名証明書（PEM）",
  signingKey: "本システムの署名秘密鍵（PEM）",
  signingHelp:
    "証明書に対応する RSA 秘密鍵を入力します。保存済みの鍵は表示されません。署名を無効にして保存すると証明書と秘密鍵が削除されます。",
  spEntityId: "本システムの識別子（Entity ID）",
  acsUrl: "ログイン応答 URL（ACS）",
  metadata: "接続設定をダウンロード（XML）",
  metadataHelp:
    "識別子と応答 URL を認証サービスに登録するか、保存して有効にした後に設定をダウンロードしてください。アサーションへの署名が必要です。",
  httpsRequired: "SAML ログインを有効にする前に HTTPS を設定してください。",
  login: "SAML 組織アカウントでログイン",
  retry: "組織のログイン方法を再読み込み",
} satisfies typeof samlzhCN

export const samlptBR = {
  title: "SSO corporativo (SAML 2.0)",
  description:
    "Conecte o provedor SAML da organização. Inicie o acesso neste sistema; novas contas precisam ser ativadas por um administrador.",
  enabled: "Ativar acesso SAML",
  idpEntityId: "Identificador do provedor (Entity ID)",
  idpSsoUrl: "URL de acesso do provedor",
  idpCertificate: "Certificado de assinatura do provedor (PEM)",
  emailAttribute: "Nome do atributo de e-mail",
  nameAttribute: "Atributo de nome (opcional)",
  attributeHelp:
    "Informe os atributos enviados pelo provedor. Use NameID se o identificador for o e-mail. Os endereços devem ser corretos e gerenciados pela organização.",
  signRequests: "Assinar solicitações de autenticação",
  signingCertificate: "Certificado de assinatura do sistema (PEM)",
  signingKey: "Chave privada de assinatura do sistema (PEM)",
  signingHelp:
    "Use a chave RSA correspondente ao certificado. Chaves salvas nunca são exibidas. Salvar com a assinatura desativada remove o certificado e a chave privada.",
  spEntityId: "Identificador do sistema (Entity ID)",
  acsUrl: "URL de retorno (ACS)",
  metadata: "Baixar metadados (XML)",
  metadataHelp:
    "Registre o identificador e a URL de retorno no provedor ou salve e ative o SAML para baixar os metadados. O provedor deve assinar as asserções.",
  httpsRequired: "Configure HTTPS antes de ativar o acesso SAML.",
  login: "Entrar com uma conta corporativa SAML",
  retry: "Recarregar métodos de acesso corporativo",
} satisfies typeof samlzhCN

export const samlesES = {
  title: "Inicio de sesión empresarial (SAML 2.0)",
  description:
    "Conecta el proveedor SAML de la organización. Inicia el acceso desde este sistema; las cuentas nuevas requieren activación del administrador.",
  enabled: "Activar acceso SAML",
  idpEntityId: "Identificador del proveedor (Entity ID)",
  idpSsoUrl: "URL de acceso del proveedor",
  idpCertificate: "Certificado de firma del proveedor (PEM)",
  emailAttribute: "Nombre del atributo de correo",
  nameAttribute: "Atributo de nombre (opcional)",
  attributeHelp:
    "Introduce los atributos enviados por el proveedor. Usa NameID si el identificador es el correo. La organización debe gestionar direcciones correctas.",
  signRequests: "Firmar solicitudes de autenticación",
  signingCertificate: "Certificado de firma del sistema (PEM)",
  signingKey: "Clave privada de firma del sistema (PEM)",
  signingHelp:
    "Usa la clave RSA que corresponda al certificado. Las claves guardadas no se muestran. Guardar con la firma desactivada elimina el certificado y la clave privada.",
  spEntityId: "Identificador del sistema (Entity ID)",
  acsUrl: "URL de retorno (ACS)",
  metadata: "Descargar metadatos (XML)",
  metadataHelp:
    "Registra el identificador y la URL de retorno en el proveedor, o guarda y activa SAML para descargar los metadatos. El proveedor debe firmar las aserciones.",
  httpsRequired: "Configura HTTPS antes de activar el acceso SAML.",
  login: "Acceder con una cuenta empresarial SAML",
  retry: "Volver a cargar métodos de acceso empresarial",
} satisfies typeof samlzhCN

export const samlfrFR = {
  title: "Authentification d’entreprise (SAML 2.0)",
  description:
    "Connectez le fournisseur SAML de votre organisation. Lancez la connexion depuis ce système ; les nouveaux comptes nécessitent l’activation par un administrateur.",
  enabled: "Activer la connexion SAML",
  idpEntityId: "Identifiant du fournisseur (Entity ID)",
  idpSsoUrl: "URL de connexion du fournisseur",
  idpCertificate: "Certificat de signature du fournisseur (PEM)",
  emailAttribute: "Nom de l’attribut e-mail",
  nameAttribute: "Attribut du nom (facultatif)",
  attributeHelp:
    "Indiquez les attributs envoyés par le fournisseur. Utilisez NameID si l’identifiant correspond à l’e-mail. Les adresses doivent être exactes et gérées par votre organisation.",
  signRequests: "Signer les demandes d’authentification",
  signingCertificate: "Certificat de signature du système (PEM)",
  signingKey: "Clé privée de signature du système (PEM)",
  signingHelp:
    "Utilisez la clé RSA correspondant au certificat. Les clés enregistrées ne sont jamais affichées. Enregistrer avec la signature désactivée supprime le certificat et la clé privée.",
  spEntityId: "Identifiant du système (Entity ID)",
  acsUrl: "URL de retour (ACS)",
  metadata: "Télécharger les métadonnées (XML)",
  metadataHelp:
    "Enregistrez cet identifiant et cette URL auprès du fournisseur, ou enregistrez et activez SAML pour télécharger les métadonnées. Le fournisseur doit signer les assertions.",
  httpsRequired: "Configurez HTTPS avant d’activer la connexion SAML.",
  login: "Se connecter avec un compte d’entreprise SAML",
  retry: "Recharger les modes de connexion d’entreprise",
} satisfies typeof samlzhCN
