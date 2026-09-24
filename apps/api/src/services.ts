import { assertExecutionPrincipalActive } from "./lib/execution-principal.js";
import { ApplicationDevelopmentService } from "./modules/applications/development-service.js";
import { ApplicationDevelopmentRepository } from "./modules/applications/development-repository.js";
import { ApplicationInstallationService } from "./modules/applications/installation-service.js";
import { ApplicationRuntimeGate } from "./modules/applications/runtime-gate.js";
import { ApplicationRuntimeInstallationService } from "./modules/applications/runtime-installation-service.js";
import { ApplicationCenterService } from "./modules/applications/center-service.js";
import { ApplicationDistributionRepository } from "./modules/applications/distribution-repository.js";
import { serviceWorkspaceRelativePath } from "./lib/user-runtime-paths.js";
import { createHmac } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";

import { PrismaBotChannelRepository } from "./modules/bot-channels/repository.js";
import { RedisBotChannelCoordinator } from "./modules/bot-channels/coordinator.js";
import { OfficialBotChannelClient } from "./modules/bot-channels/clients/index.js";
import { BotChannelRuntime } from "./modules/bot-channels/runtime.js";
import { BotChannelService } from "./modules/bot-channels/service.js";

import {
  isBuiltInCapabilityId,
  officialConnectionPluginFor,
  officialConnectionPlugins,
  type RuntimeMcpServer,
} from "@linksense/shared";
import { ConnectionRuntimePlugins } from "./modules/connections/runtime-plugins.js";
import { PrismaConnectionRepository } from "./modules/connections/repository.js";

import { isFullAppConfig, type AppConfig } from "./config.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { measureTaskStage } from "./lib/task-latency.js";
import type { CredentialResolution } from "./modules/credentials/types.js";
import type { LinkSenseRedis } from "./adapters/redis.js";
import type { RunnerClient } from "./adapters/runner.js";
import type { ObjectStorage } from "./adapters/object-storage.js";
import type { Mailer } from "./adapters/mailer.js";
import { SmtpMailer } from "./adapters/mailer.js";
import { AuditService } from "./modules/audit/service.js";
import {
  ConversationService,
  type ConversationPreflight,
  type CapabilityResolutionScope,
  type ExecutionCapability,
  type PersistedTurnCapability,
} from "./modules/conversations/service.js";
import { FileService } from "./modules/files/service.js";
import { ConversationEventService } from "./modules/events/service.js";
import { SystemService } from "./modules/system/service.js";
import { SystemUpdateChecker } from "./modules/system/update-checker.js";
import { AppError } from "./lib/errors.js";
import { BackgroundJobs } from "./adapters/jobs.js";
import { PasswordResetMailDeliveryQueue } from "./adapters/password-reset-mail-queue.js";
import {
  CapabilityPackageImporter,
  CapabilityService,
  ConversationSkillCreatorService,
  PrismaCapabilityStore,
  UserHomeCapabilityMaterializer,
  UserHomeCapabilityMaterializationError,
  UserHomeCapabilityPublicationDeferredError,
  UserHomeCapabilityReconciler,
  validatePluginName,
  validateSkillName,
  type MaterializeUserHomes,
  type CapabilityRuntimeVerification,
  type ReconciledUserHomeCapabilities,
  type UserHomeCapabilityPublicationGuard,
} from "./modules/capabilities/index.js";
import {
  CredentialService,
  PrismaCredentialStore,
} from "./modules/credentials/index.js";
import { PrismaUserRepository, UserService } from "./modules/users/index.js";
import { AuthenticationSettingsService } from "./modules/system/authentication-settings.js";
import { ModelProviderSettingsService } from "./modules/system/model-provider-settings.js";
import { ImageGenerationSettingsService } from "./modules/system/image-generation-settings.js";
import { VoiceTranscriptionSettingsService } from "./modules/system/voice-transcription-settings.js";
import { ImageUnderstandingSettingsService } from "./modules/system/image-understanding-settings.js";
import { KnowledgeModelSettingsService } from "./modules/system/knowledge-model-settings.js";
import { VercelAiImageUnderstandingClient } from "./modules/knowledge-processing/image-understanding-client.js";
import { LiveKnowledgeModelConfigurationProbe } from "./modules/knowledge-processing/knowledge-model-runtime.js";
import {
  VoiceTranscriptionRateLimiter,
  VoiceTranscriptionService,
} from "./modules/voice/service.js";
import { ManagedTaskTitleGenerator } from "./adapters/dashscope-title.js";
import { ProjectService } from "./modules/projects/service.js";
import { ProjectRepository } from "./modules/projects/repository.js";
import { ConversationTitleService } from "./modules/conversations/title-service.js";
import { SiteIconService } from "./modules/site-icons/service.js";
import { ExternalImageService } from "./modules/external-images/service.js";
import { TurnKnowledgeSourceStore } from "./modules/events/knowledge-source-store.js";
import { PrismaKnowledgeStore } from "./modules/knowledge/repository.js";
import { KnowledgeService } from "./modules/knowledge/service.js";
import { createTurnKnowledgeScopeResolver } from "./modules/knowledge/turn-scope.js";
import { MinioKnowledgeDocumentIngestionAdapter } from "./modules/knowledge/ingestion.js";
import { PrismaMinioKnowledgeDocumentAccessAdapter } from "./modules/knowledge/access.js";
import {
  KnowledgeDocumentEventPublisher,
  RedisKnowledgeEventSource,
} from "./modules/knowledge/events.js";
import { InternalKnowledgeSearchService } from "./modules/knowledge/internal-search.js";
import { TurnKnowledgeDocumentReferenceStore } from "./modules/knowledge/knowledge-document-ref-store.js";
import { KnowledgeTurnAssetReadService } from "./modules/knowledge/turn-asset-read.js";
import { ConversationAssetSnapshots } from "./modules/knowledge/conversation-asset-snapshots.js";
import {
  createKnowledgeProcessingRuntime,
  type KnowledgeProcessingRuntime,
} from "./modules/knowledge-processing/composition.js";
import type { OfficeConversionRuntime } from "./modules/knowledge-processing/office-converter.js";
import {
  createKnowledgeGovernanceRuntime,
  type KnowledgeGovernanceRuntime,
} from "./modules/knowledge/governance-runtime.js";
import {
  MarketplaceService,
  PrismaMarketplaceStore,
  assertMarketplacePackageIntegrity,
} from "./modules/marketplace/index.js";
import { QuotaSettingsService } from "./modules/system/quota-settings.js";
import { UsageAnalyticsService } from "./modules/usage/service.js";
import { CreditLimitService } from "./modules/usage/credit-limit.js";
import { BillingStatementService } from "./modules/usage/billing-service.js";
import { BillingStatementScheduler } from "./modules/usage/billing-scheduler.js";
import { ApplicationService } from "./modules/applications/index.js";
import { ApplicationPublicationService } from "./modules/applications/publication-service.js";
import { SharePointSettingsService } from "./modules/knowledge-sources/sharepoint-settings.js";
import { MicrosoftGraphSharePointClient } from "./modules/knowledge-sources/sharepoint-graph.js";
import { KnowledgeSourceService } from "./modules/knowledge-sources/service.js";
import { KnowledgeSourceRuntime } from "./modules/knowledge-sources/runtime.js";
import {
  McpServerService,
  PrismaMcpServerRepository,
  SdkMcpConnectionProbe,
  type RuntimeMcpRequestHeaderValue,
} from "./modules/mcp/index.js";
import { PrismaAutomationRepository } from "./modules/automations/repository.js";
import { AutomationScheduler } from "./modules/automations/scheduler.js";
import { AutomationService } from "./modules/automations/service.js";
import { CompletionNotificationService } from "./modules/completion-notifications/service.js";
import {
  FeedbackService,
  PrismaFeedbackStore,
} from "./modules/feedback/index.js";
import {
  ClawHubClient,
  RedisClawHubInstallPreviewGuard,
  ClawHubService,
  ClawHubSyncScheduler,
  PrismaClawHubStore,
} from "./modules/clawhub/index.js";
import {
  FeishuOfficialClient,
  FeishuRuntime,
  FeishuService,
  PrismaFeishuRepository,
  RedisFeishuCoordinator,
} from "./modules/feishu/index.js";
import {
  PrismaWeixinRepository,
  RedisWeixinCoordinator,
  WeixinIlinkClient,
  WeixinRuntime,
  WeixinService,
} from "./modules/weixin/index.js";
import {
  ApplicationExternalAccessService,
  decryptExternalApplicationSessionId,
} from "./modules/application-embed/service.js";
import { ConversationShareService } from "./modules/conversations/sharing.js";
import { WebSiteService } from "./modules/web-sites/service.js";
import { WebSiteRepository } from "./modules/web-sites/repository.js";
import { TaskRecoveryScheduler } from "./modules/events/recovery-scheduler.js";

