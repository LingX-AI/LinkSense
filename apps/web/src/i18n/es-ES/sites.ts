import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const siteMessages = {
  webSites: {
    title: "Mis sitios",
    description:
      "Gestiona páginas y aplicaciones web publicadas, sus enlaces, servicios de datos y estado de publicación.",
    share: "Publicar como sitio",
    dialog: {
      share: "Publicar como sitio",
      edit: "Editar sitio",
      publish: "Publicar actualización",
      delete: "Eliminar sitio",
    },
    shareDescription:
      "Tras publicar, cualquier persona que tenga el enlace podrá visitar el sitio.",
    editDescription:
      "Edita el nombre, la descripción o el enlace personalizado. El enlace estable y los datos de la aplicación se conservan.",
    deleteDescription:
      "El sitio y sus versiones publicadas se eliminarán permanentemente. Cualquiera podrá reutilizar la dirección. Se conservan la tarea y los archivos originales.",
    name: "Nombre del sitio",
    summary: "Descripción",
    slug: "Nombre del enlace",
    slugPlaceholder: "Deja el campo vacío para generarlo automáticamente",
    slugHelp:
      "Usa entre 3 y 80 letras inglesas, números o guiones. Este nombre se usa en el enlace personalizado; el enlace estable no cambia.",
    slugPreview: "Ruta del enlace personalizado: {{path}}",
    slugChanged:
      "Los enlaces anteriores siguen funcionando después del cambio de nombre.",
    url: "Enlace del sitio",
    publishMode: "Modo de publicación",
    updateExisting: "Actualizar sitio existente",
    existingSite: "Seleccionar sitio",
    selectExistingSite: "Elige un sitio para actualizar",
    currentTask: "De esta tarea",
    noUpdateTargets:
      "No hay sitios disponibles para actualizar. Elige Nuevo sitio para empezar.",
    updateDescription:
      "Actualiza el sitio con esta página y conserva su enlace actual.",
    updateDisabledDescription:
      "El sitio seguirá sin publicar tras esta actualización. Puedes volver a publicarlo en Mis sitios.",
    updatedDescription:
      "El contenido del sitio se ha actualizado. Su enlace se conserva.",
    updateSite: "Actualizar sitio",
    newSite: "Nuevo sitio",
    sourceFile: "Página web",
    latestSource: "Más reciente: {{name}} · {{date}}",
    currentSource: "Publicada actualmente: {{name}} · {{date}}",
    datedSource: "{{name}} · {{date}}",
    selectSource: "Elige una página web de esta tarea",
    noSources:
      "No hay páginas web disponibles. Genera primero una nueva versión en la tarea original.",
    alreadyPublishedTitle: "Esta página web ya tiene un sitio",
    alreadyPublishedDescription:
      "Esta página web está vinculada a un sitio. Copia su enlace actual o gestiónalo en Mis sitios.",
    alreadyDisabledTitle: "Este sitio no está publicado",
    alreadyDisabledDescription:
      "El sitio vinculado a esta página web no está publicado. Vuelve a publicarlo en Mis sitios.",
    updateAnotherSite: "Actualizar otro sitio",
    publishedTitle: "Sitio publicado",
    updatedTitle: "Sitio actualizado",
    publishedDescription:
      "Copia el enlace para compartir tu sitio. Podrás gestionarlo en Mis sitios.",
    stillDisabled:
      "El contenido se ha actualizado, pero el sitio sigue sin publicar. Vuelve a publicarlo en Mis sitios.",
    copy: "Copiar enlace",
    copied: "Enlace copiado",
    copyFailed: "No se pudo copiar el enlace. Cópialo manualmente.",
    done: "Listo",
    cancel: "Cancelar",
    delete: "Eliminar sitio",
    save: "Guardar",
    publish: "Publicar sitio",
    search: "Buscar nombres o enlaces de sitios",
    filter: "Estado de publicación",
    status: {
      all: "Todos los estados",
      published: "Publicado",
      disabled: "Sin publicar",
    },
    empty: "Todavía no hay sitios publicados",
    emptyDescription:
      "Describe una página o aplicación en cualquier conversación y confirma su publicación para gestionarla aquí. También puedes seleccionar Publicar como sitio en una página existente.",
    noResults: "No hay sitios coincidentes",
    sourceTask: "Origen: {{title}}",
    sourceDeleted: "Tarea de origen eliminada",
    publishedAt: "Publicado el {{date}}",
    resources: "{{count}} archivos · {{size}}",
    visit: "Visitar",
    openSite: "Abrir sitio web",
    localOnly: "Solo se puede acceder desde este dispositivo",
    pageOnly: "Aplicación web · sin servicio de datos",
    dataConnected: "Aplicación web · servicio de datos conectado",
    dataCapabilityTitle: "Aplicación web",
    dataServiceDisconnected: "Sin servicio de datos",
    dataServiceConnected: "Servicio de datos conectado",
    copyNamed: "Copiar enlace de {{name}}",
    actions: "Gestionar {{name}}",
    edit: "Editar",
    update: "Publicar actualización",
    disable: "Retirar de la publicación",
    enable: "Volver a publicar",
    download: "Descargar sitio web",
    loadMore: "Cargar más",
    details: {
      open: "Detalles",
      description:
        "Consulta los enlaces de acceso, las funciones de la aplicación y los detalles de la publicación actual.",
      links: "Acceso y uso compartido",
      alias: "Enlace personalizado",
      aliasHelp:
        "Usa el nombre de enlace que elegiste. Los enlaces anteriores siguen funcionando después de cambiarlo.",
      stable: "Enlace estable",
      stableHelp:
        "Esta dirección se conserva al cambiar el nombre del enlace, actualizar la página o añadir un servicio de datos.",
      copyAlias: "Copiar enlace personalizado",
      copyStable: "Copiar enlace estable",
      unpublishedHelp:
        "Este sitio no está publicado y sus enlaces no están disponibles. Vuelve a publicarlo para restaurar el acceso mediante los mismos enlaces.",
      publication: "Detalles de publicación",
      source: "Conversación de origen",
      files: "Recursos web",
      publishedAt: "Publicación de la versión actual",
      updatedAt: "Última modificación",
      createdAt: "Creación",
    },
    invalidSlug:
      "Introduce entre 3 y 80 letras inglesas, números o guiones, sin guiones al principio ni al final.",
  },
} satisfies TranslationResource<Pick<typeof enUS, "webSites">>
