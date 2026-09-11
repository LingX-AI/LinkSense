import { describe, expect, it } from "vitest";

import {
  applyModelReasoningProfile,
  archivedConversationClearResultSchema,
  buildOfficeAnnotationDisplay,
  builtInMcpServerKeys,
  builtInSkillNames,
  capabilityImportSchema,
  capabilitySchema,
  conversationCollaborationModeSchema,
  conversationMessageSchema,
  conversationPlanReviewActionSchema,
  conversationPlanReviewSchema,
  conversationTurnSchema,
  conversationUserInputAnswersSchema,
  conversationUserInputRequestSchema,
  conversationEventSchema,
  executionConcurrencySettingsSchema,
  currentUserInfoFailureSchema,
  currentUserInfoSuccessSchema,
  createCredentialInputSchema,
  createUserInputSchema,
  credentialBindingSchema,
  credentialSchema,
  deleteModelProviderSchema,
  deleteModelProviderModelSchema,
  errorCatalog,
  getErrorCatalogEntry,
  legacyErrorCodeAliases,
  knowledgeBaseGrantListQuerySchema,
  knowledgeBaseGrantRevocationResultSchema,
  knowledgeCitationPreviewSchema,
  knowledgeDocumentFormats,
  knowledgeFilePreviewFormats,
  knowledgeDocumentRebuildBatchResultSchema,
  knowledgeDocumentRebuildBatchSize,
  knowledgeDocumentRebuildInputSchema,
  knowledgeDocumentUploadOptionsSchema,
  getKnowledgeDocumentMarkdownInputSchema,
  knowledgeDocumentListSuccessSchema,
  knowledgeDocumentMarkdownSuccessSchema,
  knowledgeProcessingStageSchema,
  knowledgeSearchCapabilitySchema,
  knowledgeSearchSuccessSchema,
  listKnowledgeDocumentsInputSchema,
  knowledgeUploadLimitsSchema,
  modelProviderBaseUrlSchema,
  publicKnowledgeCitationSchema,
  imageGenerationMcpFailureSchema,
  imageGenerationMcpSuccessSchema,
  imageGenerationProviderDefinitions,
  imageGenerationRequestSchema,
  officeAnnotationInputSchema,
  patchProductSettingsSchema,
  productSettingsSchema,
  updateMaintenanceSettingsSchema,
  updateExecutionConcurrencySettingsSchema,
  priorityCapabilityIdsSchema,
  DEFAULT_ORGANIZATION_DISPLAY_NAME,
  productFilenamePrefix,
  resolveOrganizationDisplayName,
  pendingRequestSchema,
  presentationAnnotationInputSchema,
  RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
  RUNNER_TURN_INTERRUPT_REQUESTED,
  RUNNER_TURN_START_CONTRACT_VERSION,
  runnerCodexGoalSchema,
  runnerCodexEventSchema,
  runnerLinkSenseEventSchema,
  runnerTurnInterruptResultSchema,
  searchKnowledgeBaseInputSchema,
  spreadsheetAnnotationInputSchema,
  threadGoalSchema,
  userMessageDisplaySchema,
  wordAnnotationInputSchema,
  runnerConversationEventSchema,
  updateOidcAuthenticationSettingsSchema,
  updateSharePointConnectionSettingsSchema,
  updateImageGenerationSettingsSchema,
  updateModelProviderSettingsSchema,
  updateImageUnderstandingSettingsSchema,
  updateSmtpAuthenticationSettingsSchema,
  updateTeamsAuthenticationSettingsSchema,
  MAX_VOICE_AUDIO_BYTES,
  MAX_VOICE_AUDIO_DATA_URL_BYTES,
  voiceTranscriptionRequestSchema,
  voiceTranscriptionStreamEventSchema,
  voiceTranscriptionProviderDefinitions,
  updateVoiceTranscriptionSettingsSchema,
  linksenseRuntimeIdentity,
  managedProjectionProbeContents,
  managedProjectionProbeFileName,
  workspacePermissionPolicy,
} from "../src/index.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-07-10T10:00:00.000Z";

