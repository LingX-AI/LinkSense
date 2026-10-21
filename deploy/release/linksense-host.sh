# Shared by the installer and management CLI; release bundles inline this file.
host_discover_docker_tools() {
  [ "${HOST_OS:-$(uname -s)}" = Darwin ] || return 0
  for host_bin in "${HOME:-}/.docker/bin" /Applications/Docker.app/Contents/Resources/bin "${HOME:-}/Applications/Docker.app/Contents/Resources/bin" /usr/local/bin; do
    [ -d "$host_bin" ] || continue
    case ":$PATH:" in *":$host_bin:"*) ;; *) PATH=$PATH:$host_bin ;; esac
  done
  export PATH
}
host_discover_docker_tools
SYSTEM_DOCKER_CLI=$(command -v docker || true)
DOCKER_CLI=$SYSTEM_DOCKER_CLI
COMPOSE_CLI=

activate_release_services() {
  compose up -d --remove-orphans || return
  # Existing gateways retain startup DNS and rendered templates after Web replacement.
  compose up -d --no-deps --force-recreate gateway
}

host_text() {
  host_key=$1
  shift
  case "${LINKSENSE_CLI_LANGUAGE:-${LC_ALL:-${LC_MESSAGES:-${LANG:-zh-CN}}}}" in
    en*|EN*) host_locale=en-US ;; es*|ES*) host_locale=es-ES ;;
    pt*|PT*) host_locale=pt-BR ;; fr*|FR*) host_locale=fr-FR ;;
    ja*|JA*) host_locale=ja-JP ;; *) host_locale=zh-CN ;;
  esac
  case "$host_key:$host_locale" in
    required_command:zh-CN) host_message='缺少必需的宿主命令：%s。请通过系统包管理器安装后重试；Linux 的 cmp 由 diffutils 提供。' ;;
    required_command:en-US) host_message='Required host command is unavailable: %s. Install it with the system package manager and retry; Linux provides cmp in diffutils.' ;;
    required_command:es-ES) host_message='Falta un comando necesario del sistema anfitrión: %s. Instálelo con el gestor de paquetes y vuelva a intentarlo; en Linux, cmp pertenece a diffutils.' ;;
    required_command:pt-BR) host_message='Um comando obrigatório do sistema hospedeiro está indisponível: %s. Instale-o com o gerenciador de pacotes e tente novamente; no Linux, cmp faz parte do diffutils.' ;;
    required_command:fr-FR) host_message='Une commande requise du système hôte est indisponible : %s. Installez-la avec le gestionnaire de paquets puis réessayez ; sous Linux, cmp est fourni par diffutils.' ;;
    required_command:ja-JP) host_message='ホストに必要なコマンドがありません：%s。システムのパッケージマネージャーでインストールして再試行してください。Linux の cmp は diffutils に含まれています。' ;;
    credential:zh-CN) host_message='Docker 凭证助手不可用：%s。macOS 请启动 Docker Desktop，并执行 export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH" 后重试。保留 Docker 登录配置。' ;;
    credential:en-US) host_message='Docker credential helper is unavailable: %s. On macOS, start Docker Desktop and run export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH", then retry. Keep the Docker login configuration.' ;;
    credential:es-ES) host_message='El asistente de credenciales de Docker no está disponible: %s. En macOS, inicie Docker Desktop y ejecute export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH"; vuelva a intentarlo. Conserve la configuración de acceso de Docker.' ;;
    credential:pt-BR) host_message='O auxiliar de credenciais do Docker está indisponível: %s. No macOS, inicie o Docker Desktop e execute export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH"; tente novamente. Preserve a configuração de login do Docker.' ;;
    credential:fr-FR) host_message='L’assistant d’identification Docker est indisponible : %s. Sur macOS, démarrez Docker Desktop et exécutez export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH", puis réessayez. Conservez la configuration de connexion Docker.' ;;
    credential:ja-JP) host_message='Docker 認証ヘルパーを利用できません：%s。macOS では Docker Desktop を起動し、export PATH="/Applications/Docker.app/Contents/Resources/bin:$HOME/.docker/bin:$PATH" を実行して再試行してください。Docker のログイン設定は保持してください。' ;;
    network_pass:zh-CN) host_message='PASS %s：检查通过。' ;;
    network_pass:en-US) host_message='PASS %s: check passed.' ;;
    network_pass:es-ES) host_message='PASS %s: comprobación correcta.' ;;
    network_pass:pt-BR) host_message='PASS %s: verificação concluída.' ;;
    network_pass:fr-FR) host_message='PASS %s : vérification réussie.' ;;
    network_pass:ja-JP) host_message='PASS %s：チェック成功。' ;;
    network_fail:zh-CN) host_message='FAIL %s：检查失败，其他项目继续检查。' ;;
    network_fail:en-US) host_message='FAIL %s: check failed; remaining checks continue.' ;;
    network_fail:es-ES) host_message='FAIL %s: falló la comprobación; las demás continúan.' ;;
    network_fail:pt-BR) host_message='FAIL %s: a verificação falhou; as demais continuam.' ;;
    network_fail:fr-FR) host_message='FAIL %s : échec ; les autres vérifications continuent.' ;;
    network_fail:ja-JP) host_message='FAIL %s：チェック失敗。他の項目の確認は続行します。' ;;
    docker_engine_help:zh-CN) host_message='Docker CLI 或引擎不可用。macOS 请安装并启动 Docker Desktop；Linux 请检查 Docker Engine 服务和当前账号的访问权限。确认 docker info 成功后重试。' ;;
    docker_engine_help:en-US) host_message='Docker CLI or Engine is unavailable. On macOS, install and start Docker Desktop. On Linux, check the Docker Engine service and current account permissions. Retry after docker info succeeds.' ;;
    docker_engine_help:es-ES) host_message='Docker CLI o Engine no está disponible. En macOS, instale e inicie Docker Desktop. En Linux, compruebe el servicio Docker Engine y los permisos de la cuenta actual. Vuelva a intentarlo cuando docker info funcione.' ;;
    docker_engine_help:pt-BR) host_message='Docker CLI ou Engine está indisponível. No macOS, instale e inicie o Docker Desktop. No Linux, verifique o serviço Docker Engine e as permissões da conta atual. Tente novamente após docker info funcionar.' ;;
    docker_engine_help:fr-FR) host_message='Docker CLI ou Engine est indisponible. Sur macOS, installez et démarrez Docker Desktop. Sur Linux, vérifiez le service Docker Engine et les permissions du compte actuel. Réessayez après le succès de docker info.' ;;
    docker_engine_help:ja-JP) host_message='Docker CLI または Engine を利用できません。macOS では Docker Desktop をインストールして起動してください。Linux では Docker Engine サービスと現在のアカウントのアクセス権限を確認してください。docker info が成功してから再試行してください。' ;;
    terminal_help:zh-CN) host_message='检查终端的 https_proxy / ALL_PROXY、代理监听端口和协议。SOCKS5 可用 socks5h:// 让代理解析域名。两步安装与网络配置：https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies' ;;
    terminal_help:en-US) host_message='Check terminal https_proxy / ALL_PROXY, the listening port and proxy scheme. socks5h:// resolves names through the proxy. Download instructions: https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies' ;;
    terminal_help:es-ES) host_message='Compruebe https_proxy / ALL_PROXY, el puerto y el protocolo del proxy en la terminal. socks5h:// resuelve nombres mediante el proxy. Instrucciones: https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies' ;;
    terminal_help:pt-BR) host_message='Verifique https_proxy / ALL_PROXY, a porta e o protocolo do proxy no terminal. socks5h:// resolve nomes pelo proxy. Instruções: https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies' ;;
    terminal_help:fr-FR) host_message='Vérifiez https_proxy / ALL_PROXY, le port et le protocole du proxy dans le terminal. socks5h:// résout les noms via le proxy. Instructions : https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies' ;;
    terminal_help:ja-JP) host_message='ターミナルの https_proxy / ALL_PROXY、待受ポート、プロキシの方式を確認してください。socks5h:// はプロキシ側で名前を解決します。手順：https://github.com/LingX-AI/linksense/blob/main/deploy/release/HOST-ADAPTATION.md#network-and-proxies' ;;
    docker_network_help:zh-CN) host_message='macOS：Docker Desktop → Settings → Resources → Proxies 单独配置代理；SOCKS5 需要 Business 订阅，可改用代理软件的 HTTP 端口。Linux：检查 daemon 代理。保留已有 Engine 配置，仅使用可信 registry-mirrors；镜像仓库的认证或限流也会导致拉取失败。' ;;
    docker_network_help:en-US) host_message='macOS: configure Docker Desktop → Settings → Resources → Proxies separately. SOCKS5 requires Business; use an HTTP proxy port otherwise. Linux: check the daemon proxy. Preserve Engine settings and use trusted registry-mirrors only; registry authentication or rate limits can also block pulls.' ;;
    docker_network_help:es-ES) host_message='macOS: configure por separado Docker Desktop → Settings → Resources → Proxies. SOCKS5 requiere Business; puede usar un puerto de proxy HTTP. Linux: compruebe el proxy del daemon. Conserve la configuración del Engine y use solo registry-mirrors de confianza; la autenticación o los límites del registro también pueden impedir descargas.' ;;
    docker_network_help:pt-BR) host_message='macOS: configure separadamente Docker Desktop → Settings → Resources → Proxies. SOCKS5 exige Business; use uma porta de proxy HTTP como alternativa. Linux: verifique o proxy do daemon. Preserve as configurações do Engine e use apenas registry-mirrors confiáveis; autenticação ou limites do registro também podem impedir downloads.' ;;
    docker_network_help:fr-FR) host_message='macOS : configurez séparément Docker Desktop → Settings → Resources → Proxies. SOCKS5 exige Business ; utilisez sinon un port de proxy HTTP. Linux : vérifiez le proxy du daemon. Conservez les réglages Engine et utilisez uniquement des registry-mirrors fiables ; l’authentification ou les limites du registre peuvent aussi bloquer les téléchargements.' ;;
    docker_network_help:ja-JP) host_message='macOS：Docker Desktop → Settings → Resources → Proxies で別途設定してください。SOCKS5 には Business が必要です。代わりに HTTP プロキシのポートを利用できます。Linux：daemon のプロキシを確認してください。Engine の設定を保持し、信頼できる registry-mirrors のみを使ってください。レジストリの認証や利用制限でも取得が失敗します。' ;;
    postgres_runtime:zh-CN) host_message='发布版 PostgreSQL 的隔离初始化检查失败。请检查主机容器运行时及 libseccomp 的兼容性，并保留 seccomp 隔离。阶段：%s' ;;
    postgres_runtime:en-US) host_message='The release PostgreSQL image failed its isolated initialization test. Check the host container runtime and libseccomp compatibility; keep seccomp enabled. Phase: %s' ;;
    postgres_runtime:es-ES) host_message='La imagen publicada de PostgreSQL no superó la prueba de inicialización aislada. Compruebe la compatibilidad del entorno de ejecución de contenedores y libseccomp del servidor; mantenga seccomp activado. Fase: %s' ;;
    postgres_runtime:pt-BR) host_message='A imagem publicada do PostgreSQL falhou no teste de inicialização isolada. Verifique a compatibilidade do runtime de contêineres e do libseccomp do host; mantenha o seccomp ativado. Etapa: %s' ;;
    postgres_runtime:fr-FR) host_message='L’image publiée de PostgreSQL a échoué au test d’initialisation isolée. Vérifiez la compatibilité du moteur d’exécution des conteneurs et de libseccomp sur l’hôte ; conservez seccomp activé. Étape : %s' ;;
    postgres_runtime:ja-JP) host_message='リリース版 PostgreSQL イメージの隔離初期化テストに失敗しました。ホストのコンテナランタイムと libseccomp の互換性を確認し、seccomp は有効のままにしてください。段階：%s' ;;
    engine:zh-CN) host_message='Docker Engine API %s 过旧；需要 API %s 或更新版本。请先安排服务端升级；更新客户端不能升级 Docker Engine。' ;;
    engine:en-US) host_message='Docker Engine API %s is too old; API %s or newer is required. Arrange a server upgrade first; updating the client does not upgrade Docker Engine.' ;;
    engine:es-ES) host_message='La API %s de Docker Engine es demasiado antigua; se requiere la API %s o posterior. Planifique primero la actualización del servidor; actualizar el cliente no actualiza Docker Engine.' ;;
    engine:pt-BR) host_message='A API %s do Docker Engine é antiga demais; é necessária a API %s ou posterior. Planeje primeiro a atualização do servidor; atualizar o cliente não atualiza o Docker Engine.' ;;
    engine:fr-FR) host_message='L’API %s de Docker Engine est trop ancienne ; l’API %s ou ultérieure est requise. Planifiez d’abord la mise à niveau du serveur ; mettre à jour le client ne met pas à niveau Docker Engine.' ;;
    engine:ja-JP) host_message='Docker Engine API %s は古すぎます。API %s 以降が必要です。先にサーバーの更新を計画してください。クライアントの更新では Docker Engine は更新されません。' ;;
    legacy_docker_os:zh-CN) host_message='%s 已不在 Docker 官方维护的 CentOS 安装范围内。请规划迁移到受支持的系统后再升级 Docker Engine；不要直接运行当前的一键 Docker 安装命令。官方要求：%s' ;;
    legacy_docker_os:en-US) host_message='%s is outside the maintained CentOS versions supported by Docker installation packages. Plan a migration to a supported OS before upgrading Docker Engine; do not run the current Docker convenience installer directly. Official requirements: %s' ;;
    legacy_docker_os:es-ES) host_message='%s no está entre las versiones de CentOS mantenidas que admiten los paquetes de instalación de Docker. Planifique la migración a un sistema compatible antes de actualizar Docker Engine; no ejecute directamente el instalador automatizado actual de Docker. Requisitos oficiales: %s' ;;
    legacy_docker_os:pt-BR) host_message='%s está fora das versões mantidas do CentOS compatíveis com os pacotes de instalação do Docker. Planeje a migração para um sistema compatível antes de atualizar o Docker Engine; não execute diretamente o instalador automático atual do Docker. Requisitos oficiais: %s' ;;
    legacy_docker_os:fr-FR) host_message='%s ne fait pas partie des versions maintenues de CentOS prises en charge par les paquets Docker. Planifiez une migration vers un système pris en charge avant de mettre à niveau Docker Engine ; n’exécutez pas directement le script d’installation automatisée actuel de Docker. Conditions officielles : %s' ;;
    legacy_docker_os:ja-JP) host_message='%s は Docker のインストールパッケージが対応する保守中の CentOS バージョンに含まれません。Docker Engine の更新前に対応 OS への移行を計画し、現在の Docker 自動インストールスクリプトをそのまま実行しないでください。公式要件：%s' ;;
    cpu_required:zh-CN) host_message='主机不支持 CPU 配额。修复内核，或显式设置 LINKSENSE_CPU_QUOTA_MODE=compatible 接受取消 CPU 配额。' ;;
    cpu_required:en-US) host_message='CPU quotas are unavailable. Repair the kernel or explicitly set LINKSENSE_CPU_QUOTA_MODE=compatible to accept unrestricted CPU use.' ;;
    cpu_required:es-ES) host_message='Las cuotas de CPU no están disponibles. Repare el kernel o establezca explícitamente LINKSENSE_CPU_QUOTA_MODE=compatible para aceptar el uso de CPU sin límite.' ;;
    cpu_required:pt-BR) host_message='As cotas de CPU não estão disponíveis. Corrija o kernel ou defina explicitamente LINKSENSE_CPU_QUOTA_MODE=compatible para aceitar o uso de CPU sem limite.' ;;
    cpu_required:fr-FR) host_message='Les quotas CPU sont indisponibles. Corrigez le noyau ou définissez explicitement LINKSENSE_CPU_QUOTA_MODE=compatible pour accepter une utilisation CPU sans limite.' ;;
    cpu_required:ja-JP) host_message='CPU クォータを利用できません。カーネルを修復するか、CPU 使用量の制限解除を承認して LINKSENSE_CPU_QUOTA_MODE=compatible を明示的に設定してください。' ;;
    cpu_warning:zh-CN) host_message='警告：此安装显式使用 CPU 兼容模式，不限制 CPU 时间；内存、PID 和其他隔离限制仍然保留。' ;;
    cpu_warning:en-US) host_message='Warning: this installation explicitly uses CPU compatibility mode without CPU time limits; memory, PID and other isolation limits remain enabled.' ;;
    cpu_warning:es-ES) host_message='Advertencia: esta instalación usa explícitamente el modo compatible sin límites de tiempo de CPU; conserva los límites de memoria, PID y demás medidas de aislamiento.' ;;
    cpu_warning:pt-BR) host_message='Aviso: esta instalação usa explicitamente o modo compatível sem limites de tempo de CPU; os limites de memória, PID e demais medidas de isolamento continuam ativos.' ;;
    cpu_warning:fr-FR) host_message='Attention : cette installation utilise explicitement le mode compatible sans limite de temps CPU ; les limites de mémoire, de PID et les autres protections restent actives.' ;;
    cpu_warning:ja-JP) host_message='警告：このインストールは CPU 時間を制限しない互換モードを明示的に使用しています。メモリ、PID、その他の分離制限は維持されます。' ;;
    capability:zh-CN) host_message='主机缺少必要的隔离能力。修复 Docker 或内核后重试：%s' ;;
    capability:en-US) host_message='Required isolation capabilities are unavailable. Repair Docker or the kernel and retry: %s' ;;
    capability:es-ES) host_message='Faltan capacidades de aislamiento necesarias. Repare Docker o el kernel y vuelva a intentarlo: %s' ;;
    capability:pt-BR) host_message='Faltam recursos de isolamento necessários. Corrija o Docker ou o kernel e tente novamente: %s' ;;
    capability:fr-FR) host_message='Des fonctions nécessaires à l’isolation sont indisponibles. Corrigez Docker ou le noyau, puis réessayez : %s' ;;
    capability:ja-JP) host_message='必要な分離機能がありません。Docker またはカーネルを修復して再実行してください：%s' ;;
    invalid_config:zh-CN) host_message='部署配置无效，或与已有安装不一致：%s' ;;
    invalid_config:en-US) host_message='The deployment configuration is invalid or conflicts with the existing installation: %s' ;;
    invalid_config:es-ES) host_message='La configuración de despliegue no es válida o contradice la instalación existente: %s' ;;
    invalid_config:pt-BR) host_message='A configuração de implantação é inválida ou conflita com a instalação existente: %s' ;;
    invalid_config:fr-FR) host_message='La configuration est invalide ou incompatible avec l’installation existante : %s' ;;
    invalid_config:ja-JP) host_message='デプロイ設定が無効か、既存のインストールと一致しません：%s' ;;
    download:zh-CN) host_message='下载失败，已达到重试或时间上限。检查网络与 HTTPS 代理后重新执行：%s' ;;
    download:en-US) host_message='Download failed within the retry/time limit. Check connectivity and the HTTPS proxy, then rerun: %s' ;;
    download:es-ES) host_message='La descarga falló dentro del límite de tiempo o reintentos. Compruebe la red y el proxy HTTPS y vuelva a ejecutar: %s' ;;
    download:pt-BR) host_message='A descarga falhou dentro do limite de tempo ou tentativas. Verifique a rede e o proxy HTTPS e execute novamente: %s' ;;
    download:fr-FR) host_message='Le téléchargement a échoué dans la limite de temps ou de tentatives. Vérifiez le réseau et le proxy HTTPS, puis relancez : %s' ;;
    download:ja-JP) host_message='時間または再試行の上限内にダウンロードできませんでした。接続と HTTPS プロキシを確認して再実行してください：%s' ;;
    pull:zh-CN) host_message='镜像拉取失败。Docker daemon 的代理与脚本代理独立；检查其网络、代理和磁盘后重试。不会自动重启 Docker：%s' ;;
    pull:en-US) host_message='Image pull failed. The Docker daemon proxy is separate from the script proxy; check its network, proxy and disk, then retry. Docker will not be restarted automatically: %s' ;;
    pull:es-ES) host_message='Falló la descarga de la imagen. El proxy del daemon Docker es independiente del proxy del script; compruebe su red, proxy y disco y reintente. Docker no se reiniciará automáticamente: %s' ;;
    pull:pt-BR) host_message='Falha ao baixar a imagem. O proxy do daemon Docker é separado do proxy do script; verifique rede, proxy e disco e tente novamente. O Docker não será reiniciado automaticamente: %s' ;;
    pull:fr-FR) host_message='Échec du téléchargement de l’image. Le proxy du daemon Docker est distinct de celui du script ; vérifiez son réseau, son proxy et son disque. Docker ne sera pas redémarré automatiquement : %s' ;;
    pull:ja-JP) host_message='イメージ取得に失敗しました。Docker daemon のプロキシはスクリプトのプロキシとは別です。接続、プロキシ、ディスクを確認してください。Docker は自動再起動しません：%s' ;;
    storage:zh-CN) host_message='Docker 存储空间或 inode 不足，或无法读取。不会删除现有数据或镜像：%s' ;;
    storage:en-US) host_message='Docker storage space/inodes are insufficient or unreadable. Existing data and images will not be deleted: %s' ;;
    storage:es-ES) host_message='El espacio o los inodos de Docker son insuficientes o no se pueden leer. No se eliminarán datos ni imágenes existentes: %s' ;;
    storage:pt-BR) host_message='O espaço ou os inodes do Docker são insuficientes ou ilegíveis. Dados e imagens existentes não serão removidos: %s' ;;
    storage:fr-FR) host_message='L’espace ou les inodes de Docker sont insuffisants ou illisibles. Les données et images existantes ne seront pas supprimées : %s' ;;
    storage:ja-JP) host_message='Docker の空き容量または inode が不足しているか、読み取れません。既存のデータやイメージは削除しません：%s' ;;
    memory:zh-CN) host_message='可用内存不足以容纳部署预算。扩容或明确调整资源配置后重试：%s' ;;
    memory:en-US) host_message='Available memory is below the deployment budget. Add memory or explicitly adjust resource settings, then retry: %s' ;;
    memory:es-ES) host_message='La memoria disponible no cubre el presupuesto del despliegue. Amplíela o ajuste explícitamente los recursos y vuelva a intentarlo: %s' ;;
    memory:pt-BR) host_message='A memória disponível não cobre o orçamento da implantação. Amplie a memória ou ajuste explicitamente os recursos e tente novamente: %s' ;;
    memory:fr-FR) host_message='La mémoire disponible est inférieure au budget du déploiement. Ajoutez de la mémoire ou ajustez explicitement les ressources : %s' ;;
    memory:ja-JP) host_message='利用可能なメモリがデプロイの予算を下回っています。増設またはリソース設定の明示的な調整後に再実行してください：%s' ;;
    memory_budget_warning:zh-CN) host_message='警告：当前可用内存为 %s MiB，低于服务内存上限合计及预留余量 %s MiB。将继续，但并发任务或大文档处理可能因内存不足失败；建议降低负载或扩容。' ;;
    memory_budget_warning:en-US) host_message='Warning: %s MiB is available, below the combined service memory limits and headroom of %s MiB. Continuing, but concurrent tasks or large documents may run out of memory. Reduce the workload or add memory.' ;;
    memory_budget_warning:es-ES) host_message='Advertencia: hay %s MiB disponibles, menos que los límites de memoria de los servicios y el margen de %s MiB. Se continuará, pero las tareas simultáneas o los documentos grandes pueden agotar la memoria. Reduzca la carga o amplíe la memoria.' ;;
    memory_budget_warning:pt-BR) host_message='Aviso: há %s MiB disponíveis, abaixo dos limites de memória dos serviços e da margem de %s MiB. A operação continuará, mas tarefas simultâneas ou documentos grandes podem esgotar a memória. Reduza a carga ou amplie a memória.' ;;
    memory_budget_warning:fr-FR) host_message='Attention : %s MiB sont disponibles, en dessous des limites mémoire cumulées des services et de la marge de %s MiB. L’opération continue, mais des tâches simultanées ou de gros documents peuvent épuiser la mémoire. Réduisez la charge ou ajoutez de la mémoire.' ;;
    memory_budget_warning:ja-JP) host_message='警告：利用可能なメモリは %s MiB で、サービスのメモリ上限の合計と余裕分の %s MiB を下回っています。処理は続行しますが、同時タスクや大きな文書の処理でメモリ不足になる可能性があります。負荷を減らすか、メモリを増やしてください。' ;;
    tools:zh-CN) host_message='私有 Docker 工具不可用或校验失败。不会覆盖系统工具；修复工具或重新运行安装器：%s' ;;
    tools:en-US) host_message='Private Docker tools are unavailable or failed verification. System tools will not be overwritten; repair the tools or rerun the installer: %s' ;;
    tools:es-ES) host_message='Las herramientas privadas de Docker no están disponibles o falló su verificación. No se sobrescribirán las del sistema; repárelas o vuelva a ejecutar el instalador: %s' ;;
    tools:pt-BR) host_message='As ferramentas privadas do Docker estão indisponíveis ou falharam na verificação. As ferramentas do sistema não serão sobrescritas; corrija-as ou execute o instalador novamente: %s' ;;
    tools:fr-FR) host_message='Les outils Docker privés sont indisponibles ou ont échoué à la vérification. Les outils système ne seront pas remplacés ; corrigez-les ou relancez l’installateur : %s' ;;
    tools:ja-JP) host_message='専用 Docker ツールを利用できないか、検証に失敗しました。システムのツールは上書きしません。修復またはインストーラーを再実行してください：%s' ;;
    sysctl:zh-CN) host_message='Elasticsearch 要求 vm.max_map_count 至少为 262144。请调整 Docker 所在主机或虚拟机后重试：%s' ;;
    sysctl:en-US) host_message='Elasticsearch requires vm.max_map_count >= 262144. Adjust the Docker host or VM, then retry: %s' ;;
    sysctl:es-ES) host_message='Elasticsearch requiere vm.max_map_count >= 262144. Ajuste el host o la máquina virtual de Docker y vuelva a intentarlo: %s' ;;
    sysctl:pt-BR) host_message='O Elasticsearch exige vm.max_map_count >= 262144. Ajuste o host ou a máquina virtual do Docker e tente novamente: %s' ;;
    sysctl:fr-FR) host_message='Elasticsearch exige vm.max_map_count >= 262144. Ajustez l’hôte ou la VM Docker, puis réessayez : %s' ;;
    sysctl:ja-JP) host_message='Elasticsearch には vm.max_map_count >= 262144 が必要です。Docker ホストまたは VM を調整して再実行してください：%s' ;;
    probe:zh-CN) host_message='真实容器能力检查失败；不会继续启动业务服务。检查 Docker 或内核配置后重试：%s' ;;
    probe:en-US) host_message='The real container capability probe failed; application startup is blocked. Check Docker or kernel settings and retry: %s' ;;
    probe:es-ES) host_message='Falló la comprobación real de capacidades del contenedor; se bloquea el inicio de la aplicación. Compruebe Docker o el kernel y reintente: %s' ;;
    probe:pt-BR) host_message='A verificação real dos recursos do contêiner falhou; a aplicação não será iniciada. Verifique o Docker ou o kernel e tente novamente: %s' ;;
    probe:fr-FR) host_message='La vérification réelle des capacités du conteneur a échoué ; le démarrage est bloqué. Vérifiez Docker ou le noyau : %s' ;;
    probe:ja-JP) host_message='実コンテナによる機能確認に失敗したため、アプリケーションの起動を中止します。Docker またはカーネルの設定を確認してください：%s' ;;
    stability:zh-CN) host_message='服务稳定性检查失败，检测到重启、OOM 或未就绪服务。状态已保留，检查日志后重跑对应脚本；已有安装可运行 linksense doctor：%s' ;;
    stability:en-US) host_message='Service stability checks detected a restart, OOM or unready service. State was preserved; review logs and rerun the matching script. Existing installations can use linksense doctor: %s' ;;
    stability:es-ES) host_message='La comprobación de estabilidad detectó un reinicio, OOM o servicio no listo. Se conservó el estado; revise los registros y vuelva a ejecutar el script correspondiente. Las instalaciones existentes pueden usar linksense doctor: %s' ;;
    stability:pt-BR) host_message='A verificação de estabilidade detectou reinício, OOM ou serviço não pronto. O estado foi preservado; verifique os logs e execute novamente o script correspondente. Instalações existentes podem usar linksense doctor: %s' ;;
    stability:fr-FR) host_message='La vérification de stabilité a détecté un redémarrage, un OOM ou un service indisponible. L’état est conservé ; consultez les journaux et relancez le script correspondant. Les installations existantes peuvent utiliser linksense doctor : %s' ;;
    stability:ja-JP) host_message='安定性チェックで再起動、OOM、または準備未完了のサービスを検出しました。状態は保持されています。ログを確認して対応するスクリプトを再実行してください。既存インストールでは linksense doctor を使用できます：%s' ;;
    port:zh-CN) host_message='默认端口已占用，首次安装改用 TCP %s；所选端口将被保存。' ;;
    port:en-US) host_message='The default port is occupied; this fresh installation will use TCP %s and preserve that choice.' ;;
    port:es-ES) host_message='El puerto predeterminado está ocupado; esta nueva instalación usará TCP %s y conservará esa elección.' ;;
    port:pt-BR) host_message='A porta padrão está ocupada; esta nova instalação usará TCP %s e manterá essa escolha.' ;;
    port:fr-FR) host_message='Le port par défaut est occupé ; cette nouvelle installation utilisera TCP %s et conservera ce choix.' ;;
    port:ja-JP) host_message='既定のポートは使用中です。新規インストールは TCP %s を使用し、この設定を保存します。' ;;
    locked:zh-CN) host_message='另一个部署或管理操作正在运行，或锁文件不可信。等待操作结束后重试：%s' ;;
    locked:en-US) host_message='Another deployment/management operation is running, or its lock is untrusted. Wait for it to finish, then retry: %s' ;;
    locked:es-ES) host_message='Hay otra operación de despliegue o gestión en curso, o su bloqueo no es fiable. Espere a que termine y vuelva a intentarlo: %s' ;;
    locked:pt-BR) host_message='Outra operação de implantação ou gerenciamento está em andamento, ou o bloqueio não é confiável. Aguarde o término e tente novamente: %s' ;;
    locked:fr-FR) host_message='Une autre opération de déploiement ou de gestion est en cours, ou son verrou n’est pas fiable. Attendez sa fin, puis réessayez : %s' ;;
    locked:ja-JP) host_message='別のデプロイまたは管理操作が実行中か、ロックを信頼できません。完了後に再実行してください：%s' ;;
    baseline:zh-CN) host_message='基础部署检查已完成。如尚未配置模型，请在后台配置后另行验证真实 AI 任务。' ;;
    baseline:en-US) host_message='Base deployment checks are complete. If models are not configured, configure them in administration before verifying real AI tasks.' ;;
    baseline:es-ES) host_message='Las comprobaciones básicas del despliegue están completas. Si no hay modelos configurados, configúrelos en administración antes de verificar tareas reales de IA.' ;;
    baseline:pt-BR) host_message='As verificações básicas da implantação foram concluídas. Se os modelos ainda não estiverem configurados, configure-os na administração antes de verificar tarefas reais de IA.' ;;
    baseline:fr-FR) host_message='Les vérifications de base du déploiement sont terminées. Si les modèles ne sont pas configurés, configurez-les dans l’administration avant de vérifier des tâches IA réelles.' ;;
    baseline:ja-JP) host_message='基本デプロイの確認が完了しました。モデルが未設定の場合は、管理画面で設定してから実際の AI タスクを別途検証してください。' ;;
    *) host_message='%s' ;;
  esac
  printf "$host_message\n" "$@"
}

