export const applicationSetupEsES = {
  title: "Guía de configuración de la aplicación",
  description:
    "Configura las capacidades que necesita {{name}} para empezar a usarla.",
  progress: "{{completed}} / {{total}} listas",
  required: "Obligatorio",
  unnamed: "{{type}} {{number}}",
  selected: "Recurso actual: {{name}}",
  choose: "Elige un recurso propio",
  chooseNamed: "Elige un recurso propio para {{name}}",
  search: "Buscar recursos disponibles",
  manage: "Crear o gestionar recursos",
  credentials: "Configurar credenciales personales",
  modelDefault: "Usar mi modelo preferido",
  modelHelp:
    "Elige un modelo disponible para la aplicación o usa tu modelo preferido. Contacta con el administrador si no hay modelos disponibles.",
  check: "Volver a comprobar",
  later: "Continuar después",
  complete: "Guardar y finalizar",
  use: "Empezar a usar",
  completed: "La configuración de la aplicación está completa.",
  ready:
    "Las capacidades necesarias están listas. Ya puedes usar la aplicación.",
  pending:
    "Completa los elementos obligatorios. Cada selección se guarda para que puedas continuar después.",
  activate:
    "Las capacidades necesarias están listas. Finaliza la configuración para aplicar estos ajustes a la aplicación.",
  note: "Estas comprobaciones reflejan la configuración actual de recursos y autorizaciones. El acceso real a servicios externos también depende de su disponibilidad y de los permisos de la cuenta.",
  newTab:
    "Las páginas de configuración se abren en otra pestaña. Al volver, el estado se actualizará automáticamente; también puedes seleccionar «Volver a comprobar».",
  types: {
    plugin: "Plugin",
    skill: "Skill",
    knowledge_base: "Base de conocimiento",
    mcp_server: "Conexión MCP",
    model: "Modelo",
  },
  statuses: {
    configured: "Lista",
    unconfigured: "Pendiente de configurar",
    unavailable: "No disponible",
    credentials_required: "Faltan credenciales",
  },
  purposes: {
    plugin:
      "Este plugin permite que la aplicación realice acciones. Completa las autorizaciones necesarias con las credenciales de tu propia cuenta.",
    skill:
      "Este Skill aporta instrucciones y métodos para realizar las tareas de la aplicación.",
    knowledge_base:
      "Proporciona los documentos que la aplicación necesita consultar. Elige una base de conocimiento personal con el contenido adecuado.",
    mcp_server:
      "Permite que la aplicación acceda al servicio externo o a las herramientas necesarias. Elige la conexión correspondiente que hayas configurado.",
  },
} as const
