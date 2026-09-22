export const channelResources = {
  botChannels: {
    connectionError:
      "Vérifiez les identifiants de l’application, les autorisations de messagerie et le réseau, puis réessayez.",
    connect: "Connecter",
    disconnect: "Déconnecter {{name}}",
    settings: "Voir la configuration",
    setupTitle: "Connecter {{name}}",
    save: "Enregistrer la configuration",
    cancel: "Annuler",
    confirmDisconnect: "Déconnecter",
    retry: "Réessayer",
    account: "Compte de l’application ou du bot",
    botId: "Identifiant du bot",
    clientId: "Identifiant client de l’application",
    secret: "Secret de l’application",
    tenantId: "Identifiant du locataire",
    sender: "Identifiant du membre autorisé",
    groups:
      "Autoriser ce membre à démarrer des tâches en mentionnant le bot dans les groupes",
    callback: "Point d’accès de messagerie",
    callbackHelp:
      "Définissez cette URL comme point d’accès de messagerie Azure Bot. Elle doit être accessible publiquement en HTTPS.",
    replaceHelp:
      "Pour remplacer l’application ou le secret, déconnectez le canal puis configurez-le à nouveau.",
    disconnectHelp:
      "La déconnexion arrête la réception et l’envoi de messages par ce canal et supprime les messages et réponses en attente. Les tâches LinkSense existantes sont conservées.",
    invalid:
      "Vérifiez tous les champs obligatoires. Les identifiants d’application, de locataire et de membre Teams doivent être des UUID valides.",
    status: {
      connecting: "Connexion en cours",
      online: "En ligne",
      waiting_message: "En attente d’un message",
      error: "Erreur de connexion",
      disconnected: "Non connecté",
    },
    description: {
      wecom:
        "Recevez les messages directs et les mentions dans les groupes via un bot intelligent WeCom.",
      dingtalk:
        "Recevez les messages directs et les mentions dans les groupes via un bot d’application DingTalk.",
      teams:
        "Recevez les messages directs et les mentions dans les groupes via un bot Teams.",
    },
    setup: {
      wecom:
        "Créez un bot intelligent WeCom en mode API avec une connexion persistante, puis saisissez son identifiant, son secret et le membre autorisé.",
      dingtalk:
        "Créez une application interne sur la plateforme développeur DingTalk, activez et publiez son bot Stream, puis accordez les autorisations de messagerie directe et de groupe.",
      teams:
        "Créez un Azure Bot à locataire unique et activez Microsoft Teams. Après enregistrement, configurez son point d’accès de messagerie dans Azure et installez l’application du bot dans Teams.",
    },
    senderHelp: {
      wecom:
        "Saisissez le userid du membre figurant dans l’annuaire WeCom. Seul ce membre pourra utiliser votre assistant LinkSense.",
      dingtalk:
        "Saisissez le UserId du membre de votre organisation DingTalk. Seul ce membre pourra utiliser votre assistant LinkSense.",
      teams:
        "Saisissez l’identifiant d’objet de l’utilisateur dans Microsoft Entra. Seul cet utilisateur pourra utiliser votre assistant LinkSense.",
    },
  },
  channelAccess: {
    title: "Canaux de messagerie",
    description:
      "Connectez et gérez Weixin, WeCom, DingTalk, Teams, Feishu et les autres canaux de messagerie. L’assistant LinkSense traite les messages par défaut.",
    channelsLabel: "Canaux disponibles",
    weixin: {
      name: "Weixin",
      description:
        "Recevez des messages via une connexion Weixin personnelle et transmettez-les à l’assistant LinkSense.",
      notConnected: "Aucun compte Weixin connecté",
      accountConnected: "Compte connecté : {{account}}",
      scopeValue: "Compte ayant scanné uniquement · Texte et voix transcrite",
      iconLabel: "Icône Weixin",
      connect: "Connecter",
      reconnect: "Reconnecter",
      disconnect: "Déconnecter",
      successDescription: "Weixin est connecté à LinkSense.",
      connectedNotice: "Weixin connecté",
      disconnectedNotice: "Weixin déconnecté",
      loginTitle: "Connecter Weixin",
      loginDescription:
        "Scannez et confirmez avec Weixin sur votre téléphone. LinkSense traite uniquement les messages du compte ayant scanné.",
      generatingQr: "Génération d’un code QR Weixin",
      qrCodeLabel: "Code QR de connexion Weixin",
      verificationLabel: "Code d’association affiché dans Weixin",
      submitVerification: "Envoyer le code d’association",
      generateAgain: "Générer à nouveau",
      finish: "Terminé",
      disconnectTitle: "Déconnecter Weixin ?",
      disconnectDescription:
        "LinkSense cessera de recevoir les messages Weixin et d’y répondre. Les tâches LinkSense existantes seront conservées.",
    },
    wecom: {
      name: "WeCom",
      description:
        "Recevez les messages des membres ou des clients dans WeCom et transmettez-les à l’assistant LinkSense.",
    },
    dingtalk: {
      name: "DingTalk",
      description:
        "Recevez les messages de l’organisation et les notifications de collaboration dans DingTalk et transmettez-les à l’assistant LinkSense.",
    },
    teams: {
      name: "Microsoft Teams",
      description:
        "Recevez les messages personnels ou d’équipe dans Teams et transmettez-les à l’assistant LinkSense.",
      scopeValue: "Conversations et messages de canaux Teams",
    },
    feishu: {
      name: "Feishu",
      description:
        "Recevez des messages via un bot Feishu et transmettez-les à l’assistant LinkSense.",
      notConnected: "Aucun bot Feishu personnel créé",
      scopeValue: "Propriétaire uniquement · Messages texte directs",
      iconLabel: "Icône Feishu",
      connect: "Connecter",
      reconnect: "Actualiser l’accès",
      disconnect: "Déconnecter",
      successDescription:
        "Les identifiants du bot sont enregistrés de façon sécurisée. La connexion de messagerie est en cours d’établissement.",
      botCreated:
        "Le bot « {{bot}} » a été créé. La connexion de messagerie est en cours d’établissement",
      appUpdated:
        "L’accès de l’application Feishu a été actualisé. La connexion de messagerie est en cours d’établissement.",
      connectedNotice: "Bot Feishu créé",
      updatedNotice: "Accès de l’application Feishu actualisé",
      pendingApprovalNotice:
        "L’application Feishu a été créée et attend l’approbation d’un administrateur",
      pendingApprovalUpdatedNotice:
        "L’application Feishu a été mise à jour et attend l’approbation d’un administrateur",
      pendingApprovalDescription:
        "Vous n’avez pas besoin de scanner à nouveau. LinkSense se connectera automatiquement après l’approbation de l’application par un administrateur.",
      disconnectedNotice: "Feishu déconnecté",
      registrationTitle: "Créer un bot Feishu personnel",
      registrationDescription:
        "Scannez avec Feishu et autorisez l’accès. LinkSense crée un bot officiel et conserve ses identifiants en sécurité, sans configuration dans la console développeur.",
      reauthorizationTitle: "Actualiser l’accès du bot Feishu",
      reauthorizationDescription:
        "Scannez avec Feishu et autorisez les accès de messagerie supplémentaires. LinkSense met à jour le bot existant et configure sa connexion de messagerie sans créer de doublon.",
      generatingQr: "Demande d’un code QR de création à Feishu",
      qrCodeLabel: "Code QR de création du bot Feishu",
      generateAgain: "Générer à nouveau",
      recoverExisting: "Connecter le bot créé",
      createWhenMissing: "Application supprimée ? Créer une application",
      finish: "Terminé",
      disconnectTitle: "Déconnecter Feishu ?",
      disconnectDescription:
        "LinkSense cessera de recevoir les messages Feishu et d’y répondre. Le bot officiel et les tâches LinkSense existantes seront conservés.",
      registrationStatus: {
        generating_qr: "Génération d’un code QR",
        waiting_scan: "Scannez avec Feishu et autorisez l’accès",
        pending_approval: "Application créée, en attente d’approbation",
        pending_approval_update:
          "Application mise à jour, en attente d’approbation",
        connected: "Bot créé",
        updated: "Application Feishu mise à jour",
        expired: "Le code QR a expiré",
        failed:
          "Le bot existe peut-être déjà, mais sa connexion n’a pas été finalisée. Scannez à nouveau et sélectionnez le bot que vous venez de créer",
        update_failed:
          "La mise à jour de l’application Feishu n’a pas abouti. Scannez à nouveau pour réessayer",
      },
    },
    scopeLabel: "Périmètre des messages",
    entryLabel: "Méthode d’accès",
    weixinEntryValue: "Connexion par code QR",
    upcomingEntryValue: "En attente de disponibilité",
    unavailableAction: "Pas encore disponible",
    status: {
      available: "Disponible",
      comingSoon: "Bientôt disponible",
      online: "En ligne",
      connecting: "Connexion en cours",
      pending_approval: "En attente de l’approbation d’un administrateur",
      error: "Erreur de connexion",
      reauthorization_required: "Reconnexion requise",
    },
    loginStatus: {
      waiting_scan: "En attente du scan du code QR",
      scanned: "Code scanné. Confirmez la connexion dans Weixin",
      verification_required:
        "Saisissez le code d’association affiché dans Weixin",
      connected: "Connecté",
      expired: "Le code QR a expiré",
      failed: "La connexion n’a pas abouti. Générez un nouveau code QR",
    },
  },
  mcp: {
    title: "Serveurs MCP",
    description:
      "Connectez et gérez vos serveurs MCP personnels Streamable HTTP et STDIO. Chaque élément activé est automatiquement associé aux nouvelles tâches.",
    add: "Ajouter un serveur",
    empty: "Aucun serveur MCP personnel configuré",
    emptyDescription:
      "Ajoutez un point d’accès Streamable HTTP distant ou un serveur MCP STDIO hébergé dans le conteneur.",
    createTitle: "Connecter un MCP personnalisé",
    editTitle: "Modifier le serveur MCP",
    editorDescription:
      "MCP est indépendant des plugins. Les configurations activées sont automatiquement associées à vos nouvelles tâches.",
    transportLabel: "Type de connexion",
    transport: { streamable_http: "HTTP", stdio: "STDIO" },
    name: "Nom",
    url: "URL du serveur",
    urlHint:
      "Les points d’accès MCP Streamable HTTP en HTTP et HTTPS sont pris en charge.",
    stdioConfiguration: "Configuration STDIO (JSON)",
    stdioConfigurationHint:
      "Saisissez directement command, args et env, ou collez un objet JSON mcpServers contenant exactement un serveur. Les valeurs env sont chiffrées ; npx -y est converti de façon sécurisée en pnpm dlx géré dans le conteneur de la tâche.",
    stdioConfigurationEditHint:
      "Les valeurs env enregistrées ne sont jamais affichées. Omettez env pour les conserver, renseignez env pour les remplacer ou utilisez un objet vide pour les effacer.",
    stdioConfigurationInvalid:
      "Saisissez un JSON STDIO valide pour un seul serveur. command est obligatoire, args doit être un tableau de chaînes et env un objet de chaînes.",
    currentEnvironmentKeys: "Variables actuelles : {{keys}}",
    environmentCount: "{{count}} variables d’environnement",
    authentication: "Authentification",
    apiKeyHeader: "En-tête de clé API",
    credential: "Identifiant secret",
    credentialHint:
      "L’identifiant est chiffré au repos et ne sera plus affiché.",
    keepCredentialHint: "Laissez vide pour conserver l’identifiant actuel.",
    startupTimeout: "Délai de démarrage (secondes)",
    toolTimeout: "Délai des outils (secondes)",
    httpWarningTitle: "Les connexions HTTP ne sont pas sécurisées",
    httpWarningDescription:
      "Les jetons Bearer, les clés API, les arguments et les résultats des outils sont transmis sans chiffrement et peuvent être lus ou modifiés pendant leur transfert.",
    httpAcknowledgement:
      "Je comprends et accepte les risques liés au protocole HTTP non chiffré.",
    testConnection: "Tester la connexion",
    testing: "Test de {{name}}",
    testSucceeded:
      "Connexion à {{serverName}} réussie ; {{count}} outils trouvés.",
    testStatus: {
      succeeded: "Test réussi",
      failed: "Échec du test",
      untested: "Non testé",
    },
    testStatusLabel: "{{name}} : {{status}}",
    auth: {
      none: "Sans authentification",
      bearer: "Jeton Bearer",
      api_key: "Clé API",
    },
    toggle: "Activer ou désactiver {{name}}",
    saved: "Le serveur MCP a été enregistré.",
    deleted: "Le serveur MCP a été supprimé.",
    deleteTitle: "Supprimer ce serveur MCP ?",
    deleteDescription:
      "La configuration du serveur, l’identifiant chiffré et les variables d’environnement chiffrées seront définitivement supprimés. Les nouvelles tâches ne s’y connecteront plus.",
  },
} as const