host_fail() {
  host_error=$1
  shift
  printf '[LS_HOST_%s] ' "$host_error" >&2
  host_text "$host_error" "$@" >&2
  exit 1
}

host_check_docker_credentials() (
  [ "${HOST_OS:-$(uname -s)}" = Darwin ] || return 0
  host_config=${DOCKER_CONFIG:-${HOME:-}/.docker}/config.json
  [ -f "$host_config" ] || return 0
  # Registry-specific helpers override credsStore; let each pull select its helper.
  host_helpers=$(plutil -extract credHelpers raw -expect dictionary -o - "$host_config" 2>/dev/null || true)
  [ -z "$host_helpers" ] || return 0
  if ! host_store=$(plutil -extract credsStore raw -expect string -o - "$host_config" 2>/dev/null); then return 0; fi
  [ -n "$host_store" ] || return 0
  case "$host_store" in *[!A-Za-z0-9_.-]*) host_fail invalid_config Docker_credsStore ;; esac
  command -v "docker-credential-$host_store" >/dev/null 2>&1 || host_fail credential "docker-credential-$host_store"
)

read_key() {
  file=$1
  expected=$2
  awk -F= -v expected="$expected" '
    $1 == expected {
      count += 1
      value = substr($0, length($1) + 2)
    }
    END {
      if (count != 1) exit 1
      print value
    }
  ' "$file"
}

