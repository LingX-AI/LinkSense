import type { Locale, ModelGatewayFailureCode } from "@linksense/shared"

export const modelGatewayMessages = {
  "zh-CN": {
    model_provider_error:
      "模型渠道请求失败。请联系管理员检查模型渠道和执行服务日志，确认原因后再继续任务。",
    model_provider_authentication_failed:
      "模型渠道拒绝访问。请联系管理员检查渠道凭据和模型访问权限。",
    model_provider_rate_limited:
      "模型渠道触发限流或用量限制。请稍后重试，或联系管理员检查渠道额度。",
    model_provider_invalid_request:
      "模型渠道拒绝了请求。请联系管理员检查协议模式、模型能力和请求兼容性。",
    model_provider_unavailable:
      "模型渠道暂时不可用。请稍后重试，或选择其他可用模型。",
    model_provider_timeout:
      "模型渠道请求超时。请检查渠道网络，确认任务状态后再继续。",
    model_gateway_error:
      "模型连接失败。请联系管理员检查执行服务和模型渠道网络。",
  },
  "en-US": {
    model_provider_error:
      "The model provider request failed. Ask an administrator to check the provider and execution logs before continuing the task.",
    model_provider_authentication_failed:
      "The model provider denied access. Ask an administrator to check the provider credentials and model permissions.",
    model_provider_rate_limited:
      "The model provider reached a rate or usage limit. Try later or ask an administrator to check the provider quota.",
    model_provider_invalid_request:
      "The model provider rejected the request. Ask an administrator to check the protocol mode, model capabilities and request compatibility.",
    model_provider_unavailable:
      "The model provider is temporarily unavailable. Try later or select another available model.",
    model_provider_timeout:
      "The model provider request timed out. Check provider connectivity and the task status before continuing.",
    model_gateway_error:
      "The model connection failed. Ask an administrator to check the execution service and provider connectivity.",
  },
  "es-ES": {
    model_provider_error:
      "Falló la solicitud al proveedor del modelo. Pide a un administrador que revise el proveedor y los registros de ejecución antes de continuar la tarea.",
    model_provider_authentication_failed:
      "El proveedor del modelo denegó el acceso. Pide a un administrador que revise las credenciales y los permisos del modelo.",
    model_provider_rate_limited:
      "El proveedor del modelo alcanzó un límite de solicitudes o de uso. Inténtalo más tarde o pide a un administrador que revise la cuota.",
    model_provider_invalid_request:
      "El proveedor del modelo rechazó la solicitud. Pide a un administrador que revise el modo de protocolo, las capacidades del modelo y la compatibilidad de la solicitud.",
    model_provider_unavailable:
      "El proveedor del modelo no está disponible temporalmente. Inténtalo más tarde o selecciona otro modelo disponible.",
    model_provider_timeout:
      "La solicitud al proveedor del modelo agotó el tiempo de espera. Comprueba la conectividad y el estado de la tarea antes de continuar.",
    model_gateway_error:
      "Falló la conexión con el modelo. Pide a un administrador que revise el servicio de ejecución y la conectividad del proveedor.",
  },
  "pt-BR": {
    model_provider_error:
      "A solicitação ao provedor do modelo falhou. Peça a um administrador para verificar o provedor e os logs de execução antes de continuar a tarefa.",
    model_provider_authentication_failed:
      "O provedor do modelo negou o acesso. Peça a um administrador para verificar as credenciais e as permissões do modelo.",
    model_provider_rate_limited:
      "O provedor do modelo atingiu um limite de requisições ou de uso. Tente mais tarde ou peça a um administrador para verificar a cota.",
    model_provider_invalid_request:
      "O provedor do modelo rejeitou a solicitação. Peça a um administrador para verificar o modo de protocolo, os recursos do modelo e a compatibilidade da solicitação.",
    model_provider_unavailable:
      "O provedor do modelo está temporariamente indisponível. Tente mais tarde ou selecione outro modelo disponível.",
    model_provider_timeout:
      "A solicitação ao provedor do modelo excedeu o tempo limite. Verifique a conectividade e o estado da tarefa antes de continuar.",
    model_gateway_error:
      "A conexão com o modelo falhou. Peça a um administrador para verificar o serviço de execução e a conectividade do provedor.",
  },
  "fr-FR": {
    model_provider_error:
      "La requête au fournisseur du modèle a échoué. Demandez à un administrateur de vérifier le fournisseur et les journaux d’exécution avant de poursuivre la tâche.",
    model_provider_authentication_failed:
      "Le fournisseur du modèle a refusé l’accès. Demandez à un administrateur de vérifier les identifiants et les permissions du modèle.",
    model_provider_rate_limited:
      "Le fournisseur du modèle a atteint une limite de requêtes ou d’utilisation. Réessayez plus tard ou demandez à un administrateur de vérifier le quota.",
    model_provider_invalid_request:
      "Le fournisseur du modèle a rejeté la requête. Demandez à un administrateur de vérifier le mode de protocole, les capacités du modèle et la compatibilité de la requête.",
    model_provider_unavailable:
      "Le fournisseur du modèle est temporairement indisponible. Réessayez plus tard ou choisissez un autre modèle disponible.",
    model_provider_timeout:
      "La requête au fournisseur du modèle a expiré. Vérifiez la connectivité et l’état de la tâche avant de poursuivre.",
    model_gateway_error:
      "La connexion au modèle a échoué. Demandez à un administrateur de vérifier le service d’exécution et la connectivité du fournisseur.",
  },
  "ja-JP": {
    model_provider_error:
      "モデルプロバイダーへのリクエストに失敗しました。タスクを続ける前に、管理者にプロバイダーと実行ログの確認を依頼してください。",
    model_provider_authentication_failed:
      "モデルプロバイダーがアクセスを拒否しました。管理者に認証情報とモデルのアクセス権限の確認を依頼してください。",
    model_provider_rate_limited:
      "モデルプロバイダーのリクエスト数または使用量の制限に達しました。しばらくしてから再試行するか、管理者に利用枠の確認を依頼してください。",
    model_provider_invalid_request:
      "モデルプロバイダーがリクエストを拒否しました。管理者にプロトコルモード、モデルの機能、リクエストの互換性の確認を依頼してください。",
    model_provider_unavailable:
      "モデルプロバイダーを一時的に利用できません。しばらくしてから再試行するか、別の利用可能なモデルを選択してください。",
    model_provider_timeout:
      "モデルプロバイダーへのリクエストがタイムアウトしました。接続とタスクの状態を確認してから続行してください。",
    model_gateway_error:
      "モデルへの接続に失敗しました。管理者に実行サービスとプロバイダーの接続状況の確認を依頼してください。",
  },
} satisfies Record<Locale, Record<ModelGatewayFailureCode, string>>
