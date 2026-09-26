export const operationsResources = {
  usage: {
    title: "Analyse de l’utilisation",
    description:
      "Consultez les tâches, tours, jetons et coûts des modèles, globalement et par application, groupe actuel ou utilisateur.",
    sectionLabel: "Analyse de l’utilisation et facturation",
    sections: { analytics: "Analyse de l’utilisation", billing: "Facturation" },
    billing: {
      pageDescription:
        "Consultez les relevés mensuels par modèle, prévisualisez-les en ligne et exportez-les en PDF.",
      period: "Période de facturation",
      total: "Total du relevé",
      modelCount: "Modèles",
      generatedAt: "Généré",
      current: {
        title: "Période de facturation actuelle",
        description:
          "Le relevé est généré automatiquement à la clôture du mois civil.",
        open: "En cours",
        expectedGeneration: "Génération prévue",
      },
      history: {
        title: "Relevés mensuels",
        description:
          "Instantanés mensuels immuables de l’utilisation et des frais des modèles.",
        empty: "Aucun relevé mensuel généré pour le moment.",
      },
      detail: {
        title: "Détails du relevé",
        description: "Chargement des détails du relevé…",
      },
      columns: {
        model: "Modèle",
        input: "Jetons d’entrée",
        cached: "Jetons en cache",
        output: "Jetons de sortie",
        totalTokens: "Total des jetons",
        pricing: "Tarification",
        amount: "Montant",
      },
      uniformPricing: "Tarif fixe",
      mixedPricing: "Tarifs multiples",
      preview: { action: "Prévisualiser en ligne" },
      export: {
        action: "Exporter en PDF",
        success: "Relevé PDF exporté.",
        filename: "{{statementNumber}}-releve.pdf",
      },
      pdf: {
        statement: "Relevé mensuel",
        accountStatement: "Relevé d’utilisation des modèles",
        statementNumber: "Numéro du relevé",
        billingPeriod: "Période de facturation",
        generatedAt: "Généré le",
        currency: "Devise",
        pricePerMillion: "Tarif par million de jetons",
        inputShort: "Entrée",
        cachedShort: "Cache",
        outputShort: "Sortie",
        totalAmount: "Total du relevé",
        unpricedNote:
          "{{tokens}} jetons sans tarif enregistré sont exclus du montant dû.",
        page: "Page {{current}} sur {{total}}",
        footer:
          "Généré automatiquement par LinkSense à partir des tarifs enregistrés lors de chaque appel.",
      },
    },
    rangeLabel: "Période du rapport",
    ranges: {
      all: "Depuis le début",
      sevenDays: "7 derniers jours",
      thirtyDays: "30 derniers jours",
      custom: "Période personnalisée",
    },
    customRange: {
      dateFrom: "Date de début",
      dateTo: "Date de fin",
      selectDate: "Sélectionner une date",
      clearDate: "Effacer la date",
    },
    export: {
      action: "Exporter en Excel",
      exporting: "Export…",
      success: "Analyse de l’utilisation exportée.",
      filename: "{{productPrefix}}-analyse-utilisation-{{date}}.xlsx",
    },
    tasks: "Tâches",
    turns: "Tours",
    modelCalls: "Appels aux modèles",
    totalTokens: "Total des jetons",
    totalCost: "Coût total",
    inputCost: "Coût d’entrée",
    cachedInputCost: "Coût d’entrée en cache",
    outputCost: "Coût de sortie",
    sort: {
      asc: "Trier {{field}} par ordre croissant",
      desc: "Trier {{field}} par ordre décroissant",
    },
    tasksHint:
      "Tâches créées pendant la période ; leur suppression ultérieure ne modifie pas l’historique",
    turnsHint:
      "Tours effectifs créés pendant la période ; leur suppression ultérieure ne modifie pas l’historique",
    tokensHint:
      "Inclut les réponses, la vectorisation des documents et requêtes, et le reclassement",
    costHint:
      "Somme des coûts calculés au tarif enregistré pour chaque appel ; les changements de prix ultérieurs ne modifient pas l’historique",
    unpricedTokensHint:
      "{{tokens}} jetons sans tarif enregistré sont exclus du coût",
    unpricedShort: "{{tokens}} sans tarif",
    trend: {
      title: "Évolution de l’utilisation des jetons",
      description:
        "Totaux de jetons de la période, regroupés {{granularity}} et empilés par type d’activité du modèle.",
      empty: "Aucune utilisation de jetons sur cette période.",
      ariaLabel: "Évolution des jetons sur la période sélectionnée",
      granularity: { day: "par jour", month: "par mois", year: "par année" },
    },
    costTrend: {
      title: "Évolution des coûts",
      description:
        "Coûts historiques enregistrés lors des appels, regroupés {{granularity}} et empilés par type d’activité du modèle.",
      empty: "Aucun coût de modèle sur cette période.",
      ariaLabel: "Évolution des coûts des modèles sur la période sélectionnée",
    },
    tabsLabel: "Axes d’analyse de l’utilisation",
    tabs: {
      models: "Par modèle",
      workloads: "Par activité",
      applications: "Par application",
      groups: "Par groupe",
      users: "Par utilisateur",
    },
    modelsTitle: "Utilisation de tous les modèles",
    modelsDescription:
      "Appels, répartition des jetons et coûts de chaque modèle de génération, vectorisation et reclassement.",
    tableCostUnit: "Unité des coûts : USD (dollars).",
    modelsEmpty: "Aucune utilisation de modèle sur cette période.",
    workloadsTitle: "Utilisation par activité du modèle",
    workloadsDescription:
      "Distingue les réponses de l’IA, le nommage des tâches, la création de souvenirs, la vectorisation des documents et requêtes, et le reclassement des résultats. L’utilisation est marquée comme estimée si le fournisseur ne la transmet pas.",
    workloadsEmpty: "Aucune activité de modèle sur cette période.",
    applicationsTitle: "Utilisation des applications",
    applicationsDescription:
      "Récapitule les tâches, tours, appels, jetons et coûts selon l’application associée à la création de chaque tâche. L’utilisation hors application figure séparément.",
    applicationsEmpty: "Aucune utilisation d’application sur cette période.",
    applicationDetailDescription:
      "Utilisation des modèles pour les tâches associées à cette application",
    application: "Application",
    unattributedApplication: "Sans application associée",
    workload: "Activité du modèle",
    workloads: {
      assistant_response: "Réponses de l’IA",
      memory_generation: "Création de souvenirs",
      task_title_generation: "Nommage automatique des tâches",
      document_embedding: "Vectorisation des documents",
      query_embedding: "Vectorisation des requêtes",
      rerank: "Reclassement des résultats",
      image_generation: "Génération d’images",
    },
    modelKinds: {
      generation: "Modèle de génération",
      embedding: "Modèle de vectorisation",
      rerank: "Modèle de reclassement",
      image: "Modèle d’image",
    },
    measurementMethod: "Mesure",
    measurementMethods: {
      provider: "Déclarée par le fournisseur",
      estimated: "Estimée localement",
    },
    groupsTitle: "Utilisation des groupes",
    groupsDescription:
      "Calculée à partir des appartenances actives actuelles. Un utilisateur peut figurer dans plusieurs groupes ; les lignes de groupes ne doivent donc pas être additionnées pour calculer le total global.",
    currentMembership: "Appartenance actuelle",
    groupDetailDescription:
      "Utilisation des modèles pour {{count}} membres actuels",
    usersTitle: "Utilisation des utilisateurs",
    usersDescription:
      "Tâches, tours et jetons des modèles pour chaque utilisateur.",
    searchUsers: "Rechercher par nom ou e-mail",
    usersEmpty: "Aucun utilisateur correspondant.",
    modelBreakdown: "Répartition par modèle",
    model: "Modèle",
    inputTokens: "Jetons d’entrée",
    cachedInputTokens: "Jetons d’entrée en cache",
    outputTokens: "Jetons de sortie",
    reasoningOutputTokens: "Jetons de raisonnement en sortie",
    group: "Groupe",
    members: "Membres",
    ungrouped: "Utilisateurs sans groupe",
    unknownModel: "Modèle inconnu",
    noSelection: "Aucune donnée disponible",
    tokenCompositionNote:
      "Les jetons d’entrée en cache sont inclus dans les jetons d’entrée, et les jetons de raisonnement dans les jetons de sortie ; ils ne sont pas ajoutés une seconde fois au total. Les nombres de tâches et tours reposent sur des enregistrements de création immuables ; supprimer une tâche ne réduit donc pas l’historique.",
    costCompositionNote:
      "Les coûts sont stockés et agrégés à pleine précision, puis affichés avec deux décimales. Les écarts d’arrondi sont répartis proportionnellement pour que les détails affichés correspondent au total. Le coût d’entrée ordinaire exclut l’entrée en cache, facturée à son propre tarif. Prix et coûts sont fixés lors de l’enregistrement de chaque appel ; les changements ultérieurs ne recalculent jamais l’historique.",
  },
  health: {
    title: "État du système",
    description:
      "Vue en lecture seule des services et répertoires gérés de {{productName}}.",
    overall: "État général",
    checkedAt: "Vérifié",
    runningTurns: "Tours en cours",
    processes: "Processus app-server",
    concurrency: "Limite de simultanéité",
    healthy: "Opérationnel",
    warning: "Avertissement",
    unavailable: "Indisponible",
    notConfigured: "Non configuré",
    notObserved: "Non observé",
    degraded: "Dégradé",
    available: "Disponible",
    cleanupFailures: "Échecs de nettoyage",
    cleanupDescription:
      "Les tentatives automatiques ont cessé pour ces ressources. Une relance traite uniquement la tâche concernée, sans interrompre les autres tâches actives.",
    retryCleanup: "Relancer le nettoyage",
    retryAllCleanup: "Tout relancer",
    retryingCleanup: "Relance du nettoyage",
    cleanupRetryAllConfirmTitle: "Relancer tous les nettoyages en échec",
    cleanupRetryAllConfirmDescription:
      "Le système vérifiera l’état de chaque élément puis réessaiera. Une tâche encore active sera différée et les autres ne seront pas interrompues.",
    cleanupAttempts: "{{current}} / {{total}} tentatives",
    cleanupFailed: "Intervention nécessaire",
    cleanupStages: {
      reconcile: "Vérification de l’état des ressources",
      stop_runtime: "Arrêt sécurisé de la tâche concernée",
      delete_workspace: "Suppression des fichiers de la tâche",
      delete_control: "Suppression de l’état d’exécution",
      verify_absent: "Vérification du nettoyage",
    },
    cleanupReasons: {
      CLEANUP_RUNNER_UNAVAILABLE:
        "Le service de nettoyage est temporairement indisponible",
      CLEANUP_RUNTIME_ACTIVE:
        "La tâche concernée est toujours active ; ses ressources ont été protégées",
      CLEANUP_RUNTIME_STATE_UNCERTAIN:
        "L’arrêt sûr de la tâche n’a pas encore pu être confirmé",
      CLEANUP_PERMISSION_DENIED:
        "Impossible de supprimer la ressource ; vérifiez les permissions de stockage",
      CLEANUP_PATH_BOUNDARY_INVALID:
        "Impossible de valider l’emplacement de la ressource",
      CLEANUP_DIRECTORY_REMOVE_FAILED:
        "Les fichiers de la tâche n’ont pas pu être entièrement supprimés",
      CLEANUP_VERIFICATION_FAILED:
        "Impossible de vérifier le résultat du nettoyage",
      CLEANUP_QUEUE_UNAVAILABLE: "Impossible de mettre le nettoyage en attente",
      CLEANUP_OPERATION_FAILED: "Le nettoyage des ressources n’a pas abouti",
      unknown: "Le nettoyage des ressources n’a pas abouti",
    },
    resources: {
      title: "Utilisation des ressources des services",
      description:
        "Utilisation en direct du processeur, de la mémoire et des processus des conteneurs Docker.",
      empty: "Aucune utilisation des ressources Docker observée.",
      cpu: "Processeur",
      memory: "Mémoire",
      containers: "{{running}} / {{total}} conteneurs en cours",
      pids: "PID {{count}}",
      state: "État {{state}}",
      checkedAt: "Ressources mesurées",
      status: {
        available: "Observé",
        unavailable: "Indisponible",
        notObserved: "Non observé",
      },
      reasons: {
        unavailable:
          "Impossible de lire les mesures Docker. Vérifiez le montage et les permissions du socket Docker du contrôleur d’exécution.",
        notObserved:
          "Aucune mesure exploitable des ressources des conteneurs Docker n’a été observée.",
      },
      services: {
        api: "Conteneur API",
        runner: "Contrôleur d’exécution",
        workerPool: "Pool de workers",
        web: "Conteneur Web",
        gateway: "Conteneur de passerelle",
        postgres: "Conteneur PostgreSQL",
        redis: "Conteneur Redis",
        postgresBackup: "Conteneur de sauvegarde PostgreSQL",
        migrate: "Conteneur de migration",
        backupInit: "Conteneur d’initialisation des sauvegardes",
        storageInit: "Conteneur d’initialisation du stockage",
        runnerWorkerImage: "Conteneur de construction de l’image worker",
      },
    },
    knowledgeRebuild: {
      title: "Reconstruction complète de l’index vectoriel",
      description:
        "Maintenance explicite lors d’un changement de modèle de vectorisation ou de dimension. Seule la progression globale du déploiement est affichée.",
      action: "Lancer la reconstruction complète",
      retry: "Réessayer manuellement",
      empty: "Aucune reconstruction globale des connaissances n’a été lancée.",
      confirmTitle: "Confirmer la reconstruction complète de l’index vectoriel",
      confirmDescription:
        "Cette opération inclut toujours tous les documents non supprimés, y compris ceux des bases archivées, et suspend la recherche vectorielle globale pendant son exécution.",
      confirmWarning:
        "L’index vectoriel sera effacé puis recréé. Les originaux, résultats Docling et contenus analysés ne seront pas supprimés, mais l’ancien index ne pourra pas être restauré.",
      confirmAction: "Confirmer et lancer la reconstruction",
      reason: "Motif",
      reasonHint:
        "Obligatoire. Le motif est consigné dans une entrée d’audit expurgée.",
      total: "Total",
      succeeded: "Réussis",
      failed: "Échoués",
      errorSummary: "Code d’erreur stable : {{code}}",
      status: {
        pending: "En attente",
        queued: "En file d’attente",
        running: "En cours",
        completed: "Terminée",
        failed: "En échec",
      },
      stage: {
        queued: "En attente de démarrage",
        preparing: "Préparation de la reconstruction complète",
        recreating_index: "Recréation de l’index vectoriel",
        rebuilding_documents: "Reconstruction de tous les index documentaires",
        validating: "Validation des résultats",
        activating: "Activation du nouvel index",
        completed: "Reconstruction complète terminée",
        failed: "Échec de la reconstruction complète",
        processing: "Reconstruction complète en cours",
      },
    },
    components: {
      api: "Service API",
      public_url: "Sécurité de la connexion",
      database: "Base de données",
      redis: "Redis et protection de la connexion locale",
      running_turn_capacity: "Capacité des tours en cours",
      running_turn_recovery: "Récupération des tours en cours",
      smtp: "E-mails d’authentification",
      auth_email: "E-mails de mot de passe",
      local_password_login: "Connexion par mot de passe local",
      runner: "Service d’exécution",
      workspace: "Racine de l’espace de travail",
      capability_root: "Racine d’installation des plugins et compétences",
      oidc: "Connexion OIDC",
      teams: "Connexion Teams",
      workspace_root: "Racine de l’espace de travail",
      document_parsing: "Analyse des documents de connaissances",
      knowledge_search_and_indexing:
        "Recherche et indexation des connaissances",
      rerank: "Reclassement des résultats de connaissances",
    },
    reasons: {
      public_url_insecure:
        "Ce site utilise HTTP : identifiants, conversations et fichiers ne sont pas chiffrés pendant le transfert. Les fonctions principales restent disponibles ; configurez HTTPS avant de l’exposer à Internet.",
      auth_https_required:
        "Ce site utilise HTTP. Configurez HTTPS pour utiliser la connexion OIDC ou Teams.",
      not_configured: "Cette fonctionnalité facultative n’est pas configurée.",
      not_observed:
        "Aucun cycle de récupération partagé réussi n’a encore été observé.",
      connection_failed:
        "La vérification de connexion a échoué. Vérifiez la configuration du déploiement et le service.",
      read_write_failed:
        "La vérification de lecture/écriture du répertoire a échoué. Vérifiez les montages et permissions.",
      login_protection_unavailable:
        "Redis est indisponible ; la protection et la connexion par mot de passe local sont donc indisponibles.",
      email_unavailable:
        "Les nouvelles demandes d’e-mail de définition ou de réinitialisation de mot de passe sont indisponibles.",
      available: "La vérification a réussi.",
      document_parsing_unavailable:
        "L’analyse des documents est indisponible. Vérifiez la configuration et le service Docling Serve.",
      knowledge_search_and_indexing_unavailable:
        "La recherche et l’indexation sont indisponibles. Vérifiez Elasticsearch, la configuration du modèle de vectorisation et leurs services.",
      embedding_dimension_mismatch:
        "La dimension des vecteurs produits ne correspond pas à celle de l’index Elasticsearch. Corrigez la configuration puis reconstruisez manuellement l’index vectoriel.",
      rerank_unavailable:
        "Le reclassement des résultats est indisponible. Vérifiez la configuration et le service du modèle de reclassement.",
    },
    cleanupTypes: {
      workspace: "Espace de travail de la tâche",
      codex_home: "Répertoire d’exécution utilisateur",
      object_storage: "Ressource du stockage d’objets",
      capability_directory: "Répertoire du plugin ou de la compétence",
    },
  },
} as const
