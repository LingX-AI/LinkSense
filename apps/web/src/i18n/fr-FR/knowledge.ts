export const knowledgeResources = {
  knowledgeSources: {
    title: "Sources de connaissances",
    description:
      "Configurez les connexions externes de façon centralisée. Seuls les administrateurs peuvent créer et gérer les bases de connaissances issues de sources externes.",
    saved:
      "Les paramètres SharePoint ont été enregistrés et l’authentification a réussi.",
    secretConfigured: "Secret configuré ; laissez vide pour le conserver",
    sharepoint: {
      title: "Microsoft SharePoint",
      description:
        "Synchronisez les documents d’un dossier de site autorisé avec une identité d’application Microsoft Graph.",
      enable: "Activer la source SharePoint",
      enableDescription:
        "Les administrateurs peuvent coller l’URL d’un dossier SharePoint lors de la création d’une base.",
      tenantId: "Identifiant d’annuaire (locataire)",
      clientId: "Identifiant d’application (client)",
      tenantDomain: "Domaine du locataire SharePoint",
      tenantDomainDescription:
        "Seules les URL de dossiers sur cet hôte exact sont acceptées, par exemple contoso.sharepoint.com.",
      clientSecret: "Secret client",
      secretDescription:
        "Le secret est chiffré au repos et n’est jamais renvoyé ni journalisé.",
      permissionTitle: "Principe du moindre privilège",
      permissionDescription:
        "Utilisez Sites.Selected et demandez à un administrateur Microsoft 365 d’accorder l’accès en lecture uniquement aux sites approuvés. L’enregistrement valide l’identité de l’application ; la création d’une base vérifie aussi l’accès au dossier concerné.",
    },
  },
  library: {
    title: "Bibliothèque de ressources",
    description:
      "Gérez les connaissances et les fichiers générés pendant les tâches.",
    tabsLabel: "Contenu de la bibliothèque",
    tabs: {
      knowledge: "Bases de connaissances",
      artifacts: "Fichiers des tâches",
    },
    artifacts: {
      title: "Fichiers des tâches",
      description:
        "Parcourez les fichiers générés, classés par tâche et par date, puis téléchargez-les ou prévisualisez les formats compatibles.",
      searchPlaceholder: "Rechercher un titre de tâche ou un nom de fichier…",
      fileTypeLabel: "Filtrer par type de fichier",
      fileTypes: {
        all: "Tous les types",
        image: "Images",
        word: "Word",
        excel: "Excel",
        powerpoint: "PPT",
        html: "HTML",
        pdf: "PDF",
        archive: "Archives",
        text: "Texte",
        audio: "Audio",
        video: "Vidéo",
        other: "Autres",
      },
      empty: "Aucun fichier de tâche",
      emptyDescription:
        "Les fichiers apparaîtront ici après leur génération et leur enregistrement comme fichiers téléchargeables dans une tâche.",
      searchEmpty: "Aucun fichier correspondant",
      listLabel: "Chronologie des fichiers des tâches",
      archivedTask: "Archivée",
      previewAvailable: "Aperçu disponible",
      downloadNamed: "Télécharger {{name}}",
      loadingMore: "Chargement…",
      resizePreview: "Redimensionner l’aperçu du fichier",
    },
  },
  knowledge: {
    title: "Bases de connaissances",
    description:
      "Organisez, partagez et recherchez les documents auxquels vous avez accès.",
    searchCapability: {
      notInstalledTitle:
        "Les bases de connaissances ne sont pas incluses dans Core",
      notInstalledDescription:
        "Cette installation utilise LinkSense Core. Installez l’édition Full pour ajouter l’analyse des documents et la recherche de connaissances.",
      unavailableTitle: "Recherche de connaissances indisponible",
      unavailableDescription:
        "La recherche de connaissances est indisponible pour le moment. Vous pouvez utiliser les plugins, les compétences et les pièces jointes, et envoyer des tâches normalement. Réessayez plus tard.",
      dimensionMismatch:
        "L’index des connaissances ne correspond pas à la configuration du déploiement. Un administrateur doit vérifier la configuration et lancer une reconstruction complète manuelle.",
    },
    creationCapability: {
      unreadyTitle: "Impossible de créer une base pour le moment",
      unreadyDescription:
        "Les conditions suivantes doivent être rétablies avant de créer une base :",
      requestFailedTitle: "Impossible de vérifier les prérequis",
      requestFailedDescription:
        "La vérification des services n’a pas abouti. Relancez-la avant de créer une base.",
      notInstalledTitle:
        "Les bases de connaissances ne sont pas incluses dans cette édition",
      notInstalledDescription:
        "Installez une édition incluant les bases de connaissances avant d’en créer une.",
      retry: "Vérifier à nouveau",
      checks: {
        objectStorageUnavailable:
          "Stockage des fichiers temporairement indisponible",
        documentParsingUnavailable:
          "Analyse des documents temporairement indisponible",
        embeddingNotConfigured:
          "Aucun modèle de vectorisation configuré par un administrateur",
        embeddingUnavailable:
          "Service du modèle de vectorisation temporairement indisponible",
        searchAndIndexingUnavailable:
          "Recherche et indexation des connaissances temporairement indisponibles",
      },
    },
    searchPlaceholder: "Rechercher par nom ou description…",
    empty: "Aucune base de connaissances",
    loadMore: "Charger plus",
    noDescription: "Aucune description",
    backToList: "Retour aux bases de connaissances",
    overview: "Vue d’ensemble de la base",
    documents: "Documents",
    documentsDescription:
      "Importez des documents et suivez l’analyse, le découpage, la vectorisation et l’indexation.",
    documentsEmpty: "Aucun document",
    directory: {
      breadcrumb: "Chemin du dossier de la base",
      root: "Racine",
      empty: "Ce dossier ne contient aucun document",
      flatEmpty: "Cette base et ses dossiers ne contiennent aucun document",
      viewMode: "Vue des documents",
      directoryView: "Dossiers",
      flatView: "Liste à plat",
      openFolder: "Ouvrir le dossier {{name}}",
      expandFolder: "Développer le dossier {{name}}",
      collapseFolder: "Réduire le dossier {{name}}",
      showFolders: "Afficher les dossiers",
      open: "Ouvrir",
      folder: "Dossier",
    },
    documentCount: "{{count}} documents",
    readyCount: "{{count}} interrogeables",
    ownerNamed: "Propriétaire : {{name}}",
    ownerNamedSelf: "Propriétaire : {{name}} (moi)",
    updated: "Mis à jour le {{date}}",
    sourceType: {
      label: "Source : {{source}}",
      local: "Locale",
      sharepoint: "SharePoint",
    },
    disabled: "Base de connaissances désactivée",
    disabledDescription:
      "Cette base est indisponible. Contactez son propriétaire ou un administrateur.",
    archivedReadOnly:
      "Cette base est archivée et en lecture seule. Restaurez-la pour gérer les documents ou les partages.",
    lifecycle: { label: "État", current: "Actuelle", archived: "Archivée" },
    filter: { label: "Filtrer les bases", all: "Toutes" },
    scope: {
      label: "Périmètre des bases",
      all: "Toutes",
      owned: "Créées par moi",
      shared: "Partagées avec moi",
    },
    access: {
      owner: "Créée par moi",
      direct: "Partagée directement avec moi",
      group: "Partagée via {{name}}",
      multiple: "{{count}} sources de partage",
      shared: "Partagée avec moi",
      unknownGroup: "Groupe inconnu",
      detailsAction: "Voir les sources d’accès",
      detailsTitle: "Sources d’accès",
      detailsDescription:
        "Vous avez actuellement accès grâce aux sources actives suivantes.",
      directSource: "Partage personnel direct",
      groupSource: "Groupe d’utilisateurs : {{name}}",
    },
    create: {
      action: "Créer une base de connaissances",
      title: "Créer une base de connaissances",
      description:
        "Après la création, importez des documents puis partagez-les avec des utilisateurs ou des groupes selon vos besoins.",
      name: "Nom de la base",
      optionalDescription: "Description (facultatif)",
      nameRequired: "Saisissez un nom pour la base.",
      sourceType: "Source de données",
      sourceLocal: "Import local",
      sourceLocalDescription:
        "Importez et gérez des documents locaux après la création.",
      sourceSharePoint: "Dossier SharePoint",
      sourceSharePointDescription:
        "Connectez un dossier SharePoint et planifiez sa synchronisation.",
      sourceUnavailable: "Non activée",
      sharePointNotConfigured:
        "La source SharePoint n’a pas été activée par un administrateur.",
      sharePointUrl: "URL du dossier SharePoint",
      sharePointUrlHint:
        "Accepte les liens de partage de dossiers SharePoint et les URL directes de dossiers dans un site.",
      sharePointUrlPlaceholder:
        "https://contoso.sharepoint.com/:f:/s/team/share-token",
      syncFrequencyLabel: "Fréquence de synchronisation",
      syncFrequency: {
        daily: "Quotidienne",
        weekly: "Hebdomadaire",
        monthly: "Mensuelle",
      },
      syncWeekdayLabel: "Jour de la semaine",
      syncWeekday: {
        "1": "Lun",
        "2": "Mar",
        "3": "Mer",
        "4": "Jeu",
        "5": "Ven",
        "6": "Sam",
        "7": "Dim",
      },
      syncDayOfMonth: "Jour",
      syncInvalidMonthDayHint:
        "Les mois qui ne comportent pas ce jour sont ignorés.",
      syncDayOption: "Jour {{day}}",
      syncTime: "Heure",
      syncHour: "Heure",
      syncMinute: "Minute",
      syncTimeZone: "Synchronisation dans le fuseau horaire {{timeZone}}.",
    },
    source: {
      title: "Synchronisation SharePoint",
      syncNow: "Synchroniser maintenant",
      retrySync: "Relancer la synchronisation",
      syncAccepted: "La demande de synchronisation SharePoint a été envoyée.",
      status: {
        pending: "Le dossier {{folder}} attend sa synchronisation.",
        syncing: "Synchronisation du dossier {{folder}}.",
        ready: "Le dossier {{folder}} est synchronisé.",
        failed:
          "La synchronisation de tout ou partie du dossier {{folder}} a échoué.",
      },
      phase: {
        scanning: "Parcours du dossier SharePoint",
        syncing: "Synchronisation des fichiers SharePoint",
        processing: "Traitement des documents",
        completed: "Synchronisation terminée",
      },
      progress: {
        scanning: "Parcours du dossier ; {{count}} éléments trouvés",
        syncing: "Synchronisation des fichiers ({{processed}}/{{total}})",
        processing: "Traitement des documents ({{processed}}/{{total}})",
        completed: "Synchronisation terminée ({{processed}}/{{total}})",
        discovered: "{{count}} trouvés",
        summary:
          "{{processed}}/{{total}} traités : {{created}} créés, {{updated}} mis à jour, {{deleted}} supprimés, {{skipped}} ignorés, {{retried}} repris et {{failed}} en échec.",
      },
      retryHint:
        "Sélectionnez Relancer la synchronisation pour reprendre à la page de parcours ou à l’étape de traitement ayant échoué.",
    },
    edit: {
      title: "Modifier les informations de la base",
      description:
        "Modifiez le nom et la description sans retraiter les documents existants.",
    },
    actions: {
      archive: "Archiver",
      restore: "Restaurer",
      retryNamed: "Relancer le traitement de {{name}}",
      reprocessNamed: "Retraiter {{name}}",
      rebuildNamed: "Reconstruire l’index de {{name}}",
      cancelProcessing: "Annuler le traitement",
      reprocess: "Retraiter",
      rebuild: "Reconstruire l’index",
      rebuildSelected: "Reconstruire la sélection",
      rebuildSelectedShort: "Sélection",
      rebuildAll: "Reconstruire tous les documents",
      rebuildAllShort: "Tous",
      rename: "Renommer",
      removeDirectShare: "Retirer mon accès direct",
      documentMenu: "Gérer le document {{name}}",
    },
    confirm: {
      archive: {
        title: "Archiver la base ?",
        description:
          "La base devient accessible en lecture seule après archivage et pourra être restaurée.",
      },
      restore: {
        title: "Restaurer la base ?",
        description:
          "L’import, le traitement et le partage seront à nouveau disponibles après restauration.",
      },
      delete_base: {
        title: "Supprimer définitivement la base ?",
        description:
          "Cette action est irréversible. Seules les bases archivées peuvent être supprimées.",
      },
      delete_document: {
        title: "Supprimer le document ?",
        description:
          "Cette action supprime « {{name}} », son contenu analysé et son index.",
      },
      reprocess: {
        title: "Retraiter le document ?",
        description:
          "« {{name}} » sera analysé et traité à nouveau avec la configuration actuelle.",
      },
      rebuild: {
        title: "Reconstruire l’index du document ?",
        description:
          "« {{name}} » sera découpé et vectorisé à nouveau pour remplacer son index actuel.",
      },
      rebuild_selected: {
        title: "Reconstruire les index des documents sélectionnés ?",
        description:
          "Les documents prêts seront découpés et vectorisés à nouveau pour remplacer leurs index. Les documents en échec reprendront à partir de leur version candidate existante pour terminer l’indexation. {{count}} documents seront traités.",
      },
      rebuild_all: {
        title: "Reconstruire tous les index de cette base ?",
        description:
          "Les documents prêts seront découpés et vectorisés à nouveau pour remplacer leurs index. Les documents en échec reprendront à partir de leur version candidate existante pour terminer l’indexation.",
      },
      remove_direct_share: {
        title: "Retirer votre accès direct ?",
        description:
          "Cette action retire le partage personnel qui vous a été accordé directement. {{remainingAccess}}",
      },
    },
    deleteBlocked: {
      title: "Impossible de supprimer la base pour le moment",
      description:
        "Retirez cette base des applications suivantes, puis réessayez.",
      usagesTitle: "Applications utilisant cette base ({{count}})",
      openApplications: "Ouvrir le Centre d’applications",
    },
    storage: {
      title: "Stockage",
      description:
        "Les versions actuelles, les contenus archivés, les anciennes versions conservées pour les citations ou pendant 30 jours, les originaux en échec et les objets en attente de nettoyage occupent tous de l’espace. L’état Supprimé ne signifie pas que l’espace est déjà libéré.",
      reserved: "{{size}} réservés",
    },
    events: {
      reconnecting:
        "La connexion de suivi en direct a été interrompue et se rétablit. L’actualisation périodique reste active.",
    },
    document: {
      name: "Document",
      size: "Taille",
      rebuildRequired: "Reconstruction requise",
      retryAt: "Prochaine tentative prévue le {{date}}",
      retryWaitingFirst: "Première nouvelle tentative automatique le {{date}}",
      retryWaitingSecond: "Deuxième nouvelle tentative automatique le {{date}}",
      selectAll: "Sélectionner tous les documents chargés",
      selectNamed: "Sélectionner le document {{name}}",
      selectedCount: "{{count}} documents sélectionnés",
      rebuildBatchResult:
        "{{accepted}} documents soumis au traitement ; {{rejected}} n’ont pas pu être soumis.",
      candidateFailure:
        "Cette version candidate a échoué. La version actuellement disponible reste utilisable.",
      failureDetailsNamed: "Voir les détails de l’échec du document {{name}}",
      renameTitle: "Renommer le document",
      renameDescription:
        "Seul le nom affiché change. Le document ne sera ni analysé ni vectorisé à nouveau.",
      displayName: "Nom du document",
      failure: {
        cancelled: "Le traitement de cette tâche a été arrêté.",
        encrypted:
          "Le document est protégé par mot de passe ou chiffré et ne peut pas être traité.",
        unsupportedFormat:
          "Le traitement de ce format de document n’est pas pris en charge.",
        officeConversionFailed:
          "Impossible de convertir le document dans un format analysable. Vérifiez qu’il s’ouvre normalement dans un logiciel bureautique courant.",
        tooLarge:
          "Le document dépasse la taille maximale par fichier et ne peut pas être traité.",
        storageQuota:
          "La base ne dispose pas d’assez d’espace pour poursuivre le traitement.",
        structureInvalid:
          "La validation de la structure du document ou de la couverture des sources a échoué.",
        imageConfigurationChanged:
          "La configuration d’analyse des images a changé. Retraitez le document avec la configuration actuelle.",
        imageModelNotFound:
          "Le modèle d’analyse des images configuré n’existe plus. Choisissez un autre modèle, puis retraitez le document.",
        imageOutputInvalid:
          "Le modèle d’analyse des images n’a pas fourni de description structurée valide. Vérifiez le modèle et réessayez.",
        imageThinkingNotDisabled:
          "Le système n’a pas pu vérifier que le raisonnement du modèle d’image était désactivé ; le traitement a été arrêté par sécurité.",
        parsingServiceFailed:
          "Le service d’analyse n’a pas produit de résultat exploitable. Réessayez ou contactez un administrateur si le problème persiste.",
        parsingTaskExpired:
          "La tâche d’analyse a expiré et sa relance automatique a échoué. Réessayez ou contactez un administrateur si le problème persiste.",
        parsingInvalid:
          "Le document analysé n’a pas passé les contrôles d’intégrité ou de sécurité.",
        configuration:
          "La configuration de vectorisation ou d’indexation est incompatible avec ce document. Vérifiez la configuration du déploiement et réessayez.",
        serviceAuthentication:
          "L’authentification auprès d’un service de traitement externe a échoué. Demandez à un administrateur de vérifier la configuration du déploiement.",
        serviceUnavailable:
          "Un service nécessaire au traitement est indisponible. Réessayez plus tard.",
        indexingFailed:
          "L’écriture ou la validation de l’index a échoué. Réessayez plus tard.",
        busy: "Une autre tâche traite ce document. Réessayez plus tard.",
        unknown:
          "Le traitement a échoué. Réessayez ou contactez un administrateur si le problème persiste.",
      },
      status: {
        processing: "Traitement en cours",
        ready: "Interrogeable",
        failed: "Échec du traitement",
        deleted: "Supprimé",
      },
      stage: {
        queued: "En attente de traitement",
        uploading: "Import en cours",
        validating: "Validation",
        parsing: "Analyse",
        chunking: "Création des fragments enfants",
        image_understanding: "Analyse des images du document",
        parenting: "Création des fragments parents",
        embedding: "Vectorisation",
        indexing: "Écriture de l’index",
        activating: "Activation du nouvel index",
        processing: "Traitement",
      },
    },
    upload: {
      action: "Importer des documents",
      title: "Importer des documents",
      ocrLabel: "Activer l’OCR",
      ocrDescription:
        "Reconnaître le texte des scans et des images. L’OCR augmente la durée du traitement.",
      ocrRecommendedForImages:
        "La sélection contient des images. Activez l’OCR pour ce lot afin d’en reconnaître le texte.",
      enableOcrForBatch: "Activer l’OCR pour ce lot",
      sourceType: "Source de l’import",
      sourceTypeDescription:
        "Choisissez un ou plusieurs fichiers, ou conservez l’arborescence d’un dossier local.",
      filesMode: "Fichiers",
      folderMode: "Dossier",
      chooseFiles: "Choisir des documents",
      chooseFolder: "Choisir un dossier local",
      limits:
        "Jusqu’à {{maxFileSize}} par fichier et {{maxFiles}} documents par sélection.",
      loadingLimits: "Chargement des limites d’import du déploiement.",
      queue: "File d’import",
      queueSummary: "{{total}} fichiers, dont {{waiting}} en attente",
      start: "Démarrer l’import ({{count}})",
      locateExisting: "Voir le document existant",
      replace: "Remplacer le document existant",
      keepBoth: "Conserver les deux",
      resolveConflict: "Résoudre le conflit de noms",
      conflictTitle: "Résoudre le conflit de noms de documents",
      conflictDescription:
        "« {{incoming}} » porte le même nom que « {{existing}} », mais son contenu est différent. Choisissez le traitement à appliquer.",
      confirmedName: "Nom confirmé par le serveur : {{name}}",
      batch: {
        runningTitle: "Import et traitement des documents",
        attentionTitle: "Certains documents nécessitent votre attention",
        completedTitle: "Traitement du lot terminé",
        summary: "{{completed}} / {{total}} documents traités",
        issues: "{{count}} documents n’ont pas été traités avec succès",
        viewDetails: "Voir les détails",
      },
      state: {
        waiting: "En attente d’import",
        uploading: "Import en cours",
        processing: "Importé, traitement en cours",
        ready: "Traitement terminé",
        duplicate: "Contenu en double",
        conflict: "Conflit de noms",
        skipped: "Ignoré",
        failed: "Échec de l’import",
      },
      errors: {
        unsupportedFormat: "Ce format de fichier n’est pas pris en charge.",
        emptyFile: "Les fichiers vides ne peuvent pas être importés.",
        fileTooLarge:
          "Le fichier dépasse la limite de {{maxFileSize}} par fichier.",
        tooManyFiles:
          "Sélectionnez au maximum {{maxFiles}} fichiers à la fois.",
      },
    },
    share: {
      action: "Partager",
      title: "Partager la base",
      description:
        "Accordez l’accès à cette base à un utilisateur ou à un groupe.",
      targetType: "Partager avec",
      permissionDescription:
        "Les destinataires peuvent consulter et rechercher le contenu, mais pas gérer les documents ni les partages.",
      user: "Utilisateur",
      group: "Groupe d’utilisateurs",
      selectTarget: "Choisir un destinataire",
      searchUserPlaceholder: "Rechercher par nom ou e-mail…",
      searchGroupPlaceholder: "Rechercher un groupe par nom…",
      loadingTargets: "Chargement des destinataires",
      noTargets: "Aucun destinataire correspondant",
      removeTarget: "Retirer le destinataire {{name}}",
      additionalTargets: "{{count}} sélections supplémentaires",
      active: "Partages actuels",
      permissionUse: "Droit d’utilisation",
      empty: "Aucun partage avec des utilisateurs ou groupes",
      revokeNamed: "Révoquer l’accès de {{name}}",
      revokeUserRemoved:
        "L’accès de {{name}} a été révoqué. Cet utilisateur ne dispose d’aucune autre source d’accès active.",
      revokeUserRetained:
        "L’accès de {{name}} a été révoqué. Cet utilisateur conserve un accès via {{sources}}.",
      revokeGroupNone:
        "L’accès du groupe {{name}} a été révoqué. Aucun membre actif ne conserve d’accès par une autre source.",
      revokeGroupSome:
        "L’accès du groupe {{name}} a été révoqué. Certains membres actifs conservent un accès via {{sources}}. Les détails des membres ne sont pas affichés.",
      revokeGroupAll:
        "L’accès du groupe {{name}} a été révoqué. Tous les membres actifs conservent un accès via {{sources}}. Les détails des membres ne sont pas affichés.",
      remainingSource: {
        owner: "la propriété de la base",
        direct: "un autre partage direct",
        user_group: "un autre partage de groupe",
      },
      submit: "Ajouter le partage",
      removeDirectSuccess: "Le partage personnel direct a été retiré.",
      removeDirectStillAccessible:
        "Le partage personnel direct a été retiré. Vous conservez l’accès à cette base par une autre source active.",
      noRemainingAccess:
        "Vous ne pourrez plus accéder à cette base après le retrait.",
      remainingAccess:
        "Vous conserverez l’accès à cette base par une autre source active.",
    },
    preview: {
      title: "Aperçu du document",
      views: "Mode d’aperçu",
      original: "Original",
      parsed: "Contenu analysé",
      parsedDescription:
        "Voici le Markdown analysé de la version du document affichée.",
      sameVersionDescription:
        "Les vues originale et analysée correspondent à la même version actuelle du document.",
      exactVersionDescription:
        "Affichage de la version historique exacte utilisée par cette citation.",
      citationExcerpt: "Passage cité",
      unsupportedOriginal:
        "L’aperçu original n’est pas disponible pour ce type de fichier. Consultez le contenu analysé ou téléchargez l’original.",
      loadingOriginal: "Chargement de l’aperçu original",
      loadingParsed: "Chargement du contenu analysé",
      assetLoading: "Chargement de l’image du document",
      assetLoadingNamed: "Chargement de l’image « {{name}} »",
      assetUnavailable: "Image du document indisponible",
      assetUnavailableNamed: "L’image « {{name}} » est indisponible",
      parsedEmpty: "Ce document n’a aucun contenu analysé à afficher",
      downloadOriginal: "Télécharger l’original",
      expand: "Agrandir l’aperçu",
      expandImage: "Agrandir {{name}}",
      openNamed: "Prévisualiser le document {{name}}",
      backToKnowledgeBase: "Retour à la base",
    },
    citation: {
      title: "Citation de connaissances",
      loading: "Résolution de la citation",
      back: "Retour à la tâche",
      source: "Citation [{{number}}] · {{knowledgeBase}}",
      location: "Emplacement source : {{location}}",
      historicalUnavailableTitle:
        "Contenu historique de la citation indisponible",
      historicalUnavailableDescription:
        "La base ou le document source a été supprimé. Son contenu, son aperçu original et son téléchargement ne sont plus disponibles. Seuls le nom historique et le résumé de l’emplacement enregistrés avec la réponse subsistent.",
      inlinePreviewUnavailable:
        "Impossible de charger le passage cité. Sélectionnez le repère pour ouvrir les détails de la citation.",
      pages: "Pages {{values}}",
      documentLevel: "Source à l’échelle du document",
    },
  },
  adminKnowledge: {
    title: "Bases de connaissances",
    description:
      "Administrez les métadonnées des bases des utilisateurs et configurez les sources sans accéder au contenu, aux aperçus ni aux téléchargements des documents.",
    tabsLabel: "Sections des bases de connaissances",
    tabs: {
      knowledgeBases: "Bases de connaissances",
      sources: "Sources de connaissances",
    },
    search: "Rechercher une base ou un propriétaire",
    empty: "Aucune base correspondante",
    ownerDisabled: "Propriétaire désactivé",
    lifecycle: {
      label: "Cycle de vie",
      all: "Tous les cycles de vie",
      active: "Active",
      archived: "Archivée",
      deleted: "Supprimée",
    },
    availability: {
      label: "Disponibilité",
      all: "Tous les états de disponibilité",
      enabled: "Activée",
      disabled: "Désactivée",
    },
    columns: {
      knowledgeBase: "Base de connaissances",
      owner: "Propriétaire",
      documents: "Documents",
      storage: "Stockage",
      shares: "Autorisations de partage",
      diagnostics: "Diagnostic",
    },
    documentSummary: "{{total}} au total · {{ready}} interrogeables",
    documentIssues: "{{processing}} en cours · {{failed}} en échec",
    shareCount: "{{count}} autorisations actives",
    pagination: { label: "Pagination des bases", page: "Page {{page}}" },
    revokeNamed: "Révoquer le partage de {{name}}",
    cleanup: "Nettoyage : {{status}}",
    cleanupStatus: {
      pending: "En attente",
      running: "En cours",
      failed: "En échec",
      completed: "Terminé",
    },
    noDiagnostics: "Aucun problème",
    actionsFor: "Administrer la base {{name}}",
    archiveBeforeDelete:
      "La suppression nécessite une confirmation distincte après l’archivage. Cette action ne supprime pas la base.",
    reason: "Motif",
    reasonHint:
      "Obligatoire. Le motif est consigné dans une entrée d’audit expurgée.",
    actions: {
      disable: "Désactiver",
      enable: "Activer",
      archive: "Archiver",
      transferOwner: "Transférer la propriété",
      retryCleanup: "Relancer le nettoyage",
      delete: "Supprimer définitivement",
    },
    feedback: {
      disable: "Base désactivée.",
      enable: "Base activée.",
      archive: "Base archivée.",
      delete: "Suppression de la base demandée.",
      cleanup_retry: "Nouvelle tentative de nettoyage demandée.",
      revoke_grant: "Autorisation de partage révoquée.",
      transfer_owner: "Propriété de la base transférée.",
    },
    confirm: {
      disable: {
        title: "Désactiver la base ?",
        description:
          "Les utilisateurs ne pourront ni rechercher ni utiliser le contenu de « {{name}} » tant qu’elle sera désactivée.",
        action: "Désactiver",
      },
      enable: {
        title: "Activer la base ?",
        description:
          "Les autorisations actives de « {{name}} » seront à nouveau utilisables.",
        action: "Activer",
      },
      archive: {
        title: "Archiver la base ?",
        description: "« {{name}} » sera en lecture seule après l’archivage.",
        action: "Archiver",
      },
      delete: {
        title: "Supprimer définitivement la base ?",
        description:
          "Supprimer définitivement la base archivée « {{name}} ». Cette action est irréversible.",
        action: "Supprimer définitivement",
      },
      cleanup_retry: {
        title: "Relancer le nettoyage des ressources ?",
        description:
          "Relancer les opérations de nettoyage en échec pour la base « {{name}} ».",
        action: "Relancer le nettoyage",
      },
      revoke_grant: {
        title: "Révoquer le partage ?",
        description: "Retirer l’accès à la base pour « {{name}} ».",
        action: "Révoquer",
      },
    },
    transfer: {
      title: "Transférer la propriété de la base",
      description:
        "Choisissez un nouvel utilisateur actif comme propriétaire de « {{name}} ».",
      owner: "Nouveau propriétaire",
      search: "Rechercher des utilisateurs",
      select: "Sélectionner un nouveau propriétaire",
      action: "Transférer la propriété",
    },
  },
} as const