const EMPTY_MCP_RUNTIME = {
  servers: [],
  generation:
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  environment: {},
  credentialUsageReceipts: [],
};

type ConversationMcpRuntimeResolver = Pick<
  McpServerService,
  | "resolveRuntime"
  | "resolveRecovery"
  | "resolveApplicationRuntime"
  | "resolveApplicationRecovery"
>;

export type AppServices = {
  config: AppConfig;
  prisma: PrismaClient;
  redis: LinkSenseRedis;
  runner: RunnerClient;
  storage: ObjectStorage;
  mailer: Mailer;
  authenticationSettings: AuthenticationSettingsService;
  modelProviderSettings: ModelProviderSettingsService;
  imageGenerationSettings: ImageGenerationSettingsService;
  voiceTranscriptionSettings: VoiceTranscriptionSettingsService;
  imageUnderstandingSettings: ImageUnderstandingSettingsService;
  knowledgeModelSettings: KnowledgeModelSettingsService | null;
  sharePointSettings: SharePointSettingsService | null;
  audit: AuditService;
  projects: ProjectService;
  conversations: ConversationService;
  conversationShares: ConversationShareService;
  webSites: WebSiteService;
  automations: AutomationService;
  completionNotifications: CompletionNotificationService;
  automationScheduler: AutomationScheduler;
  files: FileService;
  events: ConversationEventService;
  system: SystemService;
  systemUpdate: SystemUpdateChecker;
  jobs: BackgroundJobs;
  passwordResetMail: PasswordResetMailDeliveryQueue;
  capabilities: CapabilityService;
  clawHub: ClawHubService;
  clawHubScheduler: ClawHubSyncScheduler;
  skillCreator: ConversationSkillCreatorService;
  applicationDevelopment: ApplicationDevelopmentService;
  marketplace: MarketplaceService;
  applications: ApplicationService;
  applicationCenter: ApplicationCenterService;
  applicationExternalAccess: ApplicationExternalAccessService;
  credentials: CredentialService;
  mcpServers: McpServerService;
  users: UserService;
  voiceTranscription: VoiceTranscriptionService;
  voiceTranscriptionRateLimits: VoiceTranscriptionRateLimiter;
  siteIcons: SiteIconService;
  externalImages: ExternalImageService;
  knowledge: KnowledgeService | null;
  knowledgeSources: KnowledgeSourceService | null;
  knowledgeSourceRuntime: KnowledgeSourceRuntime | null;
  knowledgeSearch: InternalKnowledgeSearchService | null;
  knowledgeTurnAssets: KnowledgeTurnAssetReadService | null;
  knowledgeRuntime: KnowledgeProcessingRuntime | null;
  knowledgeGovernance: KnowledgeGovernanceRuntime | null;
  knowledgeDocumentAccess: PrismaMinioKnowledgeDocumentAccessAdapter | null;
  usageAnalytics: UsageAnalyticsService;
  creditLimits: CreditLimitService;
  quotaSettings: QuotaSettingsService;
  billingStatements: BillingStatementService;
  billingStatementScheduler: BillingStatementScheduler;
  feedback: FeedbackService;
  botChannels: BotChannelService;
  botChannelRuntime: BotChannelRuntime;
  feishu: FeishuService;
  feishuRuntime: FeishuRuntime;
  weixin: WeixinService;
  weixinRuntime: WeixinRuntime;
};

