export const applicationSetupPtBR = {
  title: "Guia de configuração do aplicativo",
  description:
    "Configure os recursos necessários para começar a usar {{name}}.",
  progress: "{{completed}} / {{total}} prontos",
  required: "Obrigatório",
  unnamed: "{{type}} {{number}}",
  selected: "Recurso atual: {{name}}",
  choose: "Escolha um recurso próprio",
  chooseNamed: "Escolha um recurso próprio para {{name}}",
  search: "Buscar recursos disponíveis",
  manage: "Criar ou gerenciar recursos",
  credentials: "Configurar credenciais pessoais",
  modelDefault: "Usar meu modelo preferido",
  modelHelp:
    "Escolha um modelo disponível para o aplicativo ou use seu modelo preferido. Entre em contato com o administrador se não houver modelos disponíveis.",
  check: "Verificar novamente",
  later: "Continuar depois",
  complete: "Salvar e concluir",
  use: "Começar a usar",
  completed: "A configuração do aplicativo foi concluída.",
  ready:
    "Os recursos necessários estão prontos. Você já pode usar o aplicativo.",
  pending:
    "Configure os itens obrigatórios abaixo. Cada seleção é salva para você continuar depois.",
  activate:
    "Os recursos necessários estão prontos. Conclua a configuração para aplicar estas definições ao aplicativo.",
  note: "Estas verificações refletem a configuração atual de recursos e autorizações. O acesso real a serviços externos também depende da disponibilidade do serviço e das permissões da conta.",
  newTab:
    "As páginas de configuração abrem em outra aba. Ao voltar, o status será atualizado automaticamente; você também pode selecionar “Verificar novamente”.",
  types: {
    plugin: "Plugin",
    skill: "Skill",
    knowledge_base: "Base de conhecimento",
    mcp_server: "Conexão MCP",
    model: "Modelo",
  },
  statuses: {
    configured: "Pronto",
    unconfigured: "Configuração pendente",
    unavailable: "Indisponível",
    credentials_required: "Credenciais necessárias",
  },
  purposes: {
    plugin:
      "Este plugin permite que o aplicativo realize ações. Conclua as autorizações necessárias com as credenciais da sua própria conta.",
    skill:
      "Este Skill fornece instruções e métodos para realizar as tarefas do aplicativo.",
    knowledge_base:
      "Forneça os materiais que o aplicativo precisa consultar. Escolha uma base de conhecimento pessoal com o conteúdo adequado.",
    mcp_server:
      "Permita que o aplicativo acesse os serviços externos ou as ferramentas necessárias. Escolha a conexão correspondente que você configurou.",
  },
} as const
