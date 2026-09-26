import type { enUS } from "@/i18n/en-US"
import type { TranslationResource } from "@/i18n/types"

export const adminMessages = {
  admin: {
    usersAndGroupsTitle: "Usuarios y grupos",
    usersAndGroupsDescription:
      "Gestiona las cuentas, los roles, los estados, los grupos y sus miembros en un solo lugar.",
    usersAndGroupsTabsLabel: "Gestión de usuarios y grupos",
    usersTitle: "Usuarios",
    usersDescription:
      "Crea, importa y gestiona los usuarios admitidos. Los administradores no pueden ver ni restablecer sus contraseñas.",
    rolesTitle: "Roles y permisos",
    rolesDescription:
      "Consulta los roles fijos y los límites de permisos de las funciones actuales de {{productName}}. Los permisos solo se aplican a las cuentas activas; asigna los roles desde Gestión de usuarios.",
    roleUserDescription:
      "Gestiona sus propias tareas, ajustes personales, plugins/Skills y credenciales; usa el Centro de plugins; crea o gestiona sus bases de conocimiento y usa las compartidas.",
    roleAdminDescription:
      "Un administrador activo tiene los permisos de usuario y administra usuarios y grupos, el Centro de plugins, los metadatos y las fuentes de conocimiento, los modelos y precios, los ajustes del sistema, su estado, los metadatos de auditoría y el uso. El rol de administrador por sí solo no da acceso al contenido de tareas o bases de conocimiento de otros usuarios.",
    permissionMatrix: "Matriz de permisos",
    permission: "Permiso",
    roleAccountBreakdown: "Recuento de cuentas por rol",
    roleAccountCount: "{{count}} cuentas",
    roleActiveAccountCount: "{{count}} activas",
    roleDisabledAccountCount: "{{count}} desactivadas",
    rolePermissions: {
      ownConversations: "Gestionar las propias tareas",
      personalSettings:
        "Gestionar los ajustes de perfil, apariencia y seguridad",
      personalCapabilities:
        "Crear, importar y gestionar plugins/Skills personales",
      usePluginCenter:
        "Explorar, instalar y actualizar plugins y enviar publicaciones para revisión",
      personalCredentials: "Gestionar credenciales personales",
      personalKnowledgeBases:
        "Gestionar las bases de conocimiento propias y usar las compartidas",
      manageUsersAndGroups: "Gestionar usuarios y grupos de usuarios",
      governStoreCapabilities:
        "Revisar y administrar las publicaciones del Centro de plugins",
      governKnowledgeBases:
        "Administrar los metadatos y el ciclo de vida de las bases de conocimiento sin acceso automático al contenido",
      manageKnowledgeSources:
        "Configurar las fuentes de conocimiento y la sincronización",
      manageModelsAndPricing:
        "Configurar modelos de generación, comprensión de imágenes, embeddings y reordenación y los precios de tokens",
      manageSystemSettings:
        "Gestionar los ajustes del producto y los proveedores de inicio de sesión",
      manageSystemHealth:
        "Consultar el estado del sistema y realizar el mantenimiento de las bases de conocimiento",
      viewAuditMetadata:
        "Ver metadatos de auditoría y tareas de otros usuarios, sin contenido y con datos sensibles ocultos",
      viewUsageAnalytics:
        "Ver el uso y los costes de modelos globalmente, por grupo y por usuario",
    },
    createUser: "Crear usuario",
    importUsers: "Importar Excel",
    role: "Rol",
    registrationSource: "Origen del usuario",
    registrationSources: {
      selfRegistration: "Registro propio",
      organizationInvitation: "Invitación de la organización",
    },
    loginMethod: "Método de inicio de sesión",
    lastLogin: "Último inicio de sesión",
    weeklyCreditLimit: "Cuota semanal (créditos)",
    creditLimitDisplay: "{{value}} créditos",
    creditQuotaRemainingFilter: "Cuota restante",
    filters: {
      allRoles: "Todos los roles",
      allStatuses: "Todos los estados",
      allSources: "Todos los orígenes de usuario",
      allQuotas: "Todas las cuotas",
      allActions: "Todas las acciones",
      allResults: "Todos los resultados",
      allRunnerStatuses: "Todos los estados del ejecutor",
      allArchiveStatuses: "Todos los estados de archivo",
    },
    weeklyCreditQuotaRemainingZero: "Quedan 0 créditos semanales",
    creditQuotaRemainingAmount:
      "{{value}} créditos restantes ({{percentage}} %)",
    creditQuotaRemainingUnavailable: "Cuota restante -",
    noCreditLimit: "Ilimitada",
    inheritCreditLimit: "Ilimitada",
    clearCreditLimit: "Deja en blanco para borrar la cuota individual",
    creditLimitHint:
      "Introduce un número positivo. Se permiten decimales. Unidad: créditos. En blanco significa que no hay una cuota individual configurada.",
    creditLimitInputInvalid:
      "Introduce un número mayor que 0 con un máximo de 6 decimales. Unidad: créditos.",
    userCreditLimits: "Cuotas de créditos individuales",
    userCreditLimitsDescription:
      "La cuota semanal se renueva cada lunes a medianoche. Al agotarse, el usuario no puede iniciar nuevas tareas. Las tareas en curso no se ven afectadas.",
    adjustCreditLimits: "Ajustar cuota",
    adjustUserCreditLimits: "Ajustar la cuota de {{name}}",
    singleCreditLimitsTitle: "Ajustar las cuotas de créditos individuales",
    singleCreditLimitsDescription:
      "Actualiza la cuota semanal de {{name}}. Deja el campo en blanco para no establecer una cuota individual.",
    batchCreditLimits: "Establecer cuota ({{count}})",
    batchCreditLimitsTitle: "Establecer cuotas de créditos de usuarios en lote",
    batchCreditLimitsDescription:
      "Establece la cuota semanal de los {{count}} usuarios seleccionados. Dejar el campo en blanco borra la cuota individual.",
    creditLimitFields: "Cuota semanal",
    singleCreditLimitsSaved: "Cuotas de créditos de {{name}} actualizadas.",
    creditLimitsSaved: "Cuotas de créditos de {{count}} usuarios actualizadas.",
    selectVisibleUsers: "Seleccionar los usuarios de la lista actual",
    selectUser: "Seleccionar al usuario {{name}}",
    groups: "Grupos de usuarios",
    selectGroups: "Seleccionar grupos de usuarios",
    searchGroups: "Buscar grupos de usuarios",
    groupSearchEmpty: "No se han encontrado grupos de usuarios coincidentes.",
    removeGroup: "Quitar el grupo de usuarios {{name}}",
    additionalGroups: "{{count}} grupos de usuarios más",
    userStatus: "Estado del usuario",
    usersEmpty: "No se han encontrado usuarios.",
    groupsTitle: "Grupos de usuarios",
    groupsDescription:
      "Gestiona los grupos de usuarios sin jerarquía y sus miembros.",
    createGroup: "Crear grupo de usuarios",
    members: "Miembros",
    viewGroupMembers: "Ver los {{count}} miembros de {{name}}",
    groupMembersTitle: "Miembros de {{name}}",
    groupMembersDescription: "{{count}} miembros",
    groupMembersEmpty: "Este grupo de usuarios no tiene miembros.",
    memberListLabel: "Miembros del grupo de usuarios",
    loadMoreMembers: "Cargar más miembros",
    memberSelector: "Miembros",
    selectMembers: "Seleccionar miembros",
    selectedMembers: "{{count}} miembros seleccionados",
    memberSearchPlaceholder: "Buscar miembros por nombre o correo electrónico",
    memberSearchEmpty: "No se han encontrado miembros coincidentes.",
    groupsEmpty: "No hay grupos de usuarios.",
    auditTitle: "Registros de auditoría",
    auditDescription:
      "Solo se muestran los metadatos permitidos de otros usuarios. Se excluyen el texto de las tareas, el contenido de los adjuntos y los enlaces de descarga.",
    action: "Acción",
    actionCode: "Código de acción",
    actionSearchPlaceholder: "Buscar o seleccionar una acción",
    actionSearchEmpty: "No hay acciones coincidentes.",
    actor: "Autor de la acción",
    target: "Destino",
    targetTypeCode: "Código de tipo de destino",
    result: "Resultado",
    resultCode: "Código de resultado",
    sourceIp: "IP de origen",
    exportCreatedAt: "Fecha de creación",
    exportActorId: "ID del autor de la acción",
    exportTargetType: "Tipo de destino",
    exportTargetId: "ID de destino",
    exportMetadata: "Metadatos",
    auditId: "ID del registro",
    userAgent: "User-Agent",
    auditDetailsTitle: "Detalles del registro de auditoría",
    auditDetailsDescription:
      "A continuación se muestra toda la información disponible de esta entrada de auditoría, con los datos sensibles ocultos.",
    auditEventInformation: "Información del registro",
    auditSubjectInformation: "Autor y destino",
    auditRequestInformation: "Información de la solicitud",
    auditMetadataTitle: "Metadatos con datos sensibles ocultos",
    auditMetadataEmpty: "No hay metadatos adicionales.",
    auditConversationDetailsTitle: "Detalles de ejecución de la tarea",
    auditConversationDetailsDescription:
      "A continuación se muestran todos los metadatos de ejecución disponibles de esta tarea, con los datos sensibles ocultos.",
    retainedArtifactDetailsTitle:
      "Detalles de los archivos generados por la tarea eliminada",
    retainedArtifactDetailsDescription:
      "A continuación se muestra toda la información resumida disponible de los archivos conservados permanentemente de esta tarea eliminada.",
    auditExecutionInformation: "Información de ejecución",
    auditArtifactInformation: "Información de los archivos generados",
    ownerId: "ID del propietario",
    ownerName: "Nombre del propietario",
    ownerEmail: "Correo del propietario",
    executionDuration: "Duración de la ejecución",
    executionErrorType: "Tipo de error",
    attachmentCount: "Número de adjuntos",
    attachmentSize: "Tamaño total de los adjuntos",
    artifactCount: "Número de archivos generados",
    artifactSize: "Tamaño total de los archivos generados",
    firstArtifactCreatedAt: "Creación del primer archivo generado",
    lastArtifactCreatedAt: "Creación del último archivo generado",
    export: "Exportar CSV",
    exporting: "Exportando…",
    auditEmpty: "No hay registros de auditoría coincidentes.",
    settingsTitle: "Ajustes del sistema",
    managementTitle: "Administración",
    settingsDescription:
      "Gestiona la presentación del producto, las tareas simultáneas, los correos de autenticación y las funciones de inicio de sesión. Los secretos se cifran y no vuelven a mostrarse.",
    settingsTabsLabel: "Categorías de ajustes del sistema",
    settingsTabs: {
      product: "Ajustes del producto",
      concurrency: "Tareas simultáneas",
      smtp: "Correo de autenticación",
      registration: "Registro abierto",
      login: "Métodos de inicio de sesión",
      maintenance: "Mantenimiento del sistema",
    },
    concurrency: {
      title: "Tareas simultáneas",
      description:
        "Define cuántas tareas pueden ejecutarse en todo el sistema y por usuario. Deja un campo en blanco para usar el valor predeterminado de la implementación.",
      globalLimit: "Límite de tareas en ejecución en el sistema",
      globalLimitDescription:
        "Número máximo de tareas en ejecución entre todos los usuarios. Deja en blanco para usar el valor predeterminado de la implementación, {{defaultValue}}; el valor efectivo actual es {{effectiveValue}}.",
      processLimit: "Límite de procesos de tareas por usuario",
      processLimitDescription:
        "Número máximo de procesos de tareas cargados por usuario. Deja en blanco para usar el valor predeterminado de la implementación, {{defaultValue}}; el valor efectivo actual es {{effectiveValue}}.",
      loweringBehavior:
        "Reducir un límite no detiene las tareas en curso. Las nuevas tareas podrán iniciarse cuando el uso actual baje del nuevo límite.",
      saved: "Ajustes de tareas simultáneas actualizados.",
      errors: {
        positiveInteger:
          "Introduce un entero mayor que 0 o deja en blanco para usar el valor predeterminado de la implementación.",
      },
    },
    registration: {
      enabled: "Permitir el registro por cuenta propia",
      enabledDescription:
        "Al activarlo, la página de inicio de sesión muestra una opción de registro. Desactivarlo bloquea las nuevas solicitudes y los enlaces de activación ya enviados.",
      saved: "Ajustes de registro abierto actualizados.",
    },
    systemName: "Nombre visible del sistema",
    systemLogo: "Logotipo del sistema",
    systemLogoDescription:
      "Se usa en la página de inicio de sesión, la barra lateral y la página de mantenimiento.",
    systemLogoHint:
      "Admite PNG, JPEG, WebP o GIF. Se recomienda una imagen horizontal transparente de menos de 2 MB.",
    uploadSystemLogo: "Subir logotipo",
    replaceSystemLogo: "Sustituir logotipo",
    removeSystemLogo: "Restaurar logotipo predeterminado",
    deploymentStatus: "Estado de la configuración de la implementación",
    settingsSaved: "Ajustes del sistema actualizados.",
    systemLogoSaved: "Logotipo del sistema actualizado.",
    systemLogoRemoved: "Logotipo predeterminado restaurado.",
    maintenance: {
      title: "Mantenimiento del sistema",
      description:
        "Programa el mantenimiento de todo el sistema. Durante ese periodo, los usuarios normales solo ven la página de mantenimiento, mientras que los administradores conservan el acceso.",
      enabled: "Activar mantenimiento programado",
      enabledDescription:
        "El mantenimiento solo está activo entre las horas de inicio y fin configuradas.",
      reason: "Motivo del mantenimiento",
      reasonPlaceholder:
        "Opcional: explica por qué es necesario el mantenimiento y cómo afecta a los usuarios…",
      duration: "Duración del mantenimiento",
      durationHint:
        "Tras elegir o introducir una duración, la hora de fin se calcula a partir de la de inicio. Puedes ajustar ambas horas manualmente.",
      durationPresetsLabel: "Opciones rápidas de duración del mantenimiento",
      durationPresets: {
        "10m": "10 min",
        "30m": "30 min",
        "1h": "1 hora",
        "2h": "2 horas",
        "4h": "4 horas",
      },
      durationCustomPlaceholder: "Introducir manualmente",
      durationUnit: "Unidad de duración del mantenimiento",
      durationUnits: {
        minute: "minutos",
        hour: "horas",
      },
      startAt: "Hora de inicio",
      endAt: "Hora de fin",
      datePlaceholder: "Seleccionar fecha",
      clearStartDate: "Borrar fecha de inicio",
      clearEndDate: "Borrar fecha de fin",
      startHour: "Hora de inicio · hora",
      startMinute: "Hora de inicio · minuto",
      endHour: "Hora de fin · hora",
      endMinute: "Hora de fin · minuto",
      timezoneHint:
        "Los horarios usan la zona horaria del dispositivo actual y se convierten a la hora del sistema al guardar.",
      save: "Guardar ajustes de mantenimiento",
      saved: "Ajustes de mantenimiento guardados",
      closed: "Mantenimiento del sistema desactivado",
      status: {
        active: "En mantenimiento",
        scheduled: "Programado",
        disabled: "No activado",
      },
      errors: {
        startRequired:
          "Selecciona una hora de inicio antes de activar el mantenimiento.",
        endRequired:
          "Selecciona una hora de fin antes de activar el mantenimiento.",
        endAfterStart: "La hora de fin debe ser posterior a la de inicio.",
      },
    },
    modelTabs: {
      label: "Categorías de ajustes de modelos",
      channels: "Canales de modelos",
      conversation: "Modelos de conversación",
      knowledge: "Modelos de búsqueda de conocimiento",
      voiceTranscription: "Modelo de transcripción de voz",
      imageGeneration: "Modelo de generación de imágenes",
    },
    modelProvider: {
      catalogDescription:
        "Gestiona las conexiones de los modelos, sus precios y su orden en el cuadro de mensaje.",
      currentChannel: "Canal actual",
      editChannel: "Editar canal",
      connectionDescription:
        "Los modelos de este canal comparten estos ajustes de conexión.",
      channelActions: "Acciones del canal",
      channelSummaryConfigured_one:
        "Este canal se conecta mediante {{provider}} e incluye {{count}} modelo. La clave de API está configurada",
      channelSummaryConfigured_other:
        "Este canal se conecta mediante {{provider}} e incluye {{count}} modelos. La clave de API está configurada",
      channelSummaryNotConfigured_one:
        "Este canal se conecta mediante {{provider}} e incluye {{count}} modelo. Todavía no hay una clave de API configurada",
      channelSummaryNotConfigured_other:
        "Este canal se conecta mediante {{provider}} e incluye {{count}} modelos. Todavía no hay una clave de API configurada",
      channelSummaryEnd: ".",
      noChannels: "Todavía no hay canales de modelos",
      noChannelsDescription:
        "Añade un canal y configura su primer modelo para empezar.",
      noModelsDescription:
        "Usa Añadir modelo para configurar un modelo en este canal.",
      editModel: "Editar el modelo {{name}}",
      modelEditorDescription:
        "Canal: {{name}}. Al guardar, solo se actualiza este modelo.",
      basicInformation: "Información básica",
      pricing: "Precios del modelo",
      capabilities: "Capacidades",
      modelName: "Modelo",
      priceSummary: "Precio de entrada / entrada en caché / salida",
      modelActions: "Acciones del modelo {{name}}",
      modelAvailability: "Disponible en conversaciones: {{name}}",
      modelOrder: "Orden de los modelos",
      moveUp: "Subir",
      moveDown: "Bajar",
      moveChannelUp: "Subir canal",
      moveChannelDown: "Bajar canal",
      orderHint:
        "Arrastra el asa o usa Subir y Bajar. El cuadro de mensaje muestra los modelos de conversación disponibles por orden de canal y después por orden de modelo dentro de cada canal.",
      reorderModel: "Reordenar el modelo {{name}}",
      reorderInstructions:
        "Pulsa Espacio para empezar a ordenar, usa las flechas arriba y abajo para mover, pulsa Espacio para confirmar o Escape para cancelar.",
      reorderStarted: "Reordenación de {{name}} iniciada.",
      reorderPosition: "{{name}} se ha movido a la posición {{position}}.",
      reorderCancelled: "Reordenación cancelada.",
      discardTitle: "¿Descartar los cambios sin guardar?",
      discardDescription:
        "Al cerrar se descartarán los cambios realizados en este editor.",
      discardAction: "Descartar cambios",
      selectionsHint:
        "El modelo de conversación predeterminado se usa antes de que el usuario elija uno. El modelo de nombres de tareas genera los títulos de las tareas.",
      title: "Servicio de modelos",
      description:
        "Gestiona los modelos de conversación, búsqueda de conocimiento y otros modelos junto con sus canales de servicio. El sistema usa el servicio adecuado para cada modelo seleccionado, y los administradores pueden definir los niveles de razonamiento disponibles para los modelos de conversación.",
      readOnlyNotice:
        "Los ajustes de modelos son de solo lectura por ahora. Puedes ver los ajustes existentes, pero no añadir, editar ni eliminar modelos, ni cambiar su disponibilidad en conversaciones.",
      providers: "Canales de modelos",
      providersDescription:
        "Gestiona los modelos y sus conexiones en un solo lugar. Los ID de modelo no se pueden reutilizar, para que el sistema seleccione siempre el modelo previsto.",
      addProvider: "Añadir canal de modelos",
      providerTitle: "Canal de modelos {{index}}",
      providerName: "Nombre del canal",
      renameProvider: "Cambiar el nombre del canal de modelos {{name}}",
      renameProviderTitle: "Cambiar nombre del canal de modelos",
      renameProviderDescription:
        "El nombre del canal solo sirve para que los administradores lo identifiquen y se aplica al guardar los ajustes de modelos.",
      renameProviderAction: "Cambiar nombre",
      unnamedProvider: "Canal de modelos sin configurar",
      deleteProvider: "Eliminar canal",
      saveProvider: "Guardar el canal de modelos {{name}}",
      deleteProviderTitle: "¿Eliminar el canal de modelos «{{name}}»?",
      deleteProviderDescription:
        "Este canal y todos sus modelos se eliminarán inmediatamente tras confirmar. Las tareas y los registros de uso históricos no se ven afectados.",
      providerDeleted: "Canal de modelos eliminado.",
      baseUrl: "URL base",
      apiKey: "API_KEY",
      apiKeyConfiguredHint:
        "La clave se almacena de forma segura. Introduce una nueva clave solo para sustituirla.",
      apiKeyRequiredHint:
        "Introduce una clave antes de guardar por primera vez. No volverá a mostrarse.",
      apiKeyOptionalHint:
        "Introduce una clave si el proveedor exige autenticación. No se mostrará después de guardar.",
      protocolMode: "Modo de compatibilidad del protocolo",
      protocolModes: {
        native_responses: "Responses nativo",
        responses_tool_compat: "Compatibilidad de herramientas de Responses",
        chat_completions_bridge: "Puente para Chat Completions",
      },
      protocolModeHints: {
        native_responses:
          "Indicado para servicios con compatibilidad nativa con Responses y una experiencia completa de conversación y herramientas.",
        responses_tool_compat:
          "Indicado para servicios compatibles con Responses que ofrecen un conjunto más limitado de herramientas.",
        chat_completions_bridge:
          "Indicado para servicios compatibles que solo admiten Chat Completions. Algunas funciones avanzadas pueden no estar disponibles.",
      },
      models: "Modelos",
      modelsDescription:
        "Los modelos de este canal comparten su conexión y su clave. Los modelos de conversación pueden aparecer entre las opciones del usuario; los modelos de búsqueda y los demás se usan automáticamente cuando es necesario.",
      addModel: "Añadir modelo",
      noModels: "No hay modelos en este canal",
      newModelName: "Modelo {{index}}",
      unnamedModel: "Modelo sin nombre",
      modelId: "ID del modelo",
      modelIdConflict:
        "Este ID de modelo ya existe en el catálogo. Usa otro ID.",
      modelNameConflict:
        "Ya existe un modelo con este nombre visible. Considera usar otro nombre para distinguirlos.",
      channelNameConflict:
        "Ya existe un canal de modelos con este nombre. Considera usar otro nombre para distinguirlos.",
      displayName: "Nombre visible",
      modelKind: "Tipo de modelo",
      modelKinds: {
        chat: "Modelo de conversación",
        embedding: "Modelo de embeddings",
        reranker: "Modelo de clasificación",
      },
      serviceProvider: "Proveedor de modelos",
      supportsImageInput: "Admite comprensión de imágenes",
      inputPrice: "Precio de entrada",
      cachedInputPrice: "Precio de entrada en caché",
      outputPrice: "Precio de salida",
      contextWindow: "Longitud del contexto del modelo",
      contextWindowPlaceholder: "Detectar automáticamente",
      contextWindowInvalid:
        "Introduce un entero mayor que 0 o deja en blanco para detectar automáticamente.",
      priceUnit: "USD / 1 millón de tokens",
      priceUnitSummary: ". Los precios se muestran en {{unit}}.",
      showInComposer: "Disponible en conversaciones",
      saveModel: "Guardar el modelo {{name}}",
      deleteModel: "Eliminar modelo",
      deleteModelTitle: "¿Eliminar el modelo «{{name}}»?",
      deleteModelDescription:
        "El modelo se eliminará inmediatamente tras confirmar. Las tareas y los registros de uso históricos no se ven afectados.",
      modelDeleted: "Modelo eliminado.",
      supportedEfforts: "Esfuerzos de razonamiento admitidos",
      selectedEfforts: "{{count}} seleccionados",
      defaultEffort: "Esfuerzo de razonamiento predeterminado",
      defaultModel: "Modelo de conversación predeterminado",
      defaultModelHint:
        "El sistema usa este modelo cuando el usuario no ha elegido uno o su modelo anterior no está disponible.",
      modelSelections: "Selecciones de modelos de conversación y del sistema",
      saveModelSelections:
        "Guardar las selecciones de modelos de conversación y del sistema",
      memoryExtractionModel: "Modelo de extracción de recuerdos",
      memoryUseTaskModel: "Usar el modelo de la tarea actual",
      memoryExtractionHint:
        "Se aplica cuando el usuario activa la memoria. Si no se selecciona un modelo específico, la extracción usa el modelo de la tarea actual. La extracción siempre usa el menor esfuerzo de razonamiento admitido por el modelo elegido. Esto no cambia el modelo de consolidación de recuerdos.",
      titleModel: "Modelo de nombres automáticos de tareas",
      titleModelHint:
        "Crea automáticamente nombres reconocibles para las tareas. Su uso se incluye en las estadísticas.",
      saved: "Ajustes de canales de modelos actualizados.",
    },
    knowledgeModels: {
      title: "Modelos de búsqueda de conocimiento",
      description:
        "Elige los modelos que ayudan a las bases de conocimiento a comprender documentos, responder preguntas y mejorar los resultados de búsqueda.",
      selectionDescription:
        "Elige los modelos usados para procesar documentos y mejorar los resultados de búsqueda. Añade y gestiona los modelos disponibles en Canales de modelos.",
      noEmbeddingModels:
        "No hay ningún modelo listo para la búsqueda de conocimiento. Primero añade y configura un modelo de embeddings en Canales de modelos.",
      embeddingTitle: "Modelo de embeddings",
      embeddingSelectionDescription:
        "Este modelo obligatorio ayuda a la base de conocimiento a comprender documentos y preguntas de los usuarios. El sistema comprueba la disponibilidad al guardar.",
      selectEmbeddingModel: "Seleccionar modelo de embeddings",
      embeddingModelPlaceholder: "Selecciona un modelo de embeddings",
      embeddingDescription:
        "Este modelo obligatorio ayuda a la base de conocimiento a comprender documentos y preguntas de los usuarios.",
      rerankTitle: "Modelo de ordenación",
      rerankSelectionDescription:
        "Coloca los resultados más relevantes al principio. La búsqueda sigue devolviendo resultados si está desactivado o no está disponible temporalmente.",
      selectRerankerModel: "Seleccionar modelo de clasificación",
      rerankerModelPlaceholder: "Selecciona un modelo de clasificación",
      rerankDescription:
        "Coloca los resultados más relevantes al principio. La búsqueda de conocimiento sigue funcionando cuando está desactivado.",
      enabled: "Activar durante la búsqueda",
      baseUrl: "URL base",
      embeddingBaseUrlHint:
        "Introduce la dirección de conexión del modelo de embeddings facilitada por el proveedor.",
      rerankBaseUrlHint:
        "Introduce la dirección de conexión del modelo de clasificación de resultados facilitada por el proveedor.",
      modelId: "ID del modelo",
      inputPrice: "Precio de entrada",
      priceUnit: "USD / 1 millón de tokens",
      embeddingApiKey: "Clave de API de embeddings",
      rerankApiKey: "Clave de API de reordenación",
      apiKeyConfiguredHint:
        "Hay una clave configurada. Introduce una nueva clave solo para sustituirla.",
      apiKeyEndpointChangedHint:
        "La dirección de conexión ha cambiado, por lo que no se reutilizará la clave existente. Introduce la clave correspondiente si la nueva dirección exige autenticación.",
      apiKeyOptionalHint:
        "Deja en blanco si el proveedor no exige autenticación. La clave no se muestra después de guardar.",
      embeddingRuntime:
        "El sistema procesa el contenido en {{dimensions}} dimensiones, con hasta {{tokens}} tokens cada vez.",
      rerankRuntime:
        "Procesa hasta {{tokens}} tokens cada vez. Si el servicio tarda más de {{timeout}} ms, se omite esta optimización.",
      rebuildHint:
        "Tras cambiar el modelo de embeddings, debes reconstruir completamente todos los índices de las bases de conocimiento. La búsqueda no estará disponible temporalmente hasta completar la reconstrucción en Estado del sistema.",
      embeddingChangeConfirmTitle:
        "Operación de riesgo: ¿cambiar el modelo de embeddings?",
      embeddingChangeConfirmDescription:
        "El modelo de embeddings determina cómo las bases de conocimiento interpretan y buscan contenido. Guardar este cambio invalida todos los índices existentes. Debes ir a Estado del sistema y reconstruir completamente todos los índices; la búsqueda en todas las bases de conocimiento permanecerá desactivada hasta que termine. El sistema no inicia la reconstrucción automáticamente.",
      embeddingChangeDangerNotice:
        "Cambiar el modelo de embeddings es una operación de riesgo. Una reconstrucción parcial de las bases de conocimiento no es suficiente.",
      embeddingChangeConfirmAction: "Cambiar modelo y guardar",
      rebuildRequiredTitle:
        "Modelo de embeddings cambiado; es necesario reconstruir los índices de las bases de conocimiento",
      rebuildRequiredDescription:
        "Ve a Estado del sistema y reconstruye todos los índices de las bases de conocimiento. La búsqueda no estará disponible temporalmente hasta que termine.",
      openSystemHealth: "Ir a Estado del sistema",
      validating: "Comprobando y guardando…",
      save: "Guardar modelos de búsqueda de conocimiento",
      saved: "Ajustes de modelos de búsqueda de conocimiento actualizados.",
      savedDescription:
        "Los nuevos procesos de documentos y las búsquedas semánticas usarán esta configuración.",
      savedAfterEmbeddingChangeDescription:
        "El ajuste del modelo se ha guardado. Ve a Estado del sistema y reconstruye todos los índices de las bases de conocimiento; la búsqueda no estará disponible temporalmente hasta que termine.",
    },
    voiceTranscription: {
      title: "Modelo de transcripción de voz",
      description:
        "Configura el servicio de modelos usado para transcribir la entrada de voz. Una vez activado, las tareas normales y las aplicaciones integradas usan estos ajustes. La clave se almacena de forma segura y no vuelve a mostrarse.",
      enabled: "Activar transcripción de voz",
      provider: "Proveedor de modelos",
      providerHint:
        "Elige el servicio de transcripción de voz que has activado y quieres usar.",
      providerPlaceholder: "Selecciona un proveedor de modelos",
      providers: {
        dashscope: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        openai_compatible: "Servicio compatible con OpenAI",
        azure_openai: "Azure OpenAI",
        groq: "Groq",
        deepgram: "Deepgram",
        assemblyai: "AssemblyAI",
        elevenlabs: "ElevenLabs",
        revai: "Rev.ai",
        gladia: "Gladia",
        fal: "fal.ai",
      },
      baseUrl: "URL base",
      baseUrlHint:
        "Introduce la dirección de conexión de la transcripción de voz facilitada por el proveedor.",
      apiVersion: "Versión de la API",
      apiVersionHint:
        "Introduce la versión de la API que usa tu implementación de Azure OpenAI.",
      apiKey: "Clave de API",
      apiKeyConfiguredHint:
        "Hay una clave configurada. Deja este campo en blanco para conservarla.",
      apiKeyRequiredHint:
        "Se necesita una clave al activar esta función por primera vez o después de cambiar de proveedor. No vuelve a mostrarse.",
      model: "Nombre del modelo de transcripción de voz",
      modelHint:
        "Introduce el nombre del modelo o de la implementación facilitado por el proveedor.",
      save: "Guardar modelo de transcripción de voz",
      saving: "Guardando…",
      saved: "Ajustes del modelo de transcripción de voz actualizados.",
    },
    imageGeneration: {
      title: "Modelo de generación de imágenes",
      description:
        "Configura el servicio de modelos usado para generar imágenes. Una vez activado, el sistema usa estos ajustes para crear imágenes. La clave se almacena de forma segura y no vuelve a mostrarse.",
      enabled: "Activar generación de imágenes",
      provider: "Proveedor de modelos",
      providerHint:
        "Elige el servicio de generación de imágenes que has activado y quieres usar.",
      providerPlaceholder: "Selecciona un proveedor de modelos",
      providers: {
        alibaba_bailian: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        google_gemini: "Google Gemini",
        stability: "Stability AI",
        fal: "fal.ai",
        replicate: "Replicate",
        together: "Together AI",
      },
      baseUrl: "URL base",
      baseUrlHint:
        "Se rellena automáticamente para el proveedor seleccionado. No es necesario editarlo manualmente.",
      workspaceId: "ID del espacio de trabajo de Bailian",
      workspaceIdHint:
        "Conecta con tu espacio de trabajo dedicado de Alibaba Cloud Bailian.",
      region: "Región de Bailian",
      regionHint:
        "Elige la región en la que está activo el servicio. Se usa Pekín de forma predeterminada.",
      apiKey: "Clave de API",
      apiKeyConfiguredHint:
        "Hay una clave configurada. Deja este campo en blanco para conservarla.",
      apiKeyRequiredHint:
        "Se necesita una clave al activar esta función por primera vez o después de cambiar de proveedor. No vuelve a mostrarse.",
      model: "Nombre del modelo de generación de imágenes",
      modelHint:
        "Introduce el nombre del modelo facilitado por el proveedor, como qwen-image-3.0.",
      pricePerImage: "Precio por imagen",
      pricePerImageHint:
        "Se usa para registrar los costes de generación de imágenes. Unidad: USD por imagen.",
      save: "Guardar modelo de generación de imágenes",
      saving: "Guardando…",
      saved: "Ajustes del modelo de generación de imágenes actualizados.",
    },
    imageUnderstanding: {
      title: "Comprensión de imágenes de documentos",
      description:
        "Al activarlo, el sistema comprende las imágenes de los documentos y usa esa información en la búsqueda de conocimiento. El contenido original del documento no cambia.",
      selectionDescription:
        "Al activarlo, el sistema comprende las imágenes de los documentos para que los usuarios encuentren la información que contienen. Elige un modelo de conversación que admita comprensión de imágenes.",
      noImageModels:
        "No hay ningún modelo compatible con imágenes. Primero activa Admite comprensión de imágenes para un modelo de conversación en Canales de modelos.",
      selectModel: "Seleccionar modelo de comprensión de imágenes",
      selectModelHint:
        "El sistema comprueba al guardar que el modelo seleccionado puede reconocer imágenes.",
      modelPlaceholder: "Selecciona un modelo de comprensión de imágenes",
      enabled: "Activar durante el procesamiento",
      provider: "Proveedor de modelos",
      providerPlaceholder: "Selecciona un proveedor de modelos",
      providers: {
        openai: "OpenAI",
        azure_openai: "Azure OpenAI",
        anthropic: "Anthropic",
        google: "Google Gemini",
        google_vertex: "Google Vertex AI",
        alibaba: "Alibaba / Qwen",
        deepseek: "DeepSeek",
        openrouter: "OpenRouter",
        openai_compatible: "Compatible con OpenAI / vLLM",
      },
      model: "ID del modelo multimodal",
      modelHint:
        "Elige un modelo con compatibilidad confirmada con la comprensión de imágenes. El sistema comprueba la disponibilidad al guardar.",
      baseUrl: "URL base",
      baseUrlRequiredHint:
        "Introduce la dirección de conexión completa facilitada por el proveedor.",
      baseUrlOptionalHint:
        "Deja en blanco para usar la dirección predeterminada del proveedor.",
      apiKey: "Clave de API",
      apiKeyConfiguredHint:
        "Hay una clave configurada. Deja este campo en blanco para conservarla.",
      apiKeyRequiredHint:
        "Se necesita una clave al activar esta función por primera vez y no vuelve a mostrarse.",
      project: "ID del proyecto de Vertex",
      location: "Ubicación de Vertex",
      activeStrategy:
        "El modelo actual ha superado la comprobación de comprensión de imágenes.",
      strategyAfterValidation:
        "El sistema comprueba la capacidad de comprensión de imágenes del modelo seleccionado después de guardar.",
      validating: "Comprobando y guardando…",
      save: "Guardar ajustes de comprensión de imágenes",
      saved:
        "Ajustes de comprensión de imágenes actualizados. Los nuevos procesos y reconstrucciones usarán esta configuración.",
    },
    authSettings: {
      enterpriseTitle: "Cuentas de empresa",
      enterpriseDescription:
        "Permite acceder con cuentas gestionadas por la organización o directamente desde Teams. El primer acceso busca cuentas existentes por correo; las nuevas requieren activación del administrador.",
      smtpTitle: "Correo de autenticación",
      smtpDescription:
        "Configura el servicio SMTP para los correos de definición inicial y restablecimiento de contraseña. Las comprobaciones de conexión siguen en Estado del sistema.",
      oidcTitle: "Inicio de sesión empresarial (OIDC)",
      oidcDescription:
        "Conecta el servicio de acceso de la organización, como Microsoft Entra ID para cuentas profesionales o educativas.",
      teamsTitle: "Acceso desde Teams",
      teamsDescription:
        "Permite acceder directamente desde Teams con cuentas profesionales o educativas.",
      modeLabel: "Origen de la configuración",
      modes: {
        inherit: "Heredar del entorno de implementación",
        managed: "Gestionar en los ajustes del sistema",
        disabled: "Desactivar esta función",
      },
      modeNotices: {
        inherit:
          "Actualmente se usa el entorno de implementación. Vuelve a introducir el secreto al cambiar a la gestión desde el sistema.",
        disabled:
          "Esta función está desactivada explícitamente y no recurre a la configuración de la implementación.",
      },
      status: {
        configured: "Configurado",
        notConfigured: "Sin configurar",
        invalid: "Configuración no válida",
      },
      smtpHost: "Servidor SMTP",
      smtpPort: "Puerto SMTP",
      smtpSecurity: "Seguridad de la conexión",
      starttls: "STARTTLS",
      tls: "TLS directo",
      smtpFrom: "Dirección del remitente",
      smtpUsername: "Nombre de usuario",
      smtpUsernameHint:
        "Deja en blanco cuando el servicio SMTP no exija autenticación.",
      smtpPassword: "Contraseña",
      oidcIssuer: "URL del emisor",
      oidcClientId: "ID del cliente",
      oidcClientSecret: "Secreto del cliente",
      oidcRedirectUri: "URI de redirección",
      oidcRedirectHint:
        "Registra esta URI fija en el proveedor OIDC. No se puede cambiar aquí.",
      teamsTenantId: "ID del inquilino",
      teamsClientId: "ID de la aplicación (cliente)",
      teamsExternalHint:
        "Usa el mismo ID de aplicación en Microsoft Entra y en el manifiesto de la aplicación de Teams, expón la API y completa los consentimientos necesarios.",
      secretPreserved:
        "Hay un secreto almacenado. Deja este campo en blanco para conservarlo.",
      secretRequired:
        "Vuelve a introducir el secreto al cambiar a la gestión desde el sistema.",
      secretRequiredWhenUsed:
        "Se necesita una contraseña cuando hay un nombre de usuario configurado.",
      saved:
        "Ajustes de autenticación actualizados y aplicados inmediatamente.",
      confirmTitle: "¿Cambiar el origen de la configuración?",
      confirmDescription:
        "Continuar deja de usar la configuración actual. Desactivar un método de inicio de sesión puede bloquear a los usuarios que dependen de él.",
    },
    editUser: "Editar usuario",
    userSaved: "Usuario guardado.",
    enableUserNamed: "Activar al usuario {{name}}",
    disableUserNamed: "Desactivar al usuario {{name}}",
    userEnabled: "Usuario {{name}} activado.",
    userDisabled: "Usuario {{name}} desactivado.",
    userStatusSelfLocked:
      "Los administradores no pueden activar ni desactivar su propia cuenta.",
    lastEnabledAdminStatusLocked:
      "Debe quedar al menos un administrador activado.",
    userStatusVerifyingAdmins:
      "Comprobando el número de administradores activados. Espera.",
    emailUpdated:
      "Correo electrónico actualizado. El usuario debe volver a iniciar sesión.",
    accountMetadata: "Metadatos de la cuenta y los recursos",
    passwordUpdated: "Contraseña actualizada",
    personalPlugins: "Plugins personales",
    personalSkills: "Skills personales",
    personalCredentials: "Credenciales personales",
    noPasswordNotice:
      "Los administradores no pueden definir, ver, importar ni restablecer contraseñas de usuarios. Los nuevos usuarios pueden iniciar sesión mediante SSO, Teams o el proceso de recuperación de contraseña.",
    userPrivilegeChangeWarning:
      "Esto revoca inmediatamente las sesiones del usuario. Desactivarlo también cancela las solicitudes pendientes que aún no han empezado. No puedes desactivar tu cuenta ni quitarte el rol de administrador, y debe quedar al menos un administrador activado.",
    userSearchPlaceholder: "Buscar nombre o correo electrónico…",
    downloadTemplate: "Descargar plantilla Excel",
    chooseExcel: "Elegir archivo Excel",
    templateFilename: "{{productPrefix}}-plantilla-importacion-usuarios.xlsx",
    importDescription:
      "Usa la plantilla Excel para el nombre, el correo electrónico, el rol y los grupos de usuarios. La hoja Instrucciones incluye datos de ejemplo. La plantilla no tiene campo de contraseña y las filas no válidas se notifican por separado.",
    importSubmit: "Iniciar importación",
    importResult: "Resultado de la importación",
    importCounts: "{{imported}} importados y {{skipped}} omitidos.",
    importErrorRow: "Fila {{row}}: {{message}}",
    editGroup: "Editar grupo de usuarios",
    deleteGroupTitle: "¿Eliminar este grupo de usuarios de forma permanente?",
    importErrors: {
      duplicateInFile:
        "El libro de Excel contiene una dirección de correo electrónico duplicada.",
      emailExists: "El correo electrónico ya lo usa un usuario existente.",
      groupNotFound: "El grupo de usuarios indicado no existe.",
      invalidEmail: "El formato del correo electrónico no es válido.",
      invalidRole: "El rol debe ser user o admin.",
      invalidName: "El nombre falta o no es válido.",
      invalidRow: "El valor de un campo no es válido.",
    },
    parentDeleteDescription:
      "Las pertenencias relacionadas y los permisos de las bases de conocimiento se eliminarán permanentemente. Esta acción no se puede deshacer.",
    auditSearchPlaceholder:
      "Buscar ID de tarea, usuario, plugin/Skill o código de error…",
    dateFrom: "Fecha de inicio",
    dateTo: "Fecha de fin",
    auditDataSurfaces: "Ámbito de los datos de auditoría",
    auditSurfaces: {
      events: "Registro de auditoría permanente",
      conversations: "Metadatos de ejecución de tareas",
      retainedArtifacts: "Archivos generados por tareas eliminadas",
    },
    auditConversationDescription:
      "Muestra resúmenes de ejecución de otros usuarios con datos sensibles ocultos, sin títulos, mensajes, contenido de archivos, eventos completos ni enlaces de descarga.",
    auditConversationSearchPlaceholder:
      "Buscar ID de tarea, usuario, plugin/Skill o código de error…",
    advancedFilters: "Más filtros",
    pluginName: "Nombre del plugin",
    skillName: "Nombre de la Skill",
    errorCode: "Código de error",
    runnerStatus: "Estado del servicio de ejecución",
    archiveStatus: "Estado de archivado",
    createdFrom: "Creado desde",
    createdTo: "Creado hasta",
    lastRunFrom: "Última ejecución desde",
    lastRunTo: "Última ejecución hasta",
    auditConversationsEmpty:
      "No hay metadatos de ejecución de tareas coincidentes.",
    retainedArtifactsDescription:
      "Muestra únicamente resúmenes con datos sensibles ocultos de los archivos conservados permanentemente de tareas eliminadas. No se puede ver el contenido, recuperarlo ni descargarlo.",
    retainedArtifactsSearchPlaceholder:
      "Buscar ID de tarea, ID del propietario o fecha de eliminación…",
    retainedArtifactsEmpty:
      "No hay resúmenes coincidentes de archivos de tareas eliminadas.",
    conversation: "ID de tarea",
    owner: "Propietario",
    capabilitiesUsed: "Plugins/Skills utilizados",
    files: "Metadatos de archivos",
    execution: "Resumen de ejecución",
    lastRun: "Última ejecución",
    activeConversation: "Sin archivar",
    archivedConversation: "Archivado",
    attachmentsSummary: "{{count}} adjuntos · {{size}}",
    artifactsSummary: "{{count}} archivos generados · {{size}}",
    runnerStatuses: {
      initialized: "Servicio de ejecución inicializado",
      not_started: "Servicio de ejecución sin iniciar",
      available: "Servicio de ejecución disponible",
      unavailable: "Servicio de ejecución no disponible",
    },
    executionError: "Error de ejecución",
    errorTypes: {
      codex_turn: "Error de ejecución de la tarea",
    },
    retainedArtifactCount: "Archivos generados conservados",
    totalSize: "Tamaño total",
    checksum: "Sumas de comprobación presentes",
    deletedAt: "Tarea eliminada",
    editableSettings: "Ajustes editables del producto",
    deploymentReadOnly:
      "La infraestructura, la autenticación, los secretos, la simultaneidad y los límites de archivos se gestionan desde la implementación. Aquí solo se muestra el estado con los datos sensibles ocultos.",
  },
  health: {
    title: "Estado del sistema",
    description:
      "Resumen de solo lectura de los servicios y directorios gestionados de {{productName}}.",
    overall: "Estado general",
    checkedAt: "Comprobado",
    runningTurns: "Turnos en ejecución",
    processes: "Procesos app-server",
    concurrency: "Límite de simultaneidad",
    healthy: "Correcto",
    warning: "Advertencia",
    unavailable: "No disponible",
    notConfigured: "Sin configurar",
    notObserved: "No observado",
    degraded: "Degradado",
    available: "Disponible",
    cleanupFailures: "Fallos de limpieza",
    cleanupDescription:
      "Los reintentos automáticos se han detenido para estos recursos. Volver a intentarlo solo afecta a la tarea correspondiente y no interrumpe otras tareas activas.",
    retryCleanup: "Reintentar limpieza",
    retryAllCleanup: "Reintentar todo",
    retryingCleanup: "Reintentando la limpieza",
    cleanupRetryAllConfirmTitle: "Reintentar todas las limpiezas fallidas",
    cleanupRetryAllConfirmDescription:
      "El sistema comprobará el estado de cada elemento y volverá a intentarlo. Si una tarea afectada sigue activa, se aplazará; las demás tareas no se interrumpirán.",
    cleanupAttempts: "{{current}} / {{total}} intentos realizados",
    cleanupFailed: "Necesita atención",
    cleanupStages: {
      reconcile: "Comprobando el estado de los recursos",
      stop_runtime: "Deteniendo de forma segura la tarea afectada",
      delete_workspace: "Eliminando los archivos de la tarea",
      delete_control: "Eliminando el estado de ejecución de la tarea",
      verify_absent: "Verificando la limpieza",
    },
    cleanupReasons: {
      CLEANUP_RUNNER_UNAVAILABLE:
        "El servicio de limpieza no está disponible temporalmente",
      CLEANUP_RUNTIME_ACTIVE:
        "La tarea afectada sigue activa y sus recursos se han protegido",
      CLEANUP_RUNTIME_STATE_UNCERTAIN:
        "Todavía no se ha podido confirmar que la tarea se haya detenido de forma segura",
      CLEANUP_PERMISSION_DENIED:
        "No se ha podido eliminar el recurso; comprueba los permisos de almacenamiento",
      CLEANUP_PATH_BOUNDARY_INVALID:
        "No se ha podido validar la ubicación del recurso",
      CLEANUP_DIRECTORY_REMOVE_FAILED:
        "No se han podido eliminar por completo los archivos de la tarea",
      CLEANUP_VERIFICATION_FAILED:
        "No se ha podido verificar el resultado de la limpieza",
      CLEANUP_QUEUE_UNAVAILABLE:
        "No se ha podido añadir la solicitud de limpieza a la cola",
      CLEANUP_OPERATION_FAILED: "La limpieza de recursos no se ha completado",
      unknown: "La limpieza de recursos no se ha completado",
    },
    resources: {
      title: "Uso de recursos de los servicios",
      description:
        "Uso en tiempo real de CPU, memoria y procesos de los contenedores de servicios implementados con Docker.",
      empty: "No se ha observado uso de recursos de servicios Docker.",
      cpu: "CPU",
      memory: "Memoria",
      containers: "{{running}} / {{total}} contenedores en ejecución",
      pids: "PIDs {{count}}",
      state: "Estado {{state}}",
      checkedAt: "Recursos medidos",
      status: {
        available: "Observado",
        unavailable: "No disponible",
        notObserved: "No observado",
      },
      reasons: {
        unavailable:
          "No se pueden leer las mediciones de recursos de Docker. Comprueba el montaje del socket de Docker y los permisos del controlador de ejecución.",
        notObserved:
          "No se ha observado ninguna medición utilizable de recursos de contenedores Docker.",
      },
      services: {
        api: "Contenedor de API",
        runner: "Controlador de ejecución",
        workerPool: "Conjunto de workers de ejecución",
        web: "Contenedor web",
        gateway: "Contenedor de la puerta de enlace",
        postgres: "Contenedor PostgreSQL",
        redis: "Contenedor Redis",
        postgresBackup: "Contenedor de copias de seguridad de PostgreSQL",
        migrate: "Contenedor de migración",
        backupInit: "Contenedor de inicialización de copias de seguridad",
        storageInit: "Contenedor de inicialización del almacenamiento",
        runnerWorkerImage: "Contenedor de compilación de la imagen de worker",
      },
    },
    knowledgeRebuild: {
      title: "Reconstrucción completa del índice vectorial de conocimiento",
      description:
        "Mantenimiento explícito para cambios en el modelo de embeddings o las dimensiones de los vectores. Solo se muestra el progreso agregado de toda la implementación.",
      action: "Iniciar reconstrucción completa",
      retry: "Reintentar manualmente",
      empty:
        "No se ha iniciado ninguna reconstrucción de conocimiento en toda la implementación.",
      confirmTitle:
        "Confirmar la reconstrucción completa del índice vectorial de conocimiento",
      confirmDescription:
        "Siempre abarca todos los documentos no eliminados, incluidas las bases de conocimiento archivadas, y pausa la búsqueda vectorial global mientras se ejecuta.",
      confirmWarning:
        "Borra y vuelve a crear el índice vectorial de conocimiento. No elimina los archivos originales, los resultados de Docling ni el contenido analizado, y el índice anterior no se puede restaurar.",
      confirmAction: "Confirmar e iniciar reconstrucción",
      reason: "Motivo",
      reasonHint:
        "Obligatorio. El motivo se registra en una entrada de auditoría con los datos sensibles ocultos.",
      total: "Total",
      succeeded: "Correcto",
      failed: "Fallido",
      errorSummary: "Código de error estable: {{code}}",
      status: {
        pending: "Pendiente",
        queued: "En cola",
        running: "En ejecución",
        completed: "Completado",
        failed: "Fallido",
      },
      stage: {
        queued: "Esperando el inicio",
        preparing: "Preparando la reconstrucción completa",
        recreating_index: "Volviendo a crear el índice vectorial",
        rebuilding_documents: "Reconstruyendo todos los índices de documentos",
        validating: "Validando los resultados de la reconstrucción",
        activating: "Activando el nuevo índice",
        completed: "Reconstrucción completa finalizada",
        failed: "La reconstrucción completa ha fallado",
        processing: "Procesando la reconstrucción completa",
      },
    },
    components: {
      api: "Servicio de API",
      public_url: "Seguridad de la conexión",
      database: "Base de datos",
      redis: "Redis y protección del inicio de sesión local",
      running_turn_capacity: "Capacidad de turnos en ejecución",
      running_turn_recovery: "Recuperación de turnos en ejecución",
      smtp: "Correo de autenticación",
      auth_email: "Función de correo de contraseña",
      local_password_login: "Inicio de sesión local con contraseña",
      runner: "Servicio de ejecución",
      workspace: "Raíz del espacio de trabajo",
      capability_root: "Raíz de instalación de plugins/Skills",
      oidc: "Inicio de sesión OIDC",
      teams: "Inicio de sesión de Teams",
      workspace_root: "Raíz del espacio de trabajo",
      document_parsing: "Análisis de documentos de conocimiento",
      knowledge_search_and_indexing: "Búsqueda e indexación de conocimiento",
      rerank: "Reordenación de resultados de conocimiento",
    },
    reasons: {
      public_url_insecure:
        "Este sitio usa HTTP, por lo que los datos de inicio de sesión, las conversaciones y los archivos no se cifran durante la transmisión. Las funciones principales siguen disponibles; configura HTTPS antes de exponerlo a Internet.",
      auth_https_required:
        "Este sitio usa HTTP. Configura HTTPS para iniciar sesión mediante OIDC o Teams.",
      not_configured: "Esta función opcional no está configurada.",
      not_observed:
        "Todavía no se ha observado un ciclo de recuperación compartida correcto.",
      connection_failed:
        "La comprobación de conexión ha fallado. Revisa la configuración de la implementación y el servicio.",
      read_write_failed:
        "La comprobación de lectura y escritura del directorio ha fallado. Revisa los montajes y los permisos.",
      login_protection_unavailable:
        "Redis no está disponible, por lo que tampoco lo están la protección del inicio de sesión local ni el acceso local con contraseña.",
      email_unavailable:
        "No se pueden solicitar nuevos correos para definir la contraseña por primera vez o restablecerla.",
      available: "La comprobación ha sido correcta.",
      document_parsing_unavailable:
        "El análisis de documentos no está disponible. Revisa la configuración y el servicio de Docling Serve.",
      knowledge_search_and_indexing_unavailable:
        "La búsqueda y la indexación de conocimiento no están disponibles. Revisa Elasticsearch, la configuración del modelo de embeddings y sus servicios.",
      embedding_dimension_mismatch:
        "La dimensión de salida de los embeddings no coincide con la del índice vectorial de Elasticsearch. Corrige la configuración y reconstruye el índice vectorial manualmente.",
      rerank_unavailable:
        "La reordenación de resultados no está disponible. Revisa la configuración y el servicio del modelo de reordenación.",
    },
    cleanupTypes: {
      workspace: "Espacio de trabajo de la tarea",
      codex_home: "Directorio de ejecución del usuario",
      object_storage: "Recurso de almacenamiento de objetos",
      capability_directory: "Directorio de plugins/Skills",
    },
  },
  systemUpdate: {
    notice: {
      title: "LinkSense {{version}} está disponible",
      description:
        "Los administradores pueden revisar la versión y seguir el proceso guiado de actualización.",
      action: "Ver actualización",
      dismiss: "Descartar el aviso de actualización de esta versión",
    },
    status: {
      update_available: "Actualización disponible",
      up_to_date: "Actualizado",
      check_failed: "La comprobación ha fallado",
    },
    overview: {
      title: "Estado de la versión",
      description:
        "Comprueba automáticamente las versiones oficiales de LinkSense en GitHub.",
    },
    currentVersion: "Versión actual",
    latestVersion: "Última versión",
    checkedAt: "Última comprobación",
    publishedAt: "Publicado",
    checkNow: "Comprobar ahora",
    openRelease: "Ver versión en GitHub",
    releaseNotes: "Notas de la versión",
    refreshFailed: "No se han podido volver a comprobar las actualizaciones",
    checkFailed: {
      title: "La última versión no está disponible temporalmente",
      GITHUB_UNAVAILABLE:
        "El servidor no ha podido acceder a GitHub. Comprueba su acceso a la red e inténtalo de nuevo.",
      GITHUB_RATE_LIMITED:
        "GitHub ha limitado temporalmente las comprobaciones de actualización. Inténtalo más tarde.",
      GITHUB_RESPONSE_INVALID:
        "GitHub ha devuelto información de versión que LinkSense no ha podido reconocer. Inténtalo más tarde.",
    },
    tutorial: {
      title: "Guía de actualización",
      description:
        "El script de actualización detecta la edición Core o Full, espera a que terminen los trabajos en curso y crea una copia de seguridad validada de la base de datos antes de la migración.",
      safetyTitle:
        "La aplicación web nunca inicia la actualización automáticamente",
      safetyDescription:
        "Ejecuta el comando en un terminal del servidor de LinkSense. Programa antes un periodo de mantenimiento y asegúrate de que un administrador pueda comprobar el estado de los servicios.",
      linux: "Linux",
      macos: "macOS (no uses sudo)",
      steps: {
        maintenance:
          "Programa un periodo de mantenimiento cuando haya poca actividad y avisa a los usuarios activos.",
        run: "Accede al servidor de LinkSense y ejecuta el comando correspondiente a su sistema operativo.",
        backup:
          "Guarda la ubicación de la copia de seguridad de PostgreSQL que muestra el script. Un fallo después de iniciarse la migración no restaura la base de datos automáticamente.",
        health:
          "Cuando termine la actualización, abre Estado del sistema y confirma que todos los servicios se han recuperado.",
      },
    },
  },
} satisfies TranslationResource<
  Pick<typeof enUS, "admin" | "health" | "systemUpdate">
>