export function createServices(input: {
  config: AppConfig;
  prisma: PrismaClient;
  redis: LinkSenseRedis;
  runner: RunnerClient;
  storage: ObjectStorage;
  mailer?: Mailer;
  authenticationSettings?: AuthenticationSettingsService;
  preflight?: ConversationPreflight;
  officeRuntime?: OfficeConversionRuntime;
}): AppServices {
  const audit = new AuditService(input.prisma);
  const authenticationSettings =
    input.authenticationSettings ??
    new AuthenticationSettingsService(input.prisma, input.config);
  const modelProviderSettings = new ModelProviderSettingsService(
    input.prisma,
    input.config,
  );
  const usageAnalytics = new UsageAnalyticsService(input.prisma, {
    modelCatalog: modelProviderSettings,
  });
  const imageGenerationSettings = new ImageGenerationSettingsService(
    input.prisma,
    input.config,
    usageAnalytics,
  );
  const voiceTranscriptionSettings = new VoiceTranscriptionSettingsService(
    input.prisma,
    input.config,
  );
  const quotaSettings = new QuotaSettingsService(input.prisma);
  const creditLimits = new CreditLimitService(input.prisma, {
    timeZone: input.config.billingTimeZone,
  });
  const billingStatements = new BillingStatementService(input.prisma, {
    timeZone: input.config.billingTimeZone,
    modelCatalog: modelProviderSettings,
  });
  const billingStatementScheduler = new BillingStatementScheduler(
    input.config,
    billingStatements,
  );
  const imageUnderstandingClient = new VercelAiImageUnderstandingClient();
  const imageUnderstandingSettings = new ImageUnderstandingSettingsService(
    input.prisma,
    input.config,
    imageUnderstandingClient,
    modelProviderSettings,
  );
  const knowledgeModelSettings = isFullAppConfig(input.config)
    ? new KnowledgeModelSettingsService(
        input.prisma,
        input.config,
        new LiveKnowledgeModelConfigurationProbe(),
        modelProviderSettings,
      )
    : null;
  modelProviderSettings.registerReferenceReader(imageUnderstandingSettings);
  if (knowledgeModelSettings) {
    modelProviderSettings.registerReferenceReader(knowledgeModelSettings);
  }
  const sharePointSettings = isFullAppConfig(input.config)
    ? new SharePointSettingsService(
        input.prisma,
        input.config,
        new MicrosoftGraphSharePointClient(),
      )
    : null;
  const mailer = input.mailer ?? new SmtpMailer(authenticationSettings);
  const jobs = new BackgroundJobs(
    input.config,
    input.storage,
    input.runner,
    audit,
    undefined,
    undefined,
    input.prisma,
    input.redis,
  );
  const passwordResetMail = new PasswordResetMailDeliveryQueue(
    input.config,
    mailer,
    {
      async invalidatePasswordResetToken(tokenHash, now) {
        await input.prisma.passwordResetToken.updateMany({
          where: { tokenHash, consumedAt: null },
          data: { consumedAt: now },
        });
      },
      async invalidateRegistrationToken(tokenHash, now) {
        await input.prisma.registrationToken.updateMany({
          where: { tokenHash, consumedAt: null },
          data: { consumedAt: now },
        });
      },
    },
    audit,
  );
  let materializeUserHomes: MaterializeUserHomes = async () => {
    throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
  };
  const credentials = new CredentialService({
    store: new PrismaCredentialStore(input.prisma),
    masterKey: input.config.credentialMasterKey,
    keyId: input.config.credentialKeyId,
    materializeUserHomes: (targets) => materializeUserHomes(targets),
  });
  const mcpServers = new McpServerService(
    new PrismaMcpServerRepository(input.prisma),
    audit,
    input.config.credentialMasterKey,
    input.config.credentialKeyId,
    new SdkMcpConnectionProbe(),
    () => new Date(),
    { probe: (probeInput) => input.runner.probeStdioMcp(probeInput) },
  );
  const capabilityMaterializer = new UserHomeCapabilityMaterializer({
    userDataRoot: input.config.userDataRoot,
    managedBrowserEnabled: input.config.managedBrowserEnabled,
    publicationGuard: createStartingTurnCapabilityPublicationGuard(input.prisma),
    snapshotPruneGuard: createRunningTurnCapabilityPublicationGuard(input.prisma),
  });
  const databasePreflight = new DatabaseConversationPreflight(
    input.prisma,
    credentials,
    input.config.capabilityRoot,
    input.config.credentialMasterKey,
    capabilityMaterializer,
    mcpServers,
    input.config.credentialMasterKey,
    new ConnectionRuntimePlugins(new PrismaConnectionRepository(input.prisma)),
  );
  const userHomeReconciler = new UserHomeCapabilityReconciler({
    loadCapabilityOwnerIds: async (capabilityIds) => {
      const capabilities = await input.prisma.capability.findMany({
        where: { id: { in: [...capabilityIds] } },
        select: { ownerId: true },
      });
      return capabilities.map((capability) => capability.ownerId);
    },
    resolveActiveUserIds: async (userIds) => {
      const candidates = [...new Set(userIds)];
      if (candidates.length === 0) return [];
      return (
        await input.prisma.user.findMany({
          where: {
            id: { in: candidates },
            status: "active",
          },
          select: { id: true },
        })
      ).map((user) => user.id);
    },
    // Capability changes affect future turns. Do not rewrite any existing
    // task projection while publishing a personal catalog or credential change.
    reconcileUser: (userId) => databasePreflight.ensureUserHome(userId),
  });
  materializeUserHomes = (targets) => userHomeReconciler.reconcile(targets);
  const preflight = input.preflight ?? databasePreflight;
  const clawHubServiceRef: { current: ClawHubService | null } = {
    current: null,
  };
  const capabilities = new CapabilityService({
    store: new PrismaCapabilityStore(input.prisma),
    importer: new CapabilityPackageImporter({
      stagingRoot: join(input.config.capabilityRoot, ".staging"),
    }),
    capabilityRoot: input.config.capabilityRoot,
    managedBrowserEnabled: input.config.managedBrowserEnabled,
    logoStore: {
      put: (objectKey, bytes, contentType) =>
        input.storage.putObject(objectKey, bytes, {
          "content-type": contentType,
        }),
      remove: (objectKey) => input.storage.removeObject(objectKey),
      presignGet: (objectKey, expiresSeconds) =>
        input.storage.presignedGetObject(objectKey, expiresSeconds),
      enqueueRemoval: (objectKey) => jobs.enqueueObjectDelete(objectKey),
    },
    packageCleanup: {
      enqueueDirectoryRemoval: (absolutePath) =>
        jobs.enqueueDirectoryRemoval(absolutePath),
    },
    materializeUserHomes: (targets) => materializeUserHomes(targets),
    validateClawHubInstall: async (actor, origin) => {
      if (clawHubServiceRef.current === null) {
        throw new AppError("CLAWHUB_SERVICE_UNAVAILABLE");
      }
      await clawHubServiceRef.current.validateInstallConfirmation(
        actor,
        origin,
      );
    },
  });
  const clawHub = new ClawHubService({
    store: new PrismaClawHubStore(input.prisma, {
      transactionTimeoutMs: input.config.clawHubSyncTransactionTimeoutMs,
    }),
    client: new ClawHubClient(),
    capabilityInstaller: capabilities,
    installPreviewGuard: new RedisClawHubInstallPreviewGuard(input.redis),
  });
  clawHubServiceRef.current = clawHub;
  const clawHubScheduler = new ClawHubSyncScheduler(
    {
      redisUrl: input.config.redisUrl,
      timeZone: input.config.clawHubSyncTimeZone,
    },
    clawHub,
  );
  const skillCreator = new ConversationSkillCreatorService({
    prisma: input.prisma,
    capabilities,
    workspaceRoot: input.config.workspaceRoot,
    tokenSecret: input.config.runnerSharedSecret,
  });
  const marketplace = new MarketplaceService({
    store: new PrismaMarketplaceStore(input.prisma),
    capabilityInstaller: capabilities,
    capabilityRoot: input.config.capabilityRoot,
    logoStore: {
      read: async (objectKey) =>
        streamToBuffer(await input.storage.getObjectStream(objectKey)),
      put: (objectKey, bytes, contentType) =>
        input.storage.putObject(objectKey, bytes, {
          "content-type": contentType,
        }),
      remove: (objectKey) => input.storage.removeObject(objectKey),
      presignGet: (objectKey, expiresSeconds) =>
        input.storage.presignedGetObject(objectKey, expiresSeconds),
    },
  });
  const users = new UserService({
    persistence: new PrismaUserRepository(input.prisma),
    avatarStorage: input.storage,
    avatarCleanup: {
      scheduleObjectRemoval: (objectKey) => jobs.enqueueObjectDelete(objectKey),
    },
    lifecycleCoordinator: input.redis,
    creditLimitDefaults: quotaSettings,
    creditQuotaUsage: creditLimits,
    materializeUserHomes: (userIds) => materializeUserHomes({ userIds }),
    visitorProfile: async userId => {
      const session = await input.prisma.applicationExternalSession.findUnique({ where: { runtimePrincipalId: userId } });
      if (!session) return null;
      await assertExecutionPrincipalActive(input.prisma, userId);
      return { ...session, id: userId };
    },
  });
  const voiceTranscription = new VoiceTranscriptionService(
    voiceTranscriptionSettings,
  );
  const voiceTranscriptionRateLimits = new VoiceTranscriptionRateLimiter(
    input.redis,
  );
  const siteIcons = new SiteIconService(input.redis, {
    allowBenchmarkProxyAddresses:
      input.config.safeHttp.allowBenchmarkProxyAddresses,
  });
  const externalImages = new ExternalImageService({
    allowBenchmarkProxyAddresses:
      input.config.safeHttp.allowBenchmarkProxyAddresses,
  });
  const knowledgeStore = new PrismaKnowledgeStore(input.prisma);
  const applicationAssets: import("./modules/applications/service.js").InteractiveApplicationAssetStore = {
      put: (objectKey, bytes, contentType) =>
        input.storage.putObject(objectKey, bytes, {
          "content-type": contentType,
        }),
      get: (objectKey) => input.storage.getObjectStream(objectKey),
      remove: (objectKey) => input.storage.removeObject(objectKey),
    };
  const applicationPublications = new ApplicationPublicationService(input.prisma, input.config.capabilityRoot, applicationAssets);
  const applicationRuntimeGate = new ApplicationRuntimeGate(input.prisma, input.redis,
    async (ownerId, conversationId) => { await input.runner.closeRuntimeProcess(conversationId, ownerId); });
  const applicationRuntimeInstallations = new ApplicationRuntimeInstallationService(input.prisma, applicationPublications, applicationRuntimeGate);
  const applications = new ApplicationService(
    input.prisma,
    modelProviderSettings,
    audit,
    credentials,
    {
      put: (objectKey, bytes, contentType) =>
        input.storage.putObject(objectKey, bytes, {
          "content-type": contentType,
        }),
      remove: (objectKey) => input.storage.removeObject(objectKey),
      presignGet: (objectKey, expiresSeconds) =>
        input.storage.presignedGetObject(objectKey, expiresSeconds),
      enqueueRemoval: (objectKey) => jobs.enqueueObjectDelete(objectKey),
    },
    applicationAssets,
    applicationPublications,
    new ApplicationInstallationService(input.prisma, input.config.capabilityRoot, applicationPublications, applicationRuntimeGate, credentials),
    applicationRuntimeInstallations,
  );
  const applicationCenter = new ApplicationCenterService(new ApplicationDistributionRepository(input.prisma), applicationPublications, audit, applications);
  const knowledgeSources = new TurnKnowledgeSourceStore(input.redis.client);
  const knowledgeDocumentReferences = new TurnKnowledgeDocumentReferenceStore(
    input.redis.client,
  );
  let knowledge: KnowledgeService | null = null;
  let knowledgeSourceService: KnowledgeSourceService | null = null;
  let knowledgeSourceRuntime: KnowledgeSourceRuntime | null = null;
  let knowledgeSearch: InternalKnowledgeSearchService | null = null;
  const knowledgeTurnAssets = new KnowledgeTurnAssetReadService(input.prisma, input.storage);
  let knowledgeRuntime: KnowledgeProcessingRuntime | null = null;
  let knowledgeGovernance: KnowledgeGovernanceRuntime | null = null;
  let knowledgeDocumentAccess: PrismaMinioKnowledgeDocumentAccessAdapter | null =
    null;

  if (isFullAppConfig(input.config)) {
    if (!knowledgeModelSettings || !sharePointSettings) {
      throw new Error("Full knowledge services were not initialized");
    }
    const knowledgeEventPublisher = new KnowledgeDocumentEventPublisher(
      input.prisma,
      input.redis.client,
    );
    const knowledgeMaintenanceRecovery = {
      current: null as null | (() => void),
    };
    knowledgeRuntime = createKnowledgeProcessingRuntime({
      config: input.config,
      ...(input.officeRuntime ? { officeRuntime: input.officeRuntime } : {}),
      prisma: input.prisma,
      eventPublisher: knowledgeEventPublisher,
      imageUnderstandingSettings,
      imageUnderstandingClient,
      knowledgeModelSettings,
      modelProviderSettings,
      usageRecorder: usageAnalytics,
      onDocumentRebuildActivated: () =>
        knowledgeMaintenanceRecovery.current?.(),
    });
    knowledgeGovernance = createKnowledgeGovernanceRuntime({
      prisma: input.prisma,
      redisUrl: input.config.redisUrl,
      scheduler: knowledgeRuntime.scheduler,
      maintenanceGate: knowledgeRuntime.maintenanceGate,
      maintenanceRebuildConcurrency:
        input.config.knowledge.concurrency.maintenanceRebuild,
      currentEmbeddingProfileHash:
        knowledgeRuntime.currentEmbeddingProfileHash,
      elasticsearch: knowledgeRuntime.elasticsearch,
      objectStore: knowledgeRuntime.objectStore,
    });
    knowledgeMaintenanceRecovery.current = () =>
      knowledgeGovernance?.maintenanceWorker.requestFailedTaskRecovery();
    knowledgeDocumentAccess =
      new PrismaMinioKnowledgeDocumentAccessAdapter(
        input.prisma,
        knowledgeRuntime.objectStore,
      );
    knowledge = new KnowledgeService({
      store: knowledgeStore,
      ingestionAdapter: new MinioKnowledgeDocumentIngestionAdapter(
        knowledgeRuntime.objectStore,
      ),
      scheduler: knowledgeRuntime.scheduler,
      documentAccessAdapter: knowledgeDocumentAccess,
      eventSource: new RedisKnowledgeEventSource(input.prisma, input.redis),
      eventSink: knowledgeEventPublisher,
      maintenanceGate: knowledgeRuntime.maintenanceGate,
      currentEmbeddingProfileHash:
        knowledgeRuntime.currentEmbeddingProfileHash,
      maxFileSizeBytes: input.config.knowledge.upload.maxFileSizeBytes,
      maxFilesPerBatch: input.config.knowledge.upload.maxFilesPerBatch,
      storageQuotaBytes: BigInt(
        input.config.knowledge.upload.storageQuotaBytes,
      ),
    });
    const knowledgeSourceServiceRef: {
      current: KnowledgeSourceService | null;
    } = { current: null };
    knowledgeSourceRuntime = new KnowledgeSourceRuntime(
      input.config.redisUrl,
      input.prisma,
      async (sourceId, trigger): Promise<void> => {
        const service = knowledgeSourceServiceRef.current;
        if (!service) throw new Error("KNOWLEDGE_SOURCE_SYNC_UNAVAILABLE");
        await service.processSync(sourceId, trigger);
      },
    );
    knowledgeSourceService = new KnowledgeSourceService(
      input.prisma,
      sharePointSettings,
      {
        async create() {
          return new MicrosoftGraphSharePointClient(
            await sharePointSettings.resolveRuntime(),
          );
        },
      },
      knowledge,
      knowledgeSourceRuntime,
    );
    knowledgeSourceServiceRef.current = knowledgeSourceService;
    const turnKnowledgeScopes = createTurnKnowledgeScopeResolver(
      knowledge,
      applications,
    );
    knowledgeSearch = new InternalKnowledgeSearchService(
      input.prisma,
      turnKnowledgeScopes,
      knowledgeRuntime.retrieval,
      knowledgeSources,
      knowledgeDocumentReferences,
      new ConversationAssetSnapshots(
        input.prisma,
        input.storage,
        knowledgeDocumentAccess,
        turnKnowledgeScopes,
        jobs,
      ),
      knowledgeRuntime.maintenanceGate,
    );
  }
  const conversationTitles = new ConversationTitleService(
    input.prisma,
    input.redis,
    new ManagedTaskTitleGenerator(modelProviderSettings),
    usageAnalytics,
    input.runner,
  );
  const system = new SystemService(
    input.prisma,
    input.redis,
    input.runner,
    input.storage,
    mailer,
    audit,
    input.config,
    jobs,
    authenticationSettings,
    knowledgeRuntime?.health,
  );
  const conversations = new ConversationService(
    input.prisma,
    input.redis,
    input.runner,
    audit,
    preflight,
    input.config.workspaceRoot,
    jobs,
    knowledgeStore,
    modelProviderSettings,
    applications,
    creditLimits,
    system,
    conversationTitles,
    async (ownerId, conversationId) => {
      const project = await input.prisma.applicationDevelopment.findFirst({ where: { ownerId, conversationId }, select: { name: true, directory: true } });
      return project ? `This conversation develops a LinkSense interactive application. Use the linksense-interactive-app-builder Skill and inspect_application_development tool. Edit the existing project files described by this untrusted metadata: ${JSON.stringify(project)}. The adjacent preview follows the deployable directory. Keep development work in this conversation and business tests in the separate preview task.` : null;
    },
  );
  jobs.registerConversationPrewarmProcessor((job) =>
    conversations.executePrewarm(job),
  );
  const conversationShares = new ConversationShareService(
    input.prisma,
    conversations,
  );
  const applicationExternalAccess = new ApplicationExternalAccessService(
    input.prisma,
    input.redis,
    audit,
    input.storage,
    input.config.publicBaseUrl,
    input.config.credentialMasterKey,
    input.config.credentialKeyId,
    (ownerId, application, conversationId) =>
      conversations.createExternalApplicationConversation(ownerId, {
        ...application,
        kind: "standard",
        interactivePackageId: null,
      }, conversationId),
    (ownerId, conversationId, context = {}, deletionReason = "creation-failed") =>
      conversations.delete(ownerId, conversationId, context, deletionReason),
    (conversationId) => conversationTitles.schedule(conversationId),
  );
  const botChannelRepository = new PrismaBotChannelRepository(input.prisma);
  const botChannelCoordinator = new RedisBotChannelCoordinator(input.redis.client);
  const botChannelEncryption = {
    masterKey: input.config.credentialMasterKey,
    keyId: input.config.credentialKeyId,
  };
  const botChannelClient = new OfficialBotChannelClient(
    input.redis.client,
    botChannelEncryption,
  );
  const botChannelRuntime = new BotChannelRuntime(
    botChannelRepository,
    botChannelCoordinator,
    botChannelClient,
    conversations,
    botChannelEncryption,
  );
  const botChannels = new BotChannelService(
    botChannelRepository,
    botChannelCoordinator,
    audit,
    botChannelEncryption,
    botChannelRuntime,
    input.config.publicBaseUrl,
  );
  const feishuRepository = new PrismaFeishuRepository(input.prisma);
  const feishuCoordinator = new RedisFeishuCoordinator(input.redis.client);
  const feishuClient = new FeishuOfficialClient();
  const feishuEncryption = {
    masterKey: input.config.credentialMasterKey,
    keyId: input.config.credentialKeyId,
  };
  const feishuRuntime = new FeishuRuntime(
    feishuRepository,
    feishuCoordinator,
    feishuClient,
    conversations,
    feishuEncryption,
  );
  const feishu = new FeishuService(
    feishuRepository,
    feishuCoordinator,
    feishuClient,
    audit,
    feishuEncryption,
    feishuRuntime,
  );
  const weixinRepository = new PrismaWeixinRepository(input.prisma);
  const weixinCoordinator = new RedisWeixinCoordinator(input.redis.client);
  const weixinClient = new WeixinIlinkClient();
  const weixinEncryption = {
    masterKey: input.config.credentialMasterKey,
    keyId: input.config.credentialKeyId,
  };
  const weixinRuntime = new WeixinRuntime(
    weixinRepository,
    weixinCoordinator,
    weixinClient,
    conversations,
    weixinEncryption,
  );
  const weixin = new WeixinService(
    weixinRepository,
    weixinCoordinator,
    weixinClient,
    applications,
    audit,
    weixinEncryption,
    weixinRuntime,
  );
  const automations = new AutomationService(
    new PrismaAutomationRepository(input.prisma),
    conversations,
    audit,
  );
  const completionNotifications = new CompletionNotificationService(
    input.prisma,
  );
  const automationScheduler = new AutomationScheduler(
    input.config,
    automations,
  );
  const files = new FileService(
    input.prisma,
    conversations,
    input.storage,
    audit,
    input.config,
    input.redis,
    jobs,
  );
  const feedback = new FeedbackService({
    store: new PrismaFeedbackStore(input.prisma),
    storage: input.storage,
    cleanup: {
      scheduleObjectRemoval: (objectKey) => jobs.enqueueObjectDelete(objectKey),
    },
    audit,
  });
  const events = new ConversationEventService(
    input.prisma,
    input.redis,
    conversations,
    conversationTitles,
    knowledgeSources,
    usageAnalytics,
  );
  events.configureRecoveryScheduler(new TaskRecoveryScheduler(
    input.config, input.prisma, input.redis, events, conversations,
  ));
  const systemUpdate = new SystemUpdateChecker(
    input.config.releaseVersion,
    input.redis,
  );
  return {
    ...input,
    projects: new ProjectService(new ProjectRepository(input.prisma)),
    mailer,
    authenticationSettings,
    modelProviderSettings,
    imageGenerationSettings,
    voiceTranscriptionSettings,
    imageUnderstandingSettings,
    knowledgeModelSettings,
    sharePointSettings,
    audit,
    conversations,
    conversationShares,
    webSites: new WebSiteService(new WebSiteRepository(input.prisma), input.storage),
    automations,
    completionNotifications,
    automationScheduler,
    files,
    events,
    system,
    systemUpdate,
    jobs,
    passwordResetMail,
    capabilities,
    clawHub,
    clawHubScheduler,
    skillCreator,
    applicationDevelopment: new ApplicationDevelopmentService({
      store: new ApplicationDevelopmentRepository(input.prisma), applications, conversations,
      assets: { get: (key) => input.storage.getObjectStream(key) }, workspaceRoot: input.config.workspaceRoot,
    }),
    marketplace,
    applications,
    applicationCenter,
    applicationExternalAccess,
    credentials,
    mcpServers,
    users,
    voiceTranscription,
    voiceTranscriptionRateLimits,
    siteIcons,
    externalImages,
    knowledge,
    knowledgeSources: knowledgeSourceService,
    knowledgeSourceRuntime,
    knowledgeSearch,
    knowledgeTurnAssets,
    knowledgeRuntime,
    knowledgeGovernance,
    knowledgeDocumentAccess,
    usageAnalytics,
    creditLimits,
    quotaSettings,
    billingStatements,
    billingStatementScheduler,
    feedback,
    botChannels,
    botChannelRuntime,
    feishu,
    feishuRuntime,
    weixin,
    weixinRuntime,
  };
}

