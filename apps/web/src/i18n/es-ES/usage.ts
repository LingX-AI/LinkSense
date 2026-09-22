import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const usageMessages = {
  usage: {
    title: "Análisis de uso",
    description:
      "Consulta tareas, turnos, uso de tokens de modelos y costes globales, por aplicación, por pertenencia actual a grupos y por usuario.",
    sectionLabel: "Análisis de uso y facturación",
    sections: { analytics: "Análisis de uso", billing: "Facturación" },
    billing: {
      pageDescription:
        "Consulta los extractos de cada mes natural resumidos por modelo, previsualízalos en línea y expórtalos a PDF.",
      period: "Periodo de facturación",
      total: "Total del extracto",
      modelCount: "Modelos",
      generatedAt: "Generado",
      current: {
        title: "Periodo de facturación actual",
        description:
          "El extracto se genera automáticamente al finalizar el mes natural.",
        open: "En curso",
        expectedGeneration: "Generación prevista",
      },
      history: {
        title: "Extractos mensuales",
        description:
          "Copias mensuales inmutables del uso y los cargos de los modelos.",
        empty: "Todavía no se han generado extractos mensuales.",
      },
      detail: {
        title: "Detalles del extracto",
        description: "Cargando detalles del extracto…",
      },
      columns: {
        model: "Modelo",
        input: "Tokens de entrada",
        cached: "Tokens en caché",
        output: "Tokens de salida",
        totalTokens: "Tokens totales",
        pricing: "Tarifas",
        amount: "Importe",
      },
      uniformPricing: "Tarifa fija",
      mixedPricing: "Varias tarifas",
      preview: { action: "Ver en línea" },
      export: {
        action: "Exportar PDF",
        success: "Extracto exportado a PDF.",
        filename: "{{statementNumber}}-extracto.pdf",
      },
      pdf: {
        statement: "Extracto mensual",
        accountStatement: "Extracto de la cuenta de uso de modelos",
        statementNumber: "Número de extracto",
        billingPeriod: "Periodo de facturación",
        generatedAt: "Fecha de generación",
        currency: "Moneda",
        pricePerMillion: "Tarifa por 1 millón de tokens",
        inputShort: "Entrada",
        cachedShort: "Caché",
        outputShort: "Salida",
        totalAmount: "Total del extracto",
        unpricedNote:
          "{{tokens}} tokens no tienen un precio registrado y se excluyen del importe a pagar.",
        page: "Página {{current}} de {{total}}",
        footer:
          "Generado automáticamente por LinkSense con los precios registrados en el momento de cada llamada.",
      },
    },
    rangeLabel: "Periodo del informe",
    ranges: {
      all: "Todo el historial",
      sevenDays: "Últimos 7 días",
      thirtyDays: "Últimos 30 días",
      custom: "Intervalo personalizado",
    },
    customRange: {
      dateFrom: "Fecha de inicio",
      dateTo: "Fecha de fin",
      selectDate: "Seleccionar fecha",
      clearDate: "Borrar fecha",
    },
    export: {
      action: "Exportar Excel",
      exporting: "Exportando…",
      success: "Análisis de uso exportado.",
      filename: "{{productPrefix}}-analisis-de-uso-{{date}}.xlsx",
    },
    tasks: "Tareas",
    turns: "Turnos",
    modelCalls: "Llamadas a modelos",
    totalTokens: "Tokens totales",
    totalCost: "Coste total",
    inputCost: "Coste de entrada",
    cachedInputCost: "Coste de entrada en caché",
    outputCost: "Coste de salida",
    sort: {
      asc: "Ordenar por {{field}} de forma ascendente",
      desc: "Ordenar por {{field}} de forma descendente",
    },
    tasksHint:
      "Tareas creadas durante el periodo seleccionado; su eliminación posterior no modifica el historial",
    turnsHint:
      "Turnos reales creados durante el periodo seleccionado; su eliminación posterior no modifica el historial",
    tokensHint:
      "Incluye respuestas, representaciones vectoriales de documentos y consultas, y reordenación de resultados",
    costHint:
      "Se acumula a partir del precio registrado para cada llamada; los cambios de precio posteriores no modifican el historial",
    unpricedTokensHint:
      "{{tokens}} tokens no tienen un precio registrado y se excluyen del coste",
    unpricedShort: "{{tokens}} sin precio",
    trend: {
      title: "Evolución del uso de tokens",
      description:
        "Tokens totales del periodo seleccionado, agrupados {{granularity}} y apilados por finalidad del modelo.",
      empty: "No hay uso de tokens en el periodo seleccionado.",
      ariaLabel: "Evolución del uso de tokens en el periodo seleccionado",
      granularity: { day: "por día", month: "por mes", year: "por año" },
    },
    costTrend: {
      title: "Evolución de costes",
      description:
        "Costes históricos registrados en el momento de cada llamada, agrupados {{granularity}} y apilados por finalidad del modelo.",
      empty: "No hay costes de modelos en el periodo seleccionado.",
      ariaLabel: "Evolución del coste de modelos en el periodo seleccionado",
    },
    tabsLabel: "Dimensiones del análisis de uso",
    tabs: {
      models: "Por modelo",
      workloads: "Por finalidad",
      applications: "Por aplicación",
      groups: "Por grupo",
      users: "Por usuario",
    },
    modelsTitle: "Uso de todos los modelos",
    modelsDescription:
      "Llamadas, composición de tokens y costes de cada modelo de generación, representación vectorial y reordenación.",
    tableCostUnit: "Unidad de coste: CNY (yuanes).",
    modelsEmpty: "No hay uso de modelos en el periodo seleccionado.",
    workloadsTitle: "Uso por finalidad del modelo",
    workloadsDescription:
      "Separa respuestas de IA, nombres automáticos de tareas, generación de memoria, representaciones vectoriales de documentos y consultas, y reordenación de resultados. El uso se marca como estimado cuando el proveedor no lo comunica.",
    workloadsEmpty:
      "No hay uso por finalidad del modelo en el periodo seleccionado.",
    applicationsTitle: "Uso de aplicaciones",
    applicationsDescription:
      "Resume tareas, turnos, llamadas a modelos, tokens y costes según la aplicación vinculada al crear cada tarea. El uso fuera de una aplicación se muestra por separado.",
    applicationsEmpty: "No hay uso de aplicaciones en el periodo seleccionado.",
    applicationDetailDescription:
      "Uso de modelos de las tareas vinculadas a esta aplicación",
    application: "Aplicación",
    unattributedApplication: "Sin vincular a una aplicación",
    workload: "Finalidad del modelo",
    workloads: {
      assistant_response: "Respuestas de IA",
      memory_generation: "Generación de memoria",
      task_title_generation: "Nombres automáticos de tareas",
      document_embedding: "Representaciones vectoriales de documentos",
      query_embedding: "Representaciones vectoriales de consultas",
      rerank: "Reordenación de resultados de búsqueda",
      image_generation: "Generación de imágenes",
    },
    modelKinds: {
      generation: "Modelo de generación",
      embedding: "Modelo de representación vectorial",
      rerank: "Modelo de reordenación",
      image: "Modelo de imágenes",
    },
    measurementMethod: "Método de medición",
    measurementMethods: {
      provider: "Comunicado por el proveedor",
      estimated: "Estimado localmente",
    },
    groupsTitle: "Uso por grupo",
    groupsDescription:
      "Se calcula según los miembros activos actuales. Un usuario puede aparecer en varios grupos, por lo que no se deben sumar las filas de los grupos para obtener el total global.",
    currentMembership: "Miembros actuales",
    groupDetailDescription: "Uso de modelos de {{count}} miembros actuales",
    usersTitle: "Uso por usuario",
    usersDescription:
      "Tareas, turnos y uso de tokens de modelos de cada usuario.",
    searchUsers: "Buscar usuarios por nombre o correo",
    usersEmpty: "No hay usuarios coincidentes.",
    modelBreakdown: "Desglose por modelo",
    model: "Modelo",
    inputTokens: "Tokens de entrada",
    cachedInputTokens: "Tokens de entrada en caché",
    outputTokens: "Tokens de salida",
    reasoningOutputTokens: "Tokens de salida de razonamiento",
    group: "Grupo",
    members: "Miembros",
    ungrouped: "Usuarios sin grupo",
    unknownModel: "Modelo desconocido",
    noSelection: "No hay datos disponibles",
    tokenCompositionNote:
      "Los tokens de entrada en caché son parte de los tokens de entrada, y los de salida de razonamiento son parte de los de salida; no se suman de nuevo al total. Los recuentos de tareas y turnos usan registros de creación inmutables, por lo que eliminar tareas posteriormente no reduce el historial.",
    costCompositionNote:
      "Los costes se almacenan y agregan con toda su precisión y se muestran con dos decimales. Las diferencias de redondeo se distribuyen proporcionalmente dentro de cada total para que los detalles mostrados sumen el total mostrado. El coste de entrada normal excluye la entrada en caché, que tiene su propia tarifa. Los precios y costes se fijan al registrar cada llamada; los cambios de precio posteriores nunca recalculan el historial.",
  },
} satisfies TranslationResource<Pick<typeof enUS, "usage">>
