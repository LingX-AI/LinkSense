import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const settingsMessages = {
  settings: {
    navigationLabel: "Navegación de ajustes de {{productName}}",
    navigation: "Navegación de ajustes",
    backToApp: "Volver a {{productName}}",
    search: "Buscar ajustes",
    personalGroup: "Personal",
    administrationGroup: "Administración",
    usageDescription: "Consulta tareas, turnos y uso de tokens por modelo",
    general: "General",
    generalDescription:
      "Idioma, gestión de mensajes y notificaciones del navegador",
    profile: "Perfil",
    profileDescription: "Perfil y uso personal",
    personalization: "Personalización",
    personalizationDescription: "Instrucciones personalizadas y memoria",
    appearance: "Apariencia",
    appearanceDescription: "Tema y tamaño de letra",
    security: "Seguridad",
    securityDescription: "Cambiar la contraseña de acceso",
    credentials: "Credenciales de plugins",
    credentialsDescription: "Gestiona tus credenciales de plugins",
    mcp: "MCP",
    mcpDescription: "Gestiona tus servidores MCP HTTP y STDIO",
    channelAccess: "Canales de mensajería",
    channelAccessDescription:
      "Gestiona Weixin, WeCom, DingTalk, Teams, Feishu y otros canales",
    capabilitiesDescription:
      "Explora y gestiona apps, sitios y herramientas",
    archivedDescription: "Consulta las tareas archivadas",
    usersDescription: "Gestiona cuentas, roles y estados de usuarios",
    rolesDescription: "Consulta los roles predefinidos y sus permisos",
    groupsDescription: "Gestiona grupos de usuarios y sus miembros",
    usersAndGroupsDescription:
      "Gestiona cuentas, roles, estados y pertenencia a grupos",
    adminCapabilitiesDescription:
      "Revisa publicaciones y gestiona el centro de plugins",
    adminKnowledgeBasesDescription:
      "Administra las bases de conocimiento de todos los usuarios y configura fuentes externas",
    adminKnowledgeSourcesDescription:
      "Configura SharePoint y otras fuentes de conocimiento externas",
    auditDescription:
      "Consulta los registros de auditoría de todos los usuarios",
    feedbackDescription:
      "Revisa comentarios de usuarios y capturas de incidencias",
    modelSettings: "Ajustes de modelos",
    modelSettingsDescription:
      "Gestiona el servicio de modelos, los modelos y el esfuerzo de razonamiento",
    systemSettings: "Ajustes del sistema",
    systemSettingsDescription: "Ajustes del producto y de autenticación",
    systemHealth: "Estado del sistema",
    systemHealthDescription: "Estado de los servicios y sus dependencias",
    systemUpdate: "Actualización del sistema",
    systemUpdateDescription:
      "Busca nuevas versiones y consulta cómo actualizar de forma segura",
    noResults: "No hay ajustes que coincidan con tu búsqueda.",
    generalPageDescription:
      "Gestiona las preferencias de la interfaz que solo se aplican a tu cuenta.",
    interfaceLanguage: "Idioma de la interfaz",
    interfaceLanguageDescription: "Idioma de la aplicación",
    runningMessageAction: "Nuevos mensajes durante la ejecución",
    runningMessageActionDescription:
      "Mientras se ejecuta una tarea, los nuevos mensajes siguen automáticamente esta preferencia sin mostrar un diálogo de elección.",
    runningMessageActionSteer: "Dar indicaciones a la ejecución actual",
    runningMessageActionQueue: "Añadir a la cola como siguiente solicitud",
    profilePageDescription: "Actualiza tu nombre visible y tu avatar.",
    taskAutoNaming: "Nombres automáticos de tareas",
    taskAutoNamingDescription:
      "Asigna un nombre a las tareas con el primer mensaje o actualízalo con cada mensaje nuevo. Los nombres editados manualmente se conservan.",
    taskAutoNamingFrequency: "Frecuencia de asignación de nombres",
    taskAutoNamingFirstMessage: "Primer mensaje",
    taskAutoNamingEveryMessage: "Cada mensaje",
    taskAutoNamingSaved: "Preferencia de nombres de tareas guardada.",
    personalizationPageDescription:
      "Configura los nombres de tareas, las instrucciones personalizadas y la memoria.",
    thinkingDisplay: "Visualización del razonamiento",
    thinkingDisplayDescription:
      "Elige si quieres ver el razonamiento durante las tareas.",
    showReasoning: "Mostrar razonamiento",
    showReasoningDescription:
      "Muestra el texto completo del razonamiento del modelo, si está disponible. Los resúmenes breves se muestran en ambos casos.",
    customInstructions: "Instrucciones personalizadas",
    customInstructionsDescription:
      "Añade indicaciones y contexto para todas las tareas futuras. Las reglas de la plataforma y los límites de seguridad de cada tarea siempre tienen prioridad.",
    customInstructionsPlaceholder:
      "Por ejemplo: responde de forma concisa; empieza por la conclusión y añade después los detalles necesarios.",
    customInstructionsCount: "{{count}} / {{max}}",
    customInstructionsSaved: "Instrucciones personalizadas guardadas",
    unsavedChangesTitle: "¿Descartar los cambios sin guardar?",
    unsavedChangesDescription:
      "Si sales de esta página, perderás las instrucciones personalizadas que no hayas guardado.",
    stayOnPage: "Permanecer en la página",
    discardChanges: "Descartar cambios",
    memory: "Memoria",
    memoryDescription:
      "Configura cómo se crean, conservan y utilizan tus recuerdos personales.",
    enableMemories: "Activar recuerdos",
    enableMemoriesDescription:
      "Crea recuerdos a partir de tareas y utiliza los existentes en tareas futuras. Las tareas que usan herramientas externas o contexto web no crean recuerdos.",
    resetMemories: "Restablecer recuerdos",
    resetMemoriesDescription:
      "Elimina todos tus recuerdos sin eliminar tareas, instrucciones personalizadas, plugins ni Skills.",
    reset: "Restablecer",
    resetMemoriesConfirmTitle: "¿Restablecer todos los recuerdos?",
    resetMemoriesConfirmDescription:
      "Esta acción no se puede deshacer. Se conservarán tus tareas, instrucciones personalizadas, plugins y Skills.",
    resettingMemories: "Restableciendo recuerdos…",
    memoriesReset: "Recuerdos restablecidos",
    privacyMasking: "Enmascaramiento de privacidad",
    privacyMaskingDescription:
      "Sustituye secretos por marcadores antes de enviar una solicitud al proveedor del modelo y los restaura antes de que la respuesta llegue al entorno de ejecución.",
    privacyMaskingEnabled: "Activar el enmascaramiento de privacidad",
    privacyMaskingEnabledDescription:
      "Solo se aplica a las solicitudes enviadas al proveedor del modelo. LinkSense sigue guardando el historial y los eventos tal como se escribieron.",
    privacyMaskingSecrets: "Secretos y credenciales",
    privacyMaskingSecretsDescription:
      "Claves de API, tokens, claves privadas, contraseñas y valores de las cabeceras Authorization o Cookie.",
    privacyMaskingWords: "Palabras personalizadas",
    privacyMaskingWordsDescription:
      "Una palabra o frase por línea: nombres de proyectos, nombres internos o nombres que no quieres enviar al proveedor.",
    privacyMaskingWordsPlaceholder: "Proyecto Nightjar\nInterno de Acme",
    privacyMaskingWordsCount: "{{count}} / {{max}}",
    privacyMaskingAnyCase: "Coincidir sin distinguir mayúsculas",
    privacyMaskingAnyCaseDescription:
      "Trata nightjar, Nightjar y NIGHTJAR como la misma palabra.",
    privacyMaskingWholeWord: "Solo palabras completas",
    privacyMaskingWholeWordDescription:
      "No enmascara una palabra dentro de otra palabra o identificador más largo.",
    privacyMaskingAllow: "Valores permitidos",
    privacyMaskingAllowDescription:
      "Un valor por línea. Un valor que coincida exactamente se envía tal cual, por ejemplo un correo de prueba.",
    privacyMaskingAllowPlaceholder: "ejemplo@ejemplo.test",
    privacyMaskingSaved: "Configuración de enmascaramiento guardada.",
    privacyMaskingSave: "Guardar enmascaramiento",
    privacyMaskingBehaviorNote:
      "El modelo ve marcadores en lugar de los valores reales. Las tareas que deben inspeccionar un secreto pueden no funcionar hasta que añadas ese valor a la lista permitida.",
    privacyMaskingPageDescription:
      "Elige qué no llega nunca al proveedor del modelo y prueba las reglas con un texto de ejemplo antes de iniciar una tarea.",
    privacyMaskingWhatToMask: "Qué enmascarar",
    privacyMaskingTryIt: "Probar",
    privacyMaskingTryItDescription:
      "Pega un texto que podría enviar un agente. Aquí se enmascara igual que en una solicitud real y no se guarda nada.",
    privacyMaskingTryItPlaceholder:
      "Despliega con la clave sk-proj-… y llama a la API de preproducción",
    privacyMaskingTryItOutput: "Lo que recibiría el proveedor",
    privacyMaskingTryItEmpty: "Nada de este texto se enmascararía.",
    privacyMaskingTryItOffNote:
      "El enmascaramiento está desactivado. Esta vista previa muestra lo que se sustituiría al activarlo.",
    privacyMaskingKindPrivateKey: "Clave privada",
    privacyMaskingKindApiKey: "Clave de API",
    privacyMaskingKindToken: "Token",
    privacyMaskingKindSecret: "Secreto",
    privacyMaskingKindPassword: "Contraseña",
    privacyMaskingKindTerm: "Palabra personalizada",
    privacyMaskingKindEmail: "Correo electrónico",
    privacyMaskingKindPhone: "Número de teléfono",
    privacyMaskingKindIdCard: "Número de documento de identidad",
    privacyMaskingKindBankCard: "Número de tarjeta bancaria",
    privacyMaskingActivity: "Actividad de enmascaramiento",
    privacyMaskingActivityDescription:
      "Solicitudes al modelo en las que se sustituyeron valores, conservadas 30 días. Solo se guardan recuentos, nunca los valores.",
    privacyMaskingActivityPeriod: "Periodo",
    privacyMaskingActivity7Days: "7 días",
    privacyMaskingActivity30Days: "30 días",
    privacyMaskingActivityMasked: "valores sustituidos",
    privacyMaskingActivityRequests: "solicitudes",
    privacyMaskingActivityEmpty:
      "Aún no hay solicitudes enmascaradas en este periodo.",
    privacyMaskingActivityLoadMore: "Cargar más",
    privacyMaskingActivityHintLength: "{{length}} caracteres",
    privacyMaskingActivityLocationPrompt: "Indicación",
    privacyMaskingActivityLocationInstructions: "Instrucciones",
    privacyMaskingActivityLocationToolArguments:
      "Argumentos de la herramienta",
    privacyMaskingActivityLocationToolOutput: "Salida de la herramienta",
    privacyMaskingActivityLocationTools: "Definiciones de herramientas",
    privacyMaskingActivityLocationOther: "Otro",
    appearancePageDescription:
      "Configura el tema y el tamaño de letra base de {{productName}}.",
    theme: "Tema",
    themeSystem: "Sistema",
    themeLight: "Claro",
    themeDark: "Oscuro",
    uiFontSize: "Tamaño de letra de la interfaz",
    uiFontSizeDescription:
      "Ajusta el tamaño de letra base de {{productName}}, entre {{min}} y {{max}} px.",
    uiFontSizeUnit: "px",
    securityPageDescription:
      "Cambia tu contraseña de acceso local y revoca las sesiones abiertas.",
  },
  browserNotifications: {
    settingsTitle: "Notificaciones del navegador",
    settingsDescription:
      "Cuando no estés usando LinkSense, este navegador te avisará si una tarea normal o una automatización finaliza correctamente, falla o se interrumpe.",
    promptMessage:
      "Recibe notificaciones y sonidos del navegador cuando terminen las tareas.",
    promptDismiss: "Ahora no",
    promptEnable: "Activar",
    promptEnabling: "Activando",
    enable: "Activar notificaciones del navegador",
    unsupported:
      "Este navegador o entorno no admite notificaciones. Abre LinkSense en una página segura de un navegador compatible.",
    permissionDenied:
      "El navegador bloquea las notificaciones. Permítelas en los permisos de este sitio y vuelve a intentarlo aquí.",
    permissionDismissed:
      "No se han permitido las notificaciones. Activa de nuevo esta opción y elige Permitir en el aviso del navegador.",
    permissionRequired:
      "La preferencia está guardada, pero el permiso del navegador se ha restablecido. Desactiva y vuelve a activar las notificaciones para conceder el permiso.",
    permissionError:
      "No se pudo solicitar permiso para las notificaciones. Inténtalo más tarde.",
    storageError:
      "No se pudo guardar este ajuste en el navegador. Las notificaciones se han detenido en esta página; actualízala y comprueba de nuevo el interruptor.",
    deliveryError:
      "El navegador no pudo crear una notificación del sistema, por lo que siguen desactivadas. Comprueba los permisos del sitio y los ajustes de notificaciones de este navegador en tu sistema operativo.",
    feedError:
      "No se pudo conectar con el servicio de notificaciones de tareas completadas, por lo que siguen desactivadas. Comprueba la conexión e inténtalo de nuevo.",
    testTitle: "{{productName}} · Prueba de notificación del navegador",
    testBody:
      "Las notificaciones están conectadas. Recibirás un aviso aquí cuando una tarea o automatización produzca un resultado.",
    testSent:
      "Se ha enviado una notificación de prueba al sistema. Si no la has visto, comprueba los ajustes de notificaciones de este navegador en tu sistema operativo.",
    desktopTitle: "Notificaciones de macOS",
    desktopDescription:
      "Recibe una notificación cuando termine una tarea o automatización mientras LinkSense está en segundo plano.",
    desktopEnable: "Activar las notificaciones de macOS",
    desktopUnsupported:
      "Las notificaciones no están disponibles en esta compilación de la aplicación. Usa una aplicación de escritorio LinkSense empaquetada para recibir notificaciones al completar tareas.",
    desktopPermissionDenied:
      "macOS ha bloqueado las notificaciones de {{productName}}. Permítelas en Ajustes del Sistema > Notificaciones y vuelve a intentarlo.",
    desktopDeliveryError:
      "El sistema no pudo mostrar la notificación. Revisa los ajustes de notificaciones de {{productName}} en Ajustes del Sistema de macOS y vuelve a intentarlo.",
    desktopTestSent:
      "Se ha enviado una notificación de prueba al sistema. Si no la has visto, revisa los ajustes de notificaciones de {{productName}} en Ajustes del Sistema de macOS.",
    notificationTitle: "{{productName}} · {{taskTitle}}",
    statusCompletedBody: "Procesado correctamente",
    statusFailedBody: "Error de procesamiento",
    statusInterruptedBody: "Procesamiento interrumpido",
  },
  profile: {
    title: "Ajustes personales",
    description:
      "Gestiona tu avatar, el idioma de la interfaz y la seguridad de acceso.",
    avatar: "Avatar",
    uploadAvatar: "Subir un nuevo avatar",
    editName: "Editar nombre",
    editNameTitle: "Editar nombre",
    editNameDescription: "Actualiza tu nombre visible.",
    role: "Rol",
    profileSaved: "Ajustes personales guardados.",
    passwordChanged: "Contraseña cambiada. Vuelve a iniciar sesión.",
    general: "General",
    security: "Seguridad de acceso",
    avatarSaved: "Avatar actualizado.",
    usageSummary: "Resumen de uso personal",
    loadingUsage: "Cargando uso personal…",
    totalTokens: "Tokens totales",
    peakDailyTokens: "Máximo diario de tokens",
    totalTasks: "Tareas totales",
    currentStreak: "Racha actual",
    longestStreak: "Racha más larga",
    dayCount_one: "{{count}} día",
    dayCount_other: "{{count}} días",
    tokenActivity: "Actividad de tokens",
    tokenActivityDescription:
      "Tu uso diario de tokens durante los últimos 365 días.",
    activityChartLabel:
      "Mapa de calor de la actividad de tokens de los últimos 365 días",
    activityDayLabel: "{{date}}, {{tokens}} tokens utilizados",
    activityTooltip: "{{date}}: {{tokens}} tokens utilizados",
    activityLess: "Menos",
    activityMore: "Más",
    activityUnavailable: "Todavía no hay actividad de tokens disponible.",
    usageInsights: "Análisis de uso",
    totalTurns: "Conversaciones totales",
    modelCalls: "Llamadas totales a modelos",
    skillUses: "Usos de Skills",
    activeDays: "Días activos",
    averageTokensPerTurn: "Media de tokens por turno",
    mostUsedModels: "Modelos más utilizados",
    mostUsedSkills: "Skills más utilizadas",
    modelUsageShare:
      "{{model}} representa el {{share}} % de los tokens totales",
    skillUsageCount_one: "{{count}} uso",
    skillUsageCount_other: "{{count}} usos",
    noModelUsage: "Todavía no se ha registrado uso de modelos.",
    noSkillUsage: "Todavía no se ha registrado uso de Skills.",
    passwordDescription:
      "Cambiar la contraseña revoca las sesiones existentes y requiere que vuelvas a iniciar sesión.",
  },
  clientUpdate: {
    title: "Sistema actualizado",
    description:
      "Hay una actualización del sistema disponible. Actualiza la página para continuar.",
    update: "Actualizar página",
    updating: "Comprobando actualización…",
    later: "Actualizar más tarde",
    forceRefreshTitle: "Cómo forzar la actualización",
    windowsLabel: "Windows / Linux",
    windowsHelp: "Ctrl + Shift + R",
    macLabel: "Mac",
    macHelp: "⌘ + Shift + R o ⌘ + ⌥ + R",
    mobileLabel: "Teléfono / tableta",
    mobileHelp: "Vuelve a abrir la página o borra la caché de este sitio.",
    notReady:
      "Todavía no se pudo completar la actualización. Inténtalo de nuevo en unos instantes y comprueba la conexión. La página actual sigue abierta.",
    loadFailed:
      "No se pudo cargar esta página. Comprueba la conexión e inténtalo de nuevo. Si aparece un aviso de actualización, actualiza primero la página.",
  },
} satisfies TranslationResource<
  Pick<
    typeof enUS,
    "settings" | "browserNotifications" | "profile" | "clientUpdate"
  >
>
