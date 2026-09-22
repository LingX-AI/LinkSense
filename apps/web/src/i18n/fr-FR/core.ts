export const core = {
  social: {
    disableHelp:
      "Désactiver ce fournisseur empêche toute connexion par son intermédiaire. Vérifiez d’abord que les utilisateurs concernés disposent d’un autre moyen de connexion.",
    setupPassword: "Définir ou réinitialiser un mot de passe par e-mail",
    title: "Comptes tiers",
    configure: "Configurer",
    configureProvider: "Configurer {{provider}}",
    providerDescription: "Inscrivez-vous ou connectez-vous avec {{provider}}.",
    statusEnabled: "Activé",
    statusDisabled: "Désactivé",
    statusNotConfigured: "Non configuré",
    description:
      "Inscrivez-vous ou connectez-vous avec Google, Apple et d’autres fournisseurs. Si les inscriptions sont ouvertes, les nouveaux utilisateurs peuvent accéder au service après vérification de leur e-mail, sans activation par un administrateur. Les utilisateurs existants doivent se connecter avant d’associer un compte.",
    providers: {
      google: "Google",
      apple: "Apple",
      microsoft: "Compte Microsoft personnel",
      facebook: "Facebook",
      github: "GitHub",
    },
    continueWith: "Continuer avec {{provider}}",
    available: "Ou utiliser un compte personnel",
    enabled: "Autoriser la connexion avec ce fournisseur",
    clientId: "Identifiant de l’application",
    clientSecret: "Secret de l’application",
    privateKey: "Clé privée Apple (contenu du fichier .p8)",
    teamId: "Identifiant d’équipe Apple",
    keyId: "Identifiant de clé Apple",
    graphVersion: "Version de l’API Facebook",
    redirectUri: "URL de rappel d’autorisation",
    redirectHelp:
      "Copiez cette adresse exacte dans la console développeur du fournisseur.",
    secretSaved: "Enregistré ; laissez vide pour le conserver",
    secretEmpty: "Saisissez le secret fourni par la plateforme",
    saved: "Paramètres enregistrés",
    guide: "Ouvrir la console développeur",
    credentialsHelp:
      "Les secrets servent uniquement à vérifier la connexion et ne sont jamais affichés après enregistrement. Effectuez un essai avec un compte de test avant la mise en service.",
    microsoftHelp:
      "Choisissez un type de compte d’application autorisant les comptes Microsoft personnels. Utilisez l’authentification unique d’entreprise pour les comptes professionnels.",
    appleHelp:
      "Utilisez votre Services ID comme identifiant d’application, avec les identifiants d’équipe et de clé ainsi que la clé privée correspondants. Un site HTTPS est requis.",
    facebookHelp:
      "Activez Facebook Login et saisissez la version de l’API sélectionnée dans votre console développeur (vXX.0).",
    googleHelp:
      "Créez un client OAuth de type application Web et configurez son URL de rappel d’autorisation.",
    githubHelp:
      "Créez une OAuth App dans les paramètres développeur GitHub, saisissez son Client ID et son Client Secret, puis copiez cette adresse dans Authorization callback URL.",
    bindings: "Comptes personnels associés",
    bindingsHelp:
      "Associez un compte pour vous connecter à votre profil existant. Les comptes partageant un même e-mail ne sont jamais fusionnés automatiquement.",
    link: "Associer {{provider}}",
    unlink: "Dissocier",
    linked: "Associé",
    unavailable: "Aucun fournisseur n’est disponible pour le moment.",
    unlinkTitle: "Dissocier ce compte personnel ?",
    unlinkDescription:
      "Vous devrez vous reconnecter. Vérifiez que vous disposez d’un mot de passe ou d’un autre moyen de connexion disponible.",
    verifyTitle: "Vérifier votre e-mail",
    verifyDescription:
      "Vérifiez l’adresse utilisée pour les notifications du compte et la récupération du mot de passe. Cette étape est requise uniquement lors de la première inscription.",
    sendEmail: "Envoyer l’e-mail de vérification",
    emailSent:
      "E-mail envoyé. Ouvrez le lien dans ce navigateur sous 15 minutes pour terminer l’inscription.",
    finish: "Vérifier et terminer l’inscription",
    callbackTitle: "Finaliser la connexion",
    returnSettings: "Retour à la sécurité du compte",
    errors: {
      failed:
        "L’autorisation n’a pas été finalisée ou a expiré. Revenez à la connexion et réessayez.",
      disabled: "Ce compte a été désactivé. Contactez un administrateur.",
      email_exists:
        "Un compte utilise déjà cet e-mail. Connectez-vous avec votre méthode habituelle, puis associez le compte personnel dans les paramètres de sécurité.",
      registration_disabled:
        "Les inscriptions sont actuellement fermées. Si vous possédez déjà un compte, connectez-vous d’abord pour y associer ce compte personnel.",
      last_method:
        "Définissez d’abord un mot de passe ou associez un autre moyen de connexion disponible.",
      already_linked:
        "Ce compte est déjà associé, ou vous avez associé un autre compte de ce fournisseur.",
      configuration_changed:
        "Les paramètres de connexion ont changé. Recommencez la connexion.",
    },
  },
  personalQuota: {
    title: "Utilisation des crédits",
    description: "Consultez vos crédits restants et leur utilisation.",
    overview: "Vue d’ensemble",
    analytics: "Analyses",
    weekly: "Quota hebdomadaire",
    weeklyDescription:
      "Votre quota est réinitialisé chaque lundi dans le fuseau horaire du système. L’historique d’utilisation reste disponible après chaque réinitialisation.",
    remaining: "Crédits restants",
    used: "Utilisés cette semaine",
    limit: "Limite hebdomadaire",
    unlimited: "Illimité",
    percentage: "{{value}} % utilisés",
    reset: "Prochaine réinitialisation : {{time}} ({{zone}})",
    updated: "Mis à jour {{time}} · {{zone}}",
    range: "Période",
    days: "{{count}} jours",
    history: "Historique d’utilisation des crédits",
    historyDescription:
      "Crédits facturés quotidiennement, répartis par type d’activité ou par modèle.",
    group: "Regrouper par",
    byWorkload: "Par type d’activité",
    byModel: "Par modèle",
    other: "Autres",
    unknown: "Inconnu",
    ranking: "Classement des tâches par utilisation",
    rankingDescription:
      "Trié par crédits utilisés sur cette période. Développez une tâche pour en voir les détails.",
    task: "Tâche",
    credits: "Crédits utilisés",
    unit: "crédits",
    unattributed: "Autres utilisations ou tâches supprimées",
    openTask: "Ouvrir la tâche",
    more: "Afficher plus",
    empty: "Aucun enregistrement sur cette période",
    tools: "Appels de plugins et de serveurs MCP",
    toolsDescription:
      "Appels d’outils terminés, y compris les échecs, regroupés par plugin ou serveur MCP. Il s’agit de volumes d’activité, pas de frais.",
    skills: "Utilisation des compétences",
    skillsDescription:
      "Utilisations par compétence. Une même compétence est comptée une seule fois par tour.",
    messages: "Messages",
    messagesDescription:
      "Messages utilisateur envoyés dans les tours de tâche, regroupés par modèle. Les réponses de l’IA, les messages en attente et l’historique copié dans les tâches dérivées sont exclus.",
  },
  webSites: {
    title: "Mes sites",
    description:
      "Gérez vos sites publiés, actualisez leur contenu ou retirez-les de la publication à tout moment.",
    share: "Publier comme site",
    dialog: {
      share: "Publier comme site",
      edit: "Modifier le site",
      publish: "Publier la mise à jour",
      delete: "Supprimer le site",
    },
    shareDescription:
      "Toute personne disposant du lien pourra consulter ce site après sa publication.",
    deleteDescription:
      "Le site et ses versions publiées seront définitivement supprimés. L’adresse pourra être réutilisée par quiconque. La tâche et les fichiers d’origine seront conservés.",
    name: "Nom du site",
    summary: "Description",
    slug: "Nom du lien",
    slugPlaceholder: "Laissez vide pour générer automatiquement",
    slugHelp: "Utilisez entre 3 et 80 lettres, chiffres ou traits d’union.",
    slugChanged: "Cette modification désactive immédiatement l’ancien lien.",
    url: "Lien du site",
    publishMode: "Mode de publication",
    updateExisting: "Mettre à jour un site existant",
    existingSite: "Sélectionner un site",
    selectExistingSite: "Choisissez un site à mettre à jour",
    currentTask: "Issu de cette tâche",
    noUpdateTargets:
      "Aucun site à mettre à jour. Choisissez Nouveau site pour commencer.",
    updateDescription:
      "Mettez à jour le site avec cette page Web en conservant son lien.",
    updateDisabledDescription:
      "Le site restera non publié après cette mise à jour. Vous pourrez le republier dans Mes sites.",
    updatedDescription:
      "Le contenu du site a été mis à jour. Son lien reste inchangé.",
    updateSite: "Mettre à jour le site",
    newSite: "Nouveau site",
    sourceFile: "Page Web",
    latestSource: "Dernière version : {{name}} · {{date}}",
    currentSource: "Version publiée : {{name}} · {{date}}",
    datedSource: "{{name}} · {{date}}",
    selectSource: "Choisissez une page Web de cette tâche",
    noSources:
      "Aucune page Web disponible. Générez d’abord une nouvelle version dans la tâche d’origine.",
    publishedTitle: "Site publié",
    updatedTitle: "Site mis à jour",
    publishedDescription:
      "Copiez le lien pour partager votre site. Retrouvez-le ensuite dans Mes sites.",
    stillDisabled:
      "Le contenu a été mis à jour, mais le site reste non publié. Republiez-le dans Mes sites.",
    copy: "Copier le lien",
    copied: "Lien copié",
    copyFailed: "Impossible de copier le lien. Copiez-le manuellement.",
    done: "Terminé",
    cancel: "Annuler",
    delete: "Supprimer le site",
    save: "Enregistrer",
    publish: "Publier le site",
    search: "Rechercher par nom ou lien",
    filter: "État de publication",
    status: {
      all: "Tous les états",
      published: "Publié",
      disabled: "Non publié",
    },
    empty: "Aucun site publié",
    emptyDescription:
      "Ouvrez une page Web générée dans une tâche et sélectionnez Publier comme site pour la gérer ici.",
    noResults: "Aucun site correspondant",
    sourceTask: "Source : {{title}}",
    sourceDeleted: "Tâche source supprimée",
    publishedAt: "Publié le {{date}}",
    resources: "{{count}} fichiers · {{size}}",
    visit: "Consulter",
    copyNamed: "Copier le lien de {{name}}",
    actions: "Gérer {{name}}",
    edit: "Modifier",
    update: "Publier la mise à jour",
    disable: "Retirer de la publication",
    enable: "Republier",
    download: "Télécharger le site",
    loadMore: "Charger plus",
    invalidSlug:
      "Saisissez entre 3 et 80 lettres, chiffres ou traits d’union, sans trait d’union au début ni à la fin.",
  },
  clientUpdate: {
    title: "Système mis à jour",
    description:
      "Une mise à jour du système est disponible. Actualisez la page pour continuer.",
    update: "Actualiser la page",
    updating: "Vérification de la mise à jour…",
    later: "Mettre à jour plus tard",
    forceRefreshTitle: "Comment forcer l’actualisation",
    windowsLabel: "Windows / Linux",
    windowsHelp: "Ctrl + Shift + R",
    macLabel: "Mac",
    macHelp: "⌘ + Shift + R ou ⌘ + ⌥ + R",
    mobileLabel: "Téléphone / tablette",
    mobileHelp: "Rouvrez la page ou effacez le cache de ce site.",
    notReady:
      "La mise à jour n’a pas encore pu aboutir. Réessayez dans un instant et vérifiez votre connexion. Votre page actuelle reste ouverte.",
    loadFailed:
      "Impossible de charger cette page. Vérifiez votre connexion et réessayez. Si une mise à jour est proposée, actualisez d’abord la page.",
  },
  embed: {
    defaultDescription:
      "Discutez avec cette application et utilisez toutes ses fonctionnalités métier configurées.",
    waitingForHost: "En attente de l’autorisation d’accès du système hôte…",
    authenticating: "Établissement d’une session sécurisée…",
    startingPublicSession: "Création d’une session d’accès public…",
    reconnecting: "Reconnexion…",
    starterQuestionsLabel: "Questions suggérées",
    history: "Liste des tâches",
    historyEmpty: "Aucune tâche",
    newConversation: "Nouvelle tâche",
    deleteTaskLabel: "Supprimer la tâche « {{name}} »",
    deleteTaskTitle: "Supprimer définitivement la tâche ?",
    deleteTaskDescription:
      "Les messages, pièces jointes et résultats de « {{name}} » seront définitivement supprimés et ne pourront pas être récupérés.",
    deleteTaskConfirm: "Supprimer définitivement",
    deletingTask: "Suppression…",
    inputLabel: "Envoyer un message à l’application",
    inputPlaceholder:
      "Saisissez un message et appuyez sur Entrée pour l’envoyer",
    attachFiles: "Joindre des fichiers",
    removeAttachment: "Retirer la pièce jointe {{name}}",
    uploading: "Envoi…",
    send: "Envoyer le message",
    stop: "Arrêter la génération",
    errors: {
      systemUnavailable:
        "L’état du système est temporairement indisponible. Vérifiez votre connexion et réessayez.",
      requestFailed: "Impossible d’actualiser la session. Réessayez.",
      authenticationFailed:
        "Impossible d’établir la session externe. Authentifiez-vous à nouveau via le système hôte.",
      hostAuthenticationFailed:
        "La page externe n’a pas pu vérifier l’accès. Vérifiez l’identifiant et le secret de l’application, puis réessayez.",
      publicSessionFailed:
        "Impossible de créer la session d’accès public. Vérifiez que l’application est configurée pour fonctionner sans authentification.",
      submitFailed: "Impossible d’envoyer le message. Réessayez.",
      interruptFailed: "Impossible d’arrêter la génération. Réessayez.",
      uploadFailed:
        "Impossible d’envoyer la pièce jointe. Vérifiez-la et réessayez.",
      removeAttachmentFailed:
        "Impossible de retirer la pièce jointe. Réessayez.",
      downloadFailed: "Impossible de télécharger le fichier. Réessayez.",
      answerFailed: "Impossible d’envoyer la réponse. Réessayez.",
      switchConversationFailed:
        "Impossible d’ouvrir la tâche précédente. Réessayez.",
      createConversationFailed: "Impossible de créer une tâche. Réessayez.",
      deleteTaskFailed:
        "Impossible de supprimer définitivement la tâche. Réessayez.",
    },
  },
  support: {
    menuLabel: "Avis et aide",
    feedback: "Donner un avis",
    help: "Aide",
    feedbackTitle: "Envoyer un avis",
    feedbackDescription:
      "Décrivez un problème rencontré ou une amélioration souhaitée.",
    feedbackLabel: "Votre avis",
    feedbackPlaceholder:
      "Décrivez votre avis ou collez du texte et des images…",
    feedbackImagesLabel: "Images",
    feedbackImagesHint:
      "Facultatif. Ajoutez jusqu’à {{count}} images PNG, JPEG, WebP ou GIF de {{size}} Mo maximum chacune. Vous pouvez aussi coller des images directement dans le champ de saisie.",
    addFeedbackImages: "Ajouter des images",
    selectedFeedbackImages: "Images sélectionnées pour votre avis",
    removeFeedbackImage: "Retirer l’image {{name}}",
    feedbackImageInvalid:
      "Choisissez des images respectant les formats et tailles autorisés.",
    feedbackImageCountError: "Vous pouvez ajouter jusqu’à {{count}} images.",
    submitFeedback: "Envoyer",
    submittingFeedback: "Envoi…",
    feedbackSubmitted: "Merci pour votre avis.",
  },
} as const