export class DatabaseConversationPreflight implements ConversationPreflight {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly credentials: CredentialService,
    private readonly capabilityRoot: string,
    private readonly credentialSourceSecret: string,
    private readonly capabilityMaterializer: Pick<
      UserHomeCapabilityMaterializer,
      | "ensureOwner"
      | "reconcile"
      | "reconcileWithinPublicationStartFence"
      | "resolvePublishedRuntimeWithinPublicationStartFence"
      | "withPublicationStartFence"
      | "withPublishedRuntime"
      | "withVerifiedRuntime"
    >,
    private readonly mcpServers: ConversationMcpRuntimeResolver = {
      resolveRuntime: async () => EMPTY_MCP_RUNTIME,
      resolveRecovery: async () => ({ environment: {} }),
      resolveApplicationRuntime: async () => EMPTY_MCP_RUNTIME,
      resolveApplicationRecovery: async () => ({ environment: {} }),
    },
    private readonly externalApplicationSessionIdMasterKey: string | null =
      null,
    private readonly connectionPlugins: Pick<ConnectionRuntimePlugins, "resolve"> = {
      resolve: async () => [],
    },
  ) {}

  async ensureUserHome(userId: string, serviceSessionId?: string): Promise<void> {
    await this.capabilityMaterializer.ensureOwner(userId, serviceSessionId);
  }

  async resolve(input: {
    userId: string;
    conversationId: string;
    priorityCapabilityIds: string[];
    capabilityScope?: CapabilityResolutionScope;
  }) {
    try {
      return await measureTaskStage("capability_resolution", () => this.#resolveAndPublish(input, true));
    } catch (error) {
      if (
        error instanceof UserHomeCapabilityMaterializationError ||
        error instanceof UserHomeCapabilityPublicationDeferredError
      ) {
        throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
      }
      throw error;
    }
  }

  async #resolveAndPublish(input: {
    userId: string;
    conversationId: string;
    priorityCapabilityIds: string[];
    capabilityScope?: CapabilityResolutionScope;
  }, preferPublishedRuntime = false) {
    return this.capabilityMaterializer.withPublicationStartFence(
      { ownerId: input.userId, conversationId: input.conversationId, ...(input.capabilityScope?.serviceSessionId ? { serviceSessionId: input.capabilityScope.serviceSessionId } : {}) },
      async () => {
        const [catalog, mcpRuntime] = await Promise.all([
          this.#resolveCatalog(input),
          input.capabilityScope
            ? this.#resolveApplicationMcpRuntime(
                input.userId,
                input.capabilityScope,
              )
            : this.mcpServers.resolveRuntime(input.userId),
        ]);
        let materialized: ReconciledUserHomeCapabilities;
        try {
          const materializationInput = {
            ownerId: input.userId,
            conversationId: input.conversationId,
            ...(input.capabilityScope?.serviceSessionId ? { serviceSessionId: input.capabilityScope.serviceSessionId } : {}),
            capabilities: catalog.materializationCapabilities,
          };
          materialized = preferPublishedRuntime
            ? await this.capabilityMaterializer.resolvePublishedRuntimeWithinPublicationStartFence(
                materializationInput,
              )
            : await this.capabilityMaterializer.reconcileWithinPublicationStartFence(
                materializationInput,
              );
        } catch (error) {
          if (
            error instanceof UserHomeCapabilityMaterializationError ||
            error instanceof UserHomeCapabilityPublicationDeferredError
          ) {
            throw error;
          }
          throw new UserHomeCapabilityMaterializationError(
            "failed to materialize user capabilities",
            { cause: error },
          );
        }
        return {
          capabilities: catalog.executionCapabilities,
          capabilityGeneration: materialized.generation,
          capabilityVerification: materialized.verification,
          mcpServers: mcpRuntime.servers,
          mcpGeneration: mcpRuntime.generation,
          environment: {
            ...catalog.environment,
            ...mcpRuntime.environment,
          },
          credentialUsageReceipts: catalog.credentialUsageReceipts,
          mcpCredentialUsageReceipts: mcpRuntime.credentialUsageReceipts,
        };
      },
    );
  }

  async #resolveCatalog(input: {
    userId: string;
    priorityCapabilityIds: string[];
    capabilityScope?: CapabilityResolutionScope;
  }) {
    // Application tasks use their published catalog. They must never inherit
    // a publisher's personal Microsoft account from this runtime extension.
    const connections = input.capabilityScope ? [] : await this.connectionPlugins.resolve(input.userId);
    const activeCapabilities = await this.prisma.capability.findMany({
      where: {
        status: "active",
        ownerId: input.capabilityScope?.sourceOwnerId ?? input.userId,
        ...(input.capabilityScope
          ? { id: { in: input.capabilityScope.capabilityIds } }
          : {}),
      },
    });
    const capabilities = activeCapabilities.map(capability => {
      const frozen = input.capabilityScope?.source === "published"
        ? input.capabilityScope.publishedCapabilities.find(snapshot => snapshot.id === capability.id)
        : undefined;
      if (input.capabilityScope?.source === "published" && !frozen) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
      if (frozen?.sourceType === "marketplace" && (!frozen.marketplaceListingId || !frozen.marketplaceReleaseId)) throw new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE");
      return frozen ? { ...capability, name: frozen.name, description: frozen.description, type: frozen.type, sourceType: frozen.sourceType,
        marketplaceListingId: frozen.marketplaceListingId ?? null, marketplaceReleaseId: frozen.marketplaceReleaseId ?? null,
        storagePath: frozen.storagePath, updatedAt: new Date(frozen.revision),
        manifestJson: frozen.manifestJson, riskSummaryJson: frozen.riskSummaryJson,
      } : capability;
    });
    const preferences = input.capabilityScope
      ? []
      : await this.prisma.capabilityUserPreference.findMany({
          where: {
            userId: input.userId,
            capabilityId: {
              in: capabilities.map((capability) => capability.id),
            },
            status: "disabled",
          },
          select: { capabilityId: true },
        });
    const disabled = new Set(
      preferences.map((preference) => preference.capabilityId),
    );
    const runnableCapabilities =
      await this.#filterRunnableMarketplaceCapabilities(capabilities);
    const visible = runnableCapabilities
      .filter((capability) => !disabled.has(capability.id))
      .sort((left, right) => left.id.localeCompare(right.id));
    const visibleSkillNames = new Set<string>();
    const visiblePluginNames = new Set<string>();
    for (const capability of visible) {
      if (capability.type !== "skill" && capability.type !== "plugin") continue;
      // Package validation is repeated at this trust boundary so invalid
      // persisted records cannot poison every runner start with an opaque 503.
      const visibleNames =
        capability.type === "skill" ? visibleSkillNames : visiblePluginNames;
      if (capability.type === "skill") {
        validateSkillName(capability.name);
      } else {
        validatePluginName(capability.name);
      }
      if (visibleNames.has(capability.name) || officialConnectionPlugins.some(
        (plugin) => capability.id === plugin.id ||
          (capability.type === "plugin" && capability.name === plugin.name),
      )) {
        // Fail closed if persisted ownership data contains duplicate package
        // names that would make the user's Codex capability catalog ambiguous.
        throw new AppError("CONFLICT");
      }
      visibleNames.add(capability.name);
    }
    const visibleIds = new Set([...visible, ...connections].map((capability) => capability.id));
    if (
      input.priorityCapabilityIds.some((id) =>
        isBuiltInCapabilityId(id)
          ? input.capabilityScope !== undefined
          : !visibleIds.has(id),
      ) ||
      (input.capabilityScope &&
        input.capabilityScope.capabilityIds.some((id) => !visibleIds.has(id)))
    ) {
      throw new AppError(
        input.capabilityScope
          ? "APPLICATION_DEPENDENCY_UNAVAILABLE"
          : "CAPABILITY_NOT_FOUND",
      );
    }
    const environment: Record<string, string> = {};
    const capabilityCredentialEnvironment = new Map<
      string,
      Record<string, string>
    >();
    const capabilityCredentialFingerprints = new Map<string, string>();
    const unavailablePluginIds = new Set<string>();
    const credentialUsageReceipts: Array<{
      userId: string;
      capabilityId: string;
      credentialIds: string[];
    }> = [];
    const credentialRequests = visible.filter(capability => capability.type === "plugin").map(capability => ({
      capabilityId: capability.id,
      ...(input.capabilityScope ? { requiredEnvironmentKeys: declaredPluginCredentialKeys(capability.riskSummaryJson) } : {}),
    }));
    const credentialResolutions = credentialRequests.length
      ? await this.credentials.resolveForCapabilities(input.capabilityScope?.sourceOwnerId ?? input.userId, credentialRequests)
      : new Map<string, CredentialResolution>();
    for (const capability of visible) {
      if (capability.type !== "plugin") continue;
      const resolution = credentialResolutions.get(capability.id);
      if (!resolution) throw new AppError("CREDENTIAL_BINDING_REQUIRED");
      if (!resolution.ok) {
        if (input.priorityCapabilityIds.includes(capability.id)) {
          throw new AppError(
            resolution.blockCode === "credential_binding_ambiguous"
              ? "CREDENTIAL_BINDING_CONFLICT"
              : "CREDENTIAL_BINDING_REQUIRED",
          );
        }
        unavailablePluginIds.add(capability.id);
        continue;
      }
      credentialUsageReceipts.push(
        input.capabilityScope
          ? { ...resolution.usageReceipt, userId: input.userId }
          : resolution.usageReceipt,
      );
      if (
        Object.keys(resolution.environment).length > 0 &&
        !hasPluginMcpServer(capability.manifestJson)
      ) {
        throw new AppError("EXECUTION_ENVIRONMENT_INVALID");
      }
      const credentialEnvironment: Record<string, string> = {};
      for (const [key, value] of Object.entries(resolution.environment)) {
        if (isReservedExecutionEnvironmentKey(key)) {
          throw new AppError("CREDENTIAL_BINDING_CONFLICT");
        }
        const source = credentialSourceEnvironmentName(
          this.credentialSourceSecret,
          input.userId,
          capability.id,
          key,
        );
        environment[source] = value;
        credentialEnvironment[key] = source;
      }
      if (Object.keys(credentialEnvironment).length > 0) {
        capabilityCredentialEnvironment.set(
          capability.id,
          credentialEnvironment,
        );
        capabilityCredentialFingerprints.set(
          capability.id,
          fingerprintCredentialEnvironment(
            this.credentialSourceSecret,
            input.userId,
            capability.id,
            resolution.environment,
          ),
        );
      }
    }
    const executionCapabilities: ExecutionCapability[] = [...connections];
    const materializationCapabilities: Array<{
      id: string;
      type: "plugin" | "skill";
      sourcePath: string;
      revision: string;
      name: string;
      credentialEnvironment?: Record<string, string>;
      credentialFingerprint?: string;
    }> = connections.map(({ id, type, sourcePath, revision, name }) => ({ id, type, sourcePath, revision, name }));
    for (const capability of visible) {
      if (capability.type !== "plugin" && capability.type !== "skill") continue;
      if (
        capability.type === "plugin" &&
        unavailablePluginIds.has(capability.id)
      ) {
        continue;
      }
      const credentialEnvironment = capabilityCredentialEnvironment.get(
        capability.id,
      );
      const credentialFingerprint = capabilityCredentialFingerprints.get(
        capability.id,
      );
      const storagePath = resolveCapabilityPath(
        this.capabilityRoot,
        capability.storagePath,
      );
      const runtimeCapability = {
        id: capability.id,
        type: capability.type,
        sourcePath: storagePath,
        revision: capability.updatedAt.toISOString(),
        ...(credentialEnvironment ? { credentialEnvironment } : {}),
        ...(credentialFingerprint ? { credentialFingerprint } : {}),
        name: capability.name,
      } satisfies (typeof materializationCapabilities)[number];
      materializationCapabilities.push(runtimeCapability);
      executionCapabilities.push({
        ...runtimeCapability,
        description: capability.description,
        sourceType: capability.sourceType,
        sourceOwnerId: capability.ownerId,
      });
    }
    return {
      executionCapabilities,
      materializationCapabilities,
      environment,
      credentialUsageReceipts,
    };
  }

  async withCapabilityStartBarrier<T>(
    input: {
      userId: string;
      conversationId: string;
      priorityCapabilityIds: string[];
      capabilities: ExecutionCapability[];
      capabilityGeneration: string;
      capabilityVerification: CapabilityRuntimeVerification;
      mcpServers?: RuntimeMcpServer[];
      mcpGeneration?: string;
      environment: Record<string, string>;
      credentialUsageReceipts: Array<{
        userId: string;
        capabilityId: string;
        credentialIds: string[];
      }>;
      mcpCredentialUsageReceipts?: Array<{ serverId: string }>;
      capabilityScope?: CapabilityResolutionScope;
    },
    action: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.capabilityMaterializer.withPublishedRuntime(
        {
          ownerId: input.userId,
          conversationId: input.conversationId,
          ...(input.capabilityScope?.serviceSessionId ? { serviceSessionId: input.capabilityScope.serviceSessionId } : {}),
          verification: input.capabilityVerification,
          capabilities: input.capabilities.map((capability) => ({
            id: capability.id,
            name: capability.name,
            type: capability.type,
            sourcePath: capability.sourcePath,
            revision: capability.revision,
            ...(capability.credentialEnvironment
              ? {
                  credentialEnvironment: capability.credentialEnvironment,
                }
              : {}),
            ...(capability.credentialFingerprint
              ? {
                  credentialFingerprint: capability.credentialFingerprint,
                }
              : {}),
          })),
        },
        async () => {
          const [current, currentMcp] = await Promise.all([
            this.#resolveCatalog({
              userId: input.userId,
              priorityCapabilityIds: input.priorityCapabilityIds,
              ...(input.capabilityScope
                ? { capabilityScope: input.capabilityScope }
                : {}),
            }),
            input.capabilityScope
              ? this.#resolveApplicationMcpRuntime(
                  input.userId,
                  input.capabilityScope,
                )
              : this.mcpServers.resolveRuntime(input.userId),
          ]);
          if (
            !matchesResolvedCapabilityState(
              {
                capabilities: input.capabilities,
                environment: input.environment,
                credentialUsageReceipts: input.credentialUsageReceipts,
              },
              {
                capabilities: current.executionCapabilities,
                environment: {
                  ...current.environment,
                  ...currentMcp.environment,
                },
                credentialUsageReceipts: current.credentialUsageReceipts,
              },
            ) ||
            input.mcpGeneration !== currentMcp.generation ||
            JSON.stringify(input.mcpServers ?? []) !==
              JSON.stringify(currentMcp.servers) ||
            JSON.stringify(input.mcpCredentialUsageReceipts ?? []) !==
              JSON.stringify(currentMcp.credentialUsageReceipts)
          ) {
            throw new AppError("CONFLICT");
          }
          return action();
        },
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (
        error instanceof UserHomeCapabilityMaterializationError ||
        error instanceof UserHomeCapabilityPublicationDeferredError
      ) {
        throw new AppError("CAPABILITY_HOME_SYNC_FAILED");
      }
      throw error;
    }
  }

  async resolveStartIntentRecovery(input: {
    userId: string;
    capabilities: PersistedTurnCapability[];
    mcpServers?: RuntimeMcpServer[];
    applicationId?: string;
  }): Promise<{ environment: Record<string, string> }> {
    const capabilityIds = input.capabilities.map((capability) => capability.id);
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      throw new AppError("CAPABILITY_NOT_FOUND");
    }
    const installed = input.capabilities.filter((capability) => !officialConnectionPluginFor(capability));
    const installedIds = installed.map((capability) => capability.id);
    if (installedIds.length > 0) {
      const personallyOwnedIds = installed
        .filter(
          (capability) =>
            (capability.sourceOwnerId ?? input.userId) === input.userId,
        )
        .map((capability) => capability.id);
      const [activeCapabilities, disabledPreferences] = await Promise.all([
        this.prisma.capability.findMany({
          where: {
            id: { in: installedIds },
            status: "active",
          },
          select: {
            id: true,
            ownerId: true,
            sourceType: true,
            marketplaceListingId: true,
            marketplaceReleaseId: true,
            storagePath: true,
          },
        }),
        this.prisma.capabilityUserPreference.findMany({
          where: {
            userId: input.userId,
            capabilityId: { in: personallyOwnedIds },
            status: "disabled",
          },
          select: { capabilityId: true },
        }),
      ]);
      const activeById = new Map(
        (
          await this.#filterRunnableMarketplaceCapabilities(activeCapabilities)
        ).map((capability) => [capability.id, capability]),
      );
      const disabledIds = new Set(
        disabledPreferences.map((preference) => preference.capabilityId),
      );
      if (
        installed.some((capability) => {
          const active = activeById.get(capability.id);
          return (
            !active ||
            active.ownerId !== (capability.sourceOwnerId ?? input.userId) ||
            disabledIds.has(capability.id)
          );
        })
      ) {
        throw new AppError("CAPABILITY_NOT_FOUND");
      }
    }
    return this.resolveRecovery(input);
  }

  async #resolveApplicationMcpRuntime(
    userId: string,
    scope: CapabilityResolutionScope,
  ) {
    return this.mcpServers.resolveApplicationRuntime(
      scope.sourceOwnerId,
      scope.mcpServerIds,
      await this.#resolveApplicationMcpRequestHeaders(
        userId,
        scope.applicationId,
      ),
    );
  }

  async #resolveApplicationMcpRequestHeaders(
    userId: string,
    applicationId: string | undefined,
  ): Promise<RuntimeMcpRequestHeaderValue[]> {
    if (
      !applicationId ||
      this.externalApplicationSessionIdMasterKey === null
    ) {
      return [];
    }
    const session = await this.prisma.applicationExternalSession.findUnique({
      where: { runtimePrincipalId: userId },
      select: {
        id: true,
        applicationId: true,
        status: true,
        absoluteExpiresAt: true,
        externalApplicationSessionIdEncrypted: true,
        externalApplicationSessionIdEncryptionKeyId: true,
      },
    });
    if (
      !session ||
      session.applicationId !== applicationId ||
      session.status !== "active" ||
      session.absoluteExpiresAt <= new Date()
    ) {
      return [];
    }
    const sessionId = decryptExternalApplicationSessionId(
      session,
      this.externalApplicationSessionIdMasterKey,
    );
    return sessionId === null
      ? []
      : [{ headerName: "X-Session-Id", value: sessionId }];
  }

  async #filterRunnableMarketplaceCapabilities<
    T extends {
      id: string;
      sourceType: string;
      marketplaceListingId: string | null;
      marketplaceReleaseId: string | null;
      storagePath: string;
    },
  >(capabilities: T[]): Promise<T[]> {
    const marketplaceCapabilities = capabilities.filter(
      (capability) => capability.sourceType === "marketplace",
    );
    if (marketplaceCapabilities.length === 0) return capabilities;

    const listingIds = [
      ...new Set(
        marketplaceCapabilities.flatMap((capability) =>
          capability.marketplaceListingId === null
            ? []
            : [capability.marketplaceListingId],
        ),
      ),
    ];
    const releaseIds = [
      ...new Set(
        marketplaceCapabilities.flatMap((capability) =>
          capability.marketplaceReleaseId === null
            ? []
            : [capability.marketplaceReleaseId],
        ),
      ),
    ];
    const [listings, releases] = await Promise.all([
      this.prisma.marketplaceListing.findMany({
        where: { id: { in: listingIds } },
        select: { id: true, status: true },
      }),
      this.prisma.marketplaceRelease.findMany({
        where: { id: { in: releaseIds } },
        select: {
          id: true,
          listingId: true,
          status: true,
          contentSha256: true,
        },
      }),
    ]);
    const listingStatus = new Map(
      listings.map((listing) => [listing.id, listing.status]),
    );
    const releaseById = new Map(
      releases.map((release) => [release.id, release]),
    );

    const runnable: T[] = [];
    for (const capability of capabilities) {
      if (capability.sourceType !== "marketplace") {
        runnable.push(capability);
        continue;
      }
      if (
        capability.marketplaceListingId === null ||
        capability.marketplaceReleaseId === null
      ) {
        continue;
      }
      const status = listingStatus.get(capability.marketplaceListingId);
      const release = releaseById.get(capability.marketplaceReleaseId);
      if (
        (status !== "published" && status !== "unlisted") ||
        release?.listingId !== capability.marketplaceListingId ||
        release.status !== "approved"
      ) {
        continue;
      }
      try {
        await assertMarketplacePackageIntegrity(
          resolveCapabilityPath(this.capabilityRoot, capability.storagePath),
          release.contentSha256,
        );
        runnable.push(capability);
      } catch {
        // Treat unreadable, missing, or modified marketplace packages as
        // unavailable. A priority selection will surface the stable
        // CAPABILITY_NOT_FOUND failure before any user HOME is materialized.
      }
    }
    return runnable;
  }

  async resolveRecovery(input: {
    userId: string;
    capabilities: PersistedTurnCapability[];
    mcpServers?: RuntimeMcpServer[];
    applicationId?: string;
  }): Promise<{ environment: Record<string, string> }> {
    const official = input.capabilities.filter((capability) => officialConnectionPluginFor(capability));
    if (official.length > 0) {
      const available = input.applicationId ? [] : await this.connectionPlugins.resolve(input.userId);
      if (official.some((capability) =>
        !available.some((plugin) => plugin.id === capability.id && plugin.revision === capability.revision) ||
        capability.sourceOwnerId !== input.userId || capability.sourceType !== "local" ||
        Object.keys(capability.credentialEnvironment ?? {}).length > 0,
      )) throw new AppError("CAPABILITY_NOT_FOUND");
    }
    const environment: Record<string, string> = {};
    const applicationIdentity = input.applicationId
      ? await this.#resolveApplicationOwnerId(input.applicationId)
      : null;
    const applicationOwnerId = applicationIdentity?.ownerId ?? null;
    const applicationUsesOwnerResources =
      applicationIdentity !== null && applicationIdentity.kind !== "interactive";
    const credentialOwnerId = applicationUsesOwnerResources
      ? applicationOwnerId!
      : input.userId;
    const credentialRequests = input.capabilities.filter(capability => capability.type !== "skill" && Object.keys(capability.credentialEnvironment ?? {}).length > 0).map(capability => ({
      capabilityId: capability.id,
      requiredEnvironmentKeys: Object.keys(capability.credentialEnvironment ?? {}).sort(),
    }));
    const credentialResolutions = credentialRequests.length
      ? await this.credentials.resolveForCapabilities(credentialOwnerId, credentialRequests)
      : new Map<string, CredentialResolution>();
    for (const capability of input.capabilities) {
      if (capability.type === "skill") {
        if (capability.credentialEnvironment) {
          throw new AppError("EXECUTION_ENVIRONMENT_INVALID");
        }
        continue;
      }

      const expectedCredentialEnvironment =
        capability.credentialEnvironment ?? {};
      if (Object.keys(expectedCredentialEnvironment).length === 0) continue;
      const resolution = credentialResolutions.get(capability.id);
      if (!resolution) throw new AppError("CREDENTIAL_BINDING_REQUIRED");
      if (!resolution.ok) {
        throw new AppError(
          resolution.blockCode === "credential_binding_ambiguous"
            ? "CREDENTIAL_BINDING_CONFLICT"
            : "CREDENTIAL_BINDING_REQUIRED",
        );
      }

      const resolvedCredentialEnvironment: Record<string, string> = {};
      const resolvedSecrets: Array<{ source: string; value: string }> = [];
      for (const [key, value] of Object.entries(resolution.environment)) {
        if (isReservedExecutionEnvironmentKey(key)) {
          throw new AppError("CREDENTIAL_BINDING_CONFLICT");
        }
        const source = credentialSourceEnvironmentName(
          this.credentialSourceSecret,
          input.userId,
          capability.id,
          key,
        );
        resolvedCredentialEnvironment[key] = source;
        resolvedSecrets.push({ source, value });
      }
      if (
        !matchesCredentialEnvironment(
          expectedCredentialEnvironment,
          resolvedCredentialEnvironment,
        )
      ) {
        throw new AppError("CREDENTIAL_BINDING_CONFLICT");
      }
      for (const { source, value } of resolvedSecrets) {
        environment[source] = value;
      }
    }
    let mcp: { environment: Record<string, string> };
    if (input.applicationId && applicationUsesOwnerResources) {
      if (applicationOwnerId === null) throw new AppError("INTERNAL_ERROR");
      mcp = await this.#resolveApplicationMcpRecovery({
        applicationId: input.applicationId,
        applicationOwnerId,
        userId: input.userId,
        ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      });
    } else {
      mcp = await this.mcpServers.resolveRecovery(
        input.userId,
        input.mcpServers ?? [],
      );
    }
    return { environment: { ...environment, ...mcp.environment } };
  }

  async #resolveApplicationMcpRecovery(input: {
    applicationId: string;
    applicationOwnerId: string;
    userId: string;
    mcpServers?: RuntimeMcpServer[];
  }) {
    return this.mcpServers.resolveApplicationRecovery(
      input.applicationOwnerId,
      (input.mcpServers ?? []).map(server => server.id),
      input.mcpServers ?? [],
      await this.#resolveApplicationMcpRequestHeaders(
        input.userId,
        input.applicationId,
      ),
    );
  }

  async #resolveApplicationOwnerId(applicationId: string) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { ownerId: true, kind: true },
    });
    if (!application) throw new AppError("APPLICATION_NOT_FOUND");
    return application;
  }

  async commitCredentialUsage(
    receipts: Array<{
      userId: string;
      capabilityId: string;
      credentialIds: string[];
    }>,
  ): Promise<void> {
    for (const receipt of receipts) {
      await this.credentials.commitUsage(receipt);
    }
  }
}

