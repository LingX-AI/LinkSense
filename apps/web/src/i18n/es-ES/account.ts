import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const accountMessages = {
  social: {
    disableHelp:
      "Al desactivar este proveedor, nadie podrá iniciar sesión con él. Asegúrate primero de que los usuarios afectados tengan otra forma de acceso.",
    setupPassword: "Establecer o restablecer la contraseña por correo",
    title: "Cuentas de terceros",
    configure: "Configurar",
    configureProvider: "Configurar {{provider}}",
    providerDescription: "Regístrate o accede con {{provider}}.",
    statusEnabled: "Activado",
    statusDisabled: "Desactivado",
    statusNotConfigured: "Sin configurar",
    description:
      "Regístrate o accede con cuentas de Google, Apple y otros proveedores. Si el registro está abierto, los nuevos usuarios pueden acceder tras verificar su correo, sin activación del administrador. Los usuarios existentes deben iniciar sesión antes de vincular una cuenta.",
    providers: {
      google: "Google",
      apple: "Apple",
      microsoft: "Cuenta personal de Microsoft",
      facebook: "Facebook",
      github: "GitHub",
    },
    continueWith: "Continuar con {{provider}}",
    available: "O utiliza una cuenta social",
    enabled: "Permitir el acceso con este proveedor",
    clientId: "ID de la aplicación",
    clientSecret: "Secreto de la aplicación",
    privateKey: "Clave privada de Apple (contenido del archivo .p8)",
    teamId: "ID del equipo de Apple",
    keyId: "ID de la clave de Apple",
    graphVersion: "Versión de la API de Facebook",
    redirectUri: "URL de retorno de autorización",
    redirectHelp:
      "Copia esta dirección exacta en la consola de desarrolladores del proveedor.",
    secretSaved: "Guardado; deja el campo vacío para conservarlo",
    secretEmpty: "Introduce el secreto proporcionado por la plataforma",
    saved: "Ajustes guardados",
    guide: "Abrir consola de desarrolladores",
    credentialsHelp:
      "Los secretos solo se usan para verificar el acceso y no se muestran después de guardarlos. Prueba con una cuenta de prueba antes de la puesta en servicio.",
    microsoftHelp:
      "Elige un tipo de cuenta de aplicación que permita cuentas personales de Microsoft. Para cuentas de trabajo, usa el SSO empresarial.",
    appleHelp:
      "Usa el Services ID como ID de aplicación, junto con el Team ID, Key ID y la clave privada correspondientes. Se requiere un sitio HTTPS.",
    facebookHelp:
      "Activa Facebook Login e introduce la versión de API seleccionada actualmente en la consola de desarrolladores (vXX.0).",
    googleHelp:
      "Crea un cliente OAuth de tipo aplicación web y configura su URL de retorno de autorización.",
    githubHelp:
      "Crea una OAuth App en los ajustes de desarrollador de GitHub, introduce su Client ID y Client Secret y copia esta dirección en Authorization callback URL.",
    bindings: "Cuentas sociales vinculadas",
    bindingsHelp:
      "Vincula una cuenta para acceder a tu perfil existente. Las cuentas con el mismo correo nunca se fusionan automáticamente.",
    link: "Vincular {{provider}}",
    unlink: "Desvincular",
    linked: "Vinculada",
    unavailable: "No hay proveedores disponibles para vincular.",
    unlinkTitle: "¿Desvincular esta cuenta social?",
    unlinkDescription:
      "Tendrás que volver a iniciar sesión. Asegúrate de tener una contraseña u otro método de acceso disponible.",
    verifyTitle: "Verifica tu correo",
    verifyDescription:
      "Verifica el correo utilizado para las notificaciones de la cuenta y la recuperación de contraseña. Este paso solo es necesario al registrarte por primera vez.",
    sendEmail: "Enviar correo de verificación",
    emailSent:
      "Correo enviado. Abre el enlace en este navegador en un plazo de 15 minutos para completar el registro.",
    finish: "Verificar y completar el registro",
    callbackTitle: "Completar el acceso con cuenta social",
    returnSettings: "Volver a la seguridad de la cuenta",
    errors: {
      failed:
        "La autorización no se completó o ha caducado. Vuelve al inicio de sesión e inténtalo de nuevo.",
      disabled: "Esta cuenta está desactivada. Contacta con un administrador.",
      email_exists:
        "Ya existe una cuenta con este correo. Accede con tu método habitual y vincula la cuenta social en los ajustes de seguridad de la cuenta.",
      registration_disabled:
        "El registro está cerrado. Si ya tienes una cuenta, inicia sesión primero y vincula esta cuenta social.",
      last_method:
        "Primero establece una contraseña o vincula otro método de acceso disponible.",
      already_linked:
        "Esta cuenta social ya está vinculada o has vinculado otra cuenta de este proveedor.",
      configuration_changed:
        "Los ajustes de acceso han cambiado. Inicia de nuevo el proceso de acceso.",
    },
  },
  loginMethods: {
    saml: "SAML 2.0",
    google: "Google",
    apple: "Apple",
    microsoft: "Microsoft",
    facebook: "Facebook",
    github: "GitHub",
    password: "Contraseña local",
    oidc: "Inicio de sesión único",
    teams: "SSO de Teams",
  },
  initialize: {
    title: "Inicializar {{productName}}",
    description:
      "Crea el primer administrador. La infraestructura y los secretos se gestionan desde el despliegue.",
    adminName: "Nombre del administrador",
    credential: "Credencial de inicialización de un solo uso",
    credentialHint:
      "Introduce la credencial de un solo uso que aparece en el terminal tras la instalación. Deja de ser válida al crear el administrador.",
    systemName: "Nombre del sistema",
    submit: "Crear administrador y finalizar configuración",
    completed:
      "Inicialización completada. Inicia sesión con la cuenta de administrador.",
  },
  embed: {
    defaultDescription:
      "Chatea con esta aplicación y utiliza todas las funciones de negocio que tiene configuradas.",
    waitingForHost: "Esperando a que el sistema anfitrión proporcione acceso…",
    authenticating: "Estableciendo una sesión segura…",
    startingPublicSession: "Creando una sesión de acceso público…",
    reconnecting: "Reconectando…",
    starterQuestionsLabel: "Preguntas sugeridas",
    history: "Lista de tareas",
    historyEmpty: "No hay tareas",
    newConversation: "Nueva tarea",
    deleteTaskLabel: "Eliminar tarea «{{name}}»",
    deleteTaskTitle: "¿Eliminar la tarea permanentemente?",
    deleteTaskDescription:
      "Los mensajes, adjuntos y resultados de «{{name}}» se eliminarán permanentemente y no podrán recuperarse.",
    deleteTaskConfirm: "Eliminar permanentemente",
    deletingTask: "Eliminando…",
    inputLabel: "Enviar un mensaje a la aplicación",
    inputPlaceholder: "Escribe un mensaje y pulsa Intro para enviarlo",
    attachFiles: "Adjuntar archivos",
    removeAttachment: "Quitar adjunto {{name}}",
    uploading: "Subiendo…",
    send: "Enviar mensaje",
    stop: "Detener generación",
    errors: {
      systemUnavailable:
        "El estado del sistema no está disponible temporalmente. Comprueba la conexión e inténtalo de nuevo.",
      requestFailed: "No se pudo actualizar la sesión. Inténtalo de nuevo.",
      authenticationFailed:
        "No se pudo establecer la sesión externa. Autentícate de nuevo a través del sistema anfitrión.",
      hostAuthenticationFailed:
        "La página externa no pudo verificar el acceso. Comprueba el ID y el secreto de la aplicación e inténtalo de nuevo.",
      publicSessionFailed:
        "No se pudo crear la sesión de acceso público. Comprueba que la aplicación esté configurada para no exigir autenticación.",
      submitFailed: "No se pudo enviar el mensaje. Inténtalo de nuevo.",
      interruptFailed: "No se pudo detener la generación. Inténtalo de nuevo.",
      uploadFailed:
        "No se pudo subir el adjunto. Revísalo e inténtalo de nuevo.",
      removeAttachmentFailed:
        "No se pudo quitar el adjunto. Inténtalo de nuevo.",
      downloadFailed: "No se pudo descargar el archivo. Inténtalo de nuevo.",
      answerFailed: "No se pudo enviar la respuesta. Inténtalo de nuevo.",
      switchConversationFailed:
        "No se pudo abrir la tarea anterior. Inténtalo de nuevo.",
      createConversationFailed:
        "No se pudo crear una nueva tarea. Inténtalo de nuevo.",
      deleteTaskFailed:
        "No se pudo eliminar la tarea permanentemente. Inténtalo de nuevo.",
    },
  },
  support: {
    feedback: "Comentarios",
    help: "Guía de uso",
    feedbackTitle: "Enviar comentarios",
    feedbackDescription:
      "Cuéntanos un problema que hayas encontrado o algo que podamos mejorar.",
    feedbackLabel: "Comentarios",
    feedbackPlaceholder: "Describe tus comentarios o pega texto e imágenes…",
    feedbackImagesLabel: "Imágenes",
    feedbackImagesHint:
      "Opcional. Añade hasta {{count}} imágenes PNG, JPEG, WebP o GIF de un máximo de {{size}} MB cada una. También puedes pegarlas directamente en el campo de comentarios.",
    addFeedbackImages: "Añadir imágenes",
    selectedFeedbackImages: "Imágenes seleccionadas",
    removeFeedbackImage: "Quitar imagen {{name}}",
    feedbackImageInvalid:
      "Elige imágenes que cumplan los requisitos de formato y tamaño.",
    feedbackImageCountError: "Puedes subir un máximo de {{count}} imágenes.",
    submitFeedback: "Enviar",
    submittingFeedback: "Enviando…",
    feedbackSubmitted: "Gracias por tus comentarios.",
  },
  myFeedback: {
    title: "Mis comentarios",
    description:
      "Consulta tus comentarios y las respuestas de los administradores.",
    empty: "Todavía no hay comentarios",
    emptyDescription:
      "Usa el menú de ayuda para compartir un problema o una sugerencia.",
    replyStatus: "Estado de respuesta",
    replied: "Respondido",
    awaitingReply: "Pendiente de respuesta",
    detailsDescription:
      "Consulta los comentarios y su historial de respuestas.",
    replies: "Respuestas",
    noReplies: "Todavía no hay respuestas",
    writeReply: "Responder al usuario",
    replyHint: "Envía texto, imágenes o ambos.",
    replyPlaceholder: "Escribe una respuesta…",
    replyImages: "Imágenes de la respuesta",
    replySuccess: "Respuesta enviada",
    sendingReply: "Enviando…",
    sendReply: "Enviar respuesta",
  },
  adminFeedback: {
    title: "Comentarios de usuarios",
    description:
      "Revisa los comentarios y las capturas de incidencias enviados por los usuarios.",
    empty: "Todavía no hay comentarios de usuarios.",
    submitter: "Enviado por",
    content: "Comentarios",
    images: "Imágenes",
    submittedAt: "Fecha de envío",
    imageCount: "{{count}} imagen",
    imageCount_other: "{{count}} imágenes",
    detailsTitle: "Detalles del comentario",
    detailsDescription: "Enviado por {{name}} el {{time}}",
    imageList: "Imágenes del comentario",
    imageAlt: "Imagen del comentario {{name}}",
    openImage: "Ver {{name}} ampliada",
    imagePreviewTitle: "Vista previa de la imagen",
    imageLoading: "Cargando imagen",
    imageUnavailable: "Esta imagen no está disponible temporalmente.",
    pagination: "Paginación de comentarios de usuarios",
    deleteLabel: "Eliminar el comentario enviado por {{name}}",
    deleteTitle: "¿Eliminar este comentario?",
    deleteDescription:
      "Se eliminarán el comentario enviado por {{name}}, todas las respuestas y sus imágenes. Esta acción no se puede deshacer.",
    deleting: "Eliminando…",
    deleteSuccess: "Comentario eliminado.",
  },
} satisfies TranslationResource<
  Pick<
    typeof enUS,
    | "social"
    | "loginMethods"
    | "initialize"
    | "embed"
    | "support"
    | "myFeedback"
    | "adminFeedback"
  >
>