host_network_request() (
  host_network_url=$1
  host_network_target=${2:-/dev/null}
  host_network_status=0
  curl --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 -fsSL -o "$host_network_target" "$host_network_url" >/dev/null 2>&1 || host_network_status=$?
  case "$host_network_status" in
    0) return 0 ;;
    16|92) curl --http1.1 --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 10 --max-time 30 -fsSL -o "$host_network_target" "$host_network_url" >/dev/null 2>&1 ;;
    *) return "$host_network_status" ;;
  esac
)

host_network_diagnostics() (
  host_network_base=${1%/}
  shift
  host_network_failed=0
  host_network_tmp=$(mktemp -d)
  trap 'rm -r "$host_network_tmp"' EXIT
  host_network_release_ok=false
  if host_network_request "$host_network_base/release-manifest.env" "$host_network_tmp/manifest"; then
    host_network_release_ok=true
    host_text network_pass terminal-release
  else
    host_text network_fail terminal-release
    host_text terminal_help
    host_network_failed=1
  fi
  case "$host_network_base" in
    https://github.com/LingX-AI/linksense/releases/*)
      if host_network_request https://raw.githubusercontent.com/LingX-AI/linksense/main/install-core.sh; then
        host_text network_pass terminal-bootstrap
      else
        host_text network_fail terminal-bootstrap
        host_text terminal_help
        host_network_failed=1
      fi ;;
  esac
  if [ "$#" -eq 0 ]; then
    host_network_images_valid=false
    if [ "$host_network_release_ok" = true ] && host_network_request "$host_network_base/release-manifest.env.sha256" "$host_network_tmp/checksum"; then
      host_network_expected=$(awk 'NF { print $1; exit }' "$host_network_tmp/checksum")
      host_network_busybox=$(read_key "$host_network_tmp/manifest" IMAGE_BUSYBOX 2>/dev/null || true)
      host_network_api=$(read_key "$host_network_tmp/manifest" IMAGE_LINKSENSE_API 2>/dev/null || true)
      if printf '%s' "$host_network_expected" | grep -Eq '^[0-9a-f]{64}$' &&
        [ "$(host_sha256 "$host_network_tmp/manifest")" = "$host_network_expected" ] &&
        printf '%s' "$host_network_busybox" | grep -Eq '^[a-z0-9./-]+@sha256:[0-9a-f]{64}$' &&
        printf '%s' "$host_network_api" | grep -Eq '^[a-z0-9./-]+@sha256:[0-9a-f]{64}$'; then
        set -- "$host_network_busybox" "$host_network_api"
        host_network_images_valid=true
        host_text network_pass release-images
      fi
    fi
    if [ "$host_network_images_valid" != true ]; then
      host_text network_fail release-images
      host_text terminal_help
      host_network_failed=1
      set -- hello-world:latest
    fi
  fi
  if [ -z "$DOCKER_CLI" ] || ! docker info >/dev/null 2>&1; then
    host_text network_fail docker-engine
    host_text docker_engine_help
    return 1
  fi
  host_text network_pass docker-engine
  host_text network_pass "docker-cli:$DOCKER_CLI"
  if (host_check_docker_credentials); then
    host_text network_pass docker-credentials
  else
    host_network_failed=1
  fi
  for host_network_image in "$@"; do
    if host_bounded 120 "$DOCKER_CLI" pull "$host_network_image" >/dev/null 2>&1; then
      host_text network_pass "docker-pull:$host_network_image"
    else
      host_text network_fail "docker-pull:$host_network_image"
      host_text docker_network_help
      host_network_failed=1
    fi
  done
  return "$host_network_failed"
)

