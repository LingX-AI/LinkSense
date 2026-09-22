import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const siteMessages = {
  webSites: {
    title: "Mis sitios",
    description:
      "Gestiona tus sitios publicados, actualiza su contenido o retíralos de la publicación en cualquier momento.",
    share: "Publicar como sitio",
    dialog: {
      share: "Publicar como sitio",
      edit: "Editar sitio",
      publish: "Publicar actualización",
      delete: "Eliminar sitio",
    },
    shareDescription:
      "Tras publicar, cualquier persona que tenga el enlace podrá visitar el sitio.",
    deleteDescription:
      "El sitio y sus versiones publicadas se eliminarán permanentemente. Cualquiera podrá reutilizar la dirección. Se conservan la tarea y los archivos originales.",
    name: "Nombre del sitio",
    summary: "Descripción",
    slug: "Nombre del enlace",
    slugPlaceholder: "Deja el campo vacío para generarlo automáticamente",
    slugHelp: "Usa entre 3 y 80 letras inglesas, números o guiones.",
    slugChanged:
      "Al cambiarlo, el enlace anterior dejará de funcionar inmediatamente.",
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
      "Abre una página web generada en una tarea y selecciona Publicar como sitio para gestionarla aquí.",
    noResults: "No hay sitios coincidentes",
    sourceTask: "Origen: {{title}}",
    sourceDeleted: "Tarea de origen eliminada",
    publishedAt: "Publicado el {{date}}",
    resources: "{{count}} archivos · {{size}}",
    visit: "Visitar",
    copyNamed: "Copiar enlace de {{name}}",
    actions: "Gestionar {{name}}",
    edit: "Editar",
    update: "Publicar actualización",
    disable: "Retirar de la publicación",
    enable: "Volver a publicar",
    download: "Descargar sitio web",
    loadMore: "Cargar más",
    invalidSlug:
      "Introduce entre 3 y 80 letras inglesas, números o guiones, sin guiones al principio ni al final.",
  },
} satisfies TranslationResource<Pick<typeof enUS, "webSites">>
