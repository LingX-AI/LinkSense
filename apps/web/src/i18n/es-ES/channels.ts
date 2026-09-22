import type { enUS } from "../en-US"
import type { TranslationResource } from "../types"

export const channelMessages = {
  botChannels: {
    connectionError:
      "Comprueba las credenciales de la aplicación, los permisos de mensajería y la red, e inténtalo de nuevo.",
    connect: "Conectar",
    disconnect: "Desconectar {{name}}",
    settings: "Ver configuración",
    setupTitle: "Conectar {{name}}",
    save: "Guardar configuración",
    cancel: "Cancelar",
    confirmDisconnect: "Desconectar",
    retry: "Reintentar",
    account: "Cuenta de la aplicación o del bot",
    botId: "ID del bot",
    clientId: "ID de cliente de la aplicación",
    secret: "Secreto de la aplicación",
    tenantId: "ID del inquilino",
    sender: "ID del miembro autorizado",
    groups:
      "Permitir que este miembro inicie tareas mencionando al bot en grupos",
    callback: "Punto de conexión de mensajería",
    callbackHelp:
      "Configura esta URL como punto de conexión de mensajería de Azure Bot. Debe ser accesible públicamente mediante HTTPS.",
    replaceHelp:
      "Para sustituir la aplicación o su secreto, desconecta y configura de nuevo el canal.",
    disconnectHelp:
      "La desconexión detiene la recepción y respuesta de mensajes por este canal y elimina los mensajes y respuestas pendientes. Se conservan las tareas existentes de LinkSense.",
    invalid:
      "Comprueba todos los campos obligatorios. Los ID de aplicación, inquilino y miembro de Teams deben ser UUID válidos.",
    status: {
      connecting: "Conectando",
      online: "En línea",
      waiting_message: "Esperando un mensaje",
      error: "Error de conexión",
      disconnected: "Sin conexión",
    },
    description: {
      wecom:
        "Recibe mensajes directos y menciones en grupos mediante un bot inteligente de WeCom.",
      dingtalk:
        "Recibe mensajes directos y menciones en grupos mediante un bot de aplicación de DingTalk.",
      teams:
        "Recibe mensajes directos y menciones en grupos mediante un bot de Teams.",
    },
    setup: {
      wecom:
        "Crea un bot inteligente en WeCom con modo API y conexión persistente, e introduce su ID, secreto y miembro autorizado.",
      dingtalk:
        "Crea una aplicación interna en la plataforma de desarrolladores de DingTalk, activa y publica su bot Stream y concede permisos para mensajes directos y de grupo.",
      teams:
        "Crea un Azure Bot de inquilino único y activa Microsoft Teams. Tras guardar, configura su punto de conexión de mensajería en Azure e instala la aplicación del bot en Teams.",
    },
    senderHelp: {
      wecom:
        "Introduce el userid del miembro de tu directorio de WeCom. Solo este miembro podrá usar tu asistente de LinkSense.",
      dingtalk:
        "Introduce el UserId del miembro de tu organización de DingTalk. Solo este miembro podrá usar tu asistente de LinkSense.",
      teams:
        "Introduce el ID de objeto del usuario de Microsoft Entra. Solo este usuario podrá usar tu asistente de LinkSense.",
    },
  },
  channelAccess: {
    title: "Canales de mensajería",
    description:
      "Conecta y gestiona Weixin, WeCom, DingTalk, Teams, Feishu y otros canales de mensajería. El asistente de LinkSense procesa los mensajes de forma predeterminada.",
    channelsLabel: "Canales disponibles",
    weixin: {
      name: "Weixin",
      description:
        "Recibe mensajes mediante una conexión personal de Weixin y envíalos al asistente de LinkSense.",
      notConnected: "No hay ninguna cuenta de Weixin conectada",
      accountConnected: "Cuenta {{account}} conectada",
      scopeValue: "Solo la cuenta que escanea · Texto y voz transcrita",
      iconLabel: "Icono de Weixin",
      connect: "Conectar",
      reconnect: "Reconectar",
      disconnect: "Desconectar",
      successDescription: "Weixin está conectado a LinkSense.",
      connectedNotice: "Weixin conectado",
      disconnectedNotice: "Weixin desconectado",
      loginTitle: "Conectar Weixin",
      loginDescription:
        "Escanea y confirma con Weixin en tu teléfono. LinkSense solo procesa mensajes de la cuenta que realiza el escaneo.",
      generatingQr: "Generando un código QR de Weixin",
      qrCodeLabel: "Código QR de conexión de Weixin",
      verificationLabel: "Código de vinculación mostrado en Weixin",
      submitVerification: "Enviar código de vinculación",
      generateAgain: "Generar de nuevo",
      finish: "Listo",
      disconnectTitle: "¿Desconectar Weixin?",
      disconnectDescription:
        "LinkSense dejará de recibir y responder mensajes de Weixin. Se conservarán las tareas existentes de LinkSense.",
    },
    wecom: {
      name: "WeCom",
      description:
        "Recibe mensajes de miembros o clientes en WeCom y envíalos al asistente de LinkSense.",
    },
    dingtalk: {
      name: "DingTalk",
      description:
        "Recibe mensajes de la organización y notificaciones de colaboración de DingTalk y envíalos al asistente de LinkSense.",
    },
    teams: {
      name: "Microsoft Teams",
      description:
        "Recibe mensajes personales o de equipo en Teams y envíalos al asistente de LinkSense.",
      scopeValue: "Chats y mensajes de canales de Teams",
    },
    feishu: {
      name: "Feishu",
      description:
        "Recibe mensajes mediante un bot de Feishu y envíalos al asistente de LinkSense.",
      notConnected: "No se ha creado ningún bot personal de Feishu",
      scopeValue: "Solo el propietario · Mensajes directos de texto",
      iconLabel: "Icono de Feishu",
      connect: "Conectar",
      reconnect: "Actualizar acceso",
      disconnect: "Desconectar",
      successDescription:
        "Las credenciales del bot se han guardado de forma segura. Se está estableciendo la conexión de mensajes.",
      botCreated:
        "Se ha creado el bot «{{bot}}». Se está estableciendo la conexión de mensajes",
      appUpdated:
        "Se ha actualizado el acceso de la aplicación de Feishu. Se está estableciendo la conexión de mensajes.",
      connectedNotice: "Bot de Feishu creado",
      updatedNotice: "Acceso de la aplicación de Feishu actualizado",
      pendingApprovalNotice:
        "La aplicación de Feishu se ha creado y espera la aprobación del administrador",
      pendingApprovalUpdatedNotice:
        "La aplicación de Feishu se ha actualizado y espera la aprobación del administrador",
      pendingApprovalDescription:
        "No necesitas volver a escanear. LinkSense se conectará automáticamente cuando un administrador apruebe la aplicación.",
      disconnectedNotice: "Feishu desconectado",
      registrationTitle: "Crear un bot personal de Feishu",
      registrationDescription:
        "Escanea con Feishu y autoriza el acceso. LinkSense crea un bot oficial y guarda sus credenciales de forma segura, sin necesidad de configurar la consola de desarrolladores.",
      reauthorizationTitle: "Actualizar acceso del bot de Feishu",
      reauthorizationDescription:
        "Escanea con Feishu y autoriza el acceso adicional a mensajes. LinkSense actualiza el bot actual y configura su conexión sin crear un bot duplicado.",
      generatingQr: "Solicitando a Feishu un código QR de creación",
      qrCodeLabel: "Código QR para crear el bot de Feishu",
      generateAgain: "Generar de nuevo",
      recoverExisting: "Conectar el bot creado",
      createWhenMissing: "¿Aplicación eliminada? Crear una nueva",
      finish: "Listo",
      disconnectTitle: "¿Desconectar Feishu?",
      disconnectDescription:
        "LinkSense dejará de recibir y responder mensajes de Feishu. Se conservarán el bot oficial y las tareas existentes de LinkSense.",
      registrationStatus: {
        generating_qr: "Generando código QR",
        waiting_scan: "Escanea con Feishu y autoriza el acceso",
        pending_approval:
          "Aplicación creada, pendiente de aprobación del administrador",
        pending_approval_update:
          "Aplicación actualizada, pendiente de aprobación del administrador",
        connected: "Bot creado",
        updated: "Aplicación de Feishu actualizada",
        expired: "El código QR ha caducado",
        failed:
          "Es posible que el bot ya exista, pero la conexión no se completó. Escanea de nuevo y selecciona el bot que acabas de crear",
        update_failed:
          "La actualización de la aplicación de Feishu no se completó. Escanea de nuevo para reintentarlo",
      },
    },
    scopeLabel: "Ámbito de mensajes",
    entryLabel: "Método de acceso",
    weixinEntryValue: "Conexión por QR",
    upcomingEntryValue: "Pendiente de lanzamiento",
    unavailableAction: "Todavía no disponible",
    status: {
      available: "Disponible",
      comingSoon: "Próximamente",
      online: "En línea",
      connecting: "Conectando",
      pending_approval: "Pendiente de aprobación del administrador",
      error: "Error de conexión",
      reauthorization_required: "Es necesario reconectar",
    },
    loginStatus: {
      waiting_scan: "Esperando el escaneo del código QR",
      scanned: "Escaneado. Confirma la conexión en Weixin",
      verification_required:
        "Introduce el código de vinculación mostrado en Weixin",
      connected: "Conectado",
      expired: "El código QR ha caducado",
      failed: "La conexión no se completó. Genera un nuevo código QR",
    },
  },
  mcp: {
    title: "Servidores MCP",
    description:
      "Conecta y gestiona servidores MCP personales Streamable HTTP y STDIO. Los elementos activados se incorporan automáticamente a las tareas nuevas.",
    add: "Añadir servidor",
    empty: "No hay servidores MCP personales configurados",
    emptyDescription:
      "Añade un punto de conexión Streamable HTTP remoto o un servidor MCP STDIO alojado en un contenedor.",
    createTitle: "Conectar un MCP personalizado",
    editTitle: "Editar servidor MCP",
    editorDescription:
      "MCP es independiente de los plugins. Las configuraciones activadas se incorporan automáticamente a tus tareas nuevas.",
    transportLabel: "Tipo de conexión",
    transport: { streamable_http: "HTTP", stdio: "STDIO" },
    name: "Nombre",
    url: "URL del servidor",
    urlHint:
      "Se admiten puntos de conexión MCP Streamable HTTP mediante HTTP y HTTPS.",
    stdioConfiguration: "Configuración STDIO (JSON)",
    stdioConfigurationHint:
      "Introduce command, args y env directamente, o pega un objeto JSON mcpServers con exactamente un servidor. Los valores de env se cifran; npx -y se convierte de forma segura en pnpm dlx gestionado dentro del contenedor de la tarea.",
    stdioConfigurationEditHint:
      "Los valores de env guardados nunca se muestran. Omite env para conservarlos, proporciona env para sustituirlos o usa un objeto vacío para borrarlos.",
    stdioConfigurationInvalid:
      "Introduce un JSON STDIO válido de un solo servidor. command es obligatorio, args debe ser una lista de cadenas y env un objeto de cadenas.",
    currentEnvironmentKeys: "Variables actuales: {{keys}}",
    environmentCount: "{{count}} variables de entorno",
    authentication: "Autenticación",
    apiKeyHeader: "Cabecera de clave API",
    credential: "Credencial",
    credentialHint:
      "La credencial se almacena cifrada y no vuelve a mostrarse.",
    keepCredentialHint:
      "Deja el campo vacío para conservar la credencial actual.",
    startupTimeout: "Tiempo de espera de inicio (segundos)",
    toolTimeout: "Tiempo de espera de herramientas (segundos)",
    httpWarningTitle: "Las conexiones HTTP no son seguras",
    httpWarningDescription:
      "Los tokens Bearer, claves API, argumentos y resultados de herramientas se transmiten sin cifrar y podrían leerse o modificarse durante el tránsito.",
    httpAcknowledgement: "Entiendo y acepto los riesgos de HTTP sin cifrar.",
    testConnection: "Probar conexión",
    testing: "Probando {{name}}",
    testSucceeded:
      "Conexión establecida con {{serverName}}; se han encontrado {{count}} herramientas.",
    testStatus: {
      succeeded: "Prueba superada",
      failed: "Prueba fallida",
      untested: "Sin probar",
    },
    testStatusLabel: "{{name}}: {{status}}",
    auth: {
      none: "Sin autenticación",
      bearer: "Token Bearer",
      api_key: "Clave API",
    },
    toggle: "Activar o desactivar {{name}}",
    saved: "Servidor MCP guardado.",
    deleted: "Servidor MCP eliminado.",
    deleteTitle: "¿Eliminar este servidor MCP?",
    deleteDescription:
      "Se eliminarán permanentemente la configuración del servidor, la credencial cifrada y las variables de entorno cifradas. Las tareas nuevas dejarán de conectarse a él.",
  },
} satisfies TranslationResource<
  Pick<typeof enUS, "botChannels" | "channelAccess" | "mcp">
>
