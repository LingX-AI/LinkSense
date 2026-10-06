import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"
import { localizedErrorMessage } from "@linksense/shared"

export const errorMessages = {
  errors: {
    socialClientInUse:
      "Hay cuentas vinculadas a esta aplicación. No se puede cambiar su ID; puedes renovar su secreto o desactivar el acceso.",
    socialLastMethod:
      "Establece una contraseña o vincula otro método de acceso activado antes de desvincular.",
    socialAuthFailed:
      "No se pudo completar la verificación de la cuenta social. Inténtalo de nuevo.",
    applicationDevelopment: {
      testBusy:
        "Todavía hay una prueba activa. Detenla y resuelve las solicitudes pendientes en el historial de pruebas antes de continuar.",
      testChanged:
        "La sesión de prueba ha cambiado. Continúa desde la vista previa más reciente.",
      projectNameFixed: "Este proyecto reúne las tareas de desarrollo de aplicaciones. No se puede cambiar su nombre.",
      workspaceBound:
        "Este proyecto contiene archivos de aplicaciones. Elimina esas aplicaciones en Mis aplicaciones antes de eliminar el proyecto. Las tareas de desarrollo deben permanecer en su proyecto actual.",
      notFound:
        "Esta aplicación no está disponible. Vuelve a Mis aplicaciones.",
      sourceChanged:
        "La aplicación ha cambiado. Revisa la vista previa más reciente antes de instalar.",
    },
    webSites: {
      notFound: "Este sitio no está disponible o se ha dejado de compartir",
      slugTaken: "Esta dirección ya está reservada. Elige otra",
      sourceUnavailable:
        "Selecciona un archivo HTML disponible en la tarea de origen",
      resourcesMissing:
        "Falta un recurso de la página ({{path}}). Pide al asistente de la tarea original que guarde la página junto con sus recursos antes de publicar",
      bundleInvalid:
        "El paquete de la página está incompleto o contiene archivos no compatibles. Actualízalo en la tarea original y vuelve a intentarlo",
    },
    feishu: {
      connectionNotFound:
        "No se ha encontrado la conexión de Feishu. Conéctala de nuevo.",
      connectionConflict:
        "La conexión de Feishu ha cambiado. Actualiza e inténtalo de nuevo.",
      registrationNotFound:
        "El código QR de conexión de Feishu ha caducado. Genera uno nuevo.",
      registrationUnavailable:
        "Feishu no puede crear el bot automáticamente ahora. Inténtalo más tarde.",
      protocolInvalid:
        "Feishu devolvió datos de conexión no reconocidos. Reconecta o contacta con un administrador.",
      coordinationUnavailable:
        "El estado de conexión de Feishu no está disponible temporalmente. Inténtalo más tarde.",
    },
    automationNotFound: "No se ha encontrado la automatización.",
    automationLimitReached:
      "Has alcanzado el límite de automatizaciones. Elimina una que ya no necesites e inténtalo de nuevo.",
    automationTaskNotPinned:
      "Las automatizaciones solo pueden usar tareas activas fijadas de tu cuenta.",
    automationTaskInUse:
      "Una automatización sigue usando esta tarea. Elimina o reasigna primero la automatización.",
    conversationOrderConflict:
      "La lista de tareas ha cambiado. Actualízala antes de volver a ordenarla.",
    unknown: "No se pudo completar la operación. Inténtalo más tarde.",
    networkUnavailable:
      "No se pudo conectar con el servicio. Comprueba la red e inténtalo de nuevo.",
    invalidResponse:
      "El servicio devolvió datos no válidos. Contacta con un administrador.",
    clientUpdateRequired:
      "El sistema se ha actualizado. Actualiza esta página para continuar.",
    serviceTemporarilyUnavailable:
      "El sistema no está disponible temporalmente. Inténtalo de nuevo en unos instantes.",
    imageUnderstanding: {
      validationFailed:
        "El modelo de comprensión de imágenes no superó la validación de entrada de imágenes, salida estructurada o desactivación del razonamiento. Comprueba la configuración del modelo y del proveedor.",
    },
    imageGeneration: {
      notConfigured:
        "El modelo de generación de imágenes no está configurado o activado.",
      forbidden: "Esta tarea no puede usar la generación de imágenes.",
      turnInactive:
        "La ejecución actual ha terminado y no puede seguir generando imágenes.",
      providerRejected:
        "El proveedor de generación de imágenes rechazó la solicitud. Comprueba el modelo, las instrucciones o la clave.",
      outputInvalid:
        "El proveedor de generación de imágenes no devolvió una imagen utilizable. Reintenta o comprueba su configuración.",
      unavailable:
        "La generación de imágenes no está disponible temporalmente. Inténtalo más tarde.",
    },
    authInvalidCredentials: "Correo o contraseña incorrectos.",
    authRateLimited: "Demasiados intentos de acceso. Inténtalo más tarde.",
    authProtectionUnavailable:
      "La protección de acceso no está disponible temporalmente. Inténtalo más tarde.",
    sessionExpired: "Tu sesión ha caducado. Vuelve a iniciar sesión.",
    passwordPolicy:
      "La contraseña debe tener entre 8 y 16 caracteres e incluir mayúsculas, minúsculas, un número y un signo de puntuación o símbolo.",
    passwordEmailUnavailable:
      "El servicio de correo para establecer o restablecer contraseñas no está disponible temporalmente. Inténtalo más tarde o usa SSO o Teams si están configurados.",
    passwordResetDeliveryFailed:
      "No se pudo enviar el enlace seguro. Inténtalo más tarde.",
    passwordResetProtectionUnavailable:
      "La protección de solicitudes de contraseña no está disponible temporalmente. Inténtalo más tarde.",
    auth: {
      registrationProtectionUnavailable:
        "La protección de solicitudes de registro no está disponible temporalmente. Inténtalo más tarde.",
    },
    passwordResetInvalid:
      "El enlace para establecer la contraseña no es válido o ha caducado. Solicita uno nuevo.",
    concurrencyLimit:
      "El sistema ha alcanzado su capacidad máxima. Inténtalo más tarde.",
    pendingLimit:
      "Se ha alcanzado el límite de solicitudes pendientes. Resuelve primero una existente.",
    pendingNotHead: "Solo se puede continuar la primera solicitud pendiente.",
    interruptFailed:
      "No se pudo interrumpir la ejecución actual. Inténtalo de nuevo.",
    conversation: {
      collaborationModeUnavailable:
        "No se puede cambiar el modo Plan mientras la tarea esté en ejecución, tenga solicitudes en cola, un objetivo activo o una automatización vinculada.",
      compactionUnavailable:
        "El contexto solo se puede compactar cuando la tarea actual se haya detenido.",
      userInputRequestUnavailable:
        "Esta pregunta ya ha finalizado o caducado. Actualiza la tarea e inténtalo de nuevo.",
      planReviewPending:
        "Implementa, revisa, omite o sal del plan actual antes de continuar.",
      planReviewUnavailable:
        "Esta revisión del plan ya ha finalizado o no está disponible. Actualiza la tarea e inténtalo de nuevo.",
      planOutputMissing:
        "El modo Plan no produjo un plan que puedas revisar. Inicia la solicitud de nuevo.",
      steerRequestFailed:
        "No se pudieron enviar indicaciones a la ejecución actual. Confirma que siga en curso e inténtalo de nuevo.",
      steerRequestUncertain:
        "El resultado de la solicitud de indicaciones aún no está confirmado. Conserva la entrada actual y vuelve a intentarlo para comprobarlo.",
    },
    composer: {
      voiceTranscriptionFailed:
        "La transcripción de voz falló. Inténtalo de nuevo o escribe el texto manualmente.",
      voiceTranscriptionRateLimited:
        "La entrada de voz se puede usar hasta 20 veces por minuto. Inténtalo de nuevo en unos instantes.",
    },
    mcp: {
      insecureHttpAcknowledgementRequired:
        "Debes aceptar el riesgo de transmisión sin cifrar antes de usar un servidor MCP HTTP.",
      credentialRequired:
        "Este método de autenticación requiere una credencial.",
      destinationForbidden:
        "No se puede acceder a este destino MCP. Los despliegues en la nube solo permiten direcciones HTTP o HTTPS públicas.",
      connectionFailed:
        "No se pudo conectar e inicializar el servidor MCP. Comprueba su URL, credencial y disponibilidad.",
    },
    clawhub: {
      skillNotFound: "No se ha encontrado la Skill en el repositorio.",
      skillNotInstallable:
        "Esta Skill no se puede instalar ahora. Comprueba su disponibilidad y estado de seguridad.",
      skillAlreadyInstalled: "Ya has instalado esta Skill.",
      serviceUnavailable:
        "No se pudo obtener la Skill de ClawHub. Inténtalo más tarde.",
      installPreviewBusy:
        "Se está preparando otra vista previa de instalación de Skill. Espera a que termine e inténtalo de nuevo.",
      installPreviewRateLimited:
        "Se han solicitado demasiadas vistas previas de instalación. Inténtalo más tarde.",
      installPreviewQuotaExceeded:
        "Se ha alcanzado el límite de vistas previas de instalación activas. Inténtalo más tarde.",
      packageIntegrityFailed:
        "Falló la verificación de integridad de los archivos de la Skill de ClawHub. Se ha bloqueado la instalación.",
    },
    feedback: {
      submissionInvalid:
        "El texto o las imágenes del comentario no cumplen los requisitos. Revísalos e inténtalo de nuevo.",
      submissionFailed:
        "No se pudieron enviar los comentarios ahora. Inténtalo más tarde.",
    },
    knowledge: {
      archiveRequired:
        "Solo se pueden eliminar bases de conocimiento archivadas.",
      inUse:
        "Esta base de conocimiento sigue siendo utilizada por aplicaciones. Quítala primero de esas aplicaciones.",
      archived:
        "Esta base de conocimiento está archivada. Restáurala antes de realizar esta acción.",
      disabled: "Esta base de conocimiento está desactivada.",
      quotaExceeded:
        "Esta base de conocimiento no tiene suficiente espacio para el archivo.",
      duplicate:
        "Ya existe un documento con contenido idéntico en esta base de conocimiento.",
      nameConflict:
        "Ya existe un documento con el mismo nombre en esta base de conocimiento.",
      actionConflict:
        "El estado actual del documento no permite esta acción. Actualiza e inténtalo de nuevo.",
      activating:
        "Se está activando el nuevo índice. Inténtalo de nuevo en unos instantes.",
      unsupportedFormat: "Este formato de documento no es compatible.",
      fileTooLarge: "El documento supera el límite de tamaño por archivo.",
      processingFailed:
        "El procesamiento del documento falló. Reintenta o vuelve a procesarlo.",
      previewUnavailable:
        "La vista previa del original no está disponible ahora. Inténtalo más tarde.",
      embeddingConfiguration:
        "La configuración del modelo de representación vectorial no es válida. Contacta con un administrador.",
    },
    knowledgeModel: {
      validationFailed:
        "El modelo de representación vectorial o reordenación no superó la validación. Comprueba el punto de conexión, la clave, el ID del modelo y las dimensiones vectoriales.",
      authenticationFailed:
        "El servicio de modelos no aceptó la clave API actual. Si has cambiado la URL base, introduce una clave válida para el nuevo punto de conexión.",
      serviceUnavailable:
        "El servicio de modelos rechazó la solicitud de validación o no está disponible. Comprueba la URL base, el ID del modelo, la red y el estado del servicio.",
      responseInvalid:
        "La respuesta del modelo no es compatible. Comprueba la compatibilidad de la API, el ID del modelo y las dimensiones vectoriales.",
      notConfigured:
        "El administrador todavía no ha configurado el modelo de representación vectorial de conocimiento.",
    },
    knowledgeSource: {
      notConfigured:
        "El administrador no ha configurado la fuente de conocimiento de SharePoint.",
      credentialValidationFailed:
        "La autenticación de la aplicación de SharePoint falló. Comprueba el inquilino, el ID de la aplicación y el secreto.",
      urlInvalid:
        "La URL de la carpeta de SharePoint no es válida o no pertenece al dominio del inquilino configurado.",
      folderNotFound:
        "No se pudo acceder a la carpeta de SharePoint. Comprueba la URL y los permisos asignados al sitio.",
      alreadyConnected:
        "Esta carpeta de SharePoint ya está conectada a otra base de conocimiento.",
      notFound: "No se ha encontrado la fuente de la base de conocimiento.",
      syncUnavailable:
        "La sincronización de SharePoint no está disponible temporalmente y se reintentará según la programación.",
      itemSyncFailed:
        "Algunos documentos de SharePoint no se sincronizaron y se reintentarán según la programación.",
    },
    application: {
      deleted: "Esta aplicación se ha eliminado",
      notFound: "La aplicación no existe o no puedes acceder a ella.",
      disabled:
        "La aplicación está desactivada y no puede iniciar tareas nuevas.",
      dependencyUnavailable:
        "El modelo, plugin/Skill o base de conocimiento de la aplicación no está disponible.",
      grantTargetInvalid:
        "Las aplicaciones solo se pueden compartir con usuarios o grupos válidos de la organización.",
      grantConflict: "Este usuario o grupo ya tiene acceso a la aplicación.",
      packageInvalid:
        "El paquete de aplicación interactiva no es válido. Comprueba manifest.json, index.html y la estructura de archivos.",
      runtimeBusy:
        "Esta aplicación tiene tareas normales en curso y no se puede guardar ni actualizar. Detén las tareas o espera a que terminen e inténtalo de nuevo.",
      centerUnavailable:
        "Esta aplicación se ha retirado del centro de aplicaciones.",
      customEventInvalid:
        "El nombre o los datos del evento personalizado no coinciden con el contrato de la aplicación.",
    },
    credentialConflict:
      "Las vinculaciones de credenciales están en conflicto. Selecciona una credencial explícita antes de continuar.",
    credentialRequired:
      "Falta una credencial obligatoria. Vincula una antes de continuar.",
    avatarInvalid:
      "No se pudo subir el avatar. Elige una imagen compatible e inténtalo de nuevo.",
    applicationIconInvalid:
      "No se pudo subir el icono de la aplicación. Elige una imagen compatible e inténtalo de nuevo.",
    capabilityLogoInvalid:
      "No se pudo subir el logotipo. Elige una imagen compatible e inténtalo de nuevo.",
    productLogoInvalid:
      "No se pudo subir el logotipo del sistema. Elige una imagen compatible e inténtalo de nuevo.",
    invalidPackage:
      "El paquete de plugin/Skill no es válido o le faltan archivos obligatorios.",
    withReason: "{{message}} Motivo: {{reason}}",
    importReasons: {
      archive_size_invalid:
        "El archivo está vacío o supera el límite de tamaño.",
      archive_unreadable:
        "No se pudo leer el archivo. Comprueba que sea un ZIP válido.",
      archive_entry_count_invalid:
        "El archivo está vacío o contiene demasiados archivos.",
      archive_path_invalid:
        "El archivo contiene una ruta no segura o no válida: {{path}}.",
      archive_entry_symlink:
        "El archivo contiene un enlace simbólico que no se puede importar: {{path}}.",
      archive_entry_too_large:
        "Un archivo del paquete es demasiado grande: {{path}}.",
      archive_compression_ratio_exceeded:
        "Un archivo del paquete tiene una relación de compresión anómala y podría ser inseguro: {{path}}.",
      archive_expanded_size_exceeded:
        "El paquete supera el límite de tamaño total descomprimido.",
      archive_entry_read_failed:
        "No se pudo leer un archivo del paquete: {{path}}.",
      package_manifest_count_invalid:
        "El paquete debe contener exactamente un archivo de entrada obligatorio: SKILL.md o plugin.json.",
      package_multiple_roots:
        "El archivo debe contener un único directorio raíz, pero se han encontrado varios.",
      package_json_invalid: "El manifiesto del plugin no es válido.",
      plugin_mcp_configuration_invalid:
        "La configuración MCP del plugin no es válida.",
      skill_frontmatter_missing:
        "Faltan los metadatos iniciales o el campo obligatorio name en SKILL.md.",
      skill_display_name_invalid:
        "El nombre visible de la Skill no es válido. Usa una sola línea de hasta 64 caracteres.",
      skill_name_invalid:
        "El nombre de Skill {{value}} no es válido. Usa solo letras minúsculas, números y guiones, con un máximo de 64 caracteres.",
      plugin_unsupported_component:
        "El plugin contiene un tipo de componente todavía no compatible.",
      plugin_skills_invalid:
        "Una Skill declarada por el plugin no es válida o le falta SKILL.md.",
      plugin_declared_path_invalid:
        "El plugin declara una ruta de archivo no válida: {{path}}.",
      logo_file_invalid:
        "El archivo del logotipo no es válido o supera el límite de tamaño.",
      requested_type_mismatch:
        "El tipo seleccionado es {{expected}}, pero el archivo contiene {{actual}}.",
    },
    importFailed:
      "La importación del plugin/Skill falló. Comprueba el origen e inténtalo de nuevo.",
    capabilityUpdateConflict:
      "Esta Skill ha cambiado. Vuelve a abrir el diálogo de actualización y revisa el contenido más reciente antes de enviar.",
    capabilityUpdateUnchanged:
      "El contenido es idéntico al de la Skill actual. No hace falta actualizar.",
    capabilityHomeSyncFailed:
      "El estado del plugin/Skill se ha guardado, pero no se pudo sincronizar el directorio del usuario. El sistema lo reintentará antes del siguiente turno.",
    attachmentInvalid:
      "La subida del adjunto falló. Elige un archivo legible e inténtalo de nuevo.",
    attachmentTemporaryFileSkipped:
      "Se han omitido los archivos temporales. Elige otro archivo con contenido útil.",
    fileLimitExceeded:
      "El tamaño del archivo o el número de adjuntos supera el límite permitido.",
    artifactNotFound: "No se ha encontrado el archivo generado.",
    downloadForbidden:
      "No tienes permiso para descargar este archivo generado.",
    runnerUnavailable:
      "El servicio de ejecución no está disponible. Inténtalo más tarde.",
    turnStartClosed:
      "El envío anterior ha finalizado. Esta solicitud no se ha ejecutado. Vuelve a enviarla.",
    deploymentStopped:
      "Esta tarea se detuvo por una actualización del sistema. Se conservó el contenido existente. Revisa su progreso antes de continuar manualmente.",
    creditLimitExceeded:
      "Tu cuota de créditos disponible se ha agotado y no puedes iniciar tareas nuevas ahora.",
    lastAdminRequired:
      "Debe quedar al menos un administrador activado. No se puede completar esta operación.",
    lastModelRequired:
      "Debe quedar al menos un modelo de chat disponible en las conversaciones.",
    modelProvider: {
      inUseBySystemSetting:
        "Un ajuste del sistema utiliza este modelo. Cambia o borra esa selección antes de eliminarlo.",
      credentialRequired: localizedErrorMessage(
        "MODEL_PROVIDER_CREDENTIAL_REQUIRED",
        "es-ES"
      ),
      discoveryFailed: localizedErrorMessage(
        "MODEL_PROVIDER_DISCOVERY_FAILED",
        "es-ES"
      ),
      connectionFailed: localizedErrorMessage(
        "MODEL_PROVIDER_CONNECTION_FAILED",
        "es-ES"
      ),
      managementDisabled:
        "La configuración de modelos está bloqueada por el entorno de despliegue y es de solo lectura.",
    },
    adminSelfChangeForbidden:
      "Los administradores no pueden desactivarse ni quitarse su propio rol.",
    emailExists: "Otro usuario ya utiliza esta dirección de correo.",
    settingsInvalid:
      "El ajuste del sistema no es válido o no se puede cambiar aquí.",
    deploymentReadOnly:
      "Este ajuste se gestiona desde la configuración del despliegue y es de solo lectura.",
    systemAlreadyInitialized: "El sistema ya se ha inicializado.",
    systemInitializationCredentialInvalid:
      "La credencial de inicialización no es válida. Usa la credencial de un solo uso que aparece tras la instalación.",
    teamsFailed:
      "El acceso con Teams falló. Reintenta o usa otro método de acceso.",
    codexTurnFailed:
      "Esta ejecución falló. Puedes ajustar la entrada e intentarlo de nuevo.",
    turnCompletedWithoutOutput:
      "Esta ejecución terminó sin resultados que se puedan mostrar. Ejecútala de nuevo.",
    automation: {
      emptyResult:
        "La automatización terminó sin resultados que se puedan mostrar. Ejecútala de nuevo.",
      expired: "Esta automatización ha caducado y ya no se puede ejecutar.",
    },
    userDisabled:
      "Este usuario está desactivado. Contacta con un administrador.",
    conflict:
      "El estado actual es incompatible con esta acción. Actualiza e inténtalo de nuevo.",
    forbidden: "No tienes permiso para realizar esta acción.",
    notFound: "El recurso solicitado no existe o no está disponible para ti.",
    validation:
      "Los datos enviados no son válidos. Revísalos e inténtalo de nuevo.",
  },
} satisfies TranslationResource<Pick<typeof enUS, "errors">>
