export const errors = {
  socialClientInUse:
    "Des comptes sont associés à cette application. Son identifiant ne peut pas être modifié ; vous pouvez renouveler son secret ou désactiver la connexion.",
  socialLastMethod:
    "Définissez un mot de passe ou associez une autre méthode de connexion activée avant de dissocier ce compte.",
  socialAuthFailed:
    "La vérification du compte personnel n’a pas abouti. Réessayez.",
  applicationDevelopment: {
    testBusy:
      "Un test est encore actif. Arrêtez-le et traitez les demandes en attente dans l’historique des tests avant de continuer.",
    testChanged:
      "La session de test a changé. Continuez depuis le dernier aperçu.",
    projectNameFixed: "Ce projet regroupe les tâches de développement d’applications. Son nom ne peut pas être modifié.",
    workspaceBound:
      "Ce projet contient des sources d’applications. Supprimez ces applications dans Mes applications avant de supprimer le projet. Les tâches de développement doivent rester dans leur projet actuel.",
    notFound: "Cette application est indisponible. Revenez à Mes applications.",
    sourceChanged:
      "L’application a changé. Consultez le dernier aperçu avant de l’installer.",
  },
  webSites: {
    notFound: "Ce site est indisponible ou son partage a été arrêté",
    slugTaken: "Cette adresse est déjà réservée. Choisissez-en une autre",
    sourceUnavailable:
      "Sélectionnez un fichier HTML disponible dans la tâche source",
    resourcesMissing:
      "Une ressource de la page manque ({{path}}). Demandez à l’assistant de la tâche source d’enregistrer la page avec ses ressources avant de publier",
    bundleInvalid:
      "Le paquet de la page est incomplet ou contient des fichiers non pris en charge. Corrigez-le dans la tâche source et réessayez",
  },
  feishu: {
    connectionNotFound: "Connexion Feishu introuvable. Connectez-la à nouveau.",
    connectionConflict:
      "La connexion Feishu a changé. Actualisez et réessayez.",
    registrationNotFound: "Le code QR Feishu a expiré. Générez-en un nouveau.",
    registrationUnavailable:
      "Feishu ne peut pas créer le bot automatiquement pour le moment. Réessayez plus tard.",
    protocolInvalid:
      "Feishu a renvoyé des données de connexion non reconnues. Reconnectez-vous ou contactez un administrateur.",
    coordinationUnavailable:
      "L’état de connexion Feishu est temporairement indisponible. Réessayez plus tard.",
  },
  automationNotFound: "L’automatisation est introuvable.",
  automationLimitReached:
    "La limite d’automatisations est atteinte. Supprimez-en une devenue inutile et réessayez.",
  automationTaskNotPinned:
    "Les automatisations utilisent uniquement vos tâches actives épinglées.",
  automationTaskInUse:
    "Cette tâche est encore utilisée par une automatisation. Supprimez ou réaffectez celle-ci d’abord.",
  conversationOrderConflict:
    "La liste des tâches a changé. Actualisez-la avant de la réorganiser.",
  unknown: "L’opération n’a pas pu être effectuée. Réessayez plus tard.",
  networkUnavailable:
    "Impossible de joindre le service. Vérifiez votre connexion et réessayez.",
  invalidResponse:
    "Le service a renvoyé des données invalides. Contactez un administrateur.",
  clientUpdateRequired:
    "Le système a été mis à jour. Actualisez cette page pour continuer.",
  serviceTemporarilyUnavailable:
    "Le système est temporairement indisponible. Réessayez dans un instant.",
  imageUnderstanding: {
    validationFailed:
      "Le modèle d’analyse d’images a échoué à la validation des images en entrée, de la sortie structurée ou de la désactivation du raisonnement. Vérifiez la configuration du modèle et du fournisseur.",
  },
  imageGeneration: {
    notConfigured:
      "Le modèle de génération d’images n’est pas configuré ou n’est pas activé.",
    forbidden: "Cette tâche ne peut pas utiliser la génération d’images.",
    turnInactive:
      "L’exécution actuelle est terminée et ne peut plus générer d’images.",
    providerRejected:
      "Le fournisseur d’images a rejeté la demande. Vérifiez l’instruction, le modèle ou la clé API.",
    outputInvalid:
      "Le fournisseur d’images n’a pas renvoyé d’image exploitable. Réessayez ou vérifiez sa configuration.",
    unavailable:
      "La génération d’images est temporairement indisponible. Réessayez plus tard.",
  },
  authInvalidCredentials: "E-mail ou mot de passe invalide.",
  authRateLimited: "Trop de tentatives de connexion. Réessayez plus tard.",
  authProtectionUnavailable:
    "La protection de connexion est temporairement indisponible. Réessayez plus tard.",
  sessionExpired: "Votre session a expiré. Reconnectez-vous.",
  passwordPolicy:
    "Le mot de passe doit comporter 8 à 16 caractères, avec une majuscule, une minuscule, un chiffre et un signe de ponctuation ou un symbole.",
  passwordEmailUnavailable:
    "Le service d’e-mail de définition ou de réinitialisation du mot de passe est temporairement indisponible. Réessayez plus tard, ou utilisez SSO ou Teams si configurés.",
  passwordResetDeliveryFailed:
    "Le lien sécurisé n’a pas pu être envoyé. Réessayez plus tard.",
  passwordResetProtectionUnavailable:
    "La protection des demandes de mot de passe est temporairement indisponible. Réessayez plus tard.",
  auth: {
    registrationProtectionUnavailable:
      "La protection des demandes d’inscription est temporairement indisponible. Réessayez plus tard.",
  },
  passwordResetInvalid:
    "Le lien de définition du mot de passe est invalide ou expiré. Demandez-en un nouveau.",
  concurrencyLimit: "Le système a atteint sa capacité. Réessayez plus tard.",
  pendingLimit:
    "La limite de demandes en attente est atteinte. Traitez d’abord une demande existante.",
  pendingNotHead: "Seule la première demande en attente peut être poursuivie.",
  interruptFailed: "Impossible d’interrompre l’exécution actuelle. Réessayez.",
  conversation: {
    collaborationModeUnavailable:
      "Le mode Plan ne peut pas être modifié si la tâche est en cours, comporte des demandes en attente, un objectif actif ou une automatisation associée.",
    compactionUnavailable:
      "Le contexte ne peut être compacté qu’après l’arrêt de la tâche actuelle.",
    userInputRequestUnavailable:
      "Cette question est terminée ou a expiré. Actualisez la tâche et réessayez.",
    planReviewPending:
      "Réalisez, révisez, passez ou quittez le plan actuel avant de continuer.",
    planReviewUnavailable:
      "Cette révision du plan est terminée ou indisponible. Actualisez la tâche et réessayez.",
    planOutputMissing:
      "Le mode Plan n’a pas produit de plan à examiner. Relancez la demande.",
    steerRequestFailed:
      "Impossible d’orienter l’exécution actuelle. Vérifiez qu’elle est toujours en cours et réessayez.",
    steerRequestUncertain:
      "Le résultat de la demande d’orientation est incertain. Conservez la saisie actuelle et réessayez pour vérifier son état.",
  },
  composer: {
    voiceTranscriptionFailed:
      "La transcription vocale a échoué. Réessayez ou saisissez le texte manuellement.",
    voiceTranscriptionRateLimited:
      "La saisie vocale est limitée à 20 utilisations par minute. Réessayez dans un instant.",
  },
  mcp: {
    insecureHttpAcknowledgementRequired:
      "Vous devez accepter le risque lié au transfert non chiffré avant d’utiliser un serveur MCP HTTP.",
    credentialRequired:
      "La méthode d’authentification choisie nécessite des identifiants.",
    destinationForbidden:
      "Cette destination MCP est inaccessible. Les déploiements cloud autorisent uniquement les adresses publiques HTTP ou HTTPS.",
    connectionFailed:
      "Impossible de connecter et d’initialiser le serveur MCP. Vérifiez son URL, ses identifiants et sa disponibilité.",
  },
  clawhub: {
    skillNotFound: "La compétence est introuvable dans le dépôt.",
    skillNotInstallable:
      "Cette compétence ne peut pas être installée. Vérifiez sa disponibilité et son état de sécurité.",
    skillAlreadyInstalled: "Vous avez déjà installé cette compétence.",
    serviceUnavailable:
      "Impossible de récupérer la compétence depuis ClawHub. Réessayez plus tard.",
    installPreviewBusy:
      "Un autre aperçu d’installation est en préparation. Attendez sa fin puis réessayez.",
    installPreviewRateLimited:
      "Trop d’aperçus d’installation demandés. Réessayez plus tard.",
    installPreviewQuotaExceeded:
      "La limite des aperçus d’installation actifs est atteinte. Réessayez plus tard.",
    packageIntegrityFailed:
      "La vérification d’intégrité des fichiers ClawHub a échoué. L’installation a été bloquée.",
  },
  feedback: {
    submissionInvalid:
      "Le texte ou les images de l’avis ne respectent pas les exigences. Vérifiez-les et réessayez.",
    submissionFailed:
      "Impossible d’envoyer l’avis pour le moment. Réessayez plus tard.",
  },
  knowledge: {
    archiveRequired: "Seules les bases archivées peuvent être supprimées.",
    inUse:
      "Cette base est encore utilisée par des applications. Retirez-la d’abord de ces applications.",
    archived:
      "Cette base est archivée. Restaurez-la avant d’effectuer cette action.",
    disabled: "Cette base est désactivée.",
    quotaExceeded:
      "Cette base ne dispose pas d’assez d’espace pour le fichier.",
    duplicate: "Un document de contenu identique existe déjà dans cette base.",
    nameConflict: "Un document porte déjà ce nom dans cette base.",
    actionConflict:
      "L’état actuel du document ne permet pas cette action. Actualisez et réessayez.",
    activating:
      "Le nouvel index est en cours d’activation. Réessayez dans un instant.",
    unsupportedFormat: "Ce format de document n’est pas pris en charge.",
    fileTooLarge: "Le document dépasse la taille maximale par fichier.",
    processingFailed:
      "Le traitement du document a échoué. Relancez-le ou retraitez le document.",
    previewUnavailable:
      "L’aperçu original est indisponible pour le moment. Réessayez plus tard.",
    embeddingConfiguration:
      "La configuration du modèle de vectorisation est invalide. Contactez un administrateur.",
  },
  knowledgeModel: {
    validationFailed:
      "La validation du modèle de vectorisation ou de reclassement a échoué. Vérifiez l’adresse, la clé, l’identifiant du modèle et les dimensions vectorielles.",
    authenticationFailed:
      "Le service du modèle a refusé la clé API. Si vous avez changé l’URL de base, saisissez une clé valide pour la nouvelle adresse.",
    serviceUnavailable:
      "Le service du modèle a rejeté la validation ou est indisponible. Vérifiez l’URL de base, l’identifiant du modèle, le réseau et l’état du service.",
    responseInvalid:
      "La réponse du modèle est incompatible. Vérifiez la compatibilité API, l’identifiant du modèle et les dimensions vectorielles.",
    notConfigured:
      "Aucun modèle de vectorisation des connaissances n’a encore été configuré par un administrateur.",
  },
  knowledgeSource: {
    notConfigured:
      "La source SharePoint n’a pas été configurée par un administrateur.",
    credentialValidationFailed:
      "L’authentification de l’application SharePoint a échoué. Vérifiez le locataire, l’identifiant de l’application et le secret.",
    urlInvalid:
      "L’URL du dossier SharePoint est invalide ou n’appartient pas au domaine du locataire configuré.",
    folderNotFound:
      "Impossible d’accéder au dossier SharePoint. Vérifiez l’URL et les autorisations du site.",
    alreadyConnected:
      "Ce dossier SharePoint est déjà connecté à une autre base.",
    notFound: "La source de la base est introuvable.",
    syncUnavailable:
      "La synchronisation SharePoint est temporairement indisponible et sera retentée selon la planification.",
    itemSyncFailed:
      "Certains documents SharePoint n’ont pas été synchronisés. Une nouvelle tentative aura lieu selon la planification.",
  },
  application: {
    deleted: "Cette application a été supprimée",
    notFound:
      "L’application est introuvable ou n’est plus accessible pour vous.",
    disabled:
      "Cette application est désactivée et ne peut pas démarrer de nouvelles tâches.",
    dependencyUnavailable:
      "Le modèle, un plugin, une compétence ou une base de connaissances de l’application est indisponible.",
    grantTargetInvalid:
      "Les applications peuvent être partagées uniquement avec des utilisateurs ou groupes valides de l’organisation.",
    grantConflict: "Cet utilisateur ou groupe a déjà accès à l’application.",
    packageInvalid:
      "Le paquet d’application interactive est invalide. Vérifiez manifest.json, index.html et la structure des fichiers.",
    runtimeBusy:
      "Cette application a des tâches ordinaires en cours et ne peut pas être enregistrée ni mise à jour. Arrêtez-les ou attendez leur fin, puis réessayez.",
    centerUnavailable:
      "Cette application a été retirée du Centre d’applications.",
    customEventInvalid:
      "Le nom ou les données de l’événement personnalisé ne correspondent pas au contrat de l’application.",
  },
  credentialConflict:
    "Les associations d’identifiants sont en conflit. Choisissez des identifiants explicites avant de continuer.",
  credentialRequired:
    "Des identifiants requis manquent. Associez-les avant de continuer.",
  avatarInvalid:
    "Échec de l’import de l’avatar. Choisissez une image prise en charge et réessayez.",
  applicationIconInvalid:
    "Échec de l’import de l’icône d’application. Choisissez une image prise en charge et réessayez.",
  capabilityLogoInvalid:
    "Échec de l’import du logo. Choisissez une image prise en charge et réessayez.",
  productLogoInvalid:
    "Échec de l’import du logo système. Choisissez une image prise en charge et réessayez.",
  invalidPackage:
    "Le paquet de plugin ou de compétence est invalide ou des fichiers requis manquent.",
  withReason: "{{message}} Motif : {{reason}}",
  importReasons: {
    archive_size_invalid: "L’archive est vide ou dépasse la taille maximale.",
    archive_unreadable:
      "Impossible de lire l’archive. Vérifiez qu’il s’agit d’un fichier ZIP valide.",
    archive_entry_count_invalid:
      "L’archive est vide ou contient trop de fichiers.",
    archive_path_invalid:
      "L’archive contient un chemin dangereux ou invalide : {{path}}.",
    archive_entry_symlink:
      "L’archive contient un lien symbolique qui ne peut pas être importé : {{path}}.",
    archive_entry_too_large:
      "Un fichier de l’archive est trop volumineux : {{path}}.",
    archive_compression_ratio_exceeded:
      "Un fichier de l’archive présente un taux de compression anormal et peut être dangereux : {{path}}.",
    archive_expanded_size_exceeded:
      "L’archive dépasse la taille totale maximale après extraction.",
    archive_entry_read_failed:
      "Impossible de lire un fichier de l’archive : {{path}}.",
    package_manifest_count_invalid:
      "Le paquet doit contenir exactement un fichier d’entrée requis : SKILL.md ou plugin.json.",
    package_multiple_roots:
      "L’archive doit contenir un seul répertoire racine, mais plusieurs ont été trouvés.",
    package_json_invalid: "Le manifeste du plugin est invalide.",
    plugin_mcp_configuration_invalid:
      "La configuration MCP du plugin est invalide.",
    skill_frontmatter_missing:
      "L’en-tête de métadonnées ou le champ name obligatoire manque dans SKILL.md.",
    skill_display_name_invalid:
      "Le nom d’affichage de la compétence est invalide. Utilisez une seule ligne de 64 caractères maximum.",
    skill_name_invalid:
      "Le nom de compétence {{value}} est invalide. Utilisez uniquement des lettres minuscules, chiffres et traits d’union, sur 64 caractères maximum.",
    plugin_unsupported_component:
      "Le plugin contient un type de composant qui n’est pas encore pris en charge.",
    plugin_skills_invalid:
      "Une compétence déclarée par le plugin est invalide ou son fichier SKILL.md manque.",
    plugin_declared_path_invalid:
      "Le plugin déclare un chemin de fichier invalide : {{path}}.",
    logo_file_invalid:
      "Le fichier du logo est invalide ou dépasse la taille maximale.",
    requested_type_mismatch:
      "Le type sélectionné est {{expected}}, mais l’archive contient {{actual}}.",
  },
  importFailed:
    "L’import du plugin ou de la compétence a échoué. Vérifiez la source et réessayez.",
  capabilityUpdateConflict:
    "Cette compétence a changé. Rouvrez la fenêtre de mise à jour et examinez le contenu actuel avant de valider.",
  capabilityUpdateUnchanged:
    "Le contenu est identique à la compétence actuelle. Aucune mise à jour nécessaire.",
  capabilityHomeSyncFailed:
    "L’état du plugin ou de la compétence a été enregistré, mais le répertoire utilisateur n’a pas pu être synchronisé. Le système réessaiera avant le prochain tour de tâche.",
  attachmentInvalid:
    "Échec de l’import de la pièce jointe. Choisissez un fichier lisible et réessayez.",
  attachmentTemporaryFileSkipped:
    "Les fichiers temporaires ont été ignorés. Choisissez un autre fichier utile.",
  fileLimitExceeded:
    "La taille des fichiers ou le nombre de pièces jointes dépasse la limite.",
  artifactNotFound: "Le fichier produit est introuvable.",
  downloadForbidden:
    "Vous n’avez pas l’autorisation de télécharger ce fichier produit.",
  runnerUnavailable:
    "Le service d’exécution est indisponible. Réessayez plus tard.",
  turnStartClosed:
    "La soumission précédente est terminée. Cette demande n’a pas été exécutée. Envoyez-la à nouveau.",
  deploymentStopped:
    "Cette tâche a été arrêtée pour une mise à jour du système. Le contenu existant est conservé. Vérifiez la progression avant de continuer manuellement.",
  creditLimitExceeded:
    "Votre quota de crédits disponible est épuisé ; vous ne pouvez pas démarrer de nouvelle tâche.",
  lastAdminRequired:
    "Au moins un administrateur activé doit subsister. Cette opération est impossible.",
  lastModelRequired:
    "Au moins un modèle de conversation doit rester disponible.",
  modelProvider: {
    inUseBySystemSetting:
      "Ce modèle est utilisé par un paramètre système. Modifiez ou effacez ce choix avant de le supprimer.",
    managementDisabled:
      "La configuration des modèles est verrouillée par le déploiement et accessible en lecture seule.",
  },
  adminSelfChangeForbidden:
    "Les administrateurs ne peuvent pas se désactiver ni se rétrograder eux-mêmes.",
  emailExists:
    "Cette adresse e-mail est déjà utilisée par un autre utilisateur.",
  settingsInvalid:
    "Le paramètre système est invalide ou ne peut pas être modifié ici.",
  deploymentReadOnly:
    "Ce paramètre est géré par le déploiement et accessible en lecture seule.",
  systemAlreadyInitialized: "Le système a déjà été initialisé.",
  systemInitializationCredentialInvalid:
    "L’identifiant d’initialisation est invalide. Utilisez celui à usage unique affiché après l’installation.",
  teamsFailed:
    "Échec de la connexion Teams. Réessayez ou utilisez une autre méthode de connexion.",
  codexTurnFailed:
    "Cette exécution a échoué. Vous pouvez ajuster la saisie et réessayer.",
  turnCompletedWithoutOutput:
    "L’exécution s’est terminée sans produire de résultat affichable. Relancez-la.",
  automation: {
    emptyResult:
      "L’automatisation s’est terminée sans résultat affichable. Relancez-la.",
    expired: "Cette automatisation a expiré et ne peut plus s’exécuter.",
  },
  userDisabled: "Cet utilisateur est désactivé. Contactez un administrateur.",
  conflict:
    "L’état actuel est incompatible avec cette action. Actualisez et réessayez.",
  forbidden: "Vous n’avez pas l’autorisation d’effectuer cette action.",
  notFound:
    "La ressource demandée n’existe pas ou n’est pas accessible pour vous.",
  validation: "Les données envoyées sont invalides. Vérifiez-les et réessayez.",
} as const
