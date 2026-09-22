import type { enUS } from "@/i18n/en-US"
import type { TranslationResource } from "@/i18n/types"

export const knowledgeMessages = {
  knowledge: {
    title: "Bases de conocimiento",
    description:
      "Organiza, comparte y busca los documentos a los que tienes acceso.",
    searchCapability: {
      notInstalledTitle: "Core no incluye bases de conocimiento",
      notInstalledDescription:
        "Esta instalación utiliza LinkSense Core. Instala la edición Full para añadir el análisis de documentos y la búsqueda en bases de conocimiento.",
      unavailableTitle: "La búsqueda de conocimiento no está disponible",
      unavailableDescription:
        "La búsqueda de conocimiento no se puede utilizar ahora. Puedes seguir usando plugins, Skills y archivos adjuntos, y enviar tareas con normalidad. Inténtalo más tarde.",
      dimensionMismatch:
        "El índice de conocimiento no coincide con la configuración actual de la instalación. Un administrador debe revisar la configuración y ejecutar una reconstrucción completa manualmente.",
    },
    creationCapability: {
      unreadyTitle: "Todavía no se puede crear una base de conocimiento",
      unreadyDescription:
        "Los siguientes requisitos deben volver a estar disponibles antes de crear una base de conocimiento:",
      requestFailedTitle:
        "No se han podido comprobar los requisitos de la base de conocimiento",
      requestFailedDescription:
        "La comprobación de servicios no ha terminado. Vuelve a comprobarlos antes de crear una base de conocimiento.",
      notInstalledTitle: "Esta edición no incluye bases de conocimiento",
      notInstalledDescription:
        "Instala una edición que incluya bases de conocimiento antes de crear una.",
      retry: "Volver a comprobar",
      checks: {
        objectStorageUnavailable:
          "El almacenamiento de archivos no está disponible temporalmente",
        documentParsingUnavailable:
          "El análisis de documentos no está disponible temporalmente",
        embeddingNotConfigured:
          "Ningún administrador ha configurado un modelo de embeddings",
        embeddingUnavailable:
          "El servicio del modelo de embeddings no está disponible temporalmente",
        searchAndIndexingUnavailable:
          "La búsqueda y la indexación de conocimiento no están disponibles temporalmente",
      },
    },
    searchPlaceholder:
      "Buscar nombres o descripciones de bases de conocimiento…",
    empty: "No hay bases de conocimiento",
    loadMore: "Cargar más",
    noDescription: "Sin descripción",
    backToList: "Volver a las bases de conocimiento",
    overview: "Resumen de la base de conocimiento",
    documents: "Documentos",
    documentsDescription:
      "Sube documentos y sigue el progreso del análisis, la división en fragmentos, la vectorización y la indexación.",
    documentsEmpty: "No hay documentos",
    directory: {
      breadcrumb: "Ruta de carpetas de la base de conocimiento",
      root: "Raíz",
      empty: "Esta carpeta no contiene documentos",
      flatEmpty:
        "Esta base de conocimiento y sus carpetas no contienen documentos",
      viewMode: "Vista de documentos",
      directoryView: "Carpetas",
      flatView: "Lista plana",
      openFolder: "Abrir carpeta {{name}}",
      expandFolder: "Expandir carpeta {{name}}",
      collapseFolder: "Contraer carpeta {{name}}",
      showFolders: "Mostrar carpetas",
      open: "Abrir",
      folder: "Carpeta",
    },
    documentCount: "{{count}} documentos",
    readyCount: "{{count}} consultables",
    ownerNamed: "Propietario: {{name}}",
    ownerNamedSelf: "Propietario: {{name}} (yo)",
    updated: "Actualizada el {{date}}",
    sourceType: {
      label: "Fuente: {{source}}",
      local: "Local",
      sharepoint: "SharePoint",
    },
    disabled: "Base de conocimiento desactivada",
    disabledDescription:
      "Esta base de conocimiento no está disponible ahora. Contacta con su propietario o con un administrador.",
    archivedReadOnly:
      "Esta base de conocimiento está archivada y es de solo lectura. Restáurala para gestionar documentos o permisos de acceso.",
    lifecycle: { label: "Estado", current: "Actuales", archived: "Archivadas" },
    filter: { label: "Filtrar bases de conocimiento", all: "Todas" },
    scope: {
      label: "Ámbito de las bases de conocimiento",
      all: "Todas",
      owned: "Creadas por mí",
      shared: "Compartidas conmigo",
    },
    access: {
      owner: "Creada por mí",
      direct: "Compartida directamente conmigo",
      group: "Compartida a través de {{name}}",
      multiple: "{{count}} vías de acceso compartido",
      shared: "Compartida conmigo",
      unknownGroup: "Grupo desconocido",
      detailsAction: "Ver detalles del acceso",
      detailsTitle: "Vías de acceso",
      detailsDescription:
        "Actualmente tienes acceso por las siguientes vías activas.",
      directSource: "Acceso personal directo",
      groupSource: "Grupo de usuarios: {{name}}",
    },
    create: {
      action: "Crear base de conocimiento",
      title: "Crear base de conocimiento",
      description:
        "Una vez creada, sube documentos y compártelos con usuarios o grupos según necesites.",
      name: "Nombre de la base de conocimiento",
      optionalDescription: "Descripción (opcional)",
      nameRequired: "Introduce un nombre para la base de conocimiento.",
      sourceType: "Fuente de datos",
      sourceLocal: "Carga local",
      sourceLocalDescription:
        "Sube y gestiona documentos locales después de crearla.",
      sourceSharePoint: "Carpeta de SharePoint",
      sourceSharePointDescription:
        "Conecta una carpeta de SharePoint y sincronízala periódicamente.",
      sourceUnavailable: "No activada",
      sharePointNotConfigured:
        "Ningún administrador ha activado la fuente de SharePoint.",
      sharePointUrl: "URL de la carpeta de SharePoint",
      sharePointUrlHint:
        "Admite enlaces compartidos de carpetas de SharePoint y URL directas de carpetas dentro del sitio.",
      sharePointUrlPlaceholder:
        "https://contoso.sharepoint.com/:f:/s/team/share-token",
      syncFrequencyLabel: "Frecuencia de sincronización",
      syncFrequency: { daily: "Diaria", weekly: "Semanal", monthly: "Mensual" },
      syncWeekdayLabel: "Día de la semana",
      syncWeekday: {
        "1": "Lun",
        "2": "Mar",
        "3": "Mié",
        "4": "Jue",
        "5": "Vie",
        "6": "Sáb",
        "7": "Dom",
      },
      syncDayOfMonth: "Día",
      syncInvalidMonthDayHint: "Se omiten los meses que no tengan este día.",
      syncDayOption: "Día {{day}}",
      syncTime: "Hora",
      syncHour: "Hora",
      syncMinute: "Minuto",
      syncTimeZone: "Se sincroniza en la zona horaria {{timeZone}}.",
    },
    source: {
      title: "Sincronización de SharePoint",
      syncNow: "Sincronizar ahora",
      retrySync: "Reintentar sincronización",
      syncAccepted: "Se ha enviado el trabajo de sincronización de SharePoint.",
      status: {
        pending: "La carpeta {{folder}} está pendiente de sincronización.",
        syncing: "Sincronizando la carpeta {{folder}}.",
        ready: "La carpeta {{folder}} está sincronizada.",
        failed:
          "No se ha podido sincronizar parte o todo el contenido de la carpeta {{folder}}.",
      },
      phase: {
        scanning: "Explorando la carpeta de SharePoint",
        syncing: "Sincronizando archivos de SharePoint",
        processing: "Procesando documentos de conocimiento",
        completed: "Sincronización completada",
      },
      progress: {
        scanning: "Explorando la carpeta; {{count}} elementos encontrados",
        syncing: "Sincronizando archivos ({{processed}}/{{total}})",
        processing: "Procesando documentos ({{processed}}/{{total}})",
        completed: "Sincronización completada ({{processed}}/{{total}})",
        discovered: "{{count}} encontrados",
        summary:
          "Procesados {{processed}}/{{total}}: {{created}} creados, {{updated}} actualizados, {{deleted}} eliminados, {{skipped}} omitidos, {{retried}} reanudados y {{failed}} fallidos.",
      },
      retryHint:
        "Selecciona Reintentar sincronización para continuar desde la página de exploración o el punto de procesamiento de archivos donde se produjo el error.",
    },
    edit: {
      title: "Editar los datos de la base de conocimiento",
      description:
        "Actualiza el nombre y la descripción sin volver a procesar los documentos existentes.",
    },
    actions: {
      archive: "Archivar",
      restore: "Restaurar",
      retryNamed: "Reintentar el procesamiento de {{name}}",
      reprocessNamed: "Volver a procesar {{name}}",
      rebuildNamed: "Reconstruir el índice de {{name}}",
      cancelProcessing: "Cancelar procesamiento",
      reprocess: "Volver a procesar",
      rebuild: "Reconstruir índice",
      rebuildSelected: "Reconstruir seleccionados",
      rebuildSelectedShort: "Seleccionados",
      rebuildAll: "Reconstruir todos los documentos",
      rebuildAllShort: "Todos",
      rename: "Cambiar nombre",
      removeDirectShare: "Retirar mi acceso directo",
      documentMenu: "Gestionar el documento {{name}}",
    },
    confirm: {
      archive: {
        title: "¿Archivar la base de conocimiento?",
        description:
          "La base de conocimiento pasará a ser de solo lectura y podrás restaurarla más adelante.",
      },
      restore: {
        title: "¿Restaurar la base de conocimiento?",
        description:
          "Después de restaurarla, podrás volver a subir y procesar documentos y gestionar el acceso compartido.",
      },
      delete_base: {
        title: "¿Eliminar definitivamente la base de conocimiento?",
        description:
          "Esta acción no se puede deshacer. Solo se pueden eliminar bases de conocimiento archivadas.",
      },
      delete_document: {
        title: "¿Eliminar el documento?",
        description:
          "Se eliminarán «{{name}}», su contenido analizado y los datos de su índice.",
      },
      reprocess: {
        title: "¿Volver a procesar el documento?",
        description:
          "«{{name}}» se analizará y procesará de nuevo con la configuración actual.",
      },
      rebuild: {
        title: "¿Reconstruir el índice del documento?",
        description:
          "«{{name}}» se volverá a dividir en fragmentos y a vectorizar, sustituyendo su índice actual.",
      },
      rebuild_selected: {
        title: "¿Reconstruir los índices de los documentos seleccionados?",
        description:
          "Los documentos listos se volverán a dividir en fragmentos y a vectorizar para sustituir sus índices. Los documentos fallidos se reanudarán desde sus versiones candidatas fallidas para completar la indexación. Se procesarán {{count}} documentos.",
      },
      rebuild_all: {
        title:
          "¿Reconstruir todos los índices de documentos de esta base de conocimiento?",
        description:
          "Los documentos listos se volverán a dividir en fragmentos y a vectorizar para sustituir sus índices. Los documentos fallidos se reanudarán desde sus versiones candidatas fallidas para completar la indexación.",
      },
      remove_direct_share: {
        title: "¿Retirar tu acceso directo?",
        description:
          "Se retirará el acceso personal que se te ha concedido directamente. {{remainingAccess}}",
      },
    },
    deleteBlocked: {
      title: "Todavía no se puede eliminar la base de conocimiento",
      description:
        "Retira esta base de conocimiento de las siguientes aplicaciones y vuelve a intentar eliminarla.",
      usagesTitle:
        "Aplicaciones que utilizan esta base de conocimiento ({{count}})",
      openApplications: "Abrir el Centro de aplicaciones",
    },
    storage: {
      title: "Almacenamiento",
      description:
        "Las versiones actuales, el contenido archivado, las versiones antiguas conservadas para citas o durante 30 días, los originales fallidos y los objetos pendientes de limpieza ocupan almacenamiento. El estado «Eliminado» no significa que el espacio ya se haya liberado.",
      reserved: "{{size}} reservados",
    },
    events: {
      reconnecting:
        "La conexión de progreso en tiempo real se ha interrumpido y se está restableciendo. La actualización periódica sigue activa.",
    },
    document: {
      name: "Documento",
      size: "Tamaño",
      rebuildRequired: "Reconstrucción necesaria",
      retryAt: "Próximo intento previsto: {{date}}",
      retryWaitingFirst:
        "El primer reintento automático continuará el {{date}}",
      retryWaitingSecond:
        "El segundo reintento automático continuará el {{date}}",
      selectAll: "Seleccionar todos los documentos cargados",
      selectNamed: "Seleccionar el documento {{name}}",
      selectedCount: "{{count}} documentos seleccionados",
      rebuildBatchResult:
        "Se han enviado {{accepted}} documentos para su procesamiento; no se han podido enviar {{rejected}}.",
      candidateFailure:
        "Esta versión candidata ha fallado. La versión actual disponible sigue siendo utilizable.",
      failureDetailsNamed:
        "Ver los detalles del error de procesamiento del documento {{name}}",
      renameTitle: "Cambiar el nombre del documento",
      renameDescription:
        "Solo cambia el nombre mostrado. El documento no se vuelve a analizar ni a vectorizar.",
      displayName: "Nombre del documento",
      failure: {
        cancelled: "Se ha detenido el procesamiento de esta tarea.",
        encrypted:
          "El documento está protegido con contraseña o cifrado y no se puede procesar.",
        unsupportedFormat:
          "No se admite el procesamiento de este formato de documento.",
        officeConversionFailed:
          "No se ha podido convertir el documento a un formato que se pueda analizar. Comprueba que se abre correctamente en un programa ofimático habitual.",
        tooLarge:
          "El documento supera el límite de tamaño por archivo y no se puede procesar.",
        storageQuota:
          "La base de conocimiento no tiene suficiente espacio para continuar el procesamiento.",
        structureInvalid:
          "Ha fallado la validación de la estructura del documento o de la cobertura del contenido original.",
        imageConfigurationChanged:
          "La configuración de comprensión de imágenes ha cambiado. Vuelve a procesar el documento con la configuración actual.",
        imageModelNotFound:
          "El modelo de comprensión de imágenes configurado ya no existe. Selecciona otro modelo y vuelve a procesar el documento.",
        imageOutputInvalid:
          "El modelo de comprensión de imágenes no ha devuelto una descripción estructurada válida. Revisa el modelo e inténtalo de nuevo.",
        imageThinkingNotDisabled:
          "El sistema no ha podido verificar que el razonamiento del modelo de imágenes estuviera desactivado, por lo que ha detenido el procesamiento de forma segura.",
        parsingServiceFailed:
          "El servicio de análisis de documentos no ha generado un resultado utilizable. Reinténtalo o contacta con un administrador si el problema persiste.",
        parsingTaskExpired:
          "La tarea de análisis del documento ha caducado y el reenvío automático ha fallado. Reinténtalo o contacta con un administrador si el problema persiste.",
        parsingInvalid:
          "El documento analizado no ha superado la validación de integridad o seguridad.",
        configuration:
          "La configuración de embeddings o del índice no es compatible con este documento. Revisa la configuración de la instalación e inténtalo de nuevo.",
        serviceAuthentication:
          "Ha fallado la autenticación con un servicio de procesamiento externo. Pide a un administrador que revise la configuración de la instalación.",
        serviceUnavailable:
          "Un servicio necesario para procesar documentos no está disponible. Inténtalo más tarde.",
        indexingFailed:
          "Ha fallado la escritura o validación del índice de conocimiento. Inténtalo más tarde.",
        busy: "Otra tarea está procesando este documento. Inténtalo más tarde.",
        unknown:
          "El procesamiento del documento ha fallado. Reinténtalo o contacta con un administrador si el problema persiste.",
      },
      status: {
        processing: "En proceso",
        ready: "Consultable",
        failed: "Procesamiento fallido",
        deleted: "Eliminado",
      },
      stage: {
        queued: "Pendiente de procesamiento",
        uploading: "Subiendo",
        validating: "Validando",
        parsing: "Analizando",
        chunking: "Generando fragmentos secundarios",
        image_understanding: "Interpretando las imágenes del documento",
        parenting: "Creando fragmentos principales",
        embedding: "Generando embeddings",
        indexing: "Escribiendo el índice",
        activating: "Activando el nuevo índice",
        processing: "En proceso",
      },
    },
    upload: {
      action: "Subir documentos",
      title: "Subir documentos",
      ocrLabel: "Activar OCR",
      ocrDescription:
        "Reconoce texto en documentos escaneados e imágenes. Activar OCR aumenta el tiempo de procesamiento.",
      ocrRecommendedForImages:
        "Los archivos seleccionados incluyen imágenes. Activa OCR para este lote para reconocer el texto que contienen.",
      enableOcrForBatch: "Activar OCR para este lote",
      sourceType: "Origen de la carga",
      sourceTypeDescription:
        "Elige uno o varios archivos, o conserva la estructura de una carpeta local.",
      filesMode: "Archivos",
      folderMode: "Carpeta",
      chooseFiles: "Seleccionar documentos",
      chooseFolder: "Seleccionar carpeta local",
      limits:
        "Hasta {{maxFileSize}} por archivo y {{maxFiles}} documentos por selección.",
      loadingLimits: "Cargando los límites de carga de la instalación.",
      queue: "Cola de carga",
      queueSummary: "{{total}} archivos, {{waiting}} en espera",
      start: "Iniciar carga ({{count}})",
      locateExisting: "Ver documento existente",
      replace: "Sustituir documento existente",
      keepBoth: "Conservar ambos",
      resolveConflict: "Resolver conflicto de nombre",
      conflictTitle: "Resolver conflicto de nombre del documento",
      conflictDescription:
        "«{{incoming}}» tiene el mismo nombre que «{{existing}}», pero un contenido diferente. Elige cómo gestionar este archivo.",
      confirmedName: "Nombre confirmado por el servidor: {{name}}",
      batch: {
        runningTitle: "Subiendo y procesando documentos",
        attentionTitle: "Algunos documentos requieren atención",
        completedTitle: "Procesamiento del lote de documentos finalizado",
        summary: "{{completed}} / {{total}} documentos procesados",
        issues: "{{count}} documentos no han terminado correctamente",
        viewDetails: "Ver detalles",
      },
      state: {
        waiting: "Pendiente de carga",
        uploading: "Subiendo",
        processing: "Subido y en proceso",
        ready: "Procesamiento completado",
        duplicate: "Contenido duplicado",
        conflict: "Conflicto de nombre",
        skipped: "Omitido",
        failed: "Carga fallida",
      },
      errors: {
        unsupportedFormat: "Este formato de archivo no es compatible.",
        emptyFile: "No se pueden subir archivos vacíos.",
        fileTooLarge:
          "El archivo supera el límite de {{maxFileSize}} por archivo.",
        tooManyFiles: "Selecciona como máximo {{maxFiles}} archivos a la vez.",
      },
    },
    share: {
      action: "Compartir",
      title: "Compartir base de conocimiento",
      description:
        "Concede acceso a esta base de conocimiento a un usuario o grupo de usuarios.",
      targetType: "Compartir con",
      permissionDescription:
        "Los destinatarios pueden ver y buscar contenido, pero no gestionar documentos ni permisos de acceso.",
      user: "Usuario",
      group: "Grupo de usuarios",
      selectTarget: "Seleccionar destinatario",
      searchUserPlaceholder: "Buscar usuarios por nombre o correo electrónico…",
      searchGroupPlaceholder: "Buscar grupos de usuarios por nombre…",
      loadingTargets: "Cargando destinatarios",
      noTargets: "No hay destinatarios que coincidan",
      removeTarget: "Quitar al destinatario {{name}}",
      additionalTargets: "{{count}} selecciones más",
      active: "Accesos compartidos actuales",
      permissionUse: "Permiso de uso",
      empty: "No se ha compartido con ningún usuario ni grupo",
      revokeNamed: "Revocar el acceso de {{name}}",
      revokeUserRemoved:
        "Se ha revocado el acceso de {{name}}. Este usuario no tiene ninguna otra vía de acceso activa.",
      revokeUserRetained:
        "Se ha revocado el acceso de {{name}}. Este usuario sigue teniendo acceso a través de {{sources}}.",
      revokeGroupNone:
        "Se ha revocado el acceso del grupo {{name}}. Ningún miembro activo conserva actualmente el acceso por otra vía.",
      revokeGroupSome:
        "Se ha revocado el acceso del grupo {{name}}. Algunos miembros activos siguen teniendo acceso a través de {{sources}}. No se muestran datos de los miembros.",
      revokeGroupAll:
        "Se ha revocado el acceso del grupo {{name}}. Todos los miembros activos siguen teniendo acceso a través de {{sources}}. No se muestran datos de los miembros.",
      remainingSource: {
        owner: "la propiedad de la base de conocimiento",
        direct: "otro acceso compartido directo",
        user_group: "otro grupo de usuarios con acceso",
      },
      submit: "Añadir acceso compartido",
      removeDirectSuccess: "Se ha retirado el acceso personal directo.",
      removeDirectStillAccessible:
        "Se ha retirado el acceso personal directo. Puedes seguir accediendo a esta base de conocimiento por otra vía activa.",
      noRemainingAccess:
        "Dejarás de tener acceso a esta base de conocimiento al retirarlo.",
      remainingAccess:
        "Seguirás teniendo acceso a esta base de conocimiento por otra vía activa.",
    },
    preview: {
      title: "Vista previa del documento",
      views: "Modo de vista previa",
      original: "Original",
      parsed: "Contenido analizado",
      parsedDescription:
        "Este es el Markdown obtenido al analizar la versión del documento que se muestra.",
      sameVersionDescription:
        "Las vistas original y analizada corresponden a la misma versión actual del documento.",
      exactVersionDescription:
        "Se muestra la versión histórica exacta del documento utilizada en esta cita.",
      citationExcerpt: "Pasaje citado",
      unsupportedOriginal:
        "La vista previa del original no está disponible para este tipo de archivo. Consulta el contenido analizado o descarga el original.",
      loadingOriginal: "Cargando la vista previa del original",
      loadingParsed: "Cargando el contenido analizado",
      assetLoading: "Cargando la imagen del documento",
      assetLoadingNamed: "Cargando la imagen «{{name}}» del documento",
      assetUnavailable: "La imagen del documento no está disponible",
      assetUnavailableNamed:
        "La imagen «{{name}}» del documento no está disponible",
      parsedEmpty: "Este documento no tiene contenido analizado para mostrar",
      downloadOriginal: "Descargar original",
      expand: "Abrir vista ampliada",
      expandImage: "Abrir una vista ampliada de {{name}}",
      openNamed: "Ver vista previa del documento {{name}}",
      backToKnowledgeBase: "Volver a la base de conocimiento",
    },
    citation: {
      title: "Cita de conocimiento",
      loading: "Recuperando la cita de conocimiento",
      back: "Volver a la tarea",
      source: "Cita [{{number}}] · {{knowledgeBase}}",
      location: "Ubicación de la fuente: {{location}}",
      historicalUnavailableTitle:
        "El contenido de la cita histórica no está disponible",
      historicalUnavailableDescription:
        "La base de conocimiento o el documento de origen se han eliminado. El contenido, la vista previa del original y la descarga ya no están disponibles. Solo se conservan el nombre histórico y el resumen de la ubicación de la fuente registrados con la respuesta.",
      inlinePreviewUnavailable:
        "No se ha podido cargar el pasaje citado. Selecciona el marcador para abrir los detalles de la cita.",
      pages: "Páginas {{values}}",
      documentLevel: "Fuente a nivel de documento",
    },
  },
  knowledgeSources: {
    title: "Fuentes de conocimiento",
    description:
      "Configura de forma centralizada las conexiones con fuentes externas. Solo los administradores pueden crear y gestionar bases de conocimiento con fuentes externas.",
    saved:
      "La configuración de SharePoint se ha guardado y la autenticación se ha verificado.",
    secretConfigured: "Secreto configurado; déjalo en blanco para conservarlo",
    sharepoint: {
      title: "Microsoft SharePoint",
      description:
        "Sincroniza documentos de una carpeta de un sitio autorizado mediante la identidad de una aplicación de Microsoft Graph.",
      enable: "Activar la fuente de SharePoint",
      enableDescription:
        "Los administradores pueden pegar la URL de una carpeta de SharePoint al crear una base de conocimiento.",
      tenantId: "ID de directorio (inquilino)",
      clientId: "ID de aplicación (cliente)",
      tenantDomain: "Dominio del inquilino de SharePoint",
      tenantDomainDescription:
        "Solo se admiten URL de carpetas de este host exacto, por ejemplo, contoso.sharepoint.com.",
      clientSecret: "Secreto de cliente",
      secretDescription:
        "El secreto se almacena cifrado y nunca se devuelve ni se incluye en los registros.",
      permissionTitle: "Requisito de privilegios mínimos",
      permissionDescription:
        "Utiliza Sites.Selected y pide a un administrador de Microsoft 365 que conceda acceso de lectura únicamente a los sitios autorizados. Al guardar se valida la identidad de la aplicación; al crear una base de conocimiento también se comprueba el acceso a la carpeta concreta.",
    },
  },
  library: {
    title: "Biblioteca de recursos",
    description:
      "Gestiona el conocimiento y los archivos generados durante la ejecución de las tareas.",
    tabsLabel: "Contenido de la biblioteca de recursos",
    tabs: {
      knowledge: "Bases de conocimiento",
      artifacts: "Resultados de tareas",
    },
    artifacts: {
      title: "Resultados de tareas",
      description:
        "Explora los archivos generados, organizados por tarea y fecha, y descárgalos o consulta los formatos compatibles en una vista previa.",
      searchPlaceholder: "Buscar títulos de tareas o nombres de archivos…",
      fileTypeLabel: "Filtrar por tipo de archivo",
      fileTypes: {
        all: "Todos los tipos",
        image: "Imágenes",
        word: "Word",
        excel: "Excel",
        powerpoint: "PPT",
        html: "HTML",
        pdf: "PDF",
        archive: "Archivos comprimidos",
        text: "Texto",
        audio: "Audio",
        video: "Vídeo",
        other: "Otros",
      },
      empty: "No hay resultados de tareas",
      emptyDescription:
        "Los archivos aparecerán aquí cuando una tarea genere y registre un resultado descargable.",
      searchEmpty: "No hay resultados de tareas que coincidan",
      listLabel: "Cronología de resultados de tareas",
      archivedTask: "Archivada",
      previewAvailable: "Vista previa disponible",
      downloadNamed: "Descargar {{name}}",
      loadingMore: "Cargando más…",
      resizePreview: "Cambiar el tamaño de la vista previa del resultado",
    },
  },
  adminKnowledge: {
    title: "Bases de conocimiento",
    description:
      "Administra los metadatos de las bases de conocimiento de todos los usuarios y configura sus fuentes, sin acceder al contenido de los documentos, a las vistas previas ni a las descargas.",
    tabsLabel: "Secciones de bases de conocimiento",
    tabs: {
      knowledgeBases: "Bases de conocimiento",
      sources: "Fuentes de conocimiento",
    },
    search: "Buscar bases de conocimiento o propietarios",
    empty: "No hay bases de conocimiento que coincidan",
    ownerDisabled: "Propietario desactivado",
    lifecycle: {
      label: "Ciclo de vida",
      all: "Todos los ciclos de vida",
      active: "Activa",
      archived: "Archivada",
      deleted: "Eliminada",
    },
    availability: {
      label: "Disponibilidad",
      all: "Todos los estados de disponibilidad",
      enabled: "Activada",
      disabled: "Desactivada",
    },
    columns: {
      knowledgeBase: "Base de conocimiento",
      owner: "Propietario",
      documents: "Documentos",
      storage: "Almacenamiento",
      shares: "Permisos de acceso",
      diagnostics: "Diagnóstico",
    },
    documentSummary: "{{total}} en total · {{ready}} consultables",
    documentIssues: "{{processing}} en proceso · {{failed}} con errores",
    shareCount: "{{count}} permisos activos",
    pagination: {
      label: "Paginación de la lista de bases de conocimiento",
      page: "Página {{page}}",
    },
    revokeNamed: "Revocar el permiso de acceso de {{name}}",
    cleanup: "Limpieza: {{status}}",
    cleanupStatus: {
      pending: "Pendiente",
      running: "En curso",
      failed: "Fallida",
      completed: "Completada",
    },
    noDiagnostics: "Sin incidencias",
    actionsFor: "Administrar la base de conocimiento {{name}}",
    archiveBeforeDelete:
      "Después de archivar, la eliminación requiere otra confirmación. Esta acción no elimina la base de conocimiento.",
    reason: "Motivo",
    reasonHint:
      "Obligatorio. El motivo se guarda en un registro de auditoría sin información sensible.",
    actions: {
      disable: "Desactivar",
      enable: "Activar",
      archive: "Archivar",
      transferOwner: "Cambiar propietario",
      retryCleanup: "Reintentar limpieza",
      delete: "Eliminar definitivamente",
    },
    feedback: {
      disable: "Base de conocimiento desactivada.",
      enable: "Base de conocimiento activada.",
      archive: "Base de conocimiento archivada.",
      delete: "Se ha solicitado la eliminación de la base de conocimiento.",
      cleanup_retry: "Se ha solicitado un nuevo intento de limpieza.",
      revoke_grant: "Permiso de acceso revocado.",
      transfer_owner: "Propietario de la base de conocimiento cambiado.",
    },
    confirm: {
      disable: {
        title: "¿Desactivar la base de conocimiento?",
        description:
          "Los usuarios no podrán buscar ni utilizar el contenido de «{{name}}» mientras esté desactivada.",
        action: "Desactivar",
      },
      enable: {
        title: "¿Activar la base de conocimiento?",
        description:
          "Los permisos activos de «{{name}}» volverán a permitir el acceso.",
        action: "Activar",
      },
      archive: {
        title: "¿Archivar la base de conocimiento?",
        description: "«{{name}}» pasará a ser de solo lectura al archivarla.",
        action: "Archivar",
      },
      delete: {
        title: "¿Eliminar definitivamente la base de conocimiento?",
        description:
          "Se eliminará definitivamente la base de conocimiento archivada «{{name}}». Esta acción no se puede deshacer.",
        action: "Eliminar definitivamente",
      },
      cleanup_retry: {
        title: "¿Reintentar la limpieza de recursos?",
        description:
          "Se volverán a ejecutar las tareas de limpieza fallidas de la base de conocimiento «{{name}}».",
        action: "Reintentar limpieza",
      },
      revoke_grant: {
        title: "¿Revocar el permiso de acceso?",
        description:
          "Se retirará el acceso a la base de conocimiento de «{{name}}».",
        action: "Revocar",
      },
    },
    transfer: {
      title: "Cambiar el propietario de la base de conocimiento",
      description:
        "Selecciona un usuario activo como nuevo propietario de la base de conocimiento «{{name}}».",
      owner: "Nuevo propietario",
      search: "Buscar usuarios",
      select: "Seleccionar nuevo propietario",
      action: "Cambiar propietario",
    },
  },
} satisfies TranslationResource<
  Pick<
    typeof enUS,
    "knowledge" | "knowledgeSources" | "library" | "adminKnowledge"
  >
>