export function createStartingTurnCapabilityPublicationGuard(
  prisma: Pick<PrismaClient, "conversation" | "conversationTurnStartIntent">,
): UserHomeCapabilityPublicationGuard {
  return async ({ ownerId, serviceSessionId }) => {
    const conversations = await prisma.conversation.findMany({
      where: { ownerId, workspaceRelPath: serviceSessionId
        ? serviceWorkspaceRelativePath(ownerId, serviceSessionId)
        : { startsWith: `${ownerId}/home/` } },
      select: { id: true },
    });
    return await prisma.conversationTurnStartIntent.findFirst({
      where: { ownerId, conversationId: { in: conversations.map(conversation => conversation.id) } },
      select: { projectionTurnId: true },
    }) === null;
  };
}

export function createRunningTurnCapabilityPublicationGuard(
  prisma: Pick<
    PrismaClient,
    "conversation" | "conversationTurn" | "conversationTurnStartIntent"
  >,
): UserHomeCapabilityPublicationGuard {
  return async ({ ownerId, serviceSessionId }) => {
    const conversations = serviceSessionId ? await prisma.conversation.findMany({
      where: { ownerId, workspaceRelPath: serviceWorkspaceRelativePath(ownerId, serviceSessionId) }, select: { id: true },
    }) : null;
    const [runningTurn, startIntent] = await Promise.all([
      prisma.conversationTurn.findFirst({
        where: { submittedBy: ownerId, status: "running", ...(conversations ? { conversationId: { in: conversations.map(conversation => conversation.id) } } : {}) },
        select: { id: true },
      }),
      prisma.conversationTurnStartIntent.findFirst({
        where: { ownerId, ...(conversations ? { conversationId: { in: conversations.map(conversation => conversation.id) } } : {}) },
        select: { projectionTurnId: true },
      }),
    ]);
    return runningTurn === null && startIntent === null;
  };
}