host_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

host_version_ge() {
  awk -v current="${1#v}" -v required="${2#v}" 'BEGIN {
    a=split(current,c,"."); b=split(required,r,"."); n=a>b?a:b
    for(i=1;i<=n;i++){if(c[i]+0>r[i]+0)exit 0;if(c[i]+0<r[i]+0)exit 1}exit 0
  }'
}

# Pass an executable, rather than a shell function, so the deadline kills the client too.
host_bounded() (
  host_seconds=$1
  shift
  # dash redirects background stdin before redirections; preserve the backup stream separately.
  exec 3<&0
  "$@" <&3 3<&- &
  host_command_pid=$!
  exec 3<&-
  (
    /bin/sleep "$host_seconds" & host_timer_pid=$!
    trap 'kill "$host_timer_pid" 2>/dev/null || true; wait "$host_timer_pid" 2>/dev/null || true; exit 0' TERM INT HUP
    wait "$host_timer_pid"
    kill -TERM "$host_command_pid" 2>/dev/null || true
    sleep 2
    kill -KILL "$host_command_pid" 2>/dev/null || true
  ) >/dev/null 2>&1 &
  host_watchdog_pid=$!
  host_status=0
  wait "$host_command_pid" || host_status=$?
  kill "$host_watchdog_pid" 2>/dev/null || true
  wait "$host_watchdog_pid" 2>/dev/null || true
  return "$host_status"
)

