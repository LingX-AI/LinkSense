import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const marketplaceMessages = {
  skillUpdate: {
    description:
      "Edita la Skill actual o sube un paquete completo. Revisa los cambios antes de confirmar la actualización.",
    loading: "Cargando la Skill actual…",
    loadFailed: "No se pudo cargar la Skill actual. Inténtalo de nuevo.",
    mode: "Método de actualización",
    edit: "Editar contenido de la Skill",
    replace: "Sustituir el paquete completo de la Skill",
    preserveNotice:
      "Solo cambiarán el nombre visible, la descripción y las instrucciones. Se conservarán los scripts, plantillas, imágenes y demás archivos existentes. Para cambiarlos, descarga el paquete completo, edítalo y elige «Sustituir el paquete completo de la Skill».",
    replaceNotice:
      "El nuevo paquete sustituirá la Skill actual. Se eliminarán los archivos existentes que falten en el nuevo paquete. Sube un paquete completo con todos los archivos que necesite la Skill.",
    identifierHint:
      "El identificador de la Skill no cambia durante una actualización.",
    content: "Instrucciones de la Skill",
    contentRequired: "Introduce las instrucciones de la Skill.",
    contentTooLarge:
      "Estas instrucciones son demasiado largas para editarlas en línea. Descarga el paquete completo, edítalo y vuelve a subirlo.",
    noChanges: "Todavía no se han realizado cambios.",
    files: "Archivos actuales de la Skill",
    download: "Descargar paquete completo de la Skill",
    selectedFile: "Seleccionado: {{name}}",
    uploading: "Subiendo: {{percentage}} %",
    checking: "Comprobando cambios y riesgos…",
    check: "Revisar cambios y riesgos",
    confirm: "Confirmar actualización",
    changes: "Cambios en los archivos",
    changeSummary:
      "{{added}} archivos añadidos, {{modified}} modificados, {{deleted}} eliminados y {{unchanged}} sin cambios.",
    added: "Archivos añadidos",
    modified: "Archivos modificados",
    deleted: "Archivos que se eliminarán",
    deleteNotice:
      "Estos archivos faltan en el nuevo paquete y se eliminarán al confirmar. Comprueba si la Skill todavía los necesita.",
    confirmDeletions: "Confirmo la eliminación de estos {{count}} archivos",
  },
  marketplace: {
    title: "Centro de plugins",
    description:
      "Explora plugins y Skills públicos y gestiona el contenido instalado, el personal y las conexiones MCP en un solo lugar.",
    personalAccountDescription:
      "Gestiona el contenido instalado, el personal, el repositorio de Skills y las conexiones MCP.",
    adminTitle: "Centro de plugins",
    adminDescription:
      "Revisa las copias inmutables de las versiones, gestiona su visibilidad en el centro de plugins y retira los elementos de inmediato si detectas riesgos.",
    adminTabsLabel: "Secciones de gestión del centro de plugins",
    tabs: {
      store: "Centro de plugins",
      mine: "Mis plugins/Skills",
      publishing: "Mis publicaciones",
      reviews: "Revisiones de publicación",
      listings: "Todas las publicaciones",
    },
    catalogTabsLabel: "Categorías del centro de plugins",
    catalogTabs: {
      plugin: "Plugins",
      skill: "Skills",
      mcp: "MCP",
      application: "Aplicaciones",
    },
    catalogDescriptions: {
      application:
        "Crea y gestiona aplicaciones y encuentra aplicaciones disponibles para usar.",
      plugin:
        "Explora y gestiona plugins para añadir herramientas y conexiones a tus tareas.",
      skill:
        "Explora el repositorio de Skills e instala y gestiona Skills para diferentes tareas.",
      mcp: "Gestiona conexiones y plugins MCP para dar a las tareas acceso a las herramientas y los datos que necesitan.",
    },
    catalogScopesLabel: "Ámbito del contenido",
    scopes: { public: "Público", personal: "Personal" },
    installedTitle: "Instalados",
    loadingInstalled: "Cargando contenido instalado…",
    installedEmpty: "Todavía no hay elementos instalados en {{category}}.",
    installedListLabel: "Elementos instalados en {{category}}",
    expandInstalled: "Mostrar los elementos instalados en {{category}}",
    collapseInstalled: "Ocultar los elementos instalados en {{category}}",
    searchCategory: "Buscar en {{category}}",
    publicCatalogLabel: "Catálogo público: {{category}}",
    personalCatalogLabel: "Catálogo personal: {{category}}",
    personalCatalogEmpty:
      "No hay elementos personales de {{category}} que coincidan con estos filtros.",
    personalMcpConnections: "Conexiones MCP",
    personalMcpPackages: "Paquetes de extensiones MCP",
    includesMcp: "Incluye MCP",
    manageMcp: "Gestionar MCP",
    status: {
      draft: "Borrador",
      published: "Publicado",
      unlisted: "Retirado del catálogo",
      suspended: "Retirado del catálogo",
      pending: "Pendiente de revisión",
      approved: "Aprobado",
      rejected: "No aprobado",
      withdrawn: "Solicitud retirada",
    },
    search: "Buscar en el centro de plugins",
    searchPlaceholder: "Buscar por nombre, descripción o autor…",
    capabilityType: "Tipo",
    itemType: "Tipo",
    catalogEmpty:
      "No hay publicaciones de {{category}} que coincidan con estos filtros.",
    byPublisher: "Publicado por {{publisher}}",
    publisher: "Autor",
    noDescription: "Sin descripción",
    noKnownRisks:
      "No se han detectado declaraciones de riesgos conocidos. Comprueba que confías en el autor antes de instalar.",
    releaseNumber: "Versión {{number}}",
    installCount: "{{count}} instalaciones",
    riskSummary: "Resumen de riesgos",
    manifest: "Copia del manifiesto",
    releaseNotes: "Notas de la versión",
    noReleaseNotes: "No se han proporcionado notas de la versión.",
    contentHash: "SHA-256 del contenido",
    viewDetails: "Ver detalles de {{name}}",
    install: "Instalar",
    installing: "Instalando",
    installingPluginStatus: "Instalando plugin…",
    installingSkillStatus: "Instalando Skill…",
    installingMcpStatus: "Instalando MCP…",
    update: "Actualizar",
    updatingPluginStatus: "Actualizando plugin…",
    updatingSkillStatus: "Actualizando Skill…",
    updatingMcpStatus: "Actualizando MCP…",
    updateAvailable: "Actualización disponible",
    updateInstallation: "Actualizar a la última versión",
    installed:
      "Instalado desde el centro de plugins como plugin/Skill personal.",
    installedPlugin:
      "Instalado desde el centro de plugins como plugin personal.",
    installedSkill: "Instalada desde el centro de plugins como Skill personal.",
    installedMcp: "Instalado desde el centro de plugins como MCP personal.",
    installationUpdated: "La instalación usa ahora la versión aprobada actual.",
    installationUpdatedPlugin:
      "El plugin del centro de plugins usa ahora la versión aprobada actual.",
    installationUpdatedSkill:
      "La Skill del centro de plugins usa ahora la versión aprobada actual.",
    installationUpdatedMcp:
      "El MCP del centro de plugins usa ahora la versión aprobada actual.",
    installedState: "Instalado",
    storeOrigin: "Instalación del centro de plugins",
    uninstall: "Desinstalar",
    uninstalling: "Desinstalando",
    uninstallingPluginStatus: "Desinstalando plugin…",
    uninstallingSkillStatus: "Desinstalando Skill…",
    uninstallingMcpStatus: "Desinstalando MCP…",
    uninstallTitle: "¿Desinstalar este plugin/Skill del centro de plugins?",
    uninstallPluginTitle: "¿Desinstalar este plugin del centro de plugins?",
    uninstallSkillTitle: "¿Desinstalar esta Skill del centro de plugins?",
    uninstallMcpTitle: "¿Desinstalar este MCP del centro de plugins?",
    uninstallDescription:
      "Se eliminarán tu instalación personal y su configuración. La publicación del centro de plugins no se verá afectada.",
    uninstalled: "Se ha desinstalado el plugin/Skill del centro de plugins.",
    uninstalledPlugin: "Se ha desinstalado el plugin del centro de plugins.",
    uninstalledSkill: "Se ha desinstalado la Skill del centro de plugins.",
    uninstalledMcp: "Se ha desinstalado el MCP del centro de plugins.",
    ownedCapabilitiesEmpty: "Todavía no tienes plugins ni Skills personales.",
    preferenceUpdated: "Tu preferencia de activación se ha actualizado.",
    personalCapabilityDeleted:
      "Se ha eliminado permanentemente el plugin/Skill personal.",
    personalPluginDeleted:
      "Se ha eliminado permanentemente el plugin personal.",
    personalMcpDeleted: "Se ha eliminado permanentemente el MCP personal.",
    updatePersonalCapability: "Actualizar plugin/Skill personal",
    updatePersonalPlugin: "Actualizar plugin personal",
    updatePersonalSkill: "Actualizar Skill personal",
    updatePersonalMcp: "Actualizar MCP personal",
    personalImportDescription:
      "Primero se analiza la fuente y se muestran sus riesgos. La instalación o sustitución solo se realiza tras una segunda confirmación.",
    personalPluginImportDescription:
      "Primero se analiza la fuente y se muestran sus riesgos. El plugin personal solo se instala o sustituye tras una segunda confirmación.",
    personalSkillImportDescription:
      "Primero se analiza la fuente y se muestran sus riesgos. La Skill personal solo se instala o sustituye tras una segunda confirmación.",
    importSources: {
      local: "Paquete ZIP local",
      manualSkill: "Crear una Skill manualmente",
    },
    zipPackage: "Paquete ZIP de plugin/Skill",
    zipPackageHint:
      "Solo se aceptan archivos ZIP que sigan las convenciones de paquetes de plugins o Skills.",
    zipPluginPackage: "Paquete ZIP de plugin",
    zipPluginPackageHint:
      "Solo se aceptan archivos ZIP que sigan la convención de paquetes de plugins.",
    zipSkillPackage: "Paquete ZIP de Skill",
    zipSkillPackageHint:
      "Solo se aceptan archivos ZIP que sigan la convención de paquetes de Skills.",
    skillMarkdown: "Contenido de SKILL.md",
    skillIdentifier: "Identificador de la Skill",
    skillNameRequired: "Introduce un identificador para la Skill.",
    skillNameTooLong: "El identificador no puede superar los 64 caracteres.",
    skillNameInvalid:
      "Usa solo letras inglesas minúsculas, números y guiones (-). Los guiones no pueden estar al principio ni al final, ni aparecer consecutivamente.",
    skillNameReserved:
      "Este identificador está reservado por el sistema. Elige otro.",
    skillDisplayName: "Nombre visible (opcional)",
    skillDisplayNameHint:
      "Se genera a partir del identificador. Puedes editarlo o dejarlo vacío; se permiten caracteres chinos y espacios.",
    skillNameHint:
      "Usa entre 1 y 64 caracteres: letras inglesas minúsculas, números y guiones (-). No coloques guiones al principio, al final ni consecutivos. No uses nombres de Skills integradas. Ejemplo: my-skill.",
    skillPreview: "Vista previa del contenido de la Skill",
    applyForListing: "Solicitar publicación",
    pendingReviewAction: "Publicación pendiente de revisión",
    publishNew: "Enviar una nueva publicación",
    submitUpdate: "Enviar nueva versión",
    publishDialogDescription:
      "Se crea una copia inmutable del plugin o Skill personal actual y se envía para revisión del administrador.",
    sourceCapability: "Plugin/Skill personal de origen",
    noPublishableSource:
      "No hay ningún plugin o Skill personal publicable con el mismo nombre y tipo que esta publicación. Importa o actualiza primero el origen en el centro de plugins.",
    immutableSnapshotNotice:
      "La revisión se aplica a una copia independiente e inmutable. Los cambios posteriores en tu plugin o Skill personal no afectan a esta versión pendiente.",
    submitForReview: "Enviar para revisión",
    submitted:
      "La copia de la versión se ha enviado para revisión del administrador.",
    submittedAt: "Enviada el {{date}}",
    reviewPolicyNotice:
      "Cada nueva versión se revisa de nuevo. Las versiones aprobadas nunca actualizan automáticamente las instalaciones existentes.",
    publicationsEmpty:
      "Todavía no has enviado aplicaciones, plugins ni Skills.",
    publicationsDescription:
      "Gestiona tus aplicaciones, plugins y Skills enviados, sigue las revisiones y publica actualizaciones.",
    backToCenter: "Volver al centro de plugins",
    manageApplicationListing: "Gestionar publicación",
    selectApplication: "Selecciona una aplicación para publicar",
    selectApplicationDescription:
      "Elige tu aplicación, configura su versión y modos de uso y envíala para revisión del administrador.",
    noPublishableApplication:
      "No se han encontrado aplicaciones aptas. Ajusta la búsqueda o crea y activa una aplicación en Mis aplicaciones.",
    withdraw: "Retirar solicitud de revisión",
    withdrawn: "Se ha retirado la versión pendiente.",
    unlist: "Retirar del centro de plugins",
    unlisting: "Retirando…",
    unlistConfirmTitle: "¿Retirar «{{name}}»?",
    unlistConfirmDescription:
      "Este contenido dejará de aparecer en el centro de plugins y no estará disponible para nuevos usuarios. Las instalaciones existentes podrán seguir ejecutándose y actualizándose.",
    relist: "Volver a publicar",
    unlisted:
      "La publicación se ha retirado del catálogo. Las instalaciones existentes pueden seguir ejecutándose y actualizándose.",
    relisted: "La publicación vuelve a estar visible en el centro de plugins.",
    releaseDetail: "Detalles de la versión",
    releaseDetailDescription:
      "Examina los archivos de la copia, las declaraciones de riesgos, el contenido de la Skill y el hash del contenido.",
    packageFiles: "Archivos de la copia",
    adminTitleShort: "Centro de plugins",
    reviewsEmpty: "No hay versiones pendientes de revisión.",
    listingsEmpty: "Todavía no hay publicaciones en el centro de plugins.",
    review: "Revisar",
    reviewRelease: "Revisar «{{name}}»",
    reviewDescription:
      "La decisión solo se aplica a esta versión inmutable. Los rechazos requieren un motivo claro.",
    reviewDecision: "Decisión de revisión",
    reviewComment: "Comentario de revisión",
    approvalCommentOptional: "El comentario es opcional al aprobar.",
    rejectionCommentRequired: "Se requiere un motivo al rechazar.",
    approve: "Aprobar",
    reject: "Rechazar",
    submitReview: "Enviar decisión",
    reviewApproved:
      "La versión se ha aprobado y pasa a ser la versión actual del centro de plugins.",
    reviewRejected:
      "La versión se ha rechazado y se ha enviado el motivo al autor.",
    suspendListing: "Retirar del catálogo",
    resumeListing: "Volver a publicar",
    suspendListingTitle: "¿Retirar «{{name}}» del catálogo?",
    suspendListingDescription:
      "La publicación se ocultará del centro de plugins y se impedirá que todas las copias instaladas inicien nuevas tareas.",
    resumeListingTitle: "¿Volver a publicar «{{name}}»?",
    resumeListingDescription:
      "La publicación volverá al centro de plugins y las copias instaladas podrán usarse de nuevo en tareas nuevas.",
    suspensionReason: "Motivo de retirada",
    listingSuspended:
      "La publicación se ha retirado y se ha bloqueado el inicio de nuevas tareas para todas sus instalaciones.",
    listingResumed: "La publicación se ha restablecido.",
    risks: {
      contains_mcp_server: "Contiene un servidor MCP",
      contains_scripts: "Contiene scripts ejecutables",
      contains_external_connections: "Puede acceder a servicios externos",
      requires_environment_variables: "Requiere variables de entorno",
      requires_credentials: "Requiere credenciales",
      contains_dependency_download_commands: "Puede descargar dependencias",
      declaredEnvironmentKeys: "Variables de entorno: {{values}}",
      mcpEnvironmentReferences: "Variables de entorno de MCP",
      mcpEnvironmentReference: "{{server}} · {{source}}",
      environmentSource: {
        local: "Proporcionada por una credencial personal",
        remote: "Proporcionada por el entorno remoto",
      },
    },
  },
  clawHub: {
    sourceName: "ClawHub",
    repository: "Repositorio de Skills",
    catalogLabel: "Repositorio de Skills de ClawHub",
    search: "Buscar en el repositorio de Skills",
    loading: "Cargando repositorio de Skills…",
    refreshing: "Actualizando…",
    empty: "No hay Skills disponibles",
    emptyDescription:
      "El servicio todavía no ha sincronizado metadatos de Skills disponibles en ClawHub.",
    noSearchResults: "No hay Skills coincidentes",
    noSearchResultsDescription: "No hay Skills que coincidan con «{{search}}».",
    sourceNotice:
      "Los metadatos de las Skills proceden de ClawHub. LinkSense no representa a ClawHub ni audita o avala estas Skills. Comprueba su origen y riesgos antes de instalarlas.",
    listLabel: "Resultados del repositorio de Skills",
    sortLabel: "Ordenar Skills",
    sort: { downloads: "Descargas", stars: "Estrellas" },
    totalCount: "Total: {{count}}",
    byOwner: "De {{owner}}",
    version: "Versión {{version}}",
    downloads: "{{count}} descargas",
    stars: "{{count}} estrellas",
    owner: "Propietario",
    latestVersion: "Última versión",
    downloadCount: "Descargas",
    starCount: "Estrellas",
    updatedAt: "Actualizada en ClawHub",
    syncedAt: "Última sincronización",
    topics: "Temas",
    platformRequirements: "Requisitos de plataforma",
    changelog: "Historial de cambios",
    openCanonical: "Ver en ClawHub",
    installedState: "Instalada",
    unavailableState: "No disponible",
    viewDetails: "Ver detalles de {{name}}",
    preparing: "Preparando…",
    paginationLabel: "Páginas del repositorio de Skills",
    pageNumber: "Página {{page}}",
    installTitle: "¿Instalar «{{name}}»?",
    updateTitle: "¿Actualizar «{{name}}»?",
    installPreviewDescription:
      "Comprueba la versión de ClawHub, su origen y los riesgos. La Skill solo se añade a tus Skills personales tras confirmar.",
    packageIdentity: "Origen de la Skill",
    versionToInstall: "Versión que se instalará",
    installFailedTitle: "Error de instalación",
    installing: "Instalando…",
    installingStatus: "Instalando Skill…",
    updatingStatus: "Actualizando Skill…",
    confirmInstall: "Confirmar instalación",
    confirmUpdate: "Confirmar actualización",
    installed: "Instalada desde el repositorio como Skill personal.",
    updated: "La instalación del repositorio de Skills está actualizada.",
    origin: "Instalación de ClawHub",
    uninstall: "Desinstalar",
    uninstalling: "Desinstalando",
    uninstallingStatus: "Desinstalando Skill…",
    uninstallTitle: "¿Desinstalar esta Skill de ClawHub?",
    uninstallDescription:
      "Se eliminarán tu instalación personal y su configuración. Los metadatos sincronizados del repositorio no se verán afectados.",
    uninstalled: "La Skill de ClawHub se ha desinstalado.",
    securityNoticeTitle: "Aviso de seguridad",
    security: {
      clean: "Comprobación de seguridad superada",
      warning: "Advertencias de seguridad",
      flagged: "Riesgo detectado",
      unknown: "Se comprueba al instalar",
      warningDescription:
        "El estado de seguridad de esta Skill requiere atención. Instálala solo si confías en su origen.",
    },
    installability: {
      unavailable: "Esta Skill no está disponible en este momento.",
      missingVersion: "Esta Skill no tiene una versión instalable.",
      alreadyInstalled: "Esta versión ya está instalada.",
    },
  },
} satisfies TranslationResource<
  Pick<typeof enUS, "skillUpdate" | "marketplace" | "clawHub">
>
