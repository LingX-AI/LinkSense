export const pluginResources = {
  skillUpdate: {
    description:
      "Modifiez la compétence actuelle ou importez un paquet complet. Examinez les changements avant de confirmer la mise à jour.",
    loading: "Chargement de la compétence…",
    loadFailed: "Impossible de charger la compétence actuelle. Réessayez.",
    mode: "Méthode de mise à jour",
    edit: "Modifier le contenu",
    replace: "Remplacer le paquet complet",
    preserveNotice:
      "Seuls le nom d’affichage, la description et les instructions changeront. Les scripts, modèles, images et autres fichiers existants seront conservés. Pour les modifier, téléchargez le paquet complet, modifiez-le et choisissez « Remplacer le paquet complet ».",
    replaceNotice:
      "Le nouveau paquet remplacera la compétence actuelle. Les fichiers absents du nouveau paquet seront supprimés. Importez un paquet contenant tous les fichiers nécessaires.",
    identifierHint:
      "L’identifiant de la compétence reste inchangé lors d’une mise à jour.",
    content: "Instructions de la compétence",
    contentRequired: "Saisissez les instructions de la compétence.",
    contentTooLarge:
      "Ces instructions sont trop longues pour l’édition en ligne. Téléchargez le paquet complet, modifiez-le puis importez-le à nouveau.",
    noChanges: "Aucune modification pour le moment.",
    files: "Fichiers actuels de la compétence",
    download: "Télécharger le paquet complet",
    selectedFile: "Sélectionné : {{name}}",
    uploading: "Envoi : {{percentage}} %",
    checking: "Vérification des modifications et des risques…",
    check: "Examiner les modifications et les risques",
    confirm: "Confirmer la mise à jour",
    changes: "Modifications des fichiers",
    changeSummary:
      "{{added}} fichiers ajoutés, {{modified}} modifiés, {{deleted}} supprimés et {{unchanged}} inchangés.",
    added: "Fichiers ajoutés",
    modified: "Fichiers modifiés",
    deleted: "Fichiers à supprimer",
    deleteNotice:
      "Ces fichiers sont absents du nouveau paquet et seront supprimés après confirmation. Vérifiez si la compétence en a encore besoin.",
    confirmDeletions: "Je confirme la suppression de ces {{count}} fichiers",
  },
  marketplace: {
    title: "Centre de plugins",
    description:
      "Parcourez les plugins et compétences publics et gérez les éléments installés, vos contenus personnels et les connexions MCP au même endroit.",
    personalAccountDescription:
      "Gérez les éléments installés, vos contenus personnels, le dépôt de compétences et les connexions MCP.",
    adminTitle: "Centre de plugins",
    adminDescription:
      "Examinez les instantanés immuables des versions, gérez la visibilité du catalogue et retirez immédiatement les éléments présentant des risques.",
    adminTabsLabel: "Sections de gestion du Centre de plugins",
    tabs: {
      store: "Centre de plugins",
      mine: "Mes plugins/compétences",
      publishing: "Mes publications",
      reviews: "Demandes de référencement",
      listings: "Tous les éléments référencés",
    },
    catalogTabsLabel: "Catégories du Centre de plugins",
    catalogTabs: {
      plugin: "Plugins",
      skill: "Compétences",
      mcp: "MCP",
      application: "Applications",
    },
    catalogDescriptions: {
      application:
        "Créez et gérez des applications, et trouvez des applications à utiliser.",
      plugin:
        "Parcourez et gérez les plugins pour ajouter des outils et des connexions à vos tâches.",
      skill:
        "Parcourez le dépôt de compétences, installez-les et gérez-les selon vos tâches.",
      mcp: "Gérez les connexions MCP et les plugins pour donner aux tâches accès aux outils et données nécessaires.",
    },
    catalogScopesLabel: "Périmètre du contenu",
    scopes: { public: "Public", personal: "Personnel" },
    installedTitle: "Installés",
    loadingInstalled: "Chargement des éléments installés…",
    installedEmpty: "Aucun élément installé dans {{category}}.",
    installedListLabel: "Éléments installés : {{category}}",
    expandInstalled: "Développer les éléments installés : {{category}}",
    collapseInstalled: "Réduire les éléments installés : {{category}}",
    searchCategory: "Rechercher dans {{category}}",
    publicCatalogLabel: "Catalogue public : {{category}}",
    personalCatalogLabel: "Catalogue personnel : {{category}}",
    personalCatalogEmpty:
      "Aucun élément personnel de {{category}} ne correspond aux filtres.",
    personalMcpConnections: "Connexions MCP",
    personalMcpPackages: "Paquets d’extension MCP",
    includesMcp: "Inclut MCP",
    manageMcp: "Gérer MCP",
    status: {
      draft: "Brouillon",
      published: "Publié",
      unlisted: "Retiré du catalogue",
      suspended: "Retiré du catalogue",
      pending: "En attente de révision",
      approved: "Approuvé",
      rejected: "Non approuvé",
      withdrawn: "Retiré",
    },
    search: "Rechercher dans le Centre de plugins",
    searchPlaceholder: "Rechercher par nom, description ou éditeur…",
    capabilityType: "Type",
    itemType: "Type",
    catalogEmpty:
      "Aucun élément publié de {{category}} ne correspond aux filtres.",
    byPublisher: "Publié par {{publisher}}",
    publisher: "Éditeur",
    noDescription: "Aucune description",
    noKnownRisks:
      "Aucune déclaration de risque connue détectée. Vérifiez que vous faites confiance à l’éditeur avant d’installer.",
    releaseNumber: "Version {{number}}",
    installCount: "{{count}} installations",
    riskSummary: "Résumé des risques",
    manifest: "Instantané du manifeste",
    releaseNotes: "Notes de version",
    noReleaseNotes: "Aucune note de version fournie.",
    contentHash: "SHA-256 du contenu",
    viewDetails: "Voir les détails de {{name}}",
    install: "Installer",
    installing: "Installation",
    installingPluginStatus: "Installation du plugin…",
    installingSkillStatus: "Installation de la compétence…",
    installingMcpStatus: "Installation du MCP…",
    update: "Mettre à jour",
    updatingPluginStatus: "Mise à jour du plugin…",
    updatingSkillStatus: "Mise à jour de la compétence…",
    updatingMcpStatus: "Mise à jour du MCP…",
    updateAvailable: "Mise à jour disponible",
    updateInstallation: "Installer la dernière version",
    installed:
      "Installé depuis le Centre de plugins comme plugin ou compétence personnel.",
    installedPlugin:
      "Installé depuis le Centre de plugins comme plugin personnel.",
    installedSkill:
      "Installée depuis le Centre de plugins comme compétence personnelle.",
    installedMcp: "Installé depuis le Centre de plugins comme MCP personnel.",
    installationUpdated:
      "L’installation utilise désormais la version approuvée actuelle.",
    installationUpdatedPlugin:
      "Le plugin du Centre utilise désormais la version approuvée actuelle.",
    installationUpdatedSkill:
      "La compétence du Centre utilise désormais la version approuvée actuelle.",
    installationUpdatedMcp:
      "Le MCP du Centre utilise désormais la version approuvée actuelle.",
    installedState: "Installé",
    storeOrigin: "Installation du Centre de plugins",
    uninstall: "Désinstaller",
    uninstalling: "Désinstallation",
    uninstallingPluginStatus: "Désinstallation du plugin…",
    uninstallingSkillStatus: "Désinstallation de la compétence…",
    uninstallingMcpStatus: "Désinstallation du MCP…",
    uninstallTitle: "Désinstaller ce plugin ou cette compétence du Centre ?",
    uninstallPluginTitle: "Désinstaller ce plugin du Centre ?",
    uninstallSkillTitle: "Désinstaller cette compétence du Centre ?",
    uninstallMcpTitle: "Désinstaller ce MCP du Centre ?",
    uninstallDescription:
      "Votre installation personnelle et sa configuration seront supprimées. La publication dans le Centre n’est pas affectée.",
    uninstalled: "Le plugin ou la compétence du Centre a été désinstallé.",
    uninstalledPlugin: "Le plugin du Centre a été désinstallé.",
    uninstalledSkill: "La compétence du Centre a été désinstallée.",
    uninstalledMcp: "Le MCP du Centre a été désinstallé.",
    ownedCapabilitiesEmpty: "Vous n’avez aucun plugin ni compétence personnel.",
    preferenceUpdated: "Votre préférence d’activation a été mise à jour.",
    personalCapabilityDeleted:
      "Le plugin ou la compétence personnel a été définitivement supprimé.",
    personalPluginDeleted: "Le plugin personnel a été définitivement supprimé.",
    personalMcpDeleted: "Le MCP personnel a été définitivement supprimé.",
    updatePersonalCapability:
      "Mettre à jour un plugin ou une compétence personnel",
    updatePersonalPlugin: "Mettre à jour un plugin personnel",
    updatePersonalSkill: "Mettre à jour une compétence personnelle",
    updatePersonalMcp: "Mettre à jour un MCP personnel",
    personalImportDescription:
      "La source est d’abord analysée et ses risques affichés. L’installation ou le remplacement nécessite une seconde confirmation.",
    personalPluginImportDescription:
      "La source est d’abord analysée et ses risques affichés. Le plugin personnel est installé ou remplacé après une seconde confirmation.",
    personalSkillImportDescription:
      "La source est d’abord analysée et ses risques affichés. La compétence personnelle est installée ou remplacée après une seconde confirmation.",
    importSources: {
      local: "Paquet ZIP local",
      manualSkill: "Créer une compétence manuellement",
    },
    zipPackage: "Paquet ZIP de plugin ou compétence",
    zipPackageHint:
      "Seuls les ZIP respectant les conventions des paquets de plugins ou compétences sont acceptés.",
    zipPluginPackage: "Paquet ZIP de plugin",
    zipPluginPackageHint:
      "Seuls les ZIP respectant les conventions des paquets de plugins sont acceptés.",
    zipSkillPackage: "Paquet ZIP de compétence",
    zipSkillPackageHint:
      "Seuls les ZIP respectant les conventions des paquets de compétences sont acceptés.",
    skillMarkdown: "Contenu de SKILL.md",
    skillIdentifier: "Identifiant de la compétence",
    skillNameRequired: "Saisissez un identifiant de compétence.",
    skillNameTooLong: "L’identifiant ne peut pas dépasser 64 caractères.",
    skillNameInvalid:
      "Utilisez uniquement des lettres latines minuscules, des chiffres et des traits d’union (-), jamais au début, à la fin ou consécutifs.",
    skillNameReserved:
      "Cet identifiant est réservé par le système. Choisissez-en un autre.",
    skillDisplayName: "Nom d’affichage (facultatif)",
    skillDisplayNameHint:
      "Généré à partir de l’identifiant. Vous pouvez le modifier ou le laisser vide ; les caractères chinois et les espaces sont acceptés.",
    skillNameHint:
      "Utilisez 1 à 64 caractères : lettres latines minuscules, chiffres et traits d’union (-), jamais au début, à la fin ou consécutifs. N’utilisez pas de nom de compétence intégrée. Exemple : my-skill.",
    skillPreview: "Aperçu du contenu de la compétence",
    applyForListing: "Soumettre au référencement",
    pendingReviewAction: "Référencement en attente de révision",
    publishNew: "Soumettre un nouvel élément",
    submitUpdate: "Soumettre une nouvelle version",
    publishDialogDescription:
      "Le plugin ou la compétence personnel actuel est copié dans un instantané immuable, soumis à la révision d’un administrateur.",
    sourceCapability: "Source du plugin ou de la compétence personnel",
    noPublishableSource:
      "Aucun plugin ou compétence personnel publiable ne porte le même nom et le même type que cet élément. Importez ou mettez d’abord à jour la source dans le Centre.",
    immutableSnapshotNotice:
      "La révision porte sur un instantané indépendant et immuable. Les modifications ultérieures de votre contenu personnel ne peuvent pas changer cette version en attente.",
    submitForReview: "Soumettre à révision",
    submitted:
      "L’instantané de la version a été soumis à la révision d’un administrateur.",
    submittedAt: "Soumis le {{date}}",
    reviewPolicyNotice:
      "Chaque nouvelle version est réexaminée. Les versions approuvées ne mettent jamais automatiquement à jour les installations existantes.",
    publicationsEmpty:
      "Vous n’avez encore soumis aucune application, aucun plugin ni aucune compétence.",
    publicationsDescription:
      "Gérez vos soumissions, suivez les révisions et publiez des mises à jour.",
    backToCenter: "Retour au Centre de plugins",
    manageApplicationListing: "Gérer le référencement",
    selectApplication: "Choisir une application à référencer",
    selectApplicationDescription:
      "Choisissez votre application, définissez sa version et ses modes d’utilisation, puis soumettez-la à un administrateur.",
    noPublishableApplication:
      "Aucune application admissible. Modifiez votre recherche ou créez et activez d’abord une application dans Mes applications.",
    withdraw: "Retirer la demande de révision",
    withdrawn: "La version en attente a été retirée.",
    unlist: "Retirer du Centre de plugins",
    unlisting: "Retrait en cours…",
    unlistConfirmTitle: "Retirer « {{name}} » du Centre de plugins ?",
    unlistConfirmDescription:
      "Ce contenu ne sera plus affiché dans le Centre de plugins ni accessible aux nouveaux utilisateurs. Les installations existantes pourront continuer à fonctionner et à être mises à jour.",
    relist: "Remettre au catalogue",
    unlisted:
      "L’élément a été retiré du catalogue. Les installations existantes peuvent toujours fonctionner et être mises à jour.",
    relisted: "L’élément est à nouveau visible dans le Centre de plugins.",
    releaseDetail: "Détails de la version",
    releaseDetailDescription:
      "Examinez les fichiers de l’instantané, les risques déclarés, le contenu de la compétence et l’empreinte du contenu.",
    packageFiles: "Fichiers de l’instantané",
    adminTitleShort: "Centre de plugins",
    reviewsEmpty: "Aucune version en attente de révision.",
    listingsEmpty: "Aucun élément référencé dans le Centre.",
    review: "Examiner",
    reviewRelease: "Examiner « {{name}} »",
    reviewDescription:
      "La décision ne concerne que cette version immuable. Tout rejet nécessite un motif clair.",
    reviewDecision: "Décision de révision",
    reviewComment: "Commentaire de révision",
    approvalCommentOptional:
      "Le commentaire est facultatif pour une approbation.",
    rejectionCommentRequired: "Un motif est obligatoire pour un rejet.",
    approve: "Approuver",
    reject: "Rejeter",
    submitReview: "Envoyer la décision",
    reviewApproved:
      "La version a été approuvée et devient la version actuelle du Centre.",
    reviewRejected: "La version a été rejetée et le motif envoyé à l’éditeur.",
    suspendListing: "Retirer du catalogue",
    resumeListing: "Remettre au catalogue",
    suspendListingTitle: "Retirer « {{name}} » du catalogue ?",
    suspendListingDescription:
      "L’élément sera masqué dans le Centre et aucune copie installée ne pourra démarrer de nouvelle tâche.",
    resumeListingTitle: "Remettre « {{name}} » au catalogue ?",
    resumeListingDescription:
      "L’élément réapparaîtra dans le Centre et les copies installées pourront à nouveau être utilisées dans de nouvelles tâches.",
    suspensionReason: "Motif du retrait",
    listingSuspended:
      "L’élément a été retiré ; les nouvelles tâches sont bloquées pour toutes ses installations.",
    listingResumed: "L’élément a été remis au catalogue.",
    risks: {
      contains_mcp_server: "Contient un serveur MCP",
      contains_scripts: "Contient des scripts exécutables",
      contains_external_connections: "Peut accéder à des services externes",
      requires_environment_variables: "Nécessite des variables d’environnement",
      requires_credentials: "Nécessite des identifiants",
      contains_dependency_download_commands: "Peut télécharger des dépendances",
      declaredEnvironmentKeys: "Variables d’environnement : {{values}}",
      mcpEnvironmentReferences: "Variables d’environnement MCP",
      mcpEnvironmentReference: "{{server}} · {{source}}",
      environmentSource: {
        local: "Fournies par un identifiant personnel",
        remote: "Fournies par l’environnement distant",
      },
    },
  },
  clawHub: {
    sourceName: "ClawHub",
    repository: "Dépôt de compétences",
    catalogLabel: "Dépôt de compétences ClawHub",
    search: "Rechercher dans le dépôt",
    loading: "Chargement du dépôt de compétences…",
    refreshing: "Actualisation…",
    empty: "Aucune compétence disponible",
    emptyDescription:
      "Le service n’a pas encore synchronisé de métadonnées de compétences ClawHub disponibles.",
    noSearchResults: "Aucune compétence correspondante",
    noSearchResultsDescription:
      "Aucune compétence ne correspond à « {{search}} ».",
    sourceNotice:
      "Les métadonnées proviennent de ClawHub. LinkSense ne représente pas ClawHub et ne vérifie ni ne recommande ces compétences. Vérifiez la source et les risques avant d’installer.",
    listLabel: "Résultats du dépôt de compétences",
    sortLabel: "Trier les compétences",
    sort: { downloads: "Téléchargements", stars: "Étoiles" },
    totalCount: "Total : {{count}}",
    byOwner: "Par {{owner}}",
    version: "Version {{version}}",
    downloads: "{{count}} téléchargements",
    stars: "{{count}} étoiles",
    owner: "Propriétaire",
    latestVersion: "Dernière version",
    downloadCount: "Téléchargements",
    starCount: "Étoiles",
    updatedAt: "Mis à jour sur ClawHub",
    syncedAt: "Dernière synchronisation",
    topics: "Thèmes",
    platformRequirements: "Prérequis de plateforme",
    changelog: "Journal des modifications",
    openCanonical: "Voir sur ClawHub",
    installedState: "Installée",
    unavailableState: "Indisponible",
    viewDetails: "Voir les détails de {{name}}",
    preparing: "Préparation…",
    paginationLabel: "Pages du dépôt de compétences",
    pageNumber: "Page {{page}}",
    installTitle: "Installer « {{name}} » ?",
    updateTitle: "Mettre à jour « {{name}} » ?",
    installPreviewDescription:
      "Vérifiez la version ClawHub, la source et les risques. La compétence est ajoutée à vos compétences personnelles uniquement après confirmation.",
    packageIdentity: "Source de la compétence",
    versionToInstall: "Version à installer",
    installFailedTitle: "Échec de l’installation",
    installing: "Installation…",
    installingStatus: "Installation de la compétence…",
    updatingStatus: "Mise à jour de la compétence…",
    confirmInstall: "Confirmer l’installation",
    confirmUpdate: "Confirmer la mise à jour",
    installed: "Installée depuis le dépôt comme compétence personnelle.",
    updated: "La compétence installée depuis le dépôt est à jour.",
    origin: "Installation ClawHub",
    uninstall: "Désinstaller",
    uninstalling: "Désinstallation",
    uninstallingStatus: "Désinstallation de la compétence…",
    uninstallTitle: "Désinstaller cette compétence ClawHub ?",
    uninstallDescription:
      "Votre installation personnelle et sa configuration seront supprimées. Les métadonnées synchronisées du dépôt ne sont pas affectées.",
    uninstalled: "La compétence ClawHub a été désinstallée.",
    securityNoticeTitle: "Avis de sécurité",
    security: {
      clean: "Contrôle de sécurité réussi",
      warning: "Avertissements de sécurité",
      flagged: "Risque signalé",
      unknown: "Vérification lors de l’installation",
      warningDescription:
        "L’état de sécurité de cette compétence nécessite votre attention. Installez-la uniquement si vous faites confiance à la source.",
    },
    installability: {
      unavailable: "Cette compétence est indisponible.",
      missingVersion: "Cette compétence n’a pas de version installable.",
      alreadyInstalled: "Cette version est déjà installée.",
    },
  },
  capability: {
    title: "Plugins et compétences",
    description:
      "Gérez les plugins, compétences, sources du Centre et états d’exécution personnels.",
    builtIn: "Intégré",
    builtInReadOnly:
      "Ajouté automatiquement par la plateforme ; ne peut pas être sélectionné, désactivé, modifié ni supprimé.",
    builtIns: {
      browser: {
        name: "Navigateur {{productName}}",
        description:
          "Utilise un navigateur géré et isolé pour consulter des pages, interagir avec des sites et prendre des captures.",
      },
      documentReader: {
        name: "Lecteur de documents {{productName}}",
        description:
          "Convertit les documents bureautiques courants, livres numériques, CSV et PDF textuels de la tâche en Markdown pour une lecture sûre par l’IA.",
      },
      docs: {
        name: "Documentation {{productName}}",
        description:
          "Répond aux questions d’utilisation et d’administration à partir de l’aide officielle bilingue.",
      },
      coreMcp: {
        name: "MCP principal {{productName}}",
        description:
          "Fournit la conversion de documents, l’enregistrement de fichiers, la génération d’images, la recherche de connaissances et la création de compétences via un MCP intégré.",
      },
      fileService: {
        name: "Service de fichiers {{productName}}",
        description:
          "Enregistre les livrables créés dans la tâche actuelle comme fichiers téléchargeables.",
      },
      imageGeneration: {
        name: "Génération d’images {{productName}}",
        description:
          "Génère des images via le MCP intégré avec le modèle configuré par l’administrateur.",
      },
      knowledgeBase: {
        name: "Connaissances {{productName}}",
        description:
          "Recherche dans les bases sélectionnées et lit les documents nécessaires à la tâche.",
      },
      applicationBuilder: {
        name: "Développement d’applications interactives {{productName}}",
        description:
          "Crée et modifie des applications par conversation, avec aperçu en direct, débogage et installation.",
      },
      skillCreator: {
        name: "Créateur de compétences {{productName}}",
        description:
          "Transforme un processus confirmé en compétence personnelle complète et réutilisable.",
      },
    },
    pluginTitle: "Plugins",
    pluginDescription:
      "Gérez vos plugins personnels, leurs sources dans le Centre et leur état d’exécution.",
    skillTitle: "Compétences",
    skillDescription:
      "Gérez vos compétences personnelles, leurs sources dans le Centre et leur état d’exécution.",
    typeTabsLabel: "Type de plugin ou compétence",
    tabs: { plugin: "Plugins", skill: "Compétences" },
    searchPlaceholder: "Rechercher dans {{type}} par nom ou description…",
    installed: "Installé",
    sourceTabsLabel: "Source",
    viewMore: "Voir {{count}} de plus",
    viewMorePreview: "Voir {{names}}",
    viewMorePreviewWithCount: "Voir {{names}} et {{count}} de plus",
    collapseList: "Afficher moins",
    noSearchResults: "Aucun résultat dans {{type}}.",
    add: "Ajouter un plugin ou une compétence",
    addPlugin: "Ajouter un plugin",
    addSkill: "Ajouter une compétence",
    install: "Installer un plugin ou une compétence",
    importType: "Méthode d’import",
    localImport: "Archive locale",
    manualSkill: "Créer une compétence manuellement",
    packageFile: "Paquet de plugin ou compétence",
    skillContent: "Contenu de SKILL.md",
    skillContentPreview: "Corps de SKILL.md",
    skillContentEmpty: "Le corps de SKILL.md est vide.",
    skillContentTruncated:
      "Le corps de SKILL.md est trop long ; l’aperçu est tronqué. Le fichier complet sera néanmoins installé.",
    descriptionLabel: "Description",
    riskTitle: "Confirmer la source et les risques",
    riskDescription:
      "Le contenu peut contenir des scripts, des serveurs MCP, des connexions externes, des variables d’environnement ou des demandes d’identifiants. Continuez uniquement si vous faites confiance à la source.",
    riskConfirm: "J’ai examiné la source et l’avis de risque",
    installSubmit: "Confirmer l’installation",
    previewSubmit: "Examiner la source et les risques",
    previewing: "Examen…",
    uploading: "Import",
    parsing: "Import terminé. Examen…",
    importingPluginStatus: "Import du plugin…",
    importingSkillStatus: "Import de la compétence…",
    updatingPluginStatus: "Mise à jour du plugin…",
    updatingSkillStatus: "Mise à jour de la compétence…",
    deletingPluginStatus: "Suppression du plugin…",
    uninstallingSkillStatus: "Désinstallation de la compétence…",
    previewConfirmDescription:
      "Examinez les résultats ci-dessous. L’installation ou la mise à jour a lieu uniquement après avoir coché la confirmation et validé.",
    previewExpires: "Expiration de l’aperçu",
    importKind: "Contenu importé",
    logoIncluded: "Logo inclus",
    declaredCapabilities: "Déclarations",
    declaredEnvironmentKeys: "Variables d’environnement déclarées",
    manifestSummary: "Résumé du manifeste",
    noneDeclared: "Aucune déclaration",
    noRisksDetected:
      "Aucun risque connu détecté. Vous devez néanmoins faire confiance à la source.",
    sourceTypes: {
      local: "Import local",
      url: "Import par URL",
      clawhub: "Dépôt de compétences ClawHub",
    },
    importKinds: {
      manual_skill: "Compétence créée manuellement",
      zip: "Paquet ZIP local",
    },
    declarations: {
      mcp_server: "Serveur MCP",
      scripts: "Scripts exécutables",
      external_connections: "Connexions à des services externes",
      environment_variables: "Variables d’environnement",
      credentials: "Identifiants",
      dependency_download_commands:
        "Commandes pouvant télécharger des dépendances",
    },
    installCompleted: "Plugin ou compétence installé.",
    installSkillCompleted: "Compétence installée.",
    updateCompleted: "Plugin ou compétence mis à jour.",
    updatePluginCompleted: "Plugin mis à jour.",
    updateSkillCompleted: "Compétence mise à jour.",
    pluginSavedForNextTurn:
      "Plugin enregistré. Il sera actualisé automatiquement avant le prochain tour de tâche.",
    statusUpdated: "Préférence d’activation mise à jour.",
    empty: "Aucun plugin ni compétence installé.",
    pluginEmpty: "Aucun plugin installé.",
    skillEmpty: "Aucune compétence installée.",
    source: "Source",
    owner: "Propriétaire",
    personal: "Personnel",
    plugin: "Plugin",
    skill: "Compétence",
    enable: "Activer",
    disable: "Désactiver",
    personallyDisable: "Désactiver pour moi",
    personallyEnable: "Activer pour moi",
    personallyDisabledMessage:
      "Ce plugin ou cette compétence a été désactivé pour vous.",
    personallyEnabledMessage:
      "Ce plugin ou cette compétence a été activé pour vous.",
    uninstall: "Désinstaller",
    uninstalling: "Désinstallation",
    skillUninstalled: "Compétence désinstallée.",
    logo: "Remplacer le logo",
    deleteTitle: "Supprimer définitivement ce plugin ou cette compétence ?",
    deletePluginTitle: "Supprimer définitivement ce plugin ?",
    deleteMcpTitle: "Supprimer définitivement ce MCP ?",
    deleteDescription:
      "La configuration personnelle et les associations d’identifiants seront définitivement supprimées. Cette action est irréversible.",
    uninstallSkillTitle: "Désinstaller cette compétence ?",
    uninstallSkillDescription:
      "Cette compétence, sa configuration personnelle et ses associations d’identifiants seront retirées. Cette action est irréversible.",
    updatePlugin: "Mettre à jour le plugin",
    updateSkill: "Mettre à jour la compétence",
    updateSubmit: "Confirmer la mise à jour",
    riskDetected:
      "Ce plugin ou cette compétence déclare des risques d’exécution nécessitant votre attention.",
    riskDetails: "Éléments de risque",
    risks: {
      contains_mcp_server: "Contient un serveur MCP.",
      contains_scripts: "Contient des scripts exécutables.",
      contains_external_connections:
        "Peut se connecter à des services externes.",
      requires_environment_variables:
        "Déclare des besoins en variables d’environnement.",
      requires_credentials: "Déclare des besoins en identifiants.",
      contains_dependency_download_commands:
        "Contient une commande de démarrage pouvant télécharger des dépendances.",
      declared_environment_keys: "Variables d’environnement : {{values}}",
      dependency_commands: "Commandes de dépendances : {{values}}",
    },
  },
  credential: {
    title: "Identifiants des plugins",
    add: "Ajouter des identifiants",
    personal: "Identifiants personnels",
    capabilityId: "Identifiant du plugin",
    credentialId: "Identifiant de l’enregistrement",
    deleteTitle: "Supprimer définitivement ces identifiants ?",
    edit: "Modifier les identifiants",
    confirmCreate: "Confirmer la création",
    confirmUpdate: "Confirmer la mise à jour",
    disableTitle: "Désactiver ces identifiants ?",
    enableTitle: "Activer ces identifiants ?",
    providerPlaceholder: "Par exemple : openai_api",
    nameInvalid: "Saisissez un nom de 160 caractères maximum.",
    plugin: "Plugin",
    description:
      "Les identifiants de plugin contiennent les clés API et autres autorisations d’accès aux services externes. Ajoutez des identifiants et associez-les à un plugin pour les utiliser automatiquement lors de son exécution.",
    secret: "Valeur d’autorisation",
    secretHint:
      "Les clés et autorisations enregistrées ne seront plus affichées. N’incluez aucun secret dans les noms.",
    bind: "Associer un plugin",
    lastUsed: "Dernière utilisation",
    empty:
      "Aucun identifiant. Ajoutez des clés ou autorisations lorsqu’un plugin doit accéder à un service externe.",
    deleteDescription:
      "Les plugins ne pourront plus accéder aux services externes avec ces identifiants. Ces identifiants et leurs associations seront définitivement supprimés, sans possibilité de restauration.",
    disableDescription:
      "Les plugins cesseront d’utiliser ces identifiants lors des prochaines exécutions. Les associations existantes seront conservées.",
    enableDescription:
      "Les plugins associés pourront utiliser ces identifiants lors des prochaines exécutions.",
    providerType: "Identifiant du service",
    providerTypeHint:
      "Saisissez l’identifiant fourni pour ce service, par exemple openai_api. Utilisez des lettres minuscules, chiffres, tirets bas ou traits d’union.",
    providerTypeFormat:
      "Utilisez des lettres minuscules, chiffres, tirets bas ou traits d’union, par exemple openai_api.",
    secretKey: "Nom de configuration",
    secretKeyHint:
      "Saisissez le nom requis par le plugin, par exemple API_KEY. Copiez-le exactement comme dans ses instructions.",
    secretKeyFormat:
      "Les noms doivent commencer par une lettre ou un tiret bas et contenir uniquement des lettres, chiffres ou tirets bas.",
    secretKeyDuplicate: "Les noms de configuration doivent être uniques.",
    secretRequired: "Saisissez les autorisations à enregistrer.",
    keepSecretHint:
      "Laissez vide pour conserver la valeur enregistrée. Saisissez une nouvelle valeur pour la remplacer.",
    savedSecretHint:
      "Les autorisations enregistrées ne sont pas affichées. Elles sont conservées sauf si vous saisissez de nouvelles valeurs.",
    bindings: "Plugins associés",
    bindingPriority:
      "Choisissez un plugin et confirmez les informations à utiliser. Le plugin utilisera ces données lors des prochaines exécutions.",
    mappingTitle: "Confirmer les informations à utiliser",
    mappingDescription:
      "Les noms correspondants sont sélectionnés automatiquement. Pour les éléments restants, choisissez les informations correspondantes de cet enregistrement.",
    pluginEnvironmentKey: "Information requise par le plugin",
    credentialField: "Information à utiliser",
    notMapped: "Non sélectionnée",
    bindingInProgress: "Enregistrement des associations…",
    bindingSucceeded: "Associations enregistrées.",
    confirmBind: "Enregistrer les associations",
    unbindTitle: "Retirer cette association d’information ?",
    unbindDescription:
      "« {{plugin}} » cessera de lire « {{name}} » depuis ces identifiants. L’information enregistrée sera conservée.",
    confirmUnbind: "Retirer l’association",
    unbindNamed: "Dissocier {{name}}",
    addSecretField: "Ajouter un élément de configuration",
    removeSecretField: "Retirer cet élément de configuration",
    noDeclaredKeys:
      "Ce plugin n’a aucune information d’identification à configurer.",
    pluginCount_one: "Utilisé par {{count}} plugin",
    pluginCount_other: "Utilisé par {{count}} plugins",
    associatedFields_one: "{{count}} élément associé",
    associatedFields_other: "{{count}} éléments associés",
    notAssociated:
      "Aucun plugin ne les utilise. Associez un plugin pour qu’il utilise automatiquement ces informations.",
    unavailablePlugin: "Plugin inaccessible",
    credentialDetails: "Détails des identifiants",
    showDetails: "Voir les détails de configuration",
    hideDetails: "Masquer les détails de configuration",
    pluginActionsNamed: "Actions d’association de {{name}}",
    detailsNamed: "Détails de configuration de {{name}}",
    manageAssociation: "Gérer les associations",
    removeAssociation: "Dissocier le plugin",
    removeAssociationTitle: "Dissocier ce plugin ?",
    removeAssociationDescription:
      "« {{name}} » cessera d’utiliser toutes les informations de ces identifiants. Ils seront conservés et pourront être associés à nouveau.",
    completeConfiguration: "Terminer la configuration",
    fixAssociation: "Résoudre les associations",
    enableAction: "Activer les identifiants",
    configurationNote:
      "Ceci affiche la configuration enregistrée, sans vérifier l’accès au service externe.",
    usesField: "Utilise les informations suivantes :",
    otherCredential: "Fourni par d’autres identifiants.",
    removeField: "Retirer l’association",
    removeFieldNamed: "Retirer l’association de {{name}}",
    mappingSummary: "{{configured}} éléments sélectionnés sur {{total}}",
    unselectedFields: "Pas encore sélectionnés :",
    selectInformation: "Sélectionner ou ajuster les informations",
    configurationStatus: {
      loading: "Vérification…",
      failed: "État indisponible",
      unavailable: "Plugin indisponible",
      configured: "Identifiants configurés",
      missing: "Informations supplémentaires nécessaires",
      disabled: "Ces identifiants sont désactivés",
      disabledElsewhere: "Des identifiants sont désactivés",
      conflict: "Associations en conflit",
      invalid: "Configuration à mettre à jour",
    },
    configurationHelp: {
      failed: "Impossible de charger l’état de configuration. Réessayez.",
      unavailable:
        "Ce plugin est indisponible ou inaccessible pour vous. Dissociez-le ou contactez un administrateur.",
      missing:
        "Certaines informations du plugin ne sont pas configurées. Consultez les détails pour compléter les éléments manquants.",
      disabled:
        "Activez ces identifiants pour que le plugin puisse à nouveau utiliser leurs informations.",
      disabledElsewhere:
        "D’autres identifiants utilisés par ce plugin sont désactivés. Activez-les ou modifiez les associations.",
      conflict:
        "Le même élément est associé à plusieurs identifiants. Gérez les associations pour choisir l’information à utiliser.",
      invalid:
        "Les informations associées sont inutilisables ou ne répondent plus aux besoins du plugin. Vérifiez les valeurs enregistrées et actualisez les associations.",
    },
    fieldStatus: {
      configured: "Configuré",
      missing: "Non configuré",
      disabled: "Les identifiants fournissant cette valeur sont désactivés",
      conflict: "Associé à plusieurs identifiants",
      invalid: "Mise à jour nécessaire",
    },
  },
} as const
