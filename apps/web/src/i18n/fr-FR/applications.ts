export const applicationResources = {
  applications: {
    opening: {
      expired:
        "Cette session d’ouverture n’est plus disponible. Revenez à vos applications pour la rouvrir.",
      back: "Retour aux applications",
    },
    editMetadata: "Modifier les informations de l’application",
    editMetadataPublishDescription:
      "Modifiez l’icône, le nom et la description. Les changements prennent effet à l’enregistrement. Les versions partagées et celles du Centre d’applications se mettent à jour séparément.",
    editMetadataDescription:
      "Modifiez l’icône, le nom et la description de l’application.",
    editDraftMetadataDescription:
      "Enregistrez dans l’application en développement. Publiez pour appliquer ces changements dans Mes applications.",
    distribution: {
      versionNumber: "Numéro de version",
      editVersionLower:
        "La version ne peut pas être inférieure à la dernière version existante v{{version}}.",
      editVersionHint:
        "Conservez la version existante ou saisissez une version supérieure au format 1.0.0.",
      versionHint:
        "Une version est proposée. Pour la modifier, utilisez un format tel que 1.0.0.",
      publishFirst:
        "Publiez une version avant de partager ou de référencer cette application.",
      publishedVersionHint:
        "Partagez ou référencez cette version publiée. Publiez d’abord les nouvelles modifications.",
      serviceInstallationHint:
        "Installez pour utiliser les ressources du créateur. Les nouvelles versions nécessitent une mise à jour manuelle. Vos conversations et fichiers de travail sont conservés.",
      availableVersion: "Disponible · v{{version}}",
      versionInvalid: "Saisissez une version valide, par exemple 1.0.0.",
      versionSame:
        "La version v{{version}} existe déjà. Saisissez une version supérieure.",
      versionLower:
        "La version doit être supérieure à la dernière version existante, v{{version}}.",
      saveSharing: "Enregistrer le partage",
      applyListing: "Demander le référencement",
      completeSetup: "Terminer la configuration",
      installedVersion: "Installée · v{{version}}",
      editModes: "Modifier les modes d’utilisation",
      direct: "Partager avec l’organisation",
      center: "Centre d’applications",
      myApplications: "Mes applications",
      sharedApplications: "Partagées avec moi",
      usageModes: "Options d’utilisation",
      usageModesHint:
        "Choisissez au moins une option. Vous pouvez proposer les deux.",
      modes: {
        install: "Paquet d’application",
        service: "Service d’application",
      },
      modeDescriptions: {
        install:
          "Les utilisateurs installent leur propre application, configurent leurs identifiants et l’entretiennent indépendamment.",
        service:
          "Les utilisateurs installent manuellement le service d’application et utilisent vos ressources et identifiants configurés.",
      },
      install: "Installer l’application",
      useService: "Utiliser",
      installationName: "Nom de l’application installée",
      installationHint:
        "L’application, ses plugins et ses compétences seront enregistrés dans votre compte. Configurez vos propres identifiants, bases de connaissances et connexions externes.",
      installed:
        "Application installée. Vérifiez et terminez la configuration requise.",
      installedLabel: "Installée",
      openInstalled: "Ouvrir mon application",
      configure: "Configurer l’application",
      guide: "Guide d’utilisation",
      version: "v{{version}}",
      submit: "Soumettre à approbation",
      submitHint:
        "Un administrateur examinera cette version et ses options d’utilisation. Toute modification ultérieure nécessite une nouvelle soumission et ne remplace pas automatiquement la version approuvée.",
      releaseNotes: "Notes de version",
      submitted: "Soumise à l’approbation d’un administrateur.",
      withdraw: "Retirer la soumission",
      withdrawn: "Soumission retirée.",
      unlist: "Retirer du catalogue",
      relist: "Remettre au catalogue",
      statusSaved: "État du référencement mis à jour.",
      noReleases: "Aucune version soumise pour le moment.",
      noCenterApplications: "Aucune application dans le centre",
      centerSearch: "Rechercher dans le Centre d’applications",
      centerUnavailable:
        "Cette application ne peut pas être utilisée ni installée actuellement.",
      updateAvailable: "Mise à jour disponible",
      checkUpdate: "Rechercher des mises à jour",
      updateTitle: "Mettre à jour l’application installée",
      update: "Mettre à jour l’application",
      updateHint:
        "La mise à jour remplace vos modifications de l’application. Vos conversations, fichiers de travail et identifiants personnels sont conservés. Terminez d’abord toutes les tâches ordinaires de cette application.",
      upToDate: "Vous disposez de la dernière version disponible.",
      updateUnavailable:
        "Les mises à jour sont indisponibles. Votre application installée est conservée.",
      updated:
        "Application mise à jour. Vos paramètres personnels ont été conservés.",
      setupRequired: "Configuration requise",
      preserved:
        "Ces modifications personnelles seront conservées : {{fields}}",
      fields: {
        name: "Nom de l’application",
        instructions: "Instructions de l’application",
        model: "Modèle",
        reasoning_effort: "Effort de raisonnement",
        capabilities: "Plugins et compétences",
        resources: "Bases de connaissances et connexions externes",
      },
      review: "Examiner l’application",
      approve: "Approuver",
      reject: "Rejeter",
      reviewComment: "Commentaire de révision",
      reviewed: "Décision de révision enregistrée.",
      reviewInstructions: "Instructions de l’application",
      suspend: "Retirer l’application du catalogue",
      resume: "Remettre l’application au catalogue",
      governanceReason: "Motif",
      revokeHint:
        "Révoquer l’accès empêche de nouvelles installations ou l’utilisation du service. Les installations indépendantes existantes et l’historique sont conservés.",
      saveModes: "Enregistrer les options d’utilisation",
      modesSaved: "Options d’utilisation mises à jour.",
    },
    publication: {
      noGuide: "Le créateur n’a pas fourni de guide d’utilisation.",
    },
    scopeLabel: "Périmètre des applications",
    scope: {
      all: "Toutes les applications",
      owned: "Créées par moi",
      shared: "Partagées avec moi",
    },
    search: "Rechercher des applications",
    searchPlaceholder: "Rechercher par nom ou description…",
    create: "Créer une application",
    createTypeDescription: "Choisissez comment créer votre application.",
    creation: {
      recommended: "Recommandé",
      interactiveTitle: "Créer une application interactive par conversation",
      interactiveDescription:
        "Partagez votre idée et laissez LinkSense la réaliser.",
      start: "Commencer la création",
    },
    createStandardApp: "Créer une application standard",
    createStandardAppDescription:
      "Configurez un assistant personnel avec vos outils et ressources habituels.",
    interactiveApp: "Application interactive",
    importInteractiveApp: "Importer une application interactive",
    importInteractiveAppDescription:
      "Importez un paquet d’application existant pour l’ajouter à Mes applications.",
    updateInteractivePackage: "Mettre à jour le paquet d’application",
    interactivePackageUpdated: "Mise à jour réussie.",
    interactiveAppImported: "Import réussi.",
    interactivePackageRequirements:
      "Importez une archive ZIP contenant manifest.json et index.html à sa racine.",
    applicationPackage: "Paquet d’application",
    interactivePackageHint:
      "ZIP uniquement, jusqu’à {{size}}. Une mise à jour peut conserver la version actuelle ou utiliser une version supérieure.",
    interactivePackageSizeInvalid:
      "Le paquet est vide ou dépasse la taille maximale.",
    importPackageAction: "Importer",
    updatePackageAndPublish: "Mettre à jour",
    interactivePackageVersionInvalid:
      "La version du paquet doit comporter trois nombres, par exemple 0.0.1. Modifiez-la puis importez à nouveau le paquet.",
    importPublicationRetry:
      "L’import n’est pas terminé. Vérifiez les ressources requises et réessayez ; aucune application en double ne sera créée.",
    createAndPublish: "Créer",
    editAndPublish: "Enregistrer",
    editedAndPublished: "Enregistrement réussi.",
    createPublicationRetry:
      "La création n’est pas terminée. Vérifiez la configuration et réessayez ; aucune application en double ne sera créée.",
    declaration: {
      title: "Liste de déclaration des ressources",
      purpose:
        "Lors de la création d’une application interactive, utilisez cette liste pour déclarer dans manifest.json les plugins, compétences, serveurs MCP et bases dont elle a besoin.",
      search: "Rechercher des ressources par nom",
      selectAll: "Tout sélectionner",
      selectResults: "Sélectionner tous les résultats",
      selectType: "Tout sélectionner : {{type}}",
      selectTypeResults: "Sélectionner tous les résultats : {{type}}",
      selected: "{{count}} sélectionnés",
      groupSelected: "{{count}} / {{total}} sélectionnés",
      empty: "Aucune ressource disponible à déclarer",
      preview: "Aperçu de la déclaration",
      mergeHint:
        "Après la copie, ajoutez le champ dependencies à manifest.json, à côté de name et version. Remplacez le champ dependencies existant sans écraser tout le fichier.",
      invalid:
        "Impossible de générer une déclaration valide. Sélectionnez au maximum 50 plugins et compétences au total, 20 serveurs MCP et 20 bases. Les noms des ressources doivent comporter entre 1 et 160 caractères. Ajustez la sélection ou les noms.",
      copy: "Copier le JSON des dépendances",
      copyFailed:
        "Échec de la copie. Réessayez ou sélectionnez le texte dans l’aperçu pour le copier manuellement.",
    },
    dependencies: {
      preview: "Vérifier les ressources requises",
      hint: "Le paquet déclare les plugins, compétences et autres ressources ci-dessous. Nous recommandons de terminer leur configuration avant l’import pour assurer le bon fonctionnement de l’application.",
      empty: "Cette application ne déclare aucune ressource requise.",
      search: "Rechercher et choisir vos ressources",
      matched: "Configuré",
      unmatched: "Non configuré",
      clear: "Effacer la sélection",
      serviceOnly:
        "Les applications interactives peuvent uniquement être utilisées en ligne, pas copiées. Les utilisateurs n’ont pas besoin de reconfigurer les ressources connectées du créateur.",
      types: {
        plugin: "Plugin",
        skill: "Compétence",
        mcp_server: "Serveur MCP",
        knowledge_base: "Base de connaissances",
      },
    },
    nativeChatPanel: "Conversation LinkSense",
    hideNativeChat: "Masquer la conversation",
    showNativeChat: "Afficher la conversation",
    resizeNativeChat: "Redimensionner le panneau de conversation",
    interactiveRuntimeUnavailable:
      "Cette application interactive est indisponible. Contactez son créateur.",
    created: "Création réussie.",
    updated:
      "Application mise à jour. Les prochains tours de tâche utiliseront automatiquement la configuration actuelle.",
    deleted: "Application supprimée.",
    emptyTitle: "Aucune application disponible",
    createdByMe: "Créée par moi",
    createdBy: "Créée par {{name}}",
    status: { active: "Activée", disabled: "Désactivée" },
    noDescription: "Aucune description",
    card: {
      capabilityCount: "Plugins / compétences {{count}}",
      knowledgeBaseCount: "Bases de connaissances {{count}}",
      mcpServerCount: "MCP {{count}}",
    },
    capabilityCount: "{{count}} plugins/compétences",
    knowledgeBaseCount: "{{count}} bases de connaissances",
    mcpServerCount: "{{count}} serveurs MCP",
    shareTargets: "Partagée · {{targets}}",
    dependencyUnavailable:
      "Certaines dépendances sont désactivées ou indisponibles. Rétablissez-les avant de lancer une tâche.",
    dependencyUnavailableShort: "Indisponible ; peut être retirée",
    usesPluginCredentials: "Utilise des identifiants de plugin",
    share: "Partager",
    shareWithinOrganization: "Partager dans l’organisation",
    usage: {
      action: "Analyse de l’utilisation",
      title: "Utilisation de l’application",
      description:
        "Consultez l’utilisation et les coûts des modèles de « {{name}} » pendant la période sélectionnée.",
      backToApplications: "Retour aux applications",
      activeUsers: "Utilisateurs actifs",
      activeUsersHint:
        "Utilisateurs distincts ayant créé une tâche ou démarré un tour effectif pendant la période sélectionnée",
      coverageTitle:
        "Les données de jetons et de coûts commencent au début de la collecte",
      coverageDescription:
        "La couverture commence le {{date}}. Les tâches et tours antérieurs restent comptés, mais leurs jetons et coûts historiques ne sont pas estimés aux tarifs actuels.",
      tokenBreakdownTitle: "Répartition des jetons",
      costBreakdownTitle: "Répartition des coûts",
      unpricedTokens: "Jetons sans tarif",
      modelBreakdownDescription:
        "Consultez les appels, tours, jetons et coûts par modèle.",
      workloadBreakdownDescription:
        "Consultez les appels, jetons et coûts par type d’activité du modèle.",
    },
    startChat: "Essayer",
    deleteAction: "Supprimer l’application",
    deleteTitle: "Supprimer cette application ?",
    deleteDescription:
      "L’application disparaîtra du Centre de plugins et ne pourra plus démarrer de tâches. L’historique privé des tâches existantes est conservé.",
    editTitle: "Modifier l’application",
    createTitle: "Créer une application",
    editorDescription:
      "Configurez le modèle, les plugins et compétences, les bases et les instructions de l’application. Saisissez un numéro de version ; les changements prennent effet à l’enregistrement. Les versions partagées et référencées sont mises à jour séparément.",
    basicInformation: "Informations de base",
    details: {
      title: "Détails de l’application",
      open: "Voir les détails de {{name}}",
      creator: "Créateur",
      kinds: {
        standard: "Application standard",
        interactive: "Application interactive",
      },
      views: {
        configuration: "Configuration actuelle",
        published: "Version publiée",
      },
      resources: "Ressources de l’application",
      noResources:
        "Aucune ressource configurée ou déclarée pour cette application.",
      emptyGroup: "Aucune ressource de ce type",
      unknownResource: "Ressource indisponible",
      resourceGroup: "{{type}} ({{count}})",
      declaredResource: "Déclarée par l’application : {{name}}",
      resourceStatus: {
        configured: "Configurée",
        unconfigured: "Non configurée",
        unavailable: "Indisponible",
      },
    },
    runtimeConfiguration: "Configuration d’exécution",
    icon: "Icône de l’application",
    iconPresetLabel: "Icônes d’application intégrées",
    uploadIcon: "Importer une image",
    replaceIcon: "Remplacer l’image",
    iconHint:
      "PNG, JPEG ou WebP ; ≤ {{size}}, maximum {{dimension}}×{{dimension}} px.",
    iconFileInvalid:
      "Choisissez une image respectant les limites de format, de taille et de dimensions.",
    iconPresets: {
      bot: "Bot",
      search: "Recherche et étude",
      "book-open": "Base de connaissances",
      "graduation-cap": "Éducation et formation",
      "briefcase-business": "Travail et bureautique",
      "chart-column": "Analyse de données",
      "code-xml": "Développement logiciel",
      "pen-line": "Rédaction de contenu",
      sparkles: "Création graphique",
      lightbulb: "Innovation et planification",
      headset: "Service client",
      "file-text": "Traitement documentaire",
      landmark: "Finance",
      scale: "Droit et conformité",
      "heart-pulse": "Santé",
      "shield-check": "Sécurité et risques",
      workflow: "Automatisation des processus",
      "calendar-clock": "Planification",
      users: "Collaboration d’équipe",
      "globe-2": "Activités internationales",
    },
    instructions: "Instructions de l’application",
    instructionsDescription:
      "Ces instructions sont ajoutées comme consignes développeur au niveau de l’application et ne sont pas affichées aux destinataires.",
    model: "Modèle",
    userSelectedModel: "Choisi par l’utilisateur dans la conversation",
    modelOptionalDescription:
      "Sans modèle défini, les utilisateurs peuvent choisir le modèle et l’effort de raisonnement dans la conversation.",
    reasoningEffort: "Effort de raisonnement",
    plugins: "Plugins",
    pluginsDescription:
      "Sélectionnez les plugins que vous gérez. Les applications utilisent directement les identifiants déjà associés à chaque plugin.",
    noPlugins: "Aucun plugin disponible.",
    pluginSelectPlaceholder: "Sélectionner des plugins…",
    pluginSearchPlaceholder: "Rechercher des plugins…",
    skills: "Compétences",
    skillsDescription: "Sélectionnez les compétences que vous gérez.",
    noSkills: "Aucune compétence disponible.",
    skillSelectPlaceholder: "Sélectionner des compétences…",
    skillSearchPlaceholder: "Rechercher des compétences…",
    knowledgeBases: "Bases de connaissances",
    knowledgeBasesDescription:
      "Les destinataires peuvent interroger ces bases uniquement dans les tâches de l’application ; ils ne peuvent ni les parcourir, ni les prévisualiser, ni les télécharger, ni les gérer.",
    noKnowledgeBases: "Aucune base disponible.",
    knowledgeBaseSelectPlaceholder: "Sélectionner des bases…",
    knowledgeBaseSearchPlaceholder: "Rechercher des bases…",
    mcpServers: "Serveurs MCP",
    mcpServersDescription:
      "Sélectionnez les serveurs MCP disponibles pour cette application. Tous leurs outils, y compris ceux ayant des effets externes, suivent la politique d’exécution active.",
    noMcpServers: "Aucun serveur MCP disponible.",
    mcpServerSelectPlaceholder: "Sélectionner des serveurs MCP…",
    mcpServerSearchPlaceholder: "Rechercher des serveurs MCP…",
    resourceSearchEmpty: "Aucune option correspondante.",
    removeResource: "Retirer {{name}}",
    additionalResources: "{{count}} sélections supplémentaires",
    shareTitle: "Partager l’application",
    shareDescription:
      "Partagez avec des utilisateurs ou groupes de l’organisation. Utilisez Accès externe pour les intégrations iframe.",
    shareTargetType: "Destinataire",
    shareToUsers: "Utilisateurs",
    shareToGroups: "Groupes d’utilisateurs",
    shareUserTarget: "Utilisateur destinataire",
    shareGroupTarget: "Groupe destinataire",
    shareUserSearchPlaceholder: "Rechercher par nom ou e-mail…",
    shareGroupSearchPlaceholder: "Rechercher des groupes par nom…",
    shareSaved: "Partage réussi.",
    shareGrantType: {
      user: "Utilisateur",
      user_group: "Groupe d’utilisateurs",
    },
    currentShares: "Destinataires actuels",
    noShares: "Cette application n’est encore partagée avec personne.",
    revoke: "Révoquer",
    taskUnavailable:
      "Cette application est indisponible. Vous ne pouvez pas envoyer de messages pour le moment.",
    conversationManaged: "Cette tâche est gérée par « {{name}} »",
    conversationManagedDescription:
      "Le créateur de l’application gère le modèle, les plugins, les compétences et les bases de connaissances.",
    conversationManagedUserModelDescription:
      "avec les plugins, compétences, bases de connaissances et instructions",
    externalAccess: {
      action: "Accès externe",
      title: "Accès externe à l’application",
      description:
        "Intégrez « {{name}} » à des sites autorisés pour que les utilisateurs externes n’utilisent que cette application.",
      backToApplications: "Retour aux applications",
      accessTab: "Accès et intégration",
      accessSettingsSection: "Paramètres d’accès",
      originSettingsSection: "Paramètres des sites d’origine",
      starterQuestionsSection: "Questions intégrées",
      credentialSettingsSection: "Authentification serveur",
      embedSettingsSection: "Configuration d’intégration",
      enabled: "Activer l’accès externe",
      enabledDescription:
        "Si cette option est désactivée, les pages intégrées cessent de fonctionner et les sessions ouvertes expirent.",
      authMode: "Authentification",
      authRequirementLabel: "Exigence d’authentification",
      authModeRequired: "Authentification requise",
      authModePublic: "Sans authentification",
      authRequiredDescription:
        "Adapté aux systèmes partenaires. Leur serveur vérifie la demande avant d’ouvrir l’application.",
      authPublicDescription:
        "Adapté aux pages publiques. Les sites autorisés peuvent ouvrir directement l’application sans vérification serveur distincte.",
      allowedOrigins: "Origines d’intégration autorisées",
      allowedOriginsPlaceholder:
        "https://portal.example.com\nhttps://ops.example.com",
      allowedOriginsDescription:
        "Saisissez une adresse de site par ligne. Après enregistrement, chaque adresse reçoit sa propre URL iframe et son exemple d’intégration. Utilisez HTTPS en production ; localhost est accepté pour les tests locaux.",
      starterQuestions: "Questions intégrées",
      starterQuestionsDescription:
        "Configurez jusqu’à quatre questions suggérées par origine. Elles sont affichées telles quelles et leur sélection remplit uniquement la zone de saisie.",
      starterQuestionOriginsTabsLabel: "Origines des questions intégrées",
      starterQuestionsNeedOrigin:
        "Ajoutez d’abord au moins une origine autorisée.",
      starterQuestionsEmpty: "Aucune question intégrée pour cette origine.",
      starterQuestionLabel: "Question {{index}}",
      starterQuestionPlaceholder:
        "Saisissez une question que les utilisateurs pourront sélectionner rapidement",
      starterQuestionDuplicate:
        "Les questions d’une même origine doivent être uniques.",
      starterQuestionCount: "{{count}} / {{max}} configurées",
      addStarterQuestion: "Ajouter une question",
      removeStarterQuestion: "Retirer la question {{index}}",
      appId: "Identifiant de l’application",
      appSecret: "Secret de l’application",
      secretUnavailableValue: "Régénérer pour copier",
      secretUnavailable:
        "Par sécurité, les anciens secrets ne sont plus affichés. Régénérez le secret pour obtenir sa valeur complète et transmettez-la au système partenaire.",
      rotateSecret: "Régénérer",
      rotateConfirmTitle: "Régénérer le secret de l’application ?",
      rotateConfirmDescription:
        "Après régénération, le système partenaire devra utiliser le nouveau secret et les pages intégrées ouvertes expireront.",
      changeConfirmTitle:
        "Enregistrer les paramètres de sécurité de l’accès externe ?",
      changeConfirmDescription:
        "Après enregistrement, les pages intégrées ouvertes seront vérifiées selon les nouveaux paramètres et devront peut-être être rouvertes.",
      secretRotated:
        "Secret de l’application régénéré. Les sessions externes existantes ont été révoquées.",
      embedOrigin: "Origine",
      embedOriginsTabsLabel: "Origines d’intégration",
      embedOriginTab: "Origine {{index}}",
      currentEmbedOrigin: "Origine actuelle",
      iframeUrl: "URL iframe",
      embedCode: "Exemple d’intégration",
      serverCredentialWarning:
        "Lorsque l’authentification est requise, laissez le serveur du système partenaire effectuer la vérification. Ne placez jamais le secret de l’application dans le code frontend.",
      saved: "Paramètres d’accès externe enregistrés.",
      copyFailed: "Échec de la copie. Sélectionnez le contenu manuellement.",
      snippetTitle: "Application intégrée",
      snippetTicketComment:
        "Demandez à votre backend l’identifiant d’accès pour cette visite. N’exposez jamais le secret de l’application ici.",
    },
  },
  applicationDevelopment: {
    aiWorking: "{{productName}} développe automatiquement l’application",
    actions: "Actions de l’application",
    annotations: {
      start: "Annoter",
      finish: "Quitter l’annotation",
      unavailable:
        "Cette page ne peut pas être annotée pour le moment. Rouvrez l’aperçu de l’application.",
      changed:
        "La page a changé. Effacez les annotations et quittez ce mode, puis sélectionnez à nouveau après l’actualisation de l’aperçu.",
    },
    metadata: {
      name: "Nom de l’application",
      description: "Description de l’application",
      editName: "Modifier le nom",
      editDescription: "Modifier la description",
      addDescription: "Ajouter une description",
      invalidName: "Saisissez un nom comportant entre 1 et 160 caractères.",
      invalidDescription:
        "La description ne doit pas dépasser 4 000 caractères.",
      changed:
        "L’application a changé. Rechargez-la avant de modifier à nouveau.",
      reload: "Recharger",
    },
    publish: {
      draft: "Brouillon",
      action: "Publier",
      update: "Publier la mise à jour",
      done: "Publiée",
      pending: "Publication…",
      title: "Publier l’application",
      confirm: "Publier",
      successTitle: "Publication réussie",
      successDescription:
        "« {{name}} » v{{version}} a été publiée. Vous pouvez l’utiliser depuis Mes applications.",
      description:
        "La publication rend « {{name}} » prête à l’emploi.\nVous pourrez l’ouvrir depuis Mes applications.",
      updateDescription:
        "Après publication, vous utiliserez la nouvelle version de « {{name}} ».\nApplications partagées : partagez à nouveau et demandez aux destinataires d’installer la mise à jour manuellement.\nApplications référencées : soumettez séparément une mise à jour au Centre d’applications.\nAvant de publier, vérifiez qu’aucune tâche de cette application n’est en cours.",
      checking: "Vérification des tâches en cours…",
      activeTasks:
        "Cette application a des tâches en cours. Attendez leur fin avant de publier. L’état s’actualise automatiquement.",
      checkFailed:
        "Impossible de vérifier l’état des tâches. Réessayez avant de publier.",
      changed:
        "L’application a de nouvelles modifications. Fermez et rouvrez la fenêtre de publication.",
    },
    deleteDescription:
      "L’application, son brouillon de développement et l’historique de débogage seront supprimés. Les conversations de développement, les tâches ordinaires et les fichiers de travail seront conservés.",
    tests: {
      title: "Historique des conversations de débogage",
      empty: "Aucune conversation de débogage",
      emptyHint:
        "Envoyez une tâche dans l’aperçu pour retrouver ici ses entrées, résultats et progrès.",
      current: "Conversation de débogage actuelle",
      restart: "Nouvelle conversation de débogage",
      summary: "Exécutions : {{count}}",
      submitted: "Demande de débogage envoyée",
      view: "Voir l’historique",
      more: "Charger plus d’enregistrements",
      detailHint:
        "Consultez les entrées, les sorties, les fichiers et l’activité. Vous pouvez arrêter la conversation actuelle ou traiter les demandes en attente ici.",
      delete: "Supprimer la conversation de débogage",
      deleteHint:
        "Cette conversation sera définitivement supprimée et ses ressources d’exécution nettoyées.",
      deleteDevelopmentHint:
        "Cette conversation de développement sera définitivement supprimée. L’application, le brouillon et l’historique de débogage resteront dans Mes applications pour poursuivre le développement ou les supprimer.",
      status: {
        idle: "Envoyée",
        running: "En cours",
        completed: "Terminée",
        failed: "En échec",
        interrupted: "Arrêtée",
      },
    },
    resizePreview: "Redimensionner l’aperçu de l’application",
    developmentTask: "Tâche de développement d’application",
    previewTask: "Conversation de débogage d’application",
    catalog: {
      newDevelopment: "Nouvelle version de développement",
      continueDevelopment: "Poursuivre le développement",
      developNewVersion: "Développer une nouvelle version",
      deleteDraft: "Supprimer le brouillon de développement",
      deleteDraftDescription:
        "Le brouillon et ses conversations de débogage seront supprimés. L’application publiée, les conversations de développement, les tâches ordinaires et les fichiers seront conservés.",
      draftDetails: "Brouillon de développement",
      savedAt: "Dernier enregistrement {{time}}",
      unpublishedHint:
        "Ces modifications ne sont pas encore publiées. L’utilisation de l’application ouvre toujours la version publiée.",
      filter: "Filtrer les applications",
      all: "Toutes les applications",
      developing: "En développement",
      standard: "Applications standard",
      interactive: "Applications interactives",
      draftDescription:
        "Cette application n’est pas encore publiée. Poursuivez son développement depuis son menu.",
      empty: "Aucune application correspondante",
      loadMore: "Charger plus d’applications",
    },
    create: "Créer une application interactive",
    createHint:
      "Créez par conversation, prévisualisez les changements au fur et à mesure et installez lorsque tout est prêt.",
    name: "Nom de l’application",
    start: "Commencer la création",
    creating: "Préparation…",
    continue: "Développer",
    workspace: "Espace de développement d’application",
    waitingForTest:
      "Votre conversation de débogage est en cours. Les dernières modifications apparaîtront automatiquement lorsqu’elle sera terminée.",
    debug: "Débogage",
    preview: "Aperçu",
    diagnostics: "Journaux de débogage ({{count}})",
    capabilities: "Configurer les fonctionnalités",
    capabilitiesHint:
      "Choisissez les fonctionnalités utilisables par cette application. Les sélections enregistrées s’appliquent à l’aperçu de développement et sont incluses lors de l’installation ou de la mise à jour.",
    capabilitySearch: "Rechercher et sélectionner…",
    reloadCapabilities: "Recharger la configuration",
    capabilitiesChanged:
      "L’application a changé. Rechargez la configuration avant d’enregistrer.",
    capabilityUnavailable: "Indisponible",
    capabilitiesUnavailable:
      "Certaines fonctionnalités sélectionnées sont indisponibles. Remplacez-les ou retirez-les avant d’enregistrer.",
    capabilityLimits:
      "Choisissez au maximum 50 plugins et compétences au total, 20 bases de connaissances et 20 serveurs MCP.",
    capabilityHints: {
      plugin:
        "Connectez les services et outils nécessaires à cette application.",
      skill: "Choisissez les compétences pour les tâches de l’application.",
      knowledge_base:
        "Choisissez les bases que cette application peut consulter.",
      mcp_server:
        "Choisissez les serveurs MCP que cette application peut appeler.",
    },
    sourceError:
      "Les modifications actuelles ne peuvent pas encore être exécutées. Demandez à l’assistant de corriger l’application. L’aperçu montre la dernière version fonctionnelle.",
    preparing: "Préparation de l’aperçu",
    preparingHint:
      "Votre application apparaîtra ici lorsqu’elle sera prête. Configurez d’abord les plugins ou bases nécessaires.",
    noErrors: "Aucun journal de débogage",
    noErrorsHint:
      "Essayez votre application dans l’aperçu. Les erreurs d’exécution sont enregistrées ici et l’assistant peut les examiner pour aider au diagnostic.",
  },
} as const
