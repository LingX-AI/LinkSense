import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const capabilityMessages = {
  capability: {
    title: "Plugins y Skills",
    description:
      "Gestiona plugins y Skills personales, sus orígenes en el centro de plugins y su estado de ejecución.",
    builtIn: "Integrado",
    builtInReadOnly:
      "La plataforma lo incorpora automáticamente; no se puede seleccionar, desactivar, editar ni eliminar.",
    builtIns: {
      browser: {
        name: "Navegador de {{productName}}",
        description:
          "Usa un navegador gestionado y aislado para visitar páginas, interactuar con sitios y realizar capturas de pantalla.",
      },
      documentReader: {
        name: "Lector de documentos de {{productName}}",
        description:
          "Convierte documentos de oficina habituales, libros electrónicos, archivos CSV y PDF de texto de la tarea a Markdown para su lectura segura por la IA.",
      },
      docs: {
        name: "Documentación de {{productName}}",
        description:
          "Responde preguntas sobre el uso y la administración del producto a partir de la documentación oficial bilingüe.",
      },
      coreMcp: {
        name: "MCP principal de {{productName}}",
        description:
          "Ofrece conversión de documentos, registro de archivos de salida, generación de imágenes, búsqueda de conocimiento y creación de Skills mediante un único MCP integrado.",
      },
      fileService: {
        name: "Servicio de archivos de {{productName}}",
        description:
          "Registra los archivos entregables creados en la tarea actual como archivos descargables.",
      },
      imageGeneration: {
        name: "Generación de imágenes de {{productName}}",
        description:
          "Genera imágenes mediante el MCP integrado con el modelo configurado por el administrador.",
      },
      knowledgeBase: {
        name: "Conocimiento de {{productName}}",
        description:
          "Busca en las bases de conocimiento seleccionadas y lee los documentos necesarios para la tarea.",
      },
      applicationBuilder: {
        name: "Desarrollo de aplicaciones interactivas de {{productName}}",
        description:
          "Crea y edita aplicaciones mediante conversación, con vista previa en directo, depuración e instalación.",
      },
      skillCreator: {
        name: "Creador de Skills de {{productName}}",
        description:
          "Convierte un flujo de trabajo confirmado en una Skill personal completa y reutilizable.",
      },
    },
    pluginTitle: "Plugins",
    pluginDescription:
      "Gestiona tus plugins personales, sus orígenes en el centro de plugins y su estado de ejecución.",
    skillTitle: "Skills",
    skillDescription:
      "Gestiona tus Skills personales, sus orígenes en el centro de plugins y su estado de ejecución.",
    typeTabsLabel: "Tipo de plugin y Skill",
    tabs: { plugin: "Plugins", skill: "Skills" },
    searchPlaceholder: "Buscar nombres o descripciones de {{type}}…",
    installed: "Instalado",
    sourceTabsLabel: "Origen",
    viewMore: "Ver {{count}} más",
    viewMorePreview: "Ver {{names}}",
    viewMorePreviewWithCount: "Ver {{names}} y {{count}} más",
    collapseList: "Mostrar menos",
    noSearchResults: "No se han encontrado coincidencias de {{type}}.",
    add: "Añadir plugin/Skill",
    addPlugin: "Añadir plugin",
    addSkill: "Añadir Skill",
    install: "Instalar plugin/Skill",
    importType: "Método de importación",
    localImport: "Archivo local",
    manualSkill: "Crear Skill manualmente",
    packageFile: "Paquete de plugin/Skill",
    skillContent: "Contenido de SKILL.md",
    skillContentPreview: "Cuerpo de SKILL.md",
    skillContentEmpty: "El cuerpo de SKILL.md está vacío.",
    skillContentTruncated:
      "El cuerpo de SKILL.md es demasiado largo y la vista previa se ha recortado. Se instalará el archivo SKILL.md completo.",
    descriptionLabel: "Descripción",
    riskTitle: "Confirmar origen y riesgos",
    riskDescription:
      "El contenido instalado puede incluir scripts, servidores MCP, conexiones externas, variables de entorno o requisitos de credenciales. Continúa solo si confías en su origen.",
    riskConfirm: "He revisado el origen y el aviso de riesgos",
    installSubmit: "Confirmar instalación",
    previewSubmit: "Examinar origen y riesgos",
    previewing: "Examinando…",
    uploading: "Subiendo",
    parsing: "Carga completada. Examinando…",
    importingPluginStatus: "Importando plugin…",
    importingSkillStatus: "Importando Skill…",
    updatingPluginStatus: "Actualizando plugin…",
    updatingSkillStatus: "Actualizando Skill…",
    deletingPluginStatus: "Eliminando plugin…",
    uninstallingSkillStatus: "Desinstalando Skill…",
    previewConfirmDescription:
      "Revisa los resultados del análisis. El plugin o Skill solo se instala o actualiza después de marcar la confirmación y enviar.",
    previewExpires: "Caducidad de la vista previa",
    importKind: "Contenido que se importará",
    logoIncluded: "Logotipo incluido",
    declaredCapabilities: "Declaraciones",
    declaredEnvironmentKeys: "Variables de entorno declaradas",
    manifestSummary: "Resumen del manifiesto",
    noneDeclared: "Ninguna declaración",
    noRisksDetected:
      "No se han detectado riesgos conocidos. Aun así, debes confiar en el origen.",
    sourceTypes: {
      local: "Importación local",
      url: "Importación por URL",
      clawhub: "Repositorio de Skills de ClawHub",
    },
    importKinds: {
      manual_skill: "Skill creada manualmente",
      zip: "Paquete ZIP local",
    },
    declarations: {
      mcp_server: "Servidor MCP",
      scripts: "Scripts ejecutables",
      external_connections: "Conexiones a servicios externos",
      environment_variables: "Variables de entorno",
      credentials: "Credenciales",
      dependency_download_commands:
        "Comandos que pueden descargar dependencias",
    },
    installCompleted: "Plugin/Skill instalado.",
    installSkillCompleted: "Skill instalada.",
    updateCompleted: "Plugin/Skill actualizado.",
    updatePluginCompleted: "Plugin actualizado.",
    updateSkillCompleted: "Skill actualizada.",
    pluginSavedForNextTurn:
      "Plugin guardado. Se actualizará automáticamente antes del siguiente turno de la tarea.",
    statusUpdated: "Preferencia de activación actualizada.",
    empty: "No hay plugins ni Skills instalados.",
    pluginEmpty: "No hay plugins instalados.",
    skillEmpty: "No hay Skills instaladas.",
    source: "Origen",
    owner: "Propietario",
    personal: "Personal",
    plugin: "Plugin",
    skill: "Skill",
    enable: "Activar",
    disable: "Desactivar",
    personallyDisable: "Desactivar para mí",
    personallyEnable: "Activar para mí",
    personallyDisabledMessage: "Este plugin o Skill se ha desactivado para ti.",
    personallyEnabledMessage: "Este plugin o Skill se ha activado para ti.",
    uninstall: "Desinstalar",
    uninstalling: "Desinstalando",
    skillUninstalled: "Skill desinstalada.",
    logo: "Sustituir logotipo",
    deleteTitle: "¿Eliminar permanentemente este plugin/Skill?",
    deletePluginTitle: "¿Eliminar permanentemente este plugin?",
    deleteMcpTitle: "¿Eliminar permanentemente este MCP?",
    deleteDescription:
      "Se eliminarán permanentemente la configuración personal y las vinculaciones de credenciales relacionadas. Esta acción no se puede deshacer.",
    uninstallSkillTitle: "¿Desinstalar esta Skill?",
    uninstallSkillDescription:
      "Se eliminarán esta Skill, su configuración personal y sus vinculaciones de credenciales. Esta acción no se puede deshacer.",
    updatePlugin: "Actualizar plugin",
    updateSkill: "Actualizar Skill",
    updateSubmit: "Confirmar actualización",
    riskDetected:
      "Este plugin o Skill declara riesgos de ejecución que requieren atención.",
    riskDetails: "Riesgos",
    risks: {
      contains_mcp_server: "Contiene un servidor MCP.",
      contains_scripts: "Contiene scripts ejecutables.",
      contains_external_connections: "Puede conectarse a servicios externos.",
      requires_environment_variables:
        "Declara requisitos de variables de entorno.",
      requires_credentials: "Declara requisitos de credenciales.",
      contains_dependency_download_commands:
        "Contiene un comando de inicio que puede descargar dependencias.",
      declared_environment_keys: "Variables de entorno: {{values}}",
      dependency_commands: "Comandos de dependencias: {{values}}",
    },
  },
  credential: {
    title: "Credenciales de plugins",
    add: "Añadir credencial",
    personal: "Credencial personal",
    capabilityId: "ID del plugin",
    credentialId: "ID de la credencial",
    deleteTitle: "¿Eliminar esta credencial permanentemente?",
    edit: "Editar credencial",
    confirmCreate: "Confirmar creación",
    confirmUpdate: "Confirmar actualización",
    disableTitle: "¿Desactivar esta credencial?",
    enableTitle: "¿Activar esta credencial?",
    providerPlaceholder: "Por ejemplo: openai_api",
    nameInvalid:
      "Introduce un nombre de credencial de un máximo de 160 caracteres.",
    plugin: "Plugin",
    description:
      "Las credenciales de plugins contienen claves API y otros datos de autorización para acceder a servicios externos. Añade una credencial y vincúlala a un plugin para que use esos datos automáticamente al ejecutarse.",
    secret: "Valor de autorización",
    secretHint:
      "Las claves y los datos de autorización guardados no se vuelven a mostrar. No incluyas secretos en los nombres.",
    bind: "Vincular plugin",
    lastUsed: "Último uso",
    empty:
      "Todavía no hay credenciales. Añade aquí claves o datos de autorización cuando un plugin necesite acceder a un servicio externo.",
    deleteDescription:
      "Los plugins que usan esta credencial ya no podrán acceder a servicios externos con ella. La credencial y sus vinculaciones se eliminarán permanentemente y no podrán restaurarse.",
    disableDescription:
      "Los plugins dejarán de usar esta credencial en las ejecuciones posteriores. Se conservarán las vinculaciones existentes.",
    enableDescription:
      "Los plugins vinculados podrán volver a usar esta credencial en las ejecuciones posteriores.",
    providerType: "Identificador del servicio",
    providerTypeHint:
      "Introduce el identificador proporcionado para este servicio, como openai_api. Usa letras minúsculas, números, guiones bajos o guiones.",
    providerTypeFormat:
      "Usa letras minúsculas, números, guiones bajos o guiones para el identificador del servicio, como openai_api.",
    secretKey: "Nombre del ajuste",
    secretKeyHint:
      "Introduce el nombre requerido por el plugin, como API_KEY. Cópialo exactamente como aparece en sus instrucciones.",
    secretKeyFormat:
      "Los nombres de los ajustes deben empezar por una letra o guion bajo y contener solo letras, números o guiones bajos.",
    secretKeyDuplicate: "Los nombres de los ajustes deben ser únicos.",
    secretRequired: "Introduce los datos de autorización que quieras guardar.",
    keepSecretHint:
      "Deja el campo vacío para conservar el valor guardado. Introduce uno nuevo para sustituirlo.",
    savedSecretHint:
      "Los datos de autorización guardados no se muestran. Se conservan salvo que introduzcas valores nuevos.",
    bindings: "Plugins vinculados",
    bindingPriority:
      "Elige un plugin y confirma qué datos de esta credencial debe usar. El plugin los utilizará en las ejecuciones posteriores.",
    mappingTitle: "Confirmar los datos que se usarán",
    mappingDescription:
      "Se han seleccionado automáticamente los nombres coincidentes. Para los elementos restantes, selecciona los datos correspondientes de esta credencial.",
    pluginEnvironmentKey: "Datos que necesita el plugin",
    credentialField: "Usar de esta credencial",
    notMapped: "Sin seleccionar",
    bindingInProgress: "Guardando vinculaciones de plugins…",
    bindingSucceeded: "Vinculaciones de plugins guardadas.",
    confirmBind: "Guardar vinculaciones",
    unbindTitle: "¿Quitar esta vinculación de datos?",
    unbindDescription:
      "«{{plugin}}» dejará de leer «{{name}}» de esta credencial. Se conservarán los datos guardados.",
    confirmUnbind: "Quitar vinculación",
    unbindNamed: "Desvincular {{name}}",
    addSecretField: "Añadir ajuste",
    removeSecretField: "Quitar este ajuste",
    noDeclaredKeys:
      "Este plugin no tiene datos de credenciales que configurar.",
    pluginCount_one: "Usada por {{count}} plugin",
    pluginCount_other: "Usada por {{count}} plugins",
    associatedFields_one: "{{count}} elemento vinculado",
    associatedFields_other: "{{count}} elementos vinculados",
    notAssociated:
      "Todavía no la utiliza ningún plugin. Vincula un plugin para que use estos datos automáticamente al ejecutarse.",
    unavailablePlugin: "Plugin inaccesible",
    credentialDetails: "Detalles de la credencial",
    showDetails: "Ver detalles de configuración",
    hideDetails: "Ocultar detalles de configuración",
    pluginActionsNamed: "Acciones de vinculación de {{name}}",
    detailsNamed: "Detalles de configuración de {{name}}",
    manageAssociation: "Gestionar vinculaciones",
    removeAssociation: "Desvincular plugin",
    removeAssociationTitle: "¿Desvincular este plugin?",
    removeAssociationDescription:
      "«{{name}}» dejará de usar todos los datos de esta credencial. La credencial se conservará y podrás vincularla de nuevo más adelante.",
    completeConfiguration: "Completar configuración",
    fixAssociation: "Resolver vinculaciones",
    enableAction: "Activar credencial",
    configurationNote:
      "Se muestra la configuración guardada. No se verifica el acceso al servicio externo.",
    usesField: "Usa estos datos de la credencial:",
    otherCredential: "Proporcionado por otra credencial.",
    removeField: "Quitar vinculación",
    removeFieldNamed: "Quitar la vinculación de {{name}}",
    mappingSummary: "{{configured}} de {{total}} elementos seleccionados",
    unselectedFields: "Sin seleccionar:",
    selectInformation: "Seleccionar o ajustar datos",
    configurationStatus: {
      loading: "Comprobando…",
      failed: "Estado no disponible",
      unavailable: "Plugin no disponible",
      configured: "Credenciales configuradas",
      missing: "Se necesitan más datos",
      disabled: "Esta credencial está desactivada",
      disabledElsewhere: "Una credencial está desactivada",
      conflict: "Vinculaciones en conflicto",
      invalid: "La configuración necesita actualizarse",
    },
    configurationHelp: {
      failed:
        "No se pudo cargar el estado de configuración. Inténtalo de nuevo.",
      unavailable:
        "Este plugin no está disponible o no tienes acceso. Desvincúlalo o contacta con un administrador.",
      missing:
        "Faltan datos por configurar en el plugin. Consulta los detalles para ver qué falta y completar la configuración.",
      disabled:
        "Activa esta credencial para que el plugin vuelva a usar sus datos.",
      disabledElsewhere:
        "Otra credencial usada por este plugin está desactivada. Actívala o actualiza las vinculaciones.",
      conflict:
        "El mismo elemento está vinculado a varias credenciales. Gestiona las vinculaciones para elegir los datos que se usarán.",
      invalid:
        "Los datos vinculados no se pueden usar o ya no cumplen los requisitos del plugin. Comprueba los valores guardados y actualiza las vinculaciones.",
    },
    fieldStatus: {
      configured: "Configurado",
      missing: "Sin configurar",
      disabled: "La credencial que proporciona este valor está desactivada",
      conflict: "Vinculado a varias credenciales",
      invalid: "Requiere actualización",
    },
  },
} satisfies TranslationResource<Pick<typeof enUS, "capability" | "credential">>
