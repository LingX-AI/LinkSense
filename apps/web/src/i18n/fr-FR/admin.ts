export const admin = {
  usersAndGroupsTitle: "Utilisateurs et groupes",
  usersAndGroupsDescription:
    "Gérez les comptes, rôles, états, groupes et membres au même endroit.",
  usersAndGroupsTabsLabel: "Gestion des utilisateurs et groupes",
  usersTitle: "Utilisateurs",
  usersDescription:
    "Créez, importez et gérez les utilisateurs autorisés. Les administrateurs ne peuvent ni consulter ni réinitialiser leurs mots de passe.",
  rolesTitle: "Rôles et autorisations",
  rolesDescription:
    "Consultez les rôles fixes et les limites des autorisations pour les fonctionnalités actuelles de {{productName}}. Les autorisations concernent uniquement les comptes actifs ; attribuez les rôles dans la gestion des utilisateurs.",
  roleUserDescription:
    "Gère ses tâches, paramètres personnels, plugins, compétences et identifiants ; utilise le Centre de plugins ; crée et gère ses bases de connaissances ou utilise les bases partagées.",
  roleAdminDescription:
    "Un administrateur actif dispose des droits utilisateur et administre les utilisateurs et groupes, le Centre de plugins, les métadonnées et sources des bases, les modèles et tarifs, les paramètres système, l’état des services, l’audit et l’utilisation. Ce rôle seul ne donne pas accès au contenu des tâches ou bases des autres utilisateurs.",
  permissionMatrix: "Matrice des autorisations",
  permission: "Autorisation",
  roleAccountBreakdown: "Nombre de comptes par rôle",
  roleAccountCount: "{{count}} comptes",
  roleActiveAccountCount: "{{count}} actifs",
  roleDisabledAccountCount: "{{count}} désactivés",
  rolePermissions: {
    ownConversations: "Gérer ses propres tâches",
    personalSettings: "Gérer son profil, l’apparence et la sécurité",
    personalCapabilities: "Créer, importer et gérer ses plugins et compétences",
    usePluginCenter:
      "Parcourir, installer et mettre à jour les plugins, et soumettre des éléments à révision",
    personalCredentials: "Gérer ses identifiants personnels",
    personalKnowledgeBases: "Gérer ses bases et utiliser les bases partagées",
    manageUsersAndGroups: "Gérer les utilisateurs et groupes",
    governStoreCapabilities:
      "Examiner et administrer les éléments du Centre de plugins",
    governKnowledgeBases:
      "Administrer les métadonnées et le cycle de vie des bases sans accès automatique au contenu",
    manageKnowledgeSources:
      "Configurer les sources de connaissances et la synchronisation",
    manageModelsAndPricing:
      "Configurer les modèles de génération, d’analyse d’images, de vectorisation, de reclassement et les tarifs des jetons",
    manageSystemSettings:
      "Gérer les paramètres du produit et les fournisseurs de connexion",
    manageSystemHealth:
      "Consulter l’état du système et effectuer la maintenance des bases",
    viewAuditMetadata:
      "Consulter les métadonnées d’audit et de tâches expurgées des utilisateurs, sans leur contenu",
    viewUsageAnalytics:
      "Consulter l’utilisation et les coûts des modèles globalement, par groupe et par utilisateur",
  },
  createUser: "Créer un utilisateur",
  importUsers: "Importer Excel",
  role: "Rôle",
  registrationSource: "Origine de l’utilisateur",
  registrationSources: {
    selfRegistration: "Inscription autonome",
    organizationInvitation: "Invitation de l’organisation",
  },
  loginMethod: "Méthode de connexion",
  lastLogin: "Dernière connexion",
  weeklyCreditLimit: "Quota hebdomadaire (crédits)",
  creditLimitDisplay: "{{value}} crédits",
  creditQuotaRemainingFilter: "Quota restant",
  weeklyCreditQuotaRemainingZero: "Quota hebdomadaire restant nul",
  creditQuotaRemainingAmount: "{{value}} crédits restants ({{percentage}} %)",
  creditQuotaRemainingUnavailable: "Quota restant -",
  noCreditLimit: "Illimité",
  inheritCreditLimit: "Illimité",
  clearCreditLimit: "Laissez vide pour effacer le quota individuel",
  creditLimitHint:
    "Saisissez un nombre positif. Les décimales sont autorisées. Unité : crédits. Vide signifie aucun quota individuel.",
  creditLimitInputInvalid:
    "Saisissez un nombre supérieur à 0 avec au plus 6 décimales. Unité : crédits.",
  userCreditLimits: "Quotas de crédits individuels",
  userCreditLimitsDescription:
    "Le quota hebdomadaire est réinitialisé chaque lundi à minuit. Une fois épuisé, l’utilisateur ne peut plus démarrer de tâches. Les tâches en cours ne sont pas affectées.",
  adjustCreditLimits: "Ajuster le quota",
  adjustUserCreditLimits: "Ajuster le quota de {{name}}",
  singleCreditLimitsTitle: "Ajuster les quotas individuels",
  singleCreditLimitsDescription:
    "Modifiez le quota hebdomadaire de {{name}}. Laissez vide pour ne définir aucun quota individuel.",
  batchCreditLimits: "Définir le quota ({{count}})",
  batchCreditLimitsTitle: "Définir les quotas en lot",
  batchCreditLimitsDescription:
    "Définissez le quota hebdomadaire des {{count}} utilisateurs sélectionnés. Un champ vide efface leur quota individuel.",
  creditLimitFields: "Quota hebdomadaire",
  singleCreditLimitsSaved: "Quotas de {{name}} mis à jour.",
  creditLimitsSaved: "Quotas de {{count}} utilisateurs mis à jour.",
  selectVisibleUsers: "Sélectionner les utilisateurs de la liste actuelle",
  selectUser: "Sélectionner l’utilisateur {{name}}",
  groups: "Groupes d’utilisateurs",
  selectGroups: "Sélectionner des groupes",
  searchGroups: "Rechercher des groupes",
  groupSearchEmpty: "Aucun groupe correspondant.",
  removeGroup: "Retirer le groupe {{name}}",
  additionalGroups: "{{count}} groupes supplémentaires",
  userStatus: "État de l’utilisateur",
  usersEmpty: "Aucun utilisateur trouvé.",
  groupsTitle: "Groupes d’utilisateurs",
  groupsDescription: "Gérez les groupes non hiérarchiques et leurs membres.",
  createGroup: "Créer un groupe",
  members: "Membres",
  viewGroupMembers: "Voir les {{count}} membres de {{name}}",
  groupMembersTitle: "Membres de {{name}}",
  groupMembersDescription: "{{count}} membres",
  groupMembersEmpty: "Ce groupe n’a aucun membre.",
  memberListLabel: "Membres du groupe",
  loadMoreMembers: "Charger plus de membres",
  memberSelector: "Membres",
  selectMembers: "Sélectionner des membres",
  selectedMembers: "{{count}} membres sélectionnés",
  memberSearchPlaceholder: "Rechercher par nom ou e-mail",
  memberSearchEmpty: "Aucun membre correspondant.",
  groupsEmpty: "Aucun groupe.",
  auditTitle: "Journaux d’audit",
  auditDescription:
    "Seules les métadonnées interutilisateurs autorisées sont affichées. Le texte des tâches, le contenu des pièces jointes et les liens de téléchargement sont exclus.",
  action: "Action",
  actionCode: "Code d’action",
  actionSearchPlaceholder: "Rechercher ou sélectionner une action",
  actionSearchEmpty: "Aucune action correspondante.",
  actor: "Auteur",
  target: "Cible",
  targetTypeCode: "Code du type de cible",
  result: "Résultat",
  resultCode: "Code de résultat",
  sourceIp: "IP source",
  exportCreatedAt: "Date de création",
  exportActorId: "Identifiant de l’auteur",
  exportTargetType: "Type de cible",
  exportTargetId: "Identifiant de cible",
  exportMetadata: "Métadonnées",
  auditId: "Identifiant du journal",
  userAgent: "User-Agent",
  auditDetailsTitle: "Détails du journal d’audit",
  auditDetailsDescription:
    "Toutes les informations expurgées disponibles pour cette entrée figurent ci-dessous.",
  auditEventInformation: "Informations du journal",
  auditSubjectInformation: "Auteur et cible",
  auditRequestInformation: "Informations de la requête",
  auditMetadataTitle: "Métadonnées expurgées",
  auditMetadataEmpty: "Aucune métadonnée supplémentaire.",
  auditConversationDetailsTitle: "Détails d’exécution de la tâche",
  auditConversationDetailsDescription:
    "Toutes les métadonnées d’exécution expurgées disponibles pour cette tâche figurent ci-dessous.",
  retainedArtifactDetailsTitle: "Détails des fichiers d’une tâche supprimée",
  retainedArtifactDetailsDescription:
    "Toutes les informations récapitulatives disponibles sur les fichiers conservés indéfiniment de cette tâche supprimée figurent ci-dessous.",
  auditExecutionInformation: "Informations d’exécution",
  auditArtifactInformation: "Informations des fichiers produits",
  ownerId: "Identifiant du propriétaire",
  ownerName: "Nom du propriétaire",
  ownerEmail: "E-mail du propriétaire",
  executionDuration: "Durée d’exécution",
  executionErrorType: "Type d’erreur",
  attachmentCount: "Nombre de pièces jointes",
  attachmentSize: "Taille totale des pièces jointes",
  artifactCount: "Nombre de fichiers produits",
  artifactSize: "Taille totale des fichiers produits",
  firstArtifactCreatedAt: "Premier fichier créé",
  lastArtifactCreatedAt: "Dernier fichier créé",
  export: "Exporter en CSV",
  exporting: "Export…",
  auditEmpty: "Aucun enregistrement d’audit correspondant.",
  settingsTitle: "Paramètres système",
  managementTitle: "Gestion",
  settingsDescription:
    "Gérez l’affichage du produit, la simultanéité des tâches, les e-mails d’authentification et les méthodes de connexion. Les secrets sont chiffrés et ne sont jamais réaffichés.",
  settingsTabsLabel: "Catégories des paramètres système",
  settingsTabs: {
    product: "Paramètres du produit",
    concurrency: "Simultanéité des tâches",
    smtp: "E-mails d’authentification",
    registration: "Inscription ouverte",
    login: "Modes de connexion",
    maintenance: "Maintenance du système",
  },
  concurrency: {
    title: "Simultanéité des tâches",
    description:
      "Définissez le nombre de tâches simultanées dans le système et par utilisateur. Laissez vide pour utiliser la valeur par défaut du déploiement.",
    globalLimit: "Limite de tâches simultanées du système",
    globalLimitDescription:
      "Nombre maximal de tâches en cours pour tous les utilisateurs. Laissez vide pour la valeur par défaut {{defaultValue}} ; valeur effective actuelle : {{effectiveValue}}.",
    processLimit: "Limite de processus de tâche par utilisateur",
    processLimitDescription:
      "Nombre maximal de processus de tâche chargés par utilisateur. Laissez vide pour la valeur par défaut {{defaultValue}} ; valeur effective actuelle : {{effectiveValue}}.",
    loweringBehavior:
      "Réduire une limite n’arrête pas les tâches en cours. Les nouvelles tâches peuvent démarrer quand l’utilisation repasse sous la nouvelle limite.",
    saved: "Paramètres de simultanéité mis à jour.",
    errors: {
      positiveInteger:
        "Saisissez un entier supérieur à 0, ou laissez vide pour la valeur par défaut du déploiement.",
    },
  },
  registration: {
    enabled: "Autoriser l’inscription autonome",
    enabledDescription:
      "Une fois activée, une entrée d’inscription apparaît sur la page de connexion. La désactiver bloque les nouvelles demandes et les liens d’activation déjà envoyés.",
    saved: "Paramètres d’inscription ouverte mis à jour.",
  },
  systemName: "Nom d’affichage du système",
  systemLogo: "Logo du système",
  systemLogoDescription:
    "Utilisé sur la page de connexion, la barre latérale et la page de maintenance.",
  systemLogoHint:
    "PNG, JPEG, WebP ou GIF. Une image horizontale transparente de moins de 2 Mo est recommandée.",
  uploadSystemLogo: "Importer un logo",
  replaceSystemLogo: "Remplacer le logo",
  removeSystemLogo: "Rétablir le logo par défaut",
  deploymentStatus: "État de la configuration du déploiement",
  settingsSaved: "Paramètres système mis à jour.",
  systemLogoSaved: "Logo du système mis à jour.",
  systemLogoRemoved: "Logo par défaut rétabli.",
  maintenance: {
    title: "Maintenance du système",
    description:
      "Planifiez une maintenance globale. Pendant cette période, les utilisateurs ordinaires ne voient que la page de maintenance ; les administrateurs conservent l’accès.",
    enabled: "Activer la maintenance planifiée",
    enabledDescription:
      "La maintenance n’est active qu’entre les heures de début et de fin définies.",
    reason: "Motif de la maintenance",
    reasonPlaceholder:
      "Facultatif : expliquez le motif et les effets pour les utilisateurs…",
    duration: "Durée de maintenance",
    durationHint:
      "Choisissez ou saisissez une durée pour calculer la fin à partir du début. Vous pouvez toujours ajuster les deux horaires manuellement.",
    durationPresetsLabel: "Durées de maintenance prédéfinies",
    durationPresets: {
      "10m": "10 min",
      "30m": "30 min",
      "1h": "1 heure",
      "2h": "2 heures",
      "4h": "4 heures",
    },
    durationCustomPlaceholder: "Saisir manuellement",
    durationUnit: "Unité de durée",
    durationUnits: { minute: "minutes", hour: "heures" },
    startAt: "Début",
    endAt: "Fin",
    datePlaceholder: "Sélectionner une date",
    clearStartDate: "Effacer la date de début",
    clearEndDate: "Effacer la date de fin",
    startHour: "Début · heure",
    startMinute: "Début · minute",
    endHour: "Fin · heure",
    endMinute: "Fin · minute",
    timezoneHint:
      "Les horaires utilisent le fuseau de votre appareil et sont convertis en heure système à l’enregistrement.",
    save: "Enregistrer la maintenance",
    saved: "Paramètres de maintenance enregistrés",
    closed: "Maintenance désactivée",
    status: {
      active: "En maintenance",
      scheduled: "Planifiée",
      disabled: "Non activée",
    },
    errors: {
      startRequired:
        "Sélectionnez une heure de début avant d’activer la maintenance.",
      endRequired:
        "Sélectionnez une heure de fin avant d’activer la maintenance.",
      endAfterStart: "La fin doit être postérieure au début.",
    },
  },
  modelTabs: {
    label: "Catégories des paramètres de modèles",
    channels: "Canaux de modèles",
    conversation: "Modèles de conversation",
    knowledge: "Modèles de recherche de connaissances",
    voiceTranscription: "Modèle de transcription vocale",
    imageGeneration: "Modèle de génération d’images",
  },
  modelProvider: {
    catalogDescription:
      "Gérez les connexions des modèles, leurs tarifs et leur ordre dans la zone de saisie.",
    currentChannel: "Canal actuel",
    editChannel: "Modifier le canal",
    connectionDescription:
      "Les modèles de ce canal partagent ces paramètres de connexion.",
    channelActions: "Actions du canal",
    channelSummaryConfigured_one:
      "Ce canal se connecte via {{provider}} et contient {{count}} modèle. La clé API est configurée",
    channelSummaryConfigured_other:
      "Ce canal se connecte via {{provider}} et contient {{count}} modèles. La clé API est configurée",
    channelSummaryNotConfigured_one:
      "Ce canal se connecte via {{provider}} et contient {{count}} modèle. Aucune clé API configurée",
    channelSummaryNotConfigured_other:
      "Ce canal se connecte via {{provider}} et contient {{count}} modèles. Aucune clé API configurée",
    channelSummaryEnd: ".",
    noChannels: "Aucun canal de modèles",
    noChannelsDescription:
      "Ajoutez un canal et configurez son premier modèle pour commencer.",
    noModelsDescription:
      "Utilisez Ajouter un modèle pour configurer un modèle dans ce canal.",
    editModel: "Modifier le modèle {{name}}",
    modelEditorDescription:
      "Canal : {{name}}. L’enregistrement ne met à jour que ce modèle.",
    basicInformation: "Informations de base",
    pricing: "Tarification du modèle",
    capabilities: "Fonctionnalités",
    modelName: "Modèle",
    priceSummary: "Prix d’entrée / entrée en cache / sortie",
    modelActions: "Actions du modèle {{name}}",
    modelAvailability: "Disponible dans les conversations : {{name}}",
    modelOrder: "Ordre des modèles",
    moveUp: "Monter",
    moveDown: "Descendre",
    moveChannelUp: "Monter le canal",
    moveChannelDown: "Descendre le canal",
    orderHint:
      "Glissez une poignée ou utilisez Monter et Descendre. La zone de saisie présente les modèles de conversation par ordre de canal, puis par ordre de modèle dans chaque canal.",
    reorderModel: "Réorganiser le modèle {{name}}",
    reorderInstructions:
      "Appuyez sur Espace pour commencer, utilisez Haut et Bas pour déplacer, puis Espace pour confirmer ou Échap pour annuler.",
    reorderStarted: "Réorganisation de {{name}} commencée.",
    reorderPosition: "{{name}} déplacé à la position {{position}}.",
    reorderCancelled: "Réorganisation annulée.",
    discardTitle: "Abandonner les modifications non enregistrées ?",
    discardDescription:
      "Fermer cet éditeur abandonnera les modifications effectuées.",
    discardAction: "Abandonner les modifications",
    selectionsHint:
      "Le modèle de conversation par défaut s’applique avant le choix de l’utilisateur. Le modèle de nommage génère les titres des tâches.",
    title: "Service de modèles",
    description:
      "Gérez les modèles de conversation, de recherche de connaissances et les autres modèles avec leurs canaux de service. Le système utilise le service adapté à chaque modèle choisi ; les administrateurs définissent les niveaux de raisonnement disponibles pour la conversation.",
    readOnlyNotice:
      "Les paramètres des modèles sont en lecture seule. Vous pouvez les consulter, mais pas ajouter, modifier ou supprimer des modèles ni changer leur disponibilité dans les conversations.",
    providers: "Canaux de modèles",
    providersDescription:
      "Gérez les modèles et leurs connexions au même endroit. Les identifiants de modèle sont uniques pour que le système sélectionne toujours le bon modèle.",
    addProvider: "Ajouter un canal de modèles",
    providerTitle: "Canal de modèles {{index}}",
    providerName: "Nom du canal",
    renameProvider: "Renommer le canal {{name}}",
    renameProviderTitle: "Renommer le canal",
    renameProviderDescription:
      "Le nom du canal sert uniquement au repérage par les administrateurs et prend effet après l’enregistrement des paramètres.",
    renameProviderAction: "Renommer",
    unnamedProvider: "Canal non configuré",
    deleteProvider: "Supprimer le canal",
    saveProvider: "Enregistrer le canal {{name}}",
    deleteProviderTitle: "Supprimer le canal « {{name}} » ?",
    deleteProviderDescription:
      "Ce canal et tous ses modèles seront supprimés immédiatement après confirmation. L’historique des tâches et de l’utilisation n’est pas affecté.",
    providerDeleted: "Canal supprimé.",
    baseUrl: "URL de base",
    apiKey: "API_KEY",
    apiKeyConfiguredHint:
      "La clé est stockée en sécurité. Saisissez une nouvelle clé uniquement pour la remplacer.",
    apiKeyRequiredHint:
      "Saisissez une clé avant le premier enregistrement. Elle ne sera plus affichée.",
    apiKeyOptionalHint:
      "Saisissez une clé si le fournisseur exige une authentification. Elle ne sera plus affichée après enregistrement.",
    protocolMode: "Mode de compatibilité du protocole",
    protocolModes: {
      native_responses: "Responses natif",
      responses_tool_compat: "Compatibilité des outils Responses",
      chat_completions_bridge: "Passerelle Chat Completions",
    },
    protocolModeHints: {
      native_responses:
        "Pour les services prenant en charge Responses nativement, avec toutes les fonctions de conversation et d’outils.",
      responses_tool_compat:
        "Pour les services prenant en charge Responses avec un ensemble d’outils plus limité.",
      chat_completions_bridge:
        "Pour les services compatibles prenant uniquement en charge Chat Completions. Certaines fonctions avancées peuvent être indisponibles.",
    },
    models: "Modèles",
    modelsDescription:
      "Ces modèles partagent la connexion et la clé du canal. Les modèles de conversation peuvent être proposés aux utilisateurs ; les modèles de recherche et autres sont utilisés automatiquement selon les besoins.",
    addModel: "Ajouter un modèle",
    noModels: "Aucun modèle dans ce canal",
    newModelName: "Modèle {{index}}",
    unnamedModel: "Modèle sans nom",
    modelId: "Identifiant du modèle",
    modelIdConflict:
      "Cet identifiant existe déjà dans le catalogue. Utilisez un identifiant différent.",
    modelNameConflict:
      "Un modèle porte déjà ce nom d’affichage. Envisagez un autre nom pour les distinguer.",
    channelNameConflict:
      "Un canal porte déjà ce nom. Envisagez un autre nom pour les distinguer.",
    displayName: "Nom d’affichage",
    modelKind: "Type de modèle",
    modelKinds: {
      chat: "Modèle de conversation",
      embedding: "Modèle de vectorisation",
      reranker: "Modèle de reclassement",
    },
    serviceProvider: "Fournisseur du modèle",
    supportsImageInput: "Prend en charge l’analyse d’images",
    inputPrice: "Prix d’entrée",
    cachedInputPrice: "Prix d’entrée en cache",
    outputPrice: "Prix de sortie",
    contextWindow: "Longueur du contexte du modèle",
    contextWindowPlaceholder: "Détection automatique",
    contextWindowInvalid:
      "Saisissez un entier supérieur à 0, ou laissez vide pour détecter automatiquement.",
    priceUnit: "CNY / million de jetons",
    priceUnitSummary: ". Prix affichés en {{unit}}.",
    showInComposer: "Disponible dans les conversations",
    saveModel: "Enregistrer le modèle {{name}}",
    deleteModel: "Supprimer le modèle",
    deleteModelTitle: "Supprimer le modèle « {{name}} » ?",
    deleteModelDescription:
      "Le modèle sera supprimé immédiatement après confirmation. L’historique des tâches et de l’utilisation n’est pas affecté.",
    modelDeleted: "Modèle supprimé.",
    supportedEfforts: "Efforts de raisonnement pris en charge",
    selectedEfforts: "{{count}} sélectionnés",
    defaultEffort: "Effort de raisonnement par défaut",
    defaultModel: "Modèle de conversation par défaut",
    defaultModelHint:
      "Utilisé quand l’utilisateur n’a choisi aucun modèle ou que son choix précédent est indisponible.",
    modelSelections: "Choix des modèles de conversation et du système",
    saveModelSelections: "Enregistrer les choix des modèles",
    memoryExtractionModel: "Modèle d’extraction des souvenirs",
    memoryUseTaskModel: "Utiliser le modèle de la tâche actuelle",
    memoryExtractionHint:
      "S’applique lorsque l’utilisateur active la mémoire. Sans modèle distinct, l’extraction utilise celui de la tâche actuelle, toujours avec son effort de raisonnement minimal. Cela ne change pas le modèle de consolidation de la mémoire.",
    titleModel: "Modèle de nommage automatique des tâches",
    titleModelHint:
      "Génère automatiquement des noms reconnaissables pour les tâches. Son utilisation figure dans les analyses.",
    saved: "Paramètres des canaux de modèles mis à jour.",
  },
  knowledgeModels: {
    title: "Modèles de recherche de connaissances",
    description:
      "Choisissez les modèles aidant les bases à comprendre les documents, répondre aux questions et améliorer les résultats de recherche.",
    selectionDescription:
      "Choisissez les modèles de traitement des documents et d’amélioration des résultats. Ajoutez et gérez les modèles dans Canaux de modèles.",
    noEmbeddingModels:
      "Aucun modèle prêt pour la recherche de connaissances. Configurez d’abord un modèle de vectorisation dans Canaux de modèles.",
    embeddingTitle: "Modèle de vectorisation",
    embeddingSelectionDescription:
      "Ce modèle obligatoire aide la base à comprendre les documents et questions. Sa disponibilité est vérifiée à l’enregistrement.",
    selectEmbeddingModel: "Sélectionner un modèle de vectorisation",
    embeddingModelPlaceholder: "Sélectionner un modèle de vectorisation",
    embeddingDescription:
      "Ce modèle obligatoire aide la base à comprendre les documents et les questions.",
    rerankTitle: "Modèle de reclassement",
    rerankSelectionDescription:
      "Place les résultats les plus pertinents en premier. La recherche fonctionne toujours si cette fonction est désactivée ou temporairement indisponible.",
    selectRerankerModel: "Sélectionner un modèle de reclassement",
    rerankerModelPlaceholder: "Sélectionner un modèle de reclassement",
    rerankDescription:
      "Place les résultats les plus pertinents en premier. La recherche fonctionne même si cette fonction est désactivée.",
    enabled: "Activer pendant la recherche",
    baseUrl: "URL de base",
    embeddingBaseUrlHint:
      "Saisissez l’adresse de connexion du modèle de vectorisation fournie par le fournisseur.",
    rerankBaseUrlHint:
      "Saisissez l’adresse de connexion du modèle de reclassement fournie par le fournisseur.",
    modelId: "Identifiant du modèle",
    inputPrice: "Prix d’entrée",
    priceUnit: "CNY / million de jetons",
    embeddingApiKey: "Clé API de vectorisation",
    rerankApiKey: "Clé API de reclassement",
    apiKeyConfiguredHint:
      "Une clé est configurée. Saisissez-en une nouvelle uniquement pour la remplacer.",
    apiKeyEndpointChangedHint:
      "L’adresse de connexion a changé ; la clé existante ne sera pas réutilisée. Saisissez la clé correspondante si la nouvelle adresse exige une authentification.",
    apiKeyOptionalHint:
      "Laissez vide si le fournisseur n’exige pas d’authentification. La clé ne sera plus affichée après enregistrement.",
    embeddingRuntime:
      "Le système traite le contenu en {{dimensions}} dimensions, jusqu’à {{tokens}} jetons à la fois.",
    rerankRuntime:
      "Traite jusqu’à {{tokens}} jetons à la fois. Si le service dépasse {{timeout}} ms, cette optimisation est ignorée.",
    rebuildHint:
      "Après avoir changé le modèle de vectorisation, reconstruisez intégralement tous les index des bases dans État du système. La recherche reste indisponible jusqu’à la fin.",
    embeddingChangeConfirmTitle:
      "Opération à risque : changer le modèle de vectorisation ?",
    embeddingChangeConfirmDescription:
      "Le modèle de vectorisation détermine l’interprétation et la recherche du contenu des bases. Enregistrer ce changement invalide tous les index existants. Vous devrez reconstruire intégralement tous les index dans État du système ; la recherche restera indisponible jusqu’à la fin. La reconstruction ne démarre pas automatiquement.",
    embeddingChangeDangerNotice:
      "Changer le modèle de vectorisation présente un risque. Une reconstruction partielle des bases ne suffit pas.",
    embeddingChangeConfirmAction: "Changer le modèle et enregistrer",
    rebuildRequiredTitle:
      "Modèle de vectorisation changé ; reconstruction des index requise",
    rebuildRequiredDescription:
      "Ouvrez État du système et reconstruisez tous les index des bases. La recherche reste indisponible jusqu’à la fin.",
    openSystemHealth: "Ouvrir État du système",
    validating: "Vérification et enregistrement…",
    save: "Enregistrer les modèles de recherche",
    saved: "Paramètres des modèles de recherche mis à jour.",
    savedDescription:
      "Les nouveaux traitements et recherches sémantiques utiliseront cette configuration.",
    savedAfterEmbeddingChangeDescription:
      "Le modèle a été enregistré. Reconstruisez tous les index dans État du système ; la recherche restera indisponible jusqu’à la fin.",
  },
  voiceTranscription: {
    title: "Modèle de transcription vocale",
    description:
      "Configurez le service de transcription de la saisie vocale. Une fois activé, les tâches ordinaires et applications intégrées utilisent ces paramètres. La clé est stockée en sécurité et jamais réaffichée.",
    enabled: "Activer la transcription vocale",
    provider: "Fournisseur du modèle",
    providerHint:
      "Choisissez le service de transcription que vous avez activé et souhaitez utiliser.",
    providerPlaceholder: "Sélectionner un fournisseur",
    providers: {
      dashscope: "Alibaba Cloud Bailian",
      openai: "OpenAI",
      openai_compatible: "Service compatible OpenAI",
      azure_openai: "Azure OpenAI",
      groq: "Groq",
      deepgram: "Deepgram",
      assemblyai: "AssemblyAI",
      elevenlabs: "ElevenLabs",
      revai: "Rev.ai",
      gladia: "Gladia",
      fal: "fal.ai",
    },
    baseUrl: "URL de base",
    baseUrlHint:
      "Saisissez l’adresse de connexion du service de transcription fournie par le fournisseur.",
    apiVersion: "Version de l’API",
    apiVersionHint:
      "Saisissez la version d’API de votre déploiement Azure OpenAI.",
    apiKey: "Clé API",
    apiKeyConfiguredHint:
      "Une clé est configurée. Laissez vide pour la conserver.",
    apiKeyRequiredHint:
      "Une clé est requise à la première activation ou après un changement de fournisseur. Elle ne sera jamais réaffichée.",
    model: "Nom du modèle de transcription",
    modelHint:
      "Saisissez le nom du modèle ou du déploiement fourni par le fournisseur.",
    save: "Enregistrer le modèle de transcription",
    saving: "Enregistrement…",
    saved: "Paramètres de transcription mis à jour.",
  },
  imageGeneration: {
    title: "Modèle de génération d’images",
    description:
      "Configurez le service de génération d’images. Une fois activé, le système utilise ces paramètres pour créer des images. La clé est stockée en sécurité et jamais réaffichée.",
    enabled: "Activer la génération d’images",
    provider: "Fournisseur du modèle",
    providerHint:
      "Choisissez le service de génération d’images activé que vous souhaitez utiliser.",
    providerPlaceholder: "Sélectionner un fournisseur",
    providers: {
      alibaba_bailian: "Alibaba Cloud Bailian",
      openai: "OpenAI",
      google_gemini: "Google Gemini",
      stability: "Stability AI",
      fal: "fal.ai",
      replicate: "Replicate",
      together: "Together AI",
    },
    baseUrl: "URL de base",
    baseUrlHint:
      "Renseignée automatiquement selon le fournisseur. Aucune modification manuelle nécessaire.",
    workspaceId: "Identifiant de l’espace Bailian",
    workspaceIdHint:
      "Connexion à votre espace dédié dans Alibaba Cloud Bailian.",
    region: "Région Bailian",
    regionHint:
      "Choisissez la région où le service est actif. Pékin est utilisée par défaut.",
    apiKey: "Clé API",
    apiKeyConfiguredHint:
      "Une clé est configurée. Laissez vide pour la conserver.",
    apiKeyRequiredHint:
      "Une clé est requise à la première activation ou après un changement de fournisseur. Elle ne sera jamais réaffichée.",
    model: "Nom du modèle de génération d’images",
    modelHint:
      "Saisissez le nom fourni par le fournisseur, par exemple qwen-image-3.0.",
    pricePerImage: "Prix par image",
    pricePerImageHint:
      "Sert au suivi des coûts de génération. Unité : CNY par image.",
    save: "Enregistrer le modèle de génération d’images",
    saving: "Enregistrement…",
    saved: "Paramètres de génération d’images mis à jour.",
  },
  imageUnderstanding: {
    title: "Analyse des images des documents",
    description:
      "Une fois activée, le système analyse les images des documents et utilise ces informations dans la recherche de connaissances. Le contenu original n’est pas modifié.",
    selectionDescription:
      "Une fois activée, l’analyse des images permet de retrouver les informations qu’elles contiennent. Choisissez un modèle de conversation prenant en charge les images.",
    noImageModels:
      "Aucun modèle compatible avec les images. Activez d’abord la prise en charge de l’analyse d’images pour un modèle de conversation dans Canaux de modèles.",
    selectModel: "Sélectionner un modèle d’analyse d’images",
    selectModelHint:
      "Le système vérifie la reconnaissance des images à l’enregistrement.",
    modelPlaceholder: "Sélectionner un modèle d’analyse d’images",
    enabled: "Activer pendant le traitement",
    provider: "Fournisseur du modèle",
    providerPlaceholder: "Sélectionner un fournisseur",
    providers: {
      openai: "OpenAI",
      azure_openai: "Azure OpenAI",
      anthropic: "Anthropic",
      google: "Google Gemini",
      google_vertex: "Google Vertex AI",
      alibaba: "Alibaba / Qwen",
      deepseek: "DeepSeek",
      openrouter: "OpenRouter",
      openai_compatible: "Compatible OpenAI / vLLM",
    },
    model: "Identifiant du modèle multimodal",
    modelHint:
      "Choisissez un modèle reconnu compatible avec l’analyse d’images. Sa disponibilité est vérifiée à l’enregistrement.",
    baseUrl: "URL de base",
    baseUrlRequiredHint:
      "Saisissez l’adresse complète fournie par le fournisseur.",
    baseUrlOptionalHint:
      "Laissez vide pour utiliser l’adresse par défaut du fournisseur.",
    apiKey: "Clé API",
    apiKeyConfiguredHint:
      "Une clé est configurée. Laissez vide pour la conserver.",
    apiKeyRequiredHint:
      "Une clé est requise à la première activation et ne sera jamais réaffichée.",
    project: "Identifiant du projet Vertex",
    location: "Emplacement Vertex",
    activeStrategy:
      "Le modèle actuel a réussi la vérification d’analyse des images.",
    strategyAfterValidation:
      "Le système vérifie la capacité d’analyse d’images du modèle après enregistrement.",
    validating: "Vérification et enregistrement…",
    save: "Enregistrer l’analyse d’images",
    saved:
      "Paramètres d’analyse d’images mis à jour. Les nouveaux traitements et reconstructions utiliseront cette configuration.",
  },
  authSettings: {
    enterpriseTitle: "Comptes professionnels",
    enterpriseDescription:
      "Permettez la connexion avec les comptes gérés par votre organisation ou directement dans Teams. La première connexion recherche un compte existant par e-mail ; les nouveaux comptes nécessitent l’activation par un administrateur.",
    smtpTitle: "E-mails d’authentification",
    smtpDescription:
      "Configurez le service SMTP pour les e-mails de première définition et de réinitialisation de mot de passe. Les tests de connexion restent dans État du système.",
    oidcTitle: "Authentification d’entreprise (OIDC)",
    oidcDescription:
      "Connectez le service d’authentification de votre organisation, tel que Microsoft Entra ID pour les comptes professionnels ou scolaires.",
    teamsTitle: "Connexion dans Teams",
    teamsDescription:
      "Permettez l’accès direct dans Teams avec un compte professionnel ou scolaire.",
    modeLabel: "Source de configuration",
    modes: {
      inherit: "Hériter de l’environnement de déploiement",
      managed: "Gérer dans les paramètres système",
      disabled: "Désactiver cette fonctionnalité",
    },
    modeNotices: {
      inherit:
        "L’environnement de déploiement est utilisé. Saisissez à nouveau le secret lors du passage à la gestion système.",
      disabled:
        "Cette fonctionnalité est explicitement désactivée et n’utilise pas la configuration de déploiement en remplacement.",
    },
    status: {
      configured: "Configuré",
      notConfigured: "Non configuré",
      invalid: "Configuration invalide",
    },
    smtpHost: "Hôte SMTP",
    smtpPort: "Port SMTP",
    smtpSecurity: "Sécurité de la connexion",
    starttls: "STARTTLS",
    tls: "TLS direct",
    smtpFrom: "Adresse d’expédition",
    smtpUsername: "Nom d’utilisateur",
    smtpUsernameHint:
      "Laissez vide si le service SMTP ne nécessite pas d’authentification.",
    smtpPassword: "Mot de passe",
    oidcIssuer: "URL de l’émetteur",
    oidcClientId: "Identifiant client",
    oidcClientSecret: "Secret client",
    oidcRedirectUri: "URI de redirection",
    oidcRedirectHint:
      "Enregistrez cette URI fixe auprès du fournisseur OIDC. Elle ne peut pas être modifiée ici.",
    teamsTenantId: "Identifiant du locataire",
    teamsClientId: "Identifiant d’application (client)",
    teamsExternalHint:
      "Utilisez le même identifiant d’application dans Microsoft Entra et le manifeste Teams, exposez l’API et accordez les consentements requis.",
    secretPreserved:
      "Un secret est enregistré. Laissez vide pour le conserver.",
    secretRequired:
      "Saisissez à nouveau le secret lors du passage à la gestion système.",
    secretRequiredWhenUsed:
      "Un mot de passe est requis si un nom d’utilisateur est défini.",
    saved:
      "Paramètres d’authentification mis à jour et appliqués immédiatement.",
    confirmTitle: "Changer la source de configuration ?",
    confirmDescription:
      "Continuer cesse d’utiliser la configuration actuelle. Désactiver une méthode de connexion peut bloquer les utilisateurs qui en dépendent.",
  },
  editUser: "Modifier l’utilisateur",
  userSaved: "Utilisateur enregistré.",
  enableUserNamed: "Activer l’utilisateur {{name}}",
  disableUserNamed: "Désactiver l’utilisateur {{name}}",
  userEnabled: "Utilisateur {{name}} activé.",
  userDisabled: "Utilisateur {{name}} désactivé.",
  userStatusSelfLocked:
    "Les administrateurs ne peuvent pas s’activer ni se désactiver eux-mêmes.",
  lastEnabledAdminStatusLocked:
    "Au moins un administrateur activé doit subsister.",
  userStatusVerifyingAdmins:
    "Vérification du nombre d’administrateurs activés. Veuillez patienter.",
  emailUpdated: "E-mail mis à jour. L’utilisateur doit se reconnecter.",
  accountMetadata: "Métadonnées du compte et des ressources",
  passwordUpdated: "Mot de passe mis à jour",
  personalPlugins: "Plugins personnels",
  personalSkills: "Compétences personnelles",
  personalCredentials: "Identifiants personnels",
  noPasswordNotice:
    "Les administrateurs ne peuvent ni définir, ni consulter, ni importer, ni réinitialiser les mots de passe. Les nouveaux utilisateurs peuvent se connecter via SSO, Teams ou la procédure de mot de passe oublié.",
  userPrivilegeChangeWarning:
    "Les sessions de l’utilisateur seront immédiatement révoquées. Le désactiver annule aussi les demandes en attente non démarrées. Vous ne pouvez ni vous désactiver ni vous rétrograder ; au moins un administrateur activé doit subsister.",
  userSearchPlaceholder: "Rechercher par nom ou e-mail…",
  downloadTemplate: "Télécharger le modèle Excel",
  chooseExcel: "Choisir un fichier Excel",
  templateFilename: "{{productPrefix}}-modele-import-utilisateurs.xlsx",
  importDescription:
    "Utilisez le modèle Excel pour le nom, l’e-mail, le rôle et les groupes. La feuille Instructions contient des exemples. Aucun champ de mot de passe n’est présent ; les lignes invalides sont signalées séparément.",
  importSubmit: "Démarrer l’import",
  importResult: "Résultat de l’import",
  importCounts: "{{imported}} importés et {{skipped}} ignorés.",
  importErrorRow: "Ligne {{row}} : {{message}}",
  editGroup: "Modifier le groupe",
  deleteGroupTitle: "Supprimer définitivement ce groupe ?",
  importErrors: {
    duplicateInFile: "Le classeur contient une adresse e-mail en double.",
    emailExists: "Cet e-mail est déjà utilisé par un utilisateur existant.",
    groupNotFound: "Le groupe indiqué n’existe pas.",
    invalidEmail: "Le format de l’e-mail est invalide.",
    invalidRole: "Le rôle doit être user ou admin.",
    invalidName: "Le nom est absent ou invalide.",
    invalidRow: "Une valeur de champ est invalide.",
  },
  parentDeleteDescription:
    "Les appartenances et autorisations de bases associées seront définitivement supprimées. Cette action est irréversible.",
  auditSearchPlaceholder:
    "Rechercher par identifiant de tâche, utilisateur, plugin, compétence ou code d’erreur…",
  dateFrom: "Date de début",
  dateTo: "Date de fin",
  auditDataSurfaces: "Périmètre des données d’audit",
  auditSurfaces: {
    events: "Journal d’audit permanent",
    conversations: "Métadonnées d’exécution des tâches",
    retainedArtifacts: "Fichiers de tâches supprimées",
  },
  auditConversationDescription:
    "Affiche les résumés d’exécution expurgés des utilisateurs, sans titres, messages, contenu de fichiers, événements complets ni liens de téléchargement.",
  auditConversationSearchPlaceholder:
    "Rechercher par identifiant de tâche, utilisateur, plugin, compétence ou code d’erreur…",
  advancedFilters: "Plus de filtres",
  pluginName: "Nom du plugin",
  skillName: "Nom de la compétence",
  errorCode: "Code d’erreur",
  runnerStatus: "État du service d’exécution",
  archiveStatus: "État d’archivage",
  createdFrom: "Création à partir du",
  createdTo: "Création jusqu’au",
  lastRunFrom: "Dernière exécution à partir du",
  lastRunTo: "Dernière exécution jusqu’au",
  auditConversationsEmpty: "Aucune métadonnée d’exécution correspondante.",
  retainedArtifactsDescription:
    "Affiche uniquement les résumés expurgés des fichiers conservés indéfiniment après suppression des tâches. Consultation du contenu, restauration et téléchargement indisponibles.",
  retainedArtifactsSearchPlaceholder:
    "Rechercher par identifiant de tâche, de propriétaire ou date de suppression…",
  retainedArtifactsEmpty:
    "Aucun résumé de fichiers de tâche supprimée correspondant.",
  conversation: "Identifiant de tâche",
  owner: "Propriétaire",
  capabilitiesUsed: "Plugins et compétences utilisés",
  files: "Métadonnées des fichiers",
  execution: "Résumé d’exécution",
  lastRun: "Dernière exécution",
  activeConversation: "Non archivée",
  archivedConversation: "Archivée",
  attachmentsSummary: "{{count}} pièces jointes · {{size}}",
  artifactsSummary: "{{count}} fichiers produits · {{size}}",
  runnerStatuses: {
    initialized: "Service d’exécution initialisé",
    not_started: "Service d’exécution non démarré",
    available: "Service d’exécution disponible",
    unavailable: "Service d’exécution indisponible",
  },
  executionError: "Erreur d’exécution",
  errorTypes: { codex_turn: "Erreur d’exécution de tâche" },
  retainedArtifactCount: "Fichiers conservés",
  totalSize: "Taille totale",
  checksum: "Sommes de contrôle présentes",
  deletedAt: "Tâche supprimée",
  editableSettings: "Paramètres du produit modifiables",
  deploymentReadOnly:
    "L’infrastructure, l’authentification, les secrets, la simultanéité et les limites de fichiers sont gérés par le déploiement. Seul un état expurgé est affiché ici.",
} as const