host_download() (
  host_url=$1
  host_target=$2
  host_resume=${3:-}
  host_attempt=0
  host_protocol=
  while [ "$host_attempt" -lt 3 ]; do
    host_attempt=$((host_attempt + 1))
    host_result=0
    host_range=
    if [ "$host_resume" = resume ] && [ -s "$host_target.part" ]; then host_range='--continue-at -'; fi
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 --connect-timeout 15 \
      --max-time 300 --speed-limit 1024 --speed-time 30 -fsSL $host_protocol \
      $host_range "$host_url" -o "$host_target.part" 2>"$host_target.error" || host_result=$?
    if [ "$host_result" = 0 ]; then
      mv "$host_target.part" "$host_target"
      rm -f "$host_target.error"
      return 0
    fi
    case "$host_result" in
      16|92) host_protocol=--http1.1 ;;
      33|36) [ -n "$host_range" ] || break; rm -f "$host_target.part" ;;
      5|6|7|18|28|35|52|55|56) ;;
      22) grep -Eq '(^|[^0-9])(408|429|500|502|503|504)([^0-9]|$)' "$host_target.error" || break ;;
      *) break ;;
    esac
    [ "$host_attempt" -ge 3 ] || sleep "$host_attempt"
  done
  [ "$host_resume" = resume ] || rm -f "$host_target.part"
  rm -f "$host_target.error"
  host_text terminal_help >&2
  host_fail download "curl_exit=$host_result attempts=$host_attempt"
)

