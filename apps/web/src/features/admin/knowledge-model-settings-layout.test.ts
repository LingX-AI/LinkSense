// @vitest-environment node

import imageGenerationSettingsSource from "@/features/admin/image-generation-settings-form.tsx?raw"
import imageUnderstandingSettingsSource from "@/features/admin/image-understanding-settings-form.tsx?raw"
import knowledgeModelSettingsSource from "@/features/admin/knowledge-model-settings-form.tsx?raw"
import voiceTranscriptionSettingsSource from "@/features/admin/voice-transcription-settings-form.tsx?raw"
import { describe, expect, it } from "vitest"

describe("knowledge model settings layout", () => {
  it("keeps every specialized model form responsive within the standard width", () => {
    for (const source of [
      knowledgeModelSettingsSource,
      imageUnderstandingSettingsSource,
      voiceTranscriptionSettingsSource,
      imageGenerationSettingsSource,
    ]) {
      expect(source).toContain('className="grid w-full max-w-[720px] gap-4"')
    }
  })

  it("keeps knowledge retrieval models in a single column", () => {
    expect(knowledgeModelSettingsSource).toContain(
      'className="grid min-w-0 grid-cols-1 gap-4 rounded-2xl'
    )
    expect(knowledgeModelSettingsSource).not.toContain("xl:grid-cols-2")
  })

  it("separates every specialized model into a rounded bordered card", () => {
    expect(
      knowledgeModelSettingsSource.match(/data-slot="model-settings-card"/gu)
    ).toHaveLength(1)
    expect(knowledgeModelSettingsSource).toContain(
      '<Separator data-slot="knowledge-model-settings-separator" />'
    )

    for (const source of [
      imageUnderstandingSettingsSource,
      voiceTranscriptionSettingsSource,
      imageGenerationSettingsSource,
    ]) {
      expect(source.match(/data-slot="model-settings-card"/gu)).toHaveLength(1)
    }

    for (const source of [
      knowledgeModelSettingsSource,
      imageUnderstandingSettingsSource,
      voiceTranscriptionSettingsSource,
      imageGenerationSettingsSource,
    ]) {
      expect(source).toContain(
        "rounded-2xl border border-[color:var(--app-border)] bg-card p-4"
      )
      expect(source).not.toContain("border-border/60")
    }
  })

  it("places each optional model toggle at the end of its card content", () => {
    for (const [source, finalContent, toggle] of [
      [
        knowledgeModelSettingsSource,
        "admin.knowledgeModels.rerankRuntime",
        'name="knowledge-rerank-enabled"',
      ],
      [
        imageUnderstandingSettingsSource,
        "admin.imageUnderstanding.strategyAfterValidation",
        'name="image-understanding-enabled"',
      ],
      [
        voiceTranscriptionSettingsSource,
        "admin.voiceTranscription.modelHint",
        'name="voice-transcription-enabled"',
      ],
      [
        imageGenerationSettingsSource,
        "admin.imageGeneration.pricePerImageHint",
        'name="image-generation-enabled"',
      ],
    ]) {
      expect(source).toContain('data-slot="model-settings-toggle"')
      expect(source.indexOf(toggle)).toBeGreaterThan(
        source.indexOf(finalContent)
      )
    }
  })
})
