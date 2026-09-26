import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const automationMessages = {
  automation: {
    title: "Automatizaciones",
    description:
      "Programa tareas recurrentes, crea recordatorios y sigue lo que te importa.",
    create: "Nueva automatización",
    createTitle: "Nueva automatización",
    editTitle: "Editar automatización",
    editorDescription:
      "Configura las instrucciones, la tarea fija y la frecuencia personalizada.",
    resizeEditor: "Cambiar el tamaño del editor de automatizaciones",
    empty: "Todavía no hay automatizaciones",
    emptyDescription:
      "Crea una automatización para iniciar ejecuciones programadas en una tarea fija.",
    suggestions: {
      title: "Sugerencias",
      useTemplateNamed: "Usar la plantilla {{name}}",
      dailyBrief: {
        title: "Resumen diario",
        schedule: "Días laborables, 08:00",
        description:
          "Empieza cada día de trabajo con un resumen de tu calendario, correos sin leer y prioridades",
        instruction:
          "Revisa mi calendario, los correos sin leer y mis prioridades. Resume la agenda de hoy, los mensajes que necesitan respuesta y las tareas más importantes en un informe diario conciso.",
      },
      weeklyReview: {
        title: "Balance semanal",
        schedule: "Viernes, 16:00",
        description:
          "Convierte el trabajo de la semana en un breve informe de estado cada viernes",
        instruction:
          "Revisa los avances de esta semana, el trabajo terminado, los asuntos pendientes y las prioridades de la próxima semana, y organízalos en un informe de estado conciso.",
      },
      followUpMonitor: {
        title: "Seguimiento de pendientes",
        schedule: "Días laborables, 09:00",
        description:
          "Revisa la actividad reciente del correo y el calendario e identifica asuntos que requieren atención",
        instruction:
          "Revisa la actividad reciente del correo y el calendario. Identifica los asuntos que necesitan seguimiento, se acercan a su fecha límite o merecen atención, y resúmelos por prioridad.",
      },
    },
    filterLabel: "Filtrar automatizaciones",
    filter: { all: "Todas", active: "Activas", paused: "Pausadas" },
    filteredEmpty: "No hay automatizaciones con el filtro «{{filter}}»",
    filteredEmptyDescription:
      "Cambia el filtro para ver otras automatizaciones.",
    name: "Título de la automatización",
    instruction: "Instrucciones de la automatización",
    instructionHint:
      "Describe la tarea completa que debe realizarse en cada activación.",
    runIn: "Ejecutar en",
    task: "Tarea",
    targetTask: "Tarea",
    existingTask: "Tarea existente",
    newTask: "Nueva tarea",
    existingTaskHint:
      "Solo puedes seleccionar tareas fijadas activas de tu cuenta.",
    newTaskHint:
      "La tarea se crea y se fija una sola vez, y se reutiliza en todas las activaciones posteriores.",
    noPinnedTasks:
      "No hay tareas disponibles. Fija una tarea o selecciona Nueva tarea.",
    selectTask: "Selecciona una tarea fijada",
    repeat: "Repetir",
    interval: "Cada",
    intervalHint: "Ejecutar cada cierto número de {{unit}}, entre 1 y 999.",
    minuteOfHour: "Minuto de la hora",
    minuteOfHourHint:
      "Introduce un valor entre 0 y 59. Por ejemplo, 15 ejecuta la tarea en el minuto 15 de cada ciclo.",
    time: "Hora",
    hour: "Hora",
    minute: "Minuto",
    weekdays: "Ejecutar los",
    dayOfMonth: "Día",
    monthOfYear: "Mes",
    invalidMonthDayHint: "Se omiten los meses que no tengan este día.",
    monthOption: "Mes {{month}}",
    dayOption: "Día {{day}}",
    expiresEnabled: "Establecer fecha de vencimiento",
    expiresEnabledHint:
      "Puede haber ejecuciones en la fecha de vencimiento; se detienen a partir del día siguiente.",
    expiresOn: "Fecha de vencimiento",
    expiresOnPlaceholder: "Selecciona una fecha de vencimiento",
    clearExpiresOn: "Borrar fecha de vencimiento",
    timeZone: "Se ejecuta en la zona horaria {{timeZone}}.",
    modelOverride: "Elegir modelo y esfuerzo de razonamiento",
    modelOverrideHint:
      "Si se activa, se usan el modelo y el esfuerzo de razonamiento seleccionados. De lo contrario, se usan los valores predeterminados de tu cuenta.",
    modelOverrideUnavailable:
      "Todavía no hay modelos disponibles. Configura un proveedor de modelos en los ajustes de administración.",
    modelOverrideLoading: "Cargando modelos disponibles…",
    modelLabel: "Modelo",
    modelNotSelected: "Selecciona un modelo",
    reasoningEffortLabel: "Esfuerzo de razonamiento",
    reasoningEffortNotSelected: "Selecciona un esfuerzo de razonamiento",
    nextRun: "Próxima ejecución",
    lastRun: "Última ejecución",
    nextRunRelative: "Próxima ejecución {{relative}}",
    lastRunRelative: "Última ejecución {{relative}}",
    lastRunFailed: "La última ejecución falló",
    lastRunEmptyResult: "La última ejecución falló: sin resultados",
    pause: "Pausar",
    resume: "Reanudar",
    pauseNamed: "Pausar {{name}}",
    resumeNamed: "Reanudar {{name}}",
    runNow: "Ejecutar ahora",
    runNowLoading: "Ejecutando automatización…",
    runNowStarted: "Se ha iniciado «{{name}}».",
    runNowQueued: "«{{name}}» se ha añadido a la cola de su tarea.",
    openTask: "Abrir tarea",
    moreActionsNamed: "Más acciones para {{name}}",
    editNamed: "Editar {{name}}",
    deleteNamed: "Eliminar {{name}}",
    deleteTitle: "Eliminar automatización",
    deleteDescription:
      "¿Eliminar «{{name}}»? Se conservarán la tarea vinculada y su historial.",
    validation:
      "Completa los ajustes de la automatización y comprueba todos los números, fechas y horas.",
    weekdaySeparator: ", ",
    status: { active: "Activa", paused: "Pausada" },
    frequency: {
      hourly: "Cada hora",
      daily: "Diaria",
      weekly: "Semanal",
      monthly: "Mensual",
      yearly: "Anual",
    },
    unit: {
      hourly: "horas",
      daily: "días",
      weekly: "semanas",
      monthly: "meses",
      yearly: "años",
    },
    weekday: {
      "1": "lun",
      "2": "mar",
      "3": "mié",
      "4": "jue",
      "5": "vie",
      "6": "sáb",
      "7": "dom",
    },
    schedule: {
      hourly: "Cada {{interval}} hora(s), en el minuto {{minute}}",
      daily: "Cada {{interval}} día(s), a las {{time}}",
      weekly: "Cada {{interval}} semana(s), {{weekdays}} a las {{time}}",
      monthly: "Cada {{interval}} mes(es), el día {{day}} a las {{time}}",
      yearly: "Cada {{interval}} año(s), el {{day}}/{{month}} a las {{time}}",
    },
  },
  quotaManagement: {
    save: "Guardar ajustes",
    title: "Gestión de cuotas",
    description:
      "Gestiona la cuota semanal común para los miembros y el precio de conversión de créditos.",
    conversionTitle: "Conversión de créditos",
    conversionDescription:
      "Convierte el coste de uso de los modelos en créditos. Los cambios de precio solo afectan al consumo posterior; los cargos existentes se conservan.",
    creditPrice: "Importe por crédito (USD)",
    conversionExample:
      "Por ejemplo, con un precio de 0,01 USD por crédito, un cargo de 0,25 USD consume 25 créditos.",
    members: {
      actions: "Acciones sobre las cuotas de miembros",
      reset: "Restablecer las cuotas de todos",
      resetDescription:
        "Restaura la cuota semanal de cada miembro existente al 100 % de su límite actual. Los miembros sin límite seguirán sin límite. Los límites sin guardar de este formulario no se aplican al restablecimiento. Se conserva el historial de uso y el consumo posterior se descuenta normalmente.",
      title: "Cuota semanal de los miembros",
      description:
        "Se utiliza como cuota semanal predeterminada para los miembros creados, importados o registrados a partir de ahora. Usa el menú superior derecho para aplicarla a los miembros existentes, o ajústala individualmente o por lotes en la gestión de usuarios.",
    },
    weekly_credit_limit: "Cuota semanal (créditos)",
    weekly_credit_limit_hint:
      "Se restablece los lunes a medianoche en la zona horaria del sistema.",
    unlimited: "Sin límite",
    invalidAmount:
      "Introduce un importe positivo con un máximo de 6 decimales, no superior a 9.223.372.036.854,775807.",
    applyMembers: "Aplicar el límite a todos",
    applyDescription:
      "Guarda {{weekly}} como cuota semanal predeterminada y sustituye la de todos los miembros existentes, incluidos sus ajustes individuales. Los créditos usados no se restablecen; los demás ajustes del formulario no cambian.",
    confirmReset: "Confirmar restablecimiento de cuotas",
    resetHint:
      "Al confirmar se restauran inmediatamente los créditos disponibles y se conserva el historial de uso.",
    confirmApply: "Confirmar, guardar y aplicar",
    resetSuccess: "Se han restablecido las cuotas de {{count}} miembros.",
    applySuccess:
      "Se ha guardado el nuevo límite y aplicado a {{count}} miembros.",
    refreshFailed:
      "La acción se completó, pero no se pudo actualizar la página. Vuelve a cargarla para ver las cuotas actuales.",
    saved: "Ajustes de cuotas guardados.",
    enforcementHint:
      "Un campo vacío significa sin límite. Alcanzar el límite semanal impide iniciar nuevas tareas; las que ya están en ejecución continúan. El consumo se redondea hacia arriba al múltiplo de 0,000001 créditos más cercano.",
  },
  personalQuota: {
    title: "Uso de créditos",
    description: "Consulta los créditos restantes y su uso.",
    overview: "Resumen",
    analytics: "Análisis",
    weekly: "Cuota semanal",
    weeklyDescription:
      "La cuota se restablece cada lunes en la zona horaria del sistema. El historial de uso sigue disponible tras el restablecimiento.",
    remaining: "Créditos restantes",
    used: "Usados esta semana",
    limit: "Límite semanal",
    unlimited: "Sin límite",
    percentage: "{{value}} % utilizado",
    reset: "Próximo restablecimiento: {{time}} ({{zone}})",
    updated: "Actualizado {{time}} · {{zone}}",
    range: "Intervalo de fechas",
    days: "{{count}} días",
    history: "Historial de uso de créditos",
    historyDescription:
      "Créditos diarios consumidos, desglosados por finalidad o modelo.",
    group: "Agrupar por",
    byWorkload: "Por finalidad",
    byModel: "Por modelo",
    other: "Otros",
    unknown: "Desconocido",
    ranking: "Clasificación de uso por tarea",
    rankingDescription:
      "Ordenado por los créditos usados en este periodo. Despliega una tarea para ver los detalles.",
    task: "Tarea",
    credits: "Créditos usados",
    unit: "créditos",
    unattributed: "Otros consumos o tareas eliminadas",
    openTask: "Abrir tarea",
    more: "Mostrar más",
    empty: "No hay registros en este periodo",
    tools: "Llamadas a plugins y MCP",
    toolsDescription:
      "Llamadas a herramientas finalizadas, incluidas las fallidas, agrupadas por plugin o servidor MCP. Son recuentos de actividad, no de cargos.",
    skills: "Uso de Skills",
    skillsDescription:
      "Usos por Skill. Cada Skill se cuenta una sola vez por turno.",
    messages: "Mensajes",
    messagesDescription:
      "Mensajes de usuarios en los turnos de las tareas, agrupados por modelo. No incluye respuestas de IA, mensajes en cola ni historial copiado en bifurcaciones.",
  },
} satisfies TranslationResource<
  Pick<typeof enUS, "automation" | "quotaManagement" | "personalQuota">
>
