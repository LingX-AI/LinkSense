export const applicationSetupFrFR = {
  title: "Guide de configuration de l’application",
  description:
    "Configurez les capacités nécessaires à {{name}} pour commencer à l’utiliser.",
  progress: "{{completed}} / {{total}} prêtes",
  required: "Obligatoire",
  unnamed: "{{type}} {{number}}",
  selected: "Ressource utilisée : {{name}}",
  choose: "Choisir une ressource personnelle",
  chooseNamed: "Choisir une ressource personnelle pour {{name}}",
  search: "Rechercher des ressources disponibles",
  manage: "Créer ou gérer les ressources",
  credentials: "Configurer les identifiants personnels",
  modelDefault: "Utiliser mon modèle préféré",
  modelHelp:
    "Choisissez un modèle disponible pour l’application ou utilisez votre modèle préféré. Contactez votre administrateur si aucun modèle n’est disponible.",
  check: "Vérifier à nouveau",
  later: "Continuer plus tard",
  complete: "Enregistrer et terminer",
  use: "Commencer à utiliser",
  completed: "La configuration de l’application est terminée.",
  ready:
    "Les capacités nécessaires sont prêtes. Vous pouvez utiliser l’application.",
  pending:
    "Configurez les éléments obligatoires ci-dessous. Chaque sélection est enregistrée pour vous permettre de continuer plus tard.",
  activate:
    "Les capacités nécessaires sont prêtes. Terminez la configuration pour appliquer ces paramètres à l’application.",
  note: "Ces vérifications reflètent la configuration actuelle des ressources et des autorisations. L’accès réel aux services externes dépend aussi de leur disponibilité et des droits du compte.",
  newTab:
    "Les pages de configuration s’ouvrent dans un nouvel onglet. À votre retour, l’état sera actualisé automatiquement ; vous pouvez aussi sélectionner « Vérifier à nouveau ».",
  types: {
    plugin: "Plugin",
    skill: "Skill",
    knowledge_base: "Base de connaissances",
    mcp_server: "Connexion MCP",
    model: "Modèle",
  },
  statuses: {
    configured: "Prête",
    unconfigured: "À configurer",
    unavailable: "Indisponible",
    credentials_required: "Identifiants requis",
  },
  purposes: {
    plugin:
      "Ce plugin fournit des actions à l’application. Effectuez les autorisations nécessaires avec les identifiants de votre propre compte.",
    skill:
      "Ce Skill fournit les instructions et les méthodes nécessaires aux tâches de l’application.",
    knowledge_base:
      "Fournissez les documents que l’application doit consulter. Choisissez une base de connaissances personnelle contenant les informations adaptées.",
    mcp_server:
      "Donnez à l’application accès aux services externes ou aux outils nécessaires. Choisissez la connexion correspondante que vous avez configurée.",
  },
} as const
