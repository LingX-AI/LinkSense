export const settingsResources = {
  automation: {
    title: "Automatisations",
    description:
      "Planifiez des tâches récurrentes, définissez des rappels et suivez ce qui compte.",
    create: "Nouvelle automatisation",
    createTitle: "Nouvelle automatisation",
    editTitle: "Modifier l’automatisation",
    editorDescription:
      "Configurez les instructions, la tâche associée et la fréquence personnalisée.",
    resizeEditor: "Redimensionner l’éditeur d’automatisation",
    empty: "Aucune automatisation",
    emptyDescription:
      "Créez une automatisation pour lancer une nouvelle exécution dans une tâche dédiée aux horaires prévus.",
    suggestions: {
      title: "Suggestions",
      useTemplateNamed: "Utiliser le modèle {{name}}",
      dailyBrief: {
        title: "Point quotidien",
        schedule: "En semaine à 08:00",
        description:
          "Commencez chaque journée de travail par un résumé de votre agenda, de vos e-mails non lus et de vos priorités",
        instruction:
          "Examine mon agenda, mes e-mails non lus et mes priorités. Prépare un bref point quotidien résumant le programme du jour, les messages qui nécessitent une réponse et les tâches les plus importantes.",
      },
      weeklyReview: {
        title: "Bilan hebdomadaire",
        schedule: "Le vendredi à 16:00",
        description:
          "Chaque vendredi, résumez le travail récent de la semaine dans un bref bilan",
        instruction:
          "Examine les progrès de cette semaine, les travaux achevés, les éléments en suspens et les priorités de la semaine prochaine, puis présente-les dans un bref bilan.",
      },
      followUpMonitor: {
        title: "Suivi des actions",
        schedule: "En semaine à 09:00",
        description:
          "Examinez les e-mails et les événements récents pour repérer les éléments nécessitant votre attention",
        instruction:
          "Examine les e-mails et les événements récents de mon agenda. Repère les éléments qui nécessitent un suivi, dont l’échéance approche ou qui méritent mon attention, puis résume-les par ordre de priorité.",
      },
    },
    filterLabel: "Filtrer les automatisations",
    filter: { all: "Toutes", active: "Actives", paused: "En pause" },
    filteredEmpty: "Aucune automatisation : {{filter}}",
    filteredEmptyDescription:
      "Changez de filtre pour voir vos autres automatisations.",
    name: "Titre de l’automatisation",
    instruction: "Instructions de l’automatisation",
    instructionHint:
      "Décrivez l’intégralité de la tâche à effectuer à chaque déclenchement.",
    runIn: "Exécuter dans",
    task: "Tâche",
    targetTask: "Tâche",
    existingTask: "Tâche existante",
    newTask: "Nouvelle tâche",
    existingTaskHint:
      "Seules les tâches actives épinglées appartenant à votre compte peuvent être sélectionnées.",
    newTaskHint:
      "La tâche est créée et épinglée une seule fois, puis réutilisée à chaque déclenchement.",
    noPinnedTasks:
      "Aucune tâche disponible. Épinglez une tâche ou sélectionnez Nouvelle tâche.",
    selectTask: "Sélectionner une tâche épinglée",
    repeat: "Répétition",
    interval: "Tous les",
    intervalHint: "Intervalle d’exécution de 1 à 999 {{unit}}.",
    minuteOfHour: "Minute dans l’heure",
    minuteOfHourHint:
      "Saisissez un nombre de 0 à 59. Par exemple, 15 lance l’exécution à la quinzième minute de chaque cycle.",
    time: "Heure",
    hour: "Heure",
    minute: "Minute",
    weekdays: "Jours d’exécution",
    dayOfMonth: "Jour",
    monthOfYear: "Mois",
    invalidMonthDayHint: "Les mois qui ne comportent pas ce jour sont ignorés.",
    monthOption: "Mois {{month}}",
    dayOption: "Jour {{day}}",
    expiresEnabled: "Définir une date d’expiration",
    expiresEnabledHint:
      "Des exécutions peuvent encore avoir lieu le jour de l’expiration ; elles cessent le lendemain.",
    expiresOn: "Date d’expiration",
    expiresOnPlaceholder: "Sélectionner une date d’expiration",
    clearExpiresOn: "Effacer la date d’expiration",
    timeZone: "Exécution dans le fuseau horaire {{timeZone}}.",
    modelOverride: "Choisir le modèle et l’effort de raisonnement",
    modelOverrideHint:
      "Une fois cette option activée, les exécutions utilisent le modèle et l’effort de raisonnement sélectionnés. Sinon, les paramètres par défaut de votre compte s’appliquent.",
    modelOverrideUnavailable:
      "Aucun modèle disponible. Configurez un fournisseur de modèles dans les paramètres d’administration.",
    modelOverrideLoading: "Chargement des modèles disponibles…",
    modelLabel: "Modèle",
    modelNotSelected: "Sélectionner un modèle",
    reasoningEffortLabel: "Effort de raisonnement",
    reasoningEffortNotSelected: "Sélectionner un effort de raisonnement",
    nextRun: "Prochaine exécution",
    lastRun: "Dernière exécution",
    nextRunRelative: "Prochaine exécution {{relative}}",
    lastRunRelative: "Dernière exécution {{relative}}",
    lastRunFailed: "Échec de la dernière exécution",
    lastRunEmptyResult: "Échec de la dernière exécution : aucun résultat",
    pause: "Suspendre",
    resume: "Reprendre",
    pauseNamed: "Suspendre {{name}}",
    resumeNamed: "Reprendre {{name}}",
    runNow: "Exécuter maintenant",
    runNowLoading: "Exécution de l’automatisation…",
    runNowStarted: "« {{name}} » a démarré.",
    runNowQueued: "« {{name}} » a été mise en attente dans sa tâche.",
    openTask: "Ouvrir la tâche",
    moreActionsNamed: "Autres actions pour {{name}}",
    editNamed: "Modifier {{name}}",
    deleteNamed: "Supprimer {{name}}",
    deleteTitle: "Supprimer l’automatisation",
    deleteDescription:
      "Supprimer « {{name}} » ? La tâche associée et son historique seront conservés.",
    validation:
      "Complétez les paramètres de l’automatisation et vérifiez les nombres, les dates et les heures.",
    weekdaySeparator: ", ",
    status: { active: "Active", paused: "En pause" },
    frequency: {
      hourly: "Chaque heure",
      daily: "Chaque jour",
      weekly: "Chaque semaine",
      monthly: "Chaque mois",
      yearly: "Chaque année",
    },
    unit: {
      hourly: "heures",
      daily: "jours",
      weekly: "semaines",
      monthly: "mois",
      yearly: "années",
    },
    weekday: {
      "1": "Lun",
      "2": "Mar",
      "3": "Mer",
      "4": "Jeu",
      "5": "Ven",
      "6": "Sam",
      "7": "Dim",
    },
    schedule: {
      hourly: "Toutes les {{interval}} heure(s), à la minute {{minute}}",
      daily: "Tous les {{interval}} jour(s) à {{time}}",
      weekly: "Toutes les {{interval}} semaine(s), {{weekdays}} à {{time}}",
      monthly: "Tous les {{interval}} mois, le {{day}} à {{time}}",
      yearly: "Tous les {{interval}} an(s), le {{day}}/{{month}} à {{time}}",
    },
  },
  quotaManagement: {
    save: "Enregistrer les paramètres",
    title: "Gestion des quotas",
    description:
      "Gérez le quota hebdomadaire commun aux membres et le tarif de conversion des crédits.",
    conversionTitle: "Conversion des crédits",
    conversionDescription:
      "Convertissez les coûts d’utilisation des modèles en crédits. Les changements de tarif ne s’appliquent qu’aux consommations futures ; les frais existants restent inchangés.",
    creditPrice: "Montant par crédit (CNY)",
    conversionExample:
      "Par exemple, à 0,01 CNY par crédit, des frais de 0,25 CNY consomment 25 crédits.",
    members: {
      actions: "Actions sur les quotas des membres",
      reset: "Réinitialiser tous les quotas",
      resetDescription:
        "Rétablissez le quota hebdomadaire de chaque membre existant à 100 % de sa propre limite actuelle. Les membres sans limite restent sans limite. Les limites non enregistrées de ce formulaire ne s’appliquent pas à cette réinitialisation. L’historique est conservé et les consommations suivantes seront déduites normalement.",
      title: "Quota hebdomadaire des membres",
      description:
        "Quota hebdomadaire par défaut des membres créés, importés ou inscrits après cet enregistrement. Utilisez le menu en haut à droite pour l’appliquer à tous les membres existants, ou ajustez leurs quotas individuellement ou en lot dans la gestion des utilisateurs.",
    },
    weekly_credit_limit: "Quota hebdomadaire (crédits)",
    weekly_credit_limit_hint:
      "Réinitialisé le lundi à minuit dans le fuseau horaire du système.",
    unlimited: "Illimité",
    invalidAmount:
      "Saisissez un montant positif comportant au plus 6 décimales, inférieur ou égal à 9 223 372 036 854,775807.",
    applyMembers: "Appliquer la limite à tous",
    applyDescription:
      "Enregistrez {{weekly}} comme quota hebdomadaire par défaut et remplacez le quota de tous les membres existants, y compris leurs ajustements individuels. Les crédits utilisés ne sont pas réinitialisés ; les autres paramètres du formulaire restent inchangés.",
    confirmReset: "Confirmer la réinitialisation des quotas",
    resetHint:
      "La confirmation rétablit immédiatement les crédits disponibles et conserve l’historique d’utilisation.",
    confirmApply: "Confirmer l’enregistrement et l’application",
    resetSuccess: "Quotas réinitialisés pour {{count}} membres.",
    applySuccess:
      "Nouvelle limite enregistrée et appliquée à {{count}} membres.",
    refreshFailed:
      "L’action a abouti, mais la page n’a pas pu être actualisée. Rechargez-la pour voir les quotas à jour.",
    saved: "Paramètres des quotas enregistrés.",
    enforcementHint:
      "Une valeur vide signifie illimité. Lorsque la limite hebdomadaire est atteinte, les nouvelles tâches sont bloquées ; les tâches en cours continuent. La consommation est arrondie au 0,000001 crédit supérieur.",
  },
  settings: {
    navigationLabel: "Navigation des paramètres de {{productName}}",
    navigation: "Navigation des paramètres",
    backToApp: "Retour à {{productName}}",
    search: "Rechercher dans les paramètres",
    personalGroup: "Personnel",
    administrationGroup: "Administration",
    usageDescription:
      "Consulter les tâches, les tours et les jetons utilisés par modèle",
    general: "Général",
    generalDescription:
      "Langue de l’interface, gestion des messages et notifications du navigateur",
    profile: "Profil",
    profileDescription: "Profil et utilisation personnelle",
    personalization: "Personnalisation",
    personalizationDescription: "Instructions personnalisées et mémoire",
    appearance: "Apparence",
    appearanceDescription: "Thème de l’interface et taille de police",
    security: "Sécurité",
    securityDescription: "Modifier le mot de passe de connexion",
    credentials: "Identifiants des plugins",
    credentialsDescription: "Gérer les identifiants personnels des plugins",
    mcp: "MCP",
    mcpDescription: "Gérer les serveurs MCP personnels HTTP et STDIO",
    channelAccess: "Canaux de messagerie",
    channelAccessDescription:
      "Gérer Weixin, WeCom, DingTalk, Teams, Feishu et les autres canaux",
    capabilitiesDescription:
      "Parcourir le Centre de plugins et gérer les plugins et compétences personnels",
    archivedDescription: "Consulter les tâches archivées",
    usersDescription:
      "Gérer les comptes, les rôles et les états des utilisateurs",
    rolesDescription:
      "Consulter les rôles fixes et les limites des autorisations",
    groupsDescription: "Gérer les groupes d’utilisateurs et leurs membres",
    usersAndGroupsDescription:
      "Gérer les comptes, les rôles, les états et l’appartenance aux groupes",
    adminCapabilitiesDescription:
      "Examiner les publications et gérer le Centre de plugins",
    adminKnowledgeBasesDescription:
      "Administrer les bases de connaissances des utilisateurs et configurer les sources externes",
    adminKnowledgeSourcesDescription:
      "Configurer SharePoint et les autres sources de connaissances externes",
    auditDescription: "Rechercher dans les journaux d’audit des utilisateurs",
    feedbackDescription:
      "Consulter les avis des utilisateurs et les captures des problèmes",
    modelSettings: "Paramètres des modèles",
    modelSettingsDescription:
      "Gérer le service de modèles, les modèles et les efforts de raisonnement",
    systemSettings: "Paramètres système",
    systemSettingsDescription: "Paramètres du produit et de l’authentification",
    systemHealth: "État du système",
    systemHealthDescription: "État des services et des dépendances",
    systemUpdate: "Mise à jour du système",
    systemUpdateDescription:
      "Rechercher de nouvelles versions et consulter les conseils de mise à jour",
    noResults: "Aucun paramètre ne correspond à votre recherche.",
    generalPageDescription:
      "Gérez les préférences d’interface propres à votre compte.",
    interfaceLanguage: "Langue de l’interface",
    interfaceLanguageDescription: "Langue d’affichage de l’application",
    runningMessageAction: "Nouveaux messages pendant une exécution",
    runningMessageActionDescription:
      "Lorsqu’une tâche est en cours, les nouveaux messages suivent automatiquement cette préférence, sans demander de choisir une action.",
    runningMessageActionSteer: "Orienter l’exécution en cours",
    runningMessageActionQueue: "Mettre en attente pour la prochaine demande",
    profilePageDescription: "Modifiez votre nom d’affichage et votre avatar.",
    taskAutoNaming: "Nommage automatique des tâches",
    taskAutoNamingDescription:
      "Nommez les tâches au premier message ou actualisez leur nom à chaque nouveau message. Les noms modifiés manuellement restent inchangés.",
    taskAutoNamingFrequency: "Fréquence de nommage",
    taskAutoNamingFirstMessage: "Premier message",
    taskAutoNamingEveryMessage: "Chaque message",
    taskAutoNamingSaved: "Préférence de nommage enregistrée.",
    personalizationPageDescription:
      "Configurez le nommage des tâches, les instructions personnalisées et la mémoire.",
    customInstructions: "Instructions personnalisées",
    customInstructionsDescription:
      "Ajoutez des consignes et du contexte pour toutes vos prochaines tâches. Les règles de la plateforme et les limites de sécurité applicables à chaque tâche restent prioritaires.",
    customInstructionsPlaceholder:
      "Par exemple : Reste concis ; commence par la conclusion, puis ajoute les précisions nécessaires.",
    customInstructionsCount: "{{count}} / {{max}}",
    customInstructionsSaved: "Instructions personnalisées enregistrées",
    unsavedChangesTitle: "Abandonner les modifications non enregistrées ?",
    unsavedChangesDescription:
      "Les modifications non enregistrées de vos instructions personnalisées seront perdues si vous quittez cette page.",
    stayOnPage: "Rester sur la page",
    discardChanges: "Abandonner les modifications",
    memory: "Mémoire",
    memoryDescription:
      "Configurez la création, la conservation et l’utilisation de vos souvenirs personnels.",
    enableMemories: "Activer la mémoire",
    enableMemoriesDescription:
      "Créez des souvenirs à partir des tâches et réutilisez-les dans de futures tâches. Les tâches utilisant des outils externes ou du contenu Web ne créent pas de souvenirs.",
    resetMemories: "Réinitialiser la mémoire",
    resetMemoriesDescription:
      "Supprimez tous vos souvenirs sans supprimer les tâches, les instructions personnalisées, les plugins ni les compétences.",
    reset: "Réinitialiser",
    resetMemoriesConfirmTitle: "Réinitialiser tous les souvenirs ?",
    resetMemoriesConfirmDescription:
      "Cette action est irréversible. Vos tâches, instructions personnalisées, plugins et compétences seront conservés.",
    resettingMemories: "Réinitialisation de la mémoire…",
    memoriesReset: "Mémoire réinitialisée",
    appearancePageDescription:
      "Choisissez le thème de {{productName}} et la taille de police de base.",
    theme: "Thème",
    themeSystem: "Système",
    themeLight: "Clair",
    themeDark: "Sombre",
    uiFontSize: "Taille de police de l’interface",
    uiFontSizeDescription:
      "Réglez la taille de police de base de {{productName}}, entre {{min}} et {{max}} px.",
    uiFontSizeUnit: "px",
    securityPageDescription:
      "Modifiez votre mot de passe local et révoquez les sessions de connexion existantes.",
  },
  browserNotifications: {
    settingsTitle: "Notifications du navigateur",
    settingsDescription:
      "Lorsque vous n’utilisez pas activement LinkSense, ce navigateur vous avertit quand une tâche ou une automatisation réussit, échoue ou est interrompue.",
    promptMessage:
      "Recevez une notification du navigateur et un son à la fin des tâches.",
    promptDismiss: "Pas maintenant",
    promptEnable: "Activer",
    promptEnabling: "Activation",
    enable: "Activer les notifications du navigateur",
    unsupported:
      "Les notifications ne sont pas prises en charge par ce navigateur ou cet environnement hôte. Ouvrez LinkSense sur une page sécurisée d’un navigateur compatible.",
    permissionDenied:
      "Le navigateur bloque les notifications. Autorisez-les dans les permissions de ce site, puis revenez ici et réessayez.",
    permissionDismissed:
      "Les notifications n’ont pas été autorisées. Réactivez cette option, puis choisissez Autoriser dans la demande du navigateur.",
    permissionRequired:
      "Votre préférence est enregistrée, mais l’autorisation du navigateur a été réinitialisée. Désactivez puis réactivez les notifications pour accorder l’autorisation.",
    permissionError:
      "Impossible de demander l’autorisation d’envoyer des notifications. Réessayez plus tard.",
    storageError:
      "Impossible d’enregistrer ce paramètre dans le navigateur. Les notifications sont arrêtées sur cette page ; actualisez-la et vérifiez à nouveau l’option.",
    deliveryError:
      "Le navigateur n’a pas pu créer de notification système ; les notifications restent désactivées. Vérifiez les permissions du site et les paramètres de notification du système pour ce navigateur.",
    feedError:
      "Impossible de joindre le service de notification de fin des tâches ; les notifications restent désactivées. Vérifiez votre connexion et réessayez.",
    testTitle: "{{productName}} · Test de notification",
    testBody:
      "Les notifications sont connectées. Vous serez averti ici lorsqu’une tâche ou une automatisation produira un résultat.",
    testSent:
      "Une notification de test a été envoyée au système. Si vous ne l’avez pas vue, vérifiez les paramètres de notification du système pour ce navigateur.",
    notificationTitle: "{{productName}} · {{taskTitle}}",
    statusCompletedBody: "Traitement réussi",
    statusFailedBody: "Échec du traitement",
    statusInterruptedBody: "Traitement interrompu",
  },
  bootstrap: {
    unavailableTitle: "{{productName}} est temporairement indisponible",
    unavailableDescription:
      "Impossible de se connecter à {{productName}}. Patientez un instant ou réessayez.",
  },
  maintenance: {
    title: "Maintenance du système",
    indicatorLabel: "Maintenance du système activée",
    dialogTitle: "Maintenance du système activée",
    dialogDescription:
      "Les utilisateurs ordinaires ne peuvent pas accéder au système pour le moment. Vous pouvez continuer à l’utiliser et à l’administrer. Désactivez le mode maintenance lorsque vous avez terminé.",
    reasonLabel: "Détails de la maintenance",
    doNotShowAgain: "Ne plus afficher",
    rememberFailed:
      "Impossible d’enregistrer votre préférence. Vérifiez que votre navigateur autorise les données du site. Vous pouvez fermer ce rappel avec le bouton en haut à droite.",
    openSettings: "Paramètres de maintenance",
    defaultReason: "Une maintenance planifiée du système est en cours.",
    description:
      "Cette page se rétablira automatiquement à la fin de la maintenance. Réessayez plus tard.",
    windowLabel: "Période de maintenance prévue",
    windowValue: "De {{start}} à {{end}}",
    adminEntry: "Connexion administrateur",
  },
  initialize: {
    title: "Initialiser {{productName}}",
    description:
      "Créez le premier administrateur. L’infrastructure et les secrets restent gérés par le déploiement.",
    adminName: "Nom de l’administrateur",
    credential: "Identifiant d’initialisation à usage unique",
    credentialHint:
      "Saisissez l’identifiant à usage unique affiché dans le terminal après l’installation. Il devient invalide après la création de l’administrateur.",
    systemName: "Nom du système",
    submit: "Créer l’administrateur et terminer la configuration",
    completed:
      "Initialisation terminée. Connectez-vous avec le compte administrateur.",
  },
} as const
