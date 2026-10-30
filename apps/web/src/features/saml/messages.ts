export const samlzhCN = {
  title: "企业统一登录（SAML 2.0）",
  description:
    "连接组织的 SAML 身份平台。请从本系统发起登录；新账号需要管理员启用。",
  enabled: "启用 SAML 企业登录",
  enabledHelp:
    "完成身份平台与本系统的配置后启用并保存，登录页将显示 SAML 企业登录入口。",
  idpEntityId: "身份平台标识（Entity ID）",
  idpEntityIdHelp:
    "填写身份平台为此 SAML 应用提供的唯一标识（Entity ID），可从其接入配置或元数据中复制。",
  idpSsoUrl: "身份平台登录地址",
  idpSsoUrlHelp:
    "填写身份平台提供的单点登录服务地址（SSO URL），须使用 HTTPS；用户将跳转到此处完成身份验证。",
  idpCertificate: "身份平台签名证书（PEM）",
  idpCertificateHelp:
    "粘贴身份平台用于签名登录信息的完整公共证书，包含 BEGIN CERTIFICATE 和 END CERTIFICATE 标记。",
  emailAttribute: "邮箱属性名称",
  nameAttribute: "姓名属性名称（可选）",
  attributeHelp:
    "填写身份平台发送的属性名称；若以用户标识作为邮箱，请填写 NameID。邮箱须由组织管理并确保准确。",
  signRequests: "签名登录请求",
  signRequestsHelp:
    "身份平台要求验证登录请求的签名时启用；启用后须填写本系统的签名证书和私钥。",
  signingCertificate: "本系统签名证书（PEM）",
  signingCertificateHelp:
    "粘贴本系统用于签名登录请求的完整 PEM 公共证书，并将同一证书登记到身份平台。",
  signingKey: "本系统签名私钥（PEM）",
  signingHelp:
    "填写与证书匹配的 RSA 私钥；已保存的私钥不会显示。关闭请求签名并保存后，将移除本系统的签名证书和私钥。",
  spEntityId: "本系统标识（Entity ID）",
  spEntityIdHelp:
    "将此固定值填写到身份平台的服务提供方标识（Entity ID）中；此处不可修改。",
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
  enabledHelp:
    "After configuring the identity provider and this system, enable and save to show SAML sign-in on the login page.",
  idpEntityId: "Identity provider entity ID",
  idpEntityIdHelp:
    "Enter the unique entity ID supplied by the identity provider for this SAML application. Copy it from the provider’s setup details or metadata.",
  idpSsoUrl: "Identity provider sign-in URL",
  idpSsoUrlHelp:
    "Enter the provider’s single sign-on service URL (SSO URL) using HTTPS. Users are sent here to verify their identity.",
  idpCertificate: "Identity provider signing certificate (PEM)",
  idpCertificateHelp:
    "Paste the provider’s full public certificate used to sign sign-in data, including the BEGIN CERTIFICATE and END CERTIFICATE markers.",
  emailAttribute: "Email attribute name",
  nameAttribute: "Name attribute (optional)",
  attributeHelp:
    "Enter the attribute names sent by your identity provider. Use NameID if the user identifier is the email address. Email addresses must be accurate and managed by your organization.",
  signRequests: "Sign authentication requests",
  signRequestsHelp:
    "Enable when the identity provider requires signed sign-in requests. You must then supply this system’s signing certificate and private key.",
  signingCertificate: "Service provider signing certificate (PEM)",
  signingCertificateHelp:
    "Paste this system’s full PEM public certificate for signing sign-in requests, and register the same certificate with the identity provider.",
  signingKey: "Service provider signing private key (PEM)",
  signingHelp:
    "Use the RSA private key matching the certificate. Saved keys are never displayed. Saving with request signing off removes the service provider certificate and private key.",
  spEntityId: "Service provider entity ID",
  spEntityIdHelp:
    "Register this fixed value as the service provider entity ID in your identity provider. It cannot be changed here.",
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
  enabledHelp:
    "認証サービスと本システムの設定を完了し、有効にして保存すると、ログイン画面に SAML ログインの入口が表示されます。",
  idpEntityId: "認証サービスの識別子（Entity ID）",
  idpEntityIdHelp:
    "認証サービスがこの SAML アプリに指定した一意の識別子（Entity ID）を入力します。接続設定やメタデータからコピーできます。",
  idpSsoUrl: "認証サービスのログイン URL",
  idpSsoUrlHelp:
    "認証サービスのシングルサインオン URL（SSO URL）を HTTPS で入力します。ユーザーはこの URL で本人確認を行います。",
  idpCertificate: "認証サービスの署名証明書（PEM）",
  idpCertificateHelp:
    "認証サービスがログイン情報への署名に使う公開証明書を、BEGIN CERTIFICATE と END CERTIFICATE の行を含めて貼り付けてください。",
  emailAttribute: "メール属性名",
  nameAttribute: "名前属性（任意）",
  attributeHelp:
    "認証サービスが送信する属性名を入力してください。ユーザー識別子をメールとして使う場合は NameID を指定します。メールは組織が正確に管理する必要があります。",
  signRequests: "認証要求に署名する",
  signRequestsHelp:
    "認証サービスがログイン要求への署名を求める場合に有効にします。本システムの署名証明書と秘密鍵が必要です。",
  signingCertificate: "本システムの署名証明書（PEM）",
  signingCertificateHelp:
    "本システムがログイン要求への署名に使う PEM 公開証明書を全文貼り付け、同じ証明書を認証サービスにも登録してください。",
  signingKey: "本システムの署名秘密鍵（PEM）",
  signingHelp:
    "証明書に対応する RSA 秘密鍵を入力します。保存済みの鍵は表示されません。署名を無効にして保存すると証明書と秘密鍵が削除されます。",
  spEntityId: "本システムの識別子（Entity ID）",
  spEntityIdHelp:
    "この固定値を認証サービス側のサービス提供者識別子（Entity ID）として登録してください。ここでは変更できません。",
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
  enabledHelp:
    "Após configurar o provedor de identidade e este sistema, ative e salve para exibir o acesso SAML na página de login.",
  idpEntityId: "Identificador do provedor (Entity ID)",
  idpEntityIdHelp:
    "Informe o identificador único fornecido pelo provedor para este aplicativo SAML. Copie-o das configurações de integração ou dos metadados do provedor.",
  idpSsoUrl: "URL de acesso do provedor",
  idpSsoUrlHelp:
    "Informe a URL do serviço de acesso único do provedor (SSO URL) usando HTTPS. Os usuários serão enviados a ela para verificar sua identidade.",
  idpCertificate: "Certificado de assinatura do provedor (PEM)",
  idpCertificateHelp:
    "Cole o certificado público completo usado pelo provedor para assinar os dados de acesso, incluindo os marcadores BEGIN CERTIFICATE e END CERTIFICATE.",
  emailAttribute: "Nome do atributo de e-mail",
  nameAttribute: "Atributo de nome (opcional)",
  attributeHelp:
    "Informe os atributos enviados pelo provedor. Use NameID se o identificador for o e-mail. Os endereços devem ser corretos e gerenciados pela organização.",
  signRequests: "Assinar solicitações de autenticação",
  signRequestsHelp:
    "Ative quando o provedor exigir solicitações de acesso assinadas. Será necessário informar o certificado de assinatura e a chave privada deste sistema.",
  signingCertificate: "Certificado de assinatura do sistema (PEM)",
  signingCertificateHelp:
    "Cole o certificado público PEM completo usado por este sistema para assinar solicitações de acesso e registre o mesmo certificado no provedor.",
  signingKey: "Chave privada de assinatura do sistema (PEM)",
  signingHelp:
    "Use a chave RSA correspondente ao certificado. Chaves salvas nunca são exibidas. Salvar com a assinatura desativada remove o certificado e a chave privada.",
  spEntityId: "Identificador do sistema (Entity ID)",
  spEntityIdHelp:
    "Registre este valor fixo como identificador do provedor de serviço (Entity ID) no provedor de identidade. Ele não pode ser alterado aqui.",
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
  enabledHelp:
    "Tras configurar el proveedor de identidad y este sistema, activa y guarda para mostrar el acceso SAML en la página de inicio de sesión.",
  idpEntityId: "Identificador del proveedor (Entity ID)",
  idpEntityIdHelp:
    "Introduce el identificador único que el proveedor proporciona para esta aplicación SAML. Cópialo de su configuración de integración o de sus metadatos.",
  idpSsoUrl: "URL de acceso del proveedor",
  idpSsoUrlHelp:
    "Introduce la URL del servicio de inicio de sesión único del proveedor (SSO URL) mediante HTTPS. Los usuarios accederán a ella para verificar su identidad.",
  idpCertificate: "Certificado de firma del proveedor (PEM)",
  idpCertificateHelp:
    "Pega el certificado público completo que el proveedor usa para firmar los datos de acceso, incluidos los marcadores BEGIN CERTIFICATE y END CERTIFICATE.",
  emailAttribute: "Nombre del atributo de correo",
  nameAttribute: "Atributo de nombre (opcional)",
  attributeHelp:
    "Introduce los atributos enviados por el proveedor. Usa NameID si el identificador es el correo. La organización debe gestionar direcciones correctas.",
  signRequests: "Firmar solicitudes de autenticación",
  signRequestsHelp:
    "Activa esta opción cuando el proveedor exija solicitudes de acceso firmadas. Deberás indicar el certificado de firma y la clave privada de este sistema.",
  signingCertificate: "Certificado de firma del sistema (PEM)",
  signingCertificateHelp:
    "Pega el certificado público PEM completo de este sistema para firmar las solicitudes de acceso y registra el mismo certificado en el proveedor.",
  signingKey: "Clave privada de firma del sistema (PEM)",
  signingHelp:
    "Usa la clave RSA que corresponda al certificado. Las claves guardadas no se muestran. Guardar con la firma desactivada elimina el certificado y la clave privada.",
  spEntityId: "Identificador del sistema (Entity ID)",
  spEntityIdHelp:
    "Registra este valor fijo como identificador del proveedor de servicios (Entity ID) en el proveedor de identidad. No se puede cambiar aquí.",
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
  enabledHelp:
    "Après avoir configuré le fournisseur d’identité et ce système, activez et enregistrez pour afficher la connexion SAML sur la page de connexion.",
  idpEntityId: "Identifiant du fournisseur (Entity ID)",
  idpEntityIdHelp:
    "Saisissez l’identifiant unique fourni pour cette application SAML. Copiez-le depuis les paramètres d’intégration ou les métadonnées du fournisseur.",
  idpSsoUrl: "URL de connexion du fournisseur",
  idpSsoUrlHelp:
    "Saisissez l’URL du service de connexion unique du fournisseur (SSO URL) en HTTPS. Les utilisateurs y seront dirigés pour vérifier leur identité.",
  idpCertificate: "Certificat de signature du fournisseur (PEM)",
  idpCertificateHelp:
    "Collez le certificat public complet utilisé par le fournisseur pour signer les données de connexion, y compris les marqueurs BEGIN CERTIFICATE et END CERTIFICATE.",
  emailAttribute: "Nom de l’attribut e-mail",
  nameAttribute: "Attribut du nom (facultatif)",
  attributeHelp:
    "Indiquez les attributs envoyés par le fournisseur. Utilisez NameID si l’identifiant correspond à l’e-mail. Les adresses doivent être exactes et gérées par votre organisation.",
  signRequests: "Signer les demandes d’authentification",
  signRequestsHelp:
    "Activez cette option si le fournisseur exige des demandes de connexion signées. Vous devrez fournir le certificat de signature et la clé privée de ce système.",
  signingCertificate: "Certificat de signature du système (PEM)",
  signingCertificateHelp:
    "Collez le certificat public PEM complet utilisé par ce système pour signer les demandes de connexion, et enregistrez le même certificat auprès du fournisseur.",
  signingKey: "Clé privée de signature du système (PEM)",
  signingHelp:
    "Utilisez la clé RSA correspondant au certificat. Les clés enregistrées ne sont jamais affichées. Enregistrer avec la signature désactivée supprime le certificat et la clé privée.",
  spEntityId: "Identifiant du système (Entity ID)",
  spEntityIdHelp:
    "Enregistrez cette valeur fixe comme identifiant du fournisseur de services (Entity ID) auprès du fournisseur d’identité. Elle ne peut pas être modifiée ici.",
  acsUrl: "URL de retour (ACS)",
  metadata: "Télécharger les métadonnées (XML)",
  metadataHelp:
    "Enregistrez cet identifiant et cette URL auprès du fournisseur, ou enregistrez et activez SAML pour télécharger les métadonnées. Le fournisseur doit signer les assertions.",
  httpsRequired: "Configurez HTTPS avant d’activer la connexion SAML.",
  login: "Se connecter avec un compte d’entreprise SAML",
  retry: "Recharger les modes de connexion d’entreprise",
} satisfies typeof samlzhCN