host_cpu_mode() {
  case "${LINKSENSE_CPU_QUOTA_MODE:-strict}" in
    strict|compatible) ;;
    *) host_fail invalid_config LINKSENSE_CPU_QUOTA_MODE ;;
  esac
  if [ "${LINKSENSE_CPU_QUOTA_MODE:-strict}" = compatible ]; then host_text cpu_warning >&2; fi
}

host_capabilities() {
  host_cpu_mode
  host_memory=$(docker info --format '{{.MemoryLimit}}' 2>/dev/null || true)
  host_pids=$(docker info --format '{{.PidsLimit}}' 2>/dev/null || true)
  [ "$host_memory:$host_pids" = true:true ] || host_fail capability "MemoryLimit=$host_memory PidsLimit=$host_pids"
  host_quota=$(docker info --format '{{.CPUCfsQuota}}' 2>/dev/null || true)
  host_period=$(docker info --format '{{.CPUCfsPeriod}}' 2>/dev/null || true)
  if [ "${LINKSENSE_CPU_QUOTA_MODE:-strict}" = strict ]; then
    [ "$host_quota:$host_period" = true:true ] || host_fail cpu_required
  fi
}

docker() {
  [ -n "$DOCKER_CLI" ] || host_fail tools docker
  case "$1" in
    info|version|context|inspect|ps|image|volume|create|rm) host_bounded 30 "$DOCKER_CLI" "$@" ;;
    run|start|stop|network|compose) host_bounded 1800 "$DOCKER_CLI" "$@" ;;
    *) "$DOCKER_CLI" "$@" ;;
  esac
}