function matchesResolvedCapabilityState(
  expected: {
    capabilities: ExecutionCapability[];
    environment: Record<string, string>;
    credentialUsageReceipts: Array<{
      userId: string;
      capabilityId: string;
      credentialIds: string[];
    }>;
  },
  actual: {
    capabilities: ExecutionCapability[];
    environment: Record<string, string>;
    credentialUsageReceipts: Array<{
      userId: string;
      capabilityId: string;
      credentialIds: string[];
    }>;
  },
): boolean {
  const normalizeCapabilities = (capabilities: ExecutionCapability[]) =>
    capabilities
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        type: capability.type,
        revision: capability.revision,
        sourcePath: capability.sourcePath,
        description: capability.description,
        sourceType: capability.sourceType ?? null,
        sourceOwnerId: capability.sourceOwnerId ?? null,
        credentialEnvironment: Object.fromEntries(
          Object.entries(capability.credentialEnvironment ?? {}).sort(
            ([left], [right]) => left.localeCompare(right),
          ),
        ),
        credentialFingerprint: capability.credentialFingerprint ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  const normalizeReceipts = (
    receipts: Array<{
      userId: string;
      capabilityId: string;
      credentialIds: string[];
    }>,
  ) =>
    receipts
      .map((receipt) => ({
        userId: receipt.userId,
        capabilityId: receipt.capabilityId,
        credentialIds: [...receipt.credentialIds].sort(),
      }))
      .sort((left, right) =>
        left.capabilityId.localeCompare(right.capabilityId),
      );
  const normalizeEnvironment = (environment: Record<string, string>) =>
    Object.entries(environment).sort(([left], [right]) =>
      left.localeCompare(right),
    );
  return (
    JSON.stringify(normalizeCapabilities(expected.capabilities)) ===
      JSON.stringify(normalizeCapabilities(actual.capabilities)) &&
    JSON.stringify(normalizeEnvironment(expected.environment)) ===
      JSON.stringify(normalizeEnvironment(actual.environment)) &&
    JSON.stringify(normalizeReceipts(expected.credentialUsageReceipts)) ===
      JSON.stringify(normalizeReceipts(actual.credentialUsageReceipts))
  );
}