describe("shared boundary contracts", () => {
  it("publishes one runtime identity and workspace permission contract", () => {
    expect(linksenseRuntimeIdentity).toEqual({
      apiUid: 1000,
      taskUid: 1001,
      sharedGid: 1000,
    });
    expect(workspacePermissionPolicy).toMatchObject({
      supervisorPrivateDirectory: 0o700,
      supervisorPrivateFile: 0o600,
      sharedDirectory: 0o2770,
      sharedReadableFile: 0o640,
      sharedWritableFile: 0o660,
    });
    expect(managedProjectionProbeFileName).toBe(
      ".linksense-managed-projection-v1",
    );
    expect(managedProjectionProbeContents).toBe(
      "linksense-managed-projection-v1\n",
    );
  });

  it("accepts only non-negative archived task clear counts", () => {
    expect(
      archivedConversationClearResultSchema.parse({ deleted_count: 3 }),
    ).toEqual({ deleted_count: 3 });
    expect(
      archivedConversationClearResultSchema.safeParse({ deleted_count: -1 })
        .success,
    ).toBe(false);
  });

  it("accepts only known built-in capability ids as turn priorities", () => {
    expect(
      priorityCapabilityIdsSchema.parse([
        "builtin:capability:linksense-browser",
        id,
      ]),
    ).toEqual(["builtin:capability:linksense-browser", id]);
    expect(
      priorityCapabilityIdsSchema.safeParse([
        "builtin:capability:unknown-skill",
      ]).success,
    ).toBe(false);
    expect(
      conversationMessageSchema.safeParse({
        id,
        conversation_id: otherId,
        turn_id: null,
        sequence_no: 1,
        role: "user",
        content_text: "Use the browser",
        selected_capabilities: [
          {
            id: "builtin:capability:linksense-browser",
            name: "linksense-browser",
            type: "skill",
          },
        ],
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(true);
  });

  it("accepts local capability imports and rejects the removed URL input", () => {
    expect(
      capabilityImportSchema.safeParse({
        source_type: "local",
        upload_id: id,
      }).success,
    ).toBe(true);
    expect(
      capabilityImportSchema.safeParse({
        source_type: "local",
        type: "skill",
        name: "meeting-notes",
        skill_markdown: "# Instructions",
      }).success,
    ).toBe(true);
    expect(
      capabilityImportSchema.safeParse({
        source_type: "url",
        source_url: "https://packages.example/meeting-notes.zip",
      }).success,
    ).toBe(false);
  });

  it("normalizes the configured product name and falls back for invalid data", () => {
    expect(resolveOrganizationDisplayName("  MOSS  ")).toBe("MOSS");
    expect(resolveOrganizationDisplayName("   ")).toBe(
      DEFAULT_ORGANIZATION_DISPLAY_NAME,
    );
    expect(productFilenamePrefix("  MOSS / 华东:*  ")).toBe("MOSS-华东");
  });

  it("keeps Visio downloadable when no browser preview renderer is available", () => {
    expect(knowledgeDocumentFormats).toContain("vsdx");
    expect(knowledgeFilePreviewFormats).not.toContain("vsdx");
    expect(knowledgeFilePreviewFormats).toEqual(
      knowledgeDocumentFormats.filter((format) => format !== "vsdx"),
    );
  });

  it("accepts only the two stable runner interrupt outcomes", () => {
    expect(
      runnerTurnInterruptResultSchema.parse({
        code: RUNNER_TURN_INTERRUPT_REQUESTED,
      }),
    ).toEqual({ code: "TURN_INTERRUPT_REQUESTED" });
    expect(
      runnerTurnInterruptResultSchema.parse({
        code: RUNNER_TURN_INTERRUPT_NOT_ACTIVE,
      }),
    ).toEqual({ code: "TURN_INTERRUPT_NOT_ACTIVE" });
    expect(() =>
      runnerTurnInterruptResultSchema.parse({ code: "unexpected" }),
    ).toThrow();
  });

  it("accepts the nullable persisted model snapshot on conversation turns", () => {
    const turn = {
      id,
      conversation_id: otherId,
      sequence_no: 1,
      submitted_by: id,
      codex_thread_id: "thread-1",
      codex_turn_id: "turn-1",
      status: "completed",
      collaboration_mode: "default",
      submit_mode: "normal",
      idempotency_key: null,
      knowledge_base_ids: [],
      model: "gpt-5.6-sol",
      started_at: timestamp,
      completed_at: timestamp,
      interrupt_requested_at: null,
      interrupted_at: null,
      error_code: null,
      error_message: null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    expect(conversationTurnSchema.parse(turn).model).toBe("gpt-5.6-sol");
    expect(
      conversationTurnSchema.parse({ ...turn, model: null }).model,
    ).toBeNull();
  });

  it("validates globally unique models with a conversation default and an independently selected title model", () => {
    const parsed = updateModelProviderSettingsSchema.parse({
      expected_revision: 0,
      providers: [
        {
          id: "provider-a",
          name: "  Primary channel  ",
          base_url: "https://models-a.example.com/v1/",
          protocol_mode: "responses_tool_compat",
          api_key: "provider-a-secret",
          models: [
            {
              id: "model-a",
              display_name: "Model A",
              enabled: true,
              supported_reasoning_efforts: ["low", "medium", "high"],
              default_reasoning_effort: "medium",
            },
          ],
        },
        {
          id: "provider-b",
          name: "Backup channel",
          base_url: "https://models-b.example.com/v1/",
          protocol_mode: "chat_completions_bridge",
          api_key: "provider-b-secret",
          models: [
            {
              id: "model-b",
              display_name: "Model B",
              enabled: true,
              supported_reasoning_efforts: ["minimal"],
              default_reasoning_effort: "minimal",
            },
          ],
        },
      ],
      default_model: "model-a",
    });

    expect(parsed.providers[0]?.base_url).toBe(
      "https://models-a.example.com/v1",
    );
    expect(parsed.providers[0]?.name).toBe("Primary channel");
    expect(parsed.providers[0]?.protocol_mode).toBe("responses_tool_compat");
    expect(parsed.providers).toHaveLength(2);
    expect(
      updateModelProviderSettingsSchema.safeParse({
        ...parsed,
        providers: [
          {
            ...parsed.providers[0],
            protocol_mode: "unsupported",
          },
          parsed.providers[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      updateModelProviderSettingsSchema.safeParse({
        ...parsed,
        providers: parsed.providers.map((provider) =>
          provider.id === "provider-b"
            ? {
                ...provider,
                models: provider.models.map((model) => ({
                  ...model,
                  enabled: false,
                })),
              }
            : provider,
        ),
        title_model: "model-b",
      }).success,
    ).toBe(true);
    expect(
      updateModelProviderSettingsSchema.safeParse({
        ...parsed,
        providers: [
          parsed.providers[0],
          {
            ...parsed.providers[1],
            models: parsed.providers[0]?.models ?? [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      updateModelProviderSettingsSchema.safeParse({
        ...parsed,
        providers: parsed.providers.map((provider) => ({
          ...provider,
          models: provider.models.map((model) => ({
            ...model,
            enabled: false,
          })),
        })),
      }).success,
    ).toBe(false);
    expect(
      updateModelProviderSettingsSchema.safeParse({
        ...parsed,
        providers: [
          parsed.providers[0],
          {
            ...parsed.providers[1],
            provider: "alibaba",
            base_url: parsed.providers[0]?.base_url,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      updateModelProviderSettingsSchema.safeParse({
        ...parsed,
        providers: [
          {
            ...parsed.providers[0],
            name: "   ",
          },
          parsed.providers[1],
        ],
      }).success,
    ).toBe(false);
  });

  it("validates image generation settings and the built-in runtime contracts", () => {
    const settings = updateImageGenerationSettingsSchema.parse({
      expected_revision: 0,
      enabled: true,
      provider: "alibaba_bailian",
      provider_options: {
        workspace_id: "dashscope-workspace",
        region: "cn-beijing",
      },
      api_key: "dashscope-secret",
      model: "qwen-image-3.0",
      price_per_image: "0.120000",
    });

    expect(settings.price_per_image).toBe("0.12");
    expect(settings.provider_options).toEqual({
      workspace_id: "dashscope-workspace",
      region: "cn-beijing",
    });
    expect(
      updateImageGenerationSettingsSchema.safeParse({
        ...settings,
        provider_options: { workspace_id: null, region: "cn-beijing" },
      }).success,
    ).toBe(false);
    expect(
      updateImageGenerationSettingsSchema.safeParse({
        ...settings,
        price_per_image: "-1",
      }).success,
    ).toBe(false);
    expect(
      imageGenerationProviderDefinitions.map((provider) => provider.key),
    ).toEqual([
      "alibaba_bailian",
      "openai",
      "google_gemini",
      "stability",
      "fal",
      "replicate",
      "together",
    ]);
    expect(builtInMcpServerKeys).toEqual([
      "linksense_core",
      "linksense_managed_browser",
    ]);
    expect(
      currentUserInfoSuccessSchema.parse({
        success: true,
        user: {
          name: "Ada",
          email: "Ada@Example.com",
          user_groups: [
            {
              id: "01900000-0000-7000-8000-000000000001",
              name: "Research",
            },
          ],
        },
        credit_quota: {
          total: null,
          weekly: {
            limit_credits: "0.001",
            used_credits: "0.00025",
            remaining_credits: "0.00075",
            remaining_percentage: 75,
            reset_at: "2026-08-24T00:00:00.000Z",
          },
          monthly: null,
        },
      }),
    ).toMatchObject({
      user: { email: "ada@example.com" },
      credit_quota: { monthly: null },
    });
    expect(
      currentUserInfoSuccessSchema.safeParse({
        success: true,
        user: {
          name: "Ada",
          email: "ada@example.com",
          role: "admin",
          user_groups: [],
        },
        credit_quota: { total: null, weekly: null, monthly: null },
      }).success,
    ).toBe(false);
    expect(
      currentUserInfoFailureSchema.parse({
        code: "CURRENT_USER_FORBIDDEN",
        retryable: false,
      }),
    ).toEqual({ code: "CURRENT_USER_FORBIDDEN", retryable: false });
    expect(builtInSkillNames).toContain("linksense-document-reader");
    expect(builtInSkillNames).toContain("linksense-image-generation");

    expect(
      imageGenerationRequestSchema.parse({
        prompt: "A product mockup",
        count: 2,
        size: "1024x1024",
      }),
    ).toEqual({
      prompt: "A product mockup",
      count: 2,
      size: "1024x1024",
      background: "opaque",
      transparency_mode: "auto",
    });
    expect(
      imageGenerationRequestSchema.parse({
        prompt: "A clean product cutout",
        background: "transparent",
        transparency_mode: "chroma_key",
        chroma_key: "magenta",
      }),
    ).toMatchObject({
      background: "transparent",
      transparency_mode: "chroma_key",
      chroma_key: "magenta",
    });
    expect(
      imageGenerationRequestSchema.safeParse({
        prompt: "An ordinary image",
        background: "opaque",
        transparency_mode: "native",
      }).success,
    ).toBe(false);
    expect(
      imageGenerationMcpSuccessSchema.parse({
        success: true,
        provider: "alibaba_bailian",
        model: "qwen-image-3.0",
        image_count: 1,
        unit_price: "0.12",
        total_cost: "0.12",
        currency: "CNY",
        transparency: {
          requested: true,
          strategy: "chroma_key",
          chroma_key: "green",
        },
        artifacts: [
          {
            artifact_id: id,
            file_id: otherId,
            display_name: "qwen-image-3.0-1.png",
            download_card_event_id: id,
            workspace_relative_path: "artifacts/qwen-image-3.0-1.png",
            mime_type: "image/png",
            has_transparency: true,
          },
        ],
      }).image_count,
    ).toBe(1);
    expect(
      imageGenerationMcpFailureSchema.parse({
        code: "IMAGE_GENERATION_PROVIDER_REJECTED",
        retryable: false,
        provider_code: "InvalidApiKey",
        provider_message: "Invalid API-key provided.",
        provider_request_id: "31f808fd-8eef-9004",
      }),
    ).toEqual({
      code: "IMAGE_GENERATION_PROVIDER_REJECTED",
      retryable: false,
      provider_code: "InvalidApiKey",
      provider_message: "Invalid API-key provided.",
      provider_request_id: "31f808fd-8eef-9004",
    });
    expect(
      imageGenerationMcpFailureSchema.parse({
        code: "IMAGE_GENERATION_RECORDING_FAILED",
        retryable: false,
      }),
    ).toEqual({
      code: "IMAGE_GENERATION_RECORDING_FAILED",
      retryable: false,
    });
    expect(
      imageGenerationMcpFailureSchema.parse({
        code: "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
        retryable: false,
      }),
    ).toEqual({
      code: "IMAGE_GENERATION_ARTIFACT_REGISTRATION_FAILED",
      retryable: false,
    });
  });

  it("rejects credentials, query strings, and non-http model provider URLs", () => {
    for (const value of [
      "https://user:secret@example.com/v1",
      "https://example.com/v1?token=secret",
      "file:///tmp/provider",
    ]) {
      expect(modelProviderBaseUrlSchema.safeParse(value).success).toBe(false);
    }
  });

  it("validates the optimistic concurrency payload for immediate model deletion", () => {
    expect(
      deleteModelProviderModelSchema.parse({
        expected_revision: 3,
        model_id: "qwen3.7-max",
      }),
    ).toEqual({ expected_revision: 3, model_id: "qwen3.7-max" });
    expect(
      deleteModelProviderModelSchema.safeParse({
        expected_revision: -1,
        model_id: "qwen3.7-max",
      }).success,
    ).toBe(false);
  });

  it("validates the optimistic concurrency payload for immediate model channel deletion", () => {
    expect(
      deleteModelProviderSchema.parse({
        expected_revision: 4,
        provider_id: "provider-a",
      }),
    ).toEqual({ expected_revision: 4, provider_id: "provider-a" });
    expect(
      deleteModelProviderSchema.safeParse({
        expected_revision: -1,
        provider_id: "provider-a",
      }).success,
    ).toBe(false);
  });

  it("requires a complete provider configuration when image understanding is enabled", () => {
    const common = {
      expected_revision: 0,
      enabled: true,
      base_url: null,
      api_key: "image-model-secret",
      model: "gemini-2.5-flash",
      project: null,
      location: null,
    };

    expect(
      updateImageUnderstandingSettingsSchema.safeParse({
        ...common,
        provider: "google",
      }).success,
    ).toBe(true);
    expect(
      updateImageUnderstandingSettingsSchema.safeParse({
        ...common,
        provider: "google_vertex",
      }).success,
    ).toBe(false);
    expect(
      updateImageUnderstandingSettingsSchema.safeParse({
        ...common,
        provider: "google_vertex",
        project: "linksense",
        location: "us-central1",
      }).success,
    ).toBe(true);
    expect(
      updateImageUnderstandingSettingsSchema.safeParse({
        ...common,
        provider: "openai_compatible",
      }).success,
    ).toBe(false);
  });

  it("applies a dynamic Codex profile and uses the generic six efforts without one", () => {
    expect(
      applyModelReasoningProfile(
        {
          id: "gpt-5.6-sol",
          display_name: "GPT-5.6-Sol",
          enabled: true,
          supported_reasoning_efforts: ["minimal"],
          default_reasoning_effort: "minimal",
        },
        {
          supported_reasoning_efforts: ["low", "high"],
          default_reasoning_effort: "low",
        },
      ),
    ).toMatchObject({
      supported_reasoning_efforts: ["low", "high"],
      default_reasoning_effort: "low",
    });

    expect(
      applyModelReasoningProfile(
        {
          id: "gpt-5.6-sol",
          display_name: "GPT-5.6-Sol",
          enabled: true,
          supported_reasoning_efforts: ["high"],
          default_reasoning_effort: "high",
        },
        {
          supported_reasoning_efforts: ["low", "high"],
          default_reasoning_effort: "low",
        },
      ),
    ).toMatchObject({
      supported_reasoning_efforts: ["low", "high"],
      default_reasoning_effort: "high",
    });

    expect(
      applyModelReasoningProfile({
        id: "custom-model",
        display_name: "Custom model",
        enabled: true,
        supported_reasoning_efforts: ["minimal"],
        default_reasoning_effort: "minimal",
      }),
    ).toMatchObject({
      supported_reasoning_efforts: [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ],
      default_reasoning_effort: "medium",
    });
  });

  it("publishes only the current knowledge-processing stages", () => {
    expect(knowledgeProcessingStageSchema.options).toEqual([
      "uploading",
      "validating",
      "queued",
      "parsing",
      "chunking",
      "image_understanding",
      "parenting",
      "embedding",
      "indexing",
      "activating",
      "completed",
      "failed",
    ]);
  });

  it("limits the public knowledge-search status to stable codes and safe fields", () => {
    expect(
      knowledgeSearchCapabilitySchema.parse({
        status: "unavailable",
        reason_code: "EMBEDDING_DIMENSION_MISMATCH",
        checked_at: timestamp,
      }),
    ).toEqual({
      status: "unavailable",
      reason_code: "EMBEDDING_DIMENSION_MISMATCH",
      checked_at: timestamp,
    });
    expect(
      knowledgeSearchCapabilitySchema.safeParse({
        status: "unavailable",
        reason_code: "KNOWLEDGE_EMBEDDING_UNAVAILABLE",
        checked_at: timestamp,
      }).success,
    ).toBe(false);
    expect(
      knowledgeSearchCapabilitySchema.safeParse({
        status: "unavailable",
        reason_code: "KNOWLEDGE_SEARCH_UNAVAILABLE",
        checked_at: timestamp,
        model: "private-model",
        endpoint: "https://private.example/v1/embeddings",
        api_key: "secret",
      }).success,
    ).toBe(false);
    expect(
      knowledgeSearchCapabilitySchema.parse({
        status: "not_installed",
        reason_code: "KNOWLEDGE_NOT_INSTALLED",
        checked_at: timestamp,
      }),
    ).toEqual({
      status: "not_installed",
      reason_code: "KNOWLEDGE_NOT_INSTALLED",
      checked_at: timestamp,
    });
  });

  it("keeps deployment upload limits positive, integral, and browser-safe", () => {
    expect(
      knowledgeUploadLimitsSchema.parse({
        max_file_size_bytes: 209_715_200,
        max_files_per_batch: 37,
        storage_quota_bytes: 10_737_418_240,
      }),
    ).toEqual({
      max_file_size_bytes: 209_715_200,
      max_files_per_batch: 37,
      storage_quota_bytes: 10_737_418_240,
    });
    expect(
      knowledgeUploadLimitsSchema.safeParse({
        max_file_size_bytes: 209_715_200,
        max_files_per_batch: 0,
        storage_quota_bytes: 10_737_418_240,
      }).success,
    ).toBe(false);
  });

  it("bounds manual knowledge-document rebuild pages with a strict keyset contract", () => {
    const documentIds = Array.from(
      { length: knowledgeDocumentRebuildBatchSize },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    );

    expect(knowledgeDocumentRebuildInputSchema.parse({})).toEqual({});
    expect(
      knowledgeDocumentRebuildInputSchema.parse({ cursor: otherId }),
    ).toEqual({ cursor: otherId });
    expect(
      knowledgeDocumentRebuildInputSchema.safeParse({
        document_ids: documentIds,
      }).success,
    ).toBe(true);
    for (const input of [
      { document_ids: [] },
      { document_ids: [...documentIds, id] },
      { document_ids: [id, id] },
      { document_ids: [id], cursor: otherId },
      { cursor: "not-a-uuid" },
    ]) {
      expect(knowledgeDocumentRebuildInputSchema.safeParse(input).success).toBe(
        false,
      );
    }
    expect(
      knowledgeDocumentRebuildBatchResultSchema.safeParse({
        items: [],
        next_cursor: otherId,
      }).success,
    ).toBe(true);
    expect(
      knowledgeDocumentRebuildBatchResultSchema.safeParse({ items: [] })
        .success,
    ).toBe(false);
    expect(
      knowledgeDocumentRebuildBatchResultSchema.safeParse({
        items: [...documentIds, id].map((documentId) => ({
          document_id: documentId,
          status: "rejected",
          error_code: "KNOWLEDGE_DOCUMENT_BUSY",
        })),
        next_cursor: null,
      }).success,
    ).toBe(false);
  });

  it("strictly validates knowledge-grant keyset pagination inputs", () => {
    expect(
      knowledgeBaseGrantListQuerySchema.parse({ cursor: id, limit: "100" }),
    ).toEqual({ cursor: id, limit: 100 });
    expect(knowledgeBaseGrantListQuerySchema.parse({})).toEqual({ limit: 30 });
    for (const input of [
      { cursor: "not-a-uuid" },
      { limit: "0" },
      { limit: "101" },
      { limit: "1.5" },
      { limit: "20", offset: "20" },
    ]) {
      expect(knowledgeBaseGrantListQuerySchema.safeParse(input).success).toBe(
        false,
      );
    }
  });

  it("returns only privacy-safe remaining access summaries after grant revocation", () => {
    expect(
      knowledgeBaseGrantRevocationResultSchema.parse({
        revoked_grant_id: id,
        target_type: "user",
        target_id: otherId,
        remaining_access: {
          subject_type: "user",
          has_access: true,
          source_types: ["direct", "user_group"],
        },
      }),
    ).toMatchObject({
      remaining_access: {
        has_access: true,
        source_types: ["direct", "user_group"],
      },
    });
    expect(
      knowledgeBaseGrantRevocationResultSchema.safeParse({
        revoked_grant_id: id,
        target_type: "user_group",
        target_id: otherId,
        remaining_access: {
          subject_type: "user_group",
          member_access: "some",
          source_types: ["owner", "user_group"],
          member_ids: [id],
        },
      }).success,
    ).toBe(false);
    expect(
      knowledgeBaseGrantRevocationResultSchema.safeParse({
        revoked_grant_id: id,
        target_type: "user",
        target_id: otherId,
        remaining_access: {
          subject_type: "user",
          has_access: false,
          source_types: ["user_group"],
        },
      }).success,
    ).toBe(false);
    expect(
      knowledgeBaseGrantRevocationResultSchema.safeParse({
        revoked_grant_id: id,
        target_type: "user_group",
        target_id: otherId,
        remaining_access: {
          subject_type: "user",
          has_access: false,
          source_types: [],
        },
      }).success,
    ).toBe(false);
  });

  it("requires an exact replacement target only for replacement uploads", () => {
    expect(knowledgeDocumentUploadOptionsSchema.parse({})).toEqual({
      ocr_enabled: false,
    });
    expect(
      knowledgeDocumentUploadOptionsSchema.parse({
        ocr_enabled: "true",
      }),
    ).toEqual({
      ocr_enabled: true,
    });
    expect(
      knowledgeDocumentUploadOptionsSchema.safeParse({
        conflict_resolution: "keep_both",
      }).success,
    ).toBe(true);
    expect(
      knowledgeDocumentUploadOptionsSchema.safeParse({
        conflict_resolution: "replace",
        replace_document_id: id,
      }).success,
    ).toBe(true);

    expect(
      knowledgeDocumentUploadOptionsSchema.safeParse({
        conflict_resolution: "replace",
      }).success,
    ).toBe(false);
    expect(
      knowledgeDocumentUploadOptionsSchema.safeParse({
        conflict_resolution: "keep_both",
        replace_document_id: id,
      }).success,
    ).toBe(false);
    expect(
      knowledgeDocumentUploadOptionsSchema.safeParse({
        replace_document_id: id,
      }).success,
    ).toBe(false);
    expect(
      knowledgeDocumentUploadOptionsSchema.safeParse({
        ocr_enabled: "yes",
      }).success,
    ).toBe(false);
  });

  it("allows only safe structured source metadata in knowledge MCP results", () => {
    const result = {
      success: true as const,
      results: [
        {
          source_ref: "source_ref_0000000000000001",
          citation_marker: "[[kb-source:source_ref_0000000000000001]]",
          document_ref: "document_ref_0000000000000001",
          knowledge_base_name: "产品制度",
          document_name: "报销制度.pdf",
          document_version_id: id,
          title_path: ["报销标准"],
          page_numbers: [2],
          location: "page 2 · 报销标准",
          content: "完整父段内容",
        },
      ],
      unavailable_knowledge_base_count: 0,
    };
    expect(knowledgeSearchSuccessSchema.safeParse(result).success).toBe(true);
    expect(
      knowledgeSearchSuccessSchema.safeParse({
        ...result,
        results: [
          {
            ...result.results[0],
            parent_id: "private-parent",
            object_key: "knowledge/private/original",
            elasticsearch_score: 0.99,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("bounds explicit knowledge-search vector candidates", () => {
    expect(
      searchKnowledgeBaseInputSchema.parse({
        query: "报销标准",
        num_candidates: 10_000,
      }).num_candidates,
    ).toBe(10_000);
    expect(
      searchKnowledgeBaseInputSchema.safeParse({
        query: "报销标准",
        num_candidates: 10_001,
      }).success,
    ).toBe(false);
  });

  it("keeps document inventory and Markdown reads on opaque strict contracts", () => {
    const documentRef = "document_ref_0000000000000001";
    const cursor = "document_cursor_00000000000001";
    expect(listKnowledgeDocumentsInputSchema.parse({})).toEqual({});
    expect(
      listKnowledgeDocumentsInputSchema.safeParse({
        cursor,
        knowledge_base_id: id,
      }).success,
    ).toBe(false);
    expect(
      getKnowledgeDocumentMarkdownInputSchema.safeParse({
        document_ref: documentRef,
        cursor,
        document_id: id,
      }).success,
    ).toBe(false);
    expect(
      knowledgeDocumentListSuccessSchema.safeParse({
        success: true,
        documents: [
          {
            document_ref: documentRef,
            knowledge_base_name: "产品制度",
            document_name: "报销制度.pdf",
            file_type: "pdf",
          },
        ],
        next_cursor: cursor,
        unavailable_knowledge_base_count: 0,
      }).success,
    ).toBe(true);
    expect(
      knowledgeDocumentMarkdownSuccessSchema.safeParse({
        success: true,
        document_ref: documentRef,
        knowledge_base_name: "产品制度",
        document_name: "报销制度.pdf",
        file_type: "pdf",
        markdown: "# 报销制度",
        chunk_index: 0,
        byte_start: 0,
        byte_end: 16,
        total_bytes: 32,
        next_cursor: cursor,
        complete: false,
      }).success,
    ).toBe(true);
  });

  it("keeps browser citation contracts free of source ids and private ranges", () => {
    const citation = {
      citation_id: id,
      citation_no: 1,
      anchors: [{ occurrence_no: 1, after_offset_utf16: 8 }],
      summary: {
        knowledge_base_name: "Support",
        document_name: "policy.pdf",
        title_path: ["Warranty"],
        page_numbers: [2],
      },
    };
    expect(publicKnowledgeCitationSchema.safeParse(citation).success).toBe(
      true,
    );
    expect(
      publicKnowledgeCitationSchema.safeParse({
        ...citation,
        document_version_id: otherId,
        parent_id: "parent-private",
        markdown_range: { start: 0, end: 10 },
      }).success,
    ).toBe(false);
    expect(
      conversationMessageSchema.safeParse({
        id,
        conversation_id: otherId,
        turn_id: otherId,
        sequence_no: 1,
        role: "assistant",
        content_text: "Warranty is one year.",
        knowledge_citations: [citation],
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(true);
    expect(
      knowledgeCitationPreviewSchema.parse({
        status: "available",
        citation_id: id,
        citation_no: 1,
        summary: citation.summary,
        parent_excerpt: "Warranty\n\nOne year.",
        original: { supported: false, renderer: null },
      }),
    ).toEqual({
      status: "available",
      citation_id: id,
      citation_no: 1,
      summary: citation.summary,
      parent_excerpt: "Warranty\n\nOne year.",
      original: { supported: false, renderer: null },
    });
    expect(
      knowledgeCitationPreviewSchema.safeParse({
        status: "available",
        citation_id: id,
        citation_no: 1,
        summary: citation.summary,
        parent_excerpt: "Warranty\n\nOne year.",
        parsed_markdown: "# Warranty\n\nOne year.",
        original: { supported: false, renderer: null },
      }).success,
    ).toBe(false);
    expect(
      knowledgeCitationPreviewSchema.parse({
        status: "historical_unavailable",
        citation_id: id,
        citation_no: 1,
        summary: citation.summary,
      }),
    ).toEqual({
      status: "historical_unavailable",
      citation_id: id,
      citation_no: 1,
      summary: citation.summary,
    });
    expect(
      knowledgeCitationPreviewSchema.safeParse({
        status: "historical_unavailable",
        citation_id: id,
        citation_no: 1,
        summary: citation.summary,
        parsed_markdown: "private body",
      }).success,
    ).toBe(false);
  });

  it("publishes one stable runner turn-start contract version", () => {
    expect(RUNNER_TURN_START_CONTRACT_VERSION).toBe(
      "shared-user-home-v22",
    );
  });

  it("validates Plan mode snapshots and transient native user-input requests", () => {
    expect(conversationCollaborationModeSchema.parse("plan")).toBe("plan");
    expect(conversationCollaborationModeSchema.safeParse("custom").success).toBe(
      false,
    );

    const request = {
      id,
      conversation_id: otherId,
      turn_id: id,
      item_id: "request-item-1",
      kind: "questions",
      questions: [
        {
          id: "scope",
          header: "范围",
          question: "选择实现范围",
          is_other: true,
          is_secret: false,
          options: [
            { label: "完整实现", description: "完成全部链路" },
            { label: "仅分析", description: "只输出方案" },
          ],
        },
      ],
      status: "pending",
      auto_resolve_at: null,
      resolved_at: null,
      resolved_action: null,
      created_at: timestamp,
      updated_at: timestamp,
    } as const;
    expect(conversationUserInputRequestSchema.parse(request)).toEqual(request);
    expect(
      conversationUserInputAnswersSchema.parse({ scope: ["完整实现"] }),
    ).toEqual({ scope: ["完整实现"] });
    expect(
      conversationUserInputAnswersSchema.safeParse({ scope: [] }).success,
    ).toBe(false);
    expect(
      runnerCodexEventSchema.safeParse({
        method: "item/tool/requestUserInput",
        visibility: "user_visible",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "request-item-1",
          requestId: 7,
          questions: [
            {
              id: "scope",
              header: "范围",
              question: "选择实现范围",
              isOther: true,
              isSecret: false,
              options: [
                { label: "完整实现", description: "完成全部链路" },
              ],
            },
          ],
          isBlocking: true,
          autoResolutionMs: null,
        },
      }).success,
    ).toBe(true);
    expect(
      runnerCodexEventSchema.safeParse({
        method: "item/tool/requestUserInput",
        visibility: "user_visible",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "request-item-1",
          requestId: 7,
          questions: [
            {
              id: "scope",
              header: "范围",
              question: "选择实现范围",
              isOther: true,
              isSecret: false,
              options: [
                { label: "完整实现", description: "完成全部链路" },
              ],
            },
          ],
          isBlocking: false,
          autoResolutionMs: 59_999,
        },
      }).success,
    ).toBe(false);
    const formEvent = {
      method: "linksense/form/request",
      visibility: "user_visible",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "linksense-form-8",
        requestId: 8,
        serverName: "linksense_core",
        message: "请确认信息",
        requestedSchema: {
          type: "object",
          properties: {
            title: { type: "string", title: "标题" },
          },
          required: ["title"],
        },
        uiHints: {},
        responseSemantics: { kind: "input" },
        autoResolutionMs: 600_000,
      },
    } as const;
    expect(runnerLinkSenseEventSchema.safeParse(formEvent).success).toBe(true);
    expect(runnerCodexEventSchema.safeParse(formEvent).success).toBe(false);
    expect(
      runnerLinkSenseEventSchema.safeParse({
        ...formEvent,
        params: { ...formEvent.params, autoResolutionMs: 600_001 },
      }).success,
    ).toBe(false);
  });

  it("validates durable Plan review decisions and rejects inconsistent terminal state", () => {
    expect(conversationPlanReviewActionSchema.options).toEqual([
      "implement",
      "revise",
      "skip",
      "exit",
    ]);
    const pending = {
      id,
      conversation_id: otherId,
      source_turn_id: id,
      plan_message_id: otherId,
      status: "pending",
      decision: null,
      follow_up_turn_id: null,
      resolved_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    } as const;
    expect(conversationPlanReviewSchema.parse(pending)).toEqual(pending);
    expect(
      conversationPlanReviewSchema.safeParse({
        ...pending,
        status: "resolved",
        decision: "implement",
      }).success,
    ).toBe(false);
    expect(
      conversationPlanReviewSchema.safeParse({
        ...pending,
        status: "resolved",
        decision: "implement",
        follow_up_turn_id: id,
        resolved_at: timestamp,
      }).success,
    ).toBe(true);
    expect(
      conversationPlanReviewSchema.safeParse({
        ...pending,
        status: "resolved",
        decision: "exit",
        resolved_at: timestamp,
      }).success,
    ).toBe(true);
  });

  it("validates native and public Goal status and usage contracts", () => {
    const nativeGoal = {
      threadId: "thread-1",
      objective: "完整实现目标功能",
      status: "active",
      tokenBudget: 12_000,
      tokensUsed: 800,
      timeUsedSeconds: 38,
      createdAt: 1_785_996_000,
      updatedAt: 1_785_996_038,
    } as const;

    expect(runnerCodexGoalSchema.parse(nativeGoal)).toEqual(nativeGoal);
    expect(
      runnerCodexGoalSchema.safeParse({ ...nativeGoal, tokensUsed: -1 }).success,
    ).toBe(false);
    expect(
      threadGoalSchema.safeParse({
        thread_id: nativeGoal.threadId,
        objective: nativeGoal.objective,
        status: "budgetLimited",
        token_budget: nativeGoal.tokenBudget,
        tokens_used: nativeGoal.tokensUsed,
        time_used_seconds: nativeGoal.timeUsedSeconds,
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(true);
  });

  it("accepts supported voice data URLs and enforces the encoded limit and safe raw cap", () => {
    expect(
      voiceTranscriptionRequestSchema.parse({
        audio_data_url: "data:audio/webm;codecs=opus;base64,UklGRg==",
        language: "zh-CN",
      }),
    ).toMatchObject({ language: "zh-CN", stream: true });
    expect(MAX_VOICE_AUDIO_BYTES).toBeLessThan(7.5 * 1024 * 1024);
    expect(MAX_VOICE_AUDIO_BYTES).toBeGreaterThan(7.49 * 1024 * 1024);
    expect(
      voiceTranscriptionRequestSchema.safeParse({
        audio_data_url: "data:audio/mp4;base64,UklGRg==",
      }).success,
    ).toBe(true);

    const oversizedBase64 = "A".repeat(
      Math.ceil((MAX_VOICE_AUDIO_BYTES + 3) / 3) * 4,
    );
    expect(
      voiceTranscriptionRequestSchema.safeParse({
        audio_data_url: `data:audio/webm;base64,${oversizedBase64}`,
      }).success,
    ).toBe(false);
    expect(
      voiceTranscriptionRequestSchema.safeParse({
        audio_data_url: `data:audio/webm;base64,${"A".repeat(MAX_VOICE_AUDIO_DATA_URL_BYTES)}`,
      }).success,
    ).toBe(false);
    expect(
      voiceTranscriptionRequestSchema.safeParse({
        audio_data_url: "data:text/plain;base64,UklGRg==",
      }).success,
    ).toBe(false);
    expect(
      voiceTranscriptionRequestSchema.safeParse({
        audio_data_url: "data:audio/unknown;base64,UklGRg==",
      }).success,
    ).toBe(false);
  });

  it("keeps NDJSON voice transcription events discriminated and strict", () => {
    expect(
      voiceTranscriptionStreamEventSchema.safeParse({
        type: "delta",
        text: "Link",
      }).success,
    ).toBe(true);
    expect(
      voiceTranscriptionStreamEventSchema.safeParse({
        type: "error",
        error_code: "VOICE_TRANSCRIPTION_FAILED",
        message_key: "errors.composer.voiceTranscriptionFailed",
        message: "语音转文字失败，请重试或手动输入。",
        upstream_error: "secret provider response",
      }).success,
    ).toBe(false);
  });

  it("validates managed voice transcription settings for every provider", () => {
    expect(voiceTranscriptionProviderDefinitions.map(({ key }) => key)).toEqual([
      "dashscope",
      "openai",
      "openai_compatible",
      "azure_openai",
      "groq",
      "deepgram",
      "assemblyai",
      "elevenlabs",
      "revai",
      "gladia",
      "fal",
    ]);
    expect(
      updateVoiceTranscriptionSettingsSchema.safeParse({
        expected_revision: 0,
        enabled: true,
        provider: "openai",
        provider_options: { api_version: null },
        base_url: "https://api.openai.com/v1/",
        api_key: "secret",
        model: "gpt-4o-mini-transcribe",
      }).success,
    ).toBe(true);
    expect(
      updateVoiceTranscriptionSettingsSchema.safeParse({
        expected_revision: 0,
        enabled: true,
        provider: "azure_openai",
        provider_options: { api_version: null },
        base_url: "https://resource.openai.azure.com",
        api_key: "secret",
        model: "transcription-deployment",
      }).success,
    ).toBe(false);
    expect(
      updateVoiceTranscriptionSettingsSchema.safeParse({
        expected_revision: 0,
        enabled: true,
        provider: "openai",
        provider_options: { api_version: null },
        base_url: "https://user:password@example.com/v1",
        api_key: "secret",
        model: "whisper-1",
      }).success,
    ).toBe(false);
  });

  it("keeps conversation error contracts stable while presenting task terminology", () => {
    expect(getErrorCatalogEntry("CONVERSATION_NOT_FOUND")).toEqual(
      expect.objectContaining({
        message_key: "errors.conversation.notFound",
        messages: {
          "zh-CN": "未找到该任务。",
          "en-US": "The task was not found.",
        },
      }),
    );
    expect(getErrorCatalogEntry("ACCESS_DENIED")).toEqual(
      expect.objectContaining({
        message_key: "errors.conversation.accessDenied",
        messages: {
          "zh-CN": "你无权访问该任务。",
          "en-US": "You do not have access to this task.",
        },
      }),
    );
    expect(
      getErrorCatalogEntry("APPLICATION_CONVERSATION_RENAME_UNSUPPORTED"),
    ).toEqual({
      message_key: "errors.application.conversationRenameUnsupported",
      http_status: 409,
      messages: {
        "zh-CN": "应用任务标题由应用管理，不支持重命名。",
        "en-US":
          "Application task titles are managed by the application and cannot be renamed.",
      },
    });
  });

  it("uses a conflict response when a system-selected model blocks deletion", () => {
    expect(getErrorCatalogEntry("MODEL_IN_USE_BY_SYSTEM_SETTING")).toEqual({
      message_key: "errors.modelProvider.inUseBySystemSetting",
      http_status: 409,
      messages: {
        "zh-CN": "该模型正在被系统设置使用，请先切换或取消相关选择后再删除。",
        "en-US":
          "This model is used by a system setting. Change or clear that selection before deleting it.",
      },
    });
  });

  it("uses a forbidden response when deployment configuration locks model management", () => {
    expect(getErrorCatalogEntry("MODEL_MANAGEMENT_DISABLED")).toEqual({
      message_key: "errors.modelProvider.managementDisabled",
      http_status: 403,
      messages: {
        "zh-CN": "模型配置已由部署环境锁定，当前只能查看。",
        "en-US":
          "Model configuration is locked by the deployment environment and is read-only.",
      },
    });
  });

  it("normalizes email and rejects administrator-supplied passwords", () => {
    expect(
      createUserInputSchema.parse({
        email: " Member@Example.COM ",
        name: "Member",
        role: "user",
        user_group_ids: [],
      }).email,
    ).toBe("member@example.com");

    expect(
      createUserInputSchema.safeParse({
        email: "member@example.com",
        name: "Member",
        password: "Password1!",
      }).success,
    ).toBe(false);
  });

  it("requires an owner and rejects the removed global capability scope", () => {
    const base = {
      id,
      type: "skill" as const,
      owner_id: id,
      name: "Documents",
      slug: "documents",
      description: null,
      source_type: "local" as const,
      marketplace_listing_id: null,
      marketplace_release_id: null,
      logo_object_key: null,
      manifest: null,
      risk_summary: null,
      status: "active" as const,
      installed_by: id,
      created_at: timestamp,
      updated_at: timestamp,
    };

    expect(capabilitySchema.safeParse(base).success).toBe(true);
    expect(
      capabilitySchema.safeParse({ ...base, owner_id: null }).success,
    ).toBe(false);
    expect(
      capabilitySchema.safeParse({ ...base, scope: "global" }).success,
    ).toBe(false);
  });

  it("keeps personal credential secrets out of the public API contract", () => {
    expect(
      createCredentialInputSchema.safeParse({
        name: "Example",
        provider_type: "custom_api_key",
        secret_payload: { API_KEY: "secret" },
      }).success,
    ).toBe(true);
    expect(
      createCredentialInputSchema.safeParse({
        scope: "public",
        name: "Shared service key",
        provider_type: "custom_api_key",
        secret_payload: { API_KEY: "secret" },
      }).success,
    ).toBe(false);
    expect(
      createCredentialInputSchema.safeParse({
        name: "Example",
        provider_type: "测试",
        secret_payload: { API_KEY: "secret" },
      }).success,
    ).toBe(false);
    expect(
      createCredentialInputSchema.safeParse({
        name: "Example",
        provider_type: "custom_api_key",
        secret_payload: { "api-key": "secret" },
      }).success,
    ).toBe(false);
    expect(
      credentialSchema.safeParse({
        id,
        owner_id: id,
        name: "Example",
        provider_type: "custom_api_key",
        encryption_key_id: "key-v1",
        status: "active",
        created_by: id,
        updated_by: null,
        last_used_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(true);
    expect(
      credentialSchema.safeParse({
        id,
        owner_id: null,
        name: "Legacy shared key",
        provider_type: "custom_api_key",
        encryption_key_id: "key-v1",
        status: "active",
        created_by: id,
        updated_by: null,
        last_used_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(false);

    expect(
      credentialBindingSchema.safeParse({
        id,
        credential_id: otherId,
        capability_id: id,
        binding_scope: "public",
        user_id: id,
        env_key: "API_KEY",
        status: "active",
        created_by: id,
        revoked_by: null,
        revoked_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }).success,
    ).toBe(false);
  });

  it("requires preflight block codes only for blocked_preflight", () => {
    const base = {
      id,
      conversation_id: otherId,
      queue_no: 1,
      submitted_by: id,
      input_text: "continue",
      priority_capability_ids: [],
      knowledge_base_ids: [],
      collaboration_mode: "default",
      idempotency_key: null,
      last_start_checked_at: null,
      created_at: timestamp,
      updated_at: timestamp,
    };

    expect(
      pendingRequestSchema.safeParse({
        ...base,
        status: "blocked_preflight",
        block_code: null,
      }).success,
    ).toBe(false);
    expect(
      pendingRequestSchema.safeParse({
        ...base,
        status: "blocked_overload",
        block_code: null,
      }).success,
    ).toBe(true);
    expect(
      pendingRequestSchema.safeParse({
        ...base,
        status: "steering",
        block_code: null,
      }).success,
    ).toBe(true);
  });

  it("keeps presentation annotation input and display payloads strict", () => {
    const input = {
      kind: "presentation_annotation",
      file_id: id,
      annotations: [{
        request: "  改为英文  ",
        slide_number: 1,
        elements: [
        {
          element_id: "title-1",
          shape_id: "7",
          type: "text",
          text: "生成式 AI 入门",
          bounds: { x: 69, y: 149, width: 595, height: 173 },
        },
        ],
      }],
    } as const;

    expect(presentationAnnotationInputSchema.parse(input)).toEqual({
      ...input,
      annotations: [{ ...input.annotations[0], request: "改为英文" }],
    });
    expect(buildOfficeAnnotationDisplay(input, "AI 入门.pptx")).toEqual({
      kind: "presentation_annotation",
      file_id: id,
      file_name: "AI 入门.pptx",
      annotations: [
        {
          request: "  改为英文  ",
          slide_number: 1,
          selection_count: 1,
        },
      ],
      annotation_count: 1,
    });
    expect(
      userMessageDisplaySchema.safeParse({
        kind: input.kind,
        file_id: input.file_id,
        annotations: [
          {
            request: "改为英文",
            slide_number: input.annotations[0].slide_number,
            selection_count: input.annotations[0].elements.length,
          },
        ],
        file_name: "AI 入门.pptx",
        annotation_count: 1,
      }).success,
    ).toBe(true);
    expect(
      presentationAnnotationInputSchema.safeParse({
        ...input,
        annotations: Array.from(
          { length: 21 },
          () => input.annotations[0],
        ),
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: input.kind,
        file_id: input.file_id,
        file_name: "AI 入门.pptx",
        annotations: [
          {
            request: "改为英文",
            slide_number: 1,
            selection_count: 1,
          },
          {
            request: "加粗副标题",
            slide_number: 2,
            selection_count: 1,
          },
        ],
        annotation_count: 1,
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: input.kind,
        file_id: input.file_id,
        annotations: [
          {
            request: "改为英文",
            slide_number: input.annotations[0].slide_number,
            selection_count: input.annotations[0].elements.length,
          },
        ],
        file_name: "AI 入门.pptx",
        annotation_count: 1,
        elements: input.annotations[0].elements,
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: input.kind,
        file_id: input.file_id,
        annotations: [
          {
            request: "改为英文",
            slide_number: input.annotations[0].slide_number,
            selection_count: input.annotations[0].elements.length,
          },
        ],
        file_name: "AI 入门.pptx",
        annotation_count: 1,
        text: "生成式 AI 入门",
      }).success,
    ).toBe(false);
    expect(
      presentationAnnotationInputSchema.safeParse({
        ...input,
        file_id: "not-a-uuid",
      }).success,
    ).toBe(false);
    expect(
      presentationAnnotationInputSchema.safeParse({
        ...input,
        annotations: [{ ...input.annotations[0], request: "   " }],
      }).success,
    ).toBe(false);
    expect(
      presentationAnnotationInputSchema.safeParse({
        ...input,
        locator: "internal-only",
      }).success,
    ).toBe(false);
    expect(
      presentationAnnotationInputSchema.safeParse({
        ...input,
        annotations: [
          {
            ...input.annotations[0],
            elements: Array.from(
              { length: 51 },
              () => input.annotations[0].elements[0],
            ),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: input.kind,
        file_id: input.file_id,
        annotations: [
          {
            request: "改为英文",
            slide_number: input.annotations[0].slide_number,
            selection_count: 51,
          },
        ],
        file_name: "历史演示文稿.pptx",
        annotation_count: 1,
      }).success,
    ).toBe(true);
  });

  it("keeps Word text annotation locators bounded and excludes private editor state", () => {
    const input = {
      kind: "word_annotation",
      file_id: id,
      annotations: [{
        request: "  改成正式语气  ",
        selection: {
        type: "text",
        para_id: "paragraph-17",
        selected_text: "这是一段选中文字",
        paragraph_text: "前文这是一段选中文字后文",
        before: "前文",
        after: "后文",
        start_paragraph_index: 16,
        end_paragraph_index: 16,
        is_multi_paragraph: false,
        page_number: 2,
        position_from: 4,
        position_to: 12,
        },
      }],
    } as const;

    expect(wordAnnotationInputSchema.parse(input)).toEqual({
      ...input,
      annotations: [{ ...input.annotations[0], request: "改成正式语气" }],
    });
    expect(officeAnnotationInputSchema.safeParse(input).success).toBe(true);
    expect(buildOfficeAnnotationDisplay(input, "方案.docx")).toEqual({
      kind: "word_annotation",
      file_id: id,
      file_name: "方案.docx",
      annotations: [
        {
          request: "  改成正式语气  ",
          selection_type: "text",
          paragraph_number: 17,
          page_number: 2,
          selection_count: 1,
        },
      ],
      annotation_count: 1,
    });
    expect(
      wordAnnotationInputSchema.safeParse({
        ...input,
        annotations: [{
          ...input.annotations[0],
          selection: {
            ...input.annotations[0].selection,
            editor_state: { private: true },
          },
        }],
      }).success,
    ).toBe(false);
    expect(
      wordAnnotationInputSchema.safeParse({
        ...input,
        annotations: [{
          ...input.annotations[0],
          selection: {
            ...input.annotations[0].selection,
            selected_text: "A".repeat(20_001),
          },
        }],
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: "word_annotation",
        file_id: id,
        file_name: "方案.docx",
        annotations: [
          {
            request: "改成正式语气",
            selection_type: "text",
            paragraph_number: 17,
            page_number: 2,
            selection_count: 1,
          },
        ],
        annotation_count: 1,
      }).success,
    ).toBe(true);
  });

  it("accepts bounded Excel range, image, and chart locators without raw workbook data", () => {
    const base = {
      kind: "spreadsheet_annotation",
      file_id: id,
    } as const;
    const annotationBase = {
      request: "设置为黄色",
      sheet_name: "预算表",
      sheet_index: 0,
    } as const;
    const range = {
      ...base,
      annotations: [{
        ...annotationBase,
        selection: {
          type: "range",
          range_address: "B2:D8",
          active_cell_address: "B2",
          start_row: 1,
          start_column: 1,
          end_row: 7,
          end_column: 3,
          selected_text: "收入\t成本\t利润",
          selected_formula: "=B2-C2",
        },
      }],
    } as const;
    const image = {
      ...base,
      annotations: [{
        ...annotationBase,
        selection: {
          type: "image",
          object_id: "image-7",
          name: "公司标志",
          description: "蓝色公司标志",
        },
      }],
    } as const;
    const chart = {
      ...base,
      annotations: [{
        ...annotationBase,
        selection: {
          type: "chart",
          object_id: "chart-2",
          name: "季度趋势",
          title: "季度销售趋势",
          chart_type: "line",
          element: {
            kind: "point",
            series_id: "series-1",
            series_index: 0,
            point_index: 2,
          },
          formula: "=SERIES(...) ",
        },
      }],
    } as const;

    for (const input of [range, image, chart]) {
      expect(spreadsheetAnnotationInputSchema.safeParse(input).success).toBe(
        true,
      );
      expect(officeAnnotationInputSchema.safeParse(input).success).toBe(true);
    }
    expect(buildOfficeAnnotationDisplay(range, "预算.xlsx")).toEqual({
      kind: "spreadsheet_annotation",
      file_id: id,
      file_name: "预算.xlsx",
      annotations: [
        {
          request: "设置为黄色",
          sheet_name: "预算表",
          sheet_index: 0,
          selection_type: "range",
          selection_label: "B2:D8",
          selection_count: 1,
        },
      ],
      annotation_count: 1,
    });
    expect(
      spreadsheetAnnotationInputSchema.safeParse({
        ...image,
        annotations: [{
          ...image.annotations[0],
          selection: {
            ...image.annotations[0].selection,
            src: "data:image/png;base64,secret",
          },
        }],
      }).success,
    ).toBe(false);
    expect(
      spreadsheetAnnotationInputSchema.safeParse({
        ...chart,
        annotations: [{
          ...chart.annotations[0],
          selection: {
            ...chart.annotations[0].selection,
            raw: { series: [1, 2, 3] },
          },
        }],
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: "spreadsheet_annotation",
        file_id: id,
        file_name: "预算.xlsx",
        annotations: [
          {
            request: "设置为黄色",
            sheet_name: "预算表",
            sheet_index: 0,
            selection_type: "range",
            selection_label: "B2:D8",
            selection_count: 1,
          },
        ],
        annotation_count: 1,
      }).success,
    ).toBe(true);
  });

  it("accepts bounded HTML element locators and keeps display metadata private", () => {
    const input = {
      kind: "html_annotation",
      file_id: id,
      annotations: [{
        request: "把标题改为英文",
        elements: [
        {
          selector: "#hero",
          dom_path: [0, 1],
          tag_name: "h1",
          id: "hero",
          class_names: ["title"],
          text: "欢迎",
          outer_html: '<h1 id="hero">欢迎</h1>',
          attributes: { "data-testid": "hero-title" },
          bounds: { x: 16, y: 24, width: 320, height: 56 },
        },
        ],
      }],
    } as const;

    expect(officeAnnotationInputSchema.safeParse(input).success).toBe(true);
    expect(buildOfficeAnnotationDisplay(input, "landing.html")).toEqual({
      kind: "html_annotation",
      file_id: id,
      file_name: "landing.html",
      annotations: [{ request: "把标题改为英文", selection_count: 1 }],
      annotation_count: 1,
    });
    expect(
      officeAnnotationInputSchema.safeParse({
        ...input,
        annotations: [{
          ...input.annotations[0],
          elements: [{ ...input.annotations[0].elements[0], dom_path: [] }],
        }],
      }).success,
    ).toBe(false);
    expect(
      officeAnnotationInputSchema.safeParse({
        ...input,
        annotations: [{
          ...input.annotations[0],
          elements: [
            { ...input.annotations[0].elements[0], runtime_node: "private" },
          ],
        }],
      }).success,
    ).toBe(false);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: "html_annotation",
        file_id: id,
        file_name: "landing.html",
        annotations: [{ request: "把标题改为英文", selection_count: 1 }],
        annotation_count: 1,
      }).success,
    ).toBe(true);
    expect(
      userMessageDisplaySchema.safeParse({
        kind: "html_annotation",
        file_id: id,
        file_name: "landing.html",
        annotations: [{ request: "把标题改为英文", selection_count: 1 }],
        annotation_count: 1,
        elements: input.annotations[0].elements,
      }).success,
    ).toBe(false);
  });

  it("rejects raw tool parameters from sanitized event payloads", () => {
    const event = {
      id,
      conversation_id: otherId,
      turn_id: id,
      sequence_no: 1,
      visibility: "user_collapsed",
      sse_event_id: "event-1",
      created_at: timestamp,
      event_type: "conversation.tool.started",
      payload: {
        schema_version: 1,
        item_id: "tool-1",
        action: "using_external_service",
        capability_name: "Example tool",
        safe_summary: "Calling a configured service",
        raw_parameters: { token: "secret" },
      },
    };

    expect(conversationEventSchema.safeParse(event).success).toBe(false);
    const sanitizedEvent = {
      ...event,
      payload: {
        schema_version: 1,
        item_id: "tool-1",
        action: "using_external_service",
        capability_name: "Example tool",
        safe_summary: "Calling a configured service",
      },
    };
    expect(conversationEventSchema.safeParse(sanitizedEvent).success).toBe(
      true,
    );
  });

  it("keeps the authenticated runner wire event discriminated and strict", () => {
    const event = {
      eventType: "conversation.capability.used",
      visibility: "user_collapsed",
      threadId: "native-thread-1",
      turnId: "native-turn-1",
      payload: {
        schema_version: 1,
        capability_reference: "documents",
        capability_type: "skill",
        usage_type: "auto_skill",
        safe_summary: "skill_invoked",
      },
    };

    expect(runnerConversationEventSchema.safeParse(event).success).toBe(true);
    expect(
      runnerConversationEventSchema.safeParse({
        ...event,
        payload: {
          ...event.payload,
          skill_source: "/private/skills/documents",
        },
      }).success,
    ).toBe(false);
  });

  it("accepts a native thread title update without inventing a turn id", () => {
    const event = {
      eventType: "conversation.title.updated",
      visibility: "user_visible",
      threadId: "native-thread-1",
      payload: {
        schema_version: 1,
        title: "自动生成的任务名称",
      },
    };

    expect(runnerConversationEventSchema.safeParse(event).success).toBe(true);
    expect(
      runnerConversationEventSchema.safeParse({
        ...event,
        turnId: "native-turn-1",
      }).success,
    ).toBe(false);
  });

  it("accepts message completion metadata without duplicating message content", () => {
    const event = {
      id,
      conversation_id: otherId,
      turn_id: id,
      sequence_no: 1,
      visibility: "user_visible",
      sse_event_id: "event-1",
      created_at: timestamp,
      event_type: "conversation.message.completed",
      payload: {
        schema_version: 1,
        message_id: id,
        role: "assistant",
        item_id: "native-item-1",
      },
    };
    expect(conversationEventSchema.safeParse(event).success).toBe(true);
    expect(
      conversationEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, content_text: "private response" },
      }).success,
    ).toBe(false);
    expect(
      conversationEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, item_id: "n".repeat(240) },
      }).success,
    ).toBe(true);
    expect(
      conversationEventSchema.safeParse({
        ...event,
        payload: { ...event.payload, item_id: "n".repeat(241) },
      }).success,
    ).toBe(false);
  });

  it("accepts only the two editable product settings", () => {
    expect(
      productSettingsSchema.safeParse({
        organization_display_name: "LinkSense",
        default_locale: "zh-CN",
        logo_url: "/api/v1/system/logo?v=2026-08-05T00%3A00%3A00.000Z",
        logo_updated_at: "2026-08-05T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(
      patchProductSettingsSchema.safeParse({ default_locale: "en-US" }).success,
    ).toBe(true);
    expect(
      patchProductSettingsSchema.safeParse({
        logo_url: "/api/v1/system/logo?v=1",
      }).success,
    ).toBe(false);
    expect(
      patchProductSettingsSchema.safeParse({ DATABASE_URL: "secret" }).success,
    ).toBe(false);
    expect(patchProductSettingsSchema.safeParse({}).success).toBe(false);
  });

  it("validates nullable execution concurrency overrides and effective values", () => {
    expect(
      updateExecutionConcurrencySettingsSchema.safeParse({
        max_concurrent_conversations: null,
        runner_app_server_process_limit: 12,
      }).success,
    ).toBe(true);
    expect(
      updateExecutionConcurrencySettingsSchema.safeParse({
        max_concurrent_conversations: 0,
        runner_app_server_process_limit: 12,
      }).success,
    ).toBe(false);
    expect(
      executionConcurrencySettingsSchema.safeParse({
        max_concurrent_conversations: null,
        runner_app_server_process_limit: 12,
        environment_defaults: {
          max_concurrent_conversations: 20,
          runner_app_server_process_limit: 20,
        },
        effective: {
          max_concurrent_conversations: 20,
          runner_app_server_process_limit: 12,
        },
      }).success,
    ).toBe(true);
  });

  it("requires a complete, ordered maintenance window when maintenance is enabled", () => {
    const valid = {
      enabled: true,
      reason: "Database upgrade",
      start_at: "2026-08-04T12:00:00.000Z",
      end_at: "2026-08-04T13:00:00.000Z",
    };
    expect(updateMaintenanceSettingsSchema.safeParse(valid).success).toBe(true);
    expect(
      updateMaintenanceSettingsSchema.safeParse({
        ...valid,
        reason: null,
      }).success,
    ).toBe(true);
    expect(
      updateMaintenanceSettingsSchema.safeParse({
        ...valid,
        end_at: valid.start_at,
      }).success,
    ).toBe(false);
    expect(
      updateMaintenanceSettingsSchema.safeParse({
        enabled: false,
        reason: null,
        start_at: null,
        end_at: null,
      }).success,
    ).toBe(true);
  });

  it("validates strict provider-specific authentication settings", () => {
    expect(
      updateSmtpAuthenticationSettingsSchema.safeParse({
        mode: "managed",
        expected_revision: 0,
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
        username: "mailer@example.com",
        password: "smtp-secret",
        from: "LinkSense <no-reply@example.com>",
      }).success,
    ).toBe(true);
    expect(
      updateSmtpAuthenticationSettingsSchema.safeParse({
        mode: "managed",
        expected_revision: 0,
        host: "smtp.example.com",
        port: 70_000,
        security: "plaintext",
        from: "no-reply@example.com",
      }).success,
    ).toBe(false);
    expect(
      updateOidcAuthenticationSettingsSchema.safeParse({
        mode: "managed",
        expected_revision: 2,
        issuer_url: "https://id.example.com",
        client_id: "linksense",
        client_secret: "oidc-secret",
      }).success,
    ).toBe(true);
    expect(
      updateOidcAuthenticationSettingsSchema.safeParse({
        mode: "managed",
        expected_revision: 2,
        issuer_url: "http://id.example.com",
        client_id: "linksense",
        client_secret: "oidc-secret",
      }).success,
    ).toBe(false);
    expect(
      updateOidcAuthenticationSettingsSchema.parse({
        mode: "managed",
        expected_revision: 2,
        issuer_url: "https://id.example.com",
        client_id: "linksense",
        client_secret: "  oidc-secret~value  ",
      }),
    ).toMatchObject({ client_secret: "oidc-secret~value" });
    expect(
      updateSharePointConnectionSettingsSchema.parse({
        expected_revision: 1,
        enabled: true,
        tenant_id: id,
        client_id: otherId,
        tenant_domain: "contoso.sharepoint.com",
        client_secret: "  sharepoint-secret  ",
      }),
    ).toMatchObject({ client_secret: "sharepoint-secret" });
    expect(
      updateTeamsAuthenticationSettingsSchema.safeParse({
        mode: "managed",
        expected_revision: 1,
        tenant_id: id,
        client_id: otherId,
        client_secret: "not-supported",
      }).success,
    ).toBe(false);
  });
});

describe("bilingual error catalog", () => {
  it("contains both supported locales for every stable error", () => {
    for (const entry of Object.values(errorCatalog)) {
      expect(entry.message_key.length).toBeGreaterThan(0);
      expect(entry.messages["zh-CN"].length).toBeGreaterThan(0);
      expect(entry.messages["en-US"].length).toBeGreaterThan(0);
    }
  });

  it("uses Plugin Center terminology in marketplace error messages", () => {
    const marketplaceErrors = Object.entries(errorCatalog)
      .filter(([code]) => code.startsWith("MARKETPLACE_"))
      .flatMap(([, entry]) => Object.values(entry.messages));

    expect(marketplaceErrors.join(" ")).not.toMatch(/商店|商城/u);
    expect(marketplaceErrors.join(" ")).not.toMatch(
      /\b(?:marketplace|store)\b/iu,
    );
    expect(errorCatalog.MARKETPLACE_LISTING_NOT_FOUND.messages).toEqual({
      "zh-CN": "未找到该插件中心条目。",
      "en-US": "The Plugin Center listing was not found.",
    });
  });

  it("keeps runner contract incompatibility separate from plugin environment safety", () => {
    expect(errorCatalog.EXECUTION_SERVICE_INCOMPATIBLE).toEqual({
      message_key: "errors.runner.executionServiceIncompatible",
      http_status: 503,
      messages: {
        "zh-CN": "执行服务版本不一致，请稍后重试。若问题持续，请联系管理员。",
        "en-US":
          "The execution service versions are incompatible. Try again later. If the problem persists, contact an administrator.",
      },
    });
    expect(
      Object.values(errorCatalog.EXECUTION_SERVICE_INCOMPATIBLE.messages).join(
        " ",
      ),
    ).not.toMatch(/MCP/i);
    expect(
      Object.values(errorCatalog.EXECUTION_ENVIRONMENT_INVALID.messages).join(
        " ",
      ),
    ).toMatch(/MCP/i);
  });

  it("maps conflicting legacy product codes to the canonical contract", () => {
    for (const canonicalCode of Object.values(legacyErrorCodeAliases)) {
      expect(errorCatalog[canonicalCode]).toBeDefined();
    }
  });
});
