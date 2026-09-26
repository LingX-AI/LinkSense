import { connectionMessages } from "@/features/connections/messages"
import { samlptBR } from "@/features/saml/messages"
import type { enUS } from "@/i18n/en-US"
import type { TranslationResource } from "@/i18n/types"

export const ptBR = {
  connections: connectionMessages["pt-BR"],
  saml: samlptBR,
  social: {
    disableHelp:
      "Desativar este provedor impede que qualquer pessoa entre por ele. Primeiro, verifique se os usuários afetados têm outro método de acesso.",
    setupPassword: "Definir ou redefinir uma senha por e-mail",
    title: "Contas de terceiros",
    configure: "Configurar",
    configureProvider: "Configurar {{provider}}",
    providerDescription: "Cadastre-se ou entre com {{provider}}.",
    statusEnabled: "Ativado",
    statusDisabled: "Desativado",
    statusNotConfigured: "Não configurado",
    description:
      "Cadastre-se ou entre com contas do Google, Apple e outros provedores. Com o cadastro aberto, novos usuários podem começar após a verificação do e-mail, sem ativação por um administrador. Usuários existentes devem entrar primeiro para vincular uma conta.",
    providers: {
      google: "Google",
      apple: "Apple",
      microsoft: "Conta pessoal Microsoft",
      facebook: "Facebook",
      github: "GitHub",
    },
    continueWith: "Continuar com {{provider}}",
    available: "Ou use uma conta social",
    enabled: "Permitir o acesso com este provedor",
    clientId: "ID do aplicativo",
    clientSecret: "Segredo do aplicativo",
    privateKey: "Chave privada da Apple (conteúdo do arquivo .p8)",
    teamId: "ID da equipe Apple",
    keyId: "ID da chave Apple",
    graphVersion: "Versão da API do Facebook",
    redirectUri: "URL de retorno da autorização",
    redirectHelp:
      "Copie este endereço exatamente como aparece para o console de desenvolvedor do provedor.",
    secretSaved: "Salvo; deixe em branco para manter",
    secretEmpty: "Insira o segredo fornecido pela plataforma",
    saved: "Configurações salvas",
    guide: "Abrir console de desenvolvedor",
    credentialsHelp:
      "Os segredos são usados apenas para verificar o acesso e não são exibidos após serem salvos. Teste com uma conta de teste antes de disponibilizar.",
    microsoftHelp:
      "Escolha um tipo de conta de aplicativo que permita contas pessoais da Microsoft. Para contas corporativas, use o SSO corporativo.",
    appleHelp:
      "Use seu Services ID como ID do aplicativo, com o ID da equipe, ID da chave e chave privada correspondentes. É necessário um site HTTPS.",
    facebookHelp:
      "Ative o Facebook Login e informe a versão da API selecionada no console de desenvolvedor (vXX.0).",
    googleHelp:
      "Crie um cliente OAuth do tipo aplicativo da Web e configure sua URL de retorno da autorização.",
    githubHelp:
      "Crie um OAuth App nas configurações de desenvolvedor do GitHub, informe o Client ID e o Client Secret e copie este endereço para Authorization callback URL.",
    bindings: "Contas sociais vinculadas",
    bindingsHelp:
      "Vincule uma conta para acessar seu perfil existente. Contas com e-mails iguais nunca são unificadas automaticamente.",
    link: "Vincular {{provider}}",
    unlink: "Desvincular",
    linked: "Vinculada",
    unavailable: "Nenhum provedor está disponível para vinculação no momento.",
    unlinkTitle: "Desvincular esta conta social?",
    unlinkDescription:
      "Você precisará entrar novamente. Verifique se tem uma senha ou outro método de acesso disponível.",
    verifyTitle: "Verifique seu e-mail",
    verifyDescription:
      "Verifique o e-mail usado para notificações da conta e recuperação de senha. Esta etapa só é necessária no primeiro cadastro.",
    sendEmail: "Enviar e-mail de verificação",
    emailSent:
      "E-mail enviado. Abra o link neste navegador em até 15 minutos para concluir o cadastro.",
    finish: "Verificar e concluir cadastro",
    callbackTitle: "Concluir login com conta social",
    returnSettings: "Voltar à segurança da conta",
    errors: {
      failed:
        "A autorização não foi concluída ou expirou. Volte à tela de acesso e tente novamente.",
      disabled:
        "Esta conta foi desativada. Entre em contato com um administrador.",
      email_exists:
        "Uma conta já usa este e-mail. Entre pelo método existente e vincule a conta social nas configurações de segurança da conta.",
      registration_disabled:
        "O cadastro está fechado no momento. Se já tiver uma conta, entre primeiro e vincule esta conta social.",
      last_method:
        "Primeiro, defina uma senha ou vincule outro método de acesso disponível.",
      already_linked:
        "Esta conta social já está vinculada, ou você vinculou outra conta deste provedor.",
      configuration_changed:
        "As configurações de acesso mudaram. Inicie o acesso novamente.",
    },
  },
  personalQuota: {
    title: "Uso de créditos",
    description: "Consulte seus créditos restantes e seu consumo.",
    overview: "Visão geral",
    analytics: "Análise",
    weekly: "Cota semanal",
    weeklyDescription:
      "Sua cota é renovada toda segunda-feira, no fuso horário do sistema. O histórico de uso continua disponível após a renovação.",
    remaining: "Créditos restantes",
    used: "Usados nesta semana",
    limit: "Limite semanal",
    unlimited: "Ilimitado",
    percentage: "{{value}}% usados",
    reset: "Próxima renovação: {{time}} ({{zone}})",
    updated: "Atualizado {{time}} · {{zone}}",
    range: "Período",
    days: "{{count}} dias",
    history: "Histórico de uso de créditos",
    historyDescription:
      "Créditos cobrados por dia, separados por tipo de atividade ou modelo.",
    group: "Agrupar por",
    byWorkload: "Por tipo de atividade",
    byModel: "Por modelo",
    other: "Outro",
    unknown: "Desconhecido",
    ranking: "Classificação de uso por tarefa",
    rankingDescription:
      "Ordenada pelos créditos usados neste período. Expanda uma tarefa para ver os detalhes.",
    task: "Tarefa",
    credits: "Créditos usados",
    unit: "créditos",
    unattributed: "Outros usos ou tarefas excluídas",
    openTask: "Abrir tarefa",
    more: "Mostrar mais",
    empty: "Nenhum registro neste período",
    tools: "Chamadas de plugins e MCP",
    toolsDescription:
      "Chamadas de ferramentas concluídas, incluindo falhas, agrupadas por plugin ou servidor MCP. São contagens de atividades, não cobranças.",
    skills: "Uso de habilidades",
    skillsDescription:
      "Usos por habilidade. A mesma habilidade é contada uma vez por turno.",
    messages: "Mensagens",
    messagesDescription:
      "Mensagens dos usuários nos turnos das tarefas, agrupadas por modelo. Exclui respostas da IA, mensagens na fila e histórico copiado para ramificações.",
  },
  webSites: {
    title: "Meus sites",
    description:
      "Gerencie seus sites publicados, atualize seu conteúdo ou retire-os do ar a qualquer momento.",
    share: "Publicar como site",
    dialog: {
      share: "Publicar como site",
      edit: "Editar site",
      publish: "Publicar atualização",
      delete: "Excluir site",
    },
    shareDescription:
      "Qualquer pessoa com o link poderá visitar este site após a publicação.",
    deleteDescription:
      "O site e suas versões publicadas serão excluídos permanentemente. Qualquer pessoa poderá reutilizar o endereço. A tarefa e os arquivos originais serão mantidos.",
    name: "Nome do site",
    summary: "Descrição",
    slug: "Nome do link",
    slugPlaceholder: "Deixe em branco para gerar automaticamente",
    slugHelp: "Use de 3 a 80 letras, números ou hífens.",
    slugChanged: "Esta alteração desativa o link antigo imediatamente.",
    url: "Link do site",
    publishMode: "Modo de publicação",
    updateExisting: "Atualizar site existente",
    existingSite: "Selecionar site",
    selectExistingSite: "Escolha um site para atualizar",
    currentTask: "Desta tarefa",
    noUpdateTargets:
      "Nenhum site disponível para atualização. Escolha Novo site para começar.",
    updateDescription:
      "Atualize o site com esta página, mantendo o link existente.",
    updateDisabledDescription:
      "O site continuará fora do ar após esta atualização. Você pode republicá-lo em Meus sites.",
    updatedDescription:
      "O conteúdo do site foi atualizado. O link existente permanece o mesmo.",
    updateSite: "Atualizar site",
    newSite: "Novo site",
    sourceFile: "Página da Web",
    latestSource: "Mais recente: {{name}} · {{date}}",
    currentSource: "Publicado atualmente: {{name}} · {{date}}",
    datedSource: "{{name}} · {{date}}",
    selectSource: "Escolha uma página da Web desta tarefa",
    noSources:
      "Nenhuma página da Web disponível. Primeiro, gere uma nova versão na tarefa original.",
    alreadyPublishedTitle: "Esta página já tem um site",
    alreadyPublishedDescription:
      "Esta página está vinculada a um site. Copie o link atual ou gerencie o site em Meus sites.",
    alreadyDisabledTitle: "Este site não está publicado",
    alreadyDisabledDescription:
      "O site vinculado a esta página não está publicado. Publique-o novamente em Meus sites.",
    updateAnotherSite: "Atualizar outro site",
    publishedTitle: "Site publicado",
    updatedTitle: "Site atualizado",
    publishedDescription:
      "Copie o link para compartilhar seu site. Gerencie-o depois em Meus sites.",
    stillDisabled:
      "O conteúdo foi atualizado, mas o site continua fora do ar. Republique-o em Meus sites.",
    copy: "Copiar link",
    copied: "Link copiado",
    copyFailed: "Não foi possível copiar o link. Copie-o manualmente.",
    done: "Concluído",
    cancel: "Cancelar",
    delete: "Excluir site",
    save: "Salvar",
    publish: "Publicar site",
    search: "Pesquisar nomes ou links de sites",
    filter: "Estado da publicação",
    status: {
      all: "Todos os estados",
      published: "Publicado",
      disabled: "Fora do ar",
    },
    empty: "Nenhum site publicado ainda",
    emptyDescription:
      "Abra uma página da Web gerada em uma tarefa e selecione Publicar como site para gerenciá-la aqui.",
    noResults: "Nenhum site correspondente",
    sourceTask: "Origem: {{title}}",
    sourceDeleted: "Tarefa de origem excluída",
    publishedAt: "Publicado em {{date}}",
    resources: "{{count}} arquivos · {{size}}",
    visit: "Visitar",
    copyNamed: "Copiar link de {{name}}",
    actions: "Gerenciar {{name}}",
    edit: "Editar",
    update: "Publicar atualização",
    disable: "Retirar do ar",
    enable: "Republicar",
    download: "Baixar site",
    loadMore: "Carregar mais",
    invalidSlug:
      "Insira de 3 a 80 letras, números ou hífens, sem hífen no início ou no fim.",
  },
  clientUpdate: {
    title: "Sistema atualizado",
    description:
      "Uma atualização do sistema está disponível. Atualize a página para continuar.",
    update: "Atualizar página",
    updating: "Verificando atualização…",
    later: "Atualizar depois",
    forceRefreshTitle: "Como forçar a atualização",
    windowsLabel: "Windows / Linux",
    windowsHelp: "Ctrl + Shift + R",
    macLabel: "Mac",
    macHelp: "⌘ + Shift + R ou ⌘ + ⌥ + R",
    mobileLabel: "Celular / tablet",
    mobileHelp: "Reabra a página ou limpe o cache deste site.",
    notReady:
      "Ainda não foi possível concluir a atualização. Tente novamente em breve e verifique sua conexão. A página atual foi mantida aberta.",
    loadFailed:
      "Não foi possível carregar esta página. Verifique sua conexão e tente novamente. Se houver um aviso de atualização, atualize a página primeiro.",
  },
  common: {
    poweredBy: "Powered by",
    poweredByLinkSense: "Tecnologia de LinkSense",
    dateRange: {
      label: "Intervalo de datas",
      createdLabel: "Intervalo de criação",
      lastRunLabel: "Intervalo da última execução",
      value: "{{from}} – {{to}}",
      clear: "Limpar {{label}}",
      selectStart: "Selecione a data inicial e depois a final.",
      selectEnd: "Início: {{date}}. Selecione a data final.",
    },
    close: "Fechar",
    notifications: "Notificações",
    cancel: "Cancelar",
    save: "Salvar",
    saving: "Salvando…",
    create: "Criar",
    update: "Atualizar",
    delete: "Excluir",
    edit: "Editar",
    confirm: "Confirmar",
    gotIt: "Entendi",
    retry: "Tentar novamente",
    loadMore: "Carregar mais",
    continue: "Continuar",
    search: "Pesquisar",
    loading: "Carregando…",
    pageLoading: "Carregando…",
    actions: "Ações",
    status: "Status",
    name: "Nome",
    description: "Descrição",
    view: "Visualizar",
    email: "E-mail",
    type: "Tipo",
    scope: "Escopo",
    createdAt: "Criado em",
    updatedAt: "Atualizado em",
    language: "Idioma",
    chinese: "简体中文",
    english: "English",
    spanish: "Español",
    portuguese: "Português (Brasil)",
    french: "Français",
    japanese: "日本語",
    settings: "Configurações",
    signOut: "Sair",
    empty: "Nenhum dado",
    notAvailable: "Indisponível",
    back: "Voltar",
    details: "Detalhes",
    more: "Mais ações",
    moreActionsNamed: "Mais ações para {{name}}",
    enabled: "Ativado",
    disabled: "Desativado",
    active: "Ativo",
    system: "Sistema",
    user: "Usuário",
    admin: "Administrador",
    upload: "Enviar",
    download: "Baixar",
    previous: "Anterior",
    next: "Próximo",
    refresh: "Atualizar",
    all: "Todos",
    select: "Selecionar",
    notFound: "Página não encontrada.",
    configured: "Configurado",
    notConfigured: "Não configurado",
    enable: "Ativar",
    disable: "Desativar",
    yes: "Sim",
    no: "Não",
    copy: "Copiar",
    copied: "Copiado.",
    copyNamed: "Copiar {{name}}",
    clear: "Limpar",
  },
  reasoningEffort: {
    minimal: "Mínimo",
    low: "Leve",
    medium: "Médio",
    high: "Alto",
    xhigh: "Muito alto",
    max: "Máximo",
    ultra: "Ultra",
  },
  embed: {
    defaultDescription:
      "Converse com este aplicativo e use todos os recursos de negócio configurados.",
    waitingForHost: "Aguardando o sistema de origem fornecer acesso…",
    authenticating: "Estabelecendo uma sessão segura…",
    startingPublicSession: "Criando uma sessão de acesso público…",
    reconnecting: "Reconectando…",
    starterQuestionsLabel: "Perguntas sugeridas",
    history: "Lista de tarefas",
    historyEmpty: "Nenhuma tarefa",
    newConversation: "Nova tarefa",
    deleteTaskLabel: "Excluir tarefa “{{name}}”",
    deleteTaskTitle: "Excluir tarefa permanentemente?",
    deleteTaskDescription:
      "As mensagens, os anexos e os resultados de “{{name}}” serão excluídos permanentemente e não poderão ser recuperados.",
    deleteTaskConfirm: "Excluir permanentemente",
    deletingTask: "Excluindo…",
    inputLabel: "Enviar uma mensagem ao aplicativo",
    inputPlaceholder: "Digite uma mensagem e pressione Enter para enviar",
    attachFiles: "Anexar arquivos",
    removeAttachment: "Remover anexo {{name}}",
    uploading: "Enviando…",
    send: "Enviar mensagem",
    stop: "Interromper geração",
    errors: {
      systemUnavailable:
        "O status do sistema está temporariamente indisponível. Verifique sua conexão e tente novamente.",
      requestFailed: "Não foi possível atualizar a sessão. Tente novamente.",
      authenticationFailed:
        "Não foi possível estabelecer a sessão externa. Autentique-se novamente pelo sistema de origem.",
      hostAuthenticationFailed:
        "A página externa não conseguiu verificar o acesso. Confira o ID e o segredo do aplicativo e tente novamente.",
      publicSessionFailed:
        "Não foi possível criar a sessão de acesso público. Confirme se o aplicativo está configurado para não exigir autenticação.",
      submitFailed: "Não foi possível enviar a mensagem. Tente novamente.",
      interruptFailed:
        "Não foi possível interromper a geração. Tente novamente.",
      uploadFailed:
        "Não foi possível enviar o anexo. Verifique-o e tente novamente.",
      removeAttachmentFailed:
        "Não foi possível remover o anexo. Tente novamente.",
      downloadFailed: "Não foi possível baixar o arquivo. Tente novamente.",
      answerFailed: "Não foi possível enviar a resposta. Tente novamente.",
      switchConversationFailed:
        "Não foi possível abrir a tarefa anterior. Tente novamente.",
      createConversationFailed:
        "Não foi possível criar uma nova tarefa. Tente novamente.",
      deleteTaskFailed:
        "Não foi possível excluir a tarefa permanentemente. Tente novamente.",
    },
  },
  nav: {
    navigationLabel: "Navegação do {{productName}}",
    newConversation: "Nova tarefa",
    automations: "Automações",
    conversations: "Tarefas",
    archived: "Tarefas arquivadas",
    capabilities: "Central de plugins",
    knowledgeBases: "Biblioteca de recursos",
    pinned: "Fixados",
    projects: "Projetos",
    recent: "Recentes",
    administration: "Administração",
    usage: "Análise de uso",
    users: "Usuários",
    roles: "Funções e permissões",
    groups: "Grupos de usuários",
    adminCapabilities: "Central de plugins",
    adminKnowledgeBases: "Bases de conhecimento",
    adminKnowledgeSources: "Fontes de conhecimento",
    audit: "Logs de auditoria",
    feedback: "Feedback dos usuários",
    usersAndGroups: "Usuários e grupos",
    productSettings: "Configurações do sistema",
    health: "Saúde do sistema",
    open: "Abrir navegação",
    collapseSidebar: "Recolher barra lateral",
    expandSidebar: "Expandir barra lateral",
    resizeSidebar: "Redimensionar barra lateral",
    helpCenter: "Central de ajuda",
    helpCenterNewTab: "Abrir a Central de ajuda em uma nova aba",
    automationNotifications: "Notificações de automações",
    automationNotificationsUnread:
      "Notificações de automações, com uma tarefa concluída não lida",
    automationTask: "Tarefa de automação",
    unreadCompletion: "Tarefa concluída e ainda não visualizada",
    unreadFailure: "Tarefa com falha e ainda não visualizada",
    creditQuotaRemainingTitle: "Créditos",
    creditQuotaRemaining: "{{weekly}}",
    creditQuotaUnlimited: "Ilimitado",
  },
  support: {
    menuLabel: "Feedback e ajuda",
    feedback: "Feedback",
    help: "Ajuda",
    feedbackTitle: "Enviar feedback",
    feedbackDescription:
      "Conte-nos sobre um problema que encontrou ou algo que podemos melhorar.",
    feedbackLabel: "Feedback",
    feedbackPlaceholder: "Descreva seu feedback ou cole textos e imagens…",
    feedbackImagesLabel: "Imagens",
    feedbackImagesHint:
      "Opcional. Adicione até {{count}} imagens PNG, JPEG, WebP ou GIF, com no máximo {{size}} MB cada. Você também pode colar imagens diretamente no campo de feedback.",
    addFeedbackImages: "Adicionar imagens",
    selectedFeedbackImages: "Imagens selecionadas para o feedback",
    removeFeedbackImage: "Remover imagem {{name}}",
    feedbackImageInvalid:
      "Escolha imagens que atendam aos requisitos de formato e tamanho.",
    feedbackImageCountError: "Você pode enviar até {{count}} imagens.",
    submitFeedback: "Enviar",
    submittingFeedback: "Enviando…",
    feedbackSubmitted: "Obrigado pelo seu feedback.",
  },
  automation: {
    title: "Automações",
    description:
      "Agende tarefas recorrentes, defina lembretes e acompanhe o que importa.",
    create: "Nova automação",
    createTitle: "Nova automação",
    editTitle: "Editar automação",
    editorDescription:
      "Configure a instrução, a tarefa fixa e a frequência personalizada.",
    resizeEditor: "Redimensionar editor de automação",
    empty: "Nenhuma automação ainda",
    emptyDescription:
      "Crie uma automação para iniciar uma nova execução em uma tarefa fixa nos horários agendados.",
    suggestions: {
      title: "Sugestões",
      useTemplateNamed: "Usar o modelo {{name}}",
      dailyBrief: {
        title: "Resumo diário",
        schedule: "Dias úteis às 08:00",
        description:
          "Comece cada dia útil com um resumo da agenda, dos e-mails não lidos e das prioridades",
        instruction:
          "Revise minha agenda, meus e-mails não lidos e minhas prioridades. Resuma os compromissos de hoje, as mensagens que precisam de resposta e as tarefas mais importantes em um resumo diário conciso.",
      },
      weeklyReview: {
        title: "Revisão semanal",
        schedule: "Sexta-feira às 16:00",
        description:
          "Transforme o trabalho recente da semana em uma atualização concisa toda sexta-feira",
        instruction:
          "Revise o progresso desta semana, o trabalho concluído, os itens pendentes e as prioridades da próxima semana. Organize tudo em uma atualização de status concisa.",
      },
      followUpMonitor: {
        title: "Acompanhamento de pendências",
        schedule: "Dias úteis às 09:00",
        description:
          "Revise as atividades recentes de e-mail e agenda e destaque o que precisa de atenção",
        instruction:
          "Revise as atividades recentes de e-mail e agenda. Identifique itens que precisam de acompanhamento, estão perto do prazo ou merecem atenção e resuma-os por prioridade.",
      },
    },
    filterLabel: "Filtrar automações",
    filter: {
      all: "Todos",
      active: "Ativo",
      paused: "Pausado",
    },
    filteredEmpty: "Nenhuma automação em {{filter}}",
    filteredEmptyDescription:
      "Altere os filtros para ver suas outras automações.",
    name: "Título da automação",
    instruction: "Instrução da automação",
    instructionHint:
      "Descreva a tarefa completa a executar a cada acionamento.",
    runIn: "Executar em",
    task: "Tarefa",
    targetTask: "Tarefa",
    existingTask: "Tarefa existente",
    newTask: "Nova tarefa",
    existingTaskHint:
      "Só é possível selecionar tarefas ativas e fixadas da sua conta.",
    newTaskHint:
      "A tarefa é criada e fixada uma única vez e reutilizada em todos os acionamentos futuros.",
    noPinnedTasks:
      "Nenhuma tarefa disponível. Primeiro, fixe uma tarefa ou selecione Nova tarefa.",
    selectTask: "Selecione uma tarefa fixada",
    repeat: "Repetir",
    interval: "A cada",
    intervalHint: "Execute a cada número de {{unit}}, de 1 a 999.",
    minuteOfHour: "Minuto da hora",
    minuteOfHourHint:
      "Insira de 0 a 59. Por exemplo, 15 executa no minuto 15 de cada ciclo.",
    time: "Horário",
    hour: "Hora",
    minute: "Minuto",
    weekdays: "Executar em",
    dayOfMonth: "Dia",
    monthOfYear: "Mês",
    invalidMonthDayHint: "Os meses que não tiverem este dia serão ignorados.",
    monthOption: "Mês {{month}}",
    dayOption: "Dia {{day}}",
    expiresEnabled: "Definir uma data de término",
    expiresEnabledHint:
      "Ainda pode haver execuções na data de término; a execução para no dia seguinte.",
    expiresOn: "Data de término",
    expiresOnPlaceholder: "Selecionar uma data de término",
    clearExpiresOn: "Limpar data de término",
    timeZone: "Executa no fuso horário {{timeZone}}.",
    modelOverride: "Definir modelo e esforço de raciocínio",
    modelOverrideHint:
      "Quando ativado, as execuções usam o modelo e o esforço de raciocínio selecionados. Caso contrário, usam os padrões da sua conta.",
    modelOverrideUnavailable:
      "Nenhum modelo está disponível ainda. Configure um provedor de modelos nas configurações de administração.",
    modelOverrideLoading: "Carregando modelos disponíveis…",
    modelLabel: "Modelo",
    modelNotSelected: "Selecionar um modelo",
    reasoningEffortLabel: "Esforço de raciocínio",
    reasoningEffortNotSelected: "Selecionar um esforço de raciocínio",
    nextRun: "Próxima execução",
    lastRun: "Última execução",
    nextRunRelative: "Próxima execução {{relative}}",
    lastRunRelative: "Última execução {{relative}}",
    lastRunFailed: "A última execução falhou",
    lastRunEmptyResult: "A última execução falhou: sem resultado",
    pause: "Pausar",
    resume: "Retomar",
    pauseNamed: "Pausar {{name}}",
    resumeNamed: "Retomar {{name}}",
    runNow: "Executar agora",
    runNowLoading: "Executando automação…",
    runNowStarted: "“{{name}}” iniciada.",
    runNowQueued: "“{{name}}” adicionada à fila da tarefa.",
    openTask: "Abrir tarefa",
    moreActionsNamed: "Mais ações para {{name}}",
    editNamed: "Editar {{name}}",
    deleteNamed: "Excluir {{name}}",
    deleteTitle: "Excluir automação",
    deleteDescription:
      "Excluir “{{name}}”? A tarefa vinculada e seu histórico serão mantidos.",
    validation:
      "Preencha as configurações da automação e confira todos os números, datas e horários.",
    weekdaySeparator: ", ",
    status: {
      active: "Ativo",
      paused: "Pausado",
    },
    frequency: {
      hourly: "A cada hora",
      daily: "Diariamente",
      weekly: "Semanalmente",
      monthly: "Mensalmente",
      yearly: "Anualmente",
    },
    unit: {
      hourly: "horas",
      daily: "dias",
      weekly: "semanas",
      monthly: "meses",
      yearly: "anos",
    },
    weekday: {
      "1": "Seg",
      "2": "Ter",
      "3": "Qua",
      "4": "Qui",
      "5": "Sex",
      "6": "Sáb",
      "7": "Dom",
    },
    schedule: {
      hourly: "A cada {{interval}} hora(s), no minuto {{minute}}",
      daily: "A cada {{interval}} dia(s), às {{time}}",
      weekly: "A cada {{interval}} semana(s), {{weekdays}}, às {{time}}",
      monthly: "A cada {{interval}} mês(es), no dia {{day}}, às {{time}}",
      yearly: "A cada {{interval}} ano(s), em {{day}}/{{month}}, às {{time}}",
    },
  },
  quotaManagement: {
    save: "Salvar configurações",
    title: "Gerenciamento de cotas",
    description:
      "Gerencie o padrão de cota semanal de todos os membros e o preço de conversão de créditos.",
    conversionTitle: "Conversão de créditos",
    conversionDescription:
      "Converta os custos de uso dos modelos em créditos. Mudanças de preço afetam apenas o consumo posterior; cobranças existentes permanecem inalteradas.",
    creditPrice: "Valor por crédito (USD)",
    conversionExample:
      "Por exemplo, a USD 0,01 por crédito, uma cobrança de USD 0,25 consome 25 créditos.",
    members: {
      actions: "Ações sobre as cotas dos membros",
      reset: "Renovar cotas de todos",
      resetDescription:
        "Restaure a cota semanal de cada membro existente para 100% do próprio limite atual. Membros sem limite continuam sem limite. Limites não salvos neste formulário não são aplicados à renovação. O histórico de uso é mantido, e o consumo posterior é descontado normalmente.",
      title: "Cota semanal dos membros",
      description:
        "Usada como cota semanal padrão dos membros criados, importados ou cadastrados por conta própria posteriormente. Use o menu no canto superior direito para aplicá-la a todos os membros existentes ou ajuste membros individualmente ou em lote no gerenciamento de usuários.",
    },
    weekly_credit_limit: "Cota semanal (créditos)",
    weekly_credit_limit_hint:
      "Renovada à meia-noite de segunda-feira, no fuso horário do sistema.",
    unlimited: "Ilimitado",
    invalidAmount:
      "Insira um valor positivo com até 6 casas decimais, não superior a 9.223.372.036.854,775807.",
    applyMembers: "Aplicar limite a todos",
    applyDescription:
      "Salve {{weekly}} por semana como padrão dos membros e substitua a cota semanal de todos os membros existentes, incluindo limites individuais. Os créditos usados não são zerados; as outras configurações do formulário permanecem inalteradas.",
    confirmReset: "Confirmar renovação das cotas",
    resetHint:
      "A confirmação restaura os créditos disponíveis imediatamente e preserva o histórico de uso.",
    confirmApply: "Confirmar salvamento e aplicação",
    resetSuccess: "Cotas renovadas para {{count}} membros.",
    applySuccess: "Novo limite salvo e aplicado a {{count}} membros.",
    refreshFailed:
      "A ação foi concluída, mas não foi possível atualizar a página. Recarregue para ver as cotas atuais.",
    saved: "Configurações de cota salvas.",
    enforcementHint:
      "Em branco significa sem limite. Ao atingir o limite semanal, novas tarefas são impedidas; tarefas em andamento continuam. O consumo é arredondado para cima ao múltiplo mais próximo de 0,000001 crédito.",
  },
  settings: {
    navigationLabel: "Navegação das configurações do {{productName}}",
    navigation: "Navegação das configurações",
    backToApp: "Voltar ao {{productName}}",
    search: "Pesquisar configurações",
    personalGroup: "Pessoal",
    administrationGroup: "Administração",
    usageDescription: "Consulte tarefas, turnos e uso de tokens por modelo",
    general: "Geral",
    generalDescription:
      "Idioma da interface, tratamento de mensagens e notificações do navegador",
    profile: "Perfil",
    profileDescription: "Perfil e uso pessoal",
    personalization: "Personalização",
    personalizationDescription: "Instruções personalizadas e memória",
    appearance: "Aparência",
    appearanceDescription: "Tema da interface e tamanho da fonte",
    security: "Segurança",
    securityDescription: "Alterar senha de acesso",
    credentials: "Credenciais de plugins",
    credentialsDescription: "Gerencie suas credenciais pessoais de plugins",
    mcp: "MCP",
    mcpDescription: "Gerencie seus servidores MCP pessoais HTTP e STDIO",
    channelAccess: "Canais de mensagens",
    channelAccessDescription:
      "Gerencie Weixin, WeCom, DingTalk, Teams, Feishu e outros canais",
    capabilitiesDescription:
      "Explore a Central de plugins e gerencie seus plugins e habilidades pessoais",
    archivedDescription: "Ver tarefas arquivadas",
    usersDescription: "Gerencie contas, funções e status dos usuários",
    rolesDescription: "Consulte as funções fixas e seus limites de permissão",
    groupsDescription: "Gerencie grupos de usuários e seus membros",
    usersAndGroupsDescription:
      "Gerencie contas, funções, status e participação dos usuários em grupos",
    adminCapabilitiesDescription:
      "Revise versões e gerencie a Central de plugins",
    adminKnowledgeBasesDescription:
      "Administre bases de conhecimento de diferentes usuários e configure fontes externas",
    adminKnowledgeSourcesDescription:
      "Configure SharePoint e outras fontes externas de conhecimento",
    auditDescription: "Consulte logs de auditoria de diferentes usuários",
    feedbackDescription:
      "Revise o feedback dos usuários e as capturas de tela dos problemas",
    modelSettings: "Configurações de modelos",
    modelSettingsDescription:
      "Gerencie o serviço de modelos, os modelos e os esforços de raciocínio",
    systemSettings: "Configurações do sistema",
    systemSettingsDescription: "Configurações do produto e da autenticação",
    systemHealth: "Saúde do sistema",
    systemHealthDescription: "Status dos serviços e das dependências",
    systemUpdate: "Atualização do sistema",
    systemUpdateDescription:
      "Verifique novas versões e consulte orientações para uma atualização segura",
    noResults: "Nenhuma configuração corresponde à pesquisa.",
    generalPageDescription:
      "Gerencie as preferências da interface que se aplicam apenas à sua conta.",
    interfaceLanguage: "Idioma da interface",
    interfaceLanguageDescription: "Idioma da interface do aplicativo",
    runningMessageAction: "Novas mensagens durante uma execução",
    runningMessageActionDescription:
      "Quando uma tarefa ainda está em execução, as novas mensagens seguem esta preferência automaticamente, sem abrir uma caixa de seleção.",
    runningMessageActionSteer: "Orientar a execução atual",
    runningMessageActionQueue: "Colocar na fila como próxima solicitação",
    profilePageDescription: "Atualize seu nome de exibição e avatar.",
    taskAutoNaming: "Nomeação automática de tarefas",
    taskAutoNamingDescription:
      "Dê nome às tarefas na primeira mensagem ou atualize-o a cada nova mensagem. Nomes editados manualmente permanecem inalterados.",
    taskAutoNamingFrequency: "Frequência de nomeação",
    taskAutoNamingFirstMessage: "Primeira mensagem",
    taskAutoNamingEveryMessage: "Cada mensagem",
    taskAutoNamingSaved: "Preferência de nomeação de tarefas salva.",
    personalizationPageDescription:
      "Configure a nomeação de tarefas, as instruções personalizadas e as preferências de memória.",
    customInstructions: "Instruções personalizadas",
    customInstructionsDescription:
      "Forneça orientações e contexto adicionais para todas as tarefas futuras. As regras da plataforma e os limites de segurança de cada tarefa sempre têm prioridade.",
    customInstructionsPlaceholder:
      "Por exemplo: Mantenha as respostas concisas; comece pela conclusão e acrescente os detalhes necessários.",
    customInstructionsCount: "{{count}} / {{max}}",
    customInstructionsSaved: "Instruções personalizadas salvas",
    unsavedChangesTitle: "Descartar alterações não salvas?",
    unsavedChangesDescription:
      "Suas instruções personalizadas não salvas serão perdidas se você sair desta página.",
    stayOnPage: "Permanecer na página",
    discardChanges: "Descartar alterações",
    memory: "Memória",
    memoryDescription:
      "Configure como suas memórias pessoais são criadas, mantidas e usadas.",
    enableMemories: "Ativar memórias",
    enableMemoriesDescription:
      "Crie memórias a partir de tarefas e use as existentes em tarefas futuras. Tarefas que envolvem ferramentas externas ou contexto da Web não criam memórias.",
    resetMemories: "Redefinir memórias",
    resetMemoriesDescription:
      "Exclua todas as suas memórias sem excluir tarefas, instruções personalizadas, plugins ou habilidades.",
    reset: "Redefinir",
    resetMemoriesConfirmTitle: "Redefinir todas as memórias?",
    resetMemoriesConfirmDescription:
      "Esta ação não pode ser desfeita. Suas tarefas, instruções personalizadas, plugins e habilidades serão mantidos.",
    resettingMemories: "Redefinindo memórias…",
    memoriesReset: "Memórias redefinidas",
    appearancePageDescription:
      "Defina o tema da interface e o tamanho da fonte base do {{productName}}.",
    theme: "Tema",
    themeSystem: "Sistema",
    themeLight: "Claro",
    themeDark: "Escuro",
    uiFontSize: "Tamanho da fonte da interface",
    uiFontSizeDescription:
      "Ajuste o tamanho da fonte base do {{productName}}, de {{min}} a {{max}} px.",
    uiFontSizeUnit: "px",
    securityPageDescription:
      "Altere sua senha de acesso local e revogue as sessões de acesso existentes.",
  },
  botChannels: {
    connectionError:
      "Verifique as credenciais do aplicativo, as permissões de mensagens e a rede e tente novamente.",
    connect: "Conectar",
    disconnect: "Desconectar {{name}}",
    settings: "Ver configuração",
    setupTitle: "Conectar {{name}}",
    save: "Salvar configuração",
    cancel: "Cancelar",
    confirmDisconnect: "Desconectar",
    retry: "Tentar novamente",
    account: "Conta do aplicativo ou bot",
    botId: "ID do bot",
    clientId: "ID do cliente do aplicativo",
    secret: "Segredo do aplicativo",
    tenantId: "ID do locatário",
    sender: "ID do membro permitido",
    groups:
      "Permitir que este membro inicie tarefas ao mencionar o bot em grupos",
    callback: "Endpoint de mensagens",
    callbackHelp:
      "Defina esta URL como endpoint de mensagens do Azure Bot. Ela deve ser acessível publicamente por HTTPS.",
    replaceHelp:
      "Para substituir o aplicativo ou segredo, desconecte e configure o canal novamente.",
    disconnectHelp:
      "A desconexão interrompe o recebimento e as respostas por este canal e remove mensagens e respostas pendentes. As tarefas existentes do LinkSense são mantidas.",
    invalid:
      "Confira todos os campos obrigatórios. Os IDs do aplicativo, locatário e membro do Teams devem ser UUIDs válidos.",
    status: {
      connecting: "Conectando",
      online: "Online",
      waiting_message: "Aguardando uma mensagem",
      error: "Erro de conexão",
      disconnected: "Não conectado",
    },
    description: {
      wecom:
        "Receba mensagens diretas e menções em grupos por um bot inteligente do WeCom.",
      dingtalk:
        "Receba mensagens diretas e menções em grupos por um bot de aplicativo do DingTalk.",
      teams:
        "Receba mensagens diretas e menções em grupos por um bot do Teams.",
    },
    setup: {
      wecom:
        "Crie um bot inteligente no WeCom usando o modo API e uma conexão persistente. Depois, informe seu ID, segredo e membro permitido.",
      dingtalk:
        "Crie um aplicativo interno na plataforma de desenvolvedores do DingTalk, ative e publique seu bot Stream e conceda permissões para mensagens diretas e em grupos.",
      teams:
        "Crie um Azure Bot de locatário único e ative o Microsoft Teams. Após salvar, configure o endpoint de mensagens no Azure e instale o aplicativo do bot no Teams.",
    },
    senderHelp: {
      wecom:
        "Insira o userid do membro no diretório do WeCom. Somente esse membro poderá usar seu assistente LinkSense.",
      dingtalk:
        "Insira o UserId do membro na organização do DingTalk. Somente esse membro poderá usar seu assistente LinkSense.",
      teams:
        "Insira o ID do objeto do usuário no Microsoft Entra. Somente esse usuário poderá usar seu assistente LinkSense.",
    },
  },
  channelAccess: {
    title: "Canais de mensagens",
    description:
      "Conecte e gerencie Weixin, WeCom, DingTalk, Teams, Feishu e outros canais de mensagens. O assistente LinkSense atende às mensagens por padrão.",
    channelsLabel: "Canais disponíveis",
    weixin: {
      name: "Weixin",
      description:
        "Receba mensagens por uma conexão pessoal do Weixin e encaminhe-as ao assistente LinkSense.",
      notConnected: "Nenhuma conta Weixin conectada",
      accountConnected: "Conta conectada {{account}}",
      scopeValue: "Somente a conta que escaneou · Texto e voz transcrita",
      iconLabel: "Ícone do Weixin",
      connect: "Conectar",
      reconnect: "Reconectar",
      disconnect: "Desconectar",
      successDescription: "O Weixin está conectado ao LinkSense.",
      connectedNotice: "Weixin conectado",
      disconnectedNotice: "Weixin desconectado",
      loginTitle: "Conectar Weixin",
      loginDescription:
        "Escaneie e confirme com o Weixin no celular. O LinkSense processa apenas mensagens da conta que escaneou.",
      generatingQr: "Gerando um código QR do Weixin",
      qrCodeLabel: "Código QR de conexão do Weixin",
      verificationLabel: "Código de pareamento exibido no Weixin",
      submitVerification: "Enviar código de pareamento",
      generateAgain: "Gerar novamente",
      finish: "Concluído",
      disconnectTitle: "Desconectar o Weixin?",
      disconnectDescription:
        "O LinkSense deixará de receber e responder a mensagens do Weixin. As tarefas existentes do LinkSense serão mantidas.",
    },
    wecom: {
      name: "WeCom",
      description:
        "Receba mensagens de membros ou clientes no WeCom e encaminhe-as ao assistente LinkSense.",
    },
    dingtalk: {
      name: "DingTalk",
      description:
        "Receba mensagens da organização e notificações de colaboração no DingTalk e encaminhe-as ao assistente LinkSense.",
    },
    teams: {
      name: "Microsoft Teams",
      description:
        "Receba mensagens pessoais ou de equipe no Teams e encaminhe-as ao assistente LinkSense.",
      scopeValue: "Conversas e mensagens de canais do Teams",
    },
    feishu: {
      name: "Feishu",
      description:
        "Receba mensagens por um bot do Feishu e encaminhe-as ao assistente LinkSense.",
      notConnected: "Nenhum bot pessoal do Feishu criado",
      scopeValue: "Somente o proprietário · Mensagens de texto diretas",
      iconLabel: "Ícone do Feishu",
      connect: "Conectar",
      reconnect: "Atualizar acesso",
      disconnect: "Desconectar",
      successDescription:
        "As credenciais do bot foram salvas com segurança. A conexão de mensagens está sendo estabelecida.",
      botCreated:
        "O bot “{{bot}}” foi criado. A conexão de mensagens está sendo estabelecida",
      appUpdated:
        "O acesso do aplicativo Feishu foi atualizado. A conexão de mensagens está sendo estabelecida.",
      connectedNotice: "Bot do Feishu criado",
      updatedNotice: "Acesso do aplicativo Feishu atualizado",
      pendingApprovalNotice:
        "O aplicativo Feishu foi criado e aguarda aprovação do administrador",
      pendingApprovalUpdatedNotice:
        "O aplicativo Feishu foi atualizado e aguarda aprovação do administrador",
      pendingApprovalDescription:
        "Você não precisa escanear novamente. O LinkSense se conectará automaticamente após a aprovação do aplicativo pelo administrador.",
      disconnectedNotice: "Feishu desconectado",
      registrationTitle: "Criar um bot pessoal do Feishu",
      registrationDescription:
        "Escaneie com o Feishu e aprove o acesso. O LinkSense cria um bot oficial e armazena suas credenciais com segurança, sem necessidade de configuração no console de desenvolvedor.",
      reauthorizationTitle: "Atualizar acesso do bot do Feishu",
      reauthorizationDescription:
        "Escaneie com o Feishu e aprove o acesso adicional às mensagens. O LinkSense atualiza o bot atual e configura sua conexão de mensagens sem criar um bot duplicado.",
      generatingQr: "Solicitando um código QR de criação ao Feishu",
      qrCodeLabel: "Código QR de criação do bot do Feishu",
      generateAgain: "Gerar novamente",
      recoverExisting: "Conectar bot criado",
      createWhenMissing: "Aplicativo excluído? Criar um novo aplicativo",
      finish: "Concluído",
      disconnectTitle: "Desconectar o Feishu?",
      disconnectDescription:
        "O LinkSense deixará de receber e responder a mensagens do Feishu. O bot oficial e as tarefas existentes do LinkSense serão mantidos.",
      registrationStatus: {
        generating_qr: "Gerando um código QR",
        waiting_scan: "Escaneie com o Feishu e aprove o acesso",
        pending_approval:
          "Aplicativo criado, aguardando aprovação do administrador",
        pending_approval_update:
          "Aplicativo atualizado, aguardando aprovação do administrador",
        connected: "Bot criado",
        updated: "Aplicativo Feishu atualizado",
        expired: "O código QR expirou",
        failed:
          "O bot pode já existir, mas a configuração da conexão não foi concluída. Escaneie novamente e selecione o bot que acabou de criar",
        update_failed:
          "A atualização do aplicativo Feishu não foi concluída. Escaneie novamente para tentar outra vez",
      },
    },
    scopeLabel: "Escopo das mensagens",
    entryLabel: "Método de acesso",
    weixinEntryValue: "Conexão por QR",
    upcomingEntryValue: "Publicação pendente",
    unavailableAction: "Ainda indisponível",
    status: {
      available: "Disponível",
      comingSoon: "Em breve",
      online: "Online",
      connecting: "Conectando",
      pending_approval: "Aguardando aprovação do administrador",
      error: "Erro de conexão",
      reauthorization_required: "Reconexão necessária",
    },
    loginStatus: {
      waiting_scan: "Aguardando a leitura do código QR",
      scanned: "Código lido. Confirme a conexão no Weixin",
      verification_required: "Insira o código de pareamento exibido no Weixin",
      connected: "Conectado",
      expired: "O código QR expirou",
      failed: "A conexão não foi concluída. Gere um novo código QR",
    },
  },
  browserNotifications: {
    settingsTitle: "Notificações do navegador",
    settingsDescription:
      "Quando você não estiver usando o LinkSense ativamente, este navegador avisará quando uma tarefa comum ou automação for concluída, falhar ou for interrompida.",
    promptMessage:
      "Receba notificações e sons do navegador quando as tarefas terminarem.",
    promptDismiss: "Agora não",
    promptEnable: "Ativar",
    promptEnabling: "Ativando",
    enable: "Ativar notificações do navegador",
    unsupported:
      "Este navegador ou ambiente não oferece suporte a notificações. Abra o LinkSense em uma página segura de um navegador compatível.",
    permissionDenied:
      "As notificações estão bloqueadas pelo navegador. Permita-as nas permissões deste site no navegador e volte aqui para tentar novamente.",
    permissionDismissed:
      "As notificações não foram permitidas. Ative esta opção novamente e escolha Permitir na solicitação do navegador.",
    permissionRequired:
      "A preferência de ativação foi salva, mas a permissão do navegador foi redefinida. Desative as notificações do navegador e ative-as novamente para conceder a permissão.",
    permissionError:
      "Não foi possível solicitar a permissão de notificações do navegador. Tente novamente mais tarde.",
    storageError:
      "Não foi possível salvar a configuração de notificações neste navegador. As notificações estão desativadas nesta página; atualize-a e confira a opção novamente.",
    deliveryError:
      "O navegador não conseguiu criar uma notificação do sistema, por isso as notificações continuam desativadas. Verifique as permissões deste site e as configurações de notificações deste navegador no sistema operacional.",
    feedError:
      "Não foi possível acessar o serviço de notificações de conclusão de tarefas, por isso as notificações continuam desativadas. Verifique sua conexão e tente novamente.",
    testTitle: "{{productName}} · Teste de notificação do navegador",
    testBody:
      "As notificações estão conectadas. Você receberá um aviso aqui quando uma tarefa ou automação produzir um resultado.",
    testSent:
      "Uma notificação de teste foi enviada ao sistema. Se não a viu, confira as configurações de notificações deste navegador no sistema operacional.",
    notificationTitle: "{{productName}} · {{taskTitle}}",
    statusCompletedBody: "Processamento concluído",
    statusFailedBody: "Falha no processamento",
    statusInterruptedBody: "Processamento interrompido",
  },
  mcp: {
    title: "Servidores MCP",
    description:
      "Conecte e gerencie seus servidores MCP pessoais Streamable HTTP e STDIO. Cada item ativado é anexado automaticamente às novas tarefas.",
    add: "Adicionar servidor",
    empty: "Nenhum servidor MCP pessoal configurado",
    emptyDescription:
      "Adicione um endpoint remoto Streamable HTTP ou um servidor MCP STDIO hospedado em contêiner.",
    createTitle: "Conectar um MCP personalizado",
    editTitle: "Editar servidor MCP",
    editorDescription:
      "O MCP é independente dos plugins. As configurações ativadas são anexadas automaticamente às suas novas tarefas.",
    transportLabel: "Tipo de conexão",
    transport: {
      streamable_http: "HTTP",
      stdio: "STDIO",
    },
    name: "Nome",
    url: "URL do servidor",
    urlHint: "São aceitos endpoints MCP Streamable HTTP com HTTP e HTTPS.",
    stdioConfiguration: "Configuração STDIO (JSON)",
    stdioConfigurationHint:
      "Insira command, args e env diretamente ou cole um objeto JSON mcpServers com exatamente um servidor. Os valores de env são criptografados; npx -y é convertido com segurança para pnpm dlx gerenciado dentro do contêiner da tarefa.",
    stdioConfigurationEditHint:
      "Os valores de env salvos nunca são exibidos. Omita env para mantê-los, forneça env para substituí-los ou use um objeto vazio para apagá-los.",
    stdioConfigurationInvalid:
      "Insira um JSON STDIO válido com um único servidor. command é obrigatório, args deve ser uma lista de strings e env deve ser um objeto de strings.",
    currentEnvironmentKeys: "Variáveis atuais: {{keys}}",
    environmentCount: "{{count}} variáveis de ambiente",
    authentication: "Autenticação",
    apiKeyHeader: "Cabeçalho da chave de API",
    credential: "Credencial",
    credentialHint:
      "A credencial é armazenada criptografada e não é exibida novamente.",
    keepCredentialHint: "Deixe em branco para manter a credencial atual.",
    startupTimeout: "Tempo limite de inicialização (segundos)",
    toolTimeout: "Tempo limite da ferramenta (segundos)",
    httpWarningTitle: "Conexões HTTP não são seguras",
    httpWarningDescription:
      "Tokens Bearer, chaves de API, argumentos de ferramentas e resultados são transmitidos sem criptografia e podem ser lidos ou modificados durante a transmissão.",
    httpAcknowledgement:
      "Compreendo e aceito os riscos do HTTP sem criptografia.",
    testConnection: "Testar conexão",
    testing: "Testando {{name}}",
    testSucceeded:
      "Conectado a {{serverName}}; {{count}} ferramentas encontradas.",
    testStatus: {
      succeeded: "Teste aprovado",
      failed: "Teste falhou",
      untested: "Não testado",
    },
    testStatusLabel: "{{name}}: {{status}}",
    auth: {
      none: "Sem autenticação",
      bearer: "Token Bearer",
      api_key: "Chave de API",
    },
    toggle: "Ativar ou desativar {{name}}",
    saved: "O servidor MCP foi salvo.",
    deleted: "O servidor MCP foi excluído.",
    deleteTitle: "Excluir este servidor MCP?",
    deleteDescription:
      "A configuração do servidor, a credencial criptografada e as variáveis de ambiente criptografadas serão excluídas permanentemente. Novas tarefas deixarão de se conectar a ele.",
  },
  bootstrap: {
    unavailableTitle: "{{productName}} está temporariamente indisponível",
    unavailableDescription:
      "Não foi possível conectar ao {{productName}}. Aguarde um momento ou tente novamente.",
  },
  maintenance: {
    title: "Manutenção do sistema",
    indicatorLabel: "Manutenção do sistema ativada",
    dialogTitle: "Manutenção do sistema ativada",
    dialogDescription:
      "Usuários comuns não podem acessar o sistema no momento. Você pode continuar usando e gerenciando o sistema. Desative o modo de manutenção quando terminar.",
    reasonLabel: "Detalhes da manutenção",
    doNotShowAgain: "Não mostrar novamente",
    rememberFailed:
      "Não foi possível salvar sua preferência. Verifique se o navegador permite dados do site. Você ainda pode fechar este aviso pelo botão no canto superior direito.",
    openSettings: "Configurações de manutenção",
    defaultReason: "O sistema está passando por manutenção programada.",
    description:
      "Esta página será restaurada automaticamente quando a manutenção terminar. Tente novamente mais tarde.",
    windowLabel: "Janela de manutenção prevista",
    windowValue: "De {{start}} a {{end}}",
    adminEntry: "Acesso de administrador",
  },
  auth: {
    loginTitle: "Entrar no {{productName}}",
    loginDescription: "Continue com um método de acesso disponível.",
    passwordLogin: "E-mail e senha",
    password: "Senha",
    signIn: "Entrar",
    signOutTitle: "Sair?",
    signOutDescription:
      "Você precisará entrar novamente para continuar usando o {{productName}}.",
    forgotPassword: "Esqueci a senha ou quero definir uma pela primeira vez",
    forgotTitle: "Definir ou redefinir sua senha",
    forgotDescription:
      "Insira seu e-mail. O sistema envia um link seguro quando a conta é elegível.",
    sendResetLink: "Enviar link seguro",
    resetRequestSubmitted: "Solicitação de link seguro enviada",
    resetRequestFailed: "Não foi possível enviar o link seguro",
    resetAccepted:
      "Se o e-mail pertencer a uma conta elegível, será enviado um e-mail para definir ou redefinir a senha.",
    resetTitle: "Definir uma nova senha",
    resetDescription:
      "O link seguro só pode ser usado uma vez. Defina uma senha que atenda aos requisitos.",
    newPassword: "Nova senha",
    currentPassword: "Senha atual",
    confirmPassword: "Confirmar nova senha",
    showPassword: "Mostrar {{field}}",
    hidePassword: "Ocultar {{field}}",
    resetPassword: "Salvar nova senha",
    resetCompleted: "Sua senha foi definida. Entre novamente.",
    changePassword: "Alterar senha",
    passwordPolicy:
      "De 8 a 16 caracteres, incluindo maiúscula, minúscula, número e pontuação ou símbolo.",
    oidc: "Usar autenticação única",
    teamsSigningIn: "Entrando automaticamente com o Microsoft Teams…",
    teamsNotConfigured:
      "A autenticação única do Teams não está configurada. Entre no {{productName}}.",
    teamsFailed:
      "O acesso pelo Teams falhou. Tente novamente ou use outro método de acesso.",
    callbackTitle: "Concluindo autenticação única",
    oidcAccountPendingApproval:
      "A autenticação única foi concluída. Sua conta foi criada e aguarda aprovação do administrador. Entre em contato com um administrador e entre novamente após a ativação.",
    externalAccountPendingApproval:
      "O acesso foi concluído. Sua conta foi criada e aguarda aprovação do administrador. Entre em contato com um administrador e entre novamente após a ativação.",
    oidcCallbackFailed:
      "Não foi possível concluir a autenticação única. Volte à página de acesso e tente novamente.",
    oidcCallbackSessionFailed:
      "A autenticação única foi concluída, mas não foi possível estabelecer a sessão do {{productName}}. Volte à página de acesso e tente novamente.",
    backToLogin: "Voltar para entrar",
    sessionExpired: "Sua sessão expirou. Entre novamente.",
    sessionRestoreFailed:
      "Não foi possível restaurar sua sessão. Verifique sua conexão e tente novamente.",
    registration: {
      signUpPrompt: "Não tem uma conta? <register>Cadastre-se agora</register>",
      title: "Criar uma conta no {{productName}}",
      description:
        "Insira seu e-mail e enviaremos um link de ativação se ele for elegível.",
      closed: "O cadastro está fechado no momento.",
      disabled: "O cadastro está fechado no momento.",
      sendActivationLink: "Enviar e-mail de ativação",
      requestSubmitted: "E-mail de ativação solicitado",
      requestFailed: "Não foi possível enviar o e-mail de ativação",
      requestAccepted:
        "Se o endereço de e-mail for elegível, será enviado um e-mail de ativação da conta.",
      emailUnavailable:
        "O e-mail de ativação da conta está temporariamente indisponível. Tente novamente mais tarde.",
      deliveryFailed:
        "Não foi possível enviar o e-mail de ativação da conta. Tente novamente mais tarde.",
      activateTitle: "Defina uma senha e ative sua conta",
      activateDescription:
        "O link de ativação só pode ser usado uma vez. Defina uma senha de acesso que atenda aos requisitos.",
      activate: "Ativar conta e entrar",
      invalidOrExpired:
        "O link de ativação da conta é inválido ou expirou. Solicite um novo.",
      emailAlreadyRegistered:
        "Já existe uma conta para este e-mail. Entre ou redefina a senha.",
    },
  },
  initialize: {
    title: "Inicializar {{productName}}",
    description:
      "Crie o primeiro administrador. A infraestrutura e os segredos continuam sendo gerenciados pela implantação.",
    adminName: "Nome do administrador",
    credential: "Credencial de inicialização de uso único",
    credentialHint:
      "Insira a credencial de uso único exibida no terminal após a instalação. Ela perde a validade após a criação do administrador.",
    systemName: "Nome do sistema",
    submit: "Criar administrador e concluir configuração",
    completed:
      "A inicialização foi concluída. Entre com a conta de administrador.",
  },
  knowledgeSources: {
    title: "Fontes de conhecimento",
    description:
      "Configure as conexões externas de conhecimento de forma centralizada. Somente administradores podem criar e gerenciar bases de conhecimento de fontes externas.",
    saved: "As configurações da fonte SharePoint foram salvas e autenticadas.",
    secretConfigured: "Segredo configurado; deixe em branco para manter",
    sharepoint: {
      title: "Microsoft SharePoint",
      description:
        "Sincronize documentos de uma pasta aprovada de um site usando uma identidade de aplicativo do Microsoft Graph.",
      enable: "Ativar fonte SharePoint",
      enableDescription:
        "Administradores podem colar a URL de uma pasta do SharePoint ao criar uma base de conhecimento.",
      tenantId: "ID do diretório (locatário)",
      clientId: "ID do aplicativo (cliente)",
      tenantDomain: "Domínio do locatário SharePoint",
      tenantDomainDescription:
        "São aceitas apenas URLs de pastas deste host exato, por exemplo contoso.sharepoint.com.",
      clientSecret: "Segredo do cliente",
      secretDescription:
        "O segredo é armazenado criptografado e nunca é retornado nem registrado em logs.",
      permissionTitle: "Requisito de privilégio mínimo",
      permissionDescription:
        "Use Sites.Selected e solicite a um administrador do Microsoft 365 que conceda acesso de leitura somente aos sites aprovados. O salvamento valida a identidade do aplicativo; a criação da base de conhecimento também verifica o acesso à pasta real.",
    },
  },
  library: {
    title: "Biblioteca de recursos",
    description:
      "Gerencie conhecimentos e arquivos gerados durante a execução de tarefas.",
    tabsLabel: "Conteúdo da biblioteca de recursos",
    tabs: {
      knowledge: "Bases de conhecimento",
      artifacts: "Arquivos gerados por tarefas",
    },
    artifacts: {
      title: "Arquivos gerados por tarefas",
      description:
        "Explore os arquivos gerados pelas tarefas, organizados por tarefa e data, e baixe-os ou visualize os formatos compatíveis.",
      searchPlaceholder: "Pesquisar títulos de tarefas ou nomes de arquivos…",
      fileTypeLabel: "Filtrar por tipo de arquivo",
      fileTypes: {
        all: "Todos os tipos",
        image: "Imagens",
        word: "Word",
        excel: "Excel",
        powerpoint: "PPT",
        html: "HTML",
        pdf: "PDF",
        archive: "Arquivos compactados",
        text: "Texto",
        audio: "Áudio",
        video: "Vídeo",
        other: "Outro",
      },
      empty: "Nenhum arquivo gerado por tarefas",
      emptyDescription:
        "Os arquivos aparecerão aqui após uma tarefa gerar e registrar um arquivo para download.",
      searchEmpty: "Nenhum arquivo de tarefa correspondente",
      listLabel: "Linha do tempo dos arquivos de tarefas",
      archivedTask: "Arquivado",
      previewAvailable: "Visualização disponível",
      downloadNamed: "Baixar {{name}}",
      loadingMore: "Carregando mais…",
      resizePreview: "Redimensionar visualização do arquivo da tarefa",
    },
  },
  knowledge: {
    title: "Bases de conhecimento",
    description:
      "Organize, compartilhe e pesquise os documentos a que você tem acesso.",
    searchCapability: {
      notInstalledTitle: "Bases de conhecimento não estão incluídas no Core",
      notInstalledDescription:
        "Esta instalação usa o LinkSense Core. Instale a edição Full para adicionar análise de documentos e pesquisa de conhecimento.",
      unavailableTitle: "A pesquisa de conhecimento está indisponível",
      unavailableDescription:
        "A pesquisa de conhecimento não pode ser usada no momento. Você ainda pode usar plugins, habilidades e anexos e enviar tarefas normalmente. Tente novamente mais tarde.",
      dimensionMismatch:
        "O índice de conhecimento não corresponde à configuração atual da implantação. Um administrador deve verificar a configuração e executar uma reconstrução completa manual.",
    },
    creationCapability: {
      unreadyTitle: "Ainda não é possível criar uma base de conhecimento",
      unreadyDescription:
        "Os seguintes requisitos precisam voltar a funcionar antes que você possa criar uma base de conhecimento:",
      requestFailedTitle:
        "Não foi possível confirmar os requisitos da base de conhecimento",
      requestFailedDescription:
        "A verificação do serviço não foi concluída. Verifique novamente antes de criar uma base de conhecimento.",
      notInstalledTitle:
        "Bases de conhecimento não estão incluídas nesta edição",
      notInstalledDescription:
        "Instale uma edição que inclua bases de conhecimento antes de criar uma.",
      retry: "Verificar novamente",
      checks: {
        objectStorageUnavailable:
          "O armazenamento de arquivos está temporariamente indisponível",
        documentParsingUnavailable:
          "A análise de documentos está temporariamente indisponível",
        embeddingNotConfigured:
          "Um administrador ainda não configurou um modelo de embeddings",
        embeddingUnavailable:
          "O serviço do modelo de embeddings está temporariamente indisponível",
        searchAndIndexingUnavailable:
          "A pesquisa e a indexação de conhecimento estão temporariamente indisponíveis",
      },
    },
    searchPlaceholder:
      "Pesquisar nomes ou descrições de bases de conhecimento…",
    empty: "Nenhuma base de conhecimento",
    loadMore: "Carregar mais",
    noDescription: "Sem descrição",
    backToList: "Voltar às bases de conhecimento",
    overview: "Visão geral da base de conhecimento",
    documents: "Documentos",
    documentsDescription:
      "Envie documentos e acompanhe a análise, a divisão em trechos, a geração de embeddings e a indexação.",
    documentsEmpty: "Nenhum documento",
    directory: {
      breadcrumb: "Caminho do diretório da base de conhecimento",
      root: "Raiz",
      empty: "Esta pasta não contém documentos",
      flatEmpty:
        "Esta base de conhecimento e suas pastas não contêm documentos",
      viewMode: "Visualização de documentos",
      directoryView: "Pastas",
      flatView: "Lista única",
      openFolder: "Abrir pasta {{name}}",
      expandFolder: "Expandir pasta {{name}}",
      collapseFolder: "Recolher pasta {{name}}",
      showFolders: "Mostrar pastas",
      open: "Abrir",
      folder: "Pasta",
    },
    documentCount: "{{count}} documentos",
    readyCount: "{{count}} pesquisáveis",
    ownerNamed: "Proprietário: {{name}}",
    ownerNamedSelf: "Proprietário: {{name}} (eu)",
    updated: "Atualizado em {{date}}",
    sourceType: {
      label: "Origem: {{source}}",
      local: "Local",
      sharepoint: "SharePoint",
    },
    disabled: "Base de conhecimento desativada",
    disabledDescription:
      "Esta base de conhecimento está indisponível no momento. Entre em contato com o proprietário ou um administrador.",
    archivedReadOnly:
      "Esta base de conhecimento está arquivada e é somente leitura. Restaure-a para gerenciar documentos ou compartilhamento.",
    lifecycle: {
      label: "Status",
      current: "Atual",
      archived: "Arquivado",
    },
    filter: {
      label: "Filtrar bases de conhecimento",
      all: "Todos",
    },
    scope: {
      label: "Escopo da base de conhecimento",
      all: "Todos",
      owned: "Criadas por mim",
      shared: "Compartilhadas comigo",
    },
    access: {
      owner: "Criadas por mim",
      direct: "Compartilhadas diretamente comigo",
      group: "Compartilhadas por {{name}}",
      multiple: "{{count}} origens de compartilhamento",
      shared: "Compartilhadas comigo",
      unknownGroup: "Grupo desconhecido",
      detailsAction: "Ver detalhes da origem",
      detailsTitle: "Origens de acesso",
      detailsDescription:
        "Você tem acesso atualmente pelas seguintes origens ativas.",
      directSource: "Compartilhamento pessoal direto",
      groupSource: "Grupo de usuários: {{name}}",
    },
    create: {
      action: "Criar base de conhecimento",
      title: "Criar base de conhecimento",
      description:
        "Envie documentos após a criação e compartilhe-os com usuários ou grupos conforme necessário.",
      name: "Nome da base de conhecimento",
      optionalDescription: "Descrição (opcional)",
      nameRequired: "Insira um nome para a base de conhecimento.",
      sourceType: "Fonte de dados",
      sourceLocal: "Envio local",
      sourceLocalDescription:
        "Envie e gerencie documentos locais após a criação.",
      sourceSharePoint: "Pasta do SharePoint",
      sourceSharePointDescription:
        "Conecte uma pasta do SharePoint e sincronize-a conforme um agendamento.",
      sourceUnavailable: "Não ativado",
      sharePointNotConfigured:
        "Um administrador ainda não ativou a fonte SharePoint.",
      sharePointUrl: "URL da pasta do SharePoint",
      sharePointUrlHint:
        "Aceita links de compartilhamento de pastas do SharePoint e URLs diretas de pastas no site.",
      sharePointUrlPlaceholder:
        "https://contoso.sharepoint.com/:f:/s/team/share-token",
      syncFrequencyLabel: "Frequência de sincronização",
      syncFrequency: {
        daily: "Diariamente",
        weekly: "Semanalmente",
        monthly: "Mensalmente",
      },
      syncWeekdayLabel: "Dia da semana",
      syncWeekday: {
        "1": "Seg",
        "2": "Ter",
        "3": "Qua",
        "4": "Qui",
        "5": "Sex",
        "6": "Sáb",
        "7": "Dom",
      },
      syncDayOfMonth: "Dia",
      syncInvalidMonthDayHint:
        "Os meses que não tiverem este dia serão ignorados.",
      syncDayOption: "Dia {{day}}",
      syncTime: "Horário",
      syncHour: "Hora",
      syncMinute: "Minuto",
      syncTimeZone: "Sincroniza no fuso horário {{timeZone}}.",
    },
    source: {
      title: "Sincronização do SharePoint",
      syncNow: "Sincronizar agora",
      retrySync: "Tentar sincronização novamente",
      syncAccepted: "A tarefa de sincronização do SharePoint foi enviada.",
      status: {
        pending: "A pasta {{folder}} está aguardando sincronização.",
        syncing: "Sincronizando a pasta {{folder}}.",
        ready: "A pasta {{folder}} está sincronizada.",
        failed:
          "Parte ou todo o conteúdo da pasta {{folder}} falhou na sincronização.",
      },
      phase: {
        scanning: "Verificando a pasta do SharePoint",
        syncing: "Sincronizando arquivos do SharePoint",
        processing: "Processando documentos de conhecimento",
        completed: "Sincronização concluída",
      },
      progress: {
        scanning: "Verificando a pasta; {{count}} itens encontrados",
        syncing: "Sincronizando arquivos ({{processed}}/{{total}})",
        processing: "Processando documentos ({{processed}}/{{total}})",
        completed: "Sincronização concluída ({{processed}}/{{total}})",
        discovered: "{{count}} encontrados",
        summary:
          "Processados {{processed}}/{{total}}: {{created}} criados, {{updated}} atualizados, {{deleted}} excluídos, {{skipped}} ignorados, {{retried}} retomados e {{failed}} com falha.",
      },
      retryHint:
        "Selecione Tentar sincronização novamente para continuar da página de verificação ou do ponto de processamento de arquivos que falhou.",
    },
    edit: {
      title: "Editar detalhes da base de conhecimento",
      description:
        "Atualize o nome e a descrição sem reprocessar os documentos existentes.",
    },
    actions: {
      archive: "Arquivar",
      restore: "Restaurar",
      retryNamed: "Tentar processar {{name}} novamente",
      reprocessNamed: "Reprocessar {{name}}",
      rebuildNamed: "Reconstruir índice de {{name}}",
      cancelProcessing: "Cancelar processamento",
      reprocess: "Reprocessar",
      rebuild: "Reconstruir índice",
      rebuildSelected: "Reconstruir selecionados",
      rebuildSelectedShort: "Selecionados",
      rebuildAll: "Reconstruir todos os documentos",
      rebuildAllShort: "Todos",
      rename: "Renomear",
      removeDirectShare: "Remover meu compartilhamento direto",
      documentMenu: "Gerenciar documento {{name}}",
    },
    confirm: {
      archive: {
        title: "Arquivar base de conhecimento?",
        description:
          "A base de conhecimento fica somente leitura após ser arquivada e pode ser restaurada depois.",
      },
      restore: {
        title: "Restaurar base de conhecimento?",
        description:
          "O envio, o processamento e o compartilhamento voltam a ficar disponíveis após a restauração.",
      },
      delete_base: {
        title: "Excluir base de conhecimento permanentemente?",
        description:
          "Esta ação não pode ser desfeita. Somente bases de conhecimento arquivadas podem ser excluídas.",
      },
      delete_document: {
        title: "Excluir documento?",
        description:
          "Esta ação exclui “{{name}}”, seu conteúdo analisado e seus dados de índice.",
      },
      reprocess: {
        title: "Reprocessar documento?",
        description:
          "“{{name}}” será analisado e processado novamente com a configuração atual.",
      },
      rebuild: {
        title: "Reconstruir índice do documento?",
        description:
          "“{{name}}” será dividido em trechos e terá os embeddings gerados novamente, substituindo o índice atual.",
      },
      rebuild_selected: {
        title: "Reconstruir os índices dos documentos selecionados?",
        description:
          "Documentos prontos serão divididos em trechos novamente e terão novos embeddings para substituir seus índices. Documentos com falha serão retomados a partir das versões candidatas existentes para concluir a indexação. Serão processados {{count}} documentos.",
      },
      rebuild_all: {
        title:
          "Reconstruir todos os índices de documentos desta base de conhecimento?",
        description:
          "Documentos prontos serão divididos em trechos novamente e terão novos embeddings para substituir seus índices. Documentos com falha serão retomados a partir das versões candidatas existentes para concluir a indexação.",
      },
      remove_direct_share: {
        title: "Remover seu compartilhamento direto?",
        description:
          "Esta ação remove o compartilhamento pessoal concedido diretamente a você. {{remainingAccess}}",
      },
    },
    deleteBlocked: {
      title: "A base de conhecimento ainda não pode ser excluída",
      description:
        "Remova esta base de conhecimento dos aplicativos a seguir e tente excluí-la novamente.",
      usagesTitle: "Aplicativos que usam esta base de conhecimento ({{count}})",
      openApplications: "Abrir Central de aplicativos",
    },
    storage: {
      title: "Armazenamento",
      description:
        "Versões atuais, conteúdo arquivado, versões antigas mantidas para citações ou por 30 dias, originais com falha e objetos aguardando limpeza ocupam armazenamento. O estado excluído não significa que a capacidade já foi liberada.",
      reserved: "{{size}} reservados",
    },
    events: {
      reconnecting:
        "A conexão de progresso em tempo real foi interrompida e está sendo restabelecida. A atualização periódica continua ativa.",
    },
    document: {
      name: "Documento",
      size: "Tamanho",
      rebuildRequired: "Reconstrução necessária",
      retryAt: "Próxima tentativa prevista para {{date}}",
      retryWaitingFirst:
        "A primeira nova tentativa automática continuará em {{date}}",
      retryWaitingSecond:
        "A segunda nova tentativa automática continuará em {{date}}",
      selectAll: "Selecionar todos os documentos carregados",
      selectNamed: "Selecionar documento {{name}}",
      selectedCount: "{{count}} documentos selecionados",
      rebuildBatchResult:
        "{{accepted}} documentos enviados para processamento; {{rejected}} não puderam ser enviados.",
      candidateFailure:
        "Esta versão candidata falhou. A versão disponível atualmente continua utilizável.",
      failureDetailsNamed:
        "Ver detalhes da falha de processamento do documento {{name}}",
      renameTitle: "Renomear documento",
      renameDescription:
        "Somente o nome de exibição muda. O documento não será analisado novamente nem terá novos embeddings gerados.",
      displayName: "Nome do documento",
      failure: {
        cancelled: "O processamento desta tarefa foi interrompido.",
        encrypted:
          "O documento está protegido por senha ou criptografado e não pode ser processado.",
        unsupportedFormat:
          "Este formato de documento não é compatível com o processamento.",
        officeConversionFailed:
          "Não foi possível converter o documento para um formato analisável. Confirme se ele abre normalmente em programas de escritório comuns.",
        tooLarge:
          "O documento excede o limite de tamanho por arquivo e não pode ser processado.",
        storageQuota:
          "A base de conhecimento não tem armazenamento suficiente para continuar o processamento.",
        structureInvalid:
          "A validação da estrutura do documento ou da cobertura da fonte falhou.",
        imageConfigurationChanged:
          "A configuração de compreensão de imagens mudou. Reprocesse o documento com a configuração atual.",
        imageModelNotFound:
          "O modelo de compreensão de imagens configurado não existe mais. Selecione outro modelo e reprocesse o documento.",
        imageOutputInvalid:
          "O modelo de compreensão de imagens não retornou uma descrição estruturada válida. Verifique o modelo e tente novamente.",
        imageThinkingNotDisabled:
          "O sistema não conseguiu verificar se o raciocínio do modelo de imagens estava desativado e interrompeu o processamento por segurança.",
        parsingServiceFailed:
          "O serviço de análise de documentos não produziu um resultado utilizável. Tente novamente ou entre em contato com um administrador se o problema persistir.",
        parsingTaskExpired:
          "A tarefa de análise do documento expirou e o reenvio automático falhou. Tente novamente ou entre em contato com um administrador se o problema persistir.",
        parsingInvalid:
          "O documento analisado não passou pela validação de integridade ou segurança.",
        configuration:
          "A configuração de embeddings ou de índice é incompatível com este documento. Verifique a configuração da implantação e tente novamente.",
        serviceAuthentication:
          "A autenticação em um serviço externo de processamento falhou. Peça a um administrador para verificar a configuração da implantação.",
        serviceUnavailable:
          "Uma dependência do processamento de documentos está indisponível. Tente novamente mais tarde.",
        indexingFailed:
          "A gravação ou validação do índice de conhecimento falhou. Tente novamente mais tarde.",
        busy: "Outra tarefa está processando este documento. Tente novamente mais tarde.",
        unknown:
          "O processamento do documento falhou. Tente novamente ou entre em contato com um administrador se o problema persistir.",
      },
      status: {
        processing: "Processando",
        ready: "Pesquisável",
        failed: "Falha no processamento",
        deleted: "Excluído",
      },
      stage: {
        queued: "Aguardando processamento",
        uploading: "Enviando",
        validating: "Validando",
        parsing: "Analisando",
        chunking: "Gerando trechos filhos",
        image_understanding: "Compreendendo imagens do documento",
        parenting: "Criando trechos pais",
        embedding: "Gerando embeddings",
        indexing: "Gravando índice",
        activating: "Ativando o novo índice",
        processing: "Processando",
      },
    },
    upload: {
      action: "Enviar documentos",
      title: "Enviar documentos",
      ocrLabel: "Ativar OCR",
      ocrDescription:
        "Reconheça textos em digitalizações e imagens. Ativar o OCR aumenta o tempo de processamento dos documentos.",
      ocrRecommendedForImages:
        "Os arquivos selecionados incluem imagens. Ative o OCR para este lote para reconhecer seus textos.",
      enableOcrForBatch: "Ativar OCR para este lote",
      sourceType: "Origem do envio",
      sourceTypeDescription:
        "Escolha um ou mais arquivos ou preserve a hierarquia de uma pasta local.",
      filesMode: "Arquivos",
      folderMode: "Pasta",
      chooseFiles: "Escolher documentos",
      chooseFolder: "Escolher pasta local",
      limits:
        "Até {{maxFileSize}} por arquivo e {{maxFiles}} documentos por seleção.",
      loadingLimits: "Carregando os limites de envio da implantação.",
      queue: "Fila de envio",
      queueSummary: "{{total}} arquivos, {{waiting}} aguardando",
      start: "Iniciar envio ({{count}})",
      locateExisting: "Ver documento existente",
      replace: "Substituir documento existente",
      keepBoth: "Manter ambos",
      resolveConflict: "Resolver conflito de nomes",
      conflictTitle: "Resolver conflito de nome do documento",
      conflictDescription:
        "“{{incoming}}” tem o mesmo nome que “{{existing}}”, mas conteúdo diferente. Escolha como tratar este arquivo.",
      confirmedName: "Nome confirmado pelo servidor: {{name}}",
      batch: {
        runningTitle: "Enviando e processando documentos",
        attentionTitle: "Alguns documentos precisam de atenção",
        completedTitle: "Processamento do lote de documentos concluído",
        summary: "{{completed}} / {{total}} documentos processados",
        issues: "{{count}} documentos não foram concluídos com sucesso",
        viewDetails: "Ver detalhes",
      },
      state: {
        waiting: "Aguardando envio",
        uploading: "Enviando",
        processing: "Enviado e em processamento",
        ready: "Processamento concluído",
        duplicate: "Conteúdo duplicado",
        conflict: "Conflito de nomes",
        skipped: "Ignorado",
        failed: "Falha no envio",
      },
      errors: {
        unsupportedFormat: "Este formato de arquivo não é compatível.",
        emptyFile: "Não é possível enviar arquivos vazios.",
        fileTooLarge:
          "O arquivo excede o limite de {{maxFileSize}} por arquivo.",
        tooManyFiles: "Selecione no máximo {{maxFiles}} arquivos por vez.",
      },
    },
    share: {
      action: "Compartilhar",
      title: "Compartilhar base de conhecimento",
      description:
        "Conceda acesso a esta base de conhecimento a um usuário ou grupo de usuários.",
      targetType: "Compartilhar com",
      permissionDescription:
        "Os destinatários podem visualizar e pesquisar o conteúdo, mas não podem gerenciar documentos nem compartilhamentos.",
      user: "Usuário",
      group: "Grupo de usuários",
      selectTarget: "Escolha um destinatário",
      searchUserPlaceholder: "Pesquisar usuários por nome ou e-mail…",
      searchGroupPlaceholder: "Pesquisar grupos de usuários por nome…",
      loadingTargets: "Carregando destinatários",
      noTargets: "Nenhum destinatário correspondente",
      removeTarget: "Remover destinatário {{name}}",
      additionalTargets: "{{count}} seleções adicionais",
      active: "Compartilhamentos atuais",
      permissionUse: "Acesso de uso",
      empty: "Não compartilhado com usuários ou grupos",
      revokeNamed: "Revogar acesso de {{name}}",
      revokeUserRemoved:
        "O acesso de {{name}} foi revogado. Este usuário não tem outra origem de acesso ativa.",
      revokeUserRetained:
        "O acesso de {{name}} foi revogado. Este usuário ainda tem acesso por {{sources}}.",
      revokeGroupNone:
        "O acesso do grupo {{name}} foi revogado. Nenhum membro ativo do grupo mantém acesso por outra origem atualmente.",
      revokeGroupSome:
        "O acesso do grupo {{name}} foi revogado. Alguns membros ativos ainda têm acesso por {{sources}}. Os detalhes dos membros não são exibidos.",
      revokeGroupAll:
        "O acesso do grupo {{name}} foi revogado. Todos os membros ativos ainda têm acesso por {{sources}}. Os detalhes dos membros não são exibidos.",
      remainingSource: {
        owner: "propriedade da base de conhecimento",
        direct: "outro compartilhamento direto",
        user_group: "outro compartilhamento por grupo de usuários",
      },
      submit: "Adicionar compartilhamento",
      removeDirectSuccess: "O compartilhamento pessoal direto foi removido.",
      removeDirectStillAccessible:
        "O compartilhamento pessoal direto foi removido. Você ainda pode acessar esta base de conhecimento por outra origem ativa.",
      noRemainingAccess:
        "Você não poderá mais acessar esta base de conhecimento após a remoção.",
      remainingAccess:
        "Você ainda poderá acessar esta base de conhecimento por outra origem ativa.",
    },
    preview: {
      title: "Visualização do documento",
      views: "Modo de visualização",
      original: "Original",
      parsed: "Conteúdo analisado",
      parsedDescription:
        "Este é o Markdown analisado da versão do documento exibida.",
      sameVersionDescription:
        "As visualizações original e analisada correspondem à mesma versão atual do documento.",
      exactVersionDescription:
        "Exibindo a versão histórica exata do documento usada nesta citação.",
      citationExcerpt: "Trecho citado",
      unsupportedOriginal:
        "A visualização do original não está disponível para este tipo de arquivo. Veja o conteúdo analisado ou baixe o original.",
      loadingOriginal: "Carregando visualização do original",
      loadingParsed: "Carregando conteúdo analisado",
      assetLoading: "Carregando imagem do documento",
      assetLoadingNamed: "Carregando imagem “{{name}}” do documento",
      assetUnavailable: "Imagem do documento indisponível",
      assetUnavailableNamed:
        "A imagem “{{name}}” do documento está indisponível",
      parsedEmpty: "Este documento não tem conteúdo analisado para exibir",
      downloadOriginal: "Baixar original",
      expand: "Abrir visualização ampliada",
      expandImage: "Abrir uma visualização ampliada de {{name}}",
      openNamed: "Visualizar documento {{name}}",
      backToKnowledgeBase: "Voltar à base de conhecimento",
    },
    citation: {
      title: "Citação de conhecimento",
      loading: "Localizando citação de conhecimento",
      back: "Voltar à tarefa",
      source: "Citação [{{number}}] · {{knowledgeBase}}",
      location: "Localização da fonte: {{location}}",
      historicalUnavailableTitle:
        "O conteúdo histórico da citação está indisponível",
      historicalUnavailableDescription:
        "A base de conhecimento ou o documento de origem foi excluído. Seu conteúdo, a visualização do original e o download não estão mais disponíveis. Restam apenas o nome histórico e o resumo da localização da fonte registrados na resposta.",
      inlinePreviewUnavailable:
        "Não foi possível carregar o trecho citado. Selecione o marcador para abrir os detalhes da citação.",
      pages: "Páginas {{values}}",
      documentLevel: "Fonte no nível do documento",
    },
  },
  adminKnowledge: {
    title: "Bases de conhecimento",
    description:
      "Administre os metadados das bases de conhecimento de diferentes usuários e configure fontes de conhecimento sem acesso ao conteúdo, às visualizações ou aos downloads dos documentos.",
    tabsLabel: "Seções da base de conhecimento",
    tabs: {
      knowledgeBases: "Bases de conhecimento",
      sources: "Fontes de conhecimento",
    },
    search: "Pesquisar bases de conhecimento ou proprietários",
    empty: "Nenhuma base de conhecimento correspondente",
    ownerDisabled: "Proprietário desativado",
    lifecycle: {
      label: "Ciclo de vida",
      all: "Todos os ciclos de vida",
      active: "Ativo",
      archived: "Arquivado",
      deleted: "Excluído",
    },
    availability: {
      label: "Disponibilidade",
      all: "Todos os estados de disponibilidade",
      enabled: "Ativado",
      disabled: "Desativado",
    },
    columns: {
      knowledgeBase: "Base de conhecimento",
      owner: "Proprietário",
      documents: "Documentos",
      storage: "Armazenamento",
      shares: "Permissões de compartilhamento",
      diagnostics: "Diagnóstico",
    },
    documentSummary: "{{total}} no total · {{ready}} pesquisáveis",
    documentIssues: "{{processing}} em processamento · {{failed}} com falha",
    shareCount: "{{count}} permissões ativas",
    pagination: {
      label: "Paginação da lista de bases de conhecimento",
      page: "Página {{page}}",
    },
    revokeNamed: "Revogar a permissão de compartilhamento de {{name}}",
    cleanup: "Limpeza: {{status}}",
    cleanupStatus: {
      pending: "Pendente",
      running: "Em execução",
      failed: "Falhou",
      completed: "Concluído",
    },
    noDiagnostics: "Sem problemas",
    actionsFor: "Administrar base de conhecimento {{name}}",
    archiveBeforeDelete:
      "A exclusão ainda exige uma confirmação separada após o arquivamento. Esta ação não exclui a base de conhecimento.",
    reason: "Motivo",
    reasonHint:
      "Obrigatório. O motivo é registrado em uma entrada de auditoria com dados sensíveis ocultados.",
    actions: {
      disable: "Desativar",
      enable: "Ativar",
      archive: "Arquivar",
      transferOwner: "Transferir propriedade",
      retryCleanup: "Tentar limpeza novamente",
      delete: "Excluir permanentemente",
    },
    feedback: {
      disable: "Base de conhecimento desativada.",
      enable: "Base de conhecimento ativada.",
      archive: "Base de conhecimento arquivada.",
      delete: "Exclusão da base de conhecimento solicitada.",
      cleanup_retry: "Nova tentativa de limpeza solicitada.",
      revoke_grant: "Permissão de compartilhamento revogada.",
      transfer_owner: "Propriedade da base de conhecimento transferida.",
    },
    confirm: {
      disable: {
        title: "Desativar base de conhecimento?",
        description:
          "Os usuários não poderão pesquisar nem usar o conteúdo de “{{name}}” enquanto ela estiver desativada.",
        action: "Desativar",
      },
      enable: {
        title: "Ativar base de conhecimento?",
        description:
          "As permissões ativas existentes de “{{name}}” poderão ser usadas novamente.",
        action: "Ativar",
      },
      archive: {
        title: "Arquivar base de conhecimento?",
        description: "“{{name}}” ficará somente leitura após ser arquivada.",
        action: "Arquivar",
      },
      delete: {
        title: "Excluir base de conhecimento permanentemente?",
        description:
          "Exclua permanentemente a base de conhecimento arquivada “{{name}}”. Esta ação não pode ser desfeita.",
        action: "Excluir permanentemente",
      },
      cleanup_retry: {
        title: "Tentar limpeza dos recursos novamente?",
        description:
          "Execute novamente as tarefas de limpeza que falharam para a base de conhecimento “{{name}}”.",
        action: "Tentar limpeza novamente",
      },
      revoke_grant: {
        title: "Revogar permissão de compartilhamento?",
        description: "Remova o acesso de “{{name}}” à base de conhecimento.",
        action: "Revogar",
      },
    },
    transfer: {
      title: "Transferir propriedade da base de conhecimento",
      description:
        "Escolha um novo usuário ativo como proprietário da base de conhecimento “{{name}}”.",
      owner: "Novo proprietário",
      search: "Pesquisar usuários",
      select: "Selecionar um novo proprietário",
      action: "Transferir propriedade",
    },
  },
  presentation: {
    previewTitle: "Visualizar apresentação {{name}}",
    loading: "Carregando apresentação",
    loadFailed:
      "Não foi possível visualizar esta apresentação. Tente novamente.",
    close: "Fechar visualização da apresentação",
    download: "Baixar",
    downloadNamed: "Baixar apresentação {{name}}",
    zoomOut: "Diminuir zoom da apresentação",
    zoomIn: "Aumentar zoom da apresentação",
    resetZoom: "Redefinir zoom da apresentação",
    enterFullscreen: "Visualizar apresentação em tela cheia",
    exitFullscreen: "Sair da visualização em tela cheia",
    resizePreview: "Redimensionar visualização da apresentação",
    slideCount: "{{current}} / {{total}}",
    toggleSlideNavigator: "Mostrar ou ocultar miniaturas dos slides",
    slideNavigator: "Miniaturas dos slides",
    goToSlide: "Ir para o slide {{slide}}",
    selectElement: "Selecionar elemento da apresentação",
    askLinkSense: "Perguntar ao {{productName}}",
    askShortcut: "⌘I",
    selectionPromptLabel:
      "Perguntar ao {{productName}} sobre os elementos selecionados",
    selectionPromptPlaceholder: "Descreva uma alteração ou faça uma pergunta",
    selectionPromptSubmit: "Adicionar anotação",
    selectionPromptError:
      "Não foi possível adicionar a anotação. Tente novamente.",
    selectionStatus: "{{count}} elementos selecionados no slide {{slide}}",
  },
  officePreview: {
    zoomGestureHint:
      "Segure Ctrl (⌘ no Mac) e gire a roda do mouse, ou faça um gesto de pinça no trackpad, para ajustar o zoom do documento.",
    previewTitle: "Visualizar documento {{name}}",
    loading: "Carregando documento",
    loadFailed: "Não foi possível visualizar este documento. Tente novamente.",
    close: "Fechar visualização do documento",
    download: "Baixar",
    downloadNamed: "Baixar documento {{name}}",
    enterFullscreen: "Visualizar documento em tela cheia",
    exitFullscreen: "Sair da visualização em tela cheia",
    resizePreview: "Redimensionar visualização do documento",
    updateAvailable: "Atualize para ver o conteúdo mais recente",
    update: "Atualizar visualização",
    dismissUpdate: "Dispensar aviso de atualização",
    annotate: "Adicionar anotação",
    annotating: "Anotando",
    enterAnnotationMode: "Entrar no modo de anotação de arquivo",
    exitAnnotationMode: "Sair do modo de anotação de arquivo",
    askLinkSense: "Perguntar ao {{productName}}",
    askShortcut: "⌘I",
    selectionUnavailableWhileBusy: "A seleção está sendo enviada. Aguarde.",
    selectionPromptLabel: "Perguntar ao {{productName}} sobre a seleção",
    selectionPromptPlaceholder: "Descreva uma alteração ou faça uma pergunta",
    selectionPromptSubmit: "Adicionar anotação",
    selectionPromptError:
      "Não foi possível adicionar a anotação. Tente novamente.",
    annotationBatch: {
      regionLabel: "Anotações pendentes",
      triggerLabel: "Ver {{count}} anotações pendentes",
      count_one: "{{count}} anotação",
      count_other: "{{count}} anotações",
      title: "Anotações pendentes",
      listLabel: "Lista de anotações pendentes",
      presentationLocation: "Slide {{slide}} · {{count}} elementos",
      wordPageLocation: "Página {{page}}",
      wordParagraphLocation: "Parágrafo {{paragraph}}",
      spreadsheetLocation: "{{sheet}} · {{selection}}",
      htmlLocation: "{{count}} elementos HTML",
      locate: "Ir para a anotação {{index}}",
      remove: "Remover anotação {{index}}",
      clear: "Limpar",
      sendAll: "Enviar",
      sendError:
        "Não foi possível enviar as anotações. Elas foram mantidas para uma nova tentativa.",
      limitReached: "Você pode adicionar até 20 anotações por vez.",
    },
  },
  wordPreview: {
    zoomOut: "Diminuir zoom do documento Word",
    zoomIn: "Aumentar zoom do documento Word",
    resetZoom: "Redefinir zoom do documento Word",
    pageCount: "Página {{current}} de {{total}}",
    selectionStatus: "Texto selecionado",
  },
  htmlPreview: {
    frameTitle: "Documento HTML {{name}}",
    annotate: "Anotar",
    annotating: "Anotando",
    enterAnnotationMode: "Entrar no modo de anotação HTML",
    exitAnnotationMode: "Sair do modo de anotação HTML",
    interactionModeStatus:
      "Modo de interação HTML. Os controles da página estão disponíveis.",
    annotationModeStatus:
      "Modo de anotação HTML. Selecione elementos para perguntar ao {{productName}}.",
    zoomOut: "Diminuir zoom do documento HTML",
    zoomIn: "Aumentar zoom do documento HTML",
    resetZoom: "Redefinir zoom do documento HTML",
    selectionStatus: "{{count}} elementos HTML selecionados",
  },
  archivePreview: {
    loading: "Lendo conteúdo do arquivo compactado",
    loadFailed:
      "Não foi possível ler este arquivo compactado. Baixe-o para abri-lo.",
    summary: "{{files}} arquivos · {{folders}} pastas",
    root: "Raiz",
    breadcrumb: "Caminho no arquivo compactado",
    folderTreeLabel: "Pastas do arquivo compactado",
    listLabel: "Lista de arquivos do arquivo compactado",
    searchLabel: "Pesquisar no arquivo compactado",
    searchPlaceholder: "Pesquisar nomes de arquivos ou pastas…",
    name: "Nome",
    type: "Tipo",
    compressedSize: "Compactado",
    originalSize: "Original",
    modifiedAt: "Modificado",
    folder: "Pasta",
    file: "Arquivo",
    encrypted: "Criptografado",
    emptyFolder: "Esta pasta está vazia",
    noSearchResults: "Nenhum arquivo ou pasta correspondente",
    skippedEntries:
      "{{count}} entradas inseguras do arquivo compactado estão ocultas.",
    previewFile: "Visualizar {{name}}",
    backToFiles: "Voltar à lista de arquivos",
    entryLoading: "Lendo {{name}}",
    entryLoadFailed:
      "Não foi possível ler este arquivo dentro do arquivo compactado. Tente novamente.",
    entryPreview: "Visualização somente leitura de {{name}}",
  },
  filePreview: {
    loading: "Carregando visualização",
    loadFailed: "Não foi possível visualizar este arquivo. Tente novamente.",
    readOnly: "Somente leitura",
    codeContent: "Conteúdo de código somente leitura de {{name}}",
    wrap: "Quebrar linhas",
    enableWrap: "Ativar quebra de linhas",
    disableWrap: "Desativar quebra de linhas",
    contentTruncated:
      "Somente a primeira parte deste arquivo é exibida para manter a visualização responsiva.",
    binaryContent:
      "Este arquivo contém dados binários que não podem ser exibidos como texto.",
    contentUnavailable: "O conteúdo da visualização está indisponível.",
    csvFailed: "Não foi possível ler esta tabela.",
    csvSummary: "{{rows}} linhas · {{columns}} colunas",
    tableTruncated:
      "Somente parte desta tabela é exibida para manter a visualização responsiva.",
    emptyTable: "Esta tabela está vazia.",
    unnamedColumn: "Coluna {{index}}",
    pdfLoading: "Renderizando PDF",
    pdfFailed: "Não foi possível renderizar este PDF.",
    imageFailed: "Não foi possível carregar esta imagem.",
    mediaFailed: "Não foi possível carregar este arquivo de mídia.",
    mediaUnsupported:
      "Seu navegador não consegue reproduzir este arquivo de mídia.",
  },
  spreadsheetPreview: {
    zoomOut: "Diminuir zoom da pasta de trabalho do Excel",
    zoomIn: "Aumentar zoom da pasta de trabalho do Excel",
    resetZoom: "Redefinir zoom da pasta de trabalho do Excel",
    sheetTabsLabel: "Planilhas",
    selectionStatus: {
      range: "{{address}} selecionado na planilha {{sheet}}",
      image: "Imagem {{name}} selecionada na planilha {{sheet}}",
      chart: "Gráfico {{name}} selecionado na planilha {{sheet}}",
    },
  },
  projects: {
    nameExists: "Já existe um projeto com este nome. Escolha outro nome",
    notFound: "Este projeto está indisponível. Escolha outro projeto",
    taskActive:
      "Conclua as tarefas ativas antes de movê-las ou remover seu projeto",
    empty: "Nenhuma tarefa ainda",
    create: "Novo projeto",
    createDescription:
      "As tarefas de um projeto compartilham arquivos e mantêm históricos de mensagens separados.",
    edit: "Editar projeto",
    editAction: "Editar",
    appearance: {
      choose: "Escolher ícone e cor do projeto",
      icon: "Ícone do projeto",
      color: "Cor do ícone",
      done: "Concluído",
      colors: {
        default: "Padrão",
        red: "Vermelho",
        orange: "Laranja",
        yellow: "Amarelo",
        green: "Verde",
        blue: "Azul",
        purple: "Roxo",
        pink: "Rosa",
        teal: "Verde-azulado",
        cyan: "Ciano",
        brown: "Marrom",
        gray: "Cinza",
      },
      icons: {
        folder: "Pasta",
        coins: "Finanças",
        book: "Leitura",
        "graduation-cap": "Aprendizado",
        pencil: "Escrita",
        "pen-tool": "Design",
        braces: "Código",
        terminal: "Terminal",
        music: "Música",
        popcorn: "Filmes",
        brush: "Pintura",
        palette: "Arte",
        stethoscope: "Saúde",
        asterisk: "Asterisco",
        flower: "Flor",
        briefcase: "Trabalho",
        "chart-column": "Dados",
        medal: "Medalha",
        dumbbell: "Exercícios",
        notebook: "Notas",
        scale: "Direito",
        globe: "Globo",
        plane: "Viagens",
        earth: "Mundo",
        wrench: "Ferramentas",
        "paw-print": "Animais de estimação",
        flask: "Ciência",
        brain: "Raciocínio",
        heart: "Coração",
        sprout: "Plantas",
      },
    },
    reorderHandle:
      "Use o teclado para reordenar o projeto “{{title}}”, atualmente na posição {{position}}",
    sidebarDragInstructions:
      "Pressione Espaço para selecionar uma tarefa ou projeto, use as setas para cima e para baixo para mudar a posição e pressione Espaço para salvar. Pressione Escape para cancelar. Tarefas também podem ser movidas para outros projetos.",
    reorderStarted: "Projeto “{{title}}” selecionado na posição {{position}}.",
    reorderOver:
      "O projeto “{{title}}” será movido para a posição {{position}}.",
    reorderCompleted: "Projeto “{{title}}” movido para a posição {{position}}.",
    reorderCancelled: "Movimentação do projeto cancelada.",
    dragSaving: "Salvando ordem dos projetos.",
    dragSaveFailed:
      "Não foi possível salvar a ordem dos projetos. Tente novamente.",
    delete: "Remover projeto",
    move: "Mover para projeto",
    moveNamed: "Mover “{{title}}” para um projeto",
    name: "Nome do projeto",
    namePlaceholder: "Insira um nome de projeto",
    search: "Pesquisar projetos",
    noResults: "Nenhum projeto correspondente",
    choose: "Projeto",
    projectless: "Espaço de trabalho comum",
    selectPlaceholder: "Selecionar projeto",
    clearSelection: "Limpar seleção de projeto",
    unavailable: "Projeto indisponível",
    loadError: "Não foi possível carregar os projetos de tarefas",
    deleteDescription:
      "Remover “{{name}}” move suas tarefas para o espaço de trabalho comum. As conversas e os arquivos originais do projeto são mantidos. O trabalho futuro usa o espaço de trabalho comum.",
  },
  conversation: {
    untitled: "Tarefa sem título",
    title: "Tarefa",
    taskSort: {
      open: "Definir a ordem das tarefas em {{section}}",
      label: "Ordem das tarefas",
      priority: "Prioridade",
      priorityDescription:
        "Tarefas que precisam da sua resposta e tarefas não lidas aparecem primeiro.",
      updated_at: "Última atualização",
      manual: "Ordem manual",
    },
    share: {
      action: "Compartilhar",
      title: "Compartilhar {{title}}",
      description:
        "Somente o conteúdo visualizado abaixo é compartilhado, sem seu nome. Mensagens posteriores ou novos compartilhamentos não alteram o conteúdo deste link.",
      previewLabel: "Prévia da tarefa compartilhada",
      anyoneWithLink:
        "Qualquer pessoa com este link pode visualizar esta tarefa",
      copyLink: "Copiar link",
      copied: "Copiado",
      copyFailed:
        "Não foi possível copiar o link. Verifique as permissões do navegador e tente novamente.",
      unavailable:
        "Este link compartilhado não existe ou não está mais disponível.",
      continueInProduct: "Continuar no {{productName}}",
    },
    rename: "Renomear",
    archive: "Arquivar tarefa",
    archivedNotification: "Tarefa arquivada",
    undoArchive: "Desfazer",
    undoingArchive: "Desfazendo arquivamento…",
    archiveUndone: "Arquivamento desfeito",
    archiveNamed: "Arquivar tarefa “{{title}}”",
    pin: "Fixar tarefa",
    pinNamed: "Fixar tarefa “{{title}}”",
    unpin: "Desafixar",
    unpinNamed: "Desafixar tarefa “{{title}}”",
    reorderHandle:
      "Use o teclado para reordenar a tarefa “{{title}}”, atualmente na posição {{position}}",
    reorderInstructions:
      "Pressione Espaço para selecionar uma tarefa, use as setas para cima e para baixo para reordená-la ou selecionar uma categoria e pressione Espaço para salvar. Pressione Escape para cancelar.",
    reorderStarted: "Tarefa “{{title}}” selecionada na posição {{position}}.",
    reorderOver:
      "A tarefa “{{title}}” será movida para a posição {{position}}.",
    reorderCompleted: "Tarefa “{{title}}” movida para a posição {{position}}.",
    reorderCancelled: "Movimentação da tarefa cancelada.",
    dragProjectOver: "Solte a tarefa “{{title}}” no projeto “{{project}}”.",
    dragProjectCompleted:
      "Tarefa “{{title}}” movida para o projeto “{{project}}”.",
    dragSaving: "Salvando posição da tarefa.",
    dragSaveFailed:
      "Não foi possível salvar a posição da tarefa. Tente novamente.",
    unpinBlockedTitle: "Não foi possível desafixar a tarefa",
    unarchive: "Desarquivar",
    unarchiveNamed: "Desarquivar tarefa “{{title}}”",
    delete: "Excluir tarefa",
    deleteNamed: "Excluir tarefa “{{title}}”",
    deleteTitle: "Excluir esta tarefa permanentemente?",
    deleteDescription:
      "O conteúdo da tarefa não pode ser recuperado. Os arquivos gerados e os metadados mínimos de rastreamento são mantidos permanentemente, mas não podem ser restaurados nem baixados novamente.",
    clearArchived: "Limpar tudo",
    clearArchivedTitle: "Limpar todas as tarefas arquivadas?",
    clearArchivedDescription:
      "Todas as tarefas arquivadas serão excluídas permanentemente e não poderão ser recuperadas. Aplicativos, rascunhos de desenvolvimento e histórico das conversas de depuração continuam disponíveis em Meus aplicativos, onde você pode continuar o desenvolvimento ou excluí-los. Outras tarefas ativas não são afetadas. Os arquivos gerados e os metadados mínimos de rastreamento são mantidos conforme a política do sistema.",
    clearingArchived: "Limpando tarefas arquivadas…",
    clearArchivedPartial:
      "{{deleted}} tarefas limpas; {{remaining}} tarefas ainda não puderam ser limpas.",
    clearArchivedBusy:
      "Esta tarefa está sendo processada ou interrompida. Tente novamente em breve.",
    clearArchivedSuccess: "{{count}} tarefas arquivadas limpas.",
    searchTitle: "Pesquisar",
    searchPlaceholder:
      "Pesquisar títulos, mensagens, anexos, arquivos gerados, plugins ou habilidades…",
    archivedSearchPlaceholder:
      "Pesquisar títulos, mensagens ou anexos de tarefas arquivadas…",
    archivedSortLabel: "Ordenar tarefas arquivadas",
    archivedSortNewest: "Atualizadas recentemente",
    archivedSortOldest: "Atualizadas há mais tempo",
    archivedProjectLabel: "Filtrar por projeto",
    archivedAllProjects: "Todos os projetos",
    archivedSearchEmpty:
      "Nenhuma tarefa arquivada corresponde a estes filtros.",
    searchEmpty: "Nenhum resultado encontrado",
    listEmpty:
      "Nenhuma tarefa ainda. Comece diretamente pelo campo de mensagem.",
    newTaskWelcome: "O que vamos fazer juntos no {{productName}}?",
    creditQuotaBlocked: {
      title: "O limite de uso de tokens foi esgotado",
      description:
        "Sua cota de créditos disponível foi esgotada. Você não pode iniciar novas tarefas nem enviar novas solicitações agora; tarefas em execução não são afetadas.",
      dismiss: "Dispensar aviso de uso",
    },
    starterQuestions: {
      label: "Sugestões de tarefas comuns",
      analyzeFile: {
        title: "Analisar um arquivo",
        description: "Extraia pontos principais, riscos e ações",
        prompt:
          "Analise o arquivo que eu enviar. Extraia as principais conclusões, os riscos mais relevantes e as ações necessárias, em ordem de importância.",
      },
      searchKnowledge: {
        title: "Pesquisar conhecimento interno",
        description:
          "Responda com base em bases de conhecimento e cite as fontes",
        prompt:
          "Responda à pergunta a seguir usando as bases de conhecimento que eu selecionar. Cite as fontes de apoio e informe claramente quando as informações disponíveis forem insuficientes:",
      },
      analyzeData: {
        title: "Analisar dados de planilhas",
        description: "Encontre tendências e anomalias e crie gráficos",
        prompt:
          "Analise o arquivo Excel ou CSV que eu enviar. Identifique as principais métricas, tendências e anomalias, explique as causas prováveis e crie gráficos com um resumo conciso.",
      },
      createDeliverable: {
        title: "Criar um material de trabalho",
        description: "Elabore um plano, relatório ou apresentação",
        prompt:
          "Usando os materiais que eu fornecer, crie um [plano/relatório/apresentação] claro e pronto para uso sobre [assunto], voltado a [público].",
      },
    },
    archivedTaskCount_one: "{{count}} tarefa",
    archivedTaskCount_other: "{{count}} tarefas",
    archivedEmpty: "Nenhuma tarefa arquivada.",
    unavailable: "Não foi possível carregar a tarefa. Tente novamente.",
    messageInput: "Campo de mensagem da tarefa",
    messageNavigation: "Navegação pelas mensagens da tarefa",
    awaitingAssistant: "A IA está respondendo…",
    historyLoading: "Carregando mensagens…",
    historyExchange: "Interação {{count}}",
    historyViewExchange: "Clique para visualizar esta interação",
    historyRetry: "Não foi possível carregar as mensagens. Tentar novamente",
    scrollToBottom: "Rolar até o final",
    placeholder: "Descreva o que você quer que o {{productName}} faça…",
    followUpPlaceholder: "Adicione uma nova mensagem…",
    send: "Enviar",
    model: "Modelo",
    modelSelector: "Escolher modelo e esforço de raciocínio",
    resetReasoningEffort: "Redefinir esforço de raciocínio para o padrão",
    modelNotConfigured: "Serviço de modelos não configurado",
    reasoningEffort: "Esforço de raciocínio",
    modelContextUsageUnknown: "Nenhum uso ainda",
    modelContextBadgeLabel: "Janela de contexto em segundo plano: {{value}}",
    modelContextTitle: "Janela de contexto em segundo plano:",
    modelContextUsagePercent: "{{percent}}% usados",
    modelContextUsageDetail: "{{used}} usados, {{total}} no total",
    modelContextUnavailable: "Nenhum uso de contexto ainda",
    stop: "Parar",
    interrupting: "Interrompendo…",
    attach: "Anexar arquivo",
    attachFolder: "Anexar pasta",
    dropFilesToAttach: "Solte para enviar arquivos",
    removeAttachment: "Remover anexo {{name}}",
    attachmentUploading: "Enviando anexo…",
    attachmentUploadingName: "Enviando anexo {{name}}",
    attachmentUploadingShort: "Enviando",
    attachmentOverflowLabel: "Ver todos os {{count}} anexos",
    attachmentListTitle: "Todos os anexos ({{count}})",
    clearAllAttachments: "Limpar tudo",
    pastedTextFilePrefix: "Texto colado",
    pastedTextAttachmentUploading: "Adicionando texto colado como anexo…",
    pastedTextAttachmentMeta: "{{characters}} caracteres · {{size}}",
    pastedTextAttachmentPlaceholder:
      "Descreva como deseja que este anexo seja tratado…",
    pastedTextAttachmentPreview: "Visualizar conteúdo colado {{name}}",
    previewImage: "Visualizar imagem {{name}}",
    imagePreviewTitle: "Visualização da imagem",
    imagePreviewDescription: "Visualize uma imagem enviada como anexo.",
    previousImage: "Imagem anterior",
    nextImage: "Próxima imagem",
    zoomOut: "Diminuir zoom",
    zoomIn: "Aumentar zoom",
    previewLoading: "Carregando imagem {{name}}",
    previewLoadFailed: "Não foi possível visualizar a imagem {{name}}",
    inlineImage: "imagem da mensagem",
    inlineImageUnavailable: "Imagem indisponível",
    openKnowledgeCitation: "Abrir citação de conhecimento {{number}}",
    previewPresentation: "Visualizar apresentação {{name}}",
    previewDocument: "Visualizar documento {{name}}",
    previewHtml: "Visualizar documento HTML {{name}}",
    previewArchive: "Visualizar arquivo compactado {{name}}",
    previewFile: "Visualizar arquivo {{name}}",
    openPreview: "Abrir visualização",
    presentationAnnotation: "Anotação da apresentação: {{name}}",
    presentationAnnotationCount_one: "{{count}} anotação",
    presentationAnnotationCount_other: "{{count}} anotações",
    officeAnnotation: "Anotação do documento: {{name}}",
    officeAnnotationCount_one: "{{count}} anotação",
    officeAnnotationCount_other: "{{count}} anotações",
    applicationAnnotation: "Anotações do aplicativo: {{name}}",
    htmlAnnotation: "Anotação HTML: {{name}}",
    htmlAnnotationCount_one: "{{count}} anotação",
    htmlAnnotationCount_other: "{{count}} anotações",
    voice: "Entrada por voz",
    voiceChecking: "Verificando o serviço de transcrição de voz…",
    voiceNotConfigured: "A transcrição de voz não foi configurada",
    voiceServiceUnavailable:
      "A transcrição de voz está temporariamente indisponível. Tente novamente mais tarde.",
    voiceStop: "Parar entrada por voz",
    voiceRecording: "Gravando",
    voiceDuration: "Duração da gravação",
    voiceTranscribing: "Transcrevendo voz…",
    voiceUnavailable:
      "A entrada por voz está indisponível. Verifique o suporte do navegador e a permissão do microfone.",
    voiceUnsupported:
      "Este navegador não pode gravar áudio. Use um navegador com suporte à gravação pelo microfone.",
    voicePermissionDenied:
      "A permissão do microfone está desativada. Permita o acesso ao microfone nesta página e tente novamente.",
    voiceDeviceNotFound:
      "Nenhum microfone foi detectado. Verifique seu dispositivo e tente novamente.",
    voiceDeviceUnavailable:
      "O microfone está indisponível. Verifique a permissão do sistema ou se outro aplicativo está usando-o.",
    voiceRecordingFailed:
      "A gravação falhou. Verifique seu microfone e tente novamente.",
    voiceRecordingTimeout:
      "O tempo para salvar a gravação se esgotou. Tente novamente.",
    voiceTooShort: "A gravação é muito curta. Grave por pelo menos 1 segundo.",
    voiceTooLarge:
      "A gravação é muito grande. Reduza a duração e tente novamente.",
    voiceTimeout:
      "O tempo de reconhecimento de voz se esgotou. Tente novamente.",
    voiceNoContent:
      "Nenhuma fala foi reconhecida. Tente novamente ou digite o texto manualmente.",
    slashCommands: {
      menuLabel: "Menu de ações",
      back: "Voltar às ações",
      noMatches: "Nenhuma ação correspondente",
      newTask: "Nova tarefa",
      newTaskDescription: "Iniciar uma nova tarefa em branco",
      compact: "Compactar contexto",
      compactDescription: "Compactar contexto após a tarefa atual parar",
      plugins: "Lista de plugins",
      pluginsDescription: "Ver e selecionar plugins disponíveis",
      pluginsTitle: "Plugins",
      skills: "Lista de habilidades",
      skillsDescription: "Ver e selecionar habilidades disponíveis",
      skillsTitle: "Habilidades",
      applications: "Lista de aplicativos",
      applicationsDescription: "Escolher um aplicativo e iniciar sua tarefa",
      applicationsTitle: "Aplicativos",
      knowledgeBases: "Lista de bases de conhecimento",
      knowledgeBasesDescription:
        "Ver e selecionar bases de conhecimento disponíveis",
      knowledgeBasesTitle: "Bases de conhecimento",
      mcp: "Status do MCP",
      mcpDescription: "Mostrar o status dos servidores MCP pessoais",
      mcpTitle: "MCP",
      applicationManagedDescription:
        "Este recurso é gerenciado pelo aplicativo",
      emptyCapabilities: "Nenhum recurso de {{type}} disponível",
      selected: "Selecionados",
      personal: "Pessoal",
      available: "Disponível",
      owned: "Meus",
      shared: "Compartilhados",
      unavailable: "Indisponível",
      enabled: "Ativado",
      disabled: "Desativado",
      mcpNoAuthentication: "Sem autenticação",
      mcpCredentialMissing: "Credencial de autenticação ausente",
      mcpAuthenticationConfigured: "Autenticação {{method}} configurada",
      mcpStdioConfigured: "STDIO · {{count}} variáveis de ambiente",
    },
    skillCommands: {
      menuLabel: "Menu de seleção de habilidades",
      noMatches: "Nenhuma habilidade correspondente",
    },
    addMenu: "Adicionar",
    addMenuTitle: "Adicionar conteúdo",
    addGroup: "Adicionar",
    attachFileMenuLabel: "Arquivos locais",
    attachFileMenuSearchValue: "arquivos locais anexos envio",
    referenceFile: {
      menuLabel: "Referenciar arquivo",
      menuSearchValue: "referenciar arquivo tarefas anteriores pesquisa",
      title: "Referenciar arquivo de uma tarefa anterior",
      description:
        "Escolha um arquivo de uma tarefa anterior para adicionar à mensagem.",
      searchPlaceholder: "Pesquisar nomes de arquivos…",
      empty: "Nenhum arquivo disponível para referência",
      selectFile: "Selecionar {{filename}} de {{task}}",
      deselectFile: "Desmarcar {{filename}} de {{task}}",
      addSelected: "Adicionar arquivos selecionados ({{count}})",
      addFailed:
        "Não foi possível adicionar os arquivos selecionados. Tente novamente.",
    },
    attachFolderMenuLabel: "Pastas",
    attachFolderMenuSearchValue: "pastas diretórios anexos envio",
    capabilitySearch: "Pesquisar plugins ou habilidades disponíveis…",
    pluginGroup: "Plugins",
    skillGroup: "Habilidades",
    noCapabilities: "Nenhum plugin ou habilidade disponível",
    capabilityUnavailable:
      "Não foi possível carregar os plugins ou habilidades disponíveis. Tente novamente.",
    goal: {
      regionLabel: "Status do objetivo",
      menuLabel: "Objetivo",
      menuSearchValue: "objetivo tarefa longa continuação automática",
      menuDescription:
        "Continuar trabalhando até concluir ou precisar de atenção",
      modeLabel: "Objetivo",
      disableMode: "Sair do modo Objetivo",
      placeholder:
        "Descreva seu objetivo e defina resultados mensuráveis para obter resultados melhores.",
      startUnavailable:
        "Esta tarefa já tem um objetivo ou ainda tem uma execução ativa.",
      statusLabel: {
        active: "Objetivo em andamento",
        paused: "Objetivo pausado",
        blocked: "Objetivo precisa de atenção",
        usageLimited: "Objetivo limitado pelo uso",
        budgetLimited: "Objetivo limitado pelo orçamento",
        complete: "Objetivo concluído",
      },
      statusDescription: {
        active:
          "O sistema continua automaticamente após cada execução até concluir o objetivo.",
        paused:
          "O objetivo está pausado e não continuará após o término da execução atual.",
        blocked:
          "O objetivo precisa de uma mudança externa ou da sua resposta para continuar.",
        usageLimited: "O objetivo parou devido ao limite de uso atual.",
        budgetLimited: "O objetivo atingiu o orçamento de tokens configurado.",
        complete: "O sistema marcou este objetivo como concluído.",
      },
      elapsedLabel: "Tempo utilizado",
      edit: "Editar objetivo",
      pause: "Pausar objetivo",
      resume: "Retomar objetivo",
      clear: "Limpar objetivo",
      details: "Ver detalhes do objetivo",
      editTitle: "Editar objetivo",
      editDescription:
        "Editar o objetivo preserva o tempo e os tokens já utilizados.",
      detailsTitle: "Detalhes do objetivo",
      objective: "Finalidade",
      tokenBudget: "Orçamento de tokens",
      noTokenBudget: "Sem limite",
      tokensUsed: "Tokens usados",
      completedInline: "Objetivo alcançado em {{duration}}",
      clearTitle: "Limpar este objetivo?",
      clearDescription:
        "O status e o registro de uso do objetivo serão removidos desta tarefa. A execução nativa atual não será interrompida à força.",
    },
    plan: {
      menuLabel: "Modo Planejamento",
      menuSearchValue: "modo planejamento analisar planejar",
      menuDescription: "Analisar e elaborar um plano antes de implementar",
      modeLabel: "Plano",
      disableMode: "Sair do modo Planejamento",
      placeholder:
        "Descreva a tarefa a analisar e planejar. O LinkSense fará perguntas e elaborará um plano primeiro.",
    },
    proposedPlan: {
      title: "Plano",
    },
    planDecision: {
      title: "Implementar este plano?",
      description: "Implemente agora, sugira alterações ou deixe para depois.",
      implement: "Sim, implementar este plano",
      implementDescription:
        "Mudar para o modo Padrão e iniciar a implementação.",
      implementing: "Iniciando implementação",
      revise: "Não, revisar o plano primeiro",
      reviseInline: "Não, informar ao LinkSense o que deve mudar",
      reviseDescription: "Informe ao LinkSense o que deve mudar.",
      revisionForm: "Revisar o plano",
      revisionLabel: "Observações para revisão",
      revisionDescription:
        "O LinkSense permanecerá no modo Planejamento e produzirá um plano revisado completo com base no seu feedback.",
      revisionPlaceholder: "Descreva o que deseja alterar",
      submitRevision: "Enviar observações para revisão",
      submittingRevision: "Enviando observações para revisão",
      back: "Voltar",
      dismiss: "Pular",
      dismissing: "Pulando",
      dismissDescription:
        "Pular por enquanto e permanecer no modo Planejamento",
      exit: "Sair do modo Planejamento",
      exiting: "Saindo do modo Planejamento",
      exitDescription: "Sair do modo Planejamento sem iniciar a implementação",
    },
    userInput: {
      asyncDescription:
        "O LinkSense pode continuar trabalhando enquanto você responde. Você também pode responder após a conclusão.",
      title: "Sua resposta é necessária",
      formTitle: "Confirme estes detalhes",
      formResultTitle: "Formulário concluído",
      description:
        "Responda a estas perguntas para que o LinkSense possa continuar o plano.",
      autoResolveDescription:
        "Responda assim que possível. Esta pergunta será fechada automaticamente quando o tempo se esgotar.",
      other: "Outro",
      answerPlaceholder: "Insira sua resposta",
      secretDescription:
        "O valor inserido não será exibido na interface da tarefa.",
      submit: "Enviar respostas",
      submitting: "Enviando",
      cancel: "Cancelar",
      selectPlaceholder: "Selecione uma opção",
      datePlaceholder: "Selecionar data",
      clearDate: "Limpar data",
      hour: "Hora",
      minute: "Minuto",
      booleanYes: "Sim",
      booleanNo: "Não",
      status: {
        pending: "Pendente",
        submitting: "Enviando",
        submitted: "Enviado",
        approved: "Aprovado",
        rejected: "Rejeitado",
        cancelled: "Cancelado",
        expired: "Expirado",
        terminated: "Encerrado",
      },
      validation: {
        required: "Este campo é obrigatório.",
        invalid: "O valor é inválido.",
        invalidEmail: "Insira um endereço de e-mail válido.",
        invalidUri: "Insira uma URL válida, incluindo o protocolo.",
        invalidDate: "Selecione uma data válida.",
        invalidDateTime: "Selecione uma data e hora válidas.",
        invalidNumber: "Insira um número válido.",
        integer: "Insira um número inteiro.",
        minimum: "Deve ser no mínimo {{value}}.",
        maximum: "Deve ser no máximo {{value}}.",
        minimumSelections: "Selecione pelo menos {{count}} opção(ões).",
        maximumSelections: "Selecione no máximo {{count}} opção(ões).",
        minimumLength: "Insira pelo menos {{count}} caractere(s).",
        maximumLength: "Insira no máximo {{count}} caractere(s).",
      },
    },
    priorityHint: "Solicitado neste turno",
    selectedCapabilities: "Plugins ou habilidades selecionados",
    selectedKnowledgeBases: "Bases de conhecimento deste turno",
    selectedResources:
      "Bases de conhecimento, plugins e habilidades selecionados",
    moreSelectedResources_one: "Mais {{count}} item selecionado",
    moreSelectedResources_other: "Mais {{count}} itens selecionados",
    additionalSelectedResources: "Itens selecionados adicionais",
    removeCapability: "Remover {{name}}",
    requiredCapability: "Obrigatório para esta tarefa",
    addKnowledgeBase: "Adicionar base de conhecimento",
    knowledgeBaseTitle: "Escolher bases de conhecimento",
    knowledgeBaseSearch: "Pesquisar bases de conhecimento disponíveis…",
    noKnowledgeBases: "Nenhuma base de conhecimento disponível",
    knowledgeBasesUnavailable:
      "Não foi possível carregar as bases de conhecimento disponíveis. Tente novamente.",
    knowledgeBaseUnavailable: "Base de conhecimento indisponível",
    applicationManagedKnowledgeBase:
      "Base de conhecimento gerenciada pelo aplicativo",
    knowledgeBaseVerificationUnavailable:
      "Não foi possível verificar o status da base de conhecimento. Tente novamente.",
    removeKnowledgeBase: "Remover base de conhecimento {{name}}",
    pendingKnowledgeBases: "Bases de conhecimento",
    runningChoiceTitle: "Como esta nova mensagem deve ser tratada?",
    runningChoiceDescription:
      "Esta tarefa ainda está em execução. Oriente a execução atual ou salve o conteúdo como a próxima solicitação.",
    steer: "Orientar execução atual",
    steerContextUnavailable:
      "Orientar a execução atual adiciona apenas texto; não recarrega anexos nem plugins ou habilidades prioritários. Remova-os para usar esta ação.",
    steerFallbackQueued:
      "Esta mensagem inclui anexos ou plugins ou habilidades selecionados, por isso foi colocada na fila como a próxima solicitação.",
    addPending: "Adicionar como próxima solicitação",
    pendingQueued: "Na fila",
    pendingGuide: "Orientar",
    pendingGuideTooltip: "Enviar sem interromper a tarefa em execução",
    pendingReorderHandle: "Reordenar solicitação pendente {{position}}",
    pendingReorderTooltip: "Arraste para cima ou para baixo para reordenar",
    pendingReorderInstructions:
      "Pressione Espaço para começar a ordenar, use as setas para cima e para baixo para mover, pressione Espaço para confirmar ou Escape para cancelar.",
    pendingReorderStarted: "Solicitação pendente {{position}} selecionada.",
    pendingReorderOver: "Atualmente na posição {{position}}.",
    pendingReorderCompleted: "Movida para a posição {{position}}.",
    pendingReorderCancelled: "Ordenação cancelada.",
    pendingDetails: "Ver detalhes da solicitação pendente",
    editPending: "Editar informações",
    closePending: "Fechar fila",
    pendingTitle: "Solicitações pendentes",
    pendingPriorityCapabilities: "Plugins/habilidades prioritários",
    pendingAttachmentCount: "{{count}} anexos pendentes",
    pendingAttachments: "Anexos pendentes",
    pendingBlockedOverload:
      "O sistema está ocupado. Selecione Continuar para tentar novamente.",
    pendingBlockedPreflight:
      "As verificações prévias falharam. Resolva o problema e continue ou entre em contato com um administrador.",
    pendingUnknownBlock:
      "Uma verificação prévia falhou. Entre em contato com um administrador.",
    cancelPending: "Cancelar solicitação pendente",
    maxPending:
      "Você pode manter até 5 solicitações pendentes. Processe uma solicitação existente primeiro.",
    pendingCancelled:
      "A solicitação pendente foi cancelada e seus anexos foram restaurados no campo de mensagem.",
    pendingContinued:
      "Foi solicitado ao {{productName}} que continuasse a primeira solicitação pendente.",
    pendingGuided:
      "A primeira solicitação pendente agora orienta a execução atual.",
    reconnecting: "A conexão está sendo restabelecida",
    planTitle: "Plano de execução",
    planProgress: "Etapa {{current}} de {{total}}",
    planChangedFiles_one: "{{count}} arquivo alterado",
    planChangedFiles_other: "{{count}} arquivos alterados",
    planExpand: "Expandir plano de execução",
    planCollapse: "Recolher plano de execução",
    planStepPending: "Pendente",
    planStepInProgress: "Em andamento",
    planStepCompleted: "Concluído",
    activity: "Resumo das atividades",
    expandActivity: "Expandir detalhes do trabalho",
    collapseActivity: "Recolher detalhes do trabalho",
    intermediateMessage: "Resposta intermediária",
    currentActivity: "Atividade atual",
    reasoningActivity: {
      label: "Raciocínio",
      expand: "Expandir raciocínio",
      collapse: "Recolher raciocínio",
    },
    thinking: "Raciocínio",
    processing: "Processando",
    elapsed: "Levou",
    processingDuration: "Tempo de processamento {{duration}}",
    userMessage: "Mensagem do usuário",
    assistantMessage: "Resposta do assistente",
    messageActions: "Ações da mensagem",
    messageSentAt: "Enviada às {{time}}",
    messageModel: "Modelo usado: {{model}}",
    timeSeparator: {
      today: "Hoje às {{time}}",
      yesterday: "Ontem às {{time}}",
      sameYear: "{{date}}, {{time}}",
      otherYear: "{{date}}, {{time}}",
      accessibleLabel: "Horário da mensagem: {{time}}",
    },
    modelChanged: "Modelo alterado de {{previousModel}} para {{currentModel}}.",
    copyMessage: "Copiar mensagem",
    showMore: "Mostrar mais",
    showLess: "Mostrar menos",
    messageSending: "Enviando…",
    messageCopied: "Mensagem copiada",
    copyMessageFailed: "Não foi possível copiar a mensagem. Tente novamente.",
    forkMessage: "Ramificar para uma nova conversa",
    forkingMessage: "Criando ramificação…",
    forkMessageFailed:
      "Não foi possível criar a tarefa ramificada. Tente novamente.",
    forkSource: {
      continueFromChat: "Continuação de uma conversa",
      openSourceTask: "Abrir tarefa de origem: {{title}}",
      unavailable: "Tarefa de origem indisponível",
    },
    diagram: {
      title: "Fluxograma",
      actions: "Ações do fluxograma",
      copy: "Copiar código",
      export: "Exportar imagem",
      expand: "Ampliar diagrama",
      close: "Fechar",
      zoomIn: "Aumentar zoom",
      zoomOut: "Diminuir zoom",
      resetZoom: "Redefinir zoom",
      filename: "fluxograma.png",
      streaming: "Gerando diagrama…",
      loading: "Desenhando diagrama…",
      error:
        "Não foi possível exibir este diagrama. Copie o código para verificá-lo e tente novamente.",
      exportFailed: "A exportação da imagem falhou. Tente novamente.",
    },
    copyCode: "Copiar código",
    codeCopied: "Código copiado",
    previewHtmlCode: "Visualizar código HTML",
    showHtmlCode: "Ver código HTML",
    htmlCodePreviewFileName: "Prévia do código HTML.html",
    inlineHtmlPreview: {
      cardLabel: "Visualização HTML interativa",
      frameTitle: "Página HTML interativa gerada por IA",
      generating: "Gerando componente interativo…",
      generatingHint: "Gerando agora, isso pode levar algum tempo",
      loading: "Carregando visualização interativa…",
      loadFailedTitle:
        "A visualização interativa está temporariamente indisponível",
      loadFailedDescription:
        "O componente interativo não carregou. Tente novamente.",
      actions: "Ações da visualização HTML",
      downloadHtml: "Baixar arquivo HTML",
      copyImage: "Copiar como imagem",
      fullscreen: "Visualizar em tela cheia",
      exitFullscreen: "Sair da visualização em tela cheia",
      imageCopied: "Visualização copiada como imagem",
      copyImageFailed:
        "Não foi possível copiar a visualização como imagem. Tente novamente.",
      fullscreenFailed:
        "Não foi possível entrar ou sair da visualização em tela cheia. Tente novamente.",
    },
    waitingGame: {
      title: "Cobrinha",
      enter: "Clique ou pressione Enter para jogar Cobrinha.",
      controls:
        "Use as setas, WASD ou deslize para direcionar. Clique duas vezes ou pressione Escape para voltar à espera.",
    },
    imageGeneration: {
      loading: "Gerando imagem…",
    },
    copyTable: "Copiar tabela",
    tableCopied: "Tabela copiada",
    tableActions: "Ações da tabela",
    tableScrollHint: "Role para os lados para ver a tabela completa",
    scrollTable: "Tabela com rolagem horizontal",
    expandTable: "Abrir tabela em uma visualização ampliada",
    tableDialogTitle: "Tabela completa",
    tableDialogDescription:
      "Role na horizontal ou na vertical para ver todo o conteúdo.",
    scrollExpandedTable: "Conteúdo completo da tabela",
    copyContentFailed: "Não foi possível copiar. Tente novamente.",
    editMessage: "Editar mensagem",
    editMessageInput: "Editar conteúdo da mensagem",
    cancelEdit: "Cancelar",
    regenerating: "Enviando",
    regenerateFailed:
      "Não foi possível gerar a resposta novamente. Tente novamente.",
    downloadArtifact: "Baixar {{name}}",
    downloadPreparing: "Preparando um link de download seguro…",
    taskOverview: {
      sources: "Fontes",
      noSources: "Nenhuma fonte ainda",
      sourcesError: "Não foi possível carregar as fontes. Tente novamente.",
      open: "Abrir visão geral da tarefa",
      close: "Fechar visão geral da tarefa",
      title: "Visão geral da tarefa",
      subagents: "Subagentes",
      subagentsUsed: "{{count}} subagentes usados",
      subagentsCompleted: "{{count}} concluídos",
      subagentsProgress: "{{completed}} / {{count}} concluídos",
      outputFiles: "Arquivos de saída",
      noOutputFiles: "Nenhum arquivo de saída ainda",
    },
    capabilitiesUsed: "Plugins/habilidades do turno",
    loaded: "Carregados",
    used: "Usados efetivamente",
    priority: "Prioridade do usuário",
    saved: "Rascunho salvo",
    followUpAction: "Tratar nova mensagem",
    submitFollowUp: "Enviar nova mensagem",
    pendingBlockCodes: {
      priority_capability_unavailable:
        "Um plugin ou habilidade prioritário selecionado não está mais disponível. Selecione novamente.",
      required_credential_unavailable:
        "Uma credencial de plugin obrigatória está ausente. Vincule-a primeiro.",
      credential_binding_ambiguous:
        "Há conflitos entre os vínculos de credenciais. Defina o vínculo explicitamente.",
      attachment_unavailable:
        "Um anexo está indisponível. Remova-o e envie-o novamente.",
      agents_template_unavailable:
        "As regras de execução estão indisponíveis. Entre em contato com um administrador.",
      workspace_invalid:
        "O espaço de trabalho da tarefa está indisponível. Entre em contato com um administrador.",
      runner_unavailable:
        "O serviço de execução está indisponível. Entre em contato com um administrador.",
      deployment_stopped:
        "Uma atualização do sistema pausou esta solicitação. Revise o progresso antes de continuar manualmente.",
      execution_environment_invalid:
        "O ambiente de execução não está pronto. Entre em contato com um administrador.",
      credit_limit_exceeded:
        "A cota de créditos disponível deste usuário foi esgotada e ele não pode iniciar uma nova tarefa agora.",
    },
    activities: {
      analysis: "Analisando a solicitação",
      analyzing: "Analisando a solicitação",
      attachment_read: "Lendo um anexo",
      plugin_use: "Usando um plugin",
      skill_use: "Usando uma habilidade",
      file_write: "Criando ou atualizando um arquivo",
      external_access: "Acessando um serviço externo",
      step_started: "Etapa iniciada",
      step_completed: "Etapa concluída",
      tool_started: "Chamando uma ferramenta",
      tool_completed: "Chamada da ferramenta concluída",
      working_in_workspace: "Trabalhando com o conteúdo do espaço de trabalho",
      registering_artifact: "Registrando um arquivo para download",
      using_platform_tool: "Usando uma ferramenta da plataforma",
      working: "Trabalhando",
      capability_use: "Usando um plugin ou habilidade",
      system_capability_used: "Serviço de arquivos utilizado",
      reconnecting: "Reconectando",
      reconnectingAttempt: "Reconectando {{attempt}}/{{total}}",
      error: "A execução encontrou um problema recuperável",
    },
    streamDisconnectedBeforeCompletion:
      "o fluxo foi desconectado antes da conclusão.",
    streamDisconnectedWarning:
      "Tarefa interrompida porque o fluxo de resposta foi desconectado",
    nativeActivities: {
      fileChangeRunning_one: "Atualizando {{count}} arquivo",
      fileChangeRunning_other: "Atualizando {{count}} arquivos",
      fileChangeCompleted_one: "{{count}} arquivo atualizado",
      fileChangeCompleted_other: "{{count}} arquivos atualizados",
      fileChangeRunningGeneric: "Atualizando arquivos",
      fileChangeCompletedGeneric: "Arquivos atualizados",
      webSearchRunning: "Pesquisando na Web",
      webSearchCompleted: "Pesquisa na Web realizada",
      knowledgeSearchRunning:
        "Pesquisando nas bases de conhecimento selecionadas",
      knowledgeSearchCompleted: "Pesquisa nas bases de conhecimento concluída",
      knowledgeSearchFailed: "Pesquisa nas bases de conhecimento falhou",
      knowledgeSearchNoAvailableBases:
        "Nenhuma base de conhecimento disponível para esta execução",
      imageViewRunning: "Visualizando uma imagem",
      imageViewCompleted: "Imagem visualizada",
      imageGenerationRunning: "Gerando uma imagem",
      imageGenerationCompleted: "Imagem gerada",
      enteredReviewMode: "Entrou no modo de revisão",
      exitedReviewMode: "Saiu do modo de revisão",
      contextCompactionRunning: "Compactando contexto",
      contextCompactionCompleted: "Contexto compactado",
      contextCompactionIncomplete:
        "A compactação do contexto não foi concluída",
      collabAgentRunning: "Coordenando subagentes",
      collabAgentCompleted: "Subagentes coordenados",
      subAgentStarted: "Subagente começou a trabalhar",
      subAgentUpdated: "Subagente atualizado",
      subAgentCompleted: "Subagente concluído",
      subAgentInterrupted: "Subagente interrompido",
      summary: {
        separator: " · ",
        loadedTools: {
          leading_one: "Ferramenta carregada",
          leading_other: "Ferramentas carregadas",
          following_one: "carregou uma ferramenta",
          following_other: "carregou ferramentas",
          running_one: "Carregando uma ferramenta",
          running_other: "Carregando ferramentas",
        },
        calledTools: {
          leading_one: "Ferramenta chamada",
          leading_other: "Ferramentas chamadas",
          following_one: "chamou uma ferramenta",
          following_other: "chamou ferramentas",
          running_one: "Chamando uma ferramenta",
          running_other: "Chamando ferramentas",
        },
        editedFiles: {
          leading_one: "Arquivo editado",
          leading_other: "Arquivos editados",
          following_one: "editou um arquivo",
          following_other: "editou arquivos",
          running_one: "Editando um arquivo",
          running_other: "Editando arquivos",
        },
        readFiles: {
          leading: "Arquivos lidos",
          following: "leu arquivos",
          running: "Lendo arquivos",
        },
        commands: {
          leading_one: "Comando executado",
          leading_other: "Comandos executados",
          following_one: "executou um comando",
          following_other: "executou comandos",
          running_one: "Executando um comando",
          running_other: "Executando comandos",
        },
        webSearch: {
          leading: "Pesquisa na Web realizada",
          following: "pesquisou na Web",
          running: "Pesquisando na Web",
        },
        dynamicTool: "{{tool}}",
      },
    },
    subAgentActivities: {
      agentList: "{{count}} subagentes",
      agentFallback: "Subagente {{number}}",
      agentStatus: "{{name}}: {{status}}",
      openAgent: "Abrir subagente {{name}}",
      detailPanelLabel: "Detalhes de {{name}}",
      closeDetails: "Fechar detalhes do subagente",
      resizeDetails: "Redimensionar detalhes do subagente",
      loadingDetails: "Carregando atividade do subagente",
      detailLoadFailed: "Não foi possível carregar os detalhes do subagente.",
      noDetails: "Nenhum detalhe de atividade disponível ainda.",
      continuedAfterInterruption:
        "O subagente foi interrompido e depois continuou.",
      continuedAfterFailure: "O subagente falhou e depois continuou.",
      status: {
        pendingInit: "Preparando",
        running: "Trabalhando",
        started: "Começou a trabalhar",
        updated: "Atualizado em",
        interrupted: "Interrompido",
        completed: "Concluído",
        errored: "Falhou",
        shutdown: "Parado",
        notFound: "Não encontrado",
      },
    },
    nativeActivityDetails: {
      expand: "Expandir detalhes de {{activity}}",
      collapse: "Recolher detalhes de {{activity}}",
      commands: "Detalhes do comando",
      fileChanges: "Detalhes das alterações de arquivos",
      queries: "Detalhes da consulta de pesquisa",
      fields: {
        duration: "Duração",
        server: "Servidor",
        tool: "Ferramenta",
        plugin: "Plugin",
        namespace: "Namespace",
        result: "Resultado",
        action: "Ação",
        url: "URL",
        pattern: "Padrão",
        path: "Caminho",
        prompt: "Instrução",
        review: "Revisão",
      },
      actions: {
        read: "Ler",
        listFiles: "Listar arquivos",
        search: "Pesquisar",
        unknown: "Outro",
        openPage: "Abrir página",
        findInPage: "Localizar na página",
        other: "Outro",
      },
      fileKinds: {
        add: "Adicionado",
        delete: "Excluído",
        update: "Atualizado em",
      },
      values: {
        succeeded: "Bem-sucedido",
        failed: "Falhou",
      },
    },
  },
  applications: {
    opening: {
      expired:
        "Esta sessão de abertura não está mais disponível. Volte aos seus aplicativos para abri-lo novamente.",
      back: "Voltar aos aplicativos",
    },
    editMetadata: "Editar detalhes do aplicativo",
    editMetadataPublishDescription:
      "Edite o ícone, o nome e a descrição do aplicativo. As alterações entram em vigor ao salvar. As versões compartilhadas e da Central de aplicativos são atualizadas separadamente.",
    editMetadataDescription:
      "Altere o ícone, o nome e a descrição do aplicativo.",
    editDraftMetadataDescription:
      "Salve no aplicativo em desenvolvimento. Publique para usar estas alterações em Meus aplicativos.",
    distribution: {
      versionNumber: "Número da versão",
      editVersionLower:
        "A versão não pode ser inferior à maior versão existente, v{{version}}.",
      editVersionHint:
        "Mantenha a versão existente ou insira uma versão maior no formato 1.0.0.",
      versionHint:
        "Uma versão sugerida foi preenchida. Para alterá-la, use um formato como 1.0.0.",
      publishFirst:
        "Publique uma versão antes de compartilhar ou listar este aplicativo.",
      publishedVersionHint:
        "Compartilhe ou liste esta versão publicada. Publique primeiro as novas alterações.",
      serviceInstallationHint:
        "Instale para usar os recursos do aplicativo do criador. Novas versões exigem atualização manual. Suas conversas e arquivos de trabalho são mantidos.",
      availableVersion: "Disponível · v{{version}}",
      versionInvalid: "Insira uma versão válida, como 1.0.0.",
      versionSame: "A versão v{{version}} já existe. Insira uma versão maior.",
      versionLower:
        "A versão deve ser maior que a maior versão existente, v{{version}}.",
      saveSharing: "Salvar compartilhamento",
      applyListing: "Solicitar listagem",
      completeSetup: "Concluir configuração",
      installedVersion: "Instalado · v{{version}}",
      editModes: "Editar modos de uso",
      direct: "Compartilhar com a organização",
      center: "Central de aplicativos",
      myApplications: "Meus aplicativos",
      sharedApplications: "Compartilhadas comigo",
      usageModes: "Opções de uso",
      usageModesHint: "Escolha pelo menos uma opção. Você pode oferecer ambas.",
      modes: {
        install: "Pacote de aplicativo",
        service: "Serviço de aplicativo",
      },
      modeDescriptions: {
        install:
          "Os usuários instalam seu próprio aplicativo, configuram suas credenciais e o mantêm de forma independente.",
        service:
          "Os usuários instalam manualmente o serviço do aplicativo e usam os recursos e as credenciais configurados por você.",
      },
      install: "Instalar aplicativo",
      useService: "Usar",
      installationName: "Nome do aplicativo instalado",
      installationHint:
        "O aplicativo e os plugins e habilidades incluídos serão salvos na sua conta. Configure suas próprias credenciais, bases de conhecimento e conexões externas.",
      installed:
        "Aplicativo instalado. Revise e conclua a configuração necessária.",
      installedLabel: "Instalado",
      openInstalled: "Abrir meu aplicativo",
      configure: "Configurar aplicativo",
      guide: "Guia de uso",
      version: "v{{version}}",
      submit: "Enviar para aprovação",
      submitHint:
        "Um administrador revisará esta versão e suas opções de uso. Alterações posteriores exigem um novo envio e não substituem automaticamente a versão aprovada.",
      releaseNotes: "Notas da versão",
      submitted: "Enviado para aprovação do administrador.",
      withdraw: "Retirar envio",
      withdrawn: "Envio retirado.",
      unlist: "Remover da listagem",
      relist: "Recolocar na listagem",
      statusSaved: "Status da listagem atualizado.",
      noReleases: "Nenhuma versão foi enviada ainda.",
      noCenterApplications: "Nenhum aplicativo na central ainda",
      centerSearch: "Pesquisar na Central de aplicativos",
      centerUnavailable:
        "Este aplicativo está indisponível para uso ou instalação no momento.",
      updateAvailable: "Atualização disponível",
      checkUpdate: "Verificar atualizações",
      updateTitle: "Atualizar aplicativo instalado",
      update: "Atualizar aplicativo",
      updateHint:
        "A atualização substitui suas alterações no aplicativo. Suas conversas, arquivos de trabalho e credenciais pessoais são mantidos. Conclua primeiro todas as tarefas comuns deste aplicativo.",
      upToDate: "Você tem a versão disponível mais recente.",
      updateUnavailable:
        "As atualizações estão indisponíveis no momento. Seu aplicativo instalado foi mantido.",
      updated:
        "Aplicativo atualizado. Suas configurações pessoais foram preservadas.",
      setupRequired: "Configuração necessária",
      preserved: "Estas alterações pessoais serão mantidas: {{fields}}",
      fields: {
        name: "Nome do aplicativo",
        instructions: "Instruções do aplicativo",
        model: "Modelo",
        reasoning_effort: "Esforço de raciocínio",
        capabilities: "Plugins e habilidades",
        resources: "Bases de conhecimento e conexões externas",
      },
      review: "Revisar aplicativo",
      approve: "Aprovar",
      reject: "Rejeitar",
      reviewComment: "Comentário da revisão",
      reviewed: "Decisão da revisão salva.",
      reviewInstructions: "Instruções do aplicativo",
      suspend: "Remover aplicativo da listagem",
      resume: "Recolocar aplicativo na listagem",
      governanceReason: "Motivo",
      revokeHint:
        "Revogar o acesso impede novas instalações ou o uso do serviço. Instalações independentes existentes e o histórico são mantidos.",
      saveModes: "Salvar opções de uso",
      modesSaved: "Opções de uso atualizadas.",
    },
    publication: {
      noGuide: "O criador não forneceu um guia de uso.",
    },
    scopeLabel: "Escopo dos aplicativos",
    scope: {
      all: "Todos os aplicativos",
      owned: "Criadas por mim",
      shared: "Compartilhadas comigo",
    },
    search: "Pesquisar aplicativos",
    searchPlaceholder: "Pesquisar nomes ou descrições de aplicativos…",
    create: "Criar aplicativo",
    createTypeDescription: "Escolha como criar seu aplicativo.",
    creation: {
      recommended: "Recomendado",
      interactiveTitle: "Criar um aplicativo interativo por conversa",
      interactiveDescription:
        "Compartilhe sua ideia e deixe o LinkSense dar vida a ela.",
      start: "Começar a criar",
    },
    createStandardApp: "Criar aplicativo padrão",
    createStandardAppDescription:
      "Configure um assistente pessoal com suas ferramentas e recursos habituais.",
    interactiveApp: "Aplicativo interativo",
    importInteractiveApp: "Importar aplicativo interativo",
    importInteractiveAppDescription:
      "Envie um pacote de aplicativo existente para adicioná-lo a Meus aplicativos.",
    updateInteractivePackage: "Atualizar pacote do aplicativo",
    interactivePackageUpdated: "Atualizado com sucesso.",
    interactiveAppImported: "Importado com sucesso.",
    interactivePackageRequirements:
      "Envie um pacote de aplicativo ZIP com manifest.json e index.html na raiz.",
    applicationPackage: "Pacote de aplicativo",
    interactivePackageHint:
      "Somente ZIP, até {{size}}. As atualizações podem manter a versão existente ou usar uma versão maior.",
    interactivePackageSizeInvalid:
      "O pacote do aplicativo está vazio ou excede o limite de tamanho.",
    importPackageAction: "Importar",
    updatePackageAndPublish: "Atualizar",
    interactivePackageVersionInvalid:
      "A versão do pacote deve conter três números, como 0.0.1. Atualize a versão e envie o pacote novamente.",
    importPublicationRetry:
      "A importação não foi concluída. Verifique os recursos necessários e tente novamente; nenhum aplicativo duplicado será criado.",
    createAndPublish: "Criar",
    editAndPublish: "Salvar",
    editedAndPublished: "Salvo com sucesso.",
    createPublicationRetry:
      "A criação não foi concluída. Verifique a configuração e tente novamente; nenhum aplicativo duplicado será criado.",
    declaration: {
      title: "Lista de declaração de recursos",
      purpose:
        "Ao criar um aplicativo interativo, use esta lista para declarar no manifest.json os plugins, habilidades, servidores MCP e bases de conhecimento de que ele precisa.",
      search: "Pesquisar recursos por nome",
      selectAll: "Selecionar tudo",
      selectResults: "Selecionar todos os resultados da pesquisa",
      selectType: "Selecionar tudo: {{type}}",
      selectTypeResults: "Selecionar todos os resultados da pesquisa: {{type}}",
      selected: "{{count}} selecionados",
      groupSelected: "{{count}} / {{total}} selecionados",
      empty: "Nenhum recurso disponível para declarar",
      preview: "Prévia da declaração",
      mergeHint:
        "Após copiar, adicione o campo dependencies ao manifest.json ao lado de name e version. Substitua qualquer campo dependencies existente; não sobrescreva o arquivo inteiro.",
      invalid:
        "Não é possível gerar uma declaração válida. Selecione até 50 plugins e habilidades no total, 20 servidores MCP e 20 bases de conhecimento. Os nomes dos recursos devem ter de 1 a 160 caracteres. Ajuste sua seleção ou os nomes dos recursos.",
      copy: "Copiar JSON de dependências",
      copyFailed:
        "A cópia falhou. Tente novamente ou selecione o texto na prévia da declaração e copie-o manualmente.",
    },
    dependencies: {
      preview: "Verificar recursos necessários",
      hint: "Os plugins, habilidades e outros recursos a seguir foram declarados pelo pacote do aplicativo. Recomendamos concluir a configuração dos recursos antes de importar para que o aplicativo funcione corretamente.",
      empty: "Este aplicativo não declara recursos necessários.",
      search: "Pesquise e escolha seus recursos",
      matched: "Configurado",
      unmatched: "Não configurado",
      clear: "Limpar seleção",
      serviceOnly:
        "Aplicativos interativos só podem ser usados online, não copiados. Os usuários não precisam reconfigurar os recursos conectados pelo criador.",
      types: {
        plugin: "Plugin",
        skill: "Habilidade",
        mcp_server: "Servidor MCP",
        knowledge_base: "Base de conhecimento",
      },
    },
    nativeChatPanel: "Conversa com o LinkSense",
    hideNativeChat: "Ocultar conversa",
    showNativeChat: "Mostrar conversa",
    resizeNativeChat: "Redimensionar painel da conversa",
    interactiveRuntimeUnavailable:
      "Este aplicativo interativo está indisponível no momento. Entre em contato com o criador.",
    created: "Criado com sucesso.",
    updated:
      "Aplicativo atualizado. Os próximos turnos das tarefas usarão automaticamente a configuração mais recente.",
    deleted: "Aplicativo excluído.",
    emptyTitle: "Nenhum aplicativo disponível ainda",
    createdByMe: "Criadas por mim",
    createdBy: "Criado por {{name}}",
    status: {
      active: "Ativado",
      disabled: "Desativado",
    },
    noDescription: "Sem descrição",
    card: {
      capabilityCount: "Plugins / habilidades {{count}}",
      knowledgeBaseCount: "Bases de conhecimento {{count}}",
      mcpServerCount: "MCP {{count}}",
    },
    capabilityCount: "{{count}} plugins/habilidades",
    knowledgeBaseCount: "{{count}} bases de conhecimento",
    mcpServerCount: "{{count}} servidores MCP",
    shareTargets: "Compartilhado · {{targets}}",
    dependencyUnavailable:
      "Algumas dependências estão desativadas ou indisponíveis. Restaure-as antes de iniciar uma nova tarefa.",
    dependencyUnavailableShort: "Indisponível no momento; pode ser removido",
    usesPluginCredentials: "Usa credenciais de plugins",
    share: "Compartilhar",
    shareWithinOrganization: "Compartilhar dentro da organização",
    usage: {
      action: "Análise de uso",
      title: "Uso do aplicativo",
      description:
        "Consulte o uso e os custos de modelos de “{{name}}” no período selecionado.",
      backToApplications: "Voltar aos aplicativos",
      activeUsers: "Usuários ativos",
      activeUsersHint:
        "Usuários distintos que criaram uma tarefa ou iniciaram um turno efetivo no período selecionado",
      coverageTitle:
        "Os dados de tokens e custos começam a partir do início da coleta",
      coverageDescription:
        "A cobertura começa em {{date}}. Tarefas e turnos anteriores continuam sendo contados, mas os tokens e custos históricos não são estimados com os preços atuais.",
      tokenBreakdownTitle: "Composição de tokens",
      costBreakdownTitle: "Composição de custos",
      unpricedTokens: "Tokens sem preço",
      modelBreakdownDescription:
        "Consulte chamadas, turnos, tokens e custos por modelo.",
      workloadBreakdownDescription:
        "Consulte chamadas, tokens e custos por tipo de atividade do modelo.",
    },
    startChat: "Experimentar agora",
    deleteAction: "Excluir aplicativo",
    deleteTitle: "Excluir este aplicativo?",
    deleteDescription:
      "O aplicativo desaparecerá da Central de plugins e não poderá iniciar novas tarefas. O histórico de tarefas privadas existente será mantido.",
    editTitle: "Editar aplicativo",
    createTitle: "Criar aplicativo",
    editorDescription:
      "Configure o modelo, plugins/habilidades, bases de conhecimento e instruções do aplicativo. Insira um número de versão; as alterações entram em vigor ao salvar. As versões compartilhadas e listadas são atualizadas separadamente.",
    basicInformation: "Informações básicas",
    details: {
      title: "Detalhes do aplicativo",
      open: "Ver detalhes de {{name}}",
      creator: "Criador",
      kinds: {
        standard: "Aplicativo padrão",
        interactive: "Aplicativo interativo",
      },
      views: {
        configuration: "Configuração atual",
        published: "Versão publicada",
      },
      resources: "Recursos do aplicativo",
      noResources:
        "Este aplicativo não tem recursos configurados nem declarados.",
      emptyGroup: "Nenhum recurso deste tipo",
      unknownResource: "Recurso não está mais disponível",
      resourceGroup: "{{type}} ({{count}})",
      declaredResource: "Declarado pelo aplicativo: {{name}}",
      resourceStatus: {
        configured: "Configurado",
        unconfigured: "Não configurado",
        unavailable: "Indisponível",
      },
    },
    runtimeConfiguration: "Configuração de execução",
    icon: "Ícone do aplicativo",
    iconPresetLabel: "Ícones de aplicativos integrados",
    uploadIcon: "Enviar imagem",
    replaceIcon: "Substituir imagem",
    iconHint:
      "PNG, JPEG ou WebP; ≤ {{size}}, no máximo {{dimension}}×{{dimension}} px.",
    iconFileInvalid:
      "Selecione uma imagem que atenda aos limites de formato, tamanho de arquivo e dimensões.",
    iconPresets: {
      bot: "Bot",
      search: "Pesquisa e busca",
      "book-open": "Base de conhecimento",
      "graduation-cap": "Educação e treinamento",
      "briefcase-business": "Negócios e escritório",
      "chart-column": "Análise de dados",
      "code-xml": "Desenvolvimento de software",
      "pen-line": "Redação de conteúdo",
      sparkles: "Design criativo",
      lightbulb: "Inovação e planejamento",
      headset: "Atendimento ao cliente",
      "file-text": "Processamento de documentos",
      landmark: "Finanças",
      scale: "Jurídico e conformidade",
      "heart-pulse": "Cuidados de saúde",
      "shield-check": "Segurança e riscos",
      workflow: "Automação de fluxos de trabalho",
      "calendar-clock": "Agendamento",
      users: "Colaboração em equipe",
      "globe-2": "Negócios globais",
    },
    instructions: "Instruções do aplicativo",
    instructionsDescription:
      "Estas instruções são inseridas como instruções de desenvolvedor do aplicativo e não são exibidas aos destinatários.",
    model: "Modelo",
    userSelectedModel: "Selecionado pelo usuário na conversa",
    modelOptionalDescription:
      "Quando nenhum modelo é especificado, os usuários podem selecionar o modelo e o esforço de raciocínio na conversa.",
    reasoningEffort: "Esforço de raciocínio",
    plugins: "Plugins",
    pluginsDescription:
      "Selecione plugins gerenciados por você. Os aplicativos usam diretamente as credenciais já vinculadas a cada plugin.",
    noPlugins: "Nenhum plugin disponível.",
    pluginSelectPlaceholder: "Selecionar plugins…",
    pluginSearchPlaceholder: "Pesquisar plugins…",
    skills: "Habilidades",
    skillsDescription: "Selecione habilidades gerenciadas por você.",
    noSkills: "Nenhuma habilidade disponível.",
    skillSelectPlaceholder: "Selecionar habilidades…",
    skillSearchPlaceholder: "Pesquisar habilidades…",
    knowledgeBases: "Bases de conhecimento",
    knowledgeBasesDescription:
      "Os destinatários só podem consultar estas bases de conhecimento dentro das tarefas do aplicativo; não podem navegar, visualizar, baixar ou gerenciá-las.",
    noKnowledgeBases: "Nenhuma base de conhecimento disponível.",
    knowledgeBaseSelectPlaceholder: "Selecionar bases de conhecimento…",
    knowledgeBaseSearchPlaceholder: "Pesquisar bases de conhecimento…",
    mcpServers: "Servidores MCP",
    mcpServersDescription:
      "Selecione os servidores MCP disponíveis para este aplicativo. O conjunto completo de ferramentas, incluindo as que produzem efeitos externos, segue a política de execução ativa.",
    noMcpServers: "Nenhum servidor MCP disponível.",
    mcpServerSelectPlaceholder: "Selecionar servidores MCP…",
    mcpServerSearchPlaceholder: "Pesquisar servidores MCP…",
    resourceSearchEmpty: "Nenhuma opção correspondente.",
    removeResource: "Remover {{name}}",
    additionalResources: "{{count}} seleções adicionais",
    shareTitle: "Compartilhar aplicativo",
    shareDescription:
      "Compartilhe com usuários ou grupos selecionados da organização. Use Acesso externo para integrações por iframe.",
    shareTargetType: "Destinatário",
    shareToUsers: "Usuários",
    shareToGroups: "Grupos de usuários",
    shareUserTarget: "Usuário destinatário",
    shareGroupTarget: "Grupo de usuários destinatário",
    shareUserSearchPlaceholder: "Pesquisar usuários por nome ou e-mail…",
    shareGroupSearchPlaceholder: "Pesquisar grupos de usuários por nome…",
    shareSaved: "Compartilhado com sucesso.",
    shareGrantType: {
      user: "Usuário",
      user_group: "Grupo de usuários",
    },
    currentShares: "Destinatários atuais",
    noShares: "Este aplicativo ainda não foi compartilhado com ninguém.",
    revoke: "Revogar",
    taskUnavailable:
      "Este aplicativo está indisponível. Você não pode enviar mensagens no momento.",
    conversationManaged: "Esta tarefa é gerenciada por “{{name}}”",
    conversationManagedDescription:
      "O modelo, os plugins, as habilidades e as bases de conhecimento são mantidos pelo criador do aplicativo.",
    conversationManagedUserModelDescription:
      "com plugins, habilidades, bases de conhecimento e instruções",
    externalAccess: {
      action: "Acesso externo",
      title: "Acesso externo ao aplicativo",
      description:
        "Incorpore “{{name}}” em sites aprovados para que usuários externos usem apenas este aplicativo.",
      backToApplications: "Voltar aos aplicativos",
      accessTab: "Acesso e incorporação",
      accessSettingsSection: "Configurações de acesso",
      originSettingsSection: "Configurações de origens",
      starterQuestionsSection: "Perguntas predefinidas",
      credentialSettingsSection: "Autenticação no servidor",
      embedSettingsSection: "Configuração de incorporação",
      enabled: "Ativar acesso externo",
      enabledDescription:
        "Ao desativar, as páginas incorporadas deixam de funcionar e as sessões abertas expiram.",
      authMode: "Autenticação",
      authRequirementLabel: "Requisito de autenticação",
      authModeRequired: "Exige autenticação",
      authModePublic: "Sem autenticação",
      authRequiredDescription:
        "Indicado somente para sistemas parceiros. O servidor deles verifica a solicitação antes de abrir o aplicativo.",
      authPublicDescription:
        "Indicado para páginas públicas. Sites aprovados podem abrir o aplicativo diretamente, sem uma verificação separada no servidor.",
      allowedOrigins: "Origens de incorporação permitidas",
      allowedOriginsPlaceholder:
        "https://portal.example.com\nhttps://ops.example.com",
      allowedOriginsDescription:
        "Insira um endereço de site por linha. Após salvar, cada endereço recebe sua própria URL de iframe e um exemplo de incorporação. Use HTTPS em produção; localhost é permitido para testes locais.",
      starterQuestions: "Perguntas predefinidas",
      starterQuestionsDescription:
        "Configure até quatro perguntas sugeridas para cada origem. As perguntas são exibidas exatamente como inseridas, e selecioná-las apenas preenche o campo de mensagem.",
      starterQuestionOriginsTabsLabel: "Origens das perguntas predefinidas",
      starterQuestionsNeedOrigin:
        "Adicione primeiro pelo menos uma origem de incorporação permitida.",
      starterQuestionsEmpty:
        "Nenhuma pergunta predefinida configurada para esta origem.",
      starterQuestionLabel: "Pergunta {{index}}",
      starterQuestionPlaceholder:
        "Insira uma pergunta que os usuários possam selecionar rapidamente",
      starterQuestionDuplicate:
        "As perguntas da mesma origem devem ser únicas.",
      starterQuestionCount: "{{count}} / {{max}} configuradas",
      addStarterQuestion: "Adicionar pergunta",
      removeStarterQuestion: "Remover pergunta {{index}}",
      appId: "ID do aplicativo",
      appSecret: "Segredo do aplicativo",
      secretUnavailableValue: "Gerar novamente para copiar",
      secretUnavailable:
        "Por segurança, segredos antigos não são exibidos novamente. Gere um novo segredo quando precisar do valor completo e forneça-o ao sistema parceiro.",
      rotateSecret: "Gerar novamente",
      rotateConfirmTitle: "Gerar um novo segredo do aplicativo?",
      rotateConfirmDescription:
        "Após gerar um novo segredo, o sistema parceiro deverá usá-lo e as páginas incorporadas abertas expirarão.",
      changeConfirmTitle:
        "Salvar configurações de segurança do acesso externo?",
      changeConfirmDescription:
        "Após salvar, as páginas incorporadas abertas serão verificadas conforme as novas configurações e talvez precisem ser reabertas.",
      secretRotated:
        "Novo segredo do aplicativo gerado. As sessões externas existentes foram revogadas.",
      embedOrigin: "Origem",
      embedOriginsTabsLabel: "Origens de incorporação",
      embedOriginTab: "Origem {{index}}",
      currentEmbedOrigin: "Origem atual",
      iframeUrl: "URL do iframe",
      embedCode: "Exemplo de incorporação",
      serverCredentialWarning:
        "Quando a autenticação for exigida, deixe o sistema parceiro verificar no próprio servidor. Não coloque o segredo do aplicativo no código do frontend.",
      saved: "Configurações de acesso externo salvas.",
      copyFailed: "A cópia falhou. Selecione o conteúdo manualmente.",
      snippetTitle: "Aplicativo incorporado",
      snippetTicketComment:
        "Solicite ao seu backend a credencial de acesso desta visita. Nunca exponha o segredo do aplicativo aqui.",
    },
  },
  skillUpdate: {
    description:
      "Edite a habilidade atual ou envie um pacote de habilidade completo. Revise as alterações antes de confirmar a atualização.",
    loading: "Carregando a habilidade atual…",
    loadFailed:
      "Não foi possível carregar a habilidade atual. Tente novamente.",
    mode: "Método de atualização",
    edit: "Editar conteúdo da habilidade",
    replace: "Substituir pacote completo da habilidade",
    preserveNotice:
      "Somente o nome de exibição, a descrição e as instruções serão alterados. Scripts, modelos, imagens e outros arquivos existentes serão preservados. Para alterar esses arquivos, baixe o pacote completo, edite-o e escolha “Substituir pacote completo da habilidade”.",
    replaceNotice:
      "O novo pacote substituirá a habilidade atual. Arquivos existentes ausentes no novo pacote serão excluídos. Envie um pacote completo com todos os arquivos necessários à habilidade.",
    identifierHint:
      "O identificador da habilidade permanece o mesmo durante a atualização.",
    content: "Instruções da habilidade",
    contentRequired: "Insira as instruções da habilidade.",
    contentTooLarge:
      "Estas instruções são longas demais para editar online. Baixe o pacote completo da habilidade, edite-o e envie-o novamente.",
    noChanges: "Nenhuma alteração foi feita ainda.",
    files: "Arquivos atuais da habilidade",
    download: "Baixar pacote completo da habilidade",
    selectedFile: "Selecionado: {{name}}",
    uploading: "Enviando: {{percentage}}%",
    checking: "Verificando alterações e riscos…",
    check: "Revisar alterações e riscos",
    confirm: "Confirmar atualização",
    changes: "Alterações nos arquivos",
    changeSummary:
      "{{added}} arquivos adicionados, {{modified}} modificados, {{deleted}} excluídos e {{unchanged}} inalterados.",
    added: "Arquivos adicionados",
    modified: "Arquivos modificados",
    deleted: "Arquivos a excluir",
    deleteNotice:
      "Estes arquivos estão ausentes no novo pacote e serão excluídos ao confirmar. Verifique se a habilidade ainda precisa deles.",
    confirmDeletions: "Confirmo a exclusão destes {{count}} arquivos",
  },
  marketplace: {
    title: "Central de plugins",
    description:
      "Explore plugins e habilidades públicos e gerencie conteúdos instalados, conteúdos pessoais e conexões MCP em um só lugar.",
    personalAccountDescription:
      "Gerencie conteúdos instalados, conteúdos pessoais, o repositório de habilidades e conexões MCP.",
    adminTitle: "Central de plugins",
    adminDescription:
      "Revise versões imutáveis, gerencie a visibilidade da Central de plugins e remova itens da listagem imediatamente ao encontrar riscos.",
    adminTabsLabel: "Seções de gerenciamento da Central de plugins",
    tabs: {
      store: "Central de plugins",
      mine: "Meus plugins/habilidades",
      publishing: "Minhas publicações",
      reviews: "Revisões de listagem",
      listings: "Todas as listagens",
    },
    catalogTabsLabel: "Categorias de conteúdo da Central de plugins",
    catalogTabs: {
      plugin: "Plugins",
      skill: "Habilidades",
      connector: "Conectores",
      mcp: "MCP",
      application: "Aplicativos",
    },
    catalogDescriptions: {
      application:
        "Crie e gerencie aplicativos e encontre aplicativos disponíveis para usar.",
      plugin:
        "Explore e gerencie plugins para adicionar ferramentas e conexões às suas tarefas.",
      skill:
        "Explore o repositório de habilidades e instale e gerencie habilidades para diferentes tarefas.",
      connector:
        "Conecte serviços externos para que a IA consulte informações e execute ações nas suas tarefas, sem sincronizar dados automaticamente com a biblioteca de recursos.",
      mcp: "Gerencie conexões MCP e plugins para dar às tarefas acesso às ferramentas e aos dados necessários.",
    },
    catalogScopesLabel: "Escopo do conteúdo",
    scopes: {
      public: "Público",
      personal: "Pessoal",
    },
    installedTitle: "Instalado",
    loadingInstalled: "Carregando conteúdos instalados…",
    installedEmpty: "Nenhum item de {{category}} instalado ainda.",
    installedListLabel: "{{category}} instalados",
    expandInstalled: "Expandir {{category}} instalados",
    collapseInstalled: "Recolher {{category}} instalados",
    searchCategory: "Pesquisar {{category}}",
    publicCatalogLabel: "{{category}} públicos",
    personalCatalogLabel: "{{category}} pessoais",
    personalCatalogEmpty:
      "Nenhum item pessoal de {{category}} corresponde a estes filtros.",
    personalMcpConnections: "Conexões MCP",
    personalMcpPackages: "Pacotes de extensão MCP",
    includesMcp: "Inclui MCP",
    manageMcp: "Gerenciar MCP",
    status: {
      draft: "Rascunho",
      published: "Publicado",
      unlisted: "Fora da listagem",
      suspended: "Fora da listagem",
      pending: "Aguardando revisão",
      approved: "Aprovado",
      rejected: "Não aprovado",
      withdrawn: "Retirado",
    },
    search: "Pesquisar na Central de plugins",
    searchPlaceholder: "Pesquisar por nome, descrição ou publicador…",
    capabilityType: "Tipo",
    itemType: "Tipo",
    catalogEmpty:
      "Nenhum item publicado de {{category}} corresponde a estes filtros.",
    byPublisher: "Publicado por {{publisher}}",
    publisher: "Publicador",
    noDescription: "Sem descrição",
    noKnownRisks:
      "Nenhuma declaração de risco conhecido foi detectada. Verifique se confia no publicador antes de instalar.",
    releaseNumber: "Versão {{number}}",
    installCount: "{{count}} instalações",
    riskSummary: "Resumo de riscos",
    manifest: "Cópia do manifesto",
    releaseNotes: "Notas da versão",
    noReleaseNotes: "Nenhuma nota de versão fornecida.",
    contentHash: "SHA-256 do conteúdo",
    viewDetails: "Ver detalhes de {{name}}",
    install: "Instalar",
    installing: "Instalando",
    installingPluginStatus: "Instalando plugin…",
    installingSkillStatus: "Instalando habilidade…",
    installingMcpStatus: "Instalando MCP…",
    update: "Atualizar",
    updatingPluginStatus: "Atualizando plugin…",
    updatingSkillStatus: "Atualizando habilidade…",
    updatingMcpStatus: "Atualizando MCP…",
    updateAvailable: "Atualização disponível",
    updateInstallation: "Atualizar para a versão mais recente",
    installed:
      "Instalado da Central de plugins como plugin/habilidade pessoal.",
    installedPlugin: "Instalado da Central de plugins como plugin pessoal.",
    installedSkill: "Instalado da Central de plugins como habilidade pessoal.",
    installedMcp: "Instalado da Central de plugins como MCP pessoal.",
    installationUpdated: "A instalação agora usa a versão aprovada atual.",
    installationUpdatedPlugin:
      "O plugin da Central de plugins agora usa a versão aprovada atual.",
    installationUpdatedSkill:
      "A habilidade da Central de plugins agora usa a versão aprovada atual.",
    installationUpdatedMcp:
      "O MCP da Central de plugins agora usa a versão aprovada atual.",
    installedState: "Instalado",
    storeOrigin: "Instalação da Central de plugins",
    uninstall: "Desinstalar",
    uninstalling: "Desinstalando",
    uninstallingPluginStatus: "Desinstalando plugin…",
    uninstallingSkillStatus: "Desinstalando habilidade…",
    uninstallingMcpStatus: "Desinstalando MCP…",
    uninstallTitle: "Desinstalar este plugin/habilidade da Central de plugins?",
    uninstallPluginTitle: "Desinstalar este plugin da Central de plugins?",
    uninstallSkillTitle: "Desinstalar esta habilidade da Central de plugins?",
    uninstallMcpTitle: "Desinstalar este MCP da Central de plugins?",
    uninstallDescription:
      "Esta ação exclui sua instalação pessoal e as configurações pessoais relacionadas. A publicação na Central de plugins não é afetada.",
    uninstalled: "O plugin/habilidade da Central de plugins foi desinstalado.",
    uninstalledPlugin: "O plugin da Central de plugins foi desinstalado.",
    uninstalledSkill: "A habilidade da Central de plugins foi desinstalada.",
    uninstalledMcp: "O MCP da Central de plugins foi desinstalado.",
    ownedCapabilitiesEmpty:
      "Você ainda não tem plugins ou habilidades pessoais.",
    preferenceUpdated: "Sua preferência de ativação foi atualizada.",
    personalCapabilityDeleted:
      "O plugin/habilidade pessoal foi excluído permanentemente.",
    personalPluginDeleted: "O plugin pessoal foi excluído permanentemente.",
    personalMcpDeleted: "O MCP pessoal foi excluído permanentemente.",
    updatePersonalCapability: "Atualizar plugin/habilidade pessoal",
    updatePersonalPlugin: "Atualizar plugin pessoal",
    updatePersonalSkill: "Atualizar habilidade pessoal",
    updatePersonalMcp: "Atualizar MCP pessoal",
    personalImportDescription:
      "A origem é analisada e seus riscos são exibidos primeiro. A instalação ou substituição só ocorre após uma segunda confirmação.",
    personalPluginImportDescription:
      "A origem é analisada e seus riscos são exibidos primeiro. O plugin pessoal só é instalado ou substituído após uma segunda confirmação.",
    personalSkillImportDescription:
      "A origem é analisada e seus riscos são exibidos primeiro. A habilidade pessoal só é instalada ou substituída após uma segunda confirmação.",
    importSources: {
      local: "Pacote ZIP local",
      manualSkill: "Criar uma habilidade manualmente",
    },
    zipPackage: "Pacote ZIP de plugin/habilidade",
    zipPackageHint:
      "São aceitos apenas arquivos ZIP que seguem as convenções de pacotes de plugins ou habilidades.",
    zipPluginPackage: "Pacote ZIP de plugin",
    zipPluginPackageHint:
      "São aceitos apenas arquivos ZIP que seguem a convenção de pacotes de plugins.",
    zipSkillPackage: "Pacote ZIP de habilidade",
    zipSkillPackageHint:
      "São aceitos apenas arquivos ZIP que seguem a convenção de pacotes de habilidades.",
    skillMarkdown: "Conteúdo do SKILL.md",
    skillIdentifier: "Identificador da habilidade",
    skillNameRequired: "Insira um identificador de habilidade.",
    skillNameTooLong:
      "O identificador da habilidade não pode exceder 64 caracteres.",
    skillNameInvalid:
      "Use somente letras minúsculas de a a z, números e hífens (-). Os hífens não podem aparecer no início, no fim nem consecutivamente.",
    skillNameReserved:
      "Este identificador de habilidade é reservado pelo sistema. Escolha outro.",
    skillDisplayName: "Nome de exibição (opcional)",
    skillDisplayNameHint:
      "Gerado a partir do identificador da habilidade. Você pode editá-lo ou deixá-lo em branco; caracteres chineses e espaços são aceitos.",
    skillNameHint:
      "Use de 1 a 64 caracteres: letras minúsculas de a a z, números e hífens (-). Os hífens não podem aparecer no início, no fim nem consecutivamente. Não use nomes de habilidades integradas. Exemplo: my-skill.",
    skillPreview: "Prévia do conteúdo da habilidade",
    applyForListing: "Enviar para listagem",
    pendingReviewAction: "Revisão de listagem pendente",
    publishNew: "Enviar uma nova listagem",
    submitUpdate: "Enviar nova versão",
    publishDialogDescription:
      "O plugin ou habilidade pessoal atual é copiado para uma versão imutável e enviado para revisão do administrador.",
    sourceCapability: "Origem do plugin/habilidade pessoal",
    noPublishableSource:
      "Nenhum plugin ou habilidade pessoal publicável tem o mesmo nome e tipo desta listagem. Importe ou atualize a origem na Central de plugins primeiro.",
    immutableSnapshotNotice:
      "A revisão se aplica a uma versão imutável independente. Edições posteriores no seu plugin ou habilidade pessoal não alteram esta versão pendente.",
    submitForReview: "Enviar para revisão",
    submitted: "A versão foi enviada para revisão do administrador.",
    submittedAt: "Enviado em {{date}}",
    reviewPolicyNotice:
      "Cada nova versão é revisada novamente. Versões aprovadas nunca atualizam automaticamente as instalações existentes.",
    publicationsEmpty:
      "Você ainda não enviou aplicativos, plugins ou habilidades.",
    publicationsDescription:
      "Gerencie seus aplicativos, plugins e habilidades enviados, acompanhe as revisões e publique atualizações.",
    backToCenter: "Voltar à Central de plugins",
    manageApplicationListing: "Gerenciar listagem",
    selectApplication: "Selecionar um aplicativo para listar",
    selectApplicationDescription:
      "Escolha seu aplicativo, defina a versão e os modos de uso e envie-o para revisão do administrador.",
    noPublishableApplication:
      "Nenhum aplicativo elegível encontrado. Ajuste a pesquisa ou primeiro crie e ative um aplicativo em Meus aplicativos.",
    withdraw: "Retirar da revisão",
    withdrawn: "A versão pendente foi retirada.",
    unlist: "Remover da Central de plugins",
    unlisting: "Removendo da listagem…",
    unlistConfirmTitle: "Remover “{{name}}” da listagem?",
    unlistConfirmDescription:
      "Este conteúdo não aparecerá mais na Central de plugins nem ficará disponível para novos usuários. As instalações existentes ainda poderão executar e atualizar.",
    relist: "Recolocar na listagem",
    unlisted:
      "A listagem foi removida. As instalações existentes ainda podem executar e atualizar.",
    relisted: "A listagem está visível novamente na Central de plugins.",
    releaseDetail: "Detalhes da versão",
    releaseDetailDescription:
      "Inspecione os arquivos da versão, as declarações de risco, o conteúdo da habilidade e o hash do conteúdo.",
    packageFiles: "Arquivos da versão",
    adminTitleShort: "Central de plugins",
    reviewsEmpty: "Não há versões pendentes para revisão.",
    listingsEmpty: "Ainda não há listagens na Central de plugins.",
    review: "Revisão",
    reviewRelease: "Revisar “{{name}}”",
    reviewDescription:
      "A decisão se aplica apenas a esta versão imutável. Rejeições exigem um motivo claro.",
    reviewDecision: "Decisão da revisão",
    reviewComment: "Comentário da revisão",
    approvalCommentOptional: "O comentário é opcional ao aprovar.",
    rejectionCommentRequired: "O motivo é obrigatório ao rejeitar.",
    approve: "Aprovar",
    reject: "Rejeitar",
    submitReview: "Enviar decisão",
    reviewApproved:
      "A versão foi aprovada e agora é a versão atual da Central de plugins.",
    reviewRejected:
      "A versão foi rejeitada e o motivo foi enviado ao publicador.",
    suspendListing: "Remover da listagem",
    resumeListing: "Recolocar na listagem",
    suspendListingTitle: "Remover “{{name}}” da listagem?",
    suspendListingDescription:
      "A listagem será ocultada da Central de plugins e todas as cópias instaladas serão impedidas de iniciar novas tarefas.",
    resumeListingTitle: "Recolocar “{{name}}” na listagem?",
    resumeListingDescription:
      "A listagem voltará à Central de plugins e as cópias instaladas poderão ser usadas novamente em novas tarefas.",
    relistUnlistedDescription:
      "A listagem voltará a aparecer na Central de plugins. As instalações existentes não serão afetadas.",
    suspensionReason: "Motivo da remoção da listagem",
    listingSuspended:
      "A listagem foi removida e novas tarefas estão bloqueadas em todas as instalações.",
    listingResumed: "A listagem foi restaurada.",
    risks: {
      contains_mcp_server: "Contém um servidor MCP",
      contains_scripts: "Contém scripts executáveis",
      contains_external_connections: "Pode acessar serviços externos",
      requires_environment_variables: "Exige variáveis de ambiente",
      requires_credentials: "Exige credenciais",
      contains_dependency_download_commands: "Pode baixar dependências",
      declaredEnvironmentKeys: "Variáveis de ambiente: {{values}}",
      mcpEnvironmentReferences: "Variáveis de ambiente do MCP",
      mcpEnvironmentReference: "{{server}} · {{source}}",
      environmentSource: {
        local: "Fornecido por uma credencial pessoal",
        remote: "Fornecido pelo ambiente remoto",
      },
    },
  },
  clawHub: {
    sourceName: "ClawHub",
    repository: "Repositório de habilidades",
    catalogLabel: "Repositório de habilidades ClawHub",
    search: "Pesquisar no repositório de habilidades",
    loading: "Carregando repositório de habilidades…",
    refreshing: "Atualizando…",
    empty: "Nenhuma habilidade disponível",
    emptyDescription:
      "O serviço ainda não sincronizou metadados de habilidades disponíveis do ClawHub.",
    noSearchResults: "Nenhuma habilidade correspondente",
    noSearchResultsDescription:
      "Nenhuma habilidade corresponde a “{{search}}”.",
    sourceNotice:
      "Os metadados das habilidades vêm do ClawHub. O LinkSense não representa o ClawHub e não audita nem endossa estas habilidades. Verifique a origem e os riscos antes de instalar.",
    listLabel: "Resultados do repositório de habilidades",
    sortLabel: "Ordenar habilidades",
    sort: {
      downloads: "Downloads",
      stars: "Estrelas",
    },
    totalCount: "Total: {{count}}",
    byOwner: "Por {{owner}}",
    version: "Versão {{version}}",
    downloads: "{{count}} downloads",
    stars: "{{count}} estrelas",
    owner: "Proprietário",
    latestVersion: "Versão mais recente",
    downloadCount: "Downloads",
    starCount: "Estrelas",
    updatedAt: "Atualizado no ClawHub",
    syncedAt: "Última sincronização",
    topics: "Tópicos",
    platformRequirements: "Requisitos de plataforma",
    changelog: "Histórico de alterações",
    openCanonical: "Ver no ClawHub",
    installedState: "Instalado",
    unavailableState: "Indisponível",
    viewDetails: "Ver detalhes de {{name}}",
    preparing: "Preparando…",
    paginationLabel: "Páginas do repositório de habilidades",
    pageNumber: "Página {{page}}",
    installTitle: "Instalar “{{name}}”?",
    updateTitle: "Atualizar “{{name}}”?",
    installPreviewDescription:
      "Verifique a versão, a origem e os riscos do ClawHub. A habilidade só é adicionada às suas habilidades pessoais após a confirmação.",
    packageIdentity: "Origem da habilidade",
    versionToInstall: "Versão a instalar",
    installFailedTitle: "A instalação falhou",
    installing: "Instalando…",
    installingStatus: "Instalando habilidade…",
    updatingStatus: "Atualizando habilidade…",
    confirmInstall: "Confirmar instalação",
    confirmUpdate: "Confirmar atualização",
    installed:
      "Instalada do repositório de habilidades como habilidade pessoal.",
    updated:
      "A instalação do repositório de habilidades agora está atualizada.",
    origin: "Instalação do ClawHub",
    uninstall: "Desinstalar",
    uninstalling: "Desinstalando",
    uninstallingStatus: "Desinstalando habilidade…",
    uninstallTitle: "Desinstalar esta habilidade do ClawHub?",
    uninstallDescription:
      "Esta ação exclui sua instalação pessoal e as configurações pessoais relacionadas. Os metadados sincronizados do repositório não são afetados.",
    uninstalled: "A habilidade do ClawHub foi desinstalada.",
    securityNoticeTitle: "Aviso de segurança",
    security: {
      clean: "Verificação de segurança aprovada",
      warning: "Alertas de segurança",
      flagged: "Risco sinalizado",
      unknown: "Verificado durante a instalação",
      warningDescription:
        "Esta habilidade tem um status de segurança que requer atenção. Instale-a somente se confiar na origem.",
    },
    installability: {
      unavailable: "Esta habilidade está indisponível no momento.",
      missingVersion: "Esta habilidade não tem uma versão instalável.",
      alreadyInstalled: "Esta versão já está instalada.",
    },
  },
  applicationDevelopment: {
    aiWorking:
      "O {{productName}} está desenvolvendo o aplicativo automaticamente",
    actions: "Ações do aplicativo",
    annotations: {
      start: "Anotar",
      finish: "Sair da anotação",
      unavailable:
        "Não é possível anotar esta página agora. Reabra a visualização do aplicativo.",
      changed:
        "A página mudou. Limpe as anotações e saia do modo de anotação. Selecione novamente após a atualização da visualização.",
    },
    metadata: {
      name: "Nome do aplicativo",
      description: "Descrição do aplicativo",
      editName: "Editar nome do aplicativo",
      editDescription: "Editar descrição do aplicativo",
      addDescription: "Adicionar uma descrição do aplicativo",
      invalidName: "Insira um nome de aplicativo com 1 a 160 caracteres.",
      invalidDescription: "A descrição deve ter no máximo 4.000 caracteres.",
      changed: "O aplicativo mudou. Recarregue-o antes de editar novamente.",
      reload: "Recarregar",
    },
    publish: {
      draft: "Rascunho",
      action: "Publicar",
      update: "Publicar atualização",
      done: "Publicado",
      pending: "Publicando…",
      title: "Publicar aplicativo",
      confirm: "Publicar",
      successTitle: "Publicado com sucesso",
      successDescription:
        "“{{name}}” v{{version}} foi publicado. Você pode usá-lo em Meus aplicativos.",
      description:
        "A publicação deixa “{{name}}” pronto para uso.\nVocê pode abri-lo em Meus aplicativos.",
      updateDescription:
        "Após publicar, você usará a nova versão de “{{name}}”.\nAplicativos compartilhados: compartilhe novamente e peça aos destinatários para instalar a atualização manualmente.\nAplicativos listados: envie uma atualização à Central de aplicativos separadamente.\nAntes de publicar, confirme que este aplicativo não tem tarefas em andamento.",
      checking: "Verificando tarefas em andamento…",
      activeTasks:
        "Este aplicativo tem tarefas em andamento. Aguarde a conclusão antes de publicar. O status é atualizado automaticamente.",
      checkFailed:
        "Não foi possível verificar o status das tarefas. Tente novamente antes de publicar.",
      changed:
        "O aplicativo tem novas alterações. Feche e reabra a janela de publicação.",
    },
    deleteDescription:
      "O aplicativo, o rascunho de desenvolvimento e o histórico de conversas de depuração serão excluídos. As conversas de desenvolvimento, as tarefas comuns e os arquivos do espaço de trabalho serão mantidos.",
    tests: {
      title: "Histórico de conversas de depuração",
      empty: "Nenhuma conversa de depuração ainda",
      emptyHint:
        "Envie uma tarefa na visualização do aplicativo para ver suas entradas, resultados e progresso aqui.",
      current: "Conversa de depuração atual",
      restart: "Nova conversa de depuração",
      summary: "Execuções: {{count}}",
      submitted: "Solicitação de depuração enviada",
      view: "Ver histórico",
      more: "Carregar mais registros",
      detailHint:
        "Revise entradas, saídas, arquivos e atividades. Você pode interromper a conversa de depuração atual ou resolver solicitações pendentes aqui.",
      delete: "Excluir conversa de depuração",
      deleteHint:
        "Esta conversa de depuração será excluída permanentemente e seus recursos de execução serão limpos.",
      deleteDevelopmentHint:
        "Esta conversa de desenvolvimento será excluída permanentemente. O aplicativo, o rascunho e o histórico das conversas de depuração continuarão em Meus aplicativos, onde você pode continuar o desenvolvimento ou excluí-los.",
      status: {
        idle: "Enviado",
        running: "Em andamento",
        completed: "Concluído",
        failed: "Falhou",
        interrupted: "Parado",
      },
    },
    resizePreview: "Redimensionar visualização do aplicativo",
    developmentTask: "Tarefa de desenvolvimento do aplicativo",
    previewTask: "Conversa de depuração do aplicativo",
    catalog: {
      newDevelopment: "Nova versão de desenvolvimento",
      continueDevelopment: "Continuar desenvolvendo",
      developNewVersion: "Desenvolver nova versão",
      deleteDraft: "Excluir rascunho de desenvolvimento",
      deleteDraftDescription:
        "O rascunho e suas conversas de depuração serão excluídos. O aplicativo publicado, as conversas de desenvolvimento, as tarefas comuns e os arquivos do espaço de trabalho serão mantidos.",
      draftDetails: "Rascunho de desenvolvimento",
      savedAt: "Salvo pela última vez {{time}}",
      unpublishedHint:
        "Estas alterações ainda não foram publicadas. Ao usar o aplicativo, a versão publicada continua sendo aberta.",
      filter: "Filtrar aplicativos",
      all: "Todos os aplicativos",
      developing: "Em desenvolvimento",
      standard: "Aplicativos padrão",
      interactive: "Aplicativos interativos",
      draftDescription:
        "Este aplicativo ainda não foi publicado. Continue o desenvolvimento pelo menu.",
      empty: "Nenhum aplicativo correspondente",
      loadMore: "Carregar mais aplicativos",
    },
    create: "Criar aplicativo interativo",
    createHint:
      "Crie por meio de conversas, visualize as alterações enquanto trabalha e instale quando estiver pronto.",
    name: "Nome do aplicativo",
    start: "Começar a desenvolver",
    creating: "Preparando…",
    continue: "Desenvolver",
    workspace: "Espaço de desenvolvimento do aplicativo",
    waitingForTest:
      "Sua conversa de depuração ainda está em execução. As alterações mais recentes aparecerão automaticamente quando ela terminar.",
    debug: "Depurar",
    preview: "Visualizar",
    diagnostics: "Logs de depuração ({{count}})",
    capabilities: "Configurar recursos",
    capabilitiesHint:
      "Escolha os recursos que este aplicativo pode usar. As seleções salvas se aplicam à visualização de desenvolvimento e são incluídas ao instalar ou atualizar o aplicativo.",
    capabilitySearch: "Pesquisar e selecionar…",
    reloadCapabilities: "Recarregar configuração",
    capabilitiesChanged:
      "O aplicativo mudou. Recarregue a configuração antes de salvar.",
    capabilityUnavailable: "Indisponível",
    capabilitiesUnavailable:
      "Alguns recursos selecionados estão indisponíveis. Substitua-os ou remova-os antes de salvar.",
    capabilityLimits:
      "Escolha até 50 plugins e habilidades no total, 20 bases de conhecimento e 20 servidores MCP.",
    capabilityHints: {
      plugin:
        "Conecte os serviços e as ferramentas de que este aplicativo precisa.",
      skill: "Escolha habilidades para as tarefas do aplicativo.",
      knowledge_base:
        "Escolha as bases de conhecimento que este aplicativo pode consultar.",
      mcp_server: "Escolha os servidores MCP que este aplicativo pode chamar.",
    },
    sourceError:
      "As alterações atuais ainda não podem ser executadas. Peça ao assistente para corrigir o aplicativo. A visualização mostra a última versão que funcionou.",
    preparing: "Preparando sua visualização",
    preparingHint:
      "Seu aplicativo aparecerá aqui quando estiver pronto. Configure primeiro os plugins ou bases de conhecimento necessários.",
    noErrors: "Nenhum log de depuração ainda",
    noErrorsHint:
      "Experimente seu aplicativo na visualização. Erros de execução são registrados aqui, e o assistente pode consultá-los para ajudar a investigar.",
  },
  capability: {
    title: "Plugins e habilidades",
    description:
      "Gerencie plugins pessoais, habilidades, origens da Central de plugins e status de execução.",
    builtIn: "Integrado",
    builtInReadOnly:
      "Anexado automaticamente pela plataforma e não pode ser selecionado, desativado, editado nem excluído.",
    builtIns: {
      browser: {
        name: "Navegador do {{productName}}",
        description:
          "Usa um navegador gerenciado isolado para visitar páginas, interagir com sites e capturar telas.",
      },
      documentReader: {
        name: "Leitor de documentos do {{productName}}",
        description:
          "Converte documentos de escritório comuns, e-books, arquivos CSV e PDFs com texto da tarefa em Markdown para leitura segura pela IA.",
      },
      docs: {
        name: "Documentação do {{productName}}",
        description:
          "Responde a perguntas de uso e administração do produto com base na documentação oficial bilíngue de ajuda.",
      },
      coreMcp: {
        name: "MCP principal do {{productName}}",
        description:
          "Oferece conversão de documentos, registro de arquivos gerados, geração de imagens, consulta de conhecimento e criação de habilidades em um único MCP integrado.",
      },
      fileService: {
        name: "Serviço de arquivos do {{productName}}",
        description:
          "Registra os arquivos de entrega criados na tarefa atual para download.",
      },
      imageGeneration: {
        name: "Geração de imagens do {{productName}}",
        description:
          "Gera arquivos de imagem pelo MCP integrado usando o modelo configurado pelo administrador.",
      },
      knowledgeBase: {
        name: "Conhecimento do {{productName}}",
        description:
          "Pesquisa nas bases de conhecimento selecionadas e lê os documentos necessários à tarefa.",
      },
      applicationBuilder: {
        name: "Desenvolvimento de aplicativos interativos do {{productName}}",
        description:
          "Crie e edite aplicativos por conversa, com visualização em tempo real, depuração e instalação.",
      },
      skillCreator: {
        name: "Criador de habilidades do {{productName}}",
        description:
          "Transforma um fluxo de trabalho confirmado em uma habilidade pessoal completa e reutilizável.",
      },
    },
    pluginTitle: "Plugins",
    pluginDescription:
      "Gerencie seus plugins pessoais, origens da Central de plugins e status de execução.",
    skillTitle: "Habilidades",
    skillDescription:
      "Gerencie suas habilidades pessoais, origens da Central de plugins e status de execução.",
    typeTabsLabel: "Tipo de plugin e habilidade",
    tabs: {
      plugin: "Plugins",
      skill: "Habilidades",
    },
    searchPlaceholder: "Pesquisar nomes ou descrições de {{type}}…",
    installed: "Instalado",
    sourceTabsLabel: "Origem",
    viewMore: "Ver mais {{count}}",
    viewMorePreview: "Ver {{names}}",
    viewMorePreviewWithCount: "Ver {{names}} e mais {{count}}",
    collapseList: "Mostrar menos",
    noSearchResults: "Nenhum item de {{type}} correspondente encontrado.",
    add: "Adicionar plugin/habilidade",
    addPlugin: "Adicionar plugin",
    addSkill: "Adicionar habilidade",
    install: "Instalar plugin/habilidade",
    importType: "Método de importação",
    localImport: "Arquivo compactado local",
    manualSkill: "Criar habilidade manualmente",
    packageFile: "Pacote de plugin/habilidade",
    skillContent: "Conteúdo do SKILL.md",
    skillContentPreview: "Corpo do SKILL.md",
    skillContentEmpty: "O corpo do SKILL.md está vazio.",
    skillContentTruncated:
      "O corpo do SKILL.md é muito longo, por isso esta prévia foi truncada. O SKILL.md completo será instalado mesmo assim.",
    descriptionLabel: "Descrição",
    riskTitle: "Confirmar origem e riscos",
    riskDescription:
      "O conteúdo instalado pode incluir scripts, servidores MCP, conexões externas, variáveis de ambiente ou requisitos de credenciais. Continue somente se confiar na origem.",
    riskConfirm: "Revisei a origem e o aviso de riscos",
    installSubmit: "Confirmar instalação",
    previewSubmit: "Inspecionar origem e riscos",
    previewing: "Inspecionando…",
    uploading: "Enviando",
    parsing: "Envio concluído. Inspecionando…",
    importingPluginStatus: "Importando plugin…",
    importingSkillStatus: "Importando habilidade…",
    updatingPluginStatus: "Atualizando plugin…",
    updatingSkillStatus: "Atualizando habilidade…",
    deletingPluginStatus: "Excluindo plugin…",
    uninstallingSkillStatus: "Desinstalando habilidade…",
    previewConfirmDescription:
      "Revise os resultados da análise abaixo. O plugin ou habilidade só é instalado ou atualizado após você marcar a confirmação e enviar.",
    previewExpires: "A prévia expira em",
    importKind: "Importar conteúdo",
    logoIncluded: "Logotipo incluído",
    declaredCapabilities: "Declarações",
    declaredEnvironmentKeys: "Chaves de ambiente declaradas",
    manifestSummary: "Resumo do manifesto",
    noneDeclared: "Nenhum declarado",
    noRisksDetected:
      "Nenhum risco conhecido foi detectado. Você ainda precisa confiar na origem.",
    sourceTypes: {
      local: "Importação local",
      url: "Importação por URL",
      clawhub: "Repositório de habilidades ClawHub",
    },
    importKinds: {
      manual_skill: "Habilidade criada manualmente",
      zip: "Pacote ZIP local",
    },
    declarations: {
      mcp_server: "Servidor MCP",
      scripts: "Scripts executáveis",
      external_connections: "Conexões com serviços externos",
      environment_variables: "Variáveis de ambiente",
      credentials: "Credenciais",
      dependency_download_commands: "Comandos que podem baixar dependências",
    },
    installCompleted: "Plugin/habilidade instalado.",
    installSkillCompleted: "Habilidade instalada.",
    updateCompleted: "Plugin/habilidade atualizado.",
    updatePluginCompleted: "Plugin atualizado.",
    updateSkillCompleted: "Habilidade atualizada.",
    pluginSavedForNextTurn:
      "Plugin salvo. Ele será atualizado automaticamente antes do próximo turno da tarefa.",
    statusUpdated: "Preferência de ativação atualizada.",
    empty: "Nenhum plugin ou habilidade instalado.",
    pluginEmpty: "Nenhum plugin instalado.",
    skillEmpty: "Nenhuma habilidade instalada.",
    source: "Origem",
    owner: "Proprietário",
    personal: "Pessoal",
    plugin: "Plugin",
    skill: "Habilidade",
    enable: "Ativar",
    disable: "Desativar",
    personallyDisable: "Desativar para mim",
    personallyEnable: "Ativar para mim",
    personallyDisabledMessage:
      "Este plugin ou habilidade foi desativado para você.",
    personallyEnabledMessage:
      "Este plugin ou habilidade foi ativado para você.",
    uninstall: "Desinstalar",
    uninstalling: "Desinstalando",
    skillUninstalled: "Habilidade desinstalada.",
    logo: "Substituir logotipo",
    deleteTitle: "Excluir este plugin/habilidade permanentemente?",
    deletePluginTitle: "Excluir este plugin permanentemente?",
    deleteMcpTitle: "Excluir este MCP permanentemente?",
    deleteDescription:
      "As configurações pessoais relacionadas e os vínculos de credenciais serão excluídos permanentemente. Esta ação não pode ser desfeita.",
    uninstallSkillTitle: "Desinstalar esta habilidade?",
    uninstallSkillDescription:
      "Esta habilidade, suas configurações pessoais relacionadas e os vínculos de credenciais serão removidos. Esta ação não pode ser desfeita.",
    updatePlugin: "Atualizar plugin",
    updateSkill: "Atualizar habilidade",
    updateSubmit: "Confirmar atualização",
    riskDetected:
      "Este plugin ou habilidade declara riscos de execução que precisam de atenção.",
    riskDetails: "Itens de risco",
    risks: {
      contains_mcp_server: "Contém um servidor MCP.",
      contains_scripts: "Contém scripts executáveis.",
      contains_external_connections: "Pode se conectar a serviços externos.",
      requires_environment_variables:
        "Declara requisitos de variáveis de ambiente.",
      requires_credentials: "Declara requisitos de credenciais.",
      contains_dependency_download_commands:
        "Contém um comando de inicialização que pode baixar dependências.",
      declared_environment_keys: "Chaves de ambiente: {{values}}",
      dependency_commands: "Comandos de dependências: {{values}}",
    },
  },
  credential: {
    title: "Credenciais de plugins",
    add: "Adicionar credencial",
    personal: "Credencial pessoal",
    capabilityId: "ID do plugin",
    credentialId: "ID da credencial",
    deleteTitle: "Excluir esta credencial permanentemente?",
    edit: "Editar credencial",
    confirmCreate: "Confirmar criação",
    confirmUpdate: "Confirmar atualização",
    disableTitle: "Desativar esta credencial?",
    enableTitle: "Ativar esta credencial?",
    providerPlaceholder: "Por exemplo: openai_api",
    nameInvalid: "Insira um nome de credencial com até 160 caracteres.",
    plugin: "Plugin",
    description:
      "As credenciais de plugins contêm chaves de API e outros dados de autorização usados pelos plugins para acessar serviços externos. Adicione uma credencial e vincule-a a um plugin para usar esses dados automaticamente ao executá-lo.",
    secret: "Valor de autorização",
    secretHint:
      "Chaves e dados de autorização salvos não são exibidos novamente. Não inclua segredos nos nomes.",
    bind: "Vincular plugin",
    lastUsed: "Último uso",
    empty:
      "Nenhuma credencial ainda. Adicione chaves ou dados de autorização aqui quando um plugin precisar acessar um serviço externo.",
    deleteDescription:
      "Os plugins que usam esta credencial não poderão mais acessar serviços externos por ela. A credencial e seus vínculos serão excluídos permanentemente e não poderão ser restaurados.",
    disableDescription:
      "Os plugins deixarão de usar esta credencial nas próximas execuções. Os vínculos existentes com plugins serão mantidos.",
    enableDescription:
      "Os plugins vinculados poderão usar esta credencial novamente nas próximas execuções.",
    providerType: "Identificador do serviço",
    providerTypeHint:
      "Insira o identificador fornecido para este serviço, como openai_api. Use letras minúsculas, números, sublinhados ou hífens.",
    providerTypeFormat:
      "Use letras minúsculas, números, sublinhados ou hífens no identificador do serviço, como openai_api.",
    secretKey: "Nome da configuração",
    secretKeyHint:
      "Insira o nome exigido pelo plugin, como API_KEY. Copie-o exatamente como aparece nas instruções do plugin.",
    secretKeyFormat:
      "Os nomes das configurações devem começar com uma letra ou sublinhado e conter apenas letras, números ou sublinhados.",
    secretKeyDuplicate: "Os nomes das configurações devem ser únicos.",
    secretRequired: "Insira os dados de autorização a salvar.",
    keepSecretHint:
      "Deixe em branco para manter o valor salvo. Insira um novo valor para substituí-lo.",
    savedSecretHint:
      "Os dados de autorização salvos não são exibidos. Eles são mantidos, a menos que você insira novos valores.",
    bindings: "Plugins vinculados",
    bindingPriority:
      "Escolha um plugin e confirme quais informações ele deve usar desta credencial. O plugin usará esses dados nas próximas execuções.",
    mappingTitle: "Confirmar as informações a usar",
    mappingDescription:
      "Os nomes correspondentes foram selecionados automaticamente. Para os itens restantes, selecione as informações correspondentes desta credencial.",
    pluginEnvironmentKey: "Informações de que o plugin precisa",
    credentialField: "Usar desta credencial",
    notMapped: "Não selecionado",
    bindingInProgress: "Salvando vínculos com plugins…",
    bindingSucceeded: "Vínculos com plugins salvos.",
    confirmBind: "Salvar vínculos",
    unbindTitle: "Remover este vínculo de informação?",
    unbindDescription:
      "“{{plugin}}” deixará de ler “{{name}}” desta credencial. As informações salvas serão mantidas.",
    confirmUnbind: "Remover vínculo",
    unbindNamed: "Desvincular {{name}}",
    addSecretField: "Adicionar item de configuração",
    removeSecretField: "Remover este item de configuração",
    noDeclaredKeys:
      "Este plugin não tem informações de credenciais a configurar.",
    pluginCount_one: "Usado por {{count}} plugin",
    pluginCount_other: "Usado por {{count}} plugins",
    associatedFields_one: "{{count}} item vinculado",
    associatedFields_other: "{{count}} itens vinculados",
    notAssociated:
      "Ainda não usado por nenhum plugin. Vincule um plugin para usar estes dados automaticamente durante a execução.",
    unavailablePlugin: "Plugin inacessível",
    credentialDetails: "Detalhes da credencial",
    showDetails: "Ver detalhes da configuração",
    hideDetails: "Ocultar detalhes da configuração",
    pluginActionsNamed: "Ações de vínculo de {{name}}",
    detailsNamed: "Detalhes da configuração de {{name}}",
    manageAssociation: "Gerenciar vínculos",
    removeAssociation: "Desvincular plugin",
    removeAssociationTitle: "Desvincular este plugin?",
    removeAssociationDescription:
      "“{{name}}” deixará de usar todas as informações desta credencial. A credencial será mantida e você poderá vinculá-la novamente depois.",
    completeConfiguration: "Concluir configuração",
    fixAssociation: "Resolver vínculos",
    enableAction: "Ativar credencial",
    configurationNote:
      "Esta tela mostra a configuração salva. Ela não verifica o acesso ao serviço externo.",
    usesField: "Usa desta credencial:",
    otherCredential: "Fornecido por outra credencial.",
    removeField: "Remover vínculo",
    removeFieldNamed: "Remover o vínculo de {{name}}",
    mappingSummary: "{{configured}} de {{total}} itens selecionados",
    unselectedFields: "Ainda não selecionados:",
    selectInformation: "Selecionar ou ajustar informações",
    configurationStatus: {
      loading: "Verificando…",
      failed: "Status indisponível",
      unavailable: "Plugin indisponível",
      configured: "Credenciais configuradas",
      missing: "Mais informações necessárias",
      disabled: "Esta credencial está desativada",
      disabledElsewhere: "Uma credencial está desativada",
      conflict: "Vínculos conflitantes",
      invalid: "A configuração precisa ser atualizada",
    },
    configurationHelp: {
      failed:
        "Não foi possível carregar o status da configuração. Tente novamente.",
      unavailable:
        "Este plugin está indisponível ou você não tem acesso. Desvincule-o ou entre em contato com um administrador.",
      missing:
        "O plugin tem informações não configuradas. Veja os detalhes para identificar o que falta e concluir a configuração.",
      disabled:
        "Ative esta credencial para que o plugin possa usar suas informações novamente.",
      disabledElsewhere:
        "Outra credencial usada por este plugin está desativada. Ative essa credencial ou atualize os vínculos.",
      conflict:
        "O mesmo item está vinculado a várias credenciais. Gerencie os vínculos para selecionar as informações a usar.",
      invalid:
        "As informações vinculadas não podem ser usadas ou não correspondem mais aos requisitos do plugin. Verifique os valores salvos e atualize os vínculos.",
    },
    fieldStatus: {
      configured: "Configurado",
      missing: "Não configurado",
      disabled: "A credencial que fornece este valor está desativada",
      conflict: "Vinculado a várias credenciais",
      invalid: "Atualização necessária",
    },
  },
  profile: {
    title: "Configurações pessoais",
    description:
      "Gerencie seu avatar, idioma da interface e segurança de acesso.",
    avatar: "Avatar",
    uploadAvatar: "Enviar novo avatar",
    editName: "Editar nome",
    editNameTitle: "Editar nome",
    editNameDescription: "Atualize seu nome de exibição.",
    role: "Função",
    profileSaved: "Configurações pessoais salvas.",
    passwordChanged: "Senha alterada. Entre novamente.",
    general: "Geral",
    security: "Segurança de acesso",
    avatarSaved: "Avatar atualizado.",
    usageSummary: "Visão geral do uso pessoal",
    loadingUsage: "Carregando uso pessoal…",
    totalTokens: "Total de tokens",
    peakDailyTokens: "Pico diário de tokens",
    totalTasks: "Total de tarefas",
    currentStreak: "Sequência atual",
    longestStreak: "Maior sequência",
    dayCount_one: "{{count}} dia",
    dayCount_other: "{{count}} dias",
    tokenActivity: "Atividade de tokens",
    tokenActivityDescription: "Seu uso diário de tokens nos últimos 365 dias.",
    activityChartLabel:
      "Mapa de calor da atividade de tokens nos últimos 365 dias",
    activityDayLabel: "{{date}}, {{tokens}} tokens usados",
    activityTooltip: "{{tokens}} tokens usados em {{date}}",
    activityLess: "Menos",
    activityMore: "Mais",
    activityUnavailable: "Nenhuma atividade de tokens disponível ainda.",
    usageInsights: "Estatísticas de uso",
    totalTurns: "Total de conversas",
    modelCalls: "Total de chamadas de modelos",
    skillUses: "Usos de habilidades",
    activeDays: "Dias ativos",
    averageTokensPerTurn: "Média de tokens por turno",
    mostUsedModels: "Modelos mais usados",
    mostUsedSkills: "Habilidades mais usadas",
    modelUsageShare: "{{model}} representa {{share}}% do total de tokens",
    skillUsageCount_one: "{{count}} uso",
    skillUsageCount_other: "{{count}} usos",
    noModelUsage: "Nenhum uso de modelo registrado ainda.",
    noSkillUsage: "Nenhum uso de habilidade registrado ainda.",
    passwordDescription:
      "Alterar sua senha revoga as sessões existentes e exige que você entre novamente.",
  },
  usage: {
    title: "Análise de uso",
    description:
      "Consulte tarefas, turnos, uso de tokens de modelos e custos globalmente, por aplicativo, participação atual em grupos e usuário.",
    sectionLabel: "Análise de uso e faturamento",
    sections: {
      analytics: "Análise de uso",
      billing: "Faturamento",
    },
    billing: {
      pageDescription:
        "Consulte demonstrativos mensais resumidos por modelo, visualize-os online e exporte-os em PDF.",
      period: "Período de faturamento",
      total: "Total do demonstrativo",
      modelCount: "Modelos",
      generatedAt: "Gerado",
      current: {
        title: "Período de faturamento atual",
        description:
          "O demonstrativo é gerado automaticamente após o encerramento do mês civil.",
        open: "Em andamento",
        expectedGeneration: "Geração prevista",
      },
      history: {
        title: "Demonstrativos mensais",
        description:
          "Registros mensais imutáveis do uso de modelos e das cobranças.",
        empty: "Nenhum demonstrativo mensal foi gerado ainda.",
      },
      detail: {
        title: "Detalhes do demonstrativo",
        description: "Carregando detalhes do demonstrativo…",
      },
      columns: {
        model: "Modelo",
        input: "Tokens de entrada",
        cached: "Tokens em cache",
        output: "Tokens de saída",
        totalTokens: "Total de tokens",
        pricing: "Preços",
        amount: "Valor",
      },
      uniformPricing: "Tarifa fixa",
      mixedPricing: "Várias tarifas",
      preview: {
        action: "Visualizar online",
      },
      export: {
        action: "Exportar PDF",
        success: "PDF do demonstrativo exportado.",
        filename: "{{statementNumber}}-demonstrativo.pdf",
      },
      pdf: {
        statement: "Demonstrativo mensal",
        accountStatement: "Demonstrativo de uso de modelos",
        statementNumber: "Número do demonstrativo",
        billingPeriod: "Período de faturamento",
        generatedAt: "Gerado em",
        currency: "Moeda",
        pricePerMillion: "Tarifa por 1 milhão de tokens",
        inputShort: "Entrada",
        cachedShort: "Em cache",
        outputShort: "Saída",
        totalAmount: "Total do demonstrativo",
        unpricedNote:
          "{{tokens}} tokens não têm registro de preço e não estão incluídos no valor devido.",
        page: "Página {{current}} de {{total}}",
        footer:
          "Gerado automaticamente pelo LinkSense a partir dos preços registrados no momento de cada chamada.",
      },
    },
    rangeLabel: "Período do relatório",
    ranges: {
      all: "Todo o período",
      sevenDays: "Últimos 7 dias",
      thirtyDays: "Últimos 30 dias",
      custom: "Período personalizado",
    },
    customRange: {
      dateFrom: "Data inicial",
      dateTo: "Data final",
      selectDate: "Selecionar data",
      clearDate: "Limpar data",
    },
    export: {
      action: "Exportar Excel",
      exporting: "Exportando…",
      success: "Análise de uso exportada.",
      filename: "{{productPrefix}}-analise-de-uso-{{date}}.xlsx",
    },
    tasks: "Tarefas",
    turns: "Turnos",
    modelCalls: "Chamadas de modelos",
    totalTokens: "Total de tokens",
    totalCost: "Custo total",
    inputCost: "Custo de entrada",
    cachedInputCost: "Custo de entrada em cache",
    outputCost: "Custo de saída",
    sort: {
      asc: "Ordenar por {{field}} em ordem crescente",
      desc: "Ordenar por {{field}} em ordem decrescente",
    },
    tasksHint:
      "Tarefas criadas no período selecionado; exclusões posteriores não alteram o histórico",
    turnsHint:
      "Turnos efetivos criados no período selecionado; exclusões posteriores não alteram o histórico",
    tokensHint:
      "Inclui respostas, embeddings de documentos, embeddings de consultas e reordenação",
    costHint:
      "Acumulado a partir do preço registrado em cada chamada; alterações de preço posteriores não mudam o histórico",
    unpricedTokensHint:
      "{{tokens}} tokens não têm registro de preço e não estão incluídos no custo",
    unpricedShort: "{{tokens}} sem preço",
    trend: {
      title: "Tendência de uso de tokens",
      description:
        "Totais de tokens do período selecionado, agrupados {{granularity}} e empilhados por tipo de atividade do modelo.",
      empty: "Nenhum uso de tokens no período selecionado.",
      ariaLabel: "Tendência de uso de tokens no período selecionado",
      granularity: {
        day: "por dia",
        month: "por mês",
        year: "por ano",
      },
    },
    costTrend: {
      title: "Tendência de custos",
      description:
        "Custos históricos registrados no momento das chamadas, agrupados {{granularity}} e empilhados por tipo de atividade do modelo.",
      empty: "Nenhum custo de modelo no período selecionado.",
      ariaLabel: "Tendência de custos de modelos no período selecionado",
    },
    tabsLabel: "Dimensões da análise de uso",
    tabs: {
      models: "Por modelo",
      workloads: "Por tipo de atividade",
      applications: "Por aplicativo",
      groups: "Por grupo",
      users: "Por usuário",
    },
    modelsTitle: "Todo o uso de modelos",
    modelsDescription:
      "Chamadas, composição de tokens e custos de cada modelo de geração, embeddings e reordenação.",
    tableCostUnit: "Unidade de custo: USD (dólares).",
    modelsEmpty: "Nenhum uso de modelo no período selecionado.",
    workloadsTitle: "Uso por tipo de atividade do modelo",
    workloadsDescription:
      "Separa respostas de IA, nomeação automática de tarefas, geração de memórias, embeddings de documentos de conhecimento, embeddings de consultas e reordenação de resultados. O uso é marcado como estimado quando o provedor não o informa.",
    workloadsEmpty:
      "Nenhum uso por tipo de atividade do modelo no período selecionado.",
    applicationsTitle: "Uso do aplicativo",
    applicationsDescription:
      "Resume tarefas, turnos, chamadas de modelos, tokens e custos pelo aplicativo vinculado quando cada tarefa foi criada. O uso fora de aplicativos é listado separadamente.",
    applicationsEmpty: "Nenhum uso de aplicativo no período selecionado.",
    applicationDetailDescription:
      "Uso de modelos das tarefas vinculadas a este aplicativo",
    application: "Aplicativo",
    unattributedApplication: "Sem vínculo com aplicativo",
    workload: "Tipo de atividade do modelo",
    workloads: {
      assistant_response: "Respostas de IA",
      memory_generation: "Geração de memórias",
      task_title_generation: "Nomeação automática de tarefas",
      document_embedding: "Embeddings de documentos",
      query_embedding: "Embeddings de consultas",
      rerank: "Reordenação da busca",
      image_generation: "Geração de imagens",
    },
    modelKinds: {
      generation: "Modelo de geração",
      embedding: "Modelo de embeddings",
      rerank: "Modelo de reordenação",
      image: "Modelo de imagens",
    },
    measurementMethod: "Medição",
    measurementMethods: {
      provider: "Informada pelo provedor",
      estimated: "Estimada localmente",
    },
    groupsTitle: "Uso por grupo",
    groupsDescription:
      "Calculado com base nos membros ativos atuais. Um usuário pode pertencer a vários grupos, por isso as linhas dos grupos não devem ser somadas para obter o total global.",
    currentMembership: "Membros atuais",
    groupDetailDescription: "Uso de modelos de {{count}} membros atuais",
    usersTitle: "Uso por usuário",
    usersDescription:
      "Tarefas, turnos e uso de tokens de modelos de cada usuário.",
    searchUsers: "Pesquisar usuários por nome ou e-mail",
    usersEmpty: "Nenhum usuário correspondente.",
    modelBreakdown: "Detalhamento por modelo",
    model: "Modelo",
    inputTokens: "Tokens de entrada",
    cachedInputTokens: "Tokens de entrada em cache",
    outputTokens: "Tokens de saída",
    reasoningOutputTokens: "Tokens de saída de raciocínio",
    group: "Grupo",
    members: "Membros",
    ungrouped: "Usuários sem grupo",
    unknownModel: "Modelo desconhecido",
    noSelection: "Nenhum dado disponível",
    tokenCompositionNote:
      "Tokens de entrada em cache são parte dos tokens de entrada, e tokens de saída de raciocínio são parte dos tokens de saída; nenhum deles é somado novamente ao total. As contagens de tarefas e turnos usam registros imutáveis de criação, por isso a exclusão posterior de tarefas não reduz o histórico.",
    costCompositionNote:
      "Os custos mantêm precisão total no armazenamento e na agregação e são exibidos com duas casas decimais. As diferenças de arredondamento são distribuídas proporcionalmente em cada total para que os detalhes exibidos somem o total mostrado. O custo de entrada comum exclui a entrada em cache, cobrada pela própria tarifa. Preços e custos são fixados quando cada chamada é registrada, por isso alterações de preço posteriores nunca recalculam o histórico.",
  },
  myFeedback: {
    title: "Meu feedback",
    description: "Veja seu feedback e as respostas dos administradores.",
    empty: "Nenhum feedback ainda",
    emptyDescription:
      "Use o menu de ajuda para compartilhar um problema ou sugestão.",
    replyStatus: "Status da resposta",
    replied: "Respondido",
    awaitingReply: "Aguardando resposta",
    detailsDescription: "Veja o feedback e seu histórico de respostas.",
    replies: "Respostas",
    noReplies: "Nenhuma resposta ainda",
    writeReply: "Responder ao usuário",
    replyHint: "Envie texto, imagens ou ambos.",
    replyPlaceholder: "Escreva uma resposta…",
    replyImages: "Imagens da resposta",
    replySuccess: "Resposta enviada",
    sendingReply: "Enviando…",
    sendReply: "Enviar resposta",
  },
  adminFeedback: {
    title: "Feedback dos usuários",
    description:
      "Revise os textos de feedback e as capturas de tela de problemas enviadas pelos usuários.",
    empty: "Nenhum feedback de usuário ainda.",
    submitter: "Enviado por",
    content: "Feedback",
    images: "Imagens",
    submittedAt: "Enviado",
    imageCount: "{{count}} imagem",
    imageCount_other: "{{count}} imagens",
    detailsTitle: "Detalhes do feedback",
    detailsDescription: "Enviado por {{name}} em {{time}}",
    imageList: "Imagens do feedback",
    imageAlt: "Imagem de feedback {{name}}",
    openImage: "Abrir uma visualização ampliada de {{name}}",
    imagePreviewTitle: "Visualização da imagem",
    imageLoading: "Carregando imagem",
    imageUnavailable: "Esta imagem está temporariamente indisponível.",
    pagination: "Paginação da lista de feedback dos usuários",
    deleteLabel: "Excluir feedback enviado por {{name}}",
    deleteTitle: "Excluir este feedback?",
    deleteDescription:
      "Esta ação exclui o feedback enviado por {{name}}, todas as respostas e todas as imagens. Esta ação não pode ser desfeita.",
    deleting: "Excluindo…",
    deleteSuccess: "Feedback excluído.",
  },
  systemUpdate: {
    notice: {
      title: "LinkSense {{version}} está disponível",
      description:
        "Administradores podem revisar a versão e seguir o processo guiado de atualização.",
      action: "Ver atualização",
      dismiss: "Dispensar o aviso de atualização desta versão",
    },
    status: {
      update_available: "Atualização disponível",
      up_to_date: "Atualizado",
      check_failed: "A verificação falhou",
    },
    overview: {
      title: "Status da versão",
      description:
        "Verifique automaticamente as versões oficiais do LinkSense no GitHub.",
    },
    currentVersion: "Versão atual",
    latestVersion: "Versão mais recente",
    checkedAt: "Última verificação",
    publishedAt: "Publicado",
    checkNow: "Verificar agora",
    openRelease: "Ver versão no GitHub",
    releaseNotes: "Notas da versão",
    refreshFailed: "Não foi possível verificar atualizações novamente",
    checkFailed: {
      title: "A versão mais recente está temporariamente indisponível",
      GITHUB_UNAVAILABLE:
        "O servidor não conseguiu acessar o GitHub. Verifique o acesso à rede e tente novamente.",
      GITHUB_RATE_LIMITED:
        "O GitHub limitou temporariamente as verificações de atualização. Tente novamente mais tarde.",
      GITHUB_RESPONSE_INVALID:
        "O GitHub retornou informações de versão que o LinkSense não reconheceu. Tente novamente mais tarde.",
    },
    tutorial: {
      title: "Guia de atualização",
      description:
        "O script de atualização detecta a edição Core ou Full, aguarda os trabalhos em andamento e cria um backup validado do banco de dados antes da migração.",
      safetyTitle:
        "O aplicativo Web nunca inicia a atualização automaticamente",
      safetyDescription:
        "Execute o comando em um terminal no host do LinkSense. Agende primeiro uma janela de manutenção e garanta que um administrador possa verificar a saúde dos serviços.",
      linux: "Linux",
      macos: "macOS (não use sudo)",
      steps: {
        maintenance:
          "Agende uma janela de manutenção em um período de menor uso e avise os usuários ativos.",
        run: "Acesse o host do LinkSense e execute o comando correspondente ao sistema operacional.",
        backup:
          "Guarde o local do backup do PostgreSQL exibido pelo script. Uma falha após o início da migração do banco de dados não restaura o banco automaticamente.",
        health:
          "Após a atualização, abra Saúde do sistema e confirme que todos os serviços se recuperaram.",
      },
    },
  },
  admin: {
    usersAndGroupsTitle: "Usuários e grupos",
    usersAndGroupsDescription:
      "Gerencie contas, funções, status, grupos e membros em um só lugar.",
    usersAndGroupsTabsLabel: "Gerenciamento de usuários e grupos",
    usersTitle: "Usuários",
    usersDescription:
      "Crie, importe e gerencie usuários autorizados. Administradores não podem visualizar nem redefinir senhas dos usuários.",
    rolesTitle: "Funções e permissões",
    rolesDescription:
      "Consulte as funções fixas e os limites de permissão dos recursos atuais do {{productName}}. As permissões se aplicam apenas a contas ativas; atribua funções no Gerenciamento de usuários.",
    roleUserDescription:
      "Gerencia suas próprias tarefas, configurações pessoais, plugins/habilidades e credenciais; usa a Central de plugins; cria ou gerencia suas bases de conhecimento e usa bases compartilhadas.",
    roleAdminDescription:
      "Um administrador ativo tem as permissões de usuário e administra usuários e grupos, Central de plugins, metadados e fontes de conhecimento, modelos e preços, configurações do sistema, saúde, metadados de auditoria e uso. A função de administrador por si só não concede acesso ao conteúdo das tarefas ou bases de conhecimento de outros usuários.",
    permissionMatrix: "Matriz de permissões",
    permission: "Permissão",
    roleAccountBreakdown: "Contagem de contas por função",
    roleAccountCount: "{{count}} contas",
    roleActiveAccountCount: "{{count}} ativas",
    roleDisabledAccountCount: "{{count}} desativadas",
    rolePermissions: {
      ownConversations: "Gerenciar as próprias tarefas",
      personalSettings:
        "Gerenciar configurações de perfil, aparência e segurança",
      personalCapabilities:
        "Criar, importar e gerenciar plugins/habilidades pessoais",
      usePluginCenter:
        "Explorar, instalar e atualizar plugins e enviar listagens para revisão",
      personalCredentials: "Gerenciar credenciais pessoais",
      personalKnowledgeBases:
        "Gerenciar as próprias bases de conhecimento e usar bases compartilhadas",
      manageUsersAndGroups: "Gerenciar usuários e grupos de usuários",
      governStoreCapabilities:
        "Revisar e administrar listagens da Central de plugins",
      governKnowledgeBases:
        "Administrar metadados e ciclo de vida das bases de conhecimento sem acesso automático ao conteúdo",
      manageKnowledgeSources:
        "Configurar fontes de conhecimento e sincronização",
      manageModelsAndPricing:
        "Configurar modelos de geração, compreensão de imagens, embeddings e reordenação e preços de tokens",
      manageSystemSettings:
        "Gerenciar configurações do produto e provedores de acesso",
      manageSystemHealth:
        "Consultar a saúde do sistema e executar manutenção das bases de conhecimento",
      viewAuditMetadata:
        "Ver metadados de auditoria e tarefas de diferentes usuários, com dados sensíveis ocultados e sem conteúdo",
      viewUsageAnalytics:
        "Ver uso e custos de modelos globalmente, por grupo e por usuário",
    },
    createUser: "Criar usuário",
    importUsers: "Importar Excel",
    role: "Função",
    registrationSource: "Origem do usuário",
    registrationSources: {
      selfRegistration: "Cadastro próprio",
      organizationInvitation: "Convite da organização",
    },
    loginMethod: "Método de acesso",
    lastLogin: "Último acesso",
    weeklyCreditLimit: "Cota semanal (créditos)",
    creditLimitDisplay: "{{value}} créditos",
    creditQuotaRemainingFilter: "Cota restante",
    filters: {
      allRoles: "Todas as funções",
      allStatuses: "Todos os status",
      allSources: "Todas as origens de usuários",
      allQuotas: "Todas as cotas",
      allActions: "Todas as ações",
      allResults: "Todos os resultados",
      allRunnerStatuses: "Todos os status do executor",
      allArchiveStatuses: "Todos os status de arquivamento",
    },
    weeklyCreditQuotaRemainingZero: "Restante semanal é 0",
    creditQuotaRemainingAmount:
      "{{value}} créditos restantes ({{percentage}}%)",
    creditQuotaRemainingUnavailable: "Cota restante -",
    noCreditLimit: "Ilimitado",
    inheritCreditLimit: "Ilimitado",
    clearCreditLimit: "Deixe em branco para limpar a cota individual",
    creditLimitHint:
      "Insira um número positivo. Decimais são permitidos. Unidade: créditos. Em branco significa sem configuração de cota individual.",
    creditLimitInputInvalid:
      "Insira um número maior que 0 com no máximo 6 casas decimais. Unidade: créditos.",
    userCreditLimits: "Cotas de créditos individuais",
    userCreditLimitsDescription:
      "A cota semanal é renovada à meia-noite de toda segunda-feira. Quando se esgota, o usuário não pode iniciar novas tarefas. Tarefas em andamento não são afetadas.",
    adjustCreditLimits: "Ajustar cota",
    adjustUserCreditLimits: "Ajustar cota de {{name}}",
    singleCreditLimitsTitle: "Ajustar cotas de créditos individuais",
    singleCreditLimitsDescription:
      "Atualize a cota semanal de {{name}}. Deixe em branco para não definir uma cota individual.",
    batchCreditLimits: "Definir cota ({{count}})",
    batchCreditLimitsTitle: "Definir cotas de créditos de usuários em lote",
    batchCreditLimitsDescription:
      "Defina a cota semanal dos {{count}} usuários selecionados. Deixar em branco limpa a cota individual.",
    creditLimitFields: "Cota semanal",
    singleCreditLimitsSaved: "Cotas de créditos de {{name}} atualizadas.",
    creditLimitsSaved: "Cotas de créditos de {{count}} usuários atualizadas.",
    selectVisibleUsers: "Selecionar usuários da lista atual",
    selectUser: "Selecionar usuário {{name}}",
    groups: "Grupos de usuários",
    selectGroups: "Selecionar grupos de usuários",
    searchGroups: "Pesquisar grupos de usuários",
    groupSearchEmpty: "Nenhum grupo de usuários correspondente encontrado.",
    removeGroup: "Remover grupo de usuários {{name}}",
    additionalGroups: "Mais {{count}} grupos de usuários",
    userStatus: "Status do usuário",
    usersEmpty: "Nenhum usuário encontrado.",
    groupsTitle: "Grupos de usuários",
    groupsDescription:
      "Gerencie grupos de usuários sem hierarquia e seus membros.",
    createGroup: "Criar grupo de usuários",
    members: "Membros",
    viewGroupMembers: "Ver {{count}} membros de {{name}}",
    groupMembersTitle: "Membros de {{name}}",
    groupMembersDescription: "{{count}} membros",
    groupMembersEmpty: "Este grupo de usuários não tem membros.",
    memberListLabel: "Membros do grupo de usuários",
    loadMoreMembers: "Carregar mais membros",
    memberSelector: "Membros",
    selectMembers: "Selecionar membros",
    selectedMembers: "{{count}} membros selecionados",
    memberSearchPlaceholder: "Pesquisar membros por nome ou e-mail",
    memberSearchEmpty: "Nenhum membro correspondente encontrado.",
    groupsEmpty: "Nenhum grupo de usuários.",
    auditTitle: "Logs de auditoria",
    auditDescription:
      "São exibidos apenas os metadados permitidos de diferentes usuários. Textos de tarefas, conteúdo de anexos e links de download são excluídos.",
    action: "Ação",
    actionCode: "Código da ação",
    actionSearchPlaceholder: "Pesquisar ou selecionar uma ação",
    actionSearchEmpty: "Nenhuma ação correspondente.",
    actor: "Autor da ação",
    target: "Alvo",
    targetTypeCode: "Código do tipo de alvo",
    result: "Resultado",
    resultCode: "Código do resultado",
    sourceIp: "IP de origem",
    exportCreatedAt: "Criado em",
    exportActorId: "ID do autor da ação",
    exportTargetType: "Tipo de alvo",
    exportTargetId: "ID do alvo",
    exportMetadata: "Metadados",
    auditId: "ID do log",
    userAgent: "User-Agent",
    auditDetailsTitle: "Detalhes do log de auditoria",
    auditDetailsDescription:
      "Todas as informações disponíveis desta entrada de auditoria, com dados sensíveis ocultados, são exibidas abaixo.",
    auditEventInformation: "Informações do log",
    auditSubjectInformation: "Autor e alvo",
    auditRequestInformation: "Informações da solicitação",
    auditMetadataTitle: "Metadados com dados sensíveis ocultados",
    auditMetadataEmpty: "Sem metadados adicionais.",
    auditConversationDetailsTitle: "Detalhes da execução da tarefa",
    auditConversationDetailsDescription:
      "Todos os metadados de execução disponíveis desta tarefa, com dados sensíveis ocultados, são exibidos abaixo.",
    retainedArtifactDetailsTitle:
      "Detalhes dos arquivos gerados pela tarefa excluída",
    retainedArtifactDetailsDescription:
      "Todas as informações resumidas disponíveis dos arquivos mantidos permanentemente desta tarefa excluída são exibidas abaixo.",
    auditExecutionInformation: "Informações de execução",
    auditArtifactInformation: "Informações dos arquivos gerados",
    ownerId: "ID do proprietário",
    ownerName: "Nome do proprietário",
    ownerEmail: "E-mail do proprietário",
    executionDuration: "Duração da execução",
    executionErrorType: "Tipo de erro",
    attachmentCount: "Quantidade de anexos",
    attachmentSize: "Tamanho total dos anexos",
    artifactCount: "Quantidade de arquivos gerados",
    artifactSize: "Tamanho total dos arquivos gerados",
    firstArtifactCreatedAt: "Primeiro arquivo gerado em",
    lastArtifactCreatedAt: "Último arquivo gerado em",
    export: "Exportar CSV",
    exporting: "Exportando…",
    auditEmpty: "Nenhum registro de auditoria correspondente.",
    settingsTitle: "Configurações do sistema",
    managementTitle: "Gerenciamento",
    settingsDescription:
      "Gerencie a apresentação do produto, as tarefas simultâneas, os e-mails de autenticação e os recursos de acesso. Os segredos são criptografados e nunca são exibidos novamente.",
    settingsTabsLabel: "Categorias das configurações do sistema",
    settingsTabs: {
      product: "Configurações do produto",
      concurrency: "Tarefas simultâneas",
      smtp: "E-mail de autenticação",
      registration: "Cadastro aberto",
      login: "Métodos de acesso",
      maintenance: "Manutenção do sistema",
    },
    concurrency: {
      title: "Tarefas simultâneas",
      description:
        "Defina quantas tarefas podem ser executadas no sistema e por usuário. Deixe um campo em branco para usar o padrão da implantação.",
      globalLimit: "Limite de tarefas em execução no sistema",
      globalLimitDescription:
        "Número máximo de tarefas em execução entre todos os usuários. Deixe em branco para usar o padrão da implantação, {{defaultValue}}; o valor efetivo atual é {{effectiveValue}}.",
      processLimit: "Limite de processos de tarefas por usuário",
      processLimitDescription:
        "Número máximo de processos de tarefas carregados por usuário. Deixe em branco para usar o padrão da implantação, {{defaultValue}}; o valor efetivo atual é {{effectiveValue}}.",
      loweringBehavior:
        "Reduzir um limite não interrompe tarefas em execução. Novas tarefas podem começar quando o uso atual ficar abaixo do novo limite.",
      saved: "Configurações de tarefas simultâneas atualizadas.",
      errors: {
        positiveInteger:
          "Insira um número inteiro maior que 0 ou deixe em branco para usar o padrão da implantação.",
      },
    },
    registration: {
      enabled: "Permitir cadastro por conta própria",
      enabledDescription:
        "Quando ativado, a página de acesso mostra a opção de cadastro. Desativar bloqueia novas solicitações e links de ativação já enviados.",
      saved: "Configurações de cadastro aberto atualizadas.",
    },
    systemName: "Nome de exibição do sistema",
    systemLogo: "Logotipo do sistema",
    systemLogoDescription:
      "Usado na página de acesso, na barra lateral e na página de manutenção.",
    systemLogoHint:
      "Aceita PNG, JPEG, WebP ou GIF. Recomenda-se uma imagem horizontal transparente com menos de 2 MB.",
    uploadSystemLogo: "Enviar logotipo",
    replaceSystemLogo: "Substituir logotipo",
    removeSystemLogo: "Restaurar logotipo padrão",
    deploymentStatus: "Status da configuração da implantação",
    settingsSaved: "Configurações do sistema atualizadas.",
    systemLogoSaved: "Logotipo do sistema atualizado.",
    systemLogoRemoved: "Logotipo padrão restaurado.",
    maintenance: {
      title: "Manutenção do sistema",
      description:
        "Agende a manutenção de todo o sistema. Durante a janela, usuários comuns veem apenas a página de manutenção, enquanto administradores mantêm o acesso.",
      enabled: "Ativar manutenção agendada",
      enabledDescription:
        "A manutenção só fica ativa entre os horários de início e término configurados.",
      reason: "Motivo da manutenção",
      reasonPlaceholder:
        "Opcional: explique por que a manutenção é necessária e como afeta os usuários…",
      duration: "Duração da manutenção",
      durationHint:
        "Após escolher ou inserir uma duração, o horário de término é calculado a partir do início. Você ainda pode ajustar manualmente os horários de início e término.",
      durationPresetsLabel: "Atalhos de duração da manutenção",
      durationPresets: {
        "10m": "10 min",
        "30m": "30 min",
        "1h": "1 hora",
        "2h": "2 horas",
        "4h": "4 horas",
      },
      durationCustomPlaceholder: "Inserir manualmente",
      durationUnit: "Unidade de duração da manutenção",
      durationUnits: {
        minute: "minutos",
        hour: "horas",
      },
      startAt: "Horário de início",
      endAt: "Horário de término",
      datePlaceholder: "Selecionar data",
      clearStartDate: "Limpar data inicial",
      clearEndDate: "Limpar data final",
      startHour: "Horário de início · hora",
      startMinute: "Horário de início · minuto",
      endHour: "Horário de término · hora",
      endMinute: "Horário de término · minuto",
      timezoneHint:
        "Os horários usam o fuso horário do dispositivo atual e são convertidos para o horário do sistema ao salvar.",
      save: "Salvar configurações de manutenção",
      saved: "Configurações de manutenção salvas",
      closed: "Manutenção do sistema desativada",
      status: {
        active: "Em manutenção",
        scheduled: "Agendado",
        disabled: "Não ativado",
      },
      errors: {
        startRequired:
          "Selecione um horário de início antes de ativar a manutenção.",
        endRequired:
          "Selecione um horário de término antes de ativar a manutenção.",
        endAfterStart: "O horário de término deve ser posterior ao de início.",
      },
    },
    modelTabs: {
      label: "Categorias das configurações de modelos",
      channels: "Canais de modelos",
      conversation: "Modelos de conversa",
      knowledge: "Modelos de busca de conhecimento",
      voiceTranscription: "Modelo de transcrição de voz",
      imageGeneration: "Modelo de geração de imagens",
    },
    modelProvider: {
      catalogDescription:
        "Gerencie as conexões dos modelos, seus preços e sua ordem no campo de mensagem.",
      currentChannel: "Canal atual",
      editChannel: "Editar canal",
      connectionDescription:
        "Os modelos deste canal compartilham estas configurações de conexão.",
      channelActions: "Ações do canal",
      channelSummaryConfigured_one:
        "Este canal se conecta por {{provider}} e inclui {{count}} modelo. A chave de API está configurada",
      channelSummaryConfigured_other:
        "Este canal se conecta por {{provider}} e inclui {{count}} modelos. A chave de API está configurada",
      channelSummaryNotConfigured_one:
        "Este canal se conecta por {{provider}} e inclui {{count}} modelo. Nenhuma chave de API configurada ainda",
      channelSummaryNotConfigured_other:
        "Este canal se conecta por {{provider}} e inclui {{count}} modelos. Nenhuma chave de API configurada ainda",
      channelSummaryEnd: ".",
      noChannels: "Nenhum canal de modelos ainda",
      noChannelsDescription:
        "Adicione um canal e configure seu primeiro modelo para começar.",
      noModelsDescription:
        "Use Adicionar modelo para configurar um modelo neste canal.",
      editModel: "Editar modelo {{name}}",
      modelEditorDescription:
        "Canal: {{name}}. Salvar atualiza apenas este modelo.",
      basicInformation: "Informações básicas",
      pricing: "Preços do modelo",
      capabilities: "Recursos",
      modelName: "Modelo",
      priceSummary: "Preço de entrada / entrada em cache / saída",
      modelActions: "Ações do modelo {{name}}",
      modelAvailability: "Disponível em conversas: {{name}}",
      modelOrder: "Ordem dos modelos",
      moveUp: "Mover para cima",
      moveDown: "Mover para baixo",
      moveChannelUp: "Mover canal para cima",
      moveChannelDown: "Mover canal para baixo",
      orderHint:
        "Arraste pela alça ou use Mover para cima e Mover para baixo. O campo de mensagem lista os modelos de conversa disponíveis pela ordem dos canais e depois pela ordem dos modelos de cada canal.",
      reorderModel: "Reordenar modelo {{name}}",
      reorderInstructions:
        "Pressione Espaço para começar a ordenar, use as setas para cima e para baixo para mover, pressione Espaço para confirmar ou Escape para cancelar.",
      reorderStarted: "Reordenação de {{name}} iniciada.",
      reorderPosition: "{{name}} movido para a posição {{position}}.",
      reorderCancelled: "Reordenação cancelada.",
      discardTitle: "Descartar alterações não salvas?",
      discardDescription:
        "Fechar descartará as alterações feitas neste editor.",
      discardAction: "Descartar alterações",
      selectionsHint:
        "O modelo de conversa padrão é usado antes de o usuário fazer uma seleção. O modelo de nomeação de tarefas gera os títulos das tarefas.",
      title: "Serviço de modelos",
      description:
        "Gerencie modelos de conversa, busca de conhecimento e outros modelos com seus canais de serviço. O sistema usa o serviço adequado para cada modelo selecionado, e administradores podem definir os níveis de raciocínio disponíveis para modelos de conversa.",
      readOnlyNotice:
        "As configurações de modelos estão somente leitura no momento. Você pode visualizar as configurações existentes, mas não pode adicionar, editar ou excluir modelos nem alterar sua disponibilidade em conversas.",
      providers: "Canais de modelos",
      providersDescription:
        "Gerencie modelos e suas conexões em um só lugar. IDs de modelos não podem ser reutilizados, para que o sistema sempre selecione o modelo correto.",
      addProvider: "Adicionar canal de modelos",
      providerTitle: "Canal de modelos {{index}}",
      providerName: "Nome do canal",
      renameProvider: "Renomear canal de modelos {{name}}",
      renameProviderTitle: "Renomear canal de modelos",
      renameProviderDescription:
        "O nome do canal é usado apenas para identificação pelo administrador e entra em vigor após salvar as configurações de modelos.",
      renameProviderAction: "Renomear",
      unnamedProvider: "Canal de modelos não configurado",
      deleteProvider: "Excluir canal",
      saveProvider: "Salvar canal de modelos {{name}}",
      deleteProviderTitle: "Excluir canal de modelos “{{name}}”?",
      deleteProviderDescription:
        "Este canal e todos os seus modelos serão excluídos imediatamente após a confirmação. Tarefas e registros de uso históricos não são afetados.",
      providerDeleted: "Canal de modelos excluído.",
      baseUrl: "URL base",
      apiKey: "API_KEY",
      apiKeyConfiguredHint:
        "A chave é armazenada com segurança. Insira uma nova chave apenas para substituí-la.",
      apiKeyRequiredHint:
        "Insira uma chave antes do primeiro salvamento. Ela não será exibida novamente.",
      apiKeyOptionalHint:
        "Insira uma chave se o provedor exigir autenticação. Ela não será exibida após salvar.",
      protocolMode: "Modo de compatibilidade de protocolo",
      protocolModes: {
        native_responses: "Responses nativo",
        responses_tool_compat: "Compatibilidade de ferramentas do Responses",
        chat_completions_bridge: "Ponte para Chat Completions",
      },
      protocolModeHints: {
        native_responses:
          "Indicado para serviços com suporte nativo ao Responses e experiência completa de conversa e ferramentas.",
        responses_tool_compat:
          "Indicado para serviços com suporte ao Responses e um conjunto mais limitado de ferramentas.",
        chat_completions_bridge:
          "Indicado para serviços compatíveis que só oferecem Chat Completions. Alguns recursos avançados podem estar indisponíveis.",
      },
      models: "Modelos",
      modelsDescription:
        "Os modelos aqui compartilham a conexão e a chave deste canal. Modelos de conversa podem aparecer nas opções dos usuários; modelos de busca e outros são usados automaticamente quando necessário.",
      addModel: "Adicionar modelo",
      noModels: "Nenhum modelo neste canal",
      newModelName: "Modelo {{index}}",
      unnamedModel: "Modelo sem nome",
      modelId: "ID do modelo",
      modelIdConflict:
        "Este ID já existe no catálogo de modelos. Use outro ID.",
      modelNameConflict:
        "Já existe um modelo com este nome de exibição. Considere outro nome para diferenciá-los.",
      channelNameConflict:
        "Já existe um canal de modelos com este nome. Considere outro nome para diferenciá-los.",
      displayName: "Nome de exibição",
      modelKind: "Tipo de modelo",
      modelKinds: {
        chat: "Modelo de conversa",
        embedding: "Modelo de embeddings",
        reranker: "Modelo de classificação",
      },
      serviceProvider: "Provedor de modelos",
      supportsImageInput: "Oferece compreensão de imagens",
      inputPrice: "Preço de entrada",
      cachedInputPrice: "Preço de entrada em cache",
      outputPrice: "Preço de saída",
      contextWindow: "Comprimento do contexto do modelo",
      contextWindowPlaceholder: "Detectar automaticamente",
      contextWindowInvalid:
        "Insira um número inteiro maior que 0 ou deixe em branco para detectar automaticamente.",
      priceUnit: "USD / 1 milhão de tokens",
      priceUnitSummary: ". Os preços são exibidos em {{unit}}.",
      showInComposer: "Disponível em conversas",
      saveModel: "Salvar modelo {{name}}",
      deleteModel: "Excluir modelo",
      deleteModelTitle: "Excluir modelo “{{name}}”?",
      deleteModelDescription:
        "O modelo será excluído imediatamente após a confirmação. Tarefas e registros de uso históricos não são afetados.",
      modelDeleted: "Modelo excluído.",
      supportedEfforts: "Esforços de raciocínio compatíveis",
      selectedEfforts: "{{count}} selecionados",
      defaultEffort: "Esforço de raciocínio padrão",
      defaultModel: "Modelo padrão de conversa",
      defaultModelHint:
        "O sistema usa este modelo quando o usuário ainda não escolheu um ou quando o modelo anterior está indisponível.",
      modelSelections: "Seleções de modelos de conversa e do sistema",
      saveModelSelections:
        "Salvar seleções de modelos de conversa e do sistema",
      memoryExtractionModel: "Modelo de extração de memórias",
      memoryUseTaskModel: "Usar o modelo da tarefa atual",
      memoryExtractionHint:
        "Aplica-se quando o usuário ativa a memória. Se nenhum modelo específico for selecionado, a extração usa o modelo da tarefa atual. A extração sempre usa o menor esforço de raciocínio compatível com o modelo selecionado. Isso não altera o modelo de consolidação de memórias.",
      titleModel: "Modelo de nomeação automática de tarefas",
      titleModelHint:
        "Cria automaticamente nomes reconhecíveis para as tarefas. Seu uso é incluído na análise.",
      saved: "Configurações dos canais de modelos atualizadas.",
    },
    knowledgeModels: {
      title: "Modelos de busca de conhecimento",
      description:
        "Escolha os modelos que ajudam as bases de conhecimento a compreender documentos, responder a perguntas e melhorar os resultados de pesquisa.",
      selectionDescription:
        "Escolha os modelos usados para processar documentos e melhorar os resultados de pesquisa. Adicione e gerencie os modelos disponíveis em Canais de modelos.",
      noEmbeddingModels:
        "Nenhum modelo está pronto para busca de conhecimento. Primeiro, adicione e configure um modelo de embeddings em Canais de modelos.",
      embeddingTitle: "Modelo de embeddings",
      embeddingSelectionDescription:
        "Este modelo obrigatório ajuda a base de conhecimento a compreender documentos e perguntas dos usuários. O sistema verifica a disponibilidade ao salvar.",
      selectEmbeddingModel: "Selecionar modelo de embeddings",
      embeddingModelPlaceholder: "Selecione um modelo de embeddings",
      embeddingDescription:
        "Este modelo obrigatório ajuda a base de conhecimento a compreender documentos e perguntas dos usuários.",
      rerankTitle: "Modelo de ordenação",
      rerankSelectionDescription:
        "Coloca os resultados mais relevantes no topo. A pesquisa continua retornando resultados quando este recurso está desativado ou temporariamente indisponível.",
      selectRerankerModel: "Selecionar modelo de classificação",
      rerankerModelPlaceholder: "Selecione um modelo de classificação",
      rerankDescription:
        "Coloca os resultados mais relevantes no topo. A busca de conhecimento continua funcionando quando este recurso está desativado.",
      enabled: "Ativar durante a pesquisa",
      baseUrl: "URL base",
      embeddingBaseUrlHint:
        "Insira o endereço de conexão do modelo de embeddings fornecido pelo provedor.",
      rerankBaseUrlHint:
        "Insira o endereço de conexão do modelo de classificação de resultados fornecido pelo provedor.",
      modelId: "ID do modelo",
      inputPrice: "Preço de entrada",
      priceUnit: "USD / 1 milhão de tokens",
      embeddingApiKey: "Chave de API de embeddings",
      rerankApiKey: "Chave de API de reordenação",
      apiKeyConfiguredHint:
        "Uma chave está configurada. Insira uma nova chave apenas para substituí-la.",
      apiKeyEndpointChangedHint:
        "O endereço de conexão mudou, por isso a chave existente não será reutilizada. Insira a chave correspondente se o novo endereço exigir autenticação.",
      apiKeyOptionalHint:
        "Deixe em branco se o provedor não exigir autenticação. A chave não é exibida após salvar.",
      embeddingRuntime:
        "O sistema processa o conteúdo em {{dimensions}} dimensões, com até {{tokens}} tokens por vez.",
      rerankRuntime:
        "Processa até {{tokens}} tokens por vez. Se o serviço levar mais de {{timeout}} ms, esta otimização será ignorada.",
      rebuildHint:
        "Após alterar o modelo de embeddings, você deve reconstruir completamente todos os índices das bases de conhecimento. A busca fica temporariamente indisponível até concluir a reconstrução em Saúde do sistema.",
      embeddingChangeConfirmTitle:
        "Operação de risco: alterar modelo de embeddings?",
      embeddingChangeConfirmDescription:
        "O modelo de embeddings determina como as bases de conhecimento interpretam e buscam conteúdo. Salvar esta alteração invalida todos os índices existentes. Você deve acessar Saúde do sistema e reconstruir completamente todos os índices; toda a busca nas bases de conhecimento fica indisponível até a conclusão. O sistema não inicia a reconstrução automaticamente.",
      embeddingChangeDangerNotice:
        "Alterar o modelo de embeddings é uma operação de risco. Uma reconstrução parcial das bases de conhecimento não é suficiente.",
      embeddingChangeConfirmAction: "Alterar modelo e salvar",
      rebuildRequiredTitle:
        "Modelo de embeddings alterado; os índices das bases de conhecimento precisam ser reconstruídos",
      rebuildRequiredDescription:
        "Acesse Saúde do sistema e reconstrua todos os índices das bases de conhecimento. A busca fica temporariamente indisponível até a conclusão.",
      openSystemHealth: "Ir para Saúde do sistema",
      validating: "Verificando e salvando…",
      save: "Salvar modelos de busca de conhecimento",
      saved: "Configurações dos modelos de busca de conhecimento atualizadas.",
      savedDescription:
        "Novos processamentos de documentos e buscas semânticas usarão esta configuração.",
      savedAfterEmbeddingChangeDescription:
        "A configuração do modelo foi salva. Acesse Saúde do sistema e reconstrua todos os índices das bases de conhecimento; a busca fica temporariamente indisponível até a conclusão.",
    },
    voiceTranscription: {
      title: "Modelo de transcrição de voz",
      description:
        "Configure o serviço de modelos usado para transcrever a entrada por voz. Após ativado, tarefas comuns e aplicativos incorporados usam estas configurações. A chave é armazenada com segurança e nunca é exibida novamente.",
      enabled: "Ativar transcrição de voz",
      provider: "Provedor de modelos",
      providerHint:
        "Escolha o serviço de transcrição de voz que você ativou e deseja usar.",
      providerPlaceholder: "Selecione um provedor de modelos",
      providers: {
        dashscope: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        openai_compatible: "Serviço compatível com OpenAI",
        azure_openai: "Azure OpenAI",
        groq: "Groq",
        deepgram: "Deepgram",
        assemblyai: "AssemblyAI",
        elevenlabs: "ElevenLabs",
        revai: "Rev.ai",
        gladia: "Gladia",
        fal: "fal.ai",
      },
      baseUrl: "URL base",
      baseUrlHint:
        "Insira o endereço de conexão da transcrição de voz fornecido pelo provedor.",
      apiVersion: "Versão da API",
      apiVersionHint:
        "Insira a versão da API usada pela sua implantação do Azure OpenAI.",
      apiKey: "Chave de API",
      apiKeyConfiguredHint:
        "Uma chave está configurada. Deixe em branco para manter a chave existente.",
      apiKeyRequiredHint:
        "Uma chave é obrigatória ao ativar pela primeira vez ou após trocar de provedor. Ela nunca é exibida novamente.",
      model: "Nome do modelo de transcrição de voz",
      modelHint:
        "Insira o nome do modelo ou da implantação fornecido pelo provedor.",
      save: "Salvar modelo de transcrição de voz",
      saving: "Salvando…",
      saved: "Configurações do modelo de transcrição de voz atualizadas.",
    },
    imageGeneration: {
      title: "Modelo de geração de imagens",
      description:
        "Configure o serviço de modelos usado para gerar imagens. Após ativado, o sistema usa estas configurações para criar imagens. A chave é armazenada com segurança e nunca é exibida novamente.",
      enabled: "Ativar geração de imagens",
      provider: "Provedor de modelos",
      providerHint:
        "Escolha o serviço de geração de imagens que você ativou e deseja usar.",
      providerPlaceholder: "Selecione um provedor de modelos",
      providers: {
        alibaba_bailian: "Alibaba Cloud Bailian",
        openai: "OpenAI",
        google_gemini: "Google Gemini",
        stability: "Stability AI",
        fal: "fal.ai",
        replicate: "Replicate",
        together: "Together AI",
      },
      baseUrl: "URL base",
      baseUrlHint:
        "Preenchido automaticamente para o provedor selecionado. Não é necessário editar manualmente.",
      workspaceId: "ID do espaço de trabalho Bailian",
      workspaceIdHint:
        "Conecta ao seu espaço de trabalho dedicado no Alibaba Cloud Bailian.",
      region: "Região do Bailian",
      regionHint:
        "Escolha a região onde o serviço está ativo. Pequim é usada por padrão.",
      apiKey: "Chave de API",
      apiKeyConfiguredHint:
        "Uma chave está configurada. Deixe em branco para manter a chave existente.",
      apiKeyRequiredHint:
        "Uma chave é obrigatória ao ativar pela primeira vez ou após trocar de provedor. Ela nunca é exibida novamente.",
      model: "Nome do modelo de geração de imagens",
      modelHint:
        "Insira o nome do modelo fornecido pelo provedor, como qwen-image-3.0.",
      pricePerImage: "Preço por imagem",
      pricePerImageHint:
        "Usado para acompanhar os custos de geração de imagens. Unidade: USD por imagem.",
      save: "Salvar modelo de geração de imagens",
      saving: "Salvando…",
      saved: "Configurações do modelo de geração de imagens atualizadas.",
    },
    imageUnderstanding: {
      title: "Compreensão de imagens em documentos",
      description:
        "Quando ativado, o sistema compreende imagens nos documentos e usa essas informações na busca de conhecimento. O conteúdo original do documento não é alterado.",
      selectionDescription:
        "Quando ativado, o sistema compreende as imagens dos documentos para que os usuários encontrem as informações nelas exibidas. Escolha um modelo de conversa que ofereça compreensão de imagens.",
      noImageModels:
        "Nenhum modelo com suporte a imagens disponível. Primeiro, ative Oferece compreensão de imagens em um modelo de conversa em Canais de modelos.",
      selectModel: "Selecionar modelo de compreensão de imagens",
      selectModelHint:
        "O sistema verifica se o modelo selecionado reconhece imagens ao salvar.",
      modelPlaceholder: "Selecione um modelo de compreensão de imagens",
      enabled: "Ativar durante o processamento",
      provider: "Provedor de modelos",
      providerPlaceholder: "Selecione um provedor de modelos",
      providers: {
        openai: "OpenAI",
        azure_openai: "Azure OpenAI",
        anthropic: "Anthropic",
        google: "Google Gemini",
        google_vertex: "Google Vertex AI",
        alibaba: "Alibaba / Qwen",
        deepseek: "DeepSeek",
        openrouter: "OpenRouter",
        openai_compatible: "Compatível com OpenAI / vLLM",
      },
      model: "ID do modelo multimodal",
      modelHint:
        "Escolha um modelo com suporte confirmado à compreensão de imagens. O sistema verifica a disponibilidade ao salvar.",
      baseUrl: "URL base",
      baseUrlRequiredHint:
        "Insira o endereço completo de conexão fornecido pelo provedor.",
      baseUrlOptionalHint:
        "Deixe em branco para usar o endereço padrão do provedor.",
      apiKey: "Chave de API",
      apiKeyConfiguredHint:
        "Uma chave está configurada. Deixe em branco para manter a chave existente.",
      apiKeyRequiredHint:
        "Uma chave é obrigatória ao ativar pela primeira vez e nunca é exibida novamente.",
      project: "ID do projeto Vertex",
      location: "Localização do Vertex",
      activeStrategy:
        "O modelo atual passou na verificação de compreensão de imagens.",
      strategyAfterValidation:
        "O sistema verifica a capacidade de compreensão de imagens do modelo selecionado após salvar.",
      validating: "Verificando e salvando…",
      save: "Salvar configurações de compreensão de imagens",
      saved:
        "Configurações de compreensão de imagens atualizadas. Novos processamentos e reconstruções usarão esta configuração.",
    },
    authSettings: {
      enterpriseTitle: "Contas corporativas",
      enterpriseDescription:
        "Permita o acesso com contas gerenciadas pela organização ou diretamente no Teams. O primeiro acesso identifica contas existentes pelo e-mail; novas contas precisam ser ativadas por um administrador.",
      smtpTitle: "E-mail de autenticação",
      smtpDescription:
        "Configure o serviço SMTP usado para e-mails de definição inicial e redefinição de senha. As verificações de conexão continuam em Saúde do sistema.",
      oidcTitle: "SSO corporativo (OIDC)",
      oidcDescription:
        "Conecte o serviço de acesso da organização, como o Microsoft Entra ID para contas de trabalho ou escola.",
      teamsTitle: "Acesso dentro do Teams",
      teamsDescription:
        "Permita o acesso diretamente no Teams com contas de trabalho ou escola.",
      modeLabel: "Origem da configuração",
      modes: {
        inherit: "Herdar do ambiente de implantação",
        managed: "Gerenciar nas configurações do sistema",
        disabled: "Desativar este recurso",
      },
      modeNotices: {
        inherit:
          "O ambiente de implantação está em uso atualmente. Insira o segredo novamente ao mudar para o gerenciamento pelo sistema.",
        disabled:
          "Este recurso está explicitamente desativado e não usa a configuração da implantação como alternativa.",
      },
      status: {
        configured: "Configurado",
        notConfigured: "Não configurado",
        invalid: "Configuração inválida",
      },
      smtpHost: "Host SMTP",
      smtpPort: "Porta SMTP",
      smtpSecurity: "Segurança da conexão",
      starttls: "STARTTLS",
      tls: "TLS direto",
      smtpFrom: "Endereço do remetente",
      smtpUsername: "Nome de usuário",
      smtpUsernameHint:
        "Deixe em branco quando o serviço SMTP não exigir autenticação.",
      smtpPassword: "Senha",
      oidcIssuer: "URL do emissor",
      oidcClientId: "ID do cliente",
      oidcClientSecret: "Segredo do cliente",
      oidcRedirectUri: "URI de redirecionamento",
      oidcRedirectHint:
        "Registre esta URI fixa no provedor OIDC. Ela não pode ser alterada aqui.",
      teamsTenantId: "ID do locatário",
      teamsClientId: "ID do aplicativo (cliente)",
      teamsExternalHint:
        "Use o mesmo ID de aplicativo no Microsoft Entra e no manifesto do aplicativo Teams, exponha a API e conclua os consentimentos necessários.",
      secretPreserved:
        "Um segredo está armazenado. Deixe em branco para mantê-lo.",
      secretRequired:
        "Insira o segredo novamente ao mudar para o gerenciamento pelo sistema.",
      secretRequiredWhenUsed:
        "Uma senha é obrigatória quando há um nome de usuário definido.",
      saved:
        "Configurações de autenticação atualizadas e aplicadas imediatamente.",
      confirmTitle: "Alterar a origem da configuração?",
      confirmDescription:
        "Continuar interrompe o uso da configuração atual. Desativar um método de acesso pode bloquear usuários que dependem dele.",
    },
    editUser: "Editar usuário",
    userSaved: "Usuário salvo.",
    enableUserNamed: "Ativar usuário {{name}}",
    disableUserNamed: "Desativar usuário {{name}}",
    userEnabled: "Usuário {{name}} ativado.",
    userDisabled: "Usuário {{name}} desativado.",
    userStatusSelfLocked:
      "Administradores não podem ativar nem desativar a própria conta.",
    lastEnabledAdminStatusLocked:
      "Deve permanecer pelo menos um administrador ativado.",
    userStatusVerifyingAdmins:
      "Verificando a quantidade de administradores ativados. Aguarde.",
    emailUpdated: "E-mail atualizado. O usuário deve entrar novamente.",
    accountMetadata: "Metadados da conta e dos recursos",
    passwordUpdated: "Senha atualizada",
    personalPlugins: "Plugins pessoais",
    personalSkills: "Habilidades pessoais",
    personalCredentials: "Credenciais pessoais",
    noPasswordNotice:
      "Administradores não podem definir, visualizar, importar nem redefinir senhas de usuários. Novos usuários podem entrar por SSO, Teams ou pelo fluxo de recuperação de senha.",
    userPrivilegeChangeWarning:
      "Esta ação revoga imediatamente as sessões do usuário. Desativar o usuário também cancela solicitações pendentes que ainda não começaram. Você não pode desativar nem rebaixar a própria conta, e deve permanecer pelo menos um administrador ativado.",
    userSearchPlaceholder: "Pesquisar nome ou e-mail…",
    downloadTemplate: "Baixar modelo Excel",
    chooseExcel: "Escolher arquivo Excel",
    templateFilename: "{{productPrefix}}-modelo-importacao-usuarios.xlsx",
    importDescription:
      "Use o modelo Excel para nome, e-mail, função e grupos de usuários. A planilha Instruções inclui dados de exemplo. O modelo não tem campo de senha e linhas inválidas são informadas separadamente.",
    importSubmit: "Iniciar importação",
    importResult: "Resultado da importação",
    importCounts: "{{imported}} importados e {{skipped}} ignorados.",
    importErrorRow: "Linha {{row}}: {{message}}",
    editGroup: "Editar grupo de usuários",
    deleteGroupTitle: "Excluir este grupo de usuários permanentemente?",
    importErrors: {
      duplicateInFile:
        "A pasta de trabalho do Excel contém um endereço de e-mail duplicado.",
      emailExists: "O e-mail já é usado por um usuário existente.",
      groupNotFound: "O grupo de usuários especificado não existe.",
      invalidEmail: "O formato do e-mail é inválido.",
      invalidRole: "A função deve ser user ou admin.",
      invalidName: "O nome está ausente ou é inválido.",
      invalidRow: "O valor de um campo é inválido.",
    },
    parentDeleteDescription:
      "As participações relacionadas e as permissões de bases de conhecimento serão excluídas permanentemente. Esta ação não pode ser desfeita.",
    auditSearchPlaceholder:
      "Pesquisar ID da tarefa, usuário, plugin/habilidade ou código de erro…",
    dateFrom: "Data inicial",
    dateTo: "Data final",
    auditDataSurfaces: "Escopo dos dados de auditoria",
    auditSurfaces: {
      events: "Log de auditoria permanente",
      conversations: "Metadados de execução de tarefas",
      retainedArtifacts: "Arquivos gerados por tarefas excluídas",
    },
    auditConversationDescription:
      "Exibe resumos de execução de diferentes usuários com dados sensíveis ocultados, sem títulos, mensagens, conteúdo de arquivos, eventos completos ou links de download.",
    auditConversationSearchPlaceholder:
      "Pesquisar ID da tarefa, usuário, plugin/habilidade ou código de erro…",
    advancedFilters: "Mais filtros",
    pluginName: "Nome do plugin",
    skillName: "Nome da habilidade",
    errorCode: "Código de erro",
    runnerStatus: "Status do executor",
    archiveStatus: "Status de arquivamento",
    createdFrom: "Criado a partir de",
    createdTo: "Criado até",
    lastRunFrom: "Última execução a partir de",
    lastRunTo: "Última execução até",
    auditConversationsEmpty:
      "Nenhum metadado de execução de tarefa correspondente.",
    retainedArtifactsDescription:
      "Exibe apenas resumos com dados sensíveis ocultados dos arquivos mantidos permanentemente de tarefas excluídas. Visualização do conteúdo, recuperação e downloads estão indisponíveis.",
    retainedArtifactsSearchPlaceholder:
      "Pesquisar ID da tarefa, ID do proprietário ou data de exclusão…",
    retainedArtifactsEmpty:
      "Nenhum resumo de arquivo de tarefa excluída correspondente.",
    conversation: "ID da tarefa",
    owner: "Proprietário",
    capabilitiesUsed: "Plugins/habilidades usados",
    files: "Metadados de arquivos",
    execution: "Resumo da execução",
    lastRun: "Última execução",
    activeConversation: "Não arquivado",
    archivedConversation: "Arquivado",
    attachmentsSummary: "{{count}} anexos · {{size}}",
    artifactsSummary: "{{count}} arquivos gerados · {{size}}",
    runnerStatuses: {
      initialized: "Executor inicializado",
      not_started: "Executor não iniciado",
      available: "Executor disponível",
      unavailable: "Executor indisponível",
    },
    executionError: "Erro de execução",
    errorTypes: {
      codex_turn: "Erro de execução da tarefa",
    },
    retainedArtifactCount: "Arquivos gerados mantidos",
    totalSize: "Tamanho total",
    checksum: "Somas de verificação presentes",
    deletedAt: "Tarefa excluída",
    editableSettings: "Configurações editáveis do produto",
    deploymentReadOnly:
      "Infraestrutura, autenticação, segredos, simultaneidade e limites de arquivos são gerenciados pela implantação. Aqui é exibido apenas o status com dados sensíveis ocultados.",
  },
  health: {
    title: "Saúde do sistema",
    description:
      "Resumo somente leitura dos serviços e diretórios gerenciados do {{productName}}.",
    overall: "Status geral",
    checkedAt: "Verificado em",
    runningTurns: "Turnos em execução",
    processes: "Processos app-server",
    concurrency: "Limite de simultaneidade",
    healthy: "Saudável",
    warning: "Aviso",
    unavailable: "Indisponível",
    notConfigured: "Não configurado",
    notObserved: "Não observado",
    degraded: "Degradado",
    available: "Disponível",
    cleanupFailures: "Falhas de limpeza",
    cleanupDescription:
      "As novas tentativas automáticas foram interrompidas para estes recursos. Tentar novamente trata apenas a tarefa afetada e não interrompe outras tarefas ativas.",
    retryCleanup: "Tentar limpeza novamente",
    retryAllCleanup: "Tentar todos novamente",
    retryingCleanup: "Tentando limpeza novamente",
    cleanupRetryAllConfirmTitle: "Tentar novamente todas as limpezas com falha",
    cleanupRetryAllConfirmDescription:
      "O sistema verificará e tentará novamente cada item. Uma tarefa afetada ainda ativa será adiada, e outras tarefas não serão interrompidas.",
    cleanupAttempts: "{{current}} / {{total}} tentativas realizadas",
    cleanupFailed: "Precisa de atenção",
    cleanupStages: {
      reconcile: "Verificando estado dos recursos",
      stop_runtime: "Interrompendo a tarefa afetada com segurança",
      delete_workspace: "Removendo arquivos da tarefa",
      delete_control: "Removendo estado de execução da tarefa",
      verify_absent: "Verificando limpeza",
    },
    cleanupReasons: {
      CLEANUP_RUNNER_UNAVAILABLE:
        "O serviço de limpeza está temporariamente indisponível",
      CLEANUP_RUNTIME_ACTIVE:
        "A tarefa afetada ainda está ativa e seus recursos foram protegidos",
      CLEANUP_RUNTIME_STATE_UNCERTAIN:
        "Ainda não foi possível confirmar que a tarefa foi interrompida com segurança",
      CLEANUP_PERMISSION_DENIED:
        "Não foi possível remover o recurso; verifique as permissões de armazenamento",
      CLEANUP_PATH_BOUNDARY_INVALID:
        "Não foi possível validar a localização do recurso",
      CLEANUP_DIRECTORY_REMOVE_FAILED:
        "Não foi possível remover completamente os arquivos da tarefa",
      CLEANUP_VERIFICATION_FAILED:
        "Não foi possível verificar o resultado da limpeza",
      CLEANUP_QUEUE_UNAVAILABLE:
        "Não foi possível colocar a solicitação de limpeza na fila",
      CLEANUP_OPERATION_FAILED: "A limpeza dos recursos não foi concluída",
      unknown: "A limpeza dos recursos não foi concluída",
    },
    resources: {
      title: "Uso de recursos dos serviços",
      description:
        "Uso em tempo real de CPU, memória e processos dos contêineres de serviços implantados no Docker.",
      empty: "Nenhum uso de recursos de serviços Docker foi observado.",
      cpu: "CPU",
      memory: "Memória",
      containers: "{{running}} / {{total}} contêineres em execução",
      pids: "PIDs {{count}}",
      state: "Estado {{state}}",
      checkedAt: "Recursos medidos em",
      status: {
        available: "Observado",
        unavailable: "Indisponível",
        notObserved: "Não observado",
      },
      reasons: {
        unavailable:
          "Não é possível ler as medições de recursos do Docker. Verifique a montagem do socket Docker e as permissões do controlador do executor.",
        notObserved:
          "Nenhuma medição utilizável de recursos de contêineres Docker foi observada.",
      },
      services: {
        api: "Contêiner da API",
        runner: "Controlador do executor",
        workerPool: "Conjunto de workers do executor",
        web: "Contêiner Web",
        gateway: "Contêiner do gateway",
        postgres: "Contêiner PostgreSQL",
        redis: "Contêiner Redis",
        postgresBackup: "Contêiner de backup do PostgreSQL",
        migrate: "Contêiner de migração",
        backupInit: "Contêiner de inicialização de backup",
        storageInit: "Contêiner de inicialização de armazenamento",
        runnerWorkerImage: "Contêiner de compilação da imagem do worker",
      },
    },
    knowledgeRebuild: {
      title: "Reconstrução completa do índice vetorial de conhecimento",
      description:
        "Manutenção explícita para mudanças no modelo de embeddings ou nas dimensões dos vetores. É exibido apenas o progresso agregado de toda a implantação.",
      action: "Iniciar reconstrução completa",
      retry: "Tentar novamente manualmente",
      empty:
        "Nenhuma reconstrução de conhecimento em toda a implantação foi iniciada.",
      confirmTitle:
        "Confirmar reconstrução completa do índice vetorial de conhecimento",
      confirmDescription:
        "Esta ação sempre abrange todos os documentos não excluídos, incluindo bases de conhecimento arquivadas, e pausa a pesquisa vetorial global durante a execução.",
      confirmWarning:
        "Esta ação limpa e recria o índice vetorial de conhecimento. Não exclui arquivos originais, resultados do Docling nem conteúdo analisado, e o índice anterior não pode ser restaurado.",
      confirmAction: "Confirmar e iniciar reconstrução",
      reason: "Motivo",
      reasonHint:
        "Obrigatório. O motivo é registrado em uma entrada de auditoria com dados sensíveis ocultados.",
      total: "Total",
      succeeded: "Bem-sucedido",
      failed: "Falhou",
      errorSummary: "Código de erro estável: {{code}}",
      status: {
        pending: "Pendente",
        queued: "Na fila",
        running: "Em execução",
        completed: "Concluído",
        failed: "Falhou",
      },
      stage: {
        queued: "Aguardando início",
        preparing: "Preparando a reconstrução completa",
        recreating_index: "Recriando o índice vetorial",
        rebuilding_documents: "Reconstruindo todos os índices de documentos",
        validating: "Validando resultados da reconstrução",
        activating: "Ativando o novo índice",
        completed: "Reconstrução completa concluída",
        failed: "A reconstrução completa falhou",
        processing: "Processando a reconstrução completa",
      },
    },
    components: {
      api: "Serviço da API",
      public_url: "Segurança da conexão",
      database: "Banco de dados",
      redis: "Redis e proteção do acesso local",
      running_turn_capacity: "Capacidade de turnos em execução",
      running_turn_recovery: "Recuperação de turnos em execução",
      smtp: "E-mail de autenticação",
      auth_email: "Recurso de e-mail de senha",
      local_password_login: "Acesso local com senha",
      runner: "Executor",
      workspace: "Raiz do espaço de trabalho",
      capability_root: "Raiz de instalação de plugins/habilidades",
      oidc: "Acesso por OIDC",
      teams: "Acesso pelo Teams",
      workspace_root: "Raiz do espaço de trabalho",
      document_parsing: "Análise de documentos de conhecimento",
      knowledge_search_and_indexing: "Pesquisa e indexação de conhecimento",
      rerank: "Reordenação dos resultados de conhecimento",
    },
    reasons: {
      public_url_insecure:
        "Este site usa HTTP, portanto os dados de acesso, as conversas e os arquivos não são criptografados durante a transmissão. Os recursos principais continuam disponíveis; configure HTTPS antes de expor o site à internet.",
      auth_https_required:
        "Este site usa HTTP. Configure HTTPS para usar o acesso por OIDC ou Teams.",
      not_configured: "Este recurso opcional não está configurado.",
      not_observed:
        "Nenhum ciclo de recuperação compartilhada bem-sucedido foi observado ainda.",
      connection_failed:
        "A verificação de conexão falhou. Verifique a configuração da implantação e o serviço.",
      read_write_failed:
        "A verificação de leitura e gravação no diretório falhou. Verifique as montagens e permissões.",
      login_protection_unavailable:
        "O Redis está indisponível, por isso a proteção do acesso local e o acesso local com senha estão indisponíveis.",
      email_unavailable:
        "Novas solicitações de e-mail para definir a senha pela primeira vez ou redefini-la estão indisponíveis.",
      available: "A verificação foi aprovada.",
      document_parsing_unavailable:
        "A análise de documentos está indisponível. Verifique a configuração e o serviço do Docling Serve.",
      knowledge_search_and_indexing_unavailable:
        "A pesquisa e a indexação de conhecimento estão indisponíveis. Verifique o Elasticsearch, a configuração do modelo de embeddings e seus serviços.",
      embedding_dimension_mismatch:
        "A dimensão de saída dos embeddings não corresponde à dimensão do índice vetorial do Elasticsearch. Corrija a configuração e reconstrua o índice vetorial manualmente.",
      rerank_unavailable:
        "A reordenação de resultados está indisponível. Verifique a configuração e o serviço do modelo de reordenação.",
    },
    cleanupTypes: {
      workspace: "Espaço de trabalho da tarefa",
      codex_home: "Diretório de execução do usuário",
      object_storage: "Recurso de armazenamento de objetos",
      capability_directory: "Diretório de plugins/habilidades",
    },
  },
  statuses: {
    idle: "Ocioso",
    running: "Em execução",
    pending: "Pendente",
    completed: "Concluído",
    failed: "Falhou",
    declined: "Recusado",
    interrupted: "Interrompido",
    active: "Ativo",
    disabled: "Desativado",
    approved: "Aprovado",
    rejected: "Rejeitado",
    pendingApproval: "Aguardando aprovação",
    revoked: "Revogado",
    cancelled: "Cancelado",
    success: "Sucesso",
    failure: "Falha",
  },
  validation: {
    required: "Este campo é obrigatório.",
    email: "Insira um endereço de e-mail válido.",
    passwordMismatch: "As senhas não coincidem.",
    riskRequired: "Revise e confirme primeiro a origem e o aviso de riscos.",
  },
  errors: {
    socialClientInUse:
      "Há contas vinculadas a este aplicativo. Seu ID não pode ser alterado; você pode trocar o segredo ou desativar o acesso.",
    socialLastMethod:
      "Defina uma senha ou vincule outro método de acesso ativado antes de desvincular.",
    socialAuthFailed:
      "Não foi possível concluir a verificação da conta social. Tente novamente.",
    applicationDevelopment: {
      testBusy:
        "Ainda há um teste ativo. Interrompa-o e resolva as solicitações pendentes no Histórico de testes antes de continuar.",
      testChanged:
        "A sessão de teste mudou. Continue pela visualização mais recente.",
      projectNameFixed:
        "Este projeto reúne as tarefas de desenvolvimento de aplicativos. Seu nome não pode ser alterado.",
      workspaceBound:
        "Este projeto contém códigos-fonte de aplicativos. Exclua esses aplicativos em Meus aplicativos antes de excluir o projeto. As tarefas de desenvolvimento devem permanecer no projeto atual.",
      notFound: "Este aplicativo está indisponível. Volte a Meus aplicativos.",
      sourceChanged:
        "O aplicativo mudou. Revise a visualização mais recente antes de instalar.",
    },
    webSites: {
      notFound:
        "Este site está indisponível ou o compartilhamento foi interrompido",
      slugTaken: "Este endereço já está reservado. Escolha outro endereço",
      sourceUnavailable:
        "Selecione um arquivo HTML gerado disponível na tarefa de origem",
      resourcesMissing:
        "Um recurso da página está ausente ({{path}}). Peça ao assistente na tarefa de origem para salvar a página junto com seus recursos antes de publicar",
      bundleInvalid:
        "O pacote da página está incompleto ou contém arquivos não compatíveis. Atualize-o na tarefa de origem e tente novamente",
    },
    feishu: {
      connectionNotFound:
        "A conexão com o Feishu não foi encontrada. Conecte novamente.",
      connectionConflict:
        "A conexão com o Feishu mudou. Atualize e tente novamente.",
      registrationNotFound:
        "O código QR de conexão com o Feishu expirou. Gere um novo.",
      registrationUnavailable:
        "O Feishu não pode criar o bot automaticamente agora. Tente novamente mais tarde.",
      protocolInvalid:
        "O Feishu retornou dados de conexão não reconhecidos. Reconecte ou entre em contato com um administrador.",
      coordinationUnavailable:
        "O estado da conexão com o Feishu está temporariamente indisponível. Tente novamente mais tarde.",
    },
    automationNotFound: "A automação não foi encontrada.",
    automationLimitReached:
      "Você atingiu o limite de automações. Exclua uma automação de que não precisa mais e tente novamente.",
    automationTaskNotPinned:
      "Automações só podem usar tarefas ativas e fixadas da sua conta.",
    automationTaskInUse:
      "Esta tarefa ainda é usada por uma automação. Exclua ou reatribua a automação primeiro.",
    conversationOrderConflict:
      "A lista de tarefas mudou. Atualize-a antes de ordenar novamente.",
    unknown:
      "Não foi possível concluir a operação. Tente novamente mais tarde.",
    networkUnavailable:
      "Não foi possível acessar o serviço. Verifique sua rede e tente novamente.",
    invalidResponse:
      "O serviço retornou dados inválidos. Entre em contato com um administrador.",
    clientUpdateRequired:
      "O sistema foi atualizado. Atualize esta página para continuar.",
    serviceTemporarilyUnavailable:
      "O sistema está temporariamente indisponível. Tente novamente em breve.",
    imageUnderstanding: {
      validationFailed:
        "O modelo de compreensão de imagens falhou na validação de entrada de imagens, saída estruturada ou desativação do raciocínio. Verifique a configuração do modelo e do provedor.",
    },
    imageGeneration: {
      notConfigured:
        "O modelo de geração de imagens não está configurado ou ativado.",
      forbidden: "Esta tarefa não pode chamar a geração de imagens.",
      turnInactive:
        "A execução atual da tarefa terminou e não pode continuar gerando imagens.",
      providerRejected:
        "O provedor de geração de imagens rejeitou a solicitação. Verifique o modelo, a instrução ou a configuração da chave.",
      outputInvalid:
        "O provedor de geração de imagens não retornou uma imagem utilizável. Tente novamente ou verifique a configuração do provedor.",
      unavailable:
        "A geração de imagens está temporariamente indisponível. Tente novamente mais tarde.",
    },
    authInvalidCredentials: "E-mail ou senha inválidos.",
    authRateLimited: "Muitas tentativas de acesso. Tente novamente mais tarde.",
    authProtectionUnavailable:
      "A proteção do acesso está temporariamente indisponível. Tente novamente mais tarde.",
    sessionExpired: "Sua sessão expirou. Entre novamente.",
    passwordPolicy:
      "A senha deve ter de 8 a 16 caracteres e incluir maiúscula, minúscula, número e pontuação ou símbolo.",
    passwordEmailUnavailable:
      "O serviço de e-mail para definição ou redefinição de senha está temporariamente indisponível. Tente novamente mais tarde ou use SSO ou Teams, se configurados.",
    passwordResetDeliveryFailed:
      "Não foi possível enviar o link seguro. Tente novamente mais tarde.",
    passwordResetProtectionUnavailable:
      "A proteção de solicitações de senha está temporariamente indisponível. Tente novamente mais tarde.",
    auth: {
      registrationProtectionUnavailable:
        "A proteção de solicitações de cadastro está temporariamente indisponível. Tente novamente mais tarde.",
    },
    passwordResetInvalid:
      "O link de definição de senha é inválido ou expirou. Solicite um novo.",
    concurrencyLimit:
      "O sistema está no limite de capacidade no momento. Tente novamente mais tarde.",
    pendingLimit:
      "O limite de solicitações pendentes foi atingido. Trate uma solicitação existente primeiro.",
    pendingNotHead: "Somente a primeira solicitação pendente pode continuar.",
    interruptFailed:
      "Não foi possível interromper a execução atual. Tente novamente.",
    conversation: {
      collaborationModeUnavailable:
        "O modo Planejamento não pode ser alterado enquanto a tarefa estiver em execução, tiver solicitações na fila, tiver um objetivo ativo ou estiver vinculada a uma automação.",
      compactionUnavailable:
        "O contexto só pode ser compactado após a tarefa atual parar.",
      userInputRequestUnavailable:
        "Esta pergunta já terminou ou expirou. Atualize a tarefa e tente novamente.",
      planReviewPending:
        "Implemente, revise, pule ou saia do plano atual antes de continuar.",
      planReviewUnavailable:
        "Esta revisão de plano já terminou ou não está mais disponível. Atualize a tarefa e tente novamente.",
      planOutputMissing:
        "O modo Planejamento não produziu um plano para revisão. Inicie a solicitação novamente.",
      steerRequestFailed:
        "Não foi possível orientar a execução atual. Confirme que ela ainda está em andamento e tente novamente.",
      steerRequestUncertain:
        "O resultado da solicitação de orientação está temporariamente incerto. Mantenha o texto atual e tente novamente para verificar o resultado.",
    },
    composer: {
      voiceTranscriptionFailed:
        "A transcrição de voz falhou. Tente novamente ou digite o texto manualmente.",
      voiceTranscriptionRateLimited:
        "A entrada por voz pode ser usada até 20 vezes por minuto. Tente novamente em breve.",
    },
    mcp: {
      insecureHttpAcknowledgementRequired:
        "Você deve reconhecer o risco da transmissão sem criptografia antes de usar um servidor MCP HTTP.",
      credentialRequired:
        "Uma credencial é obrigatória para este método de autenticação.",
      destinationForbidden:
        "Este destino MCP não pode ser acessado. Implantações na nuvem permitem apenas endereços HTTP ou HTTPS públicos.",
      connectionFailed:
        "Não foi possível conectar e inicializar o servidor MCP. Verifique sua URL, credencial e disponibilidade.",
    },
    clawhub: {
      skillNotFound:
        "A habilidade não foi encontrada no repositório de habilidades.",
      skillNotInstallable:
        "Esta habilidade não pode ser instalada no momento. Verifique sua disponibilidade e seu status de segurança.",
      skillAlreadyInstalled: "Você já instalou esta habilidade.",
      serviceUnavailable:
        "Não foi possível obter a habilidade do ClawHub. Tente novamente mais tarde.",
      installPreviewBusy:
        "Outra prévia de instalação de habilidade está sendo preparada. Aguarde a conclusão e tente novamente.",
      installPreviewRateLimited:
        "Muitas prévias de instalação foram solicitadas. Tente novamente mais tarde.",
      installPreviewQuotaExceeded:
        "O limite de prévias de instalação de habilidades ativas foi atingido. Tente novamente mais tarde.",
      packageIntegrityFailed:
        "A verificação de integridade dos arquivos da habilidade do ClawHub falhou. A instalação foi bloqueada.",
    },
    feedback: {
      submissionInvalid:
        "O texto ou as imagens do feedback não atendem aos requisitos. Verifique e tente novamente.",
      submissionFailed:
        "Não foi possível enviar o feedback agora. Tente novamente mais tarde.",
    },
    knowledge: {
      archiveRequired:
        "Somente bases de conhecimento arquivadas podem ser excluídas.",
      inUse:
        "Esta base de conhecimento ainda é usada por aplicativos. Remova-a desses aplicativos primeiro.",
      archived:
        "Esta base de conhecimento está arquivada. Restaure-a antes de realizar esta ação.",
      disabled: "Esta base de conhecimento está desativada.",
      quotaExceeded:
        "Esta base de conhecimento não tem armazenamento suficiente para o arquivo.",
      duplicate:
        "Já existe um documento com conteúdo idêntico nesta base de conhecimento.",
      nameConflict:
        "Já existe um documento com o mesmo nome nesta base de conhecimento.",
      actionConflict:
        "O estado atual do documento não permite esta ação. Atualize e tente novamente.",
      activating: "O novo índice está sendo ativado. Tente novamente em breve.",
      unsupportedFormat: "Este formato de documento não é compatível.",
      fileTooLarge: "O documento excede o limite de tamanho por arquivo.",
      processingFailed:
        "O processamento do documento falhou. Tente novamente ou reprocesse-o.",
      previewUnavailable:
        "A visualização do original está indisponível no momento. Tente novamente mais tarde.",
      embeddingConfiguration:
        "A configuração do modelo de embeddings é inválida. Entre em contato com um administrador.",
    },
    knowledgeModel: {
      validationFailed:
        "O modelo de embeddings ou reordenação de conhecimento falhou na validação. Verifique o endpoint, a chave, o ID do modelo e as dimensões dos vetores.",
      authenticationFailed:
        "O serviço de modelos não aceitou a chave de API atual. Se você alterou a URL base, insira uma chave válida para o novo endpoint.",
      serviceUnavailable:
        "O serviço de modelos rejeitou a solicitação de validação ou está indisponível. Verifique a URL base, o ID do modelo, a rede e o status do serviço.",
      responseInvalid:
        "A resposta do modelo é incompatível. Verifique a compatibilidade da API, o ID do modelo e as dimensões dos vetores de embeddings.",
      notConfigured:
        "Um administrador ainda não configurou o modelo de embeddings de conhecimento.",
    },
    knowledgeSource: {
      notConfigured:
        "A fonte de conhecimento SharePoint não foi configurada por um administrador.",
      credentialValidationFailed:
        "A autenticação do aplicativo SharePoint falhou. Verifique o locatário, o ID do aplicativo e o segredo.",
      urlInvalid:
        "A URL da pasta SharePoint é inválida ou não pertence ao domínio do locatário configurado.",
      folderNotFound:
        "Não foi possível acessar a pasta do SharePoint. Verifique a URL e a atribuição de permissões do site.",
      alreadyConnected:
        "Esta pasta do SharePoint já está conectada a outra base de conhecimento.",
      notFound: "A fonte da base de conhecimento não foi encontrada.",
      syncUnavailable:
        "A sincronização do SharePoint está temporariamente indisponível e será tentada novamente conforme o agendamento.",
      itemSyncFailed:
        "Alguns documentos do SharePoint falharam na sincronização e serão tentados novamente conforme o agendamento.",
    },
    application: {
      deleted: "Este aplicativo foi excluído",
      notFound: "O aplicativo não existe ou você não pode acessá-lo.",
      disabled:
        "O aplicativo está desativado e não pode iniciar novas tarefas.",
      dependencyUnavailable:
        "O modelo, plugin/habilidade ou base de conhecimento do aplicativo está indisponível.",
      grantTargetInvalid:
        "Aplicativos só podem ser compartilhados com usuários ou grupos válidos da organização.",
      grantConflict: "Este usuário ou grupo já tem acesso ao aplicativo.",
      packageInvalid:
        "O pacote do aplicativo interativo é inválido. Verifique manifest.json, index.html e a estrutura dos arquivos.",
      runtimeBusy:
        "Este aplicativo tem tarefas comuns em andamento e não pode ser salvo nem atualizado. Interrompa-as ou aguarde a conclusão e tente novamente.",
      centerUnavailable:
        "Este aplicativo foi removido da Central de aplicativos.",
      customEventInvalid:
        "O nome ou os dados do evento personalizado não correspondem ao contrato do aplicativo.",
    },
    credentialConflict:
      "Os vínculos de credenciais estão em conflito. Selecione uma credencial explicitamente antes de continuar.",
    credentialRequired:
      "Uma credencial obrigatória está ausente. Vincule uma credencial antes de continuar.",
    avatarInvalid:
      "O envio do avatar falhou. Escolha uma imagem compatível e tente novamente.",
    applicationIconInvalid:
      "O envio do ícone do aplicativo falhou. Escolha uma imagem compatível e tente novamente.",
    capabilityLogoInvalid:
      "O envio do logotipo falhou. Escolha uma imagem compatível e tente novamente.",
    productLogoInvalid:
      "O envio do logotipo do sistema falhou. Escolha uma imagem compatível e tente novamente.",
    invalidPackage:
      "O pacote de plugin/habilidade é inválido ou não contém os arquivos obrigatórios.",
    withReason: "{{message}} Motivo: {{reason}}",
    importReasons: {
      archive_size_invalid:
        "O arquivo compactado está vazio ou excede o limite de tamanho.",
      archive_unreadable:
        "Não foi possível ler o arquivo compactado. Verifique se é um arquivo ZIP válido.",
      archive_entry_count_invalid:
        "O arquivo compactado está vazio ou contém arquivos demais.",
      archive_path_invalid:
        "O arquivo compactado contém um caminho inseguro ou inválido: {{path}}.",
      archive_entry_symlink:
        "O arquivo compactado contém um link simbólico que não pode ser importado: {{path}}.",
      archive_entry_too_large:
        "Um arquivo dentro do pacote é grande demais: {{path}}.",
      archive_compression_ratio_exceeded:
        "Um arquivo dentro do pacote tem uma taxa de compressão anormal e pode ser inseguro: {{path}}.",
      archive_expanded_size_exceeded:
        "O arquivo compactado excede o limite total de tamanho após a extração.",
      archive_entry_read_failed:
        "Não foi possível ler um arquivo dentro do pacote: {{path}}.",
      package_manifest_count_invalid:
        "O pacote deve conter exatamente um arquivo de entrada obrigatório: SKILL.md ou plugin.json.",
      package_multiple_roots:
        "O arquivo compactado deve conter um único diretório raiz, mas foram encontradas várias raízes.",
      package_json_invalid: "O manifesto do plugin é inválido.",
      plugin_mcp_configuration_invalid:
        "A configuração MCP do plugin é inválida.",
      skill_frontmatter_missing:
        "O SKILL.md não contém o cabeçalho de metadados ou o campo obrigatório name.",
      skill_display_name_invalid:
        "O nome de exibição da habilidade é inválido. Use uma única linha com até 64 caracteres.",
      skill_name_invalid:
        "O nome de habilidade {{value}} é inválido. Use apenas letras minúsculas, números e hífens, com no máximo 64 caracteres.",
      plugin_unsupported_component:
        "O plugin contém um tipo de componente ainda não compatível.",
      plugin_skills_invalid:
        "Uma habilidade declarada pelo plugin é inválida ou não contém o SKILL.md.",
      plugin_declared_path_invalid:
        "O plugin declara um caminho de arquivo inválido: {{path}}.",
      logo_file_invalid:
        "O arquivo de logotipo é inválido ou excede o limite de tamanho.",
      requested_type_mismatch:
        "O tipo selecionado é {{expected}}, mas o arquivo compactado contém {{actual}}.",
    },
    importFailed:
      "A importação do plugin/habilidade falhou. Verifique a origem e tente novamente.",
    capabilityUpdateConflict:
      "Esta habilidade mudou. Reabra a janela de atualização e revise o conteúdo mais recente antes de enviar.",
    capabilityUpdateUnchanged:
      "O conteúdo é idêntico ao da habilidade atual. Nenhuma atualização é necessária.",
    capabilityHomeSyncFailed:
      "O estado do plugin/habilidade foi salvo, mas não foi possível sincronizar o diretório do usuário. O sistema tentará novamente antes do próximo turno da tarefa.",
    attachmentInvalid:
      "O envio do anexo falhou. Escolha um arquivo legível e tente novamente.",
    attachmentTemporaryFileSkipped:
      "Arquivos temporários foram ignorados. Escolha outro arquivo com conteúdo relevante.",
    fileLimitExceeded:
      "O tamanho do arquivo ou a quantidade de anexos excede o limite permitido.",
    artifactNotFound: "O arquivo gerado não foi encontrado.",
    downloadForbidden:
      "Você não tem permissão para baixar este arquivo gerado.",
    runnerUnavailable:
      "O serviço de execução está indisponível. Tente novamente mais tarde.",
    turnStartClosed:
      "O envio anterior foi encerrado. Esta solicitação não foi executada. Envie-a novamente.",
    deploymentStopped:
      "Esta tarefa foi interrompida para uma atualização do sistema. O conteúdo existente foi mantido. Revise o progresso antes de continuar manualmente.",
    creditLimitExceeded:
      "Sua cota de créditos disponível foi esgotada e você não pode iniciar uma nova tarefa agora.",
    lastAdminRequired:
      "Deve permanecer pelo menos um administrador ativado. Esta operação não pode ser concluída.",
    lastModelRequired:
      "Deve permanecer pelo menos um modelo de conversa disponível nas conversas.",
    modelProvider: {
      inUseBySystemSetting:
        "Este modelo é usado por uma configuração do sistema. Altere ou limpe essa seleção antes de excluí-lo.",
      managementDisabled:
        "A configuração de modelos está bloqueada pelo ambiente de implantação e é somente leitura.",
    },
    adminSelfChangeForbidden:
      "Administradores não podem desativar nem rebaixar a própria conta.",
    emailExists: "Este endereço de e-mail já é usado por outro usuário.",
    settingsInvalid:
      "A configuração do sistema é inválida ou não pode ser alterada aqui.",
    deploymentReadOnly:
      "Esta configuração é gerenciada pela implantação e é somente leitura.",
    systemAlreadyInitialized: "O sistema já foi inicializado.",
    systemInitializationCredentialInvalid:
      "A credencial de inicialização é inválida. Use a credencial de uso único exibida após a instalação.",
    teamsFailed:
      "O acesso pelo Teams falhou. Tente novamente ou use outro método de acesso.",
    codexTurnFailed:
      "Esta execução falhou. Você pode ajustar a entrada e tentar novamente.",
    turnCompletedWithoutOutput:
      "Esta execução terminou sem produzir um resultado exibível. Execute novamente.",
    automation: {
      emptyResult:
        "A automação terminou sem produzir um resultado exibível. Execute novamente.",
      expired: "Esta automação expirou e não pode mais ser executada.",
    },
    userDisabled:
      "Este usuário está desativado. Entre em contato com um administrador.",
    conflict:
      "O estado atual conflita com esta ação. Atualize e tente novamente.",
    forbidden: "Você não tem permissão para realizar esta ação.",
    notFound:
      "O recurso solicitado não existe ou não está disponível para você.",
    validation: "Os dados enviados são inválidos. Verifique e tente novamente.",
  },
  loginMethods: {
    saml: "SAML 2.0",
    google: "Google",
    apple: "Apple",
    microsoft: "Microsoft",
    facebook: "Facebook",
    github: "GitHub",
    password: "Senha local",
    oidc: "Autenticação única",
    teams: "SSO do Teams",
  },
} satisfies TranslationResource<typeof enUS>
