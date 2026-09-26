import { connectionMessages } from "@/features/connections/messages"
import { samlesES } from "@/features/saml/messages"
import type { enUS } from "@/i18n/en-US"
import { settingsMessages } from "@/i18n/es-ES/settings"
import { automationMessages } from "@/i18n/es-ES/automation"
import { previewMessages } from "@/i18n/es-ES/preview"
import { accountMessages } from "@/i18n/es-ES/account"
import { applicationsMessages } from "@/i18n/es-ES/applications"
import { marketplaceMessages } from "@/i18n/es-ES/marketplace"
import { channelMessages } from "@/i18n/es-ES/channels"
import { capabilityMessages } from "@/i18n/es-ES/capabilities"
import { usageMessages } from "@/i18n/es-ES/usage"
import { developmentMessages } from "@/i18n/es-ES/development"
import { errorMessages } from "@/i18n/es-ES/errors"
import { siteMessages } from "@/i18n/es-ES/sites"
import type { TranslationResource } from "@/i18n/types"
import { conversationMessages } from "@/i18n/es-ES/conversation"
import { adminMessages } from "@/i18n/es-ES/admin"
import { knowledgeMessages } from "@/i18n/es-ES/knowledge"

export const esES = {
  connections: connectionMessages["es-ES"],
  saml: samlesES,
  common: {
    poweredBy: "Powered by",
    poweredByLinkSense: "Con tecnología de LinkSense",
    dateRange: {
      label: "Rango de fechas",
      createdLabel: "Rango de fechas de creación",
      lastRunLabel: "Rango de última ejecución",
      value: "{{from}} – {{to}}",
      clear: "Borrar {{label}}",
      selectStart: "Selecciona la fecha inicial y luego la final.",
      selectEnd: "Inicio: {{date}}. Selecciona la fecha final.",
    },
    close: "Cerrar",
    notifications: "Notificaciones",
    cancel: "Cancelar",
    save: "Guardar",
    saving: "Guardando…",
    create: "Crear",
    update: "Actualizar",
    delete: "Eliminar",
    edit: "Editar",
    confirm: "Confirmar",
    gotIt: "Entendido",
    retry: "Reintentar",
    loadMore: "Cargar más",
    continue: "Continuar",
    search: "Buscar",
    loading: "Cargando…",
    pageLoading: "Cargando…",
    actions: "Acciones",
    status: "Estado",
    name: "Nombre",
    description: "Descripción",
    view: "Ver",
    email: "Correo electrónico",
    type: "Tipo",
    scope: "Ámbito",
    createdAt: "Creado",
    updatedAt: "Actualizado",
    language: "Idioma",
    chinese: "简体中文",
    english: "English",
    spanish: "Español",
    portuguese: "Português (Brasil)",
    french: "Français",
    japanese: "日本語",
    settings: "Configuración",
    signOut: "Cerrar sesión",
    empty: "Sin datos",
    notAvailable: "No disponible",
    back: "Volver",
    details: "Detalles",
    more: "Más acciones",
    moreActionsNamed: "Más acciones para {{name}}",
    enabled: "Activado",
    disabled: "Desactivado",
    active: "Activo",
    system: "Sistema",
    user: "Usuario",
    admin: "Administrador",
    upload: "Subir",
    download: "Descargar",
    previous: "Anterior",
    next: "Siguiente",
    refresh: "Actualizar",
    all: "Todos",
    select: "Seleccionar",
    notFound: "Página no encontrada.",
    configured: "Configurado",
    notConfigured: "Sin configurar",
    enable: "Activar",
    disable: "Desactivar",
    yes: "Sí",
    no: "No",
    copy: "Copiar",
    copied: "Copiado.",
    copyNamed: "Copiar {{name}}",
    clear: "Limpiar",
  },
  reasoningEffort: {
    minimal: "Mínimo",
    low: "Ligero",
    medium: "Medio",
    high: "Alto",
    xhigh: "Muy alto",
    max: "Máximo",
    ultra: "Ultra",
  },
  nav: {
    navigationLabel: "Navegación de {{productName}}",
    newConversation: "Nueva tarea",
    automations: "Automatizaciones",
    conversations: "Tareas",
    archived: "Tareas archivadas",
    capabilities: "Centro de complementos",
    knowledgeBases: "Biblioteca de recursos",
    pinned: "Fijados",
    projects: "Proyectos",
    recent: "Recientes",
    administration: "Administración",
    usage: "Análisis de uso",
    users: "Usuarios",
    roles: "Roles y permisos",
    groups: "Grupos de usuarios",
    adminCapabilities: "Centro de complementos",
    adminKnowledgeBases: "Bases de conocimiento",
    adminKnowledgeSources: "Fuentes de conocimiento",
    audit: "Registros de auditoría",
    feedback: "Comentarios de usuarios",
    usersAndGroups: "Usuarios y grupos",
    productSettings: "Configuración del sistema",
    health: "Estado del sistema",
    open: "Abrir navegación",
    collapseSidebar: "Contraer barra lateral",
    expandSidebar: "Expandir barra lateral",
    resizeSidebar: "Cambiar tamaño de la barra lateral",
    helpCenter: "Centro de ayuda",
    helpCenterNewTab: "Abrir el Centro de ayuda en una pestaña nueva",
    automationNotifications: "Notificaciones de automatización",
    automationNotificationsUnread:
      "Notificaciones de automatización con una tarea completada sin leer",
    automationTask: "Tarea de automatización",
    unreadCompletion: "Tarea completada y aún no vista",
    unreadFailure: "La tarea ha fallado y aún no se ha visto",
    creditQuotaRemainingTitle: "Créditos",
    creditQuotaRemaining: "{{weekly}}",
    creditQuotaUnlimited: "Sin límite",
  },
  auth: {
    loginTitle: "Iniciar sesión en {{productName}}",
    loginDescription: "Continúa con uno de los métodos disponibles.",
    passwordLogin: "Correo electrónico y contraseña",
    password: "Contraseña",
    signIn: "Iniciar sesión",
    signOutTitle: "¿Cerrar sesión?",
    signOutDescription:
      "Tendrás que volver a iniciar sesión para seguir usando {{productName}}.",
    forgotPassword:
      "He olvidado la contraseña o quiero crearla por primera vez",
    forgotTitle: "Crear o restablecer la contraseña",
    forgotDescription:
      "Introduce tu correo electrónico. Si la cuenta cumple los requisitos, el sistema enviará un enlace seguro.",
    sendResetLink: "Enviar enlace seguro",
    resetRequestSubmitted: "Solicitud de enlace seguro enviada",
    resetRequestFailed: "No se pudo enviar el enlace seguro",
    resetAccepted:
      "Si el correo pertenece a una cuenta válida, se enviará un mensaje para crear o restablecer la contraseña.",
    resetTitle: "Crear una contraseña nueva",
    resetDescription:
      "El enlace seguro solo puede usarse una vez. Crea una contraseña que cumpla la política.",
    newPassword: "Contraseña nueva",
    currentPassword: "Contraseña actual",
    confirmPassword: "Confirmar contraseña nueva",
    showPassword: "Mostrar {{field}}",
    hidePassword: "Ocultar {{field}}",
    resetPassword: "Guardar contraseña nueva",
    resetCompleted: "La contraseña se ha guardado. Vuelve a iniciar sesión.",
    changePassword: "Cambiar contraseña",
    passwordPolicy:
      "Entre 8 y 16 caracteres, con mayúsculas, minúsculas, un número y un signo de puntuación o símbolo.",
    oidc: "Usar inicio de sesión único",
    teamsSigningIn: "Iniciando sesión silenciosamente con Microsoft Teams…",
    teamsNotConfigured:
      "El inicio de sesión único de Teams no está configurado. Inicia sesión en {{productName}}.",
    teamsFailed:
      "No se pudo iniciar sesión con Teams. Reinténtalo o usa otro método.",
    callbackTitle: "Completando el inicio de sesión único",
    oidcAccountPendingApproval:
      "El inicio de sesión único se completó. Tu cuenta se ha creado y espera la aprobación de un administrador. Contacta con un administrador y vuelve a iniciar sesión cuando esté activada.",
    externalAccountPendingApproval:
      "El inicio de sesión se completó. Tu cuenta se ha creado y espera la aprobación de un administrador. Contacta con un administrador y vuelve a iniciar sesión cuando esté activada.",
    oidcCallbackFailed:
      "No se pudo completar el inicio de sesión único. Vuelve a la página de inicio de sesión e inténtalo de nuevo.",
    oidcCallbackSessionFailed:
      "El inicio de sesión único terminó, pero no se pudo crear la sesión de {{productName}}. Vuelve a la página de inicio de sesión e inténtalo de nuevo.",
    backToLogin: "Volver al inicio de sesión",
    sessionExpired: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
    sessionRestoreFailed:
      "No se pudo restaurar tu sesión. Comprueba la conexión e inténtalo de nuevo.",
    registration: {
      signUpPrompt:
        "¿No tienes una cuenta? <register>Regístrate ahora</register>",
      title: "Crear una cuenta de {{productName}}",
      description:
        "Introduce tu correo electrónico y, si cumple los requisitos, enviaremos un enlace de activación.",
      closed: "El registro está cerrado en este momento.",
      disabled: "El registro está cerrado en este momento.",
      sendActivationLink: "Enviar correo de activación",
      requestSubmitted: "Correo de activación solicitado",
      requestFailed: "No se pudo enviar el correo de activación",
      requestAccepted:
        "Si la dirección cumple los requisitos, se enviará un correo de activación de la cuenta.",
      emailUnavailable:
        "El correo de activación no está disponible temporalmente. Inténtalo más tarde.",
      deliveryFailed:
        "No se pudo enviar el correo de activación. Inténtalo más tarde.",
      activateTitle: "Crea una contraseña y activa tu cuenta",
      activateDescription:
        "El enlace de activación solo puede usarse una vez. Crea una contraseña que cumpla la política.",
      activate: "Activar cuenta e iniciar sesión",
      invalidOrExpired:
        "El enlace de activación no es válido o ha caducado. Solicita uno nuevo.",
      emailAlreadyRegistered:
        "Ya existe una cuenta con este correo. Inicia sesión o restablece la contraseña.",
    },
  },
  statuses: {
    idle: "Inactivo",
    running: "En ejecución",
    pending: "Pendiente",
    completed: "Completado",
    failed: "Fallido",
    declined: "Rechazado",
    interrupted: "Interrumpido",
    active: "Activo",
    disabled: "Desactivado",
    approved: "Aprobado",
    rejected: "Rechazado",
    pendingApproval: "Pendiente de aprobación",
    revoked: "Revocado",
    cancelled: "Cancelado",
    success: "Correcto",
    failure: "Error",
  },
  validation: {
    required: "Este campo es obligatorio.",
    email: "Introduce una dirección de correo válida.",
    passwordMismatch: "Las contraseñas no coinciden.",
    riskRequired: "Revisa y confirma primero el origen y el aviso de riesgo.",
  },
  bootstrap: {
    unavailableTitle: "{{productName}} no está disponible temporalmente",
    unavailableDescription:
      "No se puede conectar con {{productName}}. Espera un momento o vuelve a intentarlo.",
  },
  maintenance: {
    title: "Mantenimiento del sistema",
    indicatorLabel: "Mantenimiento del sistema activado",
    dialogTitle: "Mantenimiento del sistema activado",
    dialogDescription:
      "Los usuarios normales no pueden acceder al sistema ahora. Puedes seguir usándolo y administrándolo. Desactiva el modo de mantenimiento cuando termines.",
    reasonLabel: "Detalles del mantenimiento",
    doNotShowAgain: "No volver a mostrar",
    rememberFailed:
      "No se pudo guardar tu preferencia. Comprueba si el navegador permite guardar datos del sitio. Puedes cerrar este aviso con el botón de la esquina superior derecha.",
    openSettings: "Configuración de mantenimiento",
    defaultReason: "El sistema está en mantenimiento programado.",
    description:
      "Esta página se recuperará automáticamente cuando finalice el mantenimiento. Inténtalo más tarde.",
    windowLabel: "Periodo de mantenimiento previsto",
    windowValue: "De {{start}} a {{end}}",
    adminEntry: "Inicio de sesión de administrador",
  },
  ...settingsMessages,
  ...automationMessages,
  ...previewMessages,
  ...accountMessages,
  ...applicationsMessages,
  ...marketplaceMessages,
  ...channelMessages,
  ...capabilityMessages,
  ...usageMessages,
  ...developmentMessages,
  ...errorMessages,
  ...siteMessages,
  ...conversationMessages,
  ...adminMessages,
  ...knowledgeMessages,
} satisfies TranslationResource<typeof enUS>