host_compose() {
  if [ -n "$COMPOSE_CLI" ]; then host_bounded 1800 "$COMPOSE_CLI" "$@"
  else docker compose "$@"; fi
}

host_tool_pin() {
  case "$1:$HOST_OS:$LINKSENSE_PLATFORM" in
    docker:Linux:linux-amd64) TOOL_URL=https://download.docker.com/linux/static/stable/x86_64/docker-26.1.4.tgz; TOOL_SHA=a9cede81aa3337f310132c2c920dba2edc8d29b7d97065b63ba41cf47ae1ca4f ;;
    docker:Linux:linux-arm64) TOOL_URL=https://download.docker.com/linux/static/stable/aarch64/docker-26.1.4.tgz; TOOL_SHA=6f1a5fb161aef875d305ee4f79e65492b3c13e90dbe0a339df2ad6515e4f6849 ;;
    compose:Linux:linux-amd64) TOOL_SHA=dba9d98e1ba5bfe11d88c99b9bd32fc4a0624a30fafe68eea34d61a3e42fd372; TOOL_ARCH=linux-x86_64 ;;
    compose:Linux:linux-arm64) TOOL_SHA=d26373b19e89160546d15407516cc59f453030d9bc5b43ba7faf16f7b4980137; TOOL_ARCH=linux-aarch64 ;;
    compose:Darwin:linux-amd64) TOOL_SHA=53528ecff0182546d92d7cc3f50dc78f9b387c3da68b4a3fd0cf2c48dab77133; TOOL_ARCH=darwin-x86_64 ;;
    compose:Darwin:linux-arm64) TOOL_SHA=8cd7eb5f95bacb536cc407111662e2c205d67d9abfea5dcb8400be8418db60d1; TOOL_ARCH=darwin-aarch64 ;;
    *) host_fail tools "$1/$HOST_OS/$LINKSENSE_PLATFORM" ;;
  esac
  if [ "$1" = compose ]; then TOOL_URL=https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-$TOOL_ARCH; fi
}

host_install_tool() {
  host_tool=$1
  host_tool_pin "$host_tool"
  host_tool_directory=$TMP_ROOT/tools
  mkdir -p "$host_tool_directory"
  host_download "$TOOL_URL" "$host_tool_directory/$host_tool.download"
  [ "$(host_sha256 "$host_tool_directory/$host_tool.download")" = "$TOOL_SHA" ] || host_fail tools "$host_tool/checksum"
  if [ "$host_tool" = docker ]; then
    tar -xzf "$host_tool_directory/docker.download" -C "$host_tool_directory" docker/docker
    mv "$host_tool_directory/docker/docker" "$host_tool_directory/docker-cli"
    rmdir "$host_tool_directory/docker"
    DOCKER_CLI=$host_tool_directory/docker-cli
  else
    mv "$host_tool_directory/compose.download" "$host_tool_directory/compose-cli"
    COMPOSE_CLI=$host_tool_directory/compose-cli
  fi
  rm -f "$host_tool_directory/$host_tool.download"
  chmod 0700 "$host_tool_directory/"*-cli
}

host_use_saved_tools() {
  if [ -e "$INSTALL_DIR/tools" ] || [ -L "$INSTALL_DIR/tools" ]; then
    [ -d "$INSTALL_DIR/tools" ] && [ ! -L "$INSTALL_DIR/tools" ] || host_fail tools directory
    host_directory_owner=$(stat -c '%u' "$INSTALL_DIR/tools" 2>/dev/null || stat -f '%u' "$INSTALL_DIR/tools")
    host_directory_mode=$(stat -c '%a' "$INSTALL_DIR/tools" 2>/dev/null || stat -f '%Lp' "$INSTALL_DIR/tools")
    [ "$host_directory_owner:$host_directory_mode" = "$(id -u):700" ] || host_fail tools directory_permissions
  fi
  for host_tool in docker compose; do
    host_saved=$INSTALL_DIR/tools/$host_tool-cli
    if [ -e "$host_saved" ] || [ -L "$host_saved" ]; then
      [ -f "$host_saved" ] && [ ! -L "$host_saved" ] && [ -x "$host_saved" ] || host_fail tools "$host_tool/type"
      host_owner=$(stat -c '%u' "$host_saved" 2>/dev/null || stat -f '%u' "$host_saved")
      [ "$host_owner" = "$(id -u)" ] || host_fail tools "$host_tool/owner"
      [ -f "$host_saved.sha256" ] && [ ! -L "$host_saved.sha256" ] || host_fail tools "$host_tool/checksum"
      [ "$(host_sha256 "$host_saved")" = "$(cat "$host_saved.sha256")" ] || host_fail tools "$host_tool/checksum"
      if [ "$host_tool" = docker ]; then DOCKER_CLI=$host_saved; else COMPOSE_CLI=$host_saved; fi
    fi
  done
}

host_prepare_tools() {
  host_use_saved_tools
  host_client_api=
  [ -z "$DOCKER_CLI" ] || host_client_api=$(docker version --format '{{.Client.APIVersion}}' 2>/dev/null || true)
  if [ -z "$host_client_api" ] || ! host_version_ge "$host_client_api" 1.45; then
    if [ "$HOST_OS" = Darwin ]; then host_fail tools DockerDesktop; fi
    host_install_tool docker
  fi
  host_compose_version=$(host_compose version --short 2>/dev/null || true)
  if [ -z "$host_compose_version" ] || ! host_version_ge "$host_compose_version" 2.24.4; then host_install_tool compose; fi
}

