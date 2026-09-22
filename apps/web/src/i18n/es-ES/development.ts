import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const developmentMessages = {
  applicationDevelopment: {
    aiWorking:
      "{{productName}} está desarrollando la aplicación automáticamente",
    actions: "Acciones de la aplicación",
    annotations: {
      start: "Anotar",
      finish: "Salir de la anotación",
      unavailable:
        "Esta página no se puede anotar ahora. Vuelve a abrir la vista previa de la aplicación.",
      changed:
        "La página ha cambiado. Borra las anotaciones y sal del modo de anotación; vuelve a seleccionar cuando se actualice la vista previa.",
    },
    metadata: {
      name: "Nombre de la aplicación",
      description: "Descripción de la aplicación",
      editName: "Editar nombre de la aplicación",
      editDescription: "Editar descripción de la aplicación",
      addDescription: "Añadir una descripción de la aplicación",
      invalidName:
        "Introduce un nombre de aplicación de entre 1 y 160 caracteres.",
      invalidDescription:
        "La descripción debe tener un máximo de 4000 caracteres.",
      changed:
        "La aplicación ha cambiado. Vuelve a cargarla antes de editar de nuevo.",
      reload: "Volver a cargar",
    },
    publish: {
      draft: "Borrador",
      action: "Publicar",
      update: "Publicar actualización",
      done: "Publicada",
      pending: "Publicando…",
      title: "Publicar aplicación",
      confirm: "Publicar",
      successTitle: "Publicada correctamente",
      successDescription:
        "Se ha publicado «{{name}}» v{{version}}. Puedes usarla desde Mis aplicaciones.",
      description:
        "Al publicar, «{{name}}» queda lista para usar.\nPuedes abrirla desde Mis aplicaciones.",
      updateDescription:
        "Tras publicar, usarás la nueva versión de «{{name}}».\nAplicaciones compartidas: compártelas de nuevo y pide a los destinatarios que instalen la actualización manualmente.\nAplicaciones del catálogo: envía una actualización al centro de aplicaciones por separado.\nAntes de publicar, confirma que esta aplicación no tenga tareas en curso.",
      checking: "Comprobando tareas en curso…",
      activeTasks:
        "Esta aplicación tiene tareas en curso. Espera a que terminen antes de publicar. El estado se actualiza automáticamente.",
      checkFailed:
        "No se pudo comprobar el estado de las tareas. Reinténtalo antes de publicar.",
      changed:
        "La aplicación tiene nuevos cambios. Cierra y vuelve a abrir la ventana de publicación.",
    },
    deleteDescription:
      "Se eliminarán la aplicación, el borrador de desarrollo y el historial de conversaciones de depuración. Se conservarán las conversaciones de desarrollo, las tareas normales y los archivos del espacio de trabajo.",
    tests: {
      title: "Historial de conversaciones de depuración",
      empty: "Todavía no hay conversaciones de depuración",
      emptyHint:
        "Envía una tarea desde la vista previa de la aplicación para ver aquí su entrada, resultados y progreso.",
      current: "Conversación de depuración actual",
      restart: "Nueva conversación de depuración",
      summary: "Ejecuciones: {{count}}",
      submitted: "Solicitud de depuración enviada",
      view: "Ver historial",
      more: "Cargar más registros",
      detailHint:
        "Revisa entradas, resultados, archivos y actividad. Aquí puedes detener la conversación de depuración actual o resolver solicitudes pendientes.",
      delete: "Eliminar conversación de depuración",
      deleteHint:
        "Esta conversación de depuración se eliminará permanentemente y se limpiarán sus recursos de ejecución.",
      deleteDevelopmentHint:
        "Esta conversación de desarrollo se eliminará permanentemente. La aplicación, el borrador y el historial de depuración seguirán en Mis aplicaciones, donde podrás continuar el desarrollo o eliminarlos.",
      status: {
        idle: "Enviada",
        running: "En curso",
        completed: "Completada",
        failed: "Fallida",
        interrupted: "Detenida",
      },
    },
    resizePreview: "Cambiar el tamaño de la vista previa de la aplicación",
    developmentTask: "Tarea de desarrollo de la aplicación",
    previewTask: "Conversación de depuración de la aplicación",
    catalog: {
      newDevelopment: "Nueva versión de desarrollo",
      continueDevelopment: "Continuar el desarrollo",
      developNewVersion: "Desarrollar nueva versión",
      deleteDraft: "Eliminar borrador de desarrollo",
      deleteDraftDescription:
        "Se eliminarán el borrador y sus conversaciones de depuración. Se conservarán la aplicación publicada, las conversaciones de desarrollo, las tareas normales y los archivos del espacio de trabajo.",
      draftDetails: "Borrador de desarrollo",
      savedAt: "Guardado por última vez {{time}}",
      unpublishedHint:
        "Estos cambios aún no están publicados. Al usar la aplicación se abre la versión publicada.",
      filter: "Filtrar aplicaciones",
      all: "Todas las aplicaciones",
      developing: "En desarrollo",
      standard: "Aplicaciones estándar",
      interactive: "Aplicaciones interactivas",
      draftDescription:
        "Esta aplicación aún no está publicada. Continúa su desarrollo desde el menú.",
      empty: "No hay aplicaciones coincidentes",
      loadMore: "Cargar más aplicaciones",
    },
    create: "Crear aplicación interactiva",
    createHint:
      "Desarrolla mediante conversación, previsualiza los cambios mientras trabajas e instala cuando esté lista.",
    name: "Nombre de la aplicación",
    start: "Empezar a crear",
    creating: "Preparando…",
    continue: "Desarrollar",
    workspace: "Espacio de desarrollo de aplicaciones",
    waitingForTest:
      "La conversación de depuración sigue ejecutándose. Los últimos cambios aparecerán automáticamente cuando termine.",
    debug: "Depurar",
    preview: "Vista previa",
    diagnostics: "Registros de depuración ({{count}})",
    capabilities: "Configurar funciones",
    capabilitiesHint:
      "Elige las funciones que puede usar esta aplicación. Las selecciones guardadas se aplican a la vista previa de desarrollo y se incluyen al instalar o actualizar la aplicación.",
    capabilitySearch: "Buscar y seleccionar…",
    reloadCapabilities: "Volver a cargar la configuración",
    capabilitiesChanged:
      "La aplicación ha cambiado. Vuelve a cargar la configuración antes de guardar.",
    capabilityUnavailable: "No disponible",
    capabilitiesUnavailable:
      "Algunas funciones seleccionadas no están disponibles. Sustitúyelas o quítalas antes de guardar.",
    capabilityLimits:
      "Elige hasta 50 plugins y Skills en total, 20 bases de conocimiento y 20 servidores MCP.",
    capabilityHints: {
      plugin:
        "Conecta los servicios y herramientas que necesita esta aplicación.",
      skill: "Elige Skills para las tareas de la aplicación.",
      knowledge_base:
        "Elige las bases de conocimiento que puede consultar esta aplicación.",
      mcp_server: "Elige los servidores MCP que puede llamar esta aplicación.",
    },
    sourceError:
      "Los cambios actuales aún no se pueden ejecutar. Pide al asistente que corrija la aplicación. La vista previa muestra la última versión que funcionó.",
    preparing: "Preparando tu vista previa",
    preparingHint:
      "Tu aplicación aparecerá aquí cuando esté lista. Configura primero los plugins o bases de conocimiento necesarios.",
    noErrors: "Todavía no hay registros de depuración",
    noErrorsHint:
      "Prueba tu aplicación en la vista previa. Los errores de ejecución se registran aquí y el asistente puede consultarlos para ayudarte a resolverlos.",
  },
} satisfies TranslationResource<Pick<typeof enUS, "applicationDevelopment">>
