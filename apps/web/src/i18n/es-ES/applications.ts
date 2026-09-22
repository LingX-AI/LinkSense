import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const applicationsMessages = {
  applications: {
    opening: {
      expired:
        "Esta sesión de apertura ya no está disponible. Vuelve a tus aplicaciones para abrirla de nuevo.",
      back: "Volver a aplicaciones",
    },
    editMetadata: "Editar detalles de la aplicación",
    editMetadataPublishDescription:
      "Edita el icono, el nombre y la descripción. Los cambios se aplican al guardar. Las versiones compartidas y las del centro de aplicaciones se actualizan por separado.",
    editMetadataDescription:
      "Cambia el icono, el nombre y la descripción de la aplicación.",
    editDraftMetadataDescription:
      "Guarda los cambios en la aplicación en desarrollo. Publícala para usarlos en Mis aplicaciones.",
    distribution: {
      versionNumber: "Número de versión",
      editVersionLower:
        "La versión no puede ser inferior a la versión más alta existente, v{{version}}.",
      editVersionHint:
        "Conserva la versión existente o introduce una superior con el formato 1.0.0.",
      versionHint:
        "Se ha propuesto una versión. Para cambiarla, usa un formato como 1.0.0.",
      publishFirst:
        "Publica una versión antes de compartir esta aplicación o incluirla en el catálogo.",
      publishedVersionHint:
        "Comparte esta versión publicada o inclúyela en el catálogo. Publica primero los cambios nuevos.",
      serviceInstallationHint:
        "Instala para usar los recursos de la aplicación de su creador. Las versiones nuevas requieren una actualización manual. Se conservan tus conversaciones y archivos de trabajo.",
      availableVersion: "Disponible · v{{version}}",
      versionInvalid: "Introduce una versión válida, como 1.0.0.",
      versionSame:
        "La versión v{{version}} ya existe. Introduce una versión superior.",
      versionLower:
        "La versión debe ser superior a la más alta existente, v{{version}}.",
      saveSharing: "Guardar opciones de uso compartido",
      applyListing: "Solicitar inclusión en el catálogo",
      completeSetup: "Completar configuración",
      installedVersion: "Instalada · v{{version}}",
      editModes: "Editar modos de uso",
      direct: "Compartir con la organización",
      center: "Centro de aplicaciones",
      myApplications: "Mis aplicaciones",
      sharedApplications: "Compartidas conmigo",
      usageModes: "Opciones de uso",
      usageModesHint: "Elige al menos una opción. Puedes ofrecer ambas.",
      modes: {
        install: "Paquete de aplicación",
        service: "Servicio de aplicación",
      },
      modeDescriptions: {
        install:
          "Los usuarios instalan su propia aplicación, configuran sus credenciales y la mantienen de forma independiente.",
        service:
          "Los usuarios instalan manualmente el servicio de aplicación y utilizan tus recursos y credenciales configurados.",
      },
      install: "Instalar aplicación",
      useService: "Usar",
      installationName: "Nombre de la aplicación instalada",
      installationHint:
        "La aplicación y los plugins y Skills incluidos se guardarán en tu cuenta. Configura tus propias credenciales, bases de conocimiento y conexiones externas.",
      installed:
        "Aplicación instalada. Revisa y completa la configuración necesaria.",
      installedLabel: "Instalada",
      openInstalled: "Abrir mi aplicación",
      configure: "Configurar aplicación",
      guide: "Guía de uso",
      version: "v{{version}}",
      submit: "Enviar para aprobación",
      submitHint:
        "Un administrador revisará esta versión y sus opciones de uso. Los cambios posteriores requieren otra solicitud y no sustituyen automáticamente la versión aprobada.",
      releaseNotes: "Notas de la versión",
      submitted: "Enviada para aprobación del administrador.",
      withdraw: "Retirar solicitud",
      withdrawn: "Solicitud retirada.",
      unlist: "Retirar del catálogo",
      relist: "Volver a incluir en el catálogo",
      statusSaved: "Estado en el catálogo actualizado.",
      noReleases: "Todavía no se han enviado versiones.",
      noCenterApplications: "Todavía no hay aplicaciones en el centro",
      centerSearch: "Buscar en el centro de aplicaciones",
      centerUnavailable:
        "Esta aplicación no está disponible para su uso o instalación.",
      updateAvailable: "Actualización disponible",
      checkUpdate: "Buscar actualizaciones",
      updateTitle: "Actualizar aplicación instalada",
      update: "Actualizar aplicación",
      updateHint:
        "La actualización sustituye tus cambios en la aplicación. Se conservan tus conversaciones, archivos de trabajo y credenciales personales. Finaliza primero todas las tareas normales de esta aplicación.",
      upToDate: "Tienes la última versión disponible.",
      updateUnavailable:
        "Las actualizaciones no están disponibles en este momento. Tu aplicación instalada se conserva.",
      updated:
        "Aplicación actualizada. Se han conservado tus ajustes personales.",
      setupRequired: "Requiere configuración",
      preserved: "Se conservarán estos cambios personales: {{fields}}",
      fields: {
        name: "Nombre de la aplicación",
        instructions: "Instrucciones de la aplicación",
        model: "Modelo",
        reasoning_effort: "Esfuerzo de razonamiento",
        capabilities: "Plugins y Skills",
        resources: "Bases de conocimiento y conexiones externas",
      },
      review: "Revisar aplicación",
      approve: "Aprobar",
      reject: "Rechazar",
      reviewComment: "Comentario de revisión",
      reviewed: "Decisión de revisión guardada.",
      reviewInstructions: "Instrucciones de la aplicación",
      suspend: "Retirar aplicación del catálogo",
      resume: "Volver a incluir la aplicación en el catálogo",
      governanceReason: "Motivo",
      revokeHint:
        "Revocar el acceso impide nuevas instalaciones o usos del servicio. Se conservan las instalaciones independientes existentes y el historial.",
      saveModes: "Guardar opciones de uso",
      modesSaved: "Opciones de uso actualizadas.",
    },
    publication: { noGuide: "El creador no ha proporcionado una guía de uso." },
    scopeLabel: "Ámbito de aplicaciones",
    scope: {
      all: "Todas las aplicaciones",
      owned: "Creadas por mí",
      shared: "Compartidas conmigo",
    },
    search: "Buscar aplicaciones",
    searchPlaceholder: "Buscar nombres o descripciones de aplicaciones…",
    create: "Crear aplicación",
    createTypeDescription: "Elige cómo crear tu aplicación.",
    creation: {
      recommended: "Recomendado",
      interactiveTitle: "Crear una aplicación interactiva por chat",
      interactiveDescription:
        "Comparte tu idea y deja que LinkSense la haga realidad.",
      start: "Empezar a crear",
    },
    createStandardApp: "Crear aplicación estándar",
    createStandardAppDescription:
      "Configura un asistente personal con tus herramientas y recursos habituales.",
    interactiveApp: "Aplicación interactiva",
    importInteractiveApp: "Importar aplicación interactiva",
    importInteractiveAppDescription:
      "Sube un paquete de aplicación existente para añadirlo a Mis aplicaciones.",
    updateInteractivePackage: "Actualizar paquete de aplicación",
    interactivePackageUpdated: "Actualizado correctamente.",
    interactiveAppImported: "Importado correctamente.",
    interactivePackageRequirements:
      "Sube un paquete ZIP con manifest.json e index.html en su raíz.",
    applicationPackage: "Paquete de aplicación",
    interactivePackageHint:
      "Solo ZIP, hasta {{size}}. Las actualizaciones pueden conservar la versión existente o usar una superior.",
    interactivePackageSizeInvalid:
      "El paquete de aplicación está vacío o supera el límite de tamaño.",
    importPackageAction: "Importar",
    updatePackageAndPublish: "Actualizar",
    interactivePackageVersionInvalid:
      "La versión del paquete debe contener tres números, como 0.0.1. Actualiza la versión y vuelve a subir el paquete.",
    importPublicationRetry:
      "La importación no se ha completado. Comprueba los recursos necesarios e inténtalo de nuevo; no se creará una aplicación duplicada.",
    createAndPublish: "Crear",
    editAndPublish: "Guardar",
    editedAndPublished: "Guardado correctamente.",
    createPublicationRetry:
      "La creación no se ha completado. Comprueba la configuración e inténtalo de nuevo; no se creará una aplicación duplicada.",
    declaration: {
      title: "Lista de declaración de recursos",
      purpose:
        "Al crear una aplicación interactiva, usa esta lista para declarar en manifest.json los plugins, Skills, servidores MCP y bases de conocimiento que necesita.",
      search: "Buscar recursos por nombre",
      selectAll: "Seleccionar todo",
      selectResults: "Seleccionar todos los resultados",
      selectType: "Seleccionar todo: {{type}}",
      selectTypeResults: "Seleccionar todos los resultados: {{type}}",
      selected: "{{count}} seleccionados",
      groupSelected: "{{count}} / {{total}} seleccionados",
      empty: "No hay recursos disponibles para declarar",
      preview: "Vista previa de la declaración",
      mergeHint:
        "Después de copiar, añade el campo dependencies a manifest.json junto a name y version. Sustituye el campo dependencies si ya existe; no sobrescribas todo el archivo.",
      invalid:
        "No se puede generar una declaración válida. Selecciona hasta 50 plugins y Skills en total, 20 servidores MCP y 20 bases de conocimiento. Los nombres de los recursos deben tener entre 1 y 160 caracteres. Ajusta la selección o los nombres.",
      copy: "Copiar JSON de dependencias",
      copyFailed:
        "No se pudo copiar. Inténtalo de nuevo o selecciona el texto de la vista previa y cópialo manualmente.",
    },
    dependencies: {
      preview: "Comprobar recursos necesarios",
      hint: "El paquete de aplicación declara los siguientes plugins, Skills y otros recursos. Recomendamos completar su configuración antes de importar para que la aplicación funcione correctamente.",
      empty: "Esta aplicación no declara recursos necesarios.",
      search: "Busca y elige tus recursos",
      matched: "Configurado",
      unmatched: "Sin configurar",
      clear: "Borrar selección",
      serviceOnly:
        "Las aplicaciones interactivas solo se pueden usar en línea, no copiar. Los usuarios no necesitan volver a configurar los recursos conectados por el creador.",
      types: {
        plugin: "Plugin",
        skill: "Skill",
        mcp_server: "Servidor MCP",
        knowledge_base: "Base de conocimiento",
      },
    },
    nativeChatPanel: "Chat de LinkSense",
    hideNativeChat: "Ocultar chat",
    showNativeChat: "Mostrar conversación",
    resizeNativeChat: "Cambiar el tamaño del panel de chat",
    interactiveRuntimeUnavailable:
      "Esta aplicación interactiva no está disponible en este momento. Contacta con su creador.",
    created: "Creada correctamente.",
    updated:
      "Aplicación actualizada. Los próximos turnos de las tareas usarán automáticamente la configuración más reciente.",
    deleted: "Aplicación eliminada.",
    emptyTitle: "Todavía no hay aplicaciones disponibles",
    createdByMe: "Creada por mí",
    createdBy: "Creada por {{name}}",
    status: { active: "Activada", disabled: "Desactivada" },
    noDescription: "Sin descripción",
    card: {
      capabilityCount: "{{count}} plugins/Skills",
      knowledgeBaseCount: "Bases de conocimiento {{count}}",
      mcpServerCount: "MCP {{count}}",
    },
    capabilityCount: "{{count}} plugins/Skills",
    knowledgeBaseCount: "{{count}} bases de conocimiento",
    mcpServerCount: "{{count}} servidores MCP",
    shareTargets: "Compartida · {{targets}}",
    dependencyUnavailable:
      "Algunas dependencias están desactivadas o no disponibles. Restáuralas antes de iniciar una nueva tarea.",
    dependencyUnavailableShort: "No disponible; se puede quitar",
    usesPluginCredentials: "Utiliza credenciales de plugins",
    share: "Compartir",
    shareWithinOrganization: "Compartir dentro de la organización",
    usage: {
      action: "Análisis de uso",
      title: "Uso de la aplicación",
      description:
        "Consulta el uso y los costes de modelos de «{{name}}» durante el periodo seleccionado.",
      backToApplications: "Volver a aplicaciones",
      activeUsers: "Usuarios activos",
      activeUsersHint:
        "Usuarios distintos que crearon una tarea o iniciaron un turno real durante el periodo seleccionado",
      coverageTitle:
        "Los datos de tokens y costes comienzan cuando se inició su recopilación",
      coverageDescription:
        "La cobertura comienza el {{date}}. Las tareas y turnos anteriores se siguen contando, pero sus tokens y costes no se estiman con los precios actuales.",
      tokenBreakdownTitle: "Composición de tokens",
      costBreakdownTitle: "Composición de costes",
      unpricedTokens: "Tokens sin precio",
      modelBreakdownDescription:
        "Consulta llamadas, turnos, tokens y costes por modelo.",
      workloadBreakdownDescription:
        "Consulta llamadas, tokens y costes según la finalidad del modelo.",
    },
    startChat: "Probar ahora",
    deleteAction: "Eliminar aplicación",
    deleteTitle: "¿Eliminar esta aplicación?",
    deleteDescription:
      "La aplicación desaparecerá del centro de plugins y no podrá iniciar nuevas tareas. Se conserva el historial de tareas privadas existente.",
    editTitle: "Editar aplicación",
    createTitle: "Crear aplicación",
    editorDescription:
      "Configura el modelo, los plugins/Skills, las bases de conocimiento y las instrucciones. Introduce un número de versión; los cambios se aplican al guardar. Las versiones compartidas y las del catálogo se actualizan por separado.",
    basicInformation: "Información básica",
    details: {
      title: "Detalles de la aplicación",
      open: "Ver detalles de {{name}}",
      creator: "Creador",
      kinds: {
        standard: "Aplicación estándar",
        interactive: "Aplicación interactiva",
      },
      views: {
        configuration: "Configuración actual",
        published: "Versión publicada",
      },
      resources: "Recursos de la aplicación",
      noResources:
        "Esta aplicación no tiene recursos configurados ni declarados.",
      emptyGroup: "No hay recursos de este tipo",
      unknownResource: "Recurso ya no disponible",
      resourceGroup: "{{type}} ({{count}})",
      declaredResource: "Declarado por la aplicación: {{name}}",
      resourceStatus: {
        configured: "Configurado",
        unconfigured: "Sin configurar",
        unavailable: "No disponible",
      },
    },
    runtimeConfiguration: "Configuración de ejecución",
    icon: "Icono de la aplicación",
    iconPresetLabel: "Iconos de aplicación integrados",
    uploadIcon: "Subir imagen",
    replaceIcon: "Sustituir imagen",
    iconHint:
      "PNG, JPEG o WebP; ≤ {{size}}, máximo {{dimension}}×{{dimension}} px.",
    iconFileInvalid:
      "Selecciona una imagen que cumpla los límites de formato, tamaño y dimensiones.",
    iconPresets: {
      bot: "Bot",
      search: "Investigación y búsqueda",
      "book-open": "Base de conocimiento",
      "graduation-cap": "Educación y formación",
      "briefcase-business": "Empresa y oficina",
      "chart-column": "Análisis de datos",
      "code-xml": "Desarrollo de software",
      "pen-line": "Redacción de contenidos",
      sparkles: "Diseño creativo",
      lightbulb: "Innovación y planificación",
      headset: "Atención al cliente",
      "file-text": "Procesamiento de documentos",
      landmark: "Finanzas",
      scale: "Derecho y cumplimiento",
      "heart-pulse": "Salud",
      "shield-check": "Seguridad y riesgos",
      workflow: "Automatización de flujos de trabajo",
      "calendar-clock": "Programación",
      users: "Colaboración en equipo",
      "globe-2": "Negocios internacionales",
    },
    instructions: "Instrucciones de la aplicación",
    instructionsDescription:
      "Estas instrucciones se aplican como instrucciones de desarrollador de la aplicación y no se muestran a los destinatarios.",
    model: "Modelo",
    userSelectedModel: "Seleccionado por el usuario en el chat",
    modelOptionalDescription:
      "Si no se especifica un modelo, los usuarios pueden elegir el modelo y el esfuerzo de razonamiento en el chat.",
    reasoningEffort: "Esfuerzo de razonamiento",
    plugins: "Plugins",
    pluginsDescription:
      "Selecciona plugins gestionados por ti. Las aplicaciones usan directamente las credenciales ya vinculadas a cada plugin.",
    noPlugins: "No hay plugins disponibles.",
    pluginSelectPlaceholder: "Selecciona plugins…",
    pluginSearchPlaceholder: "Buscar plugins…",
    skills: "Skills",
    skillsDescription: "Selecciona Skills gestionadas por ti.",
    noSkills: "No hay Skills disponibles.",
    skillSelectPlaceholder: "Selecciona Skills…",
    skillSearchPlaceholder: "Buscar Skills…",
    knowledgeBases: "Bases de conocimiento",
    knowledgeBasesDescription:
      "Los destinatarios solo pueden consultar estas bases de conocimiento dentro de las tareas de la aplicación; no pueden explorarlas, previsualizarlas, descargarlas ni gestionarlas.",
    noKnowledgeBases: "No hay bases de conocimiento disponibles.",
    knowledgeBaseSelectPlaceholder: "Selecciona bases de conocimiento…",
    knowledgeBaseSearchPlaceholder: "Buscar bases de conocimiento…",
    mcpServers: "Servidores MCP",
    mcpServersDescription:
      "Selecciona los servidores MCP disponibles para esta aplicación. Todas sus herramientas, incluidas las que realizan cambios externos, siguen la política de ejecución activa.",
    noMcpServers: "No hay servidores MCP disponibles.",
    mcpServerSelectPlaceholder: "Selecciona servidores MCP…",
    mcpServerSearchPlaceholder: "Buscar servidores MCP…",
    resourceSearchEmpty: "No hay opciones coincidentes.",
    removeResource: "Quitar {{name}}",
    additionalResources: "{{count}} selecciones adicionales",
    shareTitle: "Compartir aplicación",
    shareDescription:
      "Comparte con usuarios o grupos seleccionados de la organización. Para integraciones mediante iframe, usa Acceso externo.",
    shareTargetType: "Destinatario",
    shareToUsers: "Usuarios",
    shareToGroups: "Grupos de usuarios",
    shareUserTarget: "Usuario destinatario",
    shareGroupTarget: "Grupo destinatario",
    shareUserSearchPlaceholder: "Buscar usuarios por nombre o correo…",
    shareGroupSearchPlaceholder: "Buscar grupos por nombre…",
    shareSaved: "Compartida correctamente.",
    shareGrantType: { user: "Usuario", user_group: "Grupo de usuarios" },
    currentShares: "Destinatarios actuales",
    noShares: "Esta aplicación todavía no se ha compartido con nadie.",
    revoke: "Revocar",
    taskUnavailable:
      "Esta aplicación no está disponible. No puedes enviar mensajes en este momento.",
    conversationManaged: "Esta tarea está gestionada por «{{name}}»",
    conversationManagedDescription:
      "El creador de la aplicación mantiene el modelo, los plugins, las Skills y las bases de conocimiento.",
    conversationManagedUserModelDescription:
      "con plugins, Skills, bases de conocimiento e instrucciones",
    externalAccess: {
      action: "Acceso externo",
      title: "Acceso externo a la aplicación",
      description:
        "Integra «{{name}}» en sitios web aprobados para que los usuarios externos solo utilicen esta aplicación.",
      backToApplications: "Volver a aplicaciones",
      accessTab: "Acceso e integración",
      accessSettingsSection: "Ajustes de acceso",
      originSettingsSection: "Ajustes de orígenes",
      starterQuestionsSection: "Preguntas predefinidas",
      credentialSettingsSection: "Autenticación del servidor",
      embedSettingsSection: "Configuración de integración",
      enabled: "Activar acceso externo",
      enabledDescription:
        "Al desactivarlo, las páginas integradas dejan de funcionar y las sesiones abiertas caducan.",
      authMode: "Autenticación",
      authRequirementLabel: "Requisito de autenticación",
      authModeRequired: "Requiere autenticación",
      authModePublic: "Sin autenticación",
      authRequiredDescription:
        "Recomendado para sistemas asociados. Su servidor verifica la solicitud antes de abrir la aplicación.",
      authPublicDescription:
        "Recomendado para páginas públicas. Los sitios aprobados pueden abrir la aplicación directamente, sin una verificación adicional del servidor.",
      allowedOrigins: "Orígenes permitidos para la integración",
      allowedOriginsPlaceholder:
        "https://portal.example.com\nhttps://ops.example.com",
      allowedOriginsDescription:
        "Introduce una dirección web por línea. Al guardar, cada dirección recibe su propia URL de iframe y ejemplo de integración. Usa HTTPS en producción; se permite localhost para pruebas locales.",
      starterQuestions: "Preguntas predefinidas",
      starterQuestionsDescription:
        "Configura hasta cuatro preguntas sugeridas por origen. Se muestran tal como se introducen; seleccionar una solo rellena el cuadro de mensaje.",
      starterQuestionOriginsTabsLabel: "Orígenes de preguntas predefinidas",
      starterQuestionsNeedOrigin:
        "Añade primero al menos un origen permitido para la integración.",
      starterQuestionsEmpty: "No hay preguntas predefinidas para este origen.",
      starterQuestionLabel: "Pregunta {{index}}",
      starterQuestionPlaceholder:
        "Introduce una pregunta que los usuarios puedan seleccionar rápidamente",
      starterQuestionDuplicate:
        "Las preguntas de un mismo origen deben ser únicas.",
      starterQuestionCount: "{{count}} / {{max}} configuradas",
      addStarterQuestion: "Añadir pregunta",
      removeStarterQuestion: "Quitar pregunta {{index}}",
      appId: "ID de la aplicación",
      appSecret: "Secreto de la aplicación",
      secretUnavailableValue: "Regenera para copiar",
      secretUnavailable:
        "Por seguridad, los secretos antiguos no vuelven a mostrarse. Regenera el secreto cuando necesites su valor completo y entrégalo al sistema asociado.",
      rotateSecret: "Regenerar",
      rotateConfirmTitle: "¿Regenerar el secreto de la aplicación?",
      rotateConfirmDescription:
        "Tras regenerarlo, el sistema asociado deberá usar el nuevo secreto y las páginas integradas abiertas caducarán.",
      changeConfirmTitle:
        "¿Guardar los ajustes de seguridad del acceso externo?",
      changeConfirmDescription:
        "Al guardar, las páginas integradas abiertas se comprobarán con los nuevos ajustes y puede que haya que abrirlas de nuevo.",
      secretRotated:
        "Secreto de la aplicación regenerado. Se han revocado las sesiones externas existentes.",
      embedOrigin: "Origen",
      embedOriginsTabsLabel: "Orígenes de integración",
      embedOriginTab: "Origen {{index}}",
      currentEmbedOrigin: "Origen actual",
      iframeUrl: "URL del iframe",
      embedCode: "Ejemplo de integración",
      serverCredentialWarning:
        "Cuando se requiera autenticación, deja que el sistema asociado haga la verificación en su servidor. No incluyas el secreto de la aplicación en el código del frontend.",
      saved: "Ajustes de acceso externo guardados.",
      copyFailed: "No se pudo copiar. Selecciona el contenido manualmente.",
      snippetTitle: "Aplicación integrada",
      snippetTicketComment:
        "Solicita a tu backend la credencial de acceso para esta visita. Nunca expongas aquí el secreto de la aplicación.",
    },
  },
} satisfies TranslationResource<Pick<typeof enUS, "applications">>