function credentialSourceEnvironmentName(
  secret: string,
  userId: string,
  capabilityId: string,
  environmentKey: string,
): string {
  return `LINKSENSE_CREDENTIAL_${createHmac("sha256", secret)
    .update(userId)
    .update("\0")
    .update(capabilityId)
    .update("\0")
    .update(environmentKey)
    .digest("hex")
    .slice(0, 32)
    .toUpperCase()}`;
}

function matchesCredentialEnvironment(
  expected: Record<string, string>,
  actual: Record<string, string>,
): boolean {
  const sortedEntries = (value: Record<string, string>) =>
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return (
    JSON.stringify(sortedEntries(expected)) ===
    JSON.stringify(sortedEntries(actual))
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function declaredPluginCredentialKeys(value: unknown): string[] {
  const risk = asObject(value);
  return Array.isArray(risk.declared_environment_keys)
    ? risk.declared_environment_keys.filter(
        (key): key is string =>
          typeof key === "string" &&
          /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key),
      )
    : [];
}

function fingerprintCredentialEnvironment(
  secret: string,
  userId: string,
  capabilityId: string,
  environment: Record<string, string>,
): string {
  const hash = createHmac("sha256", secret);
  hash.update("linksense-capability-credential-environment\0");
  hash.update(userId);
  hash.update("\0");
  hash.update(capabilityId);
  hash.update("\0");
  for (const [key, value] of Object.entries(environment).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    hash.update(String(Buffer.byteLength(key, "utf8")));
    hash.update(":");
    hash.update(key);
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
  }
  return hash.digest("hex");
}

function hasPluginMcpServer(manifest: unknown): boolean {
  return (
    !!manifest &&
    typeof manifest === "object" &&
    !Array.isArray(manifest) &&
    (manifest as Record<string, unknown>).has_mcp_servers === true
  );
}

async function streamToBuffer(
  stream: AsyncIterable<Buffer | Uint8Array | string>,
  maximumBytes = 2 * 1024 * 1024 + 1,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    chunks.push(bytes);
    if (total >= maximumBytes) break;
  }
  return Buffer.concat(chunks, Math.min(total, maximumBytes)).subarray(
    0,
    maximumBytes,
  );
}

const RESERVED_EXECUTION_ENVIRONMENT_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "USER",
  "SHELL",
  "BASH_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "AZURE_OPENAI_API_KEY",
]);

function isReservedExecutionEnvironmentKey(key: string): boolean {
  return (
    RESERVED_EXECUTION_ENVIRONMENT_KEYS.has(key) ||
    key.startsWith("LINKSENSE_") ||
    key.startsWith("CODEX_") ||
    key.startsWith("DYLD_")
  );
}

function resolveCapabilityPath(root: string, candidate: string): string {
  const normalizedRoot = resolve(root);
  // Published application snapshots store paths relative to capabilityRoot.
  const normalizedCandidate = resolve(normalizedRoot, candidate);
  const fromRoot = relative(normalizedRoot, normalizedCandidate);
  if (fromRoot && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`)) {
    return normalizedCandidate;
  }

  throw new AppError("CAPABILITY_NOT_FOUND");
}