host_save_tools() {
  [ -d "$TMP_ROOT/tools" ] || return 0
  [ ! -L "$INSTALL_DIR/tools" ] || host_fail tools symlink
  install -d -m 0700 "$INSTALL_DIR/tools"
  for host_tool in docker compose; do
    if [ -f "$TMP_ROOT/tools/$host_tool-cli" ]; then
      install -m 0700 "$TMP_ROOT/tools/$host_tool-cli" "$INSTALL_DIR/tools/$host_tool-cli"
      host_sha256 "$INSTALL_DIR/tools/$host_tool-cli" > "$INSTALL_DIR/tools/$host_tool-cli.sha256"
      chmod 0600 "$INSTALL_DIR/tools/$host_tool-cli.sha256"
    fi
  done
}

host_storage() {
  host_storage_path=$1
  host_required_kb=$2
  host_required_inodes=$3
  host_free_kb=$(df -Pk "$host_storage_path" 2>/dev/null | awk 'END {print $4}')
  host_free_inodes=$(df -Pi "$host_storage_path" 2>/dev/null | awk 'END {print $4}')
  case "$host_free_kb" in ''|*[!0-9]*) host_fail storage "path=$host_storage_path space=unknown" ;; esac
  [ "$host_free_kb" -ge "$host_required_kb" ] || host_fail storage "path=$host_storage_path available_kib=$host_free_kb required_kib=$host_required_kb"
  # Filesystems without a finite inode count must not be rejected for reporting '-'.
  case "$host_free_inodes" in ''|-|*[!0-9]*) ;;
    *) [ "$host_free_inodes" -ge "$host_required_inodes" ] || host_fail storage "path=$host_storage_path available_inodes=$host_free_inodes required_inodes=$host_required_inodes" ;;
  esac
}

host_service_snapshot() {
  host_snapshot_ready=true
  host_services='postgres redis minio runner api web gateway'
  [ "$EDITION" != full ] || host_services="$host_services elasticsearch docling-api docling-worker"
  for host_service in $host_services; do
    host_ids=$(compose ps --all -q "$host_service")
    [ -n "$host_ids" ] || host_fail stability "$host_service/missing"
    for host_id in $host_ids; do
      host_state=$(docker inspect --format '{{.Id}} {{.State.StartedAt}} {{.RestartCount}} {{.State.Running}} {{.State.OOMKilled}} {{with index .State "Health"}}{{.Status}}{{else}}none{{end}}' "$host_id")
      case "$host_state" in
        *' true false healthy'|*' true false none') ;;
        *' true false starting')
          # An HTTP response can precede the first scheduled Docker healthcheck.
          # Only the bounded initial-readiness loop may wait for that check.
          [ "${1:-stable}" = readiness ] || host_fail stability "$host_service/unready"
          host_snapshot_ready=false
          ;;
        *) host_fail stability "$host_service/unready" ;;
      esac
      printf '%s %s\n' "$host_service" "$host_state"
    done
  done
  [ "$host_snapshot_ready" = true ]
}

host_lock_installation() {
  host_lock_base=$INSTALL_DIR
  while [ "${host_lock_base%/}" != "$host_lock_base" ]; do host_lock_base=${host_lock_base%/}; done
  [ -n "$host_lock_base" ] || host_fail invalid_config installation_root
  HOST_LOCK_DIR=$host_lock_base.install-lock
  mkdir -p "$(dirname "$HOST_LOCK_DIR")"
  if ! (umask 077; mkdir "$HOST_LOCK_DIR") 2>/dev/null; then
    [ -d "$HOST_LOCK_DIR" ] && [ ! -L "$HOST_LOCK_DIR" ] || host_fail locked "$HOST_LOCK_DIR"
    host_lock_owner=$(stat -c '%u' "$HOST_LOCK_DIR" 2>/dev/null || stat -f '%u' "$HOST_LOCK_DIR")
    host_lock_mode=$(stat -c '%a' "$HOST_LOCK_DIR" 2>/dev/null || stat -f '%Lp' "$HOST_LOCK_DIR")
    [ "$host_lock_owner:$host_lock_mode" = "$(id -u):700" ] && [ -f "$HOST_LOCK_DIR/owner" ] && [ ! -L "$HOST_LOCK_DIR/owner" ] || host_fail locked "$HOST_LOCK_DIR"
    host_lock_pid=$(sed -n '1p' "$HOST_LOCK_DIR/owner")
    host_lock_started=$(sed -n '2p' "$HOST_LOCK_DIR/owner")
    [ -n "$host_lock_started" ] || host_fail locked "$HOST_LOCK_DIR"
    printf '%s' "$host_lock_pid" | grep -Eq '^[1-9][0-9]*$' || host_fail locked "$HOST_LOCK_DIR"
    host_lock_current=$(TZ=UTC LC_ALL=C ps -p "$host_lock_pid" -o lstart= 2>/dev/null || true)
    if [ -z "$host_lock_current" ] && kill -0 "$host_lock_pid" 2>/dev/null; then host_fail locked "pid=$host_lock_pid/status_unknown"; fi
    if [ -n "$host_lock_current" ] && [ "$host_lock_current" = "$host_lock_started" ]; then host_fail locked "pid=$host_lock_pid"; fi
    [ "$(ls -A "$HOST_LOCK_DIR")" = owner ] || host_fail locked "$HOST_LOCK_DIR"
    # Atomically claim stale recovery before removing the old directory.
    ln "$HOST_LOCK_DIR/owner" "$HOST_LOCK_DIR/recovering" 2>/dev/null || host_fail locked "$HOST_LOCK_DIR"
    rm -f "$HOST_LOCK_DIR/owner"
    rm -f "$HOST_LOCK_DIR/recovering"
    rmdir "$HOST_LOCK_DIR" || host_fail locked "$HOST_LOCK_DIR"
    (umask 077; mkdir "$HOST_LOCK_DIR") 2>/dev/null || host_fail locked "$HOST_LOCK_DIR"
  fi
  HOST_LOCK_HELD=true
  HOST_LOCK_STARTED=$(TZ=UTC LC_ALL=C ps -p $$ -o lstart=)
  [ -n "$HOST_LOCK_STARTED" ] || host_fail locked process_start_unknown
  (umask 077; printf '%s\n' "$$" "$HOST_LOCK_STARTED" > "$HOST_LOCK_DIR/owner")
}

host_unlock_installation() {
  [ "${HOST_LOCK_HELD:-false}" = true ] || return 0
  if [ ! -L "$HOST_LOCK_DIR" ] && [ "$(sed -n '1p' "$HOST_LOCK_DIR/owner" 2>/dev/null)" = "$$" ] && [ "$(sed -n '2p' "$HOST_LOCK_DIR/owner" 2>/dev/null)" = "$HOST_LOCK_STARTED" ]; then
    rm -f "$HOST_LOCK_DIR/owner"
    rmdir "$HOST_LOCK_DIR"
  fi
  HOST_LOCK_HELD=false
}
